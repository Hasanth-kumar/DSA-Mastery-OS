import {
  createWhatsAppClient,
  formatProgressForWhatsApp,
  formatStudyPlanForWhatsApp,
  parseWhatsAppCommand,
  WHATSAPP_HELP_TEXT,
  type WhatsAppClient,
} from "@dsa/integrations";
import type { AppConfig } from "@dsa/shared";
import type { AppContext } from "../context.js";

export class WhatsAppCommandService {
  private readonly client: WhatsAppClient | null;

  constructor(
    private readonly config: AppConfig,
    private readonly ctx: AppContext,
  ) {
    const { phoneNumberId, accessToken, apiVersion, enabled } = config.whatsapp;
    this.client =
      phoneNumberId && accessToken
        ? createWhatsAppClient({ phoneNumberId, accessToken, apiVersion, enabled })
        : null;
  }

  isConfigured(): boolean {
    return Boolean(this.config.whatsapp.enabled !== false && this.client?.isConfigured());
  }

  async sendText(waId: string, body: string): Promise<void> {
    if (!this.client?.isConfigured()) {
      throw new Error("WhatsApp is not configured");
    }
    await this.client.sendText(waId, body);
  }

  isRecipientAllowed(waId: string): boolean {
    const allowed = this.config.whatsapp.allowedRecipients;
    if (allowed.length === 0) return true;
    const normalized = waId.replace(/\D/g, "");
    return allowed.some((a) => a.replace(/\D/g, "") === normalized);
  }

  async handleIncomingText(waId: string, text: string): Promise<void> {
    if (!this.client?.isConfigured()) {
      throw new Error("WhatsApp is not configured");
    }
    if (!this.isRecipientAllowed(waId)) {
      await this.client.sendText(
        waId,
        "This number is not authorized to use DSA Mastery OS.",
      );
      return;
    }

    const command = parseWhatsAppCommand(text);
    let reply: string;

    switch (command.type) {
      case "plan": {
        const plan = await this.ctx.planService.generateTodaysPlan();
        reply = formatStudyPlanForWhatsApp(plan);
        break;
      }
      case "progress": {
        const summary = this.ctx.analyticsService.getWeeklySummary();
        reply = formatProgressForWhatsApp({
          ...summary,
          weakTopics: summary.weakTopics.map((w) => ({
            name: w.name,
            score: w.score,
          })),
        });
        break;
      }
      case "hint": {
        reply = await this.handleHint(command.problemName);
        break;
      }
      case "debrief": {
        reply = await this.handleDebrief();
        break;
      }
      case "done": {
        reply = await this.handleDone(
          command.problemName,
          command.studyDuration,
          command.productivityScore,
        );
        break;
      }
      case "note": {
        reply = await this.handleNote(command.text);
        break;
      }
      case "help":
        reply = WHATSAPP_HELP_TEXT;
        break;
      case "unknown":
        reply = `Unknown command: "${command.raw}"\n\n${WHATSAPP_HELP_TEXT}`;
        break;
    }

    await this.client.sendText(waId, reply);
  }

  private async handleHint(problemName: string): Promise<string> {
    const problem = this.ctx.problemRepo.findByNameFuzzy(problemName);
    if (!problem?.topicId) {
      return `Problem not found: "${problemName}". Check the name in your Notion problems DB.`;
    }

    const topic = this.ctx.topicRepo.findById(problem.topicId);
    if (!topic) {
      return `Topic not found for problem "${problem.name}".`;
    }

    const ctx = this.ctx.hintService.buildContextFromTopic(
      problem.name,
      topic,
      problem.difficulty ?? "Medium",
      problem.attempts ?? 0,
    );
    return this.ctx.hintService.generateHint(ctx);
  }

  private async handleDebrief(): Promise<string> {
    try {
      const result = await this.ctx.debriefService.generateLatest();
      return result.debrief;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Debrief failed";
      return `📝 ${message}`;
    }
  }

  /**
   * Quick capture from the phone (5.5): append the text to the active/most
   * recent topic's Notion page; fall back to SQLite (sync_meta) when Notion
   * is unreachable so nothing is lost.
   */
  private async handleNote(text: string): Promise<string> {
    const recentSession = this.ctx.sessionRepo.findAll(1)[0];
    const topicId = recentSession?.topicId ?? null;
    const topic = topicId ? this.ctx.topicRepo.findById(topicId) : null;

    if (topic && this.ctx.notionSync.isConfigured()) {
      try {
        await this.ctx.notionSync.getClient().appendTopicNote(topic.id, text);
        return `📌 Noted on *${topic.name}* in Notion.`;
      } catch {
        // fall through to local capture
      }
    }

    const key = "quick_notes";
    const existing = this.ctx.syncMetaRepo.get(key);
    const list = existing ? (JSON.parse(existing) as unknown[]) : [];
    list.push({
      text,
      topicId,
      topicName: topic?.name ?? null,
      capturedAt: new Date().toISOString(),
    });
    this.ctx.syncMetaRepo.set(key, JSON.stringify(list));

    return topic
      ? `📌 Saved locally for *${topic.name}* (Notion unreachable — will stay in SQLite).`
      : "📌 Saved locally (no recent topic to attach it to).";
  }

  private async handleDone(
    problemName: string,
    studyDuration: number,
    productivityScore: number,
  ): Promise<string> {
    const problem = this.ctx.problemRepo.findByNameFuzzy(problemName);
    if (!problem?.topicId) {
      return `Problem not found: "${problemName}". Use exact name from your database.`;
    }

    const result = await this.ctx.sessionService.completeSession({
      topicId: problem.topicId,
      problemId: problem.id,
      problemsSolved: 1,
      studyDuration,
      productivityScore,
      pushToNotion: true,
      deferProblemStatus: false,
    });

    let reply = `✅ Session logged for ${problem.name}!\n${result.summary}\nConfidence: ${result.confidence}/100`;

    try {
      const debrief = await this.ctx.debriefService.generateForSession(
        result.session.id,
        { problemName: problem.name },
      );
      reply += `\n\n${debrief.debrief}`;
    } catch {
      // debrief is optional when the LLM is unavailable
    }

    return reply;
  }
}

import {
  createWhatsAppClient,
  formatProgressForWhatsApp,
  type WhatsAppClient,
} from "@dsa/integrations";
import type { AppConfig } from "@dsa/shared";
import type { AppContext } from "../context.js";
import type { WeeklySummary } from "./AnalyticsService.js";

export interface NotifyResult {
  sent: boolean;
  reason?: string;
  messageId?: string;
}

export class WhatsAppNotificationService {
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
    return Boolean(
      this.config.whatsapp.enabled !== false &&
        this.client?.isConfigured() &&
        this.config.whatsapp.defaultRecipient,
    );
  }

  private resolveRecipient(override?: string): string | null {
    return override ?? this.config.whatsapp.defaultRecipient ?? null;
  }

  async sendWeeklyDigest(
    recipient?: string,
    summary?: WeeklySummary,
  ): Promise<NotifyResult> {
    const to = this.resolveRecipient(recipient);
    if (!to || !this.client?.isConfigured()) {
      return { sent: false, reason: "WhatsApp or default recipient not configured" };
    }

    const resolvedSummary = summary ?? this.ctx.analyticsService.getWeeklySummary();
    const body = formatProgressForWhatsApp({
      ...resolvedSummary,
      weakTopics: resolvedSummary.weakTopics.map((w) => ({
        name: w.name,
        score: w.score,
      })),
    });

    const header = `📬 Weekly Digest\n\n`;
    const { messageId } = await this.client.sendText(to, header + body);
    return { sent: true, messageId };
  }
}

import { buildChatSystemPrompt } from "../prompts/chat.prompt.js";import { buildDebriefPrompt } from "../prompts/debrief.prompt.js";
import { buildHintPrompt } from "../prompts/hint.prompt.js";
import type {
  ChatCoachOptions,
  ChatLearningContext,
  DebriefContext,
  HintContext,
} from "../prompts/types.js";
import type { LLMClient } from "./LLMClient.js";
import { createMockLLMClient } from "./MockLLMClient.js";
import { createOpenRouterClient } from "./OpenRouterClient.js";

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMServiceConfig {
  /** `mock` and `disabled` never construct an OpenRouter client. */
  provider?: "openrouter" | "mock" | "disabled";
  model: string;
  /** Fallback chain tried after `model` fails (coach resilience). */
  models?: string[];
  /** Optional per-model OpenRouter keys for mixed-key fallback chains. */
  modelApiKeys?: Record<string, string>;
  timeoutMs?: number;
  openrouter: {
    apiKey: string;
    baseUrl?: string;
    siteUrl?: string;
    siteName?: string;
  };
}

export class LLMService {
  private readonly client: LLMClient;

  constructor(config: LLMServiceConfig, client?: LLMClient) {
    this.client =
      client ??
      (config.provider === "mock" || config.provider === "disabled"
        ? createMockLLMClient(config.provider)
        : createOpenRouterClient({
        apiKey: config.openrouter.apiKey,
        model: config.model,
        models: config.models,
        modelApiKeys: config.modelApiKeys,
        baseUrl: config.openrouter.baseUrl,
        siteUrl: config.openrouter.siteUrl,
        siteName: config.openrouter.siteName,
        timeoutMs: config.timeoutMs,
      }));
  }

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  async generateHint(ctx: HintContext): Promise<string> {
    const prompt = buildHintPrompt(ctx);
    try {
      const text = await this.client.generate(prompt);
      if (!text) {
        return fallbackHint(ctx);
      }
      return `💡 Hint for ${ctx.problemName}\n\n${text}`;
    } catch {
      return fallbackHint(ctx);
    }
  }

  async generateDebrief(ctx: DebriefContext): Promise<string> {
    const prompt = buildDebriefPrompt(ctx);
    try {
      const text = await this.client.generate(prompt);
      if (!text) {
        return fallbackDebrief(ctx);
      }
      return `📝 Session Debrief\n\n${text}`;
    } catch {
      return fallbackDebrief(ctx);
    }
  }

  /**
   * Non-streaming chat turn. Callers (`ChatService.sendMessage` /
   * `regenerateMessage`) don't catch failures here — they propagate to the
   * route as a structured error (A3/A4) so the client can show a real error
   * state instead of silently persisting a canned reply.
   */
  async generateChatReply(
    learningContext: ChatLearningContext | null,
    history: ChatHistoryMessage[],
    userMessage: string,
    options: ChatCoachOptions = {},
  ): Promise<string> {
    if (!this.isConfigured()) {
      return fallbackChatReply();
    }

    const messages = this.buildChatMessages(learningContext, history, userMessage, options);

    try {
      const text = await this.client.chat(messages);
      if (!text?.trim()) {
        throw new Error("Coach returned an empty response. Please try again.");
      }
      return text;
    } catch (err) {
      throw toChatError(err);
    }
  }

  /**
   * Streaming chat turn. Once a stream has started, we can't cleanly surface
   * an HTTP error — soft-degrade instead (partial content kept, otherwise a
   * fallback message chunk) so `ChatService.sendMessageStream` always has
   * something to persist. `generateChatReply` above stays throw-based since
   * it runs before any content is committed.
   */
  async *generateChatReplyStream(
    learningContext: ChatLearningContext | null,
    history: ChatHistoryMessage[],
    userMessage: string,
    options: ChatCoachOptions = {},
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    if (!this.isConfigured()) {
      yield fallbackChatReply();
      return;
    }

    const messages = this.buildChatMessages(learningContext, history, userMessage, options);

    let hasContent = false;
    try {
      for await (const chunk of this.client.chatStream(messages, signal)) {
        hasContent = true;
        yield chunk;
      }
      if (!hasContent) {
        yield fallbackChatReply();
      }
    } catch (err) {
      if (signal?.aborted) return;
      // Partial content already yielded — finish quietly (OpenRouterClient keeps partials).
      if (hasContent) return;
      if (isContextLengthError(err instanceof Error ? err.message : "")) {
        yield toChatError(err).message;
        return;
      }
      yield fallbackChatReply(err);
    }
  }

  private buildChatMessages(
    learningContext: ChatLearningContext | null,
    history: ChatHistoryMessage[],
    userMessage: string,
    options: ChatCoachOptions,
  ) {
    const systemPrompt = buildChatSystemPrompt(learningContext, options);
    return [
      { role: "system" as const, content: systemPrompt },
      ...capHistory(history),
      { role: "user" as const, content: truncateUserMessage(userMessage) },
    ];
  }
}

const HISTORY_MAX_MESSAGES = 12;
const HISTORY_MAX_CHARS = 8_000;
const USER_MESSAGE_MAX_CHARS = 24_000;
const TRUNCATION_HEAD_CHARS = 12_000;
const TRUNCATION_TAIL_CHARS = 8_000;

/** Keeps the most recent N messages, then trims further if they still exceed the char budget. */
export function capHistory(history: ChatHistoryMessage[]): ChatHistoryMessage[] {
  const recent = history.slice(-HISTORY_MAX_MESSAGES);
  let total = recent.reduce((sum, m) => sum + m.content.length, 0);
  let start = 0;
  while (total > HISTORY_MAX_CHARS && start < recent.length - 1) {
    total -= recent[start]!.content.length;
    start++;
  }
  return recent.slice(start);
}

/** Keeps head + tail (code endings matter) and marks what was cut. */
export function truncateUserMessage(message: string): string {
  if (message.length <= USER_MESSAGE_MAX_CHARS) return message;
  const head = message.slice(0, TRUNCATION_HEAD_CHARS);
  const tail = message.slice(-TRUNCATION_TAIL_CHARS);
  const cut = message.length - TRUNCATION_HEAD_CHARS - TRUNCATION_TAIL_CHARS;
  return `${head}\n\n[...truncated ${cut} chars...]\n\n${tail}`;
}

function isContextLengthError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("context length") ||
    m.includes("context_length") ||
    m.includes("maximum context") ||
    m.includes("too many tokens") ||
    m.includes("input too large")
  );
}

/** Normalizes a failed chat call into a user-facing error message. */
function toChatError(err: unknown): Error {
  const detail = err instanceof Error ? err.message : "Unknown error";
  if (isContextLengthError(detail)) {
    return new Error("Input too large for the current model — trim your code or switch models.");
  }
  return new Error(`Coach is temporarily unavailable (${detail}). Please try again.`);
}

function fallbackHint(ctx: HintContext): string {
  const depth =
    ctx.difficulty === "Easy"
      ? "Start with a brute-force approach and look for repeated work."
      : ctx.difficulty === "Medium"
        ? "Identify the pattern, then optimize time or space."
        : "Break into subproblems; verify invariants before coding.";

  return `💡 LLM unavailable (check OpenRouter API key).\n\nFor ${ctx.problemName} (${ctx.difficulty}): focus on ${ctx.topicName}. ${depth}`;
}

function fallbackChatReply(err?: unknown): string {
  const detail = err instanceof Error ? err.message : null;
  const suffix = detail ? ` (${detail})` : "";
  return (
    "Coach is temporarily unavailable" +
    suffix +
    ". Check your OpenRouter coach key (`OPENROUTER_COACH_API_KEY` " +
    "or `OPENROUTER_API_KEY`) and model (`COACH_LLM_MODEL`), or try another model in the picker."
  );
}

function fallbackDebrief(ctx: DebriefContext): string {
  const rating = ctx.productivityScore >= 80 ? 3 : ctx.productivityScore >= 50 ? 2 : 1;
  const resolveWindow =
    rating === 3 ? "spaced review in ~2–3 weeks" : rating === 2 ? "cold re-solve in ~5–7 days" : "cold re-solve in ~2 days";
  const nextAction = ctx.isWeakArea
    ? `Drill one foundational ${ctx.topicName} sub-skill before the next full problem.`
    : `Pick the next problem from the engine recommendation: ${ctx.recommendation}`;

  return `📝 Session Debrief

**${ctx.topicName} debrief**
- **Calibration (1–3):** ${rating} — derived from productivity ${ctx.productivityScore}/100; adjust if it doesn't match how it felt.
- **Re-solve:** ${resolveWindow}
- **Signal → pattern → gotcha:** _____ → ${ctx.topicName} → _____
- **Mistake tag:** _____
- **Next action:** ${nextAction}`;
}

export function createLLMService(config: LLMServiceConfig): LLMService {
  return new LLMService(config);
}

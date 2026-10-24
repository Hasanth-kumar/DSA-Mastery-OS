import {
  stripWikiLinks,
  type ChatHistoryMessage,
  type ChatLearningContext,
  type LLMService,
} from "@dsa/integrations";
import type { IntelligenceOrchestrator } from "@dsa/intelligence";
import type { AppConfig } from "@dsa/shared";
import { createCoachLLMService, createCoachModelLLMService } from "../llm.factory.js";
import type { AttemptRepository } from "../repositories/AttemptRepository.js";
import type { ChatRepository } from "../repositories/ChatRepository.js";
import type { NoteRepository } from "../repositories/NoteRepository.js";
import type { ProblemRepository } from "../repositories/ProblemRepository.js";
import type { TopicRepository } from "../repositories/TopicRepository.js";
import type { AnalyticsService } from "./AnalyticsService.js";
import type { PlanService } from "./PlanService.js";

export interface ChatMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ChatThreadDto {
  threadId: string;
  messages: ChatMessageDto[];
  updatedAt: string;
}

export interface ChatThreadSummaryDto {
  threadId: string;
  preview: string;
  updatedAt: string;
}

export interface SendChatInput {
  threadId?: string;
  message: string;
  problemId?: string;
  includeContext?: boolean;
  /** P5.2: anchored from a hidden-pattern row on Today — keep the pattern out of the context. */
  hidePattern?: boolean;
  directMode?: boolean;
  /** Coach model id (from listModels); falls back to the configured default. */
  model?: string;
}

/** Coach model exposed to the UI — never carries the API key. */
export interface CoachModelDto {
  id: string;
  label: string;
  model: string;
}

export interface CoachModelList {
  models: CoachModelDto[];
  defaultModelId: string;
}

export interface SendChatResult {
  threadId: string;
  userMessage: ChatMessageDto;
  assistantMessage: ChatMessageDto;
}

export type ChatStreamEvent =
  | { type: "meta"; threadId: string; userMessage: ChatMessageDto }
  | { type: "chunk"; text: string }
  | { type: "done"; assistantMessage: ChatMessageDto }
  | { type: "error"; message: string };

export class ChatService {
  /** Coach model used when the request doesn't pick one (also the test stub). */
  private readonly defaultLlm: LLMService;
  /** Lazily-built services for non-default models, keyed by model id. */
  private readonly llmByModelId = new Map<string, LLMService>();
  private learningContextCache: {
    ctx: ChatLearningContext;
    expiresAt: number;
  } | null = null;
  private static readonly CONTEXT_TTL_MS = 60_000;

  constructor(
    private readonly config: AppConfig,
    private readonly chatRepo: ChatRepository,
    private readonly planService: PlanService,
    private readonly analyticsService: AnalyticsService,
    private readonly intelligence: IntelligenceOrchestrator,
    private readonly topicRepo: TopicRepository,
    private readonly problemRepo: ProblemRepository,
    llm?: LLMService,
    private readonly attemptRepo?: AttemptRepository,
    private readonly noteRepo?: NoteRepository,
  ) {
    this.defaultLlm = llm ?? createCoachLLMService(config);
  }

  /** Models the coach UI can switch between (API keys stripped). */
  listModels(): CoachModelList {
    return {
      models: this.config.coachLlm.models.map(({ id, label, model }) => ({
        id,
        label,
        model,
      })),
      defaultModelId: this.config.coachLlm.defaultModelId,
    };
  }

  /**
   * Resolve the LLM for a chat turn. Unknown or default ids use the configured
   * coach model (the injected stub in tests); other ids build and cache a
   * dedicated service so switching models doesn't rebuild on every message.
   */
  private resolveLlm(modelId?: string): LLMService {
    if (!modelId || modelId === this.config.coachLlm.defaultModelId) {
      return this.defaultLlm;
    }
    const cached = this.llmByModelId.get(modelId);
    if (cached) return cached;

    const option = this.config.coachLlm.models.find((m) => m.id === modelId);
    if (!option) return this.defaultLlm;

    const service = createCoachModelLLMService(this.config, option);
    this.llmByModelId.set(modelId, service);
    return service;
  }

  listThreads(limit = 30): ChatThreadSummaryDto[] {
    return this.chatRepo.listThreads(limit).map((thread) => {
      const firstUser = this.chatRepo.findFirstUserMessage(thread.id);
      const preview = firstUser?.content.trim().slice(0, 80) ?? "New conversation";
      return {
        threadId: thread.id,
        preview: preview.length >= 80 ? `${preview}…` : preview,
        updatedAt: new Date(thread.updatedAt).toISOString(),
      };
    });
  }

  getThread(threadId: string): ChatThreadDto | null {
    const thread = this.chatRepo.findThreadById(threadId);
    if (!thread) return null;

    return {
      threadId: thread.id,
      messages: this.chatRepo.findMessagesByThread(threadId).map(toMessageDto),
      updatedAt: new Date(thread.updatedAt).toISOString(),
    };
  }

  clearThread(threadId: string): boolean {
    return this.chatRepo.deleteThread(threadId);
  }

  async sendMessage(input: SendChatInput): Promise<SendChatResult> {
    const message = input.message.trim();
    if (!message) {
      throw new Error("message is required");
    }

    const { thread, history, learningContext, coachOptions } =
      await this.prepareTurn(input);

    const reply = await this.resolveLlm(input.model).generateChatReply(
      learningContext,
      history,
      message,
      coachOptions,
    );

    const userMessage = this.chatRepo.addMessage(thread.id, "user", message);
    const assistantMessage = this.chatRepo.addMessage(thread.id, "assistant", reply);

    return {
      threadId: thread.id,
      userMessage: toMessageDto(userMessage),
      assistantMessage: toMessageDto(assistantMessage),
    };
  }

  async *sendMessageStream(
    input: SendChatInput,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const message = input.message.trim();
    if (!message) {
      yield { type: "error", message: "message is required" };
      return;
    }

    try {
      const { thread, history, learningContext, coachOptions } =
        await this.prepareTurn(input);

      const userMessage = this.chatRepo.addMessage(thread.id, "user", message);
      yield* this.streamReply({
        threadId: thread.id,
        userMessage,
        model: input.model,
        learningContext,
        history,
        content: message,
        coachOptions,
        signal,
        // A stop before any output leaves no trace of the aborted turn.
        onAbortedEmpty: () => this.chatRepo.deleteMessage(userMessage.id),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Chat failed";
      yield { type: "error", message: msg };
    }
  }

  /**
   * Shared tail of every chat stream: meta → chunks → abort handling →
   * persist (soft degradation keeps LLM fallback text) → done.
   */
  private async *streamReply(args: {
    threadId: string;
    userMessage: Parameters<typeof toMessageDto>[0];
    model?: string;
    learningContext: ChatLearningContext | null;
    history: ChatHistoryMessage[];
    content: string;
    coachOptions: { directMode?: boolean; anchored: boolean };
    signal?: AbortSignal;
    onAbortedEmpty?: () => void;
  }): AsyncGenerator<ChatStreamEvent> {
    yield {
      type: "meta",
      threadId: args.threadId,
      userMessage: toMessageDto(args.userMessage),
    };

    let reply = "";
    for await (const chunk of this.resolveLlm(args.model).generateChatReplyStream(
      args.learningContext,
      args.history,
      args.content,
      args.coachOptions,
      args.signal,
    )) {
      if (args.signal?.aborted) break;
      reply += chunk;
      yield { type: "chunk", text: chunk };
    }

    const trimmed = reply.trim();
    if (args.signal?.aborted && !trimmed) {
      args.onAbortedEmpty?.();
      yield { type: "error", message: "Generation stopped" };
      return;
    }

    const assistantMessage = this.chatRepo.addMessage(
      args.threadId,
      "assistant",
      trimmed ||
        "Coach is temporarily unavailable. Please try again or switch models.",
    );
    yield { type: "done", assistantMessage: toMessageDto(assistantMessage) };
  }

  async *regenerateMessageStream(
    input: {
      threadId: string;
      problemId?: string;
      includeContext?: boolean;
      /** P5.2: anchored from a hidden-pattern row on Today — keep the pattern out of the context. */
      hidePattern?: boolean;
      directMode?: boolean;
      model?: string;
    },
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    try {
      const thread = this.chatRepo.findThreadById(input.threadId);
      if (!thread) {
        yield { type: "error", message: `Thread not found: ${input.threadId}` };
        return;
      }

      const messages = this.chatRepo.findMessagesByThread(input.threadId);
      if (messages.length < 2) {
        yield { type: "error", message: "Nothing to regenerate" };
        return;
      }

      const last = messages[messages.length - 1]!;
      if (last.role !== "assistant") {
        yield { type: "error", message: "Last message is not from the coach" };
        return;
      }

      const userMsg = messages[messages.length - 2]!;
      if (userMsg.role !== "user") {
        yield { type: "error", message: "Expected a user message before the coach reply" };
        return;
      }

      this.chatRepo.deleteMessage(last.id);

      yield* this.streamReply({
        threadId: input.threadId,
        userMessage: userMsg,
        model: input.model,
        learningContext: await this.resolveContext(input),
        history: messages.slice(0, -2).map(toHistoryMessage),
        content: userMsg.content,
        coachOptions: { directMode: input.directMode, anchored: Boolean(input.problemId) },
        signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Regenerate failed";
      yield { type: "error", message: msg };
    }
  }

  async *editMessageStream(
    input: {
      threadId: string;
      messageId: string;
      content: string;
      problemId?: string;
      includeContext?: boolean;
      /** P5.2: anchored from a hidden-pattern row on Today — keep the pattern out of the context. */
      hidePattern?: boolean;
      directMode?: boolean;
      model?: string;
    },
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const content = input.content.trim();
    if (!content) {
      yield { type: "error", message: "content is required" };
      return;
    }

    try {
      const thread = this.chatRepo.findThreadById(input.threadId);
      if (!thread) {
        yield { type: "error", message: `Thread not found: ${input.threadId}` };
        return;
      }

      const target = this.chatRepo.findMessageById(input.messageId);
      if (!target || target.threadId !== input.threadId) {
        yield { type: "error", message: "Message not found" };
        return;
      }
      if (target.role !== "user") {
        yield { type: "error", message: "Only user messages can be edited" };
        return;
      }

      this.chatRepo.updateMessageContent(input.messageId, content);
      this.chatRepo.deleteMessagesAfter(input.threadId, target.createdAt);

      const prior = this.chatRepo
        .findMessagesByThread(input.threadId)
        .filter((m) => m.createdAt < target.createdAt)
        .map(toHistoryMessage);

      yield* this.streamReply({
        threadId: input.threadId,
        userMessage: this.chatRepo.findMessageById(input.messageId)!,
        model: input.model,
        learningContext: await this.resolveContext(input),
        history: prior,
        content,
        coachOptions: { directMode: input.directMode, anchored: Boolean(input.problemId) },
        signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Edit failed";
      yield { type: "error", message: msg };
    }
  }

  private async prepareTurn(input: SendChatInput) {
    const thread =
      input.threadId != null ? this.chatRepo.findThreadById(input.threadId) : null;
    const activeThread = thread ?? this.chatRepo.createThread();

    if (input.threadId && !thread) {
      throw new Error(`Thread not found: ${input.threadId}`);
    }

    const history = this.chatRepo
      .findMessagesByThread(activeThread.id)
      .map(toHistoryMessage);

    return {
      thread: activeThread,
      history,
      learningContext: await this.resolveContext(input),
      coachOptions: {
        directMode: input.directMode,
        anchored: Boolean(input.problemId),
      },
    };
  }

  /**
   * Context for a coach turn: full learning context when requested, problem-only
   * context when merely anchored to a problem, otherwise none.
   */
  private async resolveContext(input: {
    includeContext?: boolean;
    /** P5.2: anchored from a hidden-pattern row on Today — keep the pattern out of the context. */
    hidePattern?: boolean;
    problemId?: string;
  }): Promise<ChatLearningContext | null> {
    const hide = input.hidePattern === true;
    if (input.includeContext) return this.buildLearningContext(input.problemId, hide);
    return input.problemId ? this.buildProblemOnlyContext(input.problemId, hide) : null;
  }

  private async buildLearningContext(
    problemId?: string,
    hidePattern = false,
  ): Promise<ChatLearningContext> {
    const now = Date.now();
    if (
      !problemId &&
      this.learningContextCache &&
      this.learningContextCache.expiresAt > now
    ) {
      return this.learningContextCache.ctx;
    }

    const [plan, streak, topics] = await Promise.all([
      this.planService.generateTodaysPlan(),
      Promise.resolve(this.analyticsService.getStreak()),
      Promise.resolve(this.topicRepo.findAll()),
    ]);

    const weakness = this.intelligence.getWeaknessReport(topics);

    const ctx: ChatLearningContext = {
      todayPlan: {
        primaryTopic: plan.primaryTopic.name,
        reasoning: plan.reasoning,
        estimatedDuration: plan.estimatedDuration,
        suggestedProblems: plan.suggestedProblems.map((p) => p.name),
      },
      weakTopics: weakness.weakTopics.slice(0, 3).map((w) => {
        const topic = topics.find((t) => t.id === w.topicId);
        return {
          name: topic?.name ?? w.topicId,
          score: w.score,
          recommendation: w.recommendation,
        };
      }),
      streakDays: streak.currentStreakDays,
    };

    if (problemId) {
      const problemCtx = await this.buildProblemOnlyContext(problemId, hidePattern);
      if (problemCtx?.problem) {
        ctx.problem = problemCtx.problem;
      }
    } else {
      this.learningContextCache = {
        ctx,
        expiresAt: now + ChatService.CONTEXT_TTL_MS,
      };
    }

    return ctx;
  }

  private async buildProblemOnlyContext(
    problemId: string,
    hidePattern = false,
  ): Promise<ChatLearningContext | null> {
    const problem = this.problemRepo.findById(problemId);
    if (!problem?.topicId) return null;

    const topic = this.topicRepo.findById(problem.topicId);
    if (!topic) return null;

    const solveHistory = this.attemptRepo
      ?.findByProblemId(problemId, 5)
      .map((a) => ({
        solvedAt: new Date(a.solvedAt).toISOString(),
        timeTakenMinutes: a.timeTaken,
        mistakeTag: a.mistakeTag,
      }));

    const weakness = this.intelligence.analyzeTopicWeakness(topic);
    const weaknessSignals = weakness.signals
      .filter((s) => s.value > 0)
      .map((s) => s.description);

    const noteRow = this.noteRepo?.findByProblemId(problemId);
    const note = noteRow?.content
      ? stripWikiLinks(noteRow.content).trim().slice(0, 4000)
      : undefined;

    // P5.2: a hidden-pattern row — the problem, its own history and nothing that
    // names or hints the pattern (topic name, topic-level signals, the note).
    if (hidePattern) {
      return {
        problem: {
          name: problem.name,
          patternHidden: true,
          difficulty: problem.difficulty ?? "Medium",
          attempts: problem.attempts ?? 0,
          status: problem.status ?? "Not started",
          confidence: topic.confidence,
          solveHistory: solveHistory && solveHistory.length > 0 ? solveHistory : undefined,
        },
      };
    }

    return {
      problem: {
        name: problem.name,
        topicName: topic.name,
        difficulty: problem.difficulty ?? "Medium",
        attempts: problem.attempts ?? 0,
        status: problem.status ?? "Not started",
        confidence: topic.confidence,
        solveHistory: solveHistory && solveHistory.length > 0 ? solveHistory : undefined,
        topicMistakeTags: topic.mistakeTagCounts,
        weaknessSignals: weaknessSignals.length > 0 ? weaknessSignals : undefined,
        note: note || undefined,
      },
    };
  }
}

function toHistoryMessage(row: {
  role: string;
  content: string;
}): ChatHistoryMessage {
  return {
    role: row.role as "user" | "assistant",
    content: row.content,
  };
}

function toMessageDto(row: {
  id: string;
  role: string;
  content: string;
  createdAt: number;
}): ChatMessageDto {
  return {
    id: row.id,
    role: row.role as "user" | "assistant",
    content: row.content,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

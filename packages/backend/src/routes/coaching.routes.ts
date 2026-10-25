import type { ServerResponse } from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import { serializeForJson } from "../lib/json.js";
import { replyServiceError } from "../lib/http.js";
import type { ChatStreamEvent } from "../services/ChatService.js";

function parseHintLevel(raw: string | undefined): 1 | 2 | 3 | 4 | undefined {
  const level = Number(raw);
  return level === 1 || level === 2 || level === 3 || level === 4
    ? level
    : undefined;
}

function writeSseEvent(reply: { raw: ServerResponse }, event: ChatStreamEvent): void {
  reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  const flush = (reply.raw as ServerResponse & { flush?: () => void }).flush;
  flush?.();
}

async function streamChatEvents(
  reply: { raw: ServerResponse },
  generator: AsyncGenerator<ChatStreamEvent>,
): Promise<void> {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });
  reply.raw.socket?.setNoDelay(true);

  try {
    for await (const event of generator) {
      writeSseEvent(reply, event);
      if (event.type === "error") break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stream failed";
    writeSseEvent(reply, { type: "error", message });
  } finally {
    reply.raw.end();
  }
}

export async function coachingRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  /** D2: auto-capture — every coach interaction anchored to a problem counts. */
  const recordCoachUse = (problemId: string | null | undefined): void => {
    if (!problemId) return;
    ctx.coachUsage.set(problemId, (ctx.coachUsage.get(problemId) ?? 0) + 1);
  };

  /** Shared tail of both hint endpoints: topic lookup → hint → coach-use capture. */
  const sendHint = async (
    reply: FastifyReply,
    problem: ReturnType<AppContext["problemRepo"]["findById"]>,
    level: string | undefined,
    notFoundMessage: string,
  ) => {
    if (!problem?.topicId) {
      return reply.status(404).send({ error: notFoundMessage });
    }

    const topic = ctx.topicRepo.findById(problem.topicId);
    if (!topic) {
      return reply.status(404).send({ error: "Topic not found" });
    }

    const hintCtx = ctx.hintService.buildContextFromTopic(
      problem.name,
      topic,
      problem.difficulty ?? "Medium",
      problem.attempts ?? 0,
      parseHintLevel(level),
    );
    const hint = await ctx.hintService.generateHint(hintCtx);
    recordCoachUse(problem.id);
    return reply.send(serializeForJson({ problemId: problem.id, hint }));
  };

  /** Shared SSE plumbing for the chat stream endpoints (abort wiring + hijack). */
  const startStream = (
    request: FastifyRequest,
    reply: FastifyReply,
    run: (signal: AbortSignal) => AsyncGenerator<ChatStreamEvent>,
  ): Promise<void> => {
    const abortController = new AbortController();
    request.raw.on("aborted", () => abortController.abort());
    reply.hijack();
    return streamChatEvents(reply, run(abortController.signal));
  };

  app.get("/coaching/debrief", async (_request, reply) => {
    try {
      const result = await ctx.debriefService.generateLatest();
      return reply.send(serializeForJson(result));
    } catch (err) {
      return replyServiceError(reply, err, "Debrief failed");
    }
  });

  app.get<{ Params: { sessionId: string } }>(
    "/coaching/debrief/:sessionId",
    async (request, reply) => {
      try {
        const result = await ctx.debriefService.generateForSession(
          request.params.sessionId,
        );
        return reply.send(serializeForJson(result));
      } catch (err) {
        return replyServiceError(reply, err, "Debrief failed");
      }
    },
  );

  app.get<{ Params: { problemId: string }; Querystring: { level?: string } }>(
    "/coaching/hint/:problemId",
    async (request, reply) =>
      sendHint(
        reply,
        ctx.problemRepo.findById(request.params.problemId),
        request.query.level,
        "Problem not found",
      ),
  );

  app.get<{ Querystring: { name?: string; level?: string } }>(
    "/coaching/hint",
    async (request, reply) => {
      const name = request.query.name?.trim();
      if (!name) {
        return reply.status(400).send({ error: "name query parameter is required" });
      }

      return sendHint(
        reply,
        ctx.problemRepo.findByNameFuzzy(name),
        request.query.level,
        `Problem not found: ${name}`,
      );
    },
  );

  app.get("/coaching/threads", async (_request, reply) => {
    const threads = ctx.chatService.listThreads();
    return reply.send(serializeForJson({ threads }));
  });

  app.get("/coaching/models", async (_request, reply) => {
    return reply.send(serializeForJson(ctx.chatService.listModels()));
  });

  app.post<{
    Body: {
      threadId?: string;
      message?: string;
      problemId?: string;
      includeContext?: boolean;
      hidePattern?: boolean;
      directMode?: boolean;
      model?: string;
    };
  }>("/coaching/chat", async (request, reply) => {
    const message = request.body.message?.trim();
    if (!message) {
      return reply.status(400).send({ error: "message is required" });
    }

    recordCoachUse(request.body.problemId);
    try {
      const result = await ctx.chatService.sendMessage({
        threadId: request.body.threadId,
        message,
        problemId: request.body.problemId,
        includeContext: request.body.includeContext ?? true,
        hidePattern: request.body.hidePattern,
        directMode: request.body.directMode ?? false,
        model: request.body.model,
      });
      return reply.send(serializeForJson(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Chat failed";
      const status = msg.includes("not found") ? 404 : 500;
      return reply.status(status).send({ error: msg });
    }
  });

  app.post<{
    Body: {
      threadId?: string;
      message?: string;
      problemId?: string;
      includeContext?: boolean;
      hidePattern?: boolean;
      directMode?: boolean;
      model?: string;
    };
  }>("/coaching/chat/stream", async (request, reply) => {
    const message = request.body.message?.trim();
    if (!message) {
      return reply.status(400).send({ error: "message is required" });
    }

    recordCoachUse(request.body.problemId);
    await startStream(request, reply, (signal) =>
      ctx.chatService.sendMessageStream(
        {
          threadId: request.body.threadId,
          message,
          problemId: request.body.problemId,
          includeContext: request.body.includeContext ?? true,
          hidePattern: request.body.hidePattern,
          directMode: request.body.directMode ?? false,
          model: request.body.model,
        },
        signal,
      ),
    );
  });

  app.post<{
    Body: {
      threadId?: string;
      problemId?: string;
      includeContext?: boolean;
      hidePattern?: boolean;
      directMode?: boolean;
      model?: string;
    };
  }>("/coaching/chat/regenerate/stream", async (request, reply) => {
    const threadId = request.body.threadId?.trim();
    if (!threadId) {
      return reply.status(400).send({ error: "threadId is required" });
    }

    await startStream(request, reply, (signal) =>
      ctx.chatService.regenerateMessageStream(
        {
          threadId,
          problemId: request.body.problemId,
          includeContext: request.body.includeContext ?? true,
          hidePattern: request.body.hidePattern,
          directMode: request.body.directMode ?? false,
          model: request.body.model,
        },
        signal,
      ),
    );
  });

  app.post<{
    Body: {
      threadId?: string;
      messageId?: string;
      content?: string;
      problemId?: string;
      includeContext?: boolean;
      hidePattern?: boolean;
      directMode?: boolean;
      model?: string;
    };
  }>("/coaching/chat/edit/stream", async (request, reply) => {
    const threadId = request.body.threadId?.trim();
    const messageId = request.body.messageId?.trim();
    const content = request.body.content?.trim();
    if (!threadId || !messageId || !content) {
      return reply
        .status(400)
        .send({ error: "threadId, messageId, and content are required" });
    }

    await startStream(request, reply, (signal) =>
      ctx.chatService.editMessageStream(
        {
          threadId,
          messageId,
          content,
          problemId: request.body.problemId,
          includeContext: request.body.includeContext ?? true,
          hidePattern: request.body.hidePattern,
          directMode: request.body.directMode ?? false,
          model: request.body.model,
        },
        signal,
      ),
    );
  });

  app.get<{ Params: { threadId: string } }>(
    "/coaching/chat/:threadId",
    async (request, reply) => {
      const thread = ctx.chatService.getThread(request.params.threadId);
      if (!thread) {
        return reply.status(404).send({ error: "Thread not found" });
      }
      return reply.send(serializeForJson(thread));
    },
  );

  app.delete<{ Params: { threadId: string } }>(
    "/coaching/chat/:threadId",
    async (request, reply) => {
      const deleted = ctx.chatService.clearThread(request.params.threadId);
      if (!deleted) {
        return reply.status(404).send({ error: "Thread not found" });
      }
      return reply.status(204).send();
    },
  );
}

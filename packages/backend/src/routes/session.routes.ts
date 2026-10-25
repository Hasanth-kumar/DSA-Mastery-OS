import { HELP_LEVELS, HELP_SOURCE_LABELS, type HelpLevel, type HelpSource } from "@dsa/intelligence";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { serializeForJson } from "../lib/json.js";
import { replyServiceError } from "../lib/http.js";
import { parseMistakeTags } from "../repositories/AttemptRepository.js";

export async function sessionRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/session", async (request, reply) => {
    const limit = Number((request.query as { limit?: string }).limit ?? 50);
    const sessions = ctx.sessionService.list(limit);
    return reply.send(serializeForJson({ sessions, count: sessions.length }));
  });

  app.get("/session/activity", async (request, reply) => {
    const days = Number((request.query as { days?: string }).days ?? 182);
    const safeDays = Number.isFinite(days) && days > 0 ? Math.min(Math.floor(days), 365) : 182;
    const dailyCounts = ctx.sessionService.getActivityDailyCounts(safeDays);
    return reply.send(serializeForJson({ dailyCounts, days: safeDays }));
  });

  /** Everything that happened on one day — heatmap drill-down (5.4). */
  app.get<{ Params: { date: string } }>(
    "/session/day/:date",
    async (request, reply) => {
      const date = request.params.date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return reply.status(400).send({ error: "date must be YYYY-MM-DD" });
      }
      const dayStart = new Date(`${date}T00:00:00Z`).getTime();
      const dayEnd = dayStart + 86_400_000;

      const sessions = ctx.sessionService
        .list(500)
        .filter((s) => s.date >= dayStart && s.date < dayEnd);
      const topics = ctx.topicRepo.findAll();
      const topicName = (id: string | null) =>
        topics.find((t) => t.id === id)?.name ?? null;

      const attempts = ctx.attemptRepo
        .findRecent(1000)
        .filter((a) => a.solvedAt >= dayStart && a.solvedAt < dayEnd)
        .map((a) => ({
          problemId: a.problemId,
          problemName: ctx.problemRepo.findById(a.problemId)?.name ?? a.problemId,
          timeTaken: a.timeTaken,
          mistakeTags: parseMistakeTags(a.mistakeTag),
        }));

      return reply.send(
        serializeForJson({
          date,
          sessions: sessions.map((s) => ({
            id: s.id,
            topicId: s.topicId,
            topicName: topicName(s.topicId),
            problemsSolved: s.problemsSolved,
            studyDuration: s.studyDuration,
            productivityScore: s.productivityScore,
          })),
          problems: attempts,
        }),
      );
    },
  );

  app.get<{ Params: { id: string } }>("/session/:id", async (request, reply) => {
    const session = ctx.sessionService.getById(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }
    return reply.send(serializeForJson({ session }));
  });

  app.post<{
    Body: {
      /** Optional when `problemId` is given: the problem's own topic is used. */
      topicId?: string;
      problemsSolved?: number;
      studyDuration: number;
      productivityScore?: number;
      date?: string;
      pushToNotion?: boolean;
      problemId?: string;
      mistakeTag?: string | null;
      warmupGraded?: boolean;
    };
  }>("/session", async (request, reply) => {
    const {
      problemsSolved,
      studyDuration,
      date,
      pushToNotion,
      problemId,
      mistakeTag,
      warmupGraded,
    } = request.body;

    const topicId =
      request.body.topicId ||
      (problemId ? (ctx.problemRepo.findById(problemId)?.topicId ?? undefined) : undefined);

    if (!topicId || studyDuration == null) {
      return reply.status(400).send({
        error: "topicId and studyDuration are required",
      });
    }

    try {
      // One-tap logging (1.3): when a problem is attached, everything except
      // the timer defaults sensibly — no multi-field form needed.
      const result = await ctx.sessionService.completeSession({
        topicId,
        problemsSolved: problemsSolved ?? (problemId ? 1 : 1),
        studyDuration,
        date: date ? new Date(date) : undefined,
        pushToNotion,
        problemId,
        mistakeTag,
        warmupGraded,
      });
      ctx.events.publish("session");
      return reply.status(201).send(serializeForJson(result));
    } catch (err) {
      return replyServiceError(reply, err, "Failed to log session");
    }
  });

  // Mistake capture (1.4) — PATCHes the attempt created by POST /session.
  // Multi-select tags + optional "used coach" override (D3); empty = a smooth solve.
  // P6.1 / P6.2: optional help level + source and a one-line takeaway.
  app.patch<{
    Params: { id: string };
    Body: {
      tags?: string[];
      usedCoach?: boolean;
      helpLevel?: string;
      helpSource?: string;
      takeaway?: string;
    };
  }>("/attempts/:id/mistake", async (request, reply) => {
    const { helpLevel, helpSource, takeaway } = request.body;
    if (helpLevel != null && !HELP_LEVELS.includes(helpLevel as HelpLevel)) {
      return reply.status(400).send({ error: `helpLevel must be one of ${HELP_LEVELS.join(", ")}` });
    }
    if (helpSource != null && !(helpSource in HELP_SOURCE_LABELS)) {
      return reply.status(400).send({ error: "helpSource must be coach, external-ai or other" });
    }
    const attempt = ctx.attemptRepo.setMistake(request.params.id, {
      tags: request.body.tags ?? [],
      usedCoach: request.body.usedCoach,
      helpLevel: helpLevel as HelpLevel | undefined,
      helpSource: helpSource as HelpSource | undefined,
      takeaway,
    });
    if (!attempt) {
      return reply.status(404).send({ error: "Attempt not found" });
    }
    // P6.2: append the takeaway to the problem's existing note (dev vault in the worktree).
    if (ctx.config.flags.takeawayField && attempt.takeaway) {
      ctx.obsidianNotes.appendTakeaway(attempt.problemId, attempt.takeaway, new Date());
    }
    await ctx.sessionService.finalizeProblemAfterMistake(
      attempt.problemId,
      parseMistakeTags(attempt.mistakeTag),
      attempt,
    );
    // The outcome (tags + "needed help") is now known: re-score the session.
    await ctx.sessionService.rescoreAfterMistakeCapture(attempt);
    ctx.events.publish("session");
    ctx.events.publish("attempt");
    ctx.events.publish("problem");
    return reply.send(serializeForJson({ attempt }));
  });

  // P6.1: "Which pattern did you use?" on a hidden-pattern row. Stores the
  // guess, then reveals the real pattern.
  app.post<{ Params: { id: string }; Body: { guess?: string } }>(
    "/attempts/:id/pattern-guess",
    async (request, reply) => {
      const guess = request.body.guess?.trim();
      if (!guess) return reply.status(400).send({ error: "guess is required (a topic id or \"unsure\")" });
      const attempt = ctx.attemptRepo.setPatternGuess(request.params.id, guess);
      if (!attempt) return reply.status(404).send({ error: "Attempt not found" });
      const topicId = ctx.problemRepo.findById(attempt.problemId)?.topicId ?? attempt.topicId;
      const topic = topicId ? ctx.topicRepo.findById(topicId) : null;
      ctx.events.publish("attempt");
      return reply.send({
        topicId: topic?.id ?? null,
        topicName: topic?.name ?? null,
        correct: topic != null && guess === topic.id,
      });
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      problemsSolved?: number;
      studyDuration?: number;
      productivityScore?: number;
      date?: string;
    };
  }>("/session/:id", async (request, reply) => {
    const { date, ...rest } = request.body;
    const session = ctx.sessionService.update(request.params.id, {
      ...rest,
      date: date ? new Date(date) : undefined,
    });
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }
    return reply.send(serializeForJson({ session }));
  });

  app.delete<{ Params: { id: string } }>("/session/:id", async (request, reply) => {
    const deleted = ctx.sessionService.delete(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: "Session not found" });
    }
    return reply.status(204).send();
  });
}

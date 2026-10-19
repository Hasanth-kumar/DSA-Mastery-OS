import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problems, topics } from "@dsa/database/schema";
import { maxIntervalDaysForConfidence } from "@dsa/intelligence";
import {
  createSqliteDb,
  LLMService,
  runMigrations,
  type LLMClient,
} from "@dsa/integrations";
import { loadConfig, resetConfigCache } from "@dsa/shared";
import type { AppConfig } from "@dsa/shared";
import { createAppContext, type AppContext } from "../context.js";

const DAY = 86_400_000;

let testDbPath: string;
let config: AppConfig;
let ctx: AppContext;

function createTestCoachLLM(): LLMService {
  const client: LLMClient = {
    isConfigured: () => true,
    generate: async () => "ok",
    chat: async () => "ok",
    async *chatStream() {
      yield "ok";
    },
  };
  return new LLMService({ model: "test", openrouter: { apiKey: "test-key" } }, client);
}

function seed(dbPath: string): void {
  runMigrations(dbPath);
  const { db, sqlite } = createSqliteDb(dbPath);
  const now = Date.now();

  db.insert(topics)
    .values({
      id: "topic-a",
      name: "Graphs",
      difficulty: "Easy",
      status: "In progress",
      confidence: 20,
      revisionCount: 0,
      lastRevised: null,
      nextRevisionAt: now + 7 * DAY,
      isWeakArea: 0,
      prerequisites: null,
      updatedAt: now,
    })
    .run();

  for (const [id, name] of [
    ["problem-1", "Number of Islands"],
    ["problem-2", "Clone Graph"],
    ["problem-3", "Course Schedule"],
  ]) {
    db.insert(problems)
      .values({
        id,
        name,
        topicId: "topic-a",
        difficulty: "Easy",
        status: "Not started",
        attempts: 0,
        updatedAt: now,
      })
      .run();
  }
  sqlite.close();
}

beforeEach(() => {
  testDbPath = join(tmpdir(), `dsa-outcome-scoring-${Date.now()}-${Math.random()}.db`);
  resetConfigCache();
  process.env.SQLITE_PATH = testDbPath;
  config = loadConfig();
  seed(testDbPath);
  ctx = createAppContext(config, { coachLlm: createTestCoachLLM() });
});

afterEach(async () => {
  await ctx.close();
  try {
    rmSync(testDbPath);
  } catch {
    // ignore
  }
  delete process.env.SQLITE_PATH;
  resetConfigCache();
});

describe("outcome-based session scoring", () => {
  it("does not reward a 1-minute session once it turns out help was needed", async () => {
    const result = await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemId: "problem-1",
      studyDuration: 1,
      problemsSolved: 1,
    });
    // Provisional (no tags yet): cold, clean, fast.
    expect(result.session.productivityScore).toBe(90);

    const attempt = ctx.attemptRepo.setMistake(result.attemptId!, {
      tags: ["pattern-recall"],
      usedCoach: true,
    })!;
    await ctx.sessionService.rescoreAfterMistakeCapture(attempt);

    const session = ctx.sessionRepo.findById(result.session.id)!;
    expect(session.productivityScore).toBeLessThan(65);

    // Confidence did not climb on a session that needed help.
    const topic = ctx.topicRepo.findById("topic-a")!;
    expect(topic.confidence).toBeLessThanOrEqual(20);
  });

  it("re-applies the session from its pre-state instead of stacking on the provisional update", async () => {
    const result = await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemId: "problem-1",
      studyDuration: 5,
      problemsSolved: 1,
    });
    const afterProvisional = ctx.topicRepo.findById("topic-a")!;
    expect(afterProvisional.revisionCount).toBe(1);
    expect(afterProvisional.confidence).toBe(24); // cold + clean: +4

    const attempt = ctx.attemptRepo.setMistake(result.attemptId!, {
      tags: ["wrong-approach", "edge-case"],
      usedCoach: true,
    })!;
    await ctx.sessionService.rescoreAfterMistakeCapture(attempt);
    // Calling it again (user edits the tags) must be idempotent.
    await ctx.sessionService.rescoreAfterMistakeCapture(attempt);

    const topic = ctx.topicRepo.findById("topic-a")!;
    expect(topic.revisionCount).toBe(1); // counted once, not twice
    expect(topic.confidence).toBeLessThan(afterProvisional.confidence);
    expect(topic.confidence).toBeGreaterThanOrEqual(19);
  });

  it("does not rewind the schedule when another session happened in between", async () => {
    const a = await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemId: "problem-1",
      studyDuration: 10,
      problemsSolved: 1,
      date: new Date(Date.now() - 1000),
    });
    await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemId: "problem-2",
      studyDuration: 10,
      problemsSolved: 1,
      date: new Date(),
    });
    const before = ctx.topicRepo.findById("topic-a")!;

    const attempt = ctx.attemptRepo.setMistake(a.attemptId!, { tags: ["off-by-one"], usedCoach: true })!;
    await ctx.sessionService.rescoreAfterMistakeCapture(attempt);

    const after = ctx.topicRepo.findById("topic-a")!;
    expect(after.revisionCount).toBe(before.revisionCount);
    expect(after.nextRevisionAt?.getTime()).toBe(before.nextRevisionAt?.getTime());
    expect(after.lastRevised?.getTime()).toBe(before.lastRevised?.getTime());
  });

  it("never schedules a topic beyond what its confidence allows, however many sessions", async () => {
    for (let i = 0; i < 6; i++) {
      await ctx.sessionService.completeSession({
        topicId: "topic-a",
        problemId: ["problem-1", "problem-2", "problem-3"][i % 3],
        studyDuration: 15,
        problemsSolved: 1,
        mistakeTag: null, // smooth solve captured with the log
        date: new Date(Date.now() - (6 - i) * 1000),
      });
      const topic = ctx.topicRepo.findById("topic-a")!;
      expect(topic.sm2Interval).toBeLessThanOrEqual(maxIntervalDaysForConfidence(topic.confidence));
    }
  });
});

describe("focus plan on the plan endpoint", () => {
  it("builds a normal day with a new-problem block and a log block for a fresh learner", async () => {
    const plan = await ctx.planService.generateTodaysPlan();
    expect(plan.focus).toBeDefined();
    expect(plan.focus!.mode).toBe("normal");
    expect(plan.focus!.week.target).toBe(5);
    const kinds = plan.focus!.blocks.map((b) => b.kind);
    expect(kinds).toContain("learn");
    expect(kinds[kinds.length - 1]).toBe("log");
  });

  it("switches to done after a session is logged today", async () => {
    await ctx.planService.generateTodaysPlan(); // warm the cache
    await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemId: "problem-1",
      studyDuration: 20,
      problemsSolved: 1,
    });
    const plan = await ctx.planService.generateTodaysPlan();
    expect(plan.focus!.mode).toBe("done");
    expect(plan.focus!.week.done).toBeGreaterThanOrEqual(1);
  });

  it("restarts small after a long gap", async () => {
    await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemId: "problem-1",
      studyDuration: 20,
      problemsSolved: 1,
      date: new Date(Date.now() - 10 * DAY),
    });
    const plan = await ctx.planService.generateTodaysPlan();
    expect(plan.focus!.mode).toBe("reentry");
    expect(plan.focus!.gapDays).toBeGreaterThanOrEqual(9);
    expect(plan.focus!.blocks.filter((b) => b.kind !== "log")).toHaveLength(1);
  });
});

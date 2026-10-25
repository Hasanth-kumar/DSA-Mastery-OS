import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problems, topics } from "@dsa/database/schema";
import {
  createSqliteDb,
  LLMService,
  runMigrations,
  type LLMClient,
} from "@dsa/integrations";
import { FEATURE_FLAGS_OFF, loadConfig, resetConfigCache } from "@dsa/shared";
import type { AppConfig } from "@dsa/shared";
import { createAppContext, type AppContext } from "../context.js";

let testDbPath: string;
let config: AppConfig;
let ctx: AppContext;

const MS_PER_DAY = 86_400_000;

function createTestCoachLLM(): LLMService {
  const reply = "Try breaking the problem into smaller subproblems and check edge cases.";
  const client: LLMClient = {
    isConfigured: () => true,
    generate: async () => "Structured coaching response for tests.",
    chat: async () => reply,
    async *chatStream() {
      yield reply;
    },
  };
  return new LLMService(
    { model: "test", openrouter: { apiKey: "test-key" } },
    client,
  );
}

function seedTopic(dbPath: string, nextRevisionAt: number): void {
  runMigrations(dbPath);
  const { db, sqlite } = createSqliteDb(dbPath);
  const now = Date.now();

  db.insert(topics)
    .values({
      id: "topic-a",
      name: "Arrays",
      difficulty: "Easy",
      status: "In progress",
      confidence: 40,
      revisionCount: 2,
      lastRevised: now - 7 * MS_PER_DAY,
      nextRevisionAt,
      isWeakArea: 1,
      prerequisites: null,
      updatedAt: now,
    })
    .run();

  db.insert(problems)
    .values({
      id: "problem-1",
      name: "Two Sum",
      topicId: "topic-a",
      difficulty: "Easy",
      status: "Not started",
      attempts: 0,
      updatedAt: now,
    })
    .run();

  sqlite.close();
}

beforeEach(() => {
  testDbPath = join(tmpdir(), `dsa-session-srs-${Date.now()}.db`);
  resetConfigCache();
  process.env.SQLITE_PATH = testDbPath;
  // DSA_DB_PATH wins over SQLITE_PATH and a worktree .env sets it; pin both so
  // loadConfig() never resolves to data/dev/dsa.dev.db.
  process.env.DSA_DB_PATH = testDbPath;
  // These cases pin the SM-2 (flag-off) behavior; the worktree .env turns the
  // overhaul flags on, so pin them off. Flag-on cases: fsrs-topic-signals.test.ts.
  config = { ...loadConfig(), flags: { ...FEATURE_FLAGS_OFF } };
  seedTopic(testDbPath, Date.now() - 2 * MS_PER_DAY);
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
  delete process.env.DSA_DB_PATH;
  resetConfigCache();
});

describe("SessionService single SRS path (Phase 1)", () => {
  it("skipped warm-up: session logging reschedules the topic once", async () => {
    const before = ctx.topicRepo.findById("topic-a")!;
    const beforeNext = before.nextRevisionAt?.getTime() ?? null;

    await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemsSolved: 1,
      studyDuration: 45,
      pushToNotion: false,
    });

    const after = ctx.topicRepo.findById("topic-a")!;
    const afterNext = after.nextRevisionAt?.getTime() ?? null;

    expect(afterNext).not.toBe(beforeNext);
    expect(after.revisionCount).toBe(before.revisionCount + 1);
    expect(after.confidence).toBeGreaterThan(before.confidence);
  });

  it("graded warm-up: only warm-up moves nextRevisionAt; session preserves it", async () => {
    const before = ctx.topicRepo.findById("topic-a")!;
    const beforeNext = before.nextRevisionAt?.getTime() ?? null;

    const warmup = ctx.sessionService.applyRecallQuality("topic-a", 4);
    const afterWarmup = ctx.topicRepo.findById("topic-a")!;
    const warmupNext = afterWarmup.nextRevisionAt?.getTime() ?? null;

    expect(warmupNext).not.toBe(beforeNext);
    expect(warmup.nextRevisionAt).toBe(afterWarmup.nextRevisionAt?.toISOString());

    await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemsSolved: 1,
      studyDuration: 30,
      pushToNotion: false,
      warmupGraded: true,
    });

    const afterSession = ctx.topicRepo.findById("topic-a")!;
    expect(afterSession.nextRevisionAt?.getTime()).toBe(warmupNext);
    expect(afterSession.revisionCount).toBe(afterWarmup.revisionCount);
    expect(afterSession.confidence).toBeGreaterThan(afterWarmup.confidence);
  });

  it("partial warm-up (skipped): session logging still reschedules", async () => {
    const before = ctx.topicRepo.findById("topic-a")!;
    const beforeNext = before.nextRevisionAt?.getTime() ?? null;

    await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemsSolved: 1,
      studyDuration: 20,
      pushToNotion: false,
      warmupGraded: false,
    });

    const after = ctx.topicRepo.findById("topic-a")!;
    expect(after.nextRevisionAt?.getTime()).not.toBe(beforeNext);
    expect(after.revisionCount).toBe(before.revisionCount + 1);
  });

  it("graded warm-up without client flag: server flag prevents double reschedule", async () => {
    ctx.sessionService.applyRecallQuality("topic-a", 3);
    const afterWarmup = ctx.topicRepo.findById("topic-a")!;
    const warmupNext = afterWarmup.nextRevisionAt?.getTime() ?? null;

    await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemsSolved: 1,
      studyDuration: 25,
      pushToNotion: false,
    });

    const afterSession = ctx.topicRepo.findById("topic-a")!;
    expect(afterSession.nextRevisionAt?.getTime()).toBe(warmupNext);
    expect(afterSession.revisionCount).toBe(afterWarmup.revisionCount);
  });
});

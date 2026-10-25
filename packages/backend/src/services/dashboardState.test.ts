/**
 * P0 acceptance bar — "Dashboard state matches backend state after refresh."
 *
 * Guards the last P0 bar item: after a session reschedules a topic, the value
 * the API/dashboard reads back (today's plan + the topic row) must reflect the
 * SAME `nextRevisionAt` the session produced — no stale mirror cache, no plan
 * computed from pre-session state. (Largely green today; this locks it as a
 * regression and pairs with the Phase 1 single-SRS-path tests.)
 */
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
import { loadConfig, resetConfigCache } from "@dsa/shared";
import type { AppConfig } from "@dsa/shared";
import { createAppContext, type AppContext } from "../context.js";

const MS_PER_DAY = 86_400_000;
let testDbPath: string;
let config: AppConfig;
let ctx: AppContext;

function createTestCoachLLM(): LLMService {
  const reply = "Break the problem down and check edge cases.";
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

function seedDueTopic(dbPath: string): void {
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
      nextRevisionAt: now - 2 * MS_PER_DAY, // overdue → due today
      isWeakArea: 0,
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
  testDbPath = join(tmpdir(), `dsa-dashboard-state-${Date.now()}.db`);
  resetConfigCache();
  process.env.SQLITE_PATH = testDbPath;
  // DSA_DB_PATH wins over SQLITE_PATH and a worktree .env sets it; pin both so
  // loadConfig() never resolves to data/dev/dsa.dev.db.
  process.env.DSA_DB_PATH = testDbPath;
  config = loadConfig();
  seedDueTopic(testDbPath);
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

describe("dashboard state matches backend after a session (P0)", () => {
  it("the persisted topic row reflects the session's nextRevisionAt", async () => {
    const result = await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemsSolved: 1,
      studyDuration: 45,
      pushToNotion: false,
    });

    const persisted = ctx.topicRepo.findById("topic-a")!;
    expect(persisted.nextRevisionAt?.toISOString() ?? null).toBe(result.nextRevisionAt);
  });

  it("today's plan is recomputed (cache invalidated), not served stale", async () => {
    // Topic is overdue → appears in the plan before the session.
    const before = await ctx.planService.generateTodaysPlan();
    const inPlanBefore =
      before.primaryTopic.id === "topic-a" ||
      before.revisionTopics.some((t) => t.id === "topic-a");
    expect(inPlanBefore).toBe(true);

    const result = await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemsSolved: 1,
      studyDuration: 60,
      pushToNotion: false,
    });

    // After rescheduling forward, the plan must reflect the new schedule date —
    // proving invalidateTodaysPlan + the mirror cache refreshed.
    const after = await ctx.planService.generateTodaysPlan();
    const topicInAfter = [after.primaryTopic, ...after.revisionTopics].find(
      (t) => t.id === "topic-a",
    );
    if (topicInAfter) {
      expect(topicInAfter.nextRevisionAt?.toISOString() ?? null).toBe(
        result.nextRevisionAt,
      );
    }
  });
});

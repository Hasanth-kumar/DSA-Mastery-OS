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

let testDbPath: string;
let config: AppConfig;
let ctx: AppContext;

function createTestCoachLLM(): LLMService {
  const reply = "Hint for tests.";
  const client: LLMClient = {
    isConfigured: () => true,
    generate: async () => "ok",
    chat: async () => reply,
    async *chatStream() {
      yield reply;
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
      name: "Arrays",
      difficulty: "Easy",
      status: "In progress",
      confidence: 40,
      revisionCount: 0,
      lastRevised: null,
      nextRevisionAt: now + 7 * 86_400_000,
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
  testDbPath = join(tmpdir(), `dsa-mistake-status-${Date.now()}.db`);
  resetConfigCache();
  process.env.SQLITE_PATH = testDbPath;
  // DSA_DB_PATH wins over SQLITE_PATH and a worktree .env sets it; pin both so
  // loadConfig() never resolves to data/dev/dsa.dev.db.
  process.env.DSA_DB_PATH = testDbPath;
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
  delete process.env.DSA_DB_PATH;
  resetConfigCache();
});

describe("problem status after mistake capture", () => {
  it("defers Solved until mistake capture — tags → Revision needed", async () => {
    const result = await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemId: "problem-1",
      problemsSolved: 1,
      studyDuration: 30,
      pushToNotion: false,
    });

    expect(result.attemptId).toBeDefined();
    let problem = ctx.problemRepo.findById("problem-1")!;
    expect(problem.status).toBe("Not started");
    expect(problem.attempts).toBe(1);

    ctx.attemptRepo.setMistake(result.attemptId!, { tags: ["edge-case"] });
    await ctx.sessionService.finalizeProblemAfterMistake("problem-1", ["edge-case"]);

    problem = ctx.problemRepo.findById("problem-1")!;
    expect(problem.status).toBe("Revision needed");
  });

  it("smooth solve (no tags) → Solved", async () => {
    const result = await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemId: "problem-1",
      problemsSolved: 1,
      studyDuration: 25,
      pushToNotion: false,
    });

    ctx.attemptRepo.setMistake(result.attemptId!, { tags: [] });
    await ctx.sessionService.finalizeProblemAfterMistake("problem-1", []);

    const problem = ctx.problemRepo.findById("problem-1")!;
    expect(problem.status).toBe("Solved");
  });

  it("repair backfills Solved problems whose latest attempt has mistake tags", async () => {
    await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemId: "problem-1",
      problemsSolved: 1,
      studyDuration: 20,
      pushToNotion: false,
    });
    const [attempt] = ctx.attemptRepo.findByProblemId("problem-1", 1);
    ctx.attemptRepo.setMistake(attempt.id, { tags: ["logic"] });
    ctx.problemRepo.update("problem-1", { status: "Solved" });

    ctx.syncMetaRepo.set("problem_status_mistake_repair_v1", "");
    const repaired = await ctx.sessionService.repairProblemStatusesFromAttempts();

    expect(repaired).toBe(1);
    expect(ctx.problemRepo.findById("problem-1")!.status).toBe("Revision needed");
  });

  it("WhatsApp path marks Solved immediately without mistake capture", async () => {
    await ctx.sessionService.completeSession({
      topicId: "topic-a",
      problemId: "problem-1",
      problemsSolved: 1,
      studyDuration: 15,
      pushToNotion: false,
      deferProblemStatus: false,
    });

    expect(ctx.problemRepo.findById("problem-1")!.status).toBe("Solved");
  });
});

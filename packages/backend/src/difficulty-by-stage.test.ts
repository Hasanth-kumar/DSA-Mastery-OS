/**
 * P3.5 — suggestions follow the stage table: learning → Easy then Medium,
 * practicing → Medium (Easy after a could-not-solve), nearest difficulty when
 * a slot has nothing left.
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problemAttempts, problems, topics } from "@dsa/database/schema";
import { createSqliteDb, runMigrations } from "@dsa/integrations";
import { loadConfig, resetConfigCache } from "@dsa/shared";
import type { AppConfig } from "@dsa/shared";
import { createAppContext, type AppContext } from "./context.js";
import { ProblemSuggestionService } from "./services/ProblemSuggestionService.js";

const DAY = 86_400_000;
let testDbPath: string;
let config: AppConfig;
let ctx: AppContext;

function seed(dbPath: string): void {
  runMigrations(dbPath);
  const { db, sqlite } = createSqliteDb(dbPath);
  const now = Date.now();
  db.insert(topics)
    .values([
      { id: "t-new", name: "Sliding Window", difficulty: "Easy", status: "Not started", confidence: 0, updatedAt: now },
      { id: "t-prac", name: "Two Pointers", difficulty: "Easy", status: "In progress", confidence: 20, updatedAt: now },
    ])
    .run();
  db.insert(problems)
    .values([
      { id: "n-e1", name: "Max Avg Subarray", topicId: "t-new", difficulty: "Easy", status: "Not started", updatedAt: now },
      { id: "n-e2", name: "Contains Duplicate II", topicId: "t-new", difficulty: "Easy", status: "Not started", updatedAt: now },
      { id: "n-m1", name: "Longest Substring", topicId: "t-new", difficulty: "Medium", status: "Not started", updatedAt: now },
      { id: "p-e1", name: "Valid Palindrome", topicId: "t-prac", difficulty: "Easy", status: "Revision needed", attempts: 2, updatedAt: now },
      { id: "p-e2", name: "Merge Sorted Array", topicId: "t-prac", difficulty: "Easy", status: "Not started", updatedAt: now },
      { id: "p-m1", name: "3Sum", topicId: "t-prac", difficulty: "Medium", status: "Not started", updatedAt: now },
      { id: "p-m2", name: "Container With Most Water", topicId: "t-prac", difficulty: "Medium", status: "Solved", attempts: 2, updatedAt: now },
    ])
    .run();
  db.insert(problemAttempts)
    .values([
      { id: "a1", problemId: "p-m2", topicId: "t-prac", solvedAt: now - 3 * DAY, timeTaken: 40, mistakeTag: "[]", kind: "solve", createdAt: now },
    ])
    .run();
  sqlite.close();
}

beforeEach(() => {
  resetConfigCache();
  testDbPath = join(tmpdir(), `dsa-difficulty-stage-${Date.now()}-${Math.random()}.db`);
  process.env.SQLITE_PATH = testDbPath;
  process.env.DSA_DB_PATH = testDbPath;
  seed(testDbPath);
  config = loadConfig("/nonexistent/.env");
  config = { ...config, sqlite: { path: testDbPath }, schedulers: { ...config.schedulers, enabled: false } };
  ctx = createAppContext(config);
});

afterEach(async () => {
  await ctx.close();
  resetConfigCache();
  try {
    rmSync(testDbPath);
  } catch {
    // ignore
  }
  delete process.env.SQLITE_PATH;
  delete process.env.DSA_DB_PATH;
});

function suggest(topicId: string) {
  const topic = ctx.mirrorCache.getTopicById(topicId)!;
  const rec = ctx.intelligence.getDifficultyRecommendation(topic);
  return { rec, picks: new ProblemSuggestionService(ctx.problemRepo).selectForTopic(topic, rec).map((s) => s.difficulty) };
}

describe("difficulty by stage (P3.5)", () => {
  it("learning: one Easy, then a standard Medium", () => {
    const { rec, picks } = suggest("t-new");
    expect(rec.stage).toBe("learning");
    expect(picks).toEqual(["Easy", "Medium"]);
  });

  it("practicing: Medium, then the nearest difficulty when Medium runs out", () => {
    const { rec, picks } = suggest("t-prac"); // 4 attempts, confidence 20
    expect(rec.stage).toBe("practicing");
    expect(rec.primary).toBe("Medium");
    expect(picks).toEqual(["Medium", "Easy"]);
  });

  it("practicing after a could-not-solve drops to Easy", () => {
    const now = Date.now();
    ctx.attemptRepo.create({
      problemId: "p-m1",
      topicId: "t-prac",
      solvedAt: new Date(now),
      timeTaken: 45,
      mistakeTag: JSON.stringify(["could-not-solve"]),
    });
    ctx.mirrorCache.invalidate();
    const { rec, picks } = suggest("t-prac");
    expect(rec.primary).toBe("Easy");
    expect(picks[0]).toBe("Easy");
  });
});

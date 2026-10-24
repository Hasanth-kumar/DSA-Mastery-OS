/**
 * P3.2 — every `Revision needed` problem has a `problem_reviews` row.
 * Backfill adds the missing ones; revert removes exactly those, unless they
 * were reviewed in the meantime.
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problemAttempts, problemReviews, problems, topics } from "@dsa/database/schema";
import { createSqliteDb, runMigrations } from "@dsa/integrations";
import { loadConfig, resetConfigCache } from "@dsa/shared";
import type { AppConfig } from "@dsa/shared";
import { createAppContext, type AppContext } from "./context.js";

const DAY = 86_400_000;
let testDbPath: string;
let config: AppConfig;
let ctx: AppContext;

function seed(dbPath: string): void {
  runMigrations(dbPath);
  const { db, sqlite } = createSqliteDb(dbPath);
  const now = Date.now();
  db.insert(topics)
    .values([{ id: "t1", name: "Sliding Window", difficulty: "Easy", status: "In progress", confidence: 20, updatedAt: now }])
    .run();
  db.insert(problems)
    .values([
      // Revision needed set in Notion, no attempts recorded.
      { id: "p-notion", name: "Max Avg Subarray", topicId: "t1", difficulty: "Easy", status: "Revision needed", updatedAt: now - 30 * DAY },
      // Revision needed with a tagged attempt, but never admitted.
      { id: "p-missed", name: "N-ary Depth", topicId: "t1", difficulty: "Easy", status: "Revision needed", updatedAt: now },
      // Already pooled.
      { id: "p-pooled", name: "Longest Substring", topicId: "t1", difficulty: "Medium", status: "Revision needed", updatedAt: now },
      { id: "p-new", name: "Fruit Into Baskets", topicId: "t1", difficulty: "Medium", status: "Not started", updatedAt: now },
    ])
    .run();
  db.insert(problemAttempts)
    .values([
      {
        id: "a1", problemId: "p-missed", topicId: "t1", solvedAt: now - 60 * DAY, timeTaken: 57,
        mistakeTag: JSON.stringify(["wrong-approach"]), usedCoach: 1, hintCount: 0, kind: "solve", createdAt: now - 60 * DAY,
      },
    ])
    .run();
  db.insert(problemReviews)
    .values([{ problemId: "p-pooled", admittedAt: now, admissionReason: "mistake", due: now + DAY, createdAt: now, updatedAt: now }])
    .run();
  sqlite.close();
}

beforeEach(() => {
  resetConfigCache();
  testDbPath = join(tmpdir(), `dsa-pool-backfill-${Date.now()}-${Math.random()}.db`);
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

describe("re-solve pool backfill (P3.2)", () => {
  it("plans rows for Revision needed problems missing from the pool, oldest first", () => {
    const now = Date.now();
    const items = ctx.problemReviewService.planRevisionNeededBackfill(now);
    // p-missed was last attempted 60 days ago; p-notion last updated 30 days ago.
    expect(items.map((i) => [i.problemId, i.reason])).toEqual([
      ["p-missed", "mistake"],
      ["p-notion", "mistake"],
    ]);
    expect(items.map((i) => Math.round((i.due - now) / DAY))).toEqual([0, 1]);
  });

  it("applies the plan so every Revision needed problem has a row, and a re-plan is empty", () => {
    const items = ctx.problemReviewService.planRevisionNeededBackfill();
    expect(ctx.problemReviewService.applyRevisionNeededBackfill(items).sort()).toEqual(["p-missed", "p-notion"]);
    for (const p of ctx.problemRepo.findAll().filter((p) => p.status === "Revision needed")) {
      expect(ctx.problemReviewRepo.findById(p.id)).not.toBeNull();
    }
    expect(ctx.problemReviewService.planRevisionNeededBackfill()).toEqual([]);
    expect(ctx.problemReviewRepo.findById("p-new")).toBeNull();
  });

  it("revert removes untouched backfilled rows and keeps reviewed ones and pre-existing rows", () => {
    const items = ctx.problemReviewService.planRevisionNeededBackfill();
    ctx.problemReviewService.applyRevisionNeededBackfill(items);
    ctx.problemReviewRepo.update("p-missed", { reps: 1, lastReview: Date.now() });

    const result = ctx.problemReviewService.revertRevisionNeededBackfill(["p-notion", "p-missed"]);
    expect(result).toEqual({ removed: ["p-notion"], kept: ["p-missed"] });
    expect(ctx.problemReviewRepo.findById("p-notion")).toBeNull();
    expect(ctx.problemReviewRepo.findById("p-missed")).not.toBeNull();
    expect(ctx.problemReviewRepo.findById("p-pooled")).not.toBeNull();
  });
});

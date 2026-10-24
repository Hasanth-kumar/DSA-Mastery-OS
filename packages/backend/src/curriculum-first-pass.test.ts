/**
 * P3.1 — one definition of "covered" vs "remaining".
 *
 * A topic whose problems are all `Revision needed` is first-pass complete,
 * and the plan never falls back to the "add problems in Notion" placeholder
 * while another curriculum topic still has `Not started` problems.
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problems, topics } from "@dsa/database/schema";
import { createSqliteDb, runMigrations } from "@dsa/integrations";
import { loadConfig, resetConfigCache } from "@dsa/shared";
import type { AppConfig } from "@dsa/shared";
import { buildApp } from "./app.js";
import { createAppContext, type AppContext } from "./context.js";

let testDbPath: string;
let config: AppConfig;
let ctx: AppContext;

function seedTestDb(dbPath: string): void {
  runMigrations(dbPath);
  const { db, sqlite } = createSqliteDb(dbPath);
  const now = Date.now();

  db.insert(topics)
    .values([
      { id: "topic-bs", name: "Binary Search", difficulty: "Easy", status: "In progress", confidence: 45, updatedAt: now },
      { id: "topic-trees", name: "Trees", difficulty: "Easy", status: "Not started", confidence: 0, updatedAt: now },
    ])
    .run();

  db.insert(problems)
    .values([
      // Binary Search: every problem worked once, mistakes flagged.
      { id: "p-bs1", name: "Binary Search", topicId: "topic-bs", difficulty: "Easy", status: "Revision needed", updatedAt: now },
      { id: "p-bs2", name: "Search Insert Position", topicId: "topic-bs", difficulty: "Easy", status: "Revision needed", updatedAt: now },
      { id: "p-bs3", name: "Koko Eating Bananas", topicId: "topic-bs", difficulty: "Medium", status: "Revision needed", updatedAt: now },
      // Trees: still has first-pass work.
      { id: "p-t1", name: "Maximum Depth of Binary Tree", topicId: "topic-trees", difficulty: "Easy", status: "Not started", updatedAt: now },
      { id: "p-t2", name: "Same Tree", topicId: "topic-trees", difficulty: "Easy", status: "Revision needed", updatedAt: now },
      { id: "p-t3", name: "Invert Binary Tree", topicId: "topic-trees", difficulty: "Easy", status: null, updatedAt: now },
    ])
    .run();

  sqlite.close();
}

beforeEach(() => {
  resetConfigCache();
  testDbPath = join(tmpdir(), `dsa-first-pass-${Date.now()}-${Math.random()}.db`);
  process.env.SQLITE_PATH = testDbPath;
  process.env.ENABLE_SCHEDULERS = "false";
  seedTestDb(testDbPath);
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
});

describe("curriculum first pass (P3.1)", () => {
  it("counts a topic whose problems are all Revision needed as complete", () => {
    const counts = ctx.curriculumService.buildProblemCounts();
    expect(counts.get("topic-bs")).toEqual({ total: 3, unsolved: 0 });
    expect(counts.get("topic-trees")).toEqual({ total: 3, unsolved: 2 });
  });

  it("suggests only remaining first-pass problems, never Revision needed", () => {
    const remaining = ctx.problemRepo
      .findRemainingFirstPassByTopicId("topic-trees", { limit: 5 })
      .map((p) => p.id)
      .sort();
    expect(remaining).toEqual(["p-t1", "p-t3"]);
    expect(ctx.problemRepo.findRemainingFirstPassByTopicId("topic-bs")).toEqual([]);
  });

  it("moves past the covered topic and serves real problems, not the Notion placeholder", async () => {
    const app = buildApp(config, ctx);
    const response = await app.inject({ method: "GET", url: "/api/plan/today" });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.primaryTopic.id).toBe("topic-trees");
    expect(body.suggestedProblems.length).toBeGreaterThan(0);
    for (const s of body.suggestedProblems as { problemId: string; name: string }[]) {
      expect(s.name).not.toContain("add problems in Notion");
      expect(["p-t1", "p-t3"]).toContain(s.problemId);
    }
    await app.close();
  });
});

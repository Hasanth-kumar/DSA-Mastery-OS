/**
 * P3.4 — PlanService picks the primary topic through the ranked selector:
 * pin > current topic with first-pass work left > highest-priority ready topic.
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problems, topics } from "@dsa/database/schema";
import { createSqliteDb, runMigrations } from "@dsa/integrations";
import { loadConfig, resetConfigCache } from "@dsa/shared";
import type { AppConfig } from "@dsa/shared";
import { createAppContext, type AppContext } from "./context.js";

let testDbPath: string;
let config: AppConfig;
let ctx: AppContext;

function seed(dbPath: string): void {
  runMigrations(dbPath);
  const { db, sqlite } = createSqliteDb(dbPath);
  const now = Date.now();
  db.insert(topics)
    .values([
      { id: "t-bs", name: "Binary Search", difficulty: "Easy", status: "In progress", confidence: 70, lastRevised: now, updatedAt: now },
      { id: "t-greedy", name: "Greedy Sorting", difficulty: "Easy", status: "In progress", confidence: 10, updatedAt: now },
    ])
    .run();
  db.insert(problems)
    .values([
      { id: "p-bs1", name: "Binary Search", topicId: "t-bs", difficulty: "Easy", status: "Not started", updatedAt: now },
      { id: "p-bs2", name: "Search Insert", topicId: "t-bs", difficulty: "Easy", status: "Solved", updatedAt: now },
      { id: "p-g1", name: "Assign Cookies", topicId: "t-greedy", difficulty: "Easy", status: "Not started", updatedAt: now },
    ])
    .run();
  sqlite.close();
}

beforeEach(() => {
  resetConfigCache();
  testDbPath = join(tmpdir(), `dsa-primary-topic-${Date.now()}-${Math.random()}.db`);
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

const plan = () => ctx.planService.buildPlan(ctx.topicRepo.findAll());

describe("primary topic selection (P3.4)", () => {
  it("picks the higher-priority ready topic, not the first label, and remembers it", () => {
    const first = plan();
    expect(first.primaryTopic.id).toBe("t-greedy");
    expect(first.reasoning).toContain("highest priority");
    expect(ctx.syncMetaRepo.get("curriculum_current_topic_id")).toBe("t-greedy");
  });

  it("stays on the remembered topic while it has first-pass work left", () => {
    ctx.syncMetaRepo.set("curriculum_current_topic_id", "t-bs");
    const p = plan();
    expect(p.primaryTopic.id).toBe("t-bs");
    expect(p.reasoning).toContain("Continuing Binary Search");
  });

  it("moves on once the remembered topic's first pass is complete", () => {
    ctx.syncMetaRepo.set("curriculum_current_topic_id", "t-bs");
    ctx.problemRepo.update("p-bs1", { status: "Revision needed" });
    const p = plan();
    expect(p.primaryTopic.id).toBe("t-greedy");
    expect(ctx.syncMetaRepo.get("curriculum_current_topic_id")).toBe("t-greedy");
  });

  it("a manual pin still wins and is not stored as the current topic", () => {
    ctx.syncMetaRepo.set("curriculum_current_topic_id", "t-greedy");
    ctx.curriculumService.setActiveTopicId("t-bs");
    expect(plan().primaryTopic.id).toBe("t-bs");
    expect(ctx.syncMetaRepo.get("curriculum_current_topic_id")).toBe("t-greedy");
  });
});

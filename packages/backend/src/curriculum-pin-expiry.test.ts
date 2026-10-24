/**
 * P3.3 — the manual curriculum pin is visible and expires.
 * It ends when the pinned topic's first pass is complete, or 7 days after it
 * was set (D2), whichever comes first. The reason is recorded in sync_meta.
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
      { id: "t-bs", name: "Binary Search", difficulty: "Easy", status: "In progress", confidence: 40, updatedAt: now },
      { id: "t-greedy", name: "Greedy Sorting", difficulty: "Easy", status: "In progress", confidence: 14, updatedAt: now },
      { id: "t-fs", name: "Fast & Slow Pointers", difficulty: "Easy", status: "In progress", confidence: 30, updatedAt: now },
    ])
    .run();
  db.insert(problems)
    .values([
      { id: "p-bs1", name: "Binary Search", topicId: "t-bs", difficulty: "Easy", status: "Not started", updatedAt: now },
      { id: "p-g1", name: "Partition Labels", topicId: "t-greedy", difficulty: "Medium", status: "Not started", updatedAt: now },
      { id: "p-g2", name: "Assign Cookies", topicId: "t-greedy", difficulty: "Easy", status: "Revision needed", updatedAt: now },
      // Fast & Slow: first pass complete (every problem covered).
      { id: "p-f1", name: "Linked List Cycle", topicId: "t-fs", difficulty: "Easy", status: "Revision needed", updatedAt: now },
      { id: "p-f2", name: "Happy Number", topicId: "t-fs", difficulty: "Easy", status: "Solved", updatedAt: now },
    ])
    .run();
  sqlite.close();
}

beforeEach(() => {
  resetConfigCache();
  testDbPath = join(tmpdir(), `dsa-pin-expiry-${Date.now()}-${Math.random()}.db`);
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

async function getPlan() {
  const app = buildApp(config, ctx);
  const res = await app.inject({ method: "GET", url: "/api/plan/today" });
  await app.close();
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe("curriculum pin (P3.3)", () => {
  it("a fresh pin is honoured and the plan reports when it ends", async () => {
    const setAt = Date.now() - 2 * DAY;
    ctx.curriculumService.setActiveTopicId("t-greedy", setAt);
    const plan = await getPlan();
    expect(plan.primaryTopic.id).toBe("t-greedy");
    expect(plan.curriculum.activeTopicId).toBe("t-greedy");
    expect(plan.curriculum.pinExpiresAt).toBe(setAt + 7 * DAY);
  });

  it("expires after 7 days and the curriculum takes over", async () => {
    ctx.curriculumService.setActiveTopicId("t-greedy", Date.now() - 7 * DAY - 1000);
    const plan = await getPlan();
    expect(plan.primaryTopic.id).toBe("t-bs");
    expect(plan.curriculum.activeTopicId).toBeNull();
    expect(ctx.curriculumService.getActiveTopicId()).toBeFalsy();
    expect(ctx.curriculumService.getLastPinExpiry()).toMatchObject({ topicId: "t-greedy", reason: "max-age" });
  });

  it("expires as soon as the pinned topic's first pass is complete", async () => {
    ctx.curriculumService.setActiveTopicId("t-fs", Date.now());
    const plan = await getPlan();
    expect(plan.primaryTopic.id).not.toBe("t-fs");
    expect(ctx.curriculumService.getLastPinExpiry()).toMatchObject({ topicId: "t-fs", reason: "first-pass-complete" });
  });

  it("a pin from before P3.3 (no date) starts its 7-day clock instead of expiring", async () => {
    ctx.syncMetaRepo.set("curriculum_active_topic_id", "t-greedy");
    const before = Date.now();
    const plan = await getPlan();
    expect(plan.primaryTopic.id).toBe("t-greedy");
    const pinnedAt = ctx.curriculumService.getPinnedAt();
    expect(pinnedAt).not.toBeNull();
    expect(pinnedAt!).toBeGreaterThanOrEqual(before);
    expect(plan.curriculum.pinExpiresAt).toBe(pinnedAt! + 7 * DAY);
  });

  it("unpinning through the API clears the pin and its date", async () => {
    ctx.curriculumService.setActiveTopicId("t-greedy");
    const app = buildApp(config, ctx);
    const res = await app.inject({ method: "PUT", url: "/api/curriculum/active", payload: { topicId: null } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(ctx.curriculumService.getActiveTopicId()).toBeFalsy();
    expect(ctx.curriculumService.getPinnedAt()).toBeNull();
    expect(ctx.curriculumService.getLastPinExpiry()).toBeNull();
  });
});

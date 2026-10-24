/**
 * P4.3 — with `hideTopicRevision` on, the plan has no topic revision queue:
 * no revision topics or problems (F1), no 25 minutes per revision topic (F2),
 * and no deferral write to `topics.next_revision_at` (F3). Flag off keeps the
 * SM-2 queue, its budget and its catch-up deferral.
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problems, topics } from "@dsa/database/schema";
import { createSqliteDb, runMigrations } from "@dsa/integrations";
import { FEATURE_FLAGS_OFF, loadConfig, resetConfigCache } from "@dsa/shared";
import type { AppConfig } from "@dsa/shared";
import { createAppContext, type AppContext } from "./context.js";

const DAY = 86_400_000;
let testDbPath: string;
let base: AppConfig;
const open: AppContext[] = [];

function seed(dbPath: string): void {
  runMigrations(dbPath);
  const { db, sqlite } = createSqliteDb(dbPath);
  const now = Date.now();
  const topic = (id: string, name: string, dueInDays: number) => ({
    id,
    name,
    difficulty: "Medium" as const,
    status: "In progress" as const,
    confidence: 60,
    revisionCount: 2,
    lastRevised: now - 20 * DAY,
    nextRevisionAt: now + dueInDays * DAY,
    isWeakArea: 0,
    updatedAt: now,
  });
  db.insert(topics)
    .values([
      topic("t-primary", "Arrays", 5),
      // Four SM-2-due topics (> the tolerance of 3): the 2/day cap keeps two
      // and defers the other two.
      topic("t-b", "Sorting", -10),
      topic("t-c", "Graphs", -5),
      topic("t-d", "Heaps", -2),
      topic("t-e", "Tries", -1),
    ])
    .run();
  db.insert(problems)
    .values([
      { id: "p-a", name: "Two Sum", topicId: "t-primary", difficulty: "Easy", status: "Not started", updatedAt: now },
      { id: "p-b", name: "Merge Intervals", topicId: "t-b", difficulty: "Medium", status: "Solved", updatedAt: now - 10 * DAY },
      { id: "p-c", name: "Course Schedule", topicId: "t-c", difficulty: "Medium", status: "Solved", updatedAt: now - 5 * DAY },
      { id: "p-d", name: "Kth Largest", topicId: "t-d", difficulty: "Medium", status: "Solved", updatedAt: now - 2 * DAY },
      { id: "p-e", name: "Implement Trie", topicId: "t-e", difficulty: "Medium", status: "Solved", updatedAt: now - 1 * DAY },
    ])
    .run();
  sqlite.close();
}

function context(hideTopicRevision: boolean): AppContext {
  const ctx = createAppContext({ ...base, flags: { ...FEATURE_FLAGS_OFF, hideTopicRevision } });
  open.push(ctx);
  ctx.curriculumService.setActiveTopicId("t-primary");
  return ctx;
}

function nextRevisionAt(ctx: AppContext, id: string): number | null {
  return ctx.topicRepo.findById(id)?.nextRevisionAt?.getTime() ?? null;
}

beforeEach(() => {
  resetConfigCache();
  testDbPath = join(tmpdir(), `dsa-hide-topic-revision-${Date.now()}-${Math.random()}.db`);
  process.env.SQLITE_PATH = testDbPath;
  process.env.DSA_DB_PATH = testDbPath;
  seed(testDbPath);
  const loaded = loadConfig("/nonexistent/.env");
  base = { ...loaded, sqlite: { path: testDbPath }, schedulers: { ...loaded.schedulers, enabled: false } };
});

afterEach(async () => {
  while (open.length) await open.pop()!.close();
  resetConfigCache();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${testDbPath}${suffix}`, { force: true });
  delete process.env.SQLITE_PATH;
  delete process.env.DSA_DB_PATH;
});

describe("hideTopicRevision in the daily plan (P4.3)", () => {
  it("flag off: SM-2 revision queue, its minutes, and the deferral write stay", async () => {
    const ctx = context(false);
    const before = ["t-d", "t-e"].map((id) => nextRevisionAt(ctx, id));
    const plan = await ctx.planService.generateTodaysPlan();

    expect(plan.primaryTopic.id).toBe("t-primary");
    expect(plan.revisionTopics.map((t) => t.id)).toEqual(["t-b", "t-c"]);
    expect(plan.revisionProblems).toHaveLength(2);
    expect(plan.revisionTotalDue).toBe(4);
    expect(plan.revisionDeferred).toBe(2);
    const after = ["t-d", "t-e"].map((id) => nextRevisionAt(ctx, id));
    expect(after[0]).toBeGreaterThan(before[0]!);
    expect(after[1]).toBeGreaterThan(before[1]!);
  });

  it("flag on: no revision lists, no deferral write, 50 fewer minutes", async () => {
    // buildPlan without rescheduleDeferred never writes, so this baseline leaves the DB alone.
    const offCtx = context(false);
    const off = offCtx.planService.buildPlan(offCtx.topicRepo.findAll());
    const ctx = context(true);
    const ids = ["t-b", "t-c", "t-d", "t-e"];
    const before = ids.map((id) => nextRevisionAt(ctx, id));
    const plan = await ctx.planService.generateTodaysPlan();

    expect(plan.primaryTopic.id).toBe("t-primary");
    expect(plan.revisionTopics).toEqual([]);
    expect(plan.revisionProblems).toEqual([]);
    expect(plan.revisionTotalDue).toBe(0);
    expect(plan.revisionDeferred).toBe(0);
    expect(ids.map((id) => nextRevisionAt(ctx, id))).toEqual(before);
    expect(off.estimatedDuration - plan.estimatedDuration).toBe(50);
  });
});

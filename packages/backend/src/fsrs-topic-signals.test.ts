/**
 * P4.1 — with `hideTopicRevision` on, topic urgency comes from due re-solves
 * (F4) and a graded warm-up no longer stops `revision_count` (F6). Flag off
 * keeps the SM-2 behavior.
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problemReviews, problems, topics } from "@dsa/database/schema";
import { computePriorityScore } from "@dsa/intelligence";
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
  db.insert(topics)
    .values([
      // SM-2 says far future, but a re-solve is 5 days overdue.
      { id: "t-due", name: "BFS", difficulty: "Easy", status: "In progress", confidence: 30, revisionCount: 2, lastRevised: now - 10 * DAY, nextRevisionAt: now + 400 * DAY, updatedAt: now },
      // SM-2 says overdue, but its only re-solve is not due for a week.
      { id: "t-calm", name: "Two Pointers", difficulty: "Easy", status: "In progress", confidence: 30, revisionCount: 2, lastRevised: now - 10 * DAY, nextRevisionAt: now - 20 * DAY, updatedAt: now },
    ])
    .run();
  db.insert(problems)
    .values([
      { id: "p-due", name: "Rotting Oranges", topicId: "t-due", difficulty: "Medium", status: "Revision needed", updatedAt: now },
      { id: "p-retired", name: "Flood Fill", topicId: "t-due", difficulty: "Easy", status: "Solved", updatedAt: now },
      { id: "p-calm", name: "3Sum", topicId: "t-calm", difficulty: "Medium", status: "Revision needed", updatedAt: now },
    ])
    .run();
  db.insert(problemReviews)
    .values([
      { problemId: "p-due", admittedAt: now - 20 * DAY, admissionReason: "mistake", due: now - 5 * DAY, createdAt: now, updatedAt: now },
      { problemId: "p-retired", admittedAt: now - 20 * DAY, admissionReason: "slow", retired: 1, due: now - 30 * DAY, createdAt: now, updatedAt: now },
      { problemId: "p-calm", admittedAt: now - 20 * DAY, admissionReason: "mistake", due: now + 7 * DAY, createdAt: now, updatedAt: now },
    ])
    .run();
  sqlite.close();
}

function context(hideTopicRevision: boolean): AppContext {
  const ctx = createAppContext({ ...base, flags: { ...FEATURE_FLAGS_OFF, hideTopicRevision } });
  open.push(ctx);
  return ctx;
}

function urgency(ctx: AppContext, topicId: string): number {
  const all = ctx.mirrorCache.getTopicStates();
  const topic = all.find((t) => t.id === topicId)!;
  return computePriorityScore(topic, new Map(all.map((t) => [t.id, t]))).breakdown.urgency;
}

beforeEach(() => {
  resetConfigCache();
  testDbPath = join(tmpdir(), `dsa-fsrs-signals-${Date.now()}-${Math.random()}.db`);
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

describe("FSRS topic signals (P4.1)", () => {
  it("flag off: urgency still follows the SM-2 date", () => {
    const ctx = context(false);
    expect(ctx.mirrorCache.getTopicById("t-due")!.resolveDueAt).toBeUndefined();
    expect(urgency(ctx, "t-due")).toBe(0);
    expect(urgency(ctx, "t-calm")).toBe(1);
  });

  it("flag on: urgency follows active due re-solves, ignoring retired ones and SM-2 dates", () => {
    const ctx = context(true);
    expect(ctx.mirrorCache.getTopicById("t-due")!.resolveDueAt).toHaveLength(1);
    expect(urgency(ctx, "t-due")).toBeGreaterThan(0.6);
    expect(urgency(ctx, "t-calm")).toBe(0);
  });

  it("flag on: a session after a graded warm-up still counts toward revision_count", async () => {
    const ctx = context(true);
    await ctx.sessionService.completeSession({
      topicId: "t-calm",
      problemsSolved: 1,
      studyDuration: 30,
      pushToNotion: false,
      warmupGraded: true,
    });
    expect(ctx.topicRepo.findById("t-calm")!.revisionCount).toBe(3);
  });

  it("flag off: a graded warm-up still skips the revision_count increment", async () => {
    const ctx = context(false);
    await ctx.sessionService.completeSession({
      topicId: "t-calm",
      problemsSolved: 1,
      studyDuration: 30,
      pushToNotion: false,
      warmupGraded: true,
    });
    expect(ctx.topicRepo.findById("t-calm")!.revisionCount).toBe(2);
  });
});

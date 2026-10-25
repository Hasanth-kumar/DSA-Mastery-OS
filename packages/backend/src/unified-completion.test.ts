/**
 * P4.2 (backend) — with `unifiedCompletion` on, a re-solve logs through the
 * same POST /api/session → PATCH /api/attempts/:id/mistake flow as a new
 * problem. The attempt records as kind "resolve"; its FSRS rating is inferred
 * at ✓ Done and redone once MistakeCapture adds tags and the help tick, so one
 * attempt is exactly one FSRS review. Flag off leaves the pool alone.
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problemAttempts, problemReviews, problems, topics } from "@dsa/database/schema";
import { createSqliteDb, runMigrations } from "@dsa/integrations";
import { FEATURE_FLAGS_OFF, loadConfig, resetConfigCache } from "@dsa/shared";
import type { AppConfig } from "@dsa/shared";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { createAppContext, type AppContext } from "./context.js";

const DAY = 86_400_000;
let testDbPath: string;
let base: AppConfig;
const open: { ctx: AppContext; app: FastifyInstance }[] = [];

function seed(dbPath: string): void {
  runMigrations(dbPath);
  const { db, sqlite } = createSqliteDb(dbPath);
  const now = Date.now();
  db.insert(topics)
    .values({ id: "t", name: "Two Pointers", difficulty: "Medium", status: "In progress", confidence: 50, revisionCount: 1, updatedAt: now })
    .run();
  db.insert(problems)
    .values([
      { id: "p-pool", name: "3Sum", topicId: "t", difficulty: "Medium", status: "Revision needed", attempts: 1, updatedAt: now },
      { id: "p-new", name: "Container With Most Water", topicId: "t", difficulty: "Medium", status: "Not started", updatedAt: now },
      // Stable and with two clean re-solves behind it: one more clean one retires it.
      { id: "p-stable", name: "Two Sum II", topicId: "t", difficulty: "Medium", status: "Solved", attempts: 3, updatedAt: now },
    ])
    .run();
  db.insert(problemReviews)
    .values([
      { problemId: "p-pool", admittedAt: now - 10 * DAY, admissionReason: "mistake", due: now - DAY, createdAt: now, updatedAt: now },
      {
        problemId: "p-stable", admittedAt: now - 200 * DAY, admissionReason: "slow", due: now - DAY,
        stability: 120, difficulty: 3, state: 2, reps: 3, lastReview: now - 120 * DAY, createdAt: now, updatedAt: now,
      },
    ])
    .run();
  db.insert(problemAttempts)
    .values([1, 2].map((n) => ({
      id: `prior-${n}`, problemId: "p-stable", topicId: "t", solvedAt: now - n * 60 * DAY,
      timeTaken: 15, mistakeTag: null, usedCoach: 0, hintCount: 0, kind: "resolve", createdAt: now,
    })))
    .run();
  sqlite.close();
}

async function setup(unifiedCompletion: boolean) {
  const config = { ...base, flags: { ...FEATURE_FLAGS_OFF, unifiedCompletion } };
  const ctx = createAppContext(config);
  const app = buildApp(config, ctx);
  open.push({ ctx, app });
  return { ctx, app };
}

async function done(app: FastifyInstance, problemId: string, minutes: number): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/session",
    payload: { topicId: "t", problemId, studyDuration: minutes, pushToNotion: false },
  });
  expect(res.statusCode).toBe(201);
  return res.json().attemptId as string;
}

async function capture(app: FastifyInstance, attemptId: string, tags: string[], usedCoach = false) {
  const res = await app.inject({
    method: "PATCH",
    url: `/api/attempts/${attemptId}/mistake`,
    payload: { tags, usedCoach },
  });
  expect(res.statusCode).toBe(200);
}

beforeEach(() => {
  resetConfigCache();
  testDbPath = join(tmpdir(), `dsa-unified-completion-${Date.now()}-${Math.random()}.db`);
  process.env.SQLITE_PATH = testDbPath;
  process.env.DSA_DB_PATH = testDbPath;
  seed(testDbPath);
  const loaded = loadConfig("/nonexistent/.env");
  base = { ...loaded, sqlite: { path: testDbPath }, schedulers: { ...loaded.schedulers, enabled: false } };
});

afterEach(async () => {
  while (open.length) {
    const { ctx, app } = open.pop()!;
    await app.close();
    await ctx.close();
  }
  resetConfigCache();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${testDbPath}${suffix}`, { force: true });
  delete process.env.SQLITE_PATH;
  delete process.env.DSA_DB_PATH;
});

describe("unified completion (P4.2 backend)", () => {
  it("a pooled problem logged on Today records a re-solve and reschedules it at ✓ Done", async () => {
    const { ctx, app } = await setup(true);
    const attemptId = await done(app, "p-pool", 15);

    expect(ctx.attemptRepo.findById(attemptId)?.kind).toBe("resolve");
    const review = ctx.problemReviewRepo.findById("p-pool")!;
    expect(review.reps).toBe(1);
    expect(review.due!).toBeGreaterThan(Date.now());
  });

  it("a fresh problem's first re-solve is due days later, not minutes (no same-day steps)", async () => {
    const { ctx, app } = await setup(true);
    await capture(app, await done(app, "p-pool", 30), []); // clean within target → good
    const review = ctx.problemReviewRepo.findById("p-pool")!;
    expect(review.due! - review.lastReview!).toBeGreaterThanOrEqual(DAY);

    const again = await done(app, "p-new", 10); // not pooled: no FSRS
    expect(ctx.attemptRepo.findById(again)?.kind).toBe("solve");
  });

  it("a smooth MistakeCapture keeps the rating and does not count a second review", async () => {
    const { ctx, app } = await setup(true);
    const attemptId = await done(app, "p-pool", 15);
    const atDone = ctx.problemReviewRepo.findById("p-pool")!;
    await capture(app, attemptId, []);
    const after = ctx.problemReviewRepo.findById("p-pool")!;

    expect(after.reps).toBe(1);
    expect(after.due).toBe(atDone.due);
    expect(after.stability).toBe(atDone.stability);
    expect(ctx.problemRepo.findById("p-pool")?.status).toBe("Solved");
  });

  it("tags and the help tick redo the rating from the pre-attempt state", async () => {
    const { ctx, app } = await setup(true);
    const attemptId = await done(app, "p-pool", 15); // fast → easy, provisionally
    const atDone = ctx.problemReviewRepo.findById("p-pool")!;
    await capture(app, attemptId, ["wrong-approach"], true); // help + wrong approach → again
    const after = ctx.problemReviewRepo.findById("p-pool")!;

    expect(after.reps).toBe(1);
    expect(after.due!).toBeLessThan(atDone.due!);
    expect(ctx.problemRepo.findById("p-pool")?.status).toBe("Revision needed");
  });

  it("a slow solve schedules sooner than a fast one", async () => {
    const fast = await setup(true);
    await capture(fast.app, await done(fast.app, "p-pool", 15), []);
    const fastDue = fast.ctx.problemReviewRepo.findById("p-pool")!.due!;
    // Fresh DB for the slow case.
    while (open.length) {
      const { ctx, app } = open.pop()!;
      await app.close();
      await ctx.close();
    }
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${testDbPath}${suffix}`, { force: true });
    seed(testDbPath);
    const slow = await setup(true);
    await capture(slow.app, await done(slow.app, "p-pool", 60), []);
    expect(slow.ctx.problemReviewRepo.findById("p-pool")!.due!).toBeLessThan(fastDue);
  });

  it("a third clean, fast cold solve of a stable problem retires it", async () => {
    const { ctx, app } = await setup(true);
    await capture(app, await done(app, "p-stable", 15), []);
    expect(ctx.problemReviewRepo.findById("p-stable")!.retired).toBe(1);
  });

  it("a new problem still goes through admission, not FSRS", async () => {
    const { ctx, app } = await setup(true);
    const attemptId = await done(app, "p-new", 20);
    expect(ctx.attemptRepo.findById(attemptId)?.kind).toBe("solve");
    expect(ctx.problemReviewRepo.findById("p-new")).toBeNull();
    await capture(app, attemptId, ["edge-case"]);
    expect(ctx.problemReviewRepo.findById("p-new")?.admissionReason).toBe("mistake");
  });

  it("plan re-solve slots carry the problem's topic, so the log lands on it", async () => {
    const { app } = await setup(true);
    const plan = (await app.inject({ method: "GET", url: "/api/plan/today" })).json();
    expect(plan.resolveSlots.length).toBeGreaterThan(0);
    for (const slot of plan.resolveSlots) expect(slot.topicId).toBe("t");
  });

  it("flag off: logging a pooled problem leaves its review row alone", async () => {
    const { ctx, app } = await setup(false);
    const before = ctx.problemReviewRepo.findById("p-pool")!;
    const attemptId = await done(app, "p-pool", 15);
    await capture(app, attemptId, []);

    expect(ctx.attemptRepo.findById(attemptId)?.kind).toBe("solve");
    const after = ctx.problemReviewRepo.findById("p-pool")!;
    expect(after.reps).toBe(before.reps);
    expect(after.due).toBe(before.due);
  });
});

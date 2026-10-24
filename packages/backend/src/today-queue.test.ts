/**
 * P5.1 — with `todayQueueV2` on, /api/plan/today carries `queue`: one
 * re-solve (pattern hidden) then the block's progression problems. A skipped
 * re-solve leaves the queue at once; the dashboard stops building a second
 * plan; a hidden row can be logged without sending a topic.
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problemReviews, problems, sessions, topics } from "@dsa/database/schema";
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
  const topic = (id: string, name: string) => ({
    id, name, difficulty: "Easy" as const, status: "In progress" as const, confidence: 30,
    revisionCount: 1, nextRevisionAt: now + 30 * DAY, updatedAt: now,
  });
  db.insert(topics).values([topic("t-block", "Greedy Sorting"), topic("t-other", "Sliding Window")]).run();
  db.insert(problems)
    .values([
      { id: "n1", name: "Assign Cookies", topicId: "t-block", difficulty: "Easy", status: "Not started", leetcodeLink: "https://leetcode.com/problems/assign-cookies/", updatedAt: now },
      { id: "n2", name: "Lemonade Change", topicId: "t-block", difficulty: "Easy", status: "Not started", updatedAt: now },
      { id: "r1", name: "Longest Repeating Character Replacement", topicId: "t-other", difficulty: "Medium", status: "Revision needed", attempts: 1, updatedAt: now },
    ])
    .run();
  db.insert(problemReviews)
    .values({ problemId: "r1", admittedAt: now - 10 * DAY, admissionReason: "mistake", due: now - 2 * DAY, createdAt: now, updatedAt: now })
    .run();
  // A session yesterday: a normal day, not re-entry.
  db.insert(sessions)
    .values({ id: "s1", date: now - DAY, topicId: "t-block", problemsSolved: 1, studyDuration: 30, productivityScore: 70, updatedAt: now })
    .run();
  sqlite.close();
}

function setup(todayQueueV2: boolean) {
  const config = { ...base, flags: { ...FEATURE_FLAGS_OFF, todayQueueV2, unifiedCompletion: true } };
  const ctx = createAppContext(config);
  ctx.curriculumService.setActiveTopicId("t-block");
  const app = buildApp(config, ctx);
  open.push({ ctx, app });
  return { ctx, app };
}

const getPlan = async (app: FastifyInstance) =>
  (await app.inject({ method: "GET", url: "/api/plan/today" })).json();

beforeEach(() => {
  resetConfigCache();
  testDbPath = join(tmpdir(), `dsa-today-queue-${Date.now()}-${Math.random()}.db`);
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

describe("Today queue (P5.1)", () => {
  it("re-solve first with its pattern hidden, then the block's problems", async () => {
    const { app } = setup(true);
    const { queue } = await getPlan(app);

    expect(queue.dayKind).toBe("block");
    expect(queue.blocks.map((b: { kind: string; problemId: string }) => [b.kind, b.problemId])).toEqual([
      ["resolve", "r1"],
      ["progression", "n1"],
      ["progression", "n2"],
    ]);
    const [resolve, first] = queue.blocks;
    expect(resolve.revealPattern).toBe(false);
    expect(JSON.stringify(resolve)).not.toContain("Sliding Window");
    expect(resolve.topicId).toBe("t-other");
    expect(first).toMatchObject({ revealPattern: true, topicName: "Greedy Sorting", topicId: "t-block" });
    expect(queue.decision).toMatchObject({ dayKind: "block", mode: "normal", topic: { id: "t-block", total: 2 } });
  });

  it("every problem appears at most once in the queue", async () => {
    const { app } = setup(true);
    const { queue } = await getPlan(app);
    const ids = queue.blocks.map((b: { problemId: string }) => b.problemId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a skipped re-solve leaves the queue at once", async () => {
    const { app } = setup(true);
    expect((await getPlan(app)).queue.blocks[0].problemId).toBe("r1");
    await app.inject({ method: "POST", url: "/api/resolve/r1/skip" });
    const { queue } = await getPlan(app);
    expect(queue.blocks.some((b: { problemId: string }) => b.problemId === "r1")).toBe(false);
  });

  it("the dashboard no longer builds a second plan", async () => {
    const { app } = setup(true);
    const res = await app.inject({ method: "GET", url: "/api/analytics/dashboard?weeks=4" });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan).toBeNull();
  });

  it("a hidden row logs without a topic: the problem's own topic is used", async () => {
    const { ctx, app } = setup(true);
    const res = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { problemId: "r1", studyDuration: 30, pushToNotion: false },
    });
    expect(res.statusCode).toBe(201);
    const attempt = ctx.attemptRepo.findById(res.json().attemptId)!;
    expect(attempt).toMatchObject({ topicId: "t-other", kind: "resolve" });
  });

  it("a coach anchored from a hidden row gets no pattern in its context", async () => {
    const { ctx } = setup(true);
    type Resolve = (input: { problemId?: string; includeContext?: boolean; hidePattern?: boolean }) => Promise<unknown>;
    const resolveContext = (ctx.chatService as unknown as { resolveContext: Resolve }).resolveContext.bind(ctx.chatService);

    const hidden = JSON.stringify(await resolveContext({ problemId: "r1", includeContext: false, hidePattern: true }));
    expect(hidden).toContain("Longest Repeating Character Replacement");
    expect(hidden).not.toContain("Sliding Window");

    const withPlan = JSON.stringify(await resolveContext({ problemId: "r1", includeContext: true, hidePattern: true }));
    expect(withPlan).not.toContain("Sliding Window");

    const shown = JSON.stringify(await resolveContext({ problemId: "r1", includeContext: false }));
    expect(shown).toContain("Sliding Window");
  });

  it("flag off: no queue, and the dashboard still embeds the plan", async () => {
    const { app } = setup(false);
    expect((await getPlan(app)).queue).toBeUndefined();
    const dash = (await app.inject({ method: "GET", url: "/api/analytics/dashboard?weeks=4" })).json();
    expect(dash.plan).not.toBeNull();
  });
});

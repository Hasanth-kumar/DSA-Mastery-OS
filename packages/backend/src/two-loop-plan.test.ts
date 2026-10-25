/**
 * P7.5 — with `curriculumV2` + `spiralPasses` (and `todayQueueV2`), Today's
 * queue comes from the two-loop selector: a block day shows the new pattern
 * and hides the basics offer; a mixed day names nothing; a consolidation day
 * leads with the backlog topic's re-solve; a pin wins. Flags off: P3.4.
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problemAttempts, problemReviews, problems, sessions, topics } from "@dsa/database/schema";
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

const TOPICS = {
  rec: "Recursion & Backtracking",
  tp: "Two Pointers",
  sw: "Sliding Window",
  hash: "Hashing + Set/Map",
  greedy: "Greedy Sorting",
  dp: "Dynamic Programming (1D)",
} as const;
type Key = keyof typeof TOPICS;
const ALL_NAMES = Object.values(TOPICS);

/**
 * Recursion and Greedy at pass 1; three basics open (the cap is full); DP (1D)
 * untouched with Recursion done, so the D13 exemption starts it.
 * `dpCovered` covers that many DP problems (4 = its block is done).
 */
function seed(dbPath: string, opts: { dpCovered?: number; greedyOverdue?: number } = {}): void {
  runMigrations(dbPath);
  const { db, sqlite } = createSqliteDb(dbPath);
  const now = Date.now();
  db.insert(topics)
    .values(
      (Object.keys(TOPICS) as Key[]).map((k) => ({
        id: k, name: TOPICS[k], difficulty: "Easy" as const, status: "In progress" as const,
        confidence: 30, revisionCount: 1, nextRevisionAt: now + 30 * DAY, updatedAt: now,
      })),
    )
    .run();
  const rows: (typeof problems.$inferInsert)[] = [];
  const attempts: (typeof problemAttempts.$inferInsert)[] = [];
  const add = (k: Key, n: string, difficulty: "Easy" | "Medium", covered: boolean) => {
    const id = `${k}-${n}`;
    rows.push({ id, name: `${k} ${n}`, topicId: k, difficulty, status: covered ? "Solved" : "Not started", updatedAt: now });
    if (covered) {
      attempts.push({ id: `a-${id}`, problemId: id, topicId: k, solvedAt: now - 20 * DAY, kind: "solve", createdAt: now });
    }
  };
  for (const n of ["m1", "m2", "m3"]) add("rec", n, "Medium", true);
  for (const n of ["e1", "m1"]) add("greedy", n, n === "e1" ? "Easy" : "Medium", true);
  for (const k of ["tp", "sw", "hash"] as Key[]) {
    add(k, "e1", "Easy", false);
    add(k, "m1", "Medium", false);
  }
  const dp = ["e1", "e2", "m1", "m2", "m3"];
  dp.forEach((n, i) => add("dp", n, n.startsWith("e") ? "Easy" : "Medium", i < (opts.dpCovered ?? 0)));
  db.insert(problems).values(rows).run();
  db.insert(problemAttempts).values(attempts).run();
  // A re-solve due on Recursion, most overdue of all.
  const review = (problemId: string, daysOverdue: number) => ({
    problemId, admittedAt: now - 30 * DAY, admissionReason: "mistake", due: now - daysOverdue * DAY,
    createdAt: now, updatedAt: now,
  });
  const reviews = [review("rec-m1", 6)];
  if (opts.greedyOverdue) reviews.push(review("greedy-e1", 2), review("greedy-m1", 3));
  db.insert(problemReviews).values(reviews).run();
  db.insert(sessions)
    .values({ id: "s1", date: now - DAY, topicId: "greedy", problemsSolved: 1, studyDuration: 30, productivityScore: 70, updatedAt: now })
    .run();
  sqlite.close();
}

function setup(flags: { curriculumV2?: boolean; spiralPasses?: boolean } = { curriculumV2: true, spiralPasses: true }) {
  const config = {
    ...base,
    // One re-solve slot a day (D8), so the consolidation-day preference matters.
    resolve: { ...base.resolve, slotsWeekday: 1, slotsWeekend: 1 },
    flags: { ...FEATURE_FLAGS_OFF, todayQueueV2: true, unifiedCompletion: true, ...flags },
  };
  const ctx = createAppContext(config);
  const app = buildApp(config, ctx);
  open.push({ ctx, app });
  return { ctx, app };
}

type Row = { kind: string; problemId: string; topicId: string; revealPattern: boolean; topicName?: string; reason: string };
const getQueue = async (app: FastifyInstance) =>
  (await app.inject({ method: "GET", url: "/api/plan/today" })).json().queue as {
    dayKind: string;
    blocks: Row[];
    decision: { dayKind: string; topic: { id: string; name: string } | null; why: string };
  };
const progression = (q: { blocks: Row[] }) => q.blocks.filter((b) => b.kind === "progression");

function prepare(opts: Parameters<typeof seed>[1] = {}) {
  seed(testDbPath, opts);
}

beforeEach(() => {
  resetConfigCache();
  testDbPath = join(tmpdir(), `dsa-two-loop-${Date.now()}-${Math.random()}.db`);
  process.env.SQLITE_PATH = testDbPath;
  process.env.DSA_DB_PATH = testDbPath;
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

describe("Two-loop plan (P7.5)", () => {
  it("block day: DP (1D) starts, its problem shown, the basics offer hidden", async () => {
    prepare();
    const { app } = setup();
    const plan = (await app.inject({ method: "GET", url: "/api/plan/today" })).json();
    const queue = plan.queue as Awaited<ReturnType<typeof getQueue>>;
    expect(queue.dayKind).toBe("block");
    expect(queue.decision.topic).toMatchObject({ id: "dp", name: TOPICS.dp });
    expect(queue.decision.why).toContain("New pattern: Dynamic Programming (1D)");
    // The plan's primary topic is the block's, so the hero and nav agree with the queue.
    expect(plan.primaryTopic).toMatchObject({ id: "dp", name: TOPICS.dp });
    expect(queue.blocks[0]).toMatchObject({ kind: "resolve", problemId: "rec-m1", revealPattern: false });
    const [block, basic] = progression(queue);
    expect(block).toMatchObject({ problemId: "dp-e1", topicId: "dp", revealPattern: true, topicName: TOPICS.dp });
    expect(basic).toMatchObject({ topicId: "tp", revealPattern: false, reason: "Basics · first pass" });
    expect(basic.topicName).toBeUndefined();
    for (const name of ALL_NAMES) expect(JSON.stringify(basic)).not.toContain(name);
  });

  it("mixed day once the block is done: no pattern named anywhere", async () => {
    prepare({ dpCovered: 4 });
    const { app } = setup();
    const queue = await getQueue(app);
    expect(queue.dayKind).toBe("mixed");
    expect(queue.decision.topic).toBeNull();
    expect(queue.decision.why).toMatch(/^Mixed practice: /);
    for (const name of ALL_NAMES) expect(queue.decision.why).not.toContain(name);
    for (const row of queue.blocks) {
      expect(row.revealPattern).toBe(false);
      expect(row.topicName).toBeUndefined();
    }
    // D13's typical day: the open pattern's problem, then the basics offer (kept past the budget).
    expect(progression(queue).map((r) => r.problemId)).toEqual(["dp-m3", "tp-e1"]);
  });

  it("consolidation day: the backlog topic's re-solve leads, ahead of a more overdue one", async () => {
    prepare({ greedyOverdue: 2 });
    const { app } = setup();
    const queue = await getQueue(app);
    expect(queue.dayKind).toBe("mixed");
    expect(queue.blocks[0]).toMatchObject({ kind: "resolve", topicId: "greedy" });
    for (const name of ALL_NAMES) expect(queue.decision.why).not.toContain(name);
  });

  it("a pin wins: a block day for the pinned topic", async () => {
    prepare({ greedyOverdue: 2 });
    const { ctx, app } = setup();
    ctx.curriculumService.setActiveTopicId("sw");
    const queue = await getQueue(app);
    expect(queue.dayKind).toBe("block");
    expect(queue.decision.topic).toMatchObject({ id: "sw" });
    expect(progression(queue).every((r) => r.topicId === "sw" && r.revealPattern)).toBe(true);
  });

  it.each([
    ["curriculumV2 off", { curriculumV2: false, spiralPasses: true }],
    ["spiralPasses off", { curriculumV2: true, spiralPasses: false }],
  ])("%s: the P3.4 queue (one topic, no basics offer)", async (_label, flags) => {
    prepare();
    const { app } = setup(flags);
    const queue = await getQueue(app);
    expect(queue.dayKind).toBe("block");
    const rows = progression(queue);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.topicId)).size).toBe(1);
    expect(rows.some((r) => r.reason === "Basics · first pass")).toBe(false);
  });
});

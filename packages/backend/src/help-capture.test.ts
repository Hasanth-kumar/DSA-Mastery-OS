/**
 * Phase 6 — help level + source, pattern guess (P6.1) and the one-line
 * takeaway (P6.2), through the real routes, plus the 0017 migration.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problemReviews, problems, sessions, topics } from "@dsa/database/schema";
import { createSqliteDb, runMigrations } from "@dsa/integrations";
import { FEATURE_FLAGS_OFF, loadConfig, resetConfigCache, type FeatureFlags } from "@dsa/shared";
import type { AppConfig } from "@dsa/shared";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { createAppContext, type AppContext } from "./context.js";

const DAY = 86_400_000;
let testDbPath: string;
let vault: string;
let base: AppConfig;
const open: { ctx: AppContext; app: FastifyInstance }[] = [];

function seed(dbPath: string): void {
  runMigrations(dbPath);
  const { db, sqlite } = createSqliteDb(dbPath);
  const now = Date.now();
  const topic = (id: string, name: string) => ({
    id, name, difficulty: "Easy" as const, status: "In progress" as const, confidence: 40, revisionCount: 1, updatedAt: now,
  });
  db.insert(topics).values([topic("t-greedy", "Greedy Sorting"), topic("t-window", "Sliding Window")]).run();
  db.insert(problems)
    .values([
      { id: "p-new", name: "Assign Cookies", topicId: "t-greedy", difficulty: "Easy", status: "Not started", updatedAt: now },
      { id: "p-pool", name: "Max Consecutive Ones III", topicId: "t-window", difficulty: "Medium", status: "Revision needed", attempts: 1, updatedAt: now },
    ])
    .run();
  db.insert(problemReviews)
    .values({ problemId: "p-pool", admittedAt: now - 9 * DAY, admissionReason: "mistake", due: now - DAY, createdAt: now, updatedAt: now })
    .run();
  db.insert(sessions)
    .values({ id: "s-y", date: now - DAY, topicId: "t-greedy", problemsSolved: 1, studyDuration: 30, productivityScore: 70, updatedAt: now })
    .run();
  sqlite.close();
}

function setup(flags: Partial<FeatureFlags> = {}) {
  const config = {
    ...base,
    obsidian: { ...base.obsidian, vaultPath: vault },
    flags: {
      ...FEATURE_FLAGS_OFF,
      todayQueueV2: true,
      unifiedCompletion: true,
      helpLevelCapture: true,
      takeawayField: true,
      ...flags,
    },
  };
  const ctx = createAppContext(config);
  ctx.curriculumService.setActiveTopicId("t-greedy");
  const app = buildApp(config, ctx);
  open.push({ ctx, app });
  return { ctx, app };
}

async function done(app: FastifyInstance, problemId: string, minutes = 15): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/session",
    payload: { problemId, studyDuration: minutes, pushToNotion: false },
  });
  expect(res.statusCode).toBe(201);
  return res.json().attemptId;
}

const capture = (app: FastifyInstance, attemptId: string, body: Record<string, unknown>) =>
  app.inject({ method: "PATCH", url: `/api/attempts/${attemptId}/mistake`, payload: { tags: [], ...body } });

beforeEach(() => {
  resetConfigCache();
  testDbPath = join(tmpdir(), `dsa-help-${Date.now()}-${Math.random()}.db`);
  vault = mkdtempSync(join(tmpdir(), "dsa-help-vault-"));
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
  rmSync(vault, { recursive: true, force: true });
  delete process.env.SQLITE_PATH;
  delete process.env.DSA_DB_PATH;
});

describe("help level (P6.1)", () => {
  it("stores level and source and derives the old used-coach boolean", async () => {
    const { ctx, app } = setup();
    const id = await done(app, "p-new");
    expect((await capture(app, id, { helpLevel: "hint", helpSource: "external-ai" })).statusCode).toBe(200);
    expect(ctx.attemptRepo.findById(id)).toMatchObject({ helpLevel: "hint", helpSource: "external-ai", usedCoach: 1 });

    expect((await capture(app, id, { helpLevel: "none", helpSource: "coach" })).statusCode).toBe(200);
    expect(ctx.attemptRepo.findById(id)).toMatchObject({ helpLevel: "none", helpSource: null, usedCoach: 0 });
  });

  it("rejects unknown levels and sources", async () => {
    const { app } = setup();
    const id = await done(app, "p-new");
    expect((await capture(app, id, { helpLevel: "lots" })).statusCode).toBe(400);
    expect((await capture(app, id, { helpLevel: "hint", helpSource: "friend" })).statusCode).toBe(400);
  });

  it("a hint is still a clean solve; approach help means Revision needed", async () => {
    const { ctx, app } = setup();
    const id = await done(app, "p-new");
    await capture(app, id, { helpLevel: "hint", helpSource: "external-ai" });
    expect(ctx.problemRepo.findById("p-new")?.status).toBe("Solved");
    await capture(app, id, { helpLevel: "approach", helpSource: "external-ai" });
    expect(ctx.problemRepo.findById("p-new")?.status).toBe("Revision needed");
  });

  it("flag off: approach help keeps the old status rule", async () => {
    const { ctx, app } = setup({ helpLevelCapture: false });
    const id = await done(app, "p-new");
    await capture(app, id, { helpLevel: "approach" });
    expect(ctx.problemRepo.findById("p-new")?.status).toBe("Solved");
  });

  it("a re-solve with a hint is rated good; with the full solution, again", async () => {
    const hinted = setup();
    await capture(hinted.app, await done(hinted.app, "p-pool", 15), { helpLevel: "hint", helpSource: "coach" });
    const hintedReview = hinted.ctx.problemReviewRepo.findById("p-pool")!;

    const solved = setup();
    // fresh row for the second case
    solved.ctx.problemReviewRepo.update("p-pool", { ...hintedReview, due: Date.now() - DAY, reps: 0, lapses: 0, state: 0, stability: null, difficulty: null, lastReview: null });
    await capture(solved.app, await done(solved.app, "p-pool", 15), { helpLevel: "solution", helpSource: "external-ai" });
    const solvedReview = solved.ctx.problemReviewRepo.findById("p-pool")!;

    expect(solvedReview.due!).toBeLessThan(hintedReview.due!);
  });

  it("the session score weighs approach help more than a hint", async () => {
    const { ctx, app } = setup();
    const id = await done(app, "p-new", 15);
    await capture(app, id, { helpLevel: "hint" });
    const hintScore = ctx.sessionRepo.findById(ctx.attemptRepo.findById(id)!.sessionId!)!.productivityScore!;
    await capture(app, id, { helpLevel: "approach" });
    const approachScore = ctx.sessionRepo.findById(ctx.attemptRepo.findById(id)!.sessionId!)!.productivityScore!;
    expect(hintScore).toBeGreaterThan(approachScore);
  });
});

describe("pattern guess (P6.1)", () => {
  it("stores the guess and reveals the real pattern", async () => {
    const { ctx, app } = setup();
    const id = await done(app, "p-pool");
    const wrong = await app.inject({ method: "POST", url: `/api/attempts/${id}/pattern-guess`, payload: { guess: "t-greedy" } });
    expect(wrong.json()).toEqual({ topicId: "t-window", topicName: "Sliding Window", correct: false });
    const right = await app.inject({ method: "POST", url: `/api/attempts/${id}/pattern-guess`, payload: { guess: "t-window" } });
    expect(right.json().correct).toBe(true);
    expect(ctx.attemptRepo.findById(id)?.patternGuess).toBe("t-window");
    const unsure = await app.inject({ method: "POST", url: `/api/attempts/${id}/pattern-guess`, payload: { guess: "unsure" } });
    expect(unsure.json().correct).toBe(false);
  });
});

describe("takeaway (P6.2)", () => {
  it("is saved, appended to the existing note, and shown on the next re-solve", async () => {
    mkdirSync(join(vault, "Topics", "Sliding Window"), { recursive: true });
    const notePath = join(vault, "Topics", "Sliding Window", "Max Consecutive Ones III.md");
    writeFileSync(notePath, "# Max Consecutive Ones III\n\n## Approach\nwindow\n");
    const { ctx, app } = setup();
    ctx.obsidianNotes.scanVault();

    const id = await done(app, "p-pool");
    await capture(app, id, { takeaway: "  shrink while zeros > k  " });
    expect(ctx.attemptRepo.findById(id)?.takeaway).toBe("shrink while zeros > k");

    const note = readFileSync(notePath, "utf-8");
    expect(note.startsWith("# Max Consecutive Ones III\n\n## Approach\nwindow\n")).toBe(true);
    expect(note).toMatch(/## Takeaways\n- \d{4}-\d{2}-\d{2}: shrink while zeros > k\n$/);

    // Make it due again and read the queue.
    ctx.problemReviewRepo.update("p-pool", { due: Date.now() - DAY });
    await ctx.planService.invalidateTodaysPlan();
    const plan = (await app.inject({ method: "GET", url: "/api/plan/today" })).json();
    const row = plan.queue.blocks.find((b: { problemId: string }) => b.problemId === "p-pool");
    expect(row.takeaway).toBe("shrink while zeros > k");
  });

  it("a second takeaway goes under the same heading; no note means no file", async () => {
    const notePath = join(vault, "Max Consecutive Ones III.md");
    writeFileSync(notePath, "# Max Consecutive Ones III\n");
    const { ctx, app } = setup();
    ctx.obsidianNotes.scanVault();
    await capture(app, await done(app, "p-pool"), { takeaway: "first" });
    await capture(app, await done(app, "p-pool"), { takeaway: "second" });
    const note = readFileSync(notePath, "utf-8");
    expect(note.match(/## Takeaways/g)).toHaveLength(1);
    expect(note).toMatch(/: first\n- .*: second\n$/);

    await capture(app, await done(app, "p-new"), { takeaway: "no note here" });
    expect(ctx.attemptRepo.latestTakeaway("p-new")).toBe("no note here");
  });

  it("flag off: saved on the attempt but the note is not touched", async () => {
    const notePath = join(vault, "Max Consecutive Ones III.md");
    writeFileSync(notePath, "# Max Consecutive Ones III\n");
    const { ctx, app } = setup({ takeawayField: false });
    ctx.obsidianNotes.scanVault();
    await capture(app, await done(app, "p-pool"), { takeaway: "kept local" });
    expect(readFileSync(notePath, "utf-8")).toBe("# Max Consecutive Ones III\n");
  });
});

describe("0017 migration", () => {
  it("re-runs cleanly and reverses with the down script", () => {
    runMigrations(testDbPath); // second run on the seeded DB
    const { sqlite: db } = createSqliteDb(testDbPath);
    const cols = () => (db.prepare("pragma table_info(problem_attempts)").all() as { name: string }[]).map((c) => c.name);
    expect(cols()).toEqual(expect.arrayContaining(["help_level", "help_source", "pattern_guess", "takeaway"]));
    const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
    db.exec(readFileSync(join(repoRoot, "database/migrations/down/0017_attempt_signals.down.sql"), "utf-8"));
    expect(cols()).not.toContain("help_level");
    expect(cols()).toContain("used_coach");
    db.close();
  });
});

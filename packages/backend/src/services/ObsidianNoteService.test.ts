/**
 * A pattern write-up whose title starts with a problem name must not count as
 * that problem's note, and must not block creating the real one.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problems, topics } from "@dsa/database/schema";
import { createSqliteDb, runMigrations } from "@dsa/integrations";
import { FEATURE_FLAGS_OFF, loadConfig, resetConfigCache, type AppConfig } from "@dsa/shared";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { createAppContext, type AppContext } from "../context.js";
import type { ProblemRow } from "../repositories/ProblemRepository.js";
import { matchNoteTitleToProblem } from "./ObsidianNoteService.js";

const named = (name: string) => ({ name }) as ProblemRow;

describe("matchNoteTitleToProblem", () => {
  const bank = [
    named("Binary Search"),
    named("Search Insert Position"),
    named("Two Sum"),
    named("Two Sum II"),
  ];

  it("matches a note titled with the problem name", () => {
    expect(matchNoteTitleToProblem("Binary Search", bank)?.name).toBe("Binary Search");
    expect(matchNoteTitleToProblem("two sum", bank)?.name).toBe("Two Sum");
  });

  it("does not treat a longer pattern write-up as the shorter problem", () => {
    expect(
      matchNoteTitleToProblem("Binary Search + Prefix Sum - Basic Stuff", bank),
    ).toBeNull();
    expect(matchNoteTitleToProblem("Two Sum II", bank)?.name).toBe("Two Sum II");
  });
});

describe("createTemplateForProblem", () => {
  let testDbPath: string;
  let vault: string;
  let base: AppConfig;
  const open: { ctx: AppContext; app: FastifyInstance }[] = [];
  const patternRel =
    "Topics/Binary Search + Prefix Sum/Binary Search + Prefix Sum - Basic Stuff.md";

  beforeEach(() => {
    resetConfigCache();
    testDbPath = join(tmpdir(), `dsa-note-${Date.now()}-${Math.random()}.db`);
    vault = mkdtempSync(join(tmpdir(), "dsa-note-vault-"));
    process.env.SQLITE_PATH = testDbPath;
    process.env.DSA_DB_PATH = testDbPath;
    runMigrations(testDbPath);
    const { db, sqlite } = createSqliteDb(testDbPath);
    const now = Date.now();
    db.insert(topics)
      .values({
        id: "t-bs",
        name: "Binary Search",
        difficulty: "Easy",
        status: "In progress",
        confidence: 40,
        revisionCount: 0,
        updatedAt: now,
      })
      .run();
    db.insert(problems)
      .values({
        id: "p-bs",
        name: "Binary Search",
        topicId: "t-bs",
        difficulty: "Easy",
        status: "Solved",
        updatedAt: now,
      })
      .run();
    sqlite.close();

    const loaded = loadConfig("/nonexistent/.env");
    base = {
      ...loaded,
      sqlite: { path: testDbPath },
      schedulers: { ...loaded.schedulers, enabled: false },
      obsidian: { vaultPath: vault },
      flags: { ...FEATURE_FLAGS_OFF },
    };
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

  function setup() {
    const ctx = createAppContext(base);
    const app = buildApp(base, ctx);
    open.push({ ctx, app });
    return ctx;
  }

  it("creates the problem note when a pattern write-up was linked to it", () => {
    const patternAbs = join(vault, patternRel);
    mkdirSync(join(vault, "Topics", "Binary Search + Prefix Sum"), { recursive: true });
    const patternBody = "Prefix sums plus binary search.\n";
    writeFileSync(patternAbs, patternBody);

    const ctx = setup();
    ctx.noteRepo.upsertByPath({
      path: patternRel,
      title: "Binary Search + Prefix Sum - Basic Stuff",
      problemId: "p-bs",
      topicId: "t-bs",
      content: patternBody,
      matchedBy: "filename",
    });

    const created = ctx.obsidianNotes.createTemplateForProblem("p-bs");
    expect(created).toEqual({
      created: true,
      path: "Topics/Binary Search/Binary Search.md",
    });
    expect(existsSync(join(vault, "Topics/Binary Search/Binary Search.md"))).toBe(true);
    expect(readFileSync(patternAbs, "utf-8")).toBe(patternBody);
    expect(ctx.noteRepo.findByPath(patternRel)?.problemId).toBeNull();
    expect(ctx.noteRepo.findByProblemId("p-bs")?.path).toBe(
      "Topics/Binary Search/Binary Search.md",
    );

    expect(ctx.obsidianNotes.createTemplateForProblem("p-bs")).toMatchObject({
      created: false,
      reason: "A note for this problem already exists",
    });

    ctx.obsidianNotes.scanVault();
    expect(ctx.noteRepo.findByPath(patternRel)?.problemId).toBeNull();
    expect(ctx.noteRepo.findByProblemId("p-bs")?.title).toBe("Binary Search");
  });
});

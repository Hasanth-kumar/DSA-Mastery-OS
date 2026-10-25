/**
 * Multi-tag mistake capture: tags persist as a JSON array (legacy single-string
 * rows stay readable), and the per-topic tally splits each attempt's tags so a
 * solve flagged with two mistakes counts toward both — the weakness-engine input.
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problems, topics } from "@dsa/database/schema";
import { createSqliteDb, runMigrations } from "@dsa/integrations";
import { loadConfig, resetConfigCache } from "@dsa/shared";
import type { AppConfig } from "@dsa/shared";
import { createAppContext, type AppContext } from "../context.js";
import { parseMistakeTags } from "./AttemptRepository.js";

describe("parseMistakeTags", () => {
  it("decodes a JSON array", () => {
    expect(parseMistakeTags('["wrong-approach","edge-case"]')).toEqual([
      "wrong-approach",
      "edge-case",
    ]);
  });
  it("treats a legacy bare string as a single tag", () => {
    expect(parseMistakeTags("edge-case")).toEqual(["edge-case"]);
  });
  it("returns [] for null/empty", () => {
    expect(parseMistakeTags(null)).toEqual([]);
    expect(parseMistakeTags("")).toEqual([]);
  });
});

let testDbPath: string;
let config: AppConfig;
let ctx: AppContext;

function seed(dbPath: string): void {
  runMigrations(dbPath);
  const { db, sqlite } = createSqliteDb(dbPath);
  const now = Date.now();
  db.insert(topics)
    .values({ id: "topic-a", name: "Arrays", status: "In progress", updatedAt: now })
    .run();
  db.insert(problems)
    .values({ id: "p1", name: "Two Sum", topicId: "topic-a", updatedAt: now })
    .run();
  sqlite.close();
}

beforeEach(() => {
  testDbPath = join(tmpdir(), `dsa-attempts-${Date.now()}-${Math.random()}.db`);
  resetConfigCache();
  process.env.SQLITE_PATH = testDbPath;
  // DSA_DB_PATH wins over SQLITE_PATH and a worktree .env sets it; pin both so
  // loadConfig() never resolves to data/dev/dsa.dev.db.
  process.env.DSA_DB_PATH = testDbPath;
  config = loadConfig();
  seed(testDbPath);
  ctx = createAppContext(config);
});

afterEach(async () => {
  await ctx.close();
  try {
    rmSync(testDbPath);
  } catch {
    // ignore
  }
  delete process.env.SQLITE_PATH;
  delete process.env.DSA_DB_PATH;
  resetConfigCache();
});

describe("AttemptRepository.setMistake + tally", () => {
  it("counts each tag of a multi-tagged attempt toward its topic", () => {
    const a1 = ctx.attemptRepo.create({ problemId: "p1", topicId: "topic-a" });
    const a2 = ctx.attemptRepo.create({ problemId: "p1", topicId: "topic-a" });

    ctx.attemptRepo.setMistake(a1.id, { tags: ["wrong-approach", "edge-case"] });
    ctx.attemptRepo.setMistake(a2.id, { tags: ["edge-case"] });

    const counts = ctx.attemptRepo.mistakeTagCountsForTopic("topic-a");
    expect(counts["edge-case"]).toBe(2); // both attempts
    expect(counts["wrong-approach"]).toBe(1);

    const stored = ctx.attemptRepo.findById(a1.id)!;
    expect(parseMistakeTags(stored.mistakeTag)).toEqual(["wrong-approach", "edge-case"]);
  });

  it("a smooth solve (no tags) clears the attempt and is not counted", () => {
    const a1 = ctx.attemptRepo.create({ problemId: "p1", topicId: "topic-a" });
    ctx.attemptRepo.setMistake(a1.id, { tags: ["off-by-one"] });
    ctx.attemptRepo.setMistake(a1.id, { tags: [] });

    const counts = ctx.attemptRepo.mistakeTagCountsForTopic("topic-a");
    expect(counts["off-by-one"]).toBeUndefined();
    const stored = ctx.attemptRepo.findById(a1.id)!;
    expect(stored.mistakeTag).toBeNull();
  });
});

/**
 * P7.2 — with `curriculumV2`, the curriculum ranks topics with the approved
 * hard prerequisites only. The old graph links made Union-Find wait for DFS;
 * the approved list has no such edge.
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

let testDbPath: string;
let base: AppConfig;
const open: AppContext[] = [];

function seed(dbPath: string): void {
  runMigrations(dbPath);
  const { db, sqlite } = createSqliteDb(dbPath);
  const now = Date.now();
  db.insert(topics)
    .values([
      { id: "t-dfs", name: "DFS (Tree/Graph)", difficulty: "Easy", status: "Not started", confidence: 40, updatedAt: now },
      { id: "t-uf", name: "Union-Find (Disjoint Set)", difficulty: "Easy", status: "Not started", confidence: 0, isWeakArea: 1, updatedAt: now },
    ])
    .run();
  db.insert(problems)
    .values([
      { id: "p-dfs", name: "Max Depth of Binary Tree", topicId: "t-dfs", difficulty: "Easy", status: "Not started", updatedAt: now },
      { id: "p-uf", name: "Number of Provinces", topicId: "t-uf", difficulty: "Medium", status: "Not started", updatedAt: now },
    ])
    .run();
  sqlite.close();
}

function primary(curriculumV2: boolean): string | undefined {
  const ctx = createAppContext({ ...base, flags: { ...FEATURE_FLAGS_OFF, curriculumV2 } });
  open.push(ctx);
  return ctx.curriculumService.selectForTopics(ctx.topicRepo.findAll())?.topic.id;
}

beforeEach(() => {
  resetConfigCache();
  testDbPath = join(tmpdir(), `dsa-hard-prereq-${Date.now()}-${Math.random()}.db`);
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

describe("curriculum prerequisites (P7.2)", () => {
  it("flag off: the old graph link makes Union-Find wait for DFS", () => {
    expect(primary(false)).toBe("t-dfs");
  });

  it("flag on: no hard prerequisite, so the higher-priority Union-Find is ready", () => {
    expect(primary(true)).toBe("t-uf");
  });
});

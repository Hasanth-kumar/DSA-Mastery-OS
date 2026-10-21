import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseMistakeTags,
  runDevMetrics,
} from "../../../infrastructure/scripts/dev-metrics.mjs";

const script = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../infrastructure/scripts/dev-metrics.mjs",
);

const NOW = new Date(1_800_000_000_000);

const SCHEMA = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  date INTEGER NOT NULL,
  study_duration INTEGER
);
CREATE TABLE problems (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  confidence INTEGER,
  next_revision_at INTEGER,
  sm2_interval INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE problem_attempts (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL,
  solved_at INTEGER NOT NULL,
  mistake_tag TEXT,
  used_coach INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE problem_reviews (
  problem_id TEXT PRIMARY KEY,
  retired INTEGER NOT NULL DEFAULT 0,
  suspended INTEGER NOT NULL DEFAULT 0,
  due INTEGER
);
CREATE TABLE cards (id TEXT PRIMARY KEY);
CREATE TABLE card_events (id TEXT PRIMARY KEY);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  content TEXT NOT NULL
);
CREATE TABLE sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const FIXTURE_SQL = `
${SCHEMA}
INSERT INTO sessions VALUES ('s1', 1, 10), ('s2', 2, 25);
INSERT INTO problems VALUES
  ('p1', 'SECRET-PROBLEM-NAME', 'Solved', 1),
  ('p2', 'SECRET-PROBLEM-NAME', 'Not started', 1),
  ('p3', 'SECRET-PROBLEM-NAME', 'Not started', 1),
  ('p4', 'SECRET-PROBLEM-NAME', 'Revision needed', 1);
INSERT INTO topics VALUES
  ('t-arrays', 'Arrays', 40, 1800000000000, 6, 1),
  ('t-bfs', 'BFS', 10, NULL, 1, 1);
INSERT INTO problem_attempts VALUES
  ('a1', 'p1', 1, '["edge-case","wrong-approach"]', 1, 1),
  ('a2', 'p2', 1, 'edge-case', 0, 1),
  ('a3', 'p3', 1, '[]', 0, 1),
  ('a4', 'p4', 1, NULL, 0, 1),
  ('a5', 'p1', 1, '["  edge-case  "]', 0, 1);
INSERT INTO problem_reviews VALUES
  ('p1', 0, 0, 1799999999000),
  ('p2', 0, 0, 1800000000001),
  ('p3', 1, 0, 0),
  ('p4', 0, 1, 0),
  ('p5', 0, 0, NULL);
INSERT INTO cards VALUES ('c1'), ('c2');
INSERT INTO card_events VALUES ('e1'), ('e2'), ('e3');
INSERT INTO chat_messages VALUES ('m1', 1700000000000, 'SECRET-CHAT-BODY');
INSERT INTO sync_meta VALUES ('curriculum_active_topic_id', 't-arrays');
INSERT INTO sync_meta VALUES ('leaked', 'secret_should_not_appear');
`;

const EXPECTED = [
  "# dev metrics (read-only)",
  "# generated_at: 2027-01-15T08:00:00.000Z",
  "# db: data/dev/dsa.dev.db",
  "# now_ms: 1800000000000",
  "# sessions.study_duration is summed as minutes",
  "# topics.next_revision_at is the SM-2 next review (plan name: next_review)",
  "# problem_reviews_due: retired = 0 AND suspended = 0 AND due IS NOT NULL AND due <= now_ms",
  "# coach_used_attempts: problem_attempts.used_coach > 0",
  "sessions: 2",
  "total_minutes: 35",
  "attempts: 5",
  "coach_used_attempts: 1",
  "problem_reviews: 5",
  "problem_reviews_due: 1",
  "cards: 2",
  "card_events: 3",
  "last_chat_message_at: 2023-11-14T22:13:20.000Z",
  "curriculum_active_topic_id: t-arrays",
  "problems_by_status:",
  "  Not started: 2",
  "  Revision needed: 1",
  "  Solved: 1",
  "mistake_tags:",
  "  edge-case: 3",
  "  wrong-approach: 1",
  "topics:",
  "id\tname\tconfidence\tnext_revision_at_ms\tnext_revision_at\tsm2_interval",
  "t-arrays\tArrays\t40\t1800000000000\t2027-01-15T08:00:00.000Z\t6",
  "t-bfs\tBFS\t10\tnone\tnone\t1",
].join("\n") + "\n";

const roots: string[] = [];

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "dsa-dev-metrics-repo-"));
  roots.push(root);
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  mkdirSync(join(root, "data/dev"), { recursive: true });
  mkdirSync(join(root, "data/sqlite"), { recursive: true });
  return root;
}

function execSqlite(root: string, dbPath: string, sql: string, leaveWal = false) {
  const scriptPath = join(root, "seed-metrics.mjs");
  writeFileSync(
    scriptPath,
    [
      'import { DatabaseSync } from "node:sqlite";',
      `const db = new DatabaseSync(${JSON.stringify(dbPath)});`,
      `db.exec(${JSON.stringify(sql)});`,
      leaveWal ? "process.exit(0);" : "db.close();",
      "",
    ].join("\n"),
  );
  return spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", scriptPath],
    { encoding: "utf8", timeout: 15_000 },
  );
}

function run(root: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.DSA_DB_PATH;
  delete env.DSA_DB_BASELINE;
  delete env.SQLITE_PATH;
  for (const [key, value] of Object.entries(extraEnv)) env[key] = value;
  return spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", script, ...args],
    { cwd: root, env, encoding: "utf8", timeout: 15_000 },
  );
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function metricsTemps(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith("dsa-dev-metrics-"));
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("parseMistakeTags", () => {
  it("accepts a JSON array and a legacy bare tag", () => {
    expect(parseMistakeTags(null)).toEqual([]);
    expect(parseMistakeTags("")).toEqual([]);
    expect(parseMistakeTags("[]")).toEqual([]);
    expect(parseMistakeTags('["edge-case","wrong-approach",1]')).toEqual([
      "edge-case",
      "wrong-approach",
    ]);
    expect(parseMistakeTags("edge-case")).toEqual(["edge-case"]);
  });
});

describe("dev metrics", () => {
  it("prints the baseline counts and hides row text", () => {
    const root = makeRepo();
    const devDb = join(root, "data/dev/dsa.dev.db");
    const seeded = execSqlite(root, devDb, FIXTURE_SQL);
    expect(seeded.status, seeded.stderr).toBe(0);

    const before = sha256(devDb);
    const temps = metricsTemps();
    const report = runDevMetrics({ repoRoot: root, env: {}, now: NOW });

    expect(report).toBe(EXPECTED);
    expect(report).not.toContain("SECRET-PROBLEM-NAME");
    expect(report).not.toContain("SECRET-CHAT-BODY");
    expect(report).not.toContain("secret_should_not_appear");
    expect(report).not.toContain(root);
    expect(sha256(devDb)).toBe(before);
    expect(existsSync(`${devDb}-wal`)).toBe(false);
    expect(existsSync(`${devDb}-shm`)).toBe(false);
    expect(metricsTemps()).toEqual(temps);
  });

  it("reads an uncheckpointed WAL without modifying the dev files", () => {
    const root = makeRepo();
    const devDb = join(root, "data/dev/dsa.dev.db");
    const seeded = execSqlite(
      root,
      devDb,
      `
        PRAGMA journal_mode=WAL;
        PRAGMA wal_autocheckpoint=0;
        ${SCHEMA}
        INSERT INTO sessions VALUES ('s', 1, 9);
      `,
      true,
    );
    expect(seeded.status, seeded.stderr).toBe(0);
    expect(existsSync(`${devDb}-wal`)).toBe(true);

    const files = ["dsa.dev.db", "dsa.dev.db-wal", "dsa.dev.db-shm"];
    const before = Object.fromEntries(
      files.map((name) => [name, sha256(join(root, "data/dev", name))]),
    );

    const report = runDevMetrics({ repoRoot: root, env: {}, now: NOW });

    expect(report).toContain("sessions: 1\n");
    expect(report).toContain("total_minutes: 9\n");
    expect(readdirSync(join(root, "data/dev")).sort()).toEqual([...files].sort());
    for (const name of files) {
      expect(sha256(join(root, "data/dev", name))).toBe(before[name]);
    }
  });

  it("prints zeros for an empty migrated database", () => {
    const root = makeRepo();
    const devDb = join(root, "data/dev/dsa.dev.db");
    expect(execSqlite(root, devDb, SCHEMA).status).toBe(0);

    const report = runDevMetrics({ repoRoot: root, env: {}, now: NOW });

    expect(report).toContain("sessions: 0\n");
    expect(report).toContain("total_minutes: 0\n");
    expect(report).toContain("attempts: 0\n");
    expect(report).toContain("problem_reviews_due: 0\n");
    expect(report).toContain("last_chat_message_at: none\n");
    expect(report).toContain("curriculum_active_topic_id: none\n");
    expect(report).toContain("problems_by_status:\n  (none)\n");
    expect(report).toContain("mistake_tags:\n  (none)\n");
    expect(report).toContain("topics:\n  (none)\n");
  });

  it("does not create a database when the dev db is missing", () => {
    const root = makeRepo();
    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/does not create a database/);
    expect(existsSync(join(root, "data/dev/dsa.dev.db"))).toBe(false);
    expect(result.stdout).toBe("");
  });

  it("ignores SQLITE_PATH and refuses a path outside data/dev", () => {
    const root = makeRepo();
    const live = join(root, "data/sqlite/dsa.db");
    writeFileSync(live, "LIVE");

    const ignored = run(root, [], { SQLITE_PATH: "./data/sqlite/dsa.db" });
    expect(ignored.status).toBe(1);
    expect(ignored.stderr).toMatch(/does not create a database/);
    expect(readFileSync(live, "utf8")).toBe("LIVE");
    expect(existsSync(join(root, "data/dev/dsa.dev.db"))).toBe(false);

    const pointed = run(root, [], {
      DSA_DB_PATH: "./data/dev/../../data/sqlite/dsa.db",
    });
    expect(pointed.status).toBe(1);
    expect(pointed.stderr).toMatch(/Refusing to touch/);
    expect(readFileSync(live, "utf8")).toBe("LIVE");
  });

  it("refuses a symlink instead of reading through it", () => {
    const root = makeRepo();
    const live = join(root, "data/sqlite/dsa.db");
    writeFileSync(live, "LIVE");
    symlinkSync(live, join(root, "data/dev/dsa.dev.db"));

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/symlink/);
    expect(readFileSync(live, "utf8")).toBe("LIVE");
    expect(lstatSync(join(root, "data/dev/dsa.dev.db")).isSymbolicLink()).toBe(true);
  });

  it("does not accept a database path argument", () => {
    const root = makeRepo();
    const result = run(root, [join(root, "data/sqlite/dsa.db")]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Does not accept a database path argument/);
    expect(existsSync(join(root, "data/sqlite/dsa.db"))).toBe(false);
    expect(existsSync(join(root, "data/dev/dsa.dev.db"))).toBe(false);
  });

  it("leaves a non-database file untouched and does not migrate it", () => {
    const root = makeRepo();
    const devDb = join(root, "data/dev/dsa.dev.db");
    writeFileSync(devDb, "not-a-database");

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/does not create or migrate a database/);
    expect(readFileSync(devDb, "utf8")).toBe("not-a-database");
    expect(existsSync(`${devDb}-wal`)).toBe(false);
  });

  it("reads DSA_DB_PATH from .env and does not echo other keys", () => {
    const root = makeRepo();
    const custom = join(root, "data/dev/custom.dev.db");
    expect(execSqlite(root, custom, FIXTURE_SQL).status).toBe(0);
    writeFileSync(
      join(root, ".env"),
      [
        "NOTION_TOKEN=secret_should_not_appear",
        "OPENROUTER_API_KEY=sk-should-not-appear",
        'DSA_DB_PATH="./data/dev/custom.dev.db"',
        "SQLITE_PATH=./data/sqlite/dsa.db",
        "",
      ].join("\n"),
    );

    const result = run(root);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("# db: data/dev/custom.dev.db\n");
    expect(result.stdout).toContain("total_minutes: 35\n");
    expect(result.stdout).not.toContain("SECRET-PROBLEM-NAME");
    expect(result.stdout).not.toContain("SECRET-CHAT-BODY");
    expect(`${result.stdout}${result.stderr}`).not.toMatch(
      /secret_should_not_appear|sk-should-not-appear/,
    );
    expect(result.stdout).not.toContain(root);
  });
});

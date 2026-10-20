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

const script = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../infrastructure/scripts/dev-db.mjs",
);

const roots: string[] = [];

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "dsa-dev-db-"));
  roots.push(root);
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  mkdirSync(join(root, "data/dev"), { recursive: true });
  mkdirSync(join(root, "data/sqlite"), { recursive: true });
  return root;
}

function run(
  root: string,
  args: string[],
  extraEnv: Record<string, string | undefined> = {},
) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.DSA_DB_PATH;
  delete env.DSA_DB_BASELINE;
  delete env.SQLITE_PATH;
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 15_000,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("dev-db snapshot and reset", () => {
  it("copies the dev db into data/dev/snapshots and leaves the source in place", () => {
    const root = makeRepo();
    const devDb = join(root, "data/dev/dsa.dev.db");
    writeFileSync(devDb, "dev-bytes");
    writeFileSync(`${devDb}-wal`, "wal-bytes");

    const result = run(root, ["snapshot"]);

    expect(result.status).toBe(0);
    const dest = result.stdout.trim();
    expect(dest).toMatch(
      /data\/dev\/snapshots\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.db$/,
    );
    expect(readFileSync(dest, "utf8")).toBe("dev-bytes");
    expect(readFileSync(`${dest}-wal`, "utf8")).toBe("wal-bytes");
    expect(readFileSync(devDb, "utf8")).toBe("dev-bytes");
    expect(result.stderr).toBe("");
  });

  it("does not create a database when the dev db is missing", () => {
    const root = makeRepo();
    const result = run(root, ["snapshot"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/does not create a database/);
    expect(existsSync(join(root, "data/dev/dsa.dev.db"))).toBe(false);
    expect(existsSync(join(root, "data/dev/snapshots"))).toBe(false);
  });

  it("ignores SQLITE_PATH and refuses the live database location", () => {
    const root = makeRepo();
    const live = join(root, "data/sqlite/dsa.db");
    writeFileSync(live, "LIVE");

    const ignored = run(root, ["snapshot"], {
      SQLITE_PATH: "./data/sqlite/dsa.db",
    });
    expect(ignored.status).toBe(1);
    expect(readFileSync(live, "utf8")).toBe("LIVE");
    expect(existsSync(join(root, "data/dev/dsa.dev.db"))).toBe(false);

    const pointed = run(root, ["snapshot"], {
      DSA_DB_PATH: "./data/dev/../../data/sqlite/dsa.db",
    });
    expect(pointed.status).toBe(1);
    expect(pointed.stderr).toMatch(/Refusing to touch/);
    expect(readFileSync(live, "utf8")).toBe("LIVE");
    expect(existsSync(join(root, "data/dev/snapshots"))).toBe(false);
  });

  it("refuses a symlink instead of copying through it", () => {
    const root = makeRepo();
    const live = join(root, "data/sqlite/dsa.db");
    writeFileSync(live, "LIVE");
    symlinkSync(live, join(root, "data/dev/dsa.dev.db"));

    const result = run(root, ["snapshot"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/symlink/);
    expect(readFileSync(live, "utf8")).toBe("LIVE");
    expect(lstatSync(join(root, "data/dev/dsa.dev.db")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(root, "data/dev/snapshots"))).toBe(false);
  });

  it("restores the dev db from the pristine baseline and drops a stale wal", () => {
    const root = makeRepo();
    const devDb = join(root, "data/dev/dsa.dev.db");
    const baseline = join(root, "data/dev/dsa.snapshot-2026-10-19.db");
    writeFileSync(devDb, "mutated");
    writeFileSync(`${devDb}-wal`, "stale-wal");
    writeFileSync(baseline, "pristine");
    writeFileSync(`${baseline}-shm`, "baseline-shm");
    mkdirSync(join(root, "data/dev/snapshots"), { recursive: true });
    writeFileSync(join(root, "data/dev/snapshots/kept.db"), "kept-snapshot");

    const result = run(root, ["reset"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`restored ${devDb} from ${baseline}`);
    expect(readFileSync(devDb, "utf8")).toBe("pristine");
    expect(readFileSync(baseline, "utf8")).toBe("pristine");
    expect(existsSync(`${devDb}-wal`)).toBe(false);
    expect(readFileSync(`${devDb}-shm`, "utf8")).toBe("baseline-shm");
    expect(readFileSync(join(root, "data/dev/snapshots/kept.db"), "utf8")).toBe(
      "kept-snapshot",
    );
  });

  it("does not create a database when the baseline is missing", () => {
    const root = makeRepo();
    const result = run(root, ["reset"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/does not create a database/);
    expect(existsSync(join(root, "data/dev/dsa.dev.db"))).toBe(false);
  });

  it("reads DSA_DB_PATH from .env and does not echo other keys", () => {
    const root = makeRepo();
    const custom = join(root, "data/dev/custom.dev.db");
    writeFileSync(custom, "custom-bytes");
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

    const result = run(root, ["snapshot"]);

    expect(result.status).toBe(0);
    expect(readFileSync(result.stdout.trim(), "utf8")).toBe("custom-bytes");
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/secret_should_not_appear|sk-should-not-appear/);
    expect(readdirSync(join(root, "data/dev/snapshots"))).toHaveLength(1);
  });
});

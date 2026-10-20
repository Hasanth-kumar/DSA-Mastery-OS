#!/usr/bin/env node
/**
 * Snapshot and reset the overhaul dev database.
 *
 *   node infrastructure/scripts/dev-db.mjs snapshot
 *   node infrastructure/scripts/dev-db.mjs reset
 *
 * Copies files only. Does not open SQLite and does not create a database.
 * Operates only on regular files inside <repo>/data/dev. Ignores SQLITE_PATH.
 * Refuses symlinks so a link cannot redirect a copy onto the live database.
 *
 * Defaults:
 *   dev db    data/dev/dsa.dev.db          (override with DSA_DB_PATH)
 *   baseline  data/dev/dsa.snapshot-2026-10-19.db
 *                                        (override with DSA_DB_BASELINE)
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_DEV_DB = "data/dev/dsa.dev.db";
export const DEFAULT_BASELINE = "data/dev/dsa.snapshot-2026-10-19.db";

const SIDECARS = ["-wal", "-shm"];

export function findRepoRoot(startDir = process.cwd()) {
  let dir = resolve(startDir);
  const filesystemRoot = resolve("/");
  while (dir !== filesystemRoot) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return resolve(startDir);
}

/** Read only the two path keys. Every other line, including secrets, is ignored. */
export function readDevDbEnvFile(text) {
  const out = {};
  for (const rawLine of text.split("\n")) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!value) continue;
    if (key === "DSA_DB_PATH") out.dbPath = value;
    if (key === "DSA_DB_BASELINE") out.baseline = value;
  }
  return out;
}

export function snapshotStamp(now = new Date()) {
  return now.toISOString().replaceAll(":", "-");
}

function nonEmpty(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function resolveInsideRepo(repoRoot, pathValue) {
  return isAbsolute(pathValue) ? resolve(pathValue) : resolve(repoRoot, pathValue);
}

export function resolveDevDbPaths(repoRoot, env = process.env) {
  const root = resolve(repoRoot);
  const fileEnv = existsSync(resolve(root, ".env"))
    ? readDevDbEnvFile(readFileSync(resolve(root, ".env"), "utf8"))
    : {};
  const dbPath = nonEmpty(env.DSA_DB_PATH) ?? fileEnv.dbPath ?? DEFAULT_DEV_DB;
  const baselinePath =
    nonEmpty(env.DSA_DB_BASELINE) ?? fileEnv.baseline ?? DEFAULT_BASELINE;
  const devDb = resolveInsideRepo(root, dbPath);
  const baseline = resolveInsideRepo(root, baselinePath);
  const snapshotDir = resolve(root, "data/dev/snapshots");
  return { repoRoot: root, devDb, baseline, snapshotDir };
}

function fail(message) {
  const error = new Error(message);
  error.code = "DEV_DB_REFUSED";
  return error;
}

function assertInsideDevDir(repoRoot, target) {
  const devDir = resolve(repoRoot, "data/dev");
  const abs = resolve(target);
  const rel = relative(devDir, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw fail(
      `Refusing to touch ${abs}: snapshot and reset only operate on files inside ${devDir}.`,
    );
  }
  if (!abs.endsWith(".db") && !abs.endsWith(".db-wal") && !abs.endsWith(".db-shm")) {
    throw fail(`Refusing ${abs}: expected a .db file or its -wal/-shm sidecar.`);
  }
  if (existsSync(devDir) && lstatSync(devDir).isSymbolicLink()) {
    throw fail(`Refusing to use symlinked directory ${devDir}.`);
  }
  let current = devDir;
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    current = resolve(current, part);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw fail(`Refusing to follow symlink ${current}.`);
    }
    if (current !== abs && !stat.isDirectory()) {
      throw fail(`Refusing ${abs}: ${current} is not a directory.`);
    }
    if (current === abs && stat.isDirectory()) {
      throw fail(`Refusing directory ${abs}.`);
    }
  }
}

function assertSafePair(paths) {
  assertInsideDevDir(paths.repoRoot, paths.devDb);
  assertInsideDevDir(paths.repoRoot, paths.baseline);
  assertInsideDevDir(paths.repoRoot, resolve(paths.snapshotDir, "placeholder.db"));
  if (resolve(paths.devDb) === resolve(paths.baseline)) {
    throw fail("Baseline and dev database paths are the same. Refusing to reset or snapshot.");
  }
}

function copySidecars(srcDb, destDb, repoRoot) {
  for (const suffix of SIDECARS) {
    const src = `${srcDb}${suffix}`;
    if (!existsSync(src)) continue;
    const dest = `${destDb}${suffix}`;
    assertInsideDevDir(repoRoot, src);
    assertInsideDevDir(repoRoot, dest);
    copyFileSync(src, dest);
  }
}

function removeSidecars(dbPath, repoRoot) {
  for (const suffix of SIDECARS) {
    const side = `${dbPath}${suffix}`;
    if (!existsSync(side)) continue;
    assertInsideDevDir(repoRoot, side);
    unlinkSync(side);
  }
}

function uniqueSnapshotPath(snapshotDir, stamp) {
  let dest = resolve(snapshotDir, `${stamp}.db`);
  let n = 2;
  while (existsSync(dest)) {
    dest = resolve(snapshotDir, `${stamp}-${n}.db`);
    n += 1;
  }
  return dest;
}

export function snapshotDevDb({ repoRoot, env = process.env, now = new Date() }) {
  const paths = resolveDevDbPaths(repoRoot, env);
  assertSafePair(paths);
  if (!existsSync(paths.devDb)) {
    throw fail(
      `No dev database at ${paths.devDb}. This script does not create a database.`,
    );
  }
  assertInsideDevDir(paths.repoRoot, paths.devDb);
  mkdirSync(paths.snapshotDir, { recursive: true });
  const dest = uniqueSnapshotPath(paths.snapshotDir, snapshotStamp(now));
  assertInsideDevDir(paths.repoRoot, dest);
  copyFileSync(paths.devDb, dest);
  copySidecars(paths.devDb, dest, paths.repoRoot);
  return dest;
}

export function resetDevDb({ repoRoot, env = process.env }) {
  const paths = resolveDevDbPaths(repoRoot, env);
  assertSafePair(paths);
  if (!existsSync(paths.baseline)) {
    throw fail(
      `No pristine baseline at ${paths.baseline}. This script does not create a database.`,
    );
  }
  assertInsideDevDir(paths.repoRoot, paths.baseline);
  assertInsideDevDir(paths.repoRoot, paths.devDb);
  mkdirSync(dirname(paths.devDb), { recursive: true });
  removeSidecars(paths.devDb, paths.repoRoot);
  copyFileSync(paths.baseline, paths.devDb);
  copySidecars(paths.baseline, paths.devDb, paths.repoRoot);
  return paths;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

function main() {
  const command = process.argv[2];
  try {
    const repoRoot = findRepoRoot();
    if (command === "snapshot") {
      console.log(snapshotDevDb({ repoRoot }));
      return;
    }
    if (command === "reset") {
      const { devDb, baseline } = resetDevDb({ repoRoot });
      console.log(`restored ${devDb} from ${baseline}`);
      return;
    }
    console.error("Usage: node infrastructure/scripts/dev-db.mjs <snapshot|reset>");
    process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (isDirectRun()) main();

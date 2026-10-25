#!/usr/bin/env node
/**
 * Read-only baseline metrics for the overhaul dev database.
 *
 *   pnpm dev:metrics
 *
 * Prints the counts named in docs/plans/system-overhaul-plan.md (P0.3).
 * Does not accept a database path argument. Reads data/dev/dsa.dev.db, or
 * DSA_DB_PATH from the environment or .env. Ignores SQLITE_PATH.
 *
 * Never creates a study database. A missing file is an error. The dev file
 * is not opened: SQLite would create -wal/-shm sidecars beside it, and a
 * read of the main file alone misses uncheckpointed WAL pages. The script
 * copies the db (and any sidecars) into a temp directory, reads the copy,
 * and deletes it. Paths outside data/dev and symlinks are refused.
 *
 * Stdout is the whole report. Do not commit it. Personal numbers belong in
 * docs/plans/baseline-metrics.md on a machine that has the dev database,
 * and that file is gitignored.
 */
import { copyFileSync, existsSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertInsideDevDir,
  findRepoRoot,
  resolveDevDbPaths,
} from "./dev-db.mjs";

// Node 20 (CI) has no node:sqlite. Node 22.5+ does. Importing on demand lets
// the refusal checks and parseMistakeTags load on either runtime.
let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = undefined;
}

const ACTIVE_TOPIC_KEY = "curriculum_active_topic_id";

function fail(message) {
  const error = new Error(message);
  error.code = "DEV_DB_REFUSED";
  return error;
}

/**
 * Decode `problem_attempts.mistake_tag`. New rows hold a JSON array; legacy
 * rows hold a single bare tag string. Same rules as AttemptRepository.parseMistakeTags.
 */
export function parseMistakeTags(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((tag) => typeof tag === "string");
    }
  } catch {
    // Legacy single bare tag, e.g. "edge-case".
  }
  return [String(raw)];
}

function tallyMistakeTags(rawValues) {
  const counts = new Map();
  for (const raw of rawValues) {
    for (const tag of parseMistakeTags(raw)) {
      const key = tag.trim();
      if (key === "") continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function numberValue(row, key) {
  const value = row?.[key];
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function nullableNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function collectBaselineMetrics(db, nowMs) {
  const sessions = db
    .prepare(
      `SELECT COUNT(*) AS sessions,
              COALESCE(SUM(study_duration), 0) AS total_minutes
       FROM sessions`,
    )
    .get();
  const attempts = db
    .prepare(
      `SELECT COUNT(*) AS attempts,
              COALESCE(SUM(CASE WHEN COALESCE(used_coach, 0) > 0 THEN 1 ELSE 0 END), 0) AS coach_used_attempts
       FROM problem_attempts`,
    )
    .get();
  const reviews = db
    .prepare(
      `SELECT COUNT(*) AS problem_reviews,
              COALESCE(SUM(CASE
                WHEN retired = 0 AND suspended = 0 AND due IS NOT NULL AND due <= ?
                THEN 1 ELSE 0 END), 0) AS problem_reviews_due
       FROM problem_reviews`,
    )
    .get(nowMs);
  const cards = db.prepare(`SELECT COUNT(*) AS cards FROM cards`).get();
  const cardEvents = db.prepare(`SELECT COUNT(*) AS card_events FROM card_events`).get();
  const lastChat = db
    .prepare(`SELECT MAX(created_at) AS last_chat_message_at FROM chat_messages`)
    .get();
  const pin = db
    .prepare(`SELECT value FROM sync_meta WHERE key = ?`)
    .get(ACTIVE_TOPIC_KEY);
  const statusRows = db
    .prepare(`SELECT status AS status, COUNT(*) AS n FROM problems GROUP BY status`)
    .all();
  const topicRows = db
    .prepare(
      `SELECT id, name, confidence, next_revision_at, sm2_interval
       FROM topics`,
    )
    .all();
  const tagRows = db
    .prepare(
      `SELECT mistake_tag AS mistake_tag
       FROM problem_attempts
       WHERE mistake_tag IS NOT NULL AND mistake_tag != ''`,
    )
    .all();

  const pinValue = typeof pin?.value === "string" ? pin.value.trim() : "";

  return {
    sessions: numberValue(sessions, "sessions"),
    totalMinutes: numberValue(sessions, "total_minutes"),
    attempts: numberValue(attempts, "attempts"),
    coachUsedAttempts: numberValue(attempts, "coach_used_attempts"),
    problemReviews: numberValue(reviews, "problem_reviews"),
    problemReviewsDue: numberValue(reviews, "problem_reviews_due"),
    cards: numberValue(cards, "cards"),
    cardEvents: numberValue(cardEvents, "card_events"),
    lastChatMessageAt: nullableNumber(lastChat?.last_chat_message_at),
    curriculumActiveTopicId: pinValue === "" ? null : pinValue,
    problemsByStatus: statusRows
      .map((row) => ({
        status: row.status == null ? "(null)" : String(row.status),
        count: numberValue(row, "n"),
      }))
      .sort((a, b) => a.status.localeCompare(b.status)),
    mistakeTags: tallyMistakeTags(tagRows.map((row) => row.mistake_tag)),
    topics: topicRows
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        confidence: nullableNumber(row.confidence),
        nextRevisionAt: nullableNumber(row.next_revision_at),
        sm2Interval: nullableNumber(row.sm2_interval),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
  };
}

function sanitize(value) {
  return String(value).replaceAll("\t", " ").replaceAll("\r", "").replaceAll("\n", " ");
}

function formatInstant(ms) {
  if (ms == null || !Number.isFinite(ms)) return "none";
  return new Date(ms).toISOString();
}

function section(lines) {
  return lines.length > 0 ? lines : ["  (none)"];
}

export function formatBaselineMetrics(report) {
  const topicLines =
    report.topics.length === 0
      ? ["  (none)"]
      : [
          "id\tname\tconfidence\tnext_revision_at_ms\tnext_revision_at\tsm2_interval",
          ...report.topics.map((topic) =>
            [
              sanitize(topic.id),
              sanitize(topic.name),
              topic.confidence == null ? "none" : String(topic.confidence),
              topic.nextRevisionAt == null ? "none" : String(topic.nextRevisionAt),
              formatInstant(topic.nextRevisionAt),
              topic.sm2Interval == null ? "none" : String(topic.sm2Interval),
            ].join("\t"),
          ),
        ];

  const lines = [
    "# dev metrics (read-only)",
    `# generated_at: ${report.generatedAt}`,
    `# db: ${sanitize(report.dbLabel)}`,
    `# now_ms: ${report.nowMs}`,
    "# sessions.study_duration is summed as minutes",
    "# topics.next_revision_at is the SM-2 next review (plan name: next_review)",
    "# problem_reviews_due: retired = 0 AND suspended = 0 AND due IS NOT NULL AND due <= now_ms",
    "# coach_used_attempts: problem_attempts.used_coach > 0",
    `sessions: ${report.sessions}`,
    `total_minutes: ${report.totalMinutes}`,
    `attempts: ${report.attempts}`,
    `coach_used_attempts: ${report.coachUsedAttempts}`,
    `problem_reviews: ${report.problemReviews}`,
    `problem_reviews_due: ${report.problemReviewsDue}`,
    `cards: ${report.cards}`,
    `card_events: ${report.cardEvents}`,
    `last_chat_message_at: ${formatInstant(report.lastChatMessageAt)}`,
    `curriculum_active_topic_id: ${
      report.curriculumActiveTopicId == null ? "none" : sanitize(report.curriculumActiveTopicId)
    }`,
    "problems_by_status:",
    ...section(
      report.problemsByStatus.map((row) => `  ${sanitize(row.status)}: ${row.count}`),
    ),
    "mistake_tags:",
    ...section(report.mistakeTags.map((row) => `  ${sanitize(row.tag)}: ${row.count}`)),
    "topics:",
    ...topicLines,
  ];
  return `${lines.join("\n")}\n`;
}

function withTempCopy(repoRoot, dbPath, fn) {
  const dir = mkdtempSync(join(tmpdir(), "dsa-dev-metrics-"));
  const copyPath = join(dir, "read.db");
  try {
    assertInsideDevDir(repoRoot, dbPath);
    const stat = lstatSync(dbPath);
    if (stat.isSymbolicLink()) {
      throw fail(`Refusing to follow symlink ${dbPath}.`);
    }
    if (!stat.isFile()) {
      throw fail(`Refusing ${dbPath}: expected a database file.`);
    }
    copyFileSync(dbPath, copyPath);
    for (const suffix of ["-wal", "-shm"]) {
      const side = `${dbPath}${suffix}`;
      if (!existsSync(side)) continue;
      assertInsideDevDir(repoRoot, side);
      if (lstatSync(side).isSymbolicLink()) {
        throw fail(`Refusing to follow symlink ${side}.`);
      }
      copyFileSync(side, `${copyPath}${suffix}`);
    }
    const db = new DatabaseSync(copyPath);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function runDevMetrics({ repoRoot, env = process.env, now = new Date() }) {
  const paths = resolveDevDbPaths(repoRoot, env);
  assertInsideDevDir(paths.repoRoot, paths.devDb);
  let stat;
  try {
    stat = lstatSync(paths.devDb);
  } catch {
    stat = undefined;
  }
  if (stat?.isSymbolicLink()) {
    throw fail(`Refusing to follow symlink ${paths.devDb}.`);
  }
  if (!stat?.isFile()) {
    throw fail(
      `No dev database at ${paths.devDb}. This script does not create a database.`,
    );
  }

  let collected;
  try {
    collected = withTempCopy(paths.repoRoot, paths.devDb, (db) =>
      collectBaselineMetrics(db, now.getTime()),
    );
  } catch (error) {
    if (error && error.code === "DEV_DB_REFUSED") throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw fail(
      `Could not read metrics (${message}). The dev database must already exist and be migrated. This script does not create or migrate a database.`,
    );
  }

  const dbLabel = relative(paths.repoRoot, paths.devDb).split("\\").join("/");
  return formatBaselineMetrics({
    ...collected,
    generatedAt: now.toISOString(),
    dbLabel,
    nowMs: now.getTime(),
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

function main() {
  if (process.argv.length > 2) {
    console.error("Usage: pnpm dev:metrics");
    console.error(
      "Reads data/dev/dsa.dev.db (or DSA_DB_PATH). Does not accept a database path argument.",
    );
    process.exitCode = 1;
    return;
  }
  try {
    const repoRoot = findRepoRoot();
    process.stdout.write(runDevMetrics({ repoRoot }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (isDirectRun()) main();

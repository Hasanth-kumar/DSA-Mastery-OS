/** Pure helpers for the Today page: problem-start persistence + month stats. */
import type { Session } from "../types/api.js";

const STARTS_STORAGE_KEY = "dsa-problem-starts";

/** Midnight local time — abandoned problem starts from prior days don't count. */
function startOfLocalDayMs(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function loadStarts(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(STARTS_STORAGE_KEY) ?? "{}") as Record<
      string,
      number
    >;
    const cutoff = startOfLocalDayMs();
    const fresh: Record<string, number> = {};
    for (const [id, startedAt] of Object.entries(raw)) {
      if (typeof startedAt === "number" && startedAt >= cutoff) {
        fresh[id] = startedAt;
      }
    }
    // Drop yesterday's abandoned starts so a Mac-app relaunch doesn't show FOCUS forever.
    if (Object.keys(fresh).length !== Object.keys(raw).length) {
      saveStarts(fresh);
    }
    return fresh;
  } catch {
    return {};
  }
}

export function saveStarts(starts: Record<string, number>): void {
  localStorage.setItem(STARTS_STORAGE_KEY, JSON.stringify(starts));
}

/**
 * Problem ids that may keep a Start timer.
 *
 * With the Today queue on, the rows on screen come from `queue.blocks`
 * (Easy-first block problems, the basics offer, mixed-day picks). Those ids
 * are not the old `suggestedProblems` list. Keeping only that list wiped a
 * started Easy row the next time the plan refreshed.
 *
 * With the queue off, the screen is the suggested problems plus re-solves.
 */
export function problemIdsWithTimers(
  plan: {
    suggestedProblems: { problemId: string }[];
    resolveSlots?: { problemId: string }[] | null;
    queue?: { blocks: { problemId: string }[] } | null;
  },
  showingQueue: boolean,
): Set<string> {
  if (showingQueue && plan.queue) {
    return new Set(plan.queue.blocks.map((b) => b.problemId));
  }
  return new Set([
    ...plan.suggestedProblems.map((p) => p.problemId),
    ...(plan.resolveSlots ?? []).map((s) => s.problemId),
  ]);
}

/** Drop timers for problems no longer on screen. One-at-a-time keeps the latest. */
export function retainStarts(
  starts: Record<string, number>,
  allowed: Set<string>,
  singleActive: boolean,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [id, startedAt] of Object.entries(starts)) {
    if (allowed.has(id)) next[id] = startedAt;
  }
  if (singleActive) {
    const latest = Object.entries(next).sort((a, b) => b[1] - a[1])[0];
    for (const id of Object.keys(next)) if (id !== latest?.[0]) delete next[id];
  }
  return next;
}

export function sameStarts(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((id) => a[id] === b[id]);
}

function isCurrentMonth(dateMs: number, now = new Date()): boolean {
  const d = new Date(dateMs);
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

export function sessionsThisMonth(sessions: Session[]): number {
  const now = new Date();
  return sessions.filter((s) => isCurrentMonth(s.date, now)).length;
}

export function studyHoursThisMonth(sessions: Session[]): number {
  const now = new Date();
  const mins = sessions
    .filter((s) => isCurrentMonth(s.date, now))
    .reduce((sum, s) => sum + (s.studyDuration ?? 0), 0);
  return Math.round((mins / 60) * 10) / 10;
}

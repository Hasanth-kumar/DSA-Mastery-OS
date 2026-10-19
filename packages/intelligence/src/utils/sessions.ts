import type { SessionSnapshot } from "../types.js";

/**
 * The `n` most recent sessions, newest first — independent of the order the
 * caller stored them in. (The topic snapshot builder sorts newest-first while
 * the orchestrator appends the new session last, so "slice from the end" used
 * to mean "the oldest sessions" for mirror-built topics.)
 */
export function latestSessions(sessions: SessionSnapshot[], n: number): SessionSnapshot[] {
  return [...sessions]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, Math.max(0, n));
}

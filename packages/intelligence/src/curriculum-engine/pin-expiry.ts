/**
 * Manual topic pin expiry (overhaul P3.3, D2 answered 2026-10-24).
 *
 * A pin is a user override, but it must not hold the curriculum forever. It
 * ends when the pinned topic's first pass is complete (every problem covered,
 * per `problem-progress.ts`) or after `PIN_MAX_AGE_DAYS`, whichever comes
 * first. Pure: the caller clears the pin and logs the reason.
 */
import type { TopicProblemCounts } from "./CurriculumEngine.js";

export const PIN_MAX_AGE_DAYS = 7;
const DAY_MS = 86_400_000;

export type PinExpiryReason = "first-pass-complete" | "max-age";

export type PinExpiryDecision =
  | { expired: false; expiresAt: number | null }
  | { expired: true; reason: PinExpiryReason };

export interface PinExpiryInput {
  /** When the pin was set, ms. Null for a pin from before P3.3 (no clock yet). */
  pinnedAt: number | null;
  /** First-pass counts for the pinned topic. */
  counts: TopicProblemCounts | undefined;
  now: number;
  maxAgeDays?: number;
}

export function evaluatePinExpiry(input: PinExpiryInput): PinExpiryDecision {
  const { pinnedAt, counts, now, maxAgeDays = PIN_MAX_AGE_DAYS } = input;
  if (counts && counts.total > 0 && counts.unsolved === 0) {
    return { expired: true, reason: "first-pass-complete" };
  }
  if (pinnedAt == null) return { expired: false, expiresAt: null };
  const expiresAt = pinnedAt + maxAgeDays * DAY_MS;
  if (now >= expiresAt) return { expired: true, reason: "max-age" };
  return { expired: false, expiresAt };
}

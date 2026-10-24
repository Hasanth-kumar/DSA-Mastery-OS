/**
 * P4.1 — topic urgency from problem-level FSRS instead of topic SM-2
 * (`verification.md` F4). Pure.
 *
 * A topic is due when at least one of its active re-solves is due. Urgency is
 * 0.6 on the day the first one falls due (so "Review soon" fires) and rises to
 * 1.0 once the most overdue one is two weeks late. No due re-solve means 0. A
 * topic never studied and with no re-solves keeps the "never studied" rule (1.0).
 */
import { differenceInDays } from "../utils/dates.js";

export const RESOLVE_URGENCY_DUE_FLOOR = 0.6;
export const RESOLVE_URGENCY_FULL_DAYS = 14;

export interface ResolveUrgencyInput {
  lastRevised: Date | null;
  /** Due dates of the topic's active re-solves; null = not yet scheduled. */
  resolveDueAt: readonly (Date | null)[];
}

export interface ResolveDueSummary {
  /** Active re-solves due now or earlier. */
  dueCount: number;
  /** Whole days the most overdue one is late (0 when due today or none due). */
  maxDaysOverdue: number;
}

export function summarizeResolveDue(
  resolveDueAt: readonly (Date | null)[],
  now: Date,
): ResolveDueSummary {
  let dueCount = 0;
  let maxDaysOverdue = 0;
  for (const due of resolveDueAt) {
    if (!due || due.getTime() > now.getTime()) continue;
    dueCount += 1;
    maxDaysOverdue = Math.max(maxDaysOverdue, differenceInDays(now, due));
  }
  return { dueCount, maxDaysOverdue };
}

export function resolveUrgencyScore(input: ResolveUrgencyInput, now: Date): number {
  if (!input.lastRevised && input.resolveDueAt.length === 0) return 1.0;
  const { dueCount, maxDaysOverdue } = summarizeResolveDue(input.resolveDueAt, now);
  if (dueCount === 0) return 0;
  const lateness = Math.min(1, maxDaysOverdue / RESOLVE_URGENCY_FULL_DAYS);
  return RESOLVE_URGENCY_DUE_FLOOR + (1 - RESOLVE_URGENCY_DUE_FLOOR) * lateness;
}

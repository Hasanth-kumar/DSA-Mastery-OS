import type { TopicState } from "../types.js";
import { addDays } from "../utils/dates.js";
import { maxIntervalDaysForConfidence } from "./sm2.js";

/** One topic whose stored review schedule is longer than its confidence allows. */
export interface ScheduleRepairItem {
  topicId: string;
  name: string;
  confidence: number;
  currentIntervalDays: number;
  currentNextRevisionAt: Date | null;
  newIntervalDays: number;
  newNextRevisionAt: Date | null;
  reason: string;
}

/**
 * Find topics with review intervals/dates beyond what their confidence allows
 * (e.g. a 30%-confidence topic scheduled for 2030) and propose a corrected
 * schedule. Pure: callers decide whether to apply it.
 *
 * A repaired date is never in the past: a future date beyond the cap whose
 * allowed date has already passed lands tomorrow, so the compressed daily queue
 * (not a guilt-list) decides the order. A date already in the past is left as
 * is, since the topic is already due; only an over-long interval is shortened.
 */
export function planScheduleRepair(
  topics: TopicState[],
  now: Date = new Date(),
): ScheduleRepairItem[] {
  const items: ScheduleRepairItem[] = [];

  for (const topic of topics) {
    if (topic.status === "Not started") continue;

    const cap = maxIntervalDaysForConfidence(topic.confidence);
    const intervalTooLong = topic.sm2Interval > cap;

    let newNext = topic.nextRevisionAt;
    let dateTooFar = false;
    // A date already in the past is due now, not too far out. Moving it to
    // tomorrow would take due work off today's queue (P2.2), so only future
    // dates are checked against the cap.
    if (topic.nextRevisionAt && topic.nextRevisionAt.getTime() > now.getTime()) {
      const base = topic.lastRevised ?? now;
      const latestAllowed = addDays(base, cap);
      const tomorrow = addDays(now, 1);
      // The repair target is never earlier than tomorrow, so a date at or
      // before it is never "too far". Without this, a re-run keeps moving a
      // repaired date forward one day at a time (P2.2).
      const ceiling = latestAllowed.getTime() > tomorrow.getTime() ? latestAllowed : tomorrow;
      if (topic.nextRevisionAt.getTime() > ceiling.getTime()) {
        dateTooFar = true;
        newNext = ceiling;
      }
    }

    if (!intervalTooLong && !dateTooFar) continue;

    items.push({
      topicId: topic.id,
      name: topic.name,
      confidence: topic.confidence,
      currentIntervalDays: topic.sm2Interval,
      currentNextRevisionAt: topic.nextRevisionAt,
      newIntervalDays: Math.min(topic.sm2Interval, cap),
      newNextRevisionAt: newNext,
      reason: `Confidence ${topic.confidence}% allows at most ${cap} days between reviews`,
    });
  }

  return items.sort(
    (a, b) => b.currentIntervalDays - a.currentIntervalDays || a.name.localeCompare(b.name),
  );
}

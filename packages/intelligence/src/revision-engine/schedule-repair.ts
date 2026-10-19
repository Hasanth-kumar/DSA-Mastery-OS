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
 * A repaired date is never in the past: overdue repairs land tomorrow, so the
 * compressed daily queue (not a guilt-list) decides the order.
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
    if (topic.nextRevisionAt) {
      const base = topic.lastRevised ?? now;
      const latestAllowed = addDays(base, cap);
      if (topic.nextRevisionAt.getTime() > latestAllowed.getTime()) {
        dateTooFar = true;
        const tomorrow = addDays(now, 1);
        newNext = latestAllowed.getTime() > tomorrow.getTime() ? latestAllowed : tomorrow;
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

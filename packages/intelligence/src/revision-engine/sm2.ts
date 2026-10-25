import type { SessionSnapshot, SM2State, TopicState } from "../types.js";
import { addDays } from "../utils/dates.js";

/** Read persisted SM-2 state from a topic (falls back to SM-2 defaults). */
export function readSM2State(topic: TopicState, now: Date = new Date()): SM2State {
  return {
    interval: topic.sm2Interval ?? 1,
    repetition: topic.sm2Repetition ?? 0,
    efactor: topic.sm2Efactor ?? 2.5,
    nextRevisionAt: topic.nextRevisionAt ?? topic.lastRevised ?? now,
  };
}

/**
 * Longest allowed review interval (days) for a topic at a given confidence.
 * Plain SM-2 grows intervals geometrically, which pushed a 30%-confidence topic
 * out to 2030. Low confidence must keep coming back soon.
 */
export function maxIntervalDaysForConfidence(confidence: number): number {
  if (confidence < 40) return 7;
  if (confidence < 60) return 21;
  if (confidence < 80) return 45;
  return 120;
}

/** SM-2 quality: 0–5 (0 = blackout, 5 = perfect). `maxInterval` caps the new interval in days. */
export function sm2Update(
  state: SM2State,
  quality: number,
  now: Date = new Date(),
  maxInterval: number = Number.POSITIVE_INFINITY,
): SM2State {
  if (quality < 3) {
    return {
      ...state,
      interval: 1,
      repetition: 0,
      efactor: Math.max(1.3, state.efactor - 0.2),
      nextRevisionAt: addDays(now, 1),
    };
  }

  const newEfactor = Math.max(
    1.3,
    state.efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  let newInterval: number;
  if (state.repetition === 0) newInterval = 1;
  else if (state.repetition === 1) newInterval = 6;
  else newInterval = Math.round(state.interval * newEfactor);
  newInterval = Math.max(1, Math.min(newInterval, maxInterval));

  return {
    interval: newInterval,
    repetition: state.repetition + 1,
    efactor: newEfactor,
    nextRevisionAt: addDays(now, newInterval),
  };
}

export function topicToSM2Quality(
  _topic: TopicState,
  session: SessionSnapshot,
): number {
  const productivityNorm = session.productivityScore / 100;
  if (productivityNorm < 0.3) return 1;
  if (productivityNorm < 0.5) return 2;
  if (productivityNorm < 0.65) return 3;
  if (productivityNorm < 0.8) return 4;
  return 5;
}

import type { SessionSnapshot, TopicState } from "../types.js";
import { addDays, differenceInDays, isBefore } from "../utils/dates.js";
import type { SM2State } from "../types.js";
import {
  maxIntervalDaysForConfidence,
  readSM2State,
  sm2Update,
  topicToSM2Quality,
} from "./sm2.js";

export class RevisionEngine {
  isDue(topic: TopicState, now: Date = new Date()): boolean {
    if (topic.status === "Not started") return false;
    if (!topic.nextRevisionAt) return true;
    return isBefore(topic.nextRevisionAt, now);
  }

  getRevisionQueue(topics: TopicState[], now: Date = new Date()): TopicState[] {
    return topics
      .filter((t) => t.status !== "Not started" && this.isDue(t, now))
      .sort((a, b) => {
        const aDays = a.nextRevisionAt
          ? differenceInDays(now, a.nextRevisionAt)
          : 999;
        const bDays = b.nextRevisionAt
          ? differenceInDays(now, b.nextRevisionAt)
          : 999;
        return bDays - aDays;
      });
  }

  /**
   * Catch-up compression for intermittent use: when more than `overdueTolerance`
   * topics are due at once, only `maxPerDay` go into today's plan; the rest are
   * deferred (rescheduled forward) instead of stacking into a guilt-list.
   */
  compressQueue(
    queue: TopicState[],
    options: { maxPerDay?: number; overdueTolerance?: number } = {},
    now: Date = new Date(),
  ): { active: TopicState[]; deferred: { topic: TopicState; nextRevisionAt: Date }[] } {
    const maxPerDay = options.maxPerDay ?? 2;
    const overdueTolerance = options.overdueTolerance ?? 3;

    if (queue.length <= overdueTolerance) {
      return { active: queue, deferred: [] };
    }

    const active = queue.slice(0, maxPerDay);
    const deferred = queue.slice(maxPerDay).map((topic, i) => ({
      topic,
      // Spread the backlog forward at maxPerDay topics per day, starting tomorrow.
      nextRevisionAt: addDays(now, Math.floor(i / maxPerDay) + 1),
    }));

    return { active, deferred };
  }

  updateAfterSession(
    topic: TopicState,
    session: SessionSnapshot,
  ): SM2State {
    const quality = topicToSM2Quality(topic, session);
    return this.applyQuality(topic, quality);
  }

  /** Apply an explicit SM-2 quality (0–5), e.g. from a recall warm-up self-grade. */
  applyQuality(topic: TopicState, quality: number, now: Date = new Date()): SM2State {
    return sm2Update(
      readSM2State(topic, now),
      quality,
      now,
      maxIntervalDaysForConfidence(topic.confidence),
    );
  }
}

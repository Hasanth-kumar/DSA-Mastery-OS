/**
 * Phase 2 — Persist real SM-2 state on the topic (TDD spec).
 *
 * RED until Phase 2 lands. These tests define the target API:
 *   1. `sm2Update(state, quality, now)` — `now` is INJECTABLE (today it calls
 *      `new Date()` internally, so intervals can't be asserted deterministically).
 *   2. `TopicState` carries persisted SM-2 state: `sm2Interval`, `sm2Repetition`,
 *      `sm2Efactor` (mirrored to `topics.sm2_interval/_repetition/_efactor`).
 *   3. `RevisionEngine.applyQuality(topic, quality, now)` CONTINUES from the
 *      persisted `sm2_*` state instead of reconstructing `interval` from
 *      `revisionCount` and `efactor` from `confidence`.
 *
 * Acceptance bar: SM-2 intervals are deterministic and monotonic on fixed
 * fixtures, and prior grades are never "forgotten."
 */
import { describe, expect, it } from "vitest";
import { addDays } from "../utils/dates.js";
import { FIXED_NOW, makeTopic } from "../test-fixtures/sample-topics.js";
import type { SM2State, TopicState } from "../types.js";
import { sm2Update } from "./sm2.js";
import { RevisionEngine } from "./RevisionEngine.js";

/** A topic carrying explicit persisted SM-2 state (Phase 2 schema fields). */
type PersistedTopic = TopicState & {
  sm2Interval: number;
  sm2Repetition: number;
  sm2Efactor: number;
};

function persisted(
  over: Partial<PersistedTopic> & Pick<TopicState, "id" | "name">,
): PersistedTopic {
  return {
    ...makeTopic(over),
    sm2Interval: over.sm2Interval ?? 0,
    sm2Repetition: over.sm2Repetition ?? 0,
    sm2Efactor: over.sm2Efactor ?? 2.5,
  };
}

const freshState: SM2State = {
  interval: 0,
  repetition: 0,
  efactor: 2.5,
  nextRevisionAt: FIXED_NOW,
};

describe("sm2Update — deterministic with injected clock (Phase 2)", () => {
  it("Easy (q=5) on first review: interval 1 day, efactor rises", () => {
    const next = sm2Update(freshState, 5, FIXED_NOW);
    expect(next.interval).toBe(1);
    expect(next.repetition).toBe(1);
    expect(next.efactor).toBeCloseTo(2.6, 5);
    expect(next.nextRevisionAt.getTime()).toBe(addDays(FIXED_NOW, 1).getTime());
  });

  it("Hard (q=3): advances but efactor decreases", () => {
    const next = sm2Update(freshState, 3, FIXED_NOW);
    expect(next.repetition).toBe(1);
    expect(next.efactor).toBeLessThan(freshState.efactor);
    expect(next.efactor).toBeGreaterThanOrEqual(1.3);
  });

  it("Forgot (q<3): resets repetition/interval, efactor floored at 1.3", () => {
    const low: SM2State = { ...freshState, efactor: 1.4, repetition: 4, interval: 30 };
    const next = sm2Update(low, 1, FIXED_NOW);
    expect(next.repetition).toBe(0);
    expect(next.interval).toBe(1);
    expect(next.efactor).toBe(1.3); // max(1.3, 1.4 - 0.2)
    expect(next.nextRevisionAt.getTime()).toBe(addDays(FIXED_NOW, 1).getTime());
  });

  it("repeated success produces a strictly monotonic increasing interval", () => {
    let state = freshState;
    const intervals: number[] = [];
    for (let i = 0; i < 5; i++) {
      state = sm2Update(state, 5, FIXED_NOW);
      intervals.push(state.interval);
    }
    // 1, 6, then interval * efactor — each strictly greater than the last.
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    }
    expect(intervals[0]).toBe(1);
    expect(intervals[1]).toBe(6);
  });

  it("overdue review schedules from `now`, not from the old due date", () => {
    // A review that happens 100 days late still schedules the next one relative
    // to when it actually happened (now), not the original nextRevisionAt.
    const stale: SM2State = {
      interval: 6,
      repetition: 2,
      efactor: 2.5,
      nextRevisionAt: addDays(FIXED_NOW, -100),
    };
    const next = sm2Update(stale, 5, FIXED_NOW);
    expect(next.nextRevisionAt.getTime()).toBe(
      addDays(FIXED_NOW, next.interval).getTime(),
    );
  });
});

describe("RevisionEngine.applyQuality — continues from persisted state (Phase 2)", () => {
  const engine = new RevisionEngine();

  it("reads persisted sm2_* state, not revisionCount/confidence", () => {
    // revisionCount is intentionally INCONSISTENT with the persisted SM-2 state.
    // The engine must trust sm2_* — reconstruction from revisionCount (0) would
    // give interval 1, proving the bug if it returns 1. Confidence is high here
    // so the low-confidence interval cap (tested below) does not interfere.
    const topic = persisted({
      id: "t",
      name: "T",
      revisionCount: 0,
      confidence: 90,
      sm2Interval: 6,
      sm2Repetition: 2,
      sm2Efactor: 2.5,
    });

    const next = engine.applyQuality(topic, 5, FIXED_NOW);

    expect(next.repetition).toBe(3); // 2 + 1, NOT reset to 1
    expect(next.interval).toBe(Math.round(6 * (2.5 + 0.1))); // 16, from stored 6
    expect(next.interval).not.toBe(1);
    expect(next.nextRevisionAt.getTime()).toBe(
      addDays(FIXED_NOW, next.interval).getTime(),
    );
  });

  it("caps the interval for a low-confidence topic even when the stored state would grow it", () => {
    const topic = persisted({
      id: "t",
      name: "T",
      confidence: 10,
      sm2Interval: 6,
      sm2Repetition: 2,
      sm2Efactor: 2.5,
    });

    const next = engine.applyQuality(topic, 5, FIXED_NOW);

    expect(next.repetition).toBe(3); // progress is still recorded...
    expect(next.interval).toBe(7); // ...but a 10%-confidence topic is seen within a week
  });

  it("a Forgot grade does not erase the fact that prior reviews happened", () => {
    const topic = persisted({
      id: "t",
      name: "T",
      sm2Interval: 30,
      sm2Repetition: 5,
      sm2Efactor: 2.2,
    });
    const next = engine.applyQuality(topic, 1, FIXED_NOW);
    // Repetition resets (SM-2 lapse), but efactor degrades from the *stored*
    // 2.2 — it is not silently reset to the 2.5 default.
    expect(next.repetition).toBe(0);
    expect(next.efactor).toBeCloseTo(2.0, 5);
  });
});

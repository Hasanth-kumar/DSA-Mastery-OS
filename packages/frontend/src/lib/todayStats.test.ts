import { describe, expect, it } from "vitest";
import { problemIdsWithTimers, retainStarts, sameStarts } from "./todayStats.js";

/**
 * The queue shows Easy-first problems that are not `suggestedProblems`.
 * A plan refresh used to drop their Start timers, so the row looked unstarted.
 */
const queuePlan = {
  suggestedProblems: [
    { problemId: "medium-1" },
    { problemId: "medium-2" },
  ],
  resolveSlots: [{ problemId: "resolve-1" }],
  queue: {
    blocks: [
      { problemId: "easy-1" },
      { problemId: "easy-basic" },
    ],
  },
};

describe("problem start timers", () => {
  it("keeps a started Easy queue problem that is not on the old suggestion list", () => {
    const allowed = problemIdsWithTimers(queuePlan, true);
    const starts = { "easy-1": 1_000 };
    expect(retainStarts(starts, allowed, true)).toEqual(starts);
  });

  it("drops a timer for a problem that left the queue, so the focus strip cannot stick", () => {
    const allowed = problemIdsWithTimers(queuePlan, true);
    expect(retainStarts({ "yesterday-problem": 1_000 }, allowed, true)).toEqual({});
  });

  it("keeps only the latest start when one problem at a time is on", () => {
    const allowed = problemIdsWithTimers(queuePlan, true);
    expect(
      retainStarts({ "easy-1": 1_000, "easy-basic": 2_000 }, allowed, true),
    ).toEqual({ "easy-basic": 2_000 });
  });

  it("with the queue off, keeps suggested problems and re-solves", () => {
    const allowed = problemIdsWithTimers(queuePlan, false);
    expect(retainStarts({ "medium-1": 1, "resolve-1": 2, "easy-1": 3 }, allowed, false)).toEqual({
      "medium-1": 1,
      "resolve-1": 2,
    });
  });

  it("treats an unchanged timer map as the same", () => {
    expect(sameStarts({ "easy-1": 1 }, { "easy-1": 1 })).toBe(true);
    expect(sameStarts({ "easy-1": 1 }, {})).toBe(false);
  });
});

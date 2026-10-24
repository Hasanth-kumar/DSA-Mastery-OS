import { describe, expect, it } from "vitest";
import { buildTodayQueue, type TodayQueueInput } from "./TodayQueue.js";
import type { ProblemSuggestion, ResolvePlanSlot } from "../types.js";

// 2026-10-18 is a Sunday; the week is Mon 12 – Sun 18.
const TODAY = "2026-10-18";

const resolve = (
  id: string,
  difficulty: ResolvePlanSlot["difficulty"],
  topicId: string,
  daysOverdue = 3,
): ResolvePlanSlot => ({
  problemId: id,
  name: `Problem ${id}`,
  difficulty,
  leetcodeLink: null,
  topicId,
  daysOverdue,
  promoted: false,
  reason: "2 mistakes, used coach",
});
const fresh = (id: string, difficulty: ProblemSuggestion["difficulty"]): ProblemSuggestion => ({
  problemId: id,
  name: `New ${id}`,
  difficulty,
  leetcodeLink: `https://leetcode.com/problems/${id}/`,
});

const base = (over: Partial<TodayQueueInput> = {}): TodayQueueInput => ({
  todayKey: TODAY,
  activeDayKeys: ["2026-10-16", "2026-10-17"],
  dueResolves: [resolve("r1", "Medium", "t-primary", 5), resolve("r2", "Easy", "t-other", 3)],
  newProblems: [fresh("n1", "Easy"), fresh("n2", "Medium"), fresh("n3", "Medium")],
  topic: { id: "t-primary", name: "Greedy Sorting", stage: "learning", covered: 2, total: 6 },
  why: "Next up: Greedy Sorting.",
  progressionReason: "Learning: Easy first",
  ...over,
});

describe("buildTodayQueue (P5.1)", () => {
  it("one re-solve first, preferring another pattern, then progression problems", () => {
    const q = buildTodayQueue(base());
    expect(q.blocks.map((b) => [b.kind, b.problemId])).toEqual([
      ["resolve", "r2"], // r1 is more overdue but on today's own pattern
      ["progression", "n1"],
      ["progression", "n2"],
    ]);
  });

  it("takes the most overdue re-solve when every due one is on today's pattern", () => {
    const q = buildTodayQueue(
      base({ dueResolves: [resolve("r1", "Medium", "t-primary", 5), resolve("r3", "Easy", "t-primary", 1)] }),
    );
    expect(q.blocks.filter((b) => b.kind === "resolve").map((b) => b.problemId)).toEqual(["r1"]);
  });

  it("never more than one re-solve, and at most two progression problems", () => {
    const q = buildTodayQueue(base());
    expect(q.blocks.filter((b) => b.kind === "resolve")).toHaveLength(1);
    expect(q.blocks.filter((b) => b.kind === "progression")).toHaveLength(2);
  });

  it("adds the second progression problem only if it fits the budget", () => {
    // Medium re-solve (35) + Medium (35) leaves 20 of 90: a second Medium (35) does not fit.
    const q = buildTodayQueue(
      base({
        dueResolves: [resolve("r1", "Medium", "t-other")],
        newProblems: [fresh("n2", "Medium"), fresh("n3", "Medium")],
      }),
    );
    expect(q.blocks.map((b) => b.problemId)).toEqual(["r1", "n2"]);
    expect(q.totalMinutes).toBeLessThanOrEqual(90);
  });

  it("always keeps the first progression problem, even over budget", () => {
    const q = buildTodayQueue(base({ minutes: 30, dueResolves: [resolve("r1", "Medium", "t-other")] }));
    expect(q.blocks.map((b) => b.problemId)).toEqual(["r1", "n1"]);
  });

  it("hides the pattern on re-solves and shows it on a block day's own problems", () => {
    const q = buildTodayQueue(base());
    const [r, p] = q.blocks;
    expect(r.revealPattern).toBe(false);
    expect(r).not.toHaveProperty("topicName");
    expect(r.topicId).toBe("t-other"); // opaque id for logging only
    expect(r.reason).not.toContain("Greedy");
    expect(p.revealPattern).toBe(true);
    expect(p.topicName).toBe("Greedy Sorting");
    expect(q.decision.topic?.name).toBe("Greedy Sorting");
  });

  it("on a mixed day nothing carries a pattern name", () => {
    const q = buildTodayQueue(base({ dayKind: "mixed" }));
    expect(q.dayKind).toBe("mixed");
    expect(q.blocks.every((b) => !b.revealPattern && b.topicName === undefined)).toBe(true);
    expect(q.decision.topic).toBeNull();
    expect(JSON.stringify(q)).not.toContain("Greedy Sorting");
  });

  it("dates a re-solve by the day it fell due", () => {
    const q = buildTodayQueue(base());
    expect(q.blocks[0].dueSince).toBe("2026-10-15"); // 3 days overdue on Oct 18
  });

  it("after a gap of 3+ days: one short Easy problem, no backlog", () => {
    const q = buildTodayQueue(base({ activeDayKeys: ["2026-10-10"] }));
    expect(q.decision.mode).toBe("reentry");
    expect(q.blocks).toHaveLength(1);
    expect(q.blocks[0]).toMatchObject({ kind: "resolve", problemId: "r2", minutes: 20 });
    expect(q.decision.why).toContain("8 days");
  });

  it("re-entry with nothing due starts the easiest new problem", () => {
    const q = buildTodayQueue(
      base({ activeDayKeys: ["2026-10-10"], dueResolves: [], newProblems: [fresh("n2", "Medium"), fresh("n1", "Easy")] }),
    );
    expect(q.blocks.map((b) => [b.kind, b.problemId, b.minutes])).toEqual([["progression", "n1", 20]]);
  });

  it("skips placeholder suggestions and reports the week", () => {
    const q = buildTodayQueue(
      base({ dueResolves: [], newProblems: [{ problemId: "t-suggested-1", name: "Add problems", difficulty: "Easy" }] }),
    );
    expect(q.blocks).toEqual([]);
    expect(q.decision.week).toMatchObject({ target: 5, done: 2 });
  });
});

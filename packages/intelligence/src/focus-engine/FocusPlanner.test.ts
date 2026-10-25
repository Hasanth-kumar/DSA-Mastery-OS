import { describe, expect, it } from "vitest";
import { buildFocusPlan, type FocusInput } from "./FocusPlanner.js";
import type { ProblemSuggestion, ResolvePlanSlot } from "../types.js";

// 2026-10-18 is a Sunday; the week is Mon 12 – Sun 18.
const TODAY = "2026-10-18";

const resolve = (id: string, difficulty: ResolvePlanSlot["difficulty"], daysOverdue = 3): ResolvePlanSlot => ({
  problemId: id, name: `Problem ${id}`, difficulty, leetcodeLink: null, topicId: null, daysOverdue, promoted: false, reason: "mistake",
});
const fresh = (id: string, difficulty: ProblemSuggestion["difficulty"]): ProblemSuggestion => ({
  problemId: id, name: `New ${id}`, difficulty,
});

const base = (over: Partial<FocusInput> = {}): FocusInput => ({
  todayKey: TODAY,
  activeDayKeys: ["2026-10-16", "2026-10-17"],
  dueResolves: [resolve("r1", "Medium"), resolve("r2", "Easy")],
  newProblems: [fresh("n1", "Easy")],
  primaryTopicName: "Two Pointers",
  topMistake: { tag: "off-by-one", count: 23 },
  ...over,
});

describe("buildFocusPlan", () => {
  it("puts the overdue re-solve first, then new material, then logging", () => {
    const plan = buildFocusPlan(base());
    expect(plan.mode).toBe("normal");
    expect(plan.blocks.map((b) => b.kind)).toEqual(["resolve", "learn", "log"]);
    expect(plan.blocks[0].problemId).toBe("r1");
  });

  it("fits inside the time budget", () => {
    const plan = buildFocusPlan(base({ minutes: 60 }));
    expect(plan.totalMinutes).toBeLessThanOrEqual(60);
  });

  it("shrinks to one easy problem after a gap (re-entry), with no backlog", () => {
    const plan = buildFocusPlan(base({ activeDayKeys: ["2026-10-10"] }));
    expect(plan.mode).toBe("reentry");
    expect(plan.gapDays).toBe(8);
    expect(plan.blocks.filter((b) => b.kind !== "log")).toHaveLength(1);
    expect(plan.blocks[0].difficulty).toBe("Easy");
    expect(plan.totalMinutes).toBeLessThanOrEqual(25);
    expect(plan.reason.toLowerCase()).not.toContain("overdue");
  });

  it("reports done when today already has a session", () => {
    const plan = buildFocusPlan(base({ activeDayKeys: [TODAY, "2026-10-17"] }));
    expect(plan.mode).toBe("done");
    expect(plan.gapDays).toBe(0);
    expect(plan.blocks.length).toBeLessThanOrEqual(1);
  });

  it("counts the week Monday to Sunday and flags when finishing is at risk", () => {
    const plan = buildFocusPlan(base({
      todayKey: "2026-10-14", // Wednesday
      activeDayKeys: ["2026-10-12"],
      weeklyTarget: 5,
    }));
    expect(plan.week.done).toBe(1);
    expect(plan.week.remaining).toBe(4);
    expect(plan.week.daysLeft).toBe(5); // Wed..Sun
    expect(plan.week.onTrack).toBe(true);

    const behind = buildFocusPlan(base({ todayKey: "2026-10-18", activeDayKeys: ["2026-10-12"], weeklyTarget: 5 }));
    expect(behind.week.onTrack).toBe(false);
  });

  it("does not count last week's sessions", () => {
    const plan = buildFocusPlan(base({ todayKey: "2026-10-14", activeDayKeys: ["2026-10-09", "2026-10-10"] }));
    expect(plan.week.done).toBe(0);
  });

  it("attaches a checklist for the top mistake", () => {
    const plan = buildFocusPlan(base());
    expect(plan.tip?.tag).toBe("off-by-one");
    expect(plan.tip?.checklist.length).toBeGreaterThan(0);
  });

  it("falls back to a generic block when nothing is due and nothing is queued", () => {
    const plan = buildFocusPlan(base({ dueResolves: [], newProblems: [] }));
    expect(plan.blocks[0].kind).toBe("learn");
    expect(plan.blocks[0].title).toContain("Two Pointers");
  });

  it("ignores placeholder suggestions that are not real problems", () => {
    const plan = buildFocusPlan(base({ dueResolves: [], newProblems: [fresh("topic-suggested-0", "Easy")] }));
    expect(plan.blocks[0].problemId).toBeUndefined();
  });

  it("treats a brand-new learner (no history) as a normal day", () => {
    const plan = buildFocusPlan(base({ activeDayKeys: [] }));
    expect(plan.mode).toBe("normal");
    expect(plan.gapDays).toBeNull();
  });
});

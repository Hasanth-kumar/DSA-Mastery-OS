import { describe, expect, it } from "vitest";
import { buildFocusPlan } from "./focus-engine/FocusPlanner.js";
import { ProblemReviewEngine } from "./problem-review-engine/ProblemReviewEngine.js";
import { APPROACH_MISTAKE_TAGS, MISTAKE_TAG_LABELS, MISTAKE_TAGS } from "./types.js";
import { MISTAKE_TAG_ADVICE } from "./weakness-engine/signals.js";

describe("closed mistake vocabulary (P6.3)", () => {
  it("one list: every tag has a label and advice, and nothing else does", () => {
    expect(Object.keys(MISTAKE_TAG_LABELS).sort()).toEqual([...MISTAKE_TAGS].sort());
    expect(Object.keys(MISTAKE_TAG_ADVICE).sort()).toEqual([...MISTAKE_TAGS].sort());
    expect(APPROACH_MISTAKE_TAGS.every((t) => MISTAKE_TAGS.includes(t))).toBe(true);
  });

  it("includes the two sharper tags", () => {
    expect(MISTAKE_TAGS).toContain("greedy-invariant");
    expect(MISTAKE_TAGS).toContain("loop-bounds");
  });

  it("every tag gets a FocusPlanner checklist", () => {
    for (const tag of MISTAKE_TAGS) {
      const plan = buildFocusPlan({
        todayKey: "2026-10-18",
        activeDayKeys: ["2026-10-17"],
        dueResolves: [],
        newProblems: [],
        primaryTopicName: "Greedy Sorting",
        topMistake: { tag, count: 3 },
      });
      expect(plan.tip?.checklist.length, tag).toBeGreaterThan(0);
    }
  });

  it("a wrong greedy choice is an approach miss; loop bounds is a detail slip", () => {
    const engine = new ProblemReviewEngine();
    const base = { timeTakenMin: 15, difficulty: "Medium" as const, usedHelp: false };
    expect(engine.inferCompletionRating({ ...base, mistakeTags: ["greedy-invariant"] })).toBe("hard");
    expect(engine.inferCompletionRating({ ...base, mistakeTags: ["loop-bounds"] })).toBe("good");
  });
});

describe("help level (P6.1)", () => {
  const engine = new ProblemReviewEngine();
  const base = { timeTakenMin: 15, difficulty: "Medium" as const, usedHelp: false, mistakeTags: [] as string[] };

  it.each([
    ["none, fast and clean", { helpLevel: "none" }, "easy"],
    ["a hint is still clean but caps at good", { helpLevel: "hint" }, "good"],
    ["a hint and a slow solve", { helpLevel: "hint", timeTakenMin: 60 }, "hard"],
    ["approach help", { helpLevel: "approach" }, "hard"],
    ["approach help and a wrong approach", { helpLevel: "approach", mistakeTags: ["wrong-approach"] }, "again"],
    ["a hint and a wrong approach", { helpLevel: "hint", mistakeTags: ["wrong-approach"] }, "hard"],
    ["full solution", { helpLevel: "solution" }, "again"],
    ["legacy usedHelp counts as approach", { helpLevel: undefined, usedHelp: true }, "hard"],
  ] as const)("%s", (_label, over, rating) => {
    expect(engine.inferCompletionRating({ ...base, ...over, mistakeTags: [...(over.mistakeTags ?? [])] })).toBe(rating);
  });

  it("session score: a hint costs less than approach help, which costs less than a solution", async () => {
    const { deriveSessionOutcomeScore } = await import("./session-outcome.js");
    const score = (helpLevel: "none" | "hint" | "approach" | "solution") =>
      deriveSessionOutcomeScore({ durationMin: 30, difficulty: "Medium", usedHelp: helpLevel !== "none", helpLevel });
    expect(score("none")).toBeGreaterThan(score("hint"));
    expect(score("hint")).toBeGreaterThan(score("approach"));
    expect(score("approach")).toBeGreaterThan(score("solution"));
    // Legacy rows without a level keep the old base.
    expect(deriveSessionOutcomeScore({ durationMin: 30, difficulty: "Medium", usedHelp: true })).toBe(score("approach"));
  });
});

import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROBLEM_REVIEW_CONFIG,
  ProblemReviewEngine,
  type AttemptSignal,
  type CompletionOutcome,
  type ProblemReviewState,
  type ResolveOutcome,
} from "./ProblemReviewEngine.js";

const MS_PER_DAY = 86_400_000;
const engine = new ProblemReviewEngine();

function attempt(overrides: Partial<AttemptSignal> = {}): AttemptSignal {
  return { timeTaken: null, mistakeTags: [], usedCoach: false, hintCount: 0, ...overrides };
}

function outcome(overrides: Partial<ResolveOutcome> = {}): ResolveOutcome {
  return {
    solved: true,
    usedCoach: false,
    hintCount: 0,
    timeTakenMin: null,
    difficulty: "Medium",
    ...overrides,
  };
}

function review(id: string, overrides: Partial<ProblemReviewState> = {}): ProblemReviewState {
  return { problemId: id, due: null, stability: null, lapses: 0, ...overrides };
}

describe("ProblemReviewEngine.shouldAdmit (§4)", () => {
  it("returns null for a problem with no attempts", () => {
    expect(engine.shouldAdmit({ difficulty: "Hard" }, [])).toBeNull();
  });

  it("keeps clean, fast, unaided Easy/Medium solves out of the pool", () => {
    expect(
      engine.shouldAdmit({ difficulty: "Easy" }, [attempt({ timeTaken: 10 })]),
    ).toBeNull();
    expect(
      engine.shouldAdmit({ difficulty: "Medium" }, [attempt({ timeTaken: 45 })]),
    ).toBeNull();
  });

  it("admits by struggle signal with priority mistake > coach > slow > hard", () => {
    const struggling = [
      attempt({ mistakeTags: ["off-by-one"], usedCoach: true, timeTaken: 200 }),
    ];
    expect(engine.shouldAdmit({ difficulty: "Hard" }, struggling)).toBe("mistake");
    expect(
      engine.shouldAdmit({ difficulty: "Hard" }, [attempt({ usedCoach: true, timeTaken: 200 })]),
    ).toBe("coach");
    expect(engine.shouldAdmit({ difficulty: "Hard" }, [attempt({ timeTaken: 200 })])).toBe("slow");
    expect(engine.shouldAdmit({ difficulty: "Hard" }, [attempt({ timeTaken: 10 })])).toBe("hard");
  });

  it("admits on hints alone and uses per-difficulty slow cutoffs", () => {
    expect(engine.shouldAdmit({ difficulty: "Easy" }, [attempt({ hintCount: 1 })])).toBe("coach");
    // 30 min is slow for Easy (25) but fine for Medium (45).
    expect(engine.shouldAdmit({ difficulty: "Easy" }, [attempt({ timeTaken: 30 })])).toBe("slow");
    expect(engine.shouldAdmit({ difficulty: "Medium" }, [attempt({ timeTaken: 30 })])).toBeNull();
    // Unknown difficulty falls back to the Medium cutoff.
    expect(engine.shouldAdmit({ difficulty: null }, [attempt({ timeTaken: 50 })])).toBe("slow");
  });

  it("re-evaluates across the whole history — a later bad attempt admits late", () => {
    const history = [attempt({ timeTaken: 10 }), attempt({ mistakeTags: ["edge-case"] })];
    expect(engine.shouldAdmit({ difficulty: "Easy" }, history)).toBe("mistake");
  });
});

describe("ProblemReviewEngine.inferRating (§5)", () => {
  it("maps the outcome table to ratings", () => {
    expect(engine.inferRating(outcome({ solved: false }))).toBe("again");
    expect(engine.inferRating(outcome({ usedCoach: true }))).toBe("hard");
    expect(engine.inferRating(outcome({ hintCount: 2 }))).toBe("hard");
    expect(engine.inferRating(outcome({ timeTakenMin: 50 }))).toBe("good");
    expect(engine.inferRating(outcome({ timeTakenMin: 20 }))).toBe("easy");
  });

  it("rates an untimed cold solve good, not easy", () => {
    expect(engine.inferRating(outcome({ timeTakenMin: null }))).toBe("good");
  });

  it("uses per-difficulty cutoffs", () => {
    expect(engine.inferRating(outcome({ difficulty: "Hard", timeTakenMin: 60 }))).toBe("easy");
    expect(engine.inferRating(outcome({ difficulty: "Easy", timeTakenMin: 60 }))).toBe("good");
  });
});

function completion(overrides: Partial<CompletionOutcome> = {}): CompletionOutcome {
  return { timeTakenMin: 30, difficulty: "Medium", mistakeTags: [], usedHelp: false, ...overrides };
}

describe("ProblemReviewEngine.inferCompletionRating (P4.2)", () => {
  // Medium target is 45 min, so "fast" is ≤ 22.5 and "slow" is > 45.
  it.each([
    // [label, overrides, rating]
    ["fast and clean", { timeTakenMin: 20 }, "easy"],
    ["exactly half the target", { timeTakenMin: 22.5 }, "easy"],
    ["clean within the target", { timeTakenMin: 40 }, "good"],
    ["clean at the target", { timeTakenMin: 45 }, "good"],
    ["clean but slow", { timeTakenMin: 50 }, "hard"],
    ["untimed and clean", { timeTakenMin: null }, "good"],
    ["fast with an edge-case slip", { timeTakenMin: 15, mistakeTags: ["edge-case"] }, "good"],
    ["fast with an off-by-one", { timeTakenMin: 15, mistakeTags: ["off-by-one"] }, "good"],
    ["slow with an edge-case slip", { timeTakenMin: 60, mistakeTags: ["edge-case"] }, "hard"],
    ["fast but needed help", { timeTakenMin: 15, usedHelp: true }, "hard"],
    ["wrong approach, no help", { timeTakenMin: 30, mistakeTags: ["wrong-approach"] }, "hard"],
    ["could not recall the pattern, no help", { mistakeTags: ["pattern-recall"] }, "hard"],
    ["help and a wrong approach", { usedHelp: true, mistakeTags: ["wrong-approach"] }, "again"],
    ["help and no pattern recall", { usedHelp: true, mistakeTags: ["pattern-recall", "edge-case"] }, "again"],
    ["could not solve", { timeTakenMin: 10, mistakeTags: ["could-not-solve"] }, "again"],
  ] as const)("%s", (_label, overrides, rating) => {
    expect(engine.inferCompletionRating(completion(overrides))).toBe(rating);
  });

  it("judges time against the per-difficulty target", () => {
    expect(engine.inferCompletionRating(completion({ difficulty: "Easy", timeTakenMin: 12 }))).toBe("easy");
    expect(engine.inferCompletionRating(completion({ difficulty: "Easy", timeTakenMin: 30 }))).toBe("hard");
    expect(engine.inferCompletionRating(completion({ difficulty: "Hard", timeTakenMin: 70 }))).toBe("good");
    expect(engine.inferCompletionRating(completion({ difficulty: null, timeTakenMin: 50 }))).toBe("hard");
  });
});

describe("ProblemReviewEngine.selectDueSlots (§6)", () => {
  const now = 100 * MS_PER_DAY;

  it("takes the most overdue problems up to capacity, defers the rest forward", () => {
    const pool = [
      review("fresh", { due: now - 1 * MS_PER_DAY }),
      review("rusty", { due: now - 5 * MS_PER_DAY }),
      review("rustiest", { due: now - 9 * MS_PER_DAY }),
      review("not-due", { due: now + MS_PER_DAY }),
      review("unscheduled"),
    ];
    const { active, deferred } = engine.selectDueSlots(pool, 2, now);
    expect(active.map((s) => s.review.problemId)).toEqual(["rustiest", "rusty"]);
    expect(active[0]!.daysOverdue).toBe(9);
    expect(active.every((s) => !s.promoted)).toBe(true);
    // Overflow rescheduled at capacity/day starting tomorrow, never stacked.
    expect(deferred).toEqual([{ review: pool[0], due: now + MS_PER_DAY }]);
  });

  it("spreads a large backlog forward at capacity per day", () => {
    const pool = Array.from({ length: 6 }, (_, i) =>
      review(`p${i}`, { due: now - (i + 1) * MS_PER_DAY }),
    );
    const { deferred } = engine.selectDueSlots(pool, 2, now);
    expect(deferred.map((d) => (d.due - now) / MS_PER_DAY)).toEqual([1, 1, 2, 2]);
  });

  it("skips retired and suspended problems", () => {
    const pool = [
      review("retired", { due: now - 30 * MS_PER_DAY, retired: true }),
      review("leech", { due: now - 30 * MS_PER_DAY, suspended: true }),
    ];
    expect(engine.selectDueSlots(pool, 2, now)).toEqual({ active: [], deferred: [] });
  });

  it("force-promotes one critically overdue problem even at capacity 0", () => {
    const pool = [
      review("critical", { due: now - 16 * MS_PER_DAY }),
      review("also-critical", { due: now - 15 * MS_PER_DAY }),
      review("merely-due", { due: now - 2 * MS_PER_DAY }),
    ];
    const { active, deferred } = engine.selectDueSlots(pool, 0, now);
    // Hard cap: 1 promotion/day; the rest defer at 1/day.
    expect(active).toEqual([
      { review: pool[0], daysOverdue: 16, promoted: true },
    ]);
    expect(deferred.map((d) => d.review.problemId)).toEqual(["also-critical", "merely-due"]);
  });

  it("does not promote when nothing is past the escalation threshold", () => {
    const pool = [review("p1", { due: now - 14 * MS_PER_DAY })];
    const { active, deferred } = engine.selectDueSlots(pool, 0, now);
    expect(active).toEqual([]);
    expect(deferred).toHaveLength(1);
  });

  it("promotes past a filled capacity when the next problem is critically overdue", () => {
    const pool = [
      review("worst", { due: now - 20 * MS_PER_DAY }),
      review("still-critical", { due: now - 18 * MS_PER_DAY }),
    ];
    const { active } = engine.selectDueSlots(pool, 1, now);
    expect(active.map((s) => [s.review.problemId, s.promoted])).toEqual([
      ["worst", false],
      ["still-critical", true],
    ]);
  });
});

describe("ProblemReviewEngine retirement + leech (§4, §5)", () => {
  it("retires only on a full clean streak with enough stability", () => {
    const stable = { stability: 120 };
    expect(engine.shouldRetire(stable, ["good", "easy", "good"])).toBe(true);
    expect(engine.shouldRetire(stable, ["good", "easy"])).toBe(false);
    expect(engine.shouldRetire(stable, ["good", "hard", "good"])).toBe(false);
    // Streak longer than required: only the most recent N count.
    expect(engine.shouldRetire(stable, ["easy", "good", "good", "again"])).toBe(true);
  });

  it("never retires below the stability threshold", () => {
    expect(engine.shouldRetire({ stability: 89 }, ["good", "good", "good"])).toBe(false);
    expect(engine.shouldRetire({ stability: null }, ["good", "good", "good"])).toBe(false);
  });

  it("flags a leech at the lapse threshold", () => {
    expect(engine.isLeech({ lapses: 3 })).toBe(false);
    expect(engine.isLeech({ lapses: 4 })).toBe(true);
  });
});

describe("config defaults (§12)", () => {
  it("ships the documented defaults", () => {
    expect(DEFAULT_PROBLEM_REVIEW_CONFIG).toEqual({
      slowThresholdMin: { Easy: 25, Medium: 45, Hard: 75 },
      retireCleanStreak: 3,
      retireMinStabilityDays: 90,
      leechLapses: 4,
      escalateDays: 14,
    });
  });
});

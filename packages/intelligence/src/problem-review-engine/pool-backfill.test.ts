import { describe, expect, it } from "vitest";
import {
  ProblemReviewEngine,
  type RevisionNeededCandidate,
} from "./ProblemReviewEngine.js";

const DAY = 86_400_000;
const now = Date.parse("2026-10-24T12:00:00Z");
const engine = new ProblemReviewEngine();

function cand(over: Partial<RevisionNeededCandidate> & { problemId: string }): RevisionNeededCandidate {
  return {
    status: "Revision needed",
    difficulty: "Easy",
    inPool: false,
    attempts: [],
    lastActivityAt: null,
    ...over,
  };
}

describe("planRevisionNeededBackfill (P3.2)", () => {
  it("plans only Revision needed problems that are not in the pool", () => {
    const items = engine.planRevisionNeededBackfill(
      [
        cand({ problemId: "a" }),
        cand({ problemId: "pooled", inPool: true }),
        cand({ problemId: "solved", status: "Solved" }),
        cand({ problemId: "new", status: "Not started" }),
      ],
      now,
    );
    expect(items.map((i) => i.problemId)).toEqual(["a"]);
  });

  it("takes the reason from attempts, and 'mistake' when none are recorded", () => {
    const items = engine.planRevisionNeededBackfill(
      [
        cand({ problemId: "notion-only", lastActivityAt: 1 }),
        cand({
          problemId: "coached",
          lastActivityAt: 2,
          attempts: [{ timeTaken: 10, mistakeTags: [], usedCoach: true, hintCount: 0 }],
        }),
        cand({
          problemId: "tagged",
          lastActivityAt: 3,
          attempts: [{ timeTaken: 10, mistakeTags: ["off-by-one"], usedCoach: true, hintCount: 0 }],
        }),
      ],
      now,
    );
    expect(Object.fromEntries(items.map((i) => [i.problemId, i.reason]))).toEqual({
      "notion-only": "mistake",
      coached: "coach",
      tagged: "mistake",
    });
  });

  it("staggers due dates one per day, oldest activity first, wrapping after the spread", () => {
    const items = engine.planRevisionNeededBackfill(
      [
        cand({ problemId: "c", lastActivityAt: 300 }),
        cand({ problemId: "a", lastActivityAt: 100 }),
        cand({ problemId: "b", lastActivityAt: 200 }),
      ],
      now,
      undefined,
      2,
    );
    expect(items.map((i) => [i.problemId, (i.due - now) / DAY])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 0],
    ]);
  });
});

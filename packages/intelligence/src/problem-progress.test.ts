import { describe, expect, it } from "vitest";
import { createCurriculumEngine } from "./curriculum-engine/CurriculumEngine.js";
import {
  buildTopicProblemCounts,
  isFirstPassCovered,
  isRemainingFirstPass,
} from "./problem-progress.js";
import { makeTopic } from "./test-fixtures/sample-topics.js";

describe("problem first-pass progress (P3.1)", () => {
  it.each([
    ["Solved", true],
    ["Revision needed", true],
    ["Not started", false],
    [null, false],
    [undefined, false],
  ] as const)("status %s covered = %s", (status, covered) => {
    expect(isFirstPassCovered(status)).toBe(covered);
    expect(isRemainingFirstPass(status)).toBe(!covered);
  });

  it("counts Revision needed as covered, not remaining", () => {
    const counts = buildTopicProblemCounts([
      { topicId: "bs", status: "Revision needed" },
      { topicId: "bs", status: "Revision needed" },
      { topicId: "bs", status: "Solved" },
      { topicId: "trees", status: "Not started" },
      { topicId: "trees", status: "Revision needed" },
      { topicId: null, status: "Not started" },
    ]);
    expect(counts.get("bs")).toEqual({ total: 3, unsolved: 0 });
    expect(counts.get("trees")).toEqual({ total: 2, unsolved: 1 });
    expect(counts.size).toBe(2);
  });

  it("a topic whose problems are all Revision needed is first-pass complete", () => {
    const topics = [
      makeTopic({ id: "bs", name: "Binary Search", status: "In progress" }),
      makeTopic({ id: "trees", name: "Trees", status: "Not started" }),
    ];
    const counts = buildTopicProblemCounts([
      { topicId: "bs", status: "Revision needed" },
      { topicId: "bs", status: "Revision needed" },
      { topicId: "trees", status: "Not started" },
    ]);
    const selection = createCurriculumEngine().selectCurrentTopic(
      { topicNames: ["Binary Search", "Trees"] },
      topics,
      counts,
    );
    expect(selection?.topic.id).toBe("trees");
    expect(selection?.items[0]?.status).toBe("complete");
    expect(selection?.items[1]?.status).toBe("current");
  });
});

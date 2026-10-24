import { describe, expect, it } from "vitest";
import { makeTopic } from "../test-fixtures/sample-topics.js";
import { DifficultyEngine } from "./DifficultyEngine.js";

describe("DifficultyEngine", () => {
  const engine = new DifficultyEngine();

  // P3.5: difficulty by stage, not raw confidence.
  it.each([
    // [case, overrides, primary, secondary]
    ["untouched pattern → learning", { totalAttempts: 0, confidence: 0 }, "Easy", "Medium"],
    ["2 attempts → still learning", { totalAttempts: 2, confidence: 30 }, "Easy", "Medium"],
    ["3 attempts → practicing", { totalAttempts: 3, confidence: 20 }, "Medium", null],
    ["practicing at any confidence below retaining", { totalAttempts: 12, confidence: 65 }, "Medium", null],
    [
      "practicing after could-not-solve → Easy",
      { totalAttempts: 6, confidence: 40, lastAttemptCouldNotSolve: true },
      "Easy",
      null,
    ],
    [
      "retaining → Medium and Hard",
      { totalAttempts: 10, confidence: 75, coachAssist: { assisted: 1, solved: 8 } },
      "Medium",
      "Hard",
    ],
  ] as const)("%s", (_case, overrides, primary, secondary) => {
    const rec = engine.recommendDifficulty(makeTopic({ id: "t", name: "T", ...overrides }));
    expect(rec.primary).toBe(primary);
    expect(rec.secondary).toBe(secondary);
  });

  it("coach-assisted confidence does not unlock Hard (D)", () => {
    const assisted = makeTopic({
      id: "assisted",
      name: "Assisted",
      totalAttempts: 10,
      confidence: 85,
      coachAssist: { assisted: 3, solved: 4 },
    });
    const rec = engine.recommendDifficulty(assisted);
    expect(rec.stage).toBe("practicing");
    expect(rec.primary).toBe("Medium");
    expect(rec.secondary).toBeNull();
  });

  it("serves learning as one Easy then one Medium", () => {
    const rec = engine.recommendDifficulty(makeTopic({ id: "t", name: "T", totalAttempts: 1 }));
    expect(engine.pickProblemDifficulties(rec, 2)).toEqual(["Easy", "Medium"]);
  });

  it("picks problem difficulties by ratio", () => {
    const rec = { primary: "Medium" as const, secondary: "Hard" as const, ratio: [0.8, 0.2] as [number, number] };
    const picks = engine.pickProblemDifficulties(rec, 5);
    expect(picks.filter((d) => d === "Medium").length).toBeGreaterThanOrEqual(3);
  });
});

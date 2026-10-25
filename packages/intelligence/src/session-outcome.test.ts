import { describe, expect, it } from "vitest";
import { confidenceDeltaForScore, deriveSessionOutcomeScore } from "./session-outcome.js";
import { topicToSM2Quality } from "./revision-engine/sm2.js";
import { makeTopic } from "./test-fixtures/sample-topics.js";

const quality = (score: number) =>
  topicToSM2Quality(makeTopic({ id: "t", name: "T" }), {
    date: new Date(),
    problemsSolved: 1,
    productivityScore: score,
    duration: 30,
  });

describe("deriveSessionOutcomeScore", () => {
  it("rewards a cold, clean, fast solve", () => {
    const s = deriveSessionOutcomeScore({
      durationMin: 15,
      difficulty: "Medium",
      usedHelp: false,
      mistakeTags: [],
    });
    expect(s).toBe(90);
    expect(quality(s)).toBe(5);
  });

  it("does NOT reward a short session when help was needed (the old bug)", () => {
    const s = deriveSessionOutcomeScore({
      durationMin: 1,
      difficulty: "Medium",
      usedHelp: true,
      mistakeTags: [],
    });
    expect(s).toBeLessThan(65);
    expect(quality(s)).toBeLessThanOrEqual(3);
  });

  it("caps help-assisted solves below cold solves", () => {
    const helped = deriveSessionOutcomeScore({ durationMin: 10, difficulty: "Easy", usedHelp: true, mistakeTags: [] });
    const cold = deriveSessionOutcomeScore({ durationMin: 40, difficulty: "Easy", usedHelp: false, mistakeTags: [] });
    expect(helped).toBeLessThan(65);
    expect(cold).toBeGreaterThan(helped);
  });

  it("penalises each distinct mistake tag, up to a cap", () => {
    const at = (tags: string[]) =>
      deriveSessionOutcomeScore({ durationMin: 40, difficulty: "Medium", usedHelp: false, mistakeTags: tags });
    expect(at(["off-by-one"])).toBe(at([]) - 8);
    expect(at(["off-by-one", "off-by-one"])).toBe(at(["off-by-one"])); // duplicates count once
    expect(at(["a", "b", "c", "d", "e"])).toBe(at([]) - 24);
  });

  it("treats could-not-solve as a failed session", () => {
    const s = deriveSessionOutcomeScore({
      durationMin: 20,
      difficulty: "Medium",
      usedHelp: false,
      mistakeTags: ["could-not-solve"],
    });
    expect(s).toBeLessThanOrEqual(25);
    expect(quality(s)).toBe(1);
  });

  it("penalises going far over the interview time target", () => {
    const slow = deriveSessionOutcomeScore({ durationMin: 100, difficulty: "Medium", usedHelp: false, mistakeTags: [] });
    const ok = deriveSessionOutcomeScore({ durationMin: 40, difficulty: "Medium", usedHelp: false, mistakeTags: [] });
    expect(slow).toBeLessThan(ok);
  });

  it("gives a provisional score (no penalty) while tags are not captured yet", () => {
    const provisional = deriveSessionOutcomeScore({ durationMin: 40, difficulty: "Medium", usedHelp: false });
    const clean = deriveSessionOutcomeScore({ durationMin: 40, difficulty: "Medium", usedHelp: false, mistakeTags: [] });
    expect(provisional).toBe(clean);
  });

  it("stays within 0..100", () => {
    const low = deriveSessionOutcomeScore({
      durationMin: 999, difficulty: "Easy", usedHelp: true, hintCount: 9,
      mistakeTags: ["a", "b", "c", "could-not-solve"],
    });
    expect(low).toBeGreaterThanOrEqual(0);
    expect(low).toBeLessThanOrEqual(100);
  });
});

describe("confidenceDeltaForScore", () => {
  it("only grows confidence on good sessions and shrinks it on failures", () => {
    expect(confidenceDeltaForScore(90)).toBeGreaterThan(0);
    expect(confidenceDeltaForScore(60)).toBeGreaterThanOrEqual(0);
    expect(confidenceDeltaForScore(45)).toBe(0);
    expect(confidenceDeltaForScore(10)).toBeLessThan(0);
  });
});

import { describe, expect, it } from "vitest";
import { deriveTopicStage } from "./topic-stage.js";

describe("deriveTopicStage", () => {
  it("is learning during first exposure", () => {
    expect(deriveTopicStage({ totalAttempts: 3, confidence: 10 })).toBe("learning");
  });
  it("is practicing past first exposure while still leaning on help", () => {
    expect(
      deriveTopicStage({ totalAttempts: 8, confidence: 40, coachAssist: { assisted: 5, solved: 6 } }),
    ).toBe("practicing");
  });
  it("is retaining when confident and mostly solving cold", () => {
    expect(
      deriveTopicStage({ totalAttempts: 12, confidence: 80, coachAssist: { assisted: 1, solved: 8 } }),
    ).toBe("retaining");
  });
  it("does not assume retaining without evidence of cold solves", () => {
    expect(deriveTopicStage({ totalAttempts: 12, confidence: 90 })).toBe("practicing");
  });
});

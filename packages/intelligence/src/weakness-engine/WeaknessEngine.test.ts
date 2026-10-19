import { describe, expect, it } from "vitest";
import { makeTopic, sampleTopics } from "../test-fixtures/sample-topics.js";
import { WeaknessEngine } from "./WeaknessEngine.js";

describe("WeaknessEngine", () => {
  const engine = new WeaknessEngine();

  it("flags weak topics above threshold", () => {
    const weak = makeTopic({
      id: "w",
      name: "Weak",
      confidence: 30,
      isWeakArea: true,
      totalAttempts: 15,
      problemsSolved: 3,
      averageTimeTaken: 50,
      recentSessions: [
        { date: new Date(), problemsSolved: 1, productivityScore: 40, duration: 60 },
        { date: new Date(), problemsSolved: 1, productivityScore: 45, duration: 60 },
      ],
    });
    const analysis = engine.analyzeWeakness(weak);
    expect(analysis.isWeak).toBe(true);
    expect(analysis.signals.length).toBeGreaterThan(0);
  });

  it("reports weak and strong topics in batch", () => {
    const report = engine.detectAllWeaknesses(sampleTopics());
    expect(report.weakTopics.length).toBeGreaterThan(0);
    expect(report.summary).toContain("weak");
  });

  it("coach-reliant solving raises the weakness score (D)", () => {
    const base = {
      id: "c",
      name: "Coached",
      confidence: 75,
      problemsSolved: 4,
      totalAttempts: 5,
    };
    const cold = engine.analyzeWeakness(makeTopic(base));
    const assisted = engine.analyzeWeakness(
      makeTopic({ ...base, coachAssist: { assisted: 3, solved: 4 } }),
    );
    expect(assisted.score).toBeGreaterThan(cold.score);
    expect(assisted.signals.some((s) => s.name === "coach_reliance")).toBe(true);
    // Below the 2-solve floor the signal stays silent — no verdict on thin data.
    const thin = engine.analyzeWeakness(
      makeTopic({ ...base, coachAssist: { assisted: 1, solved: 1 } }),
    );
    expect(thin.signals.some((s) => s.name === "coach_reliance")).toBe(false);
  });
});

describe("WeaknessEngine learning stage", () => {
  const engine = new WeaknessEngine();

  it("does not flag a topic as weak during first exposure, however messy", () => {
    const fresh = makeTopic({
      id: "f", name: "Graphs", confidence: 5, totalAttempts: 3, problemsSolved: 0,
      mistakeTagCounts: { "wrong-approach": 3, "pattern-recall": 2 },
      coachAssist: { assisted: 3, solved: 3 },
    });
    const a = engine.analyzeWeakness(fresh);
    expect(a.stage).toBe("learning");
    expect(a.isWeak).toBe(false);
    expect(a.recommendation).toContain("Still learning");
  });

  it("still flags the same profile once past first exposure", () => {
    const later = makeTopic({
      id: "l", name: "Graphs", confidence: 5, totalAttempts: 12, problemsSolved: 2,
      averageTimeTaken: 55,
      mistakeTagCounts: { "wrong-approach": 3, "pattern-recall": 2 },
      coachAssist: { assisted: 5, solved: 5 },
    });
    expect(engine.analyzeWeakness(later).isWeak).toBe(true);
  });

  it("judges 'recent' sessions by date, not array position", () => {
    const old = { date: new Date("2026-01-01"), problemsSolved: 1, productivityScore: 20, duration: 30 };
    const recent = (d: number) => ({ date: new Date(Date.UTC(2026, 9, d)), problemsSolved: 1, productivityScore: 95, duration: 30 });
    const topic = makeTopic({
      id: "o", name: "O", confidence: 70, totalAttempts: 10,
      recentSessions: [recent(10), recent(11), recent(12), old, old, old],
    });
    const a = engine.analyzeWeakness(topic);
    expect(a.signals.find((s) => s.name === "revision_failures")).toBeUndefined();
  });
});

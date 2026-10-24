import { describe, expect, it } from "vitest";
import { planScheduleRepair } from "./schedule-repair.js";
import { makeTopic } from "../test-fixtures/sample-topics.js";
import { maxIntervalDaysForConfidence, sm2Update } from "./sm2.js";
import { RevisionEngine } from "./RevisionEngine.js";
import { addDays } from "../utils/dates.js";

const now = new Date("2026-10-18T10:00:00Z");

describe("planScheduleRepair", () => {
  it("pulls a low-confidence topic scheduled years out back to its cap", () => {
    const t = makeTopic({
      id: "fs", name: "Fast & Slow", confidence: 30,
      lastRevised: new Date("2026-10-11T10:00:00Z"),
      nextRevisionAt: new Date("2030-10-09T00:00:00Z"),
      sm2Interval: 1459,
    });
    const [item] = planScheduleRepair([t], now);
    expect(item.newIntervalDays).toBe(7);
    expect(item.newNextRevisionAt!.getTime()).toBeLessThanOrEqual(addDays(now, 8).getTime());
  });

  it("never schedules a repaired date in the past", () => {
    const t = makeTopic({
      id: "rb", name: "Recursion", confidence: 32,
      lastRevised: new Date("2026-07-05T10:00:00Z"),
      nextRevisionAt: new Date("2037-03-09T00:00:00Z"),
      sm2Interval: 3900,
    });
    const [item] = planScheduleRepair([t], now);
    expect(item.newNextRevisionAt!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("leaves an already-due date in place (P2.2)", () => {
    const overdue = makeTopic({
      id: "stp", name: "Sorting + Two Pointers", confidence: 4,
      lastRevised: new Date("2026-09-20T00:00:00Z"),
      nextRevisionAt: new Date("2026-10-15T04:00:00Z"),
      sm2Interval: 1,
    });
    expect(planScheduleRepair([overdue], now)).toEqual([]);
  });

  it("shortens an over-long interval but keeps an already-due date (P2.2)", () => {
    const due = new Date("2026-10-15T12:01:27Z");
    const t = makeTopic({
      id: "bsps", name: "Binary Search + Prefix Sum", confidence: 43,
      lastRevised: new Date("2026-07-29T00:00:00Z"),
      nextRevisionAt: due,
      sm2Interval: 42,
    });
    const [item] = planScheduleRepair([t], now);
    expect(item.newIntervalDays).toBe(21);
    expect(item.newNextRevisionAt).toEqual(due);
  });

  it("is idempotent: a repaired topic is not repaired again on a re-run (P2.2)", () => {
    const t = makeTopic({
      id: "rb", name: "Recursion", confidence: 32,
      lastRevised: new Date("2026-07-05T10:00:00Z"),
      nextRevisionAt: new Date("2037-03-09T00:00:00Z"),
      sm2Interval: 3900,
    });
    const [item] = planScheduleRepair([t], now);
    const repaired = { ...t, sm2Interval: item.newIntervalDays, nextRevisionAt: item.newNextRevisionAt };
    expect(planScheduleRepair([repaired], now)).toEqual([]);
    expect(planScheduleRepair([repaired], addDays(now, 0.5))).toEqual([]);
  });

  it("leaves healthy and not-started topics alone", () => {
    const ok = makeTopic({
      id: "ok", name: "OK", confidence: 90, sm2Interval: 30,
      lastRevised: now, nextRevisionAt: addDays(now, 30),
    });
    const fresh = makeTopic({ id: "ns", name: "NS", status: "Not started", confidence: 0, sm2Interval: 500 });
    expect(planScheduleRepair([ok, fresh], now)).toEqual([]);
  });
});

describe("review interval cap (regression: 30%-confidence topic scheduled for 2030)", () => {
  it("a weak topic never gets an interval above its cap, however many good sessions", () => {
    const engine = new RevisionEngine();
    let topic = makeTopic({ id: "w", name: "W", confidence: 30, sm2Interval: 1, sm2Repetition: 0 });
    let date = new Date("2026-10-01T10:00:00Z");
    const cap = maxIntervalDaysForConfidence(30);
    for (let i = 0; i < 15; i++) {
      const sm2 = engine.applyQuality(topic, 5, date);
      expect(sm2.interval).toBeLessThanOrEqual(cap);
      topic = { ...topic, sm2Interval: sm2.interval, sm2Repetition: sm2.repetition, sm2Efactor: sm2.efactor };
      date = sm2.nextRevisionAt;
    }
  });

  it("uncapped SM-2 still grows (cap is opt-in at the engine level)", () => {
    const s = sm2Update({ interval: 100, repetition: 5, efactor: 2.5, nextRevisionAt: now }, 5, now);
    expect(s.interval).toBeGreaterThan(100);
  });

  it("allows longer gaps as confidence rises", () => {
    expect(maxIntervalDaysForConfidence(30)).toBeLessThan(maxIntervalDaysForConfidence(50));
    expect(maxIntervalDaysForConfidence(50)).toBeLessThan(maxIntervalDaysForConfidence(70));
    expect(maxIntervalDaysForConfidence(70)).toBeLessThan(maxIntervalDaysForConfidence(90));
  });
});

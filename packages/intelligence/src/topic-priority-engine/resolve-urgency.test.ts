import { describe, expect, it } from "vitest";
import { FIXED_NOW, makeTopic } from "../test-fixtures/sample-topics.js";
import { explainPriorityScore } from "./explain.js";
import { computePriorityScore, urgencyScore } from "./scoring.js";
import { resolveUrgencyScore, summarizeResolveDue } from "./resolve-urgency.js";

const DAY = 86_400_000;
const daysFromNow = (d: number) => new Date(FIXED_NOW.getTime() + d * DAY);
const studied = daysFromNow(-10);

describe("resolveUrgencyScore (P4.1)", () => {
  it.each([
    ["never studied, no re-solves", null, [], 1],
    ["studied, no re-solves", studied, [], 0],
    ["re-solves not yet due", studied, [daysFromNow(3), null], 0],
    ["one due today", studied, [FIXED_NOW], 0.6],
    ["7 days overdue", studied, [daysFromNow(-7), daysFromNow(5)], 0.8],
    ["14+ days overdue caps at 1", studied, [daysFromNow(-30)], 1],
  ] as const)("%s", (_label, lastRevised, dueAt, expected) => {
    expect(resolveUrgencyScore({ lastRevised, resolveDueAt: [...dueAt] }, FIXED_NOW)).toBeCloseTo(expected, 5);
  });

  it("counts due re-solves and the most overdue one", () => {
    expect(
      summarizeResolveDue([daysFromNow(-2), daysFromNow(-5), daysFromNow(1), null], FIXED_NOW),
    ).toEqual({ dueCount: 2, maxDaysOverdue: 5 });
  });
});

describe("urgencyScore with resolveDueAt", () => {
  it("ignores a far-future SM-2 date when a re-solve is due", () => {
    const topic = makeTopic({ lastRevised: studied, nextRevisionAt: daysFromNow(400) });
    expect(urgencyScore(topic, FIXED_NOW)).toBe(0);
    expect(urgencyScore({ ...topic, resolveDueAt: [daysFromNow(-1)] }, FIXED_NOW)).toBeGreaterThan(0.5);
  });

  it("ignores an overdue SM-2 date when no re-solve is due", () => {
    const topic = makeTopic({ lastRevised: studied, nextRevisionAt: daysFromNow(-20) });
    expect(urgencyScore(topic, FIXED_NOW)).toBe(1);
    expect(urgencyScore({ ...topic, resolveDueAt: [] }, FIXED_NOW)).toBe(0);
  });

  it("a due re-solve raises the priority score and reads as 'Review soon' or 'Study now'", () => {
    const base = makeTopic({ id: "t", lastRevised: studied, nextRevisionAt: daysFromNow(400), resolveDueAt: [] });
    const due = { ...base, resolveDueAt: [daysFromNow(-3)] };
    const notDue = computePriorityScore(base, new Map([["t", base]]), undefined, FIXED_NOW);
    const isDue = computePriorityScore(due, new Map([["t", due]]), undefined, FIXED_NOW);
    expect(isDue.total).toBeGreaterThan(notDue.total);
    expect(["Review soon", "Study now"]).toContain(isDue.recommendation);
  });

  it("explains urgency in re-solve terms", () => {
    const due = makeTopic({ id: "t", lastRevised: studied, resolveDueAt: [new Date(Date.now() - 3 * DAY)] });
    const score = computePriorityScore(due, new Map([["t", due]]));
    expect(explainPriorityScore(score, due).explanation[1]).toMatch(/1 re-solve due, the oldest 3 days overdue/);
    const none = { ...due, resolveDueAt: [] };
    const s2 = computePriorityScore(none, new Map([["t", none]]));
    expect(explainPriorityScore(s2, none).explanation[1]).toMatch(/no re-solve due/);
  });
});

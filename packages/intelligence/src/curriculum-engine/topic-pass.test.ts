import { describe, expect, it } from "vitest";
import {
  isCleanAttempt,
  topicPass,
  type PassAttempt,
  type PassProblem,
  type PassReview,
  type PassTopic,
} from "./topic-pass.js";
import type { TopicDifficulty } from "../types.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 6); // 2026-10-01
const dayKey = (d: number) => new Date(T0 + d * DAY).toISOString().slice(0, 10);
const NOW = T0 + 30 * DAY;

const prob = (id: string, difficulty: TopicDifficulty, status = "Not started"): PassProblem => ({
  id,
  difficulty,
  status,
});
const topic = (...problems: PassProblem[]): PassTopic => ({ id: "t", problems });
/** Mark problems covered (Solved), as the P3.1 status rule reads them. */
const solved = (t: PassTopic, ...ids: string[]): PassTopic => ({
  ...t,
  problems: t.problems.map((p) => (ids.includes(p.id) ? { ...p, status: "Solved" } : p)),
});

const att = (
  problemId: string,
  day: number,
  over: Partial<PassAttempt> = {},
  minute = 0,
): PassAttempt => ({
  problemId,
  solvedAt: T0 + day * DAY + minute * 60_000,
  dayKey: dayKey(day),
  mistakeTags: [],
  helpLevel: "none",
  usedHelp: false,
  patternGuess: null,
  ...over,
});
const review = (problemId: string, daysPastDue: number, over: Partial<PassReview> = {}): PassReview => ({
  problemId,
  due: NOW - daysPastDue * DAY,
  ...over,
});

/** 2 Easy, 4 Medium, 1 Hard: pass 1 = both Easy + 3 Medium. */
const standard = () =>
  topic(
    prob("e1", "Easy"),
    prob("e2", "Easy"),
    prob("m1", "Medium"),
    prob("m2", "Medium"),
    prob("m3", "Medium"),
    prob("m4", "Medium"),
    prob("h1", "Hard"),
  );

describe("isCleanAttempt (§6.3)", () => {
  const base = { mistakeTags: [] as string[], helpLevel: "none" as const, usedHelp: false };
  it.each([
    ["no help", base, true],
    ["a hint", { ...base, helpLevel: "hint" as const }, true],
    ["approach help", { ...base, helpLevel: "approach" as const }, false],
    ["full solution", { ...base, helpLevel: "solution" as const }, false],
    ["detail slips only", { ...base, mistakeTags: ["off-by-one", "edge-case", "loop-bounds"] }, true],
    ["wrong approach", { ...base, mistakeTags: ["wrong-approach"] }, false],
    ["couldn't recall the pattern", { ...base, mistakeTags: ["pattern-recall"] }, false],
    ["wrong greedy choice", { ...base, mistakeTags: ["greedy-invariant"] }, false],
    ["could not solve", { ...base, mistakeTags: ["could-not-solve"] }, false],
    ["legacy row that used the coach", { ...base, helpLevel: null, usedHelp: true }, false],
    ["legacy row without help", { ...base, helpLevel: null }, true],
  ])("%s → %s", (_label, attempt, clean) => {
    expect(isCleanAttempt(attempt)).toBe(clean);
  });
});

describe("topicPass — pass 0 and pass 1 (D3)", () => {
  it("untouched topic is pass 0 and not touched", () => {
    const r = topicPass(standard(), [], [], NOW);
    expect(r.pass).toBe(0);
    expect(r.touched).toBe(false);
    expect(r.evidence.cleanRate).toBeNull();
    expect(r.pass1.remaining).toEqual(["e1", "e2", "m1", "m2", "m3", "m4"]);
  });

  it("a topic with no problems never passes", () => {
    expect(topicPass(topic(), [], [], NOW).pass).toBe(0);
  });

  it("one covered problem is touched but still pass 0", () => {
    const r = topicPass(solved(standard(), "e1"), [att("e1", 0)], [], NOW);
    expect(r).toMatchObject({ pass: 0, touched: true });
  });

  it("an attempt that didn't cover the problem still marks the topic touched", () => {
    const r = topicPass(standard(), [att("e1", 0, { mistakeTags: ["could-not-solve"] })], [], NOW);
    expect(r).toMatchObject({ pass: 0, touched: true });
  });

  it("all Easy + 2 of 3 needed Medium is one short; the third Medium reaches pass 1", () => {
    const t = solved(standard(), "e1", "e2", "m1", "m2");
    const before = topicPass(t, [], [], NOW);
    expect(before.pass).toBe(0);
    expect(before.pass1).toMatchObject({ mediumCovered: 2, mediumNeeded: 3 });
    expect(before.pass1.remaining).toEqual(["m3", "m4"]);
    expect(topicPass(solved(t, "m3"), [], [], NOW).pass).toBeGreaterThanOrEqual(1);
  });

  it("3 Medium without every Easy is not pass 1", () => {
    const r = topicPass(solved(standard(), "e1", "m1", "m2", "m3"), [], [], NOW);
    expect(r.pass).toBe(0);
    expect(r.pass1.remaining).toEqual(["e2"]);
  });

  it("the Hard is never needed for pass 1", () => {
    const r = topicPass(solved(standard(), "e1", "e2", "m1", "m2", "m3"), [], [], NOW);
    expect(r.pass1.met).toBe(true);
  });

  it("2-problem topic: both problems are needed, Hard included (fewer than 4)", () => {
    const heap = topic(prob("h1", "Hard"), prob("h2", "Hard"));
    expect(topicPass(solved(heap, "h1"), [att("h1", 0)], [], NOW).pass).toBe(0);
    // Nothing unseen and nothing needed help, so it is consolidated too.
    expect(topicPass(solved(heap, "h1", "h2"), [att("h1", 0), att("h2", 1)], [], NOW).pass).toBe(2);
  });

  it("3-problem topic still needs all three; a 4-problem topic uses the Easy/Medium rule", () => {
    const three = topic(prob("e1", "Easy"), prob("m1", "Medium"), prob("m2", "Medium"));
    expect(topicPass(solved(three, "e1", "m1"), [], [], NOW).pass1.met).toBe(false);
    const four = topic(prob("m1", "Medium"), prob("m2", "Medium"), prob("h1", "Hard"), prob("h2", "Hard"));
    expect(topicPass(solved(four, "m1", "m2"), [], [], NOW).pass1).toMatchObject({
      met: true,
      mediumNeeded: 2,
    });
  });

  it("topic with no Easy (DP on Subsequences shape): 3 Medium reach pass 1", () => {
    const t = topic(
      ...["m1", "m2", "m3", "m4", "m5", "m6"].map((id) => prob(id, "Medium")),
      prob("h1", "Hard"),
    );
    expect(topicPass(solved(t, "m1", "m2"), [], [], NOW).pass).toBe(0);
    const r = topicPass(solved(t, "m1", "m2", "m3"), [], [], NOW);
    expect(r.pass1).toMatchObject({ met: true, easyTotal: 0, mediumNeeded: 3 });
  });

  it("4+ problems, all Hard (not in the dev DB): pass 1 needs at least one covered", () => {
    const t = topic(...["h1", "h2", "h3", "h4"].map((id) => prob(id, "Hard")));
    expect(topicPass(t, [], [], NOW).pass).toBe(0);
    expect(topicPass(solved(t, "h1"), [att("h1", 0)], [], NOW).pass1.met).toBe(true);
  });

  it("reports the day pass 1 was reached, from the order problems were first worked", () => {
    const t = solved(standard(), "e1", "e2", "m1", "m2", "m3", "m4");
    const r = topicPass(
      t,
      [att("e1", 0), att("e2", 0, {}, 10), att("m1", 1), att("m2", 2), att("m3", 4), att("m4", 6)],
      [],
      NOW,
    );
    expect(r.pass1.reachedOn).toBe(dayKey(4));
  });
});

describe("topicPass — pass 2 (D4)", () => {
  // Pass 1 on day 2: e1, e2, m1, m2, m3. m4 is the one unseen Easy/Medium left.
  const p1Attempts = (helpOnM1: Partial<PassAttempt> = {}) => [
    att("e1", 0),
    att("e2", 0, {}, 20),
    att("m1", 1, helpOnM1),
    att("m2", 2),
    att("m3", 2, {}, 30),
  ];
  const t = solved(standard(), "e1", "e2", "m1", "m2", "m3");

  it("all clean and the one unseen problem solved clean first try → pass 2", () => {
    const r = topicPass(solved(t, "m4"), [...p1Attempts(), att("m4", 5)], [], NOW);
    expect(r.pass).toBe(2);
    expect(r.pass2).toMatchObject({ transferNeeded: 1, transferClean: 1, awaitingCleanResolve: [] });
  });

  it("transfer is still owed while the unseen problem is unsolved", () => {
    const r = topicPass(t, p1Attempts(), [], NOW);
    expect(r.pass).toBe(1);
    expect(r.pass2).toMatchObject({ transferNeeded: 1, transferClean: 0 });
  });

  it("an unseen problem solved with help on its first try doesn't count, even if re-solved later", () => {
    const r = topicPass(
      solved(t, "m4"),
      [...p1Attempts(), att("m4", 5, { helpLevel: "approach" }), att("m4", 9)],
      [],
      NOW,
    );
    expect(r.pass).toBe(1);
    expect(r.pass2.transferClean).toBe(0);
  });

  it("a problem first tried on the pass-1 day is not a transfer problem", () => {
    // m4 on day 2, after m3 reached pass 1: nothing unseen is left, so no transfer is owed.
    const r = topicPass(solved(t, "m4"), [...p1Attempts(), att("m4", 2, {}, 60)], [], NOW);
    expect(r.pass2.transferNeeded).toBe(0);
    expect(r.pass).toBe(2);
  });

  it("a problem that needed help waits for a clean solve on a later day", () => {
    const helped = p1Attempts({ helpLevel: "approach" });
    const done = solved(t, "m4");
    const transfer = att("m4", 5);
    expect(topicPass(done, [...helped, transfer], [], NOW).pass2.awaitingCleanResolve).toEqual(["m1"]);
    // Same day again is not spaced.
    expect(topicPass(done, [...helped, transfer, att("m1", 1, {}, 90)], [], NOW).pass).toBe(1);
    // A later day, clean: consolidated.
    expect(topicPass(done, [...helped, transfer, att("m1", 4)], [], NOW).pass).toBe(2);
    // A later day, but needed help again: still waiting.
    expect(
      topicPass(done, [...helped, transfer, att("m1", 4, { helpLevel: "solution" })], [], NOW).pass,
    ).toBe(1);
  });

  it("a hint is still clean; a missing-approach tag is not", () => {
    const done = solved(t, "m4");
    const transfer = att("m4", 5);
    expect(topicPass(done, [...p1Attempts({ helpLevel: "hint" }), transfer], [], NOW).pass).toBe(2);
    expect(
      topicPass(done, [...p1Attempts({ mistakeTags: ["pattern-recall"] }), transfer], [], NOW).pass,
    ).toBe(1);
  });

  it("a later attempt that needed help reopens pass 2", () => {
    const done = solved(t, "m4");
    const base = [...p1Attempts(), att("m4", 5)];
    expect(topicPass(done, base, [], NOW).pass).toBe(2);
    expect(topicPass(done, [...base, att("e1", 8, { helpLevel: "approach" })], [], NOW).pass).toBe(1);
  });

  it("legacy rows: the coach flag counts as help", () => {
    const legacy = p1Attempts({ helpLevel: null, usedHelp: true });
    const r = topicPass(solved(t, "m4"), [...legacy, att("m4", 5)], [], NOW);
    expect(r.pass2.awaitingCleanResolve).toEqual(["m1"]);
  });

  it("'Revision needed' with no attempt rows (imported) waits for a clean solve", () => {
    const imported = {
      ...t,
      problems: t.problems.map((p) => (p.id === "m2" ? { ...p, status: "Revision needed" } : p)),
    };
    const attempts = p1Attempts().filter((a) => a.problemId !== "m2");
    const r = topicPass(solved(imported, "m4"), [...attempts, att("m4", 5)], [], NOW);
    expect(r.pass2.awaitingCleanResolve).toEqual(["m2"]);
    const after = topicPass(solved(imported, "m4"), [...attempts, att("m4", 5), att("m2", 6)], [], NOW);
    expect(after.pass).toBe(2);
  });

  it("every remaining problem is Hard: no transfer is owed and Hards are never needed", () => {
    // 1 Easy, 2 Medium, 3 Hard: pass 1 = all three Easy/Medium; nothing unseen is left.
    const hardTail = solved(
      topic(
        prob("e1", "Easy"),
        prob("m1", "Medium"),
        prob("m2", "Medium"),
        prob("h1", "Hard"),
        prob("h2", "Hard"),
        prob("h3", "Hard"),
      ),
      "e1",
      "m1",
      "m2",
    );
    const r = topicPass(hardTail, [att("e1", 0), att("m1", 1), att("m2", 2)], [], NOW);
    expect(r.pass1.met).toBe(true);
    expect(r.pass2).toMatchObject({ met: true, transferNeeded: 0 });
    expect(r.pass).toBe(2);
  });

  it("unseen Hards don't count toward the transfer", () => {
    const r = topicPass(solved(t, "h1"), [...p1Attempts(), att("h1", 5)], [], NOW);
    expect(r.pass2).toMatchObject({ transferNeeded: 1, transferClean: 0 });
  });

  it("with 2+ unseen problems left, two clean first tries are needed", () => {
    const big = solved(
      topic(
        prob("e1", "Easy"),
        ...["m1", "m2", "m3", "m4", "m5", "m6"].map((id) => prob(id, "Medium")),
      ),
      "e1",
      "m1",
      "m2",
      "m3",
      "m4",
    );
    const base = [att("e1", 0), att("m1", 0, {}, 10), att("m2", 1), att("m3", 1, {}, 10)];
    const one = topicPass(big, [...base, att("m4", 4)], [], NOW);
    expect(one.pass2).toMatchObject({ transferNeeded: 2, transferClean: 1 });
    expect(one.pass).toBe(1);
    const two = topicPass(solved(big, "m5"), [...base, att("m4", 4), att("m5", 6)], [], NOW);
    expect(two.pass).toBe(2);
  });
});

describe("topicPass — pass 3", () => {
  const t = solved(standard(), "e1", "e2", "m1", "m2", "m3", "m4");
  const p2 = [att("e1", 0), att("e2", 0, {}, 20), att("m1", 1), att("m2", 2), att("m3", 2, {}, 30), att("m4", 5)];
  const hidden = (id: string, day: number, over: Partial<PassAttempt> = {}) =>
    att(id, day, { patternGuess: "t", ...over });

  it("two hidden attempts with the right guess and a clean solve → pass 3", () => {
    const r = topicPass(t, [...p2, hidden("m1", 10), hidden("e2", 14)], [], NOW);
    expect(r.pass).toBe(3);
    expect(r.pass3).toMatchObject({ hiddenCorrectClean: 2, overdueResolves: 0 });
  });

  it("one is not enough; a wrong guess, 'unsure' or a solve with help doesn't count", () => {
    const tries = [
      hidden("m1", 10),
      hidden("m2", 11, { patternGuess: "other-topic" }),
      hidden("m3", 12, { patternGuess: "unsure" }),
      hidden("e1", 13, { helpLevel: "approach" }),
    ];
    const r = topicPass(t, [...p2, ...tries], [], NOW);
    expect(r.pass3.hiddenCorrectClean).toBe(1);
    expect(r.pass).toBeLessThan(3);
  });

  it("a hidden Hard counts toward pass 3", () => {
    const withHard = solved(t, "h1");
    const r = topicPass(withHard, [...p2, hidden("m1", 10), hidden("h1", 12)], [], NOW);
    expect(r.pass).toBe(3);
  });

  it("an overdue re-solve takes pass 3 away; due today, retired or suspended doesn't", () => {
    const attempts = [...p2, hidden("m1", 10), hidden("e2", 14)];
    expect(topicPass(t, attempts, [review("m2", 2)], NOW)).toMatchObject({
      pass: 2,
      pass3: { overdueResolves: 1 },
    });
    expect(topicPass(t, attempts, [review("m2", 0.5)], NOW).pass).toBe(3);
    expect(topicPass(t, attempts, [review("m2", 5, { retired: true })], NOW).pass).toBe(3);
    expect(topicPass(t, attempts, [review("m2", 5, { suspended: true })], NOW).pass).toBe(3);
    expect(topicPass(t, attempts, [review("other", 5)], NOW).pass).toBe(3);
  });

  it("pass 3 needs pass 2 first", () => {
    const helped = p2.map((a) => (a.problemId === "m1" ? { ...a, helpLevel: "approach" as const } : a));
    const r = topicPass(t, [...helped, hidden("e1", 10), hidden("e2", 14)], [], NOW);
    expect(r.pass3.hiddenCorrectClean).toBe(2);
    expect(r.pass).toBe(1);
  });
});

describe("topicPass — evidence stays separate from the level", () => {
  it("reports the clean rate and cold attempts", () => {
    const t = solved(standard(), "e1", "m1");
    const r = topicPass(
      t,
      [
        att("e1", 0, { helpLevel: "approach" }),
        att("e1", 0, {}, 30), // same day: a repeat, not cold
        att("e1", 3), // later day: cold
        att("m1", 4, { patternGuess: "t", mistakeTags: ["wrong-approach"] }), // hidden: cold
        att("x-other-topic", 4),
      ],
      [],
      NOW,
    );
    expect(r.evidence).toEqual({
      attempts: 4,
      cleanAttempts: 2,
      cleanRate: 0.5,
      coldAttempts: 2,
      coldCleanAttempts: 1,
    });
  });
});

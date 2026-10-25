import { describe, expect, it } from "vitest";
import {
  DEFAULT_TWO_LOOP_CONFIG,
  selectTwoLoopDay,
  type SelectorTopic,
  type TwoLoopConfig,
  type TwoLoopDay,
} from "./two-loop-selector.js";
import type { PassAttempt, PassReview } from "./topic-pass.js";
import type { TopicDifficulty } from "../types.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 6);
const dayKey = (d: number) => new Date(T0 + d * DAY).toISOString().slice(0, 10);

const NAMES = {
  tp: "Two Pointers",
  sw: "Sliding Window",
  hash: "Hashing + Set/Map",
  rec: "Recursion & Backtracking",
  greedy: "Greedy Sorting",
  dp: "Dynamic Programming (1D)",
  dfs: "DFS (Tree/Graph)",
  prefix: "Prefix Sum / Difference Array",
  grids: "DP on Grids",
  seg: "Segment Tree / Fenwick Tree",
  bs: "Binary Search",
  bsg: "Binary Search + Greedy",
} as const;
type Key = keyof typeof NAMES;
const BASE_KEYS: Key[] = ["tp", "sw", "hash", "rec", "greedy", "dp", "dfs", "prefix", "grids", "seg"];

/** Basics tp, sw, hash, rec; core greedy → dp → dfs → prefix; later seg. Real hard prerequisites. */
const CONFIG: TwoLoopConfig = {
  ...DEFAULT_TWO_LOOP_CONFIG,
  basicTopics: [NAMES.tp, NAMES.sw, NAMES.hash, NAMES.rec],
  coreOrder: [NAMES.greedy, NAMES.dp, NAMES.dfs, NAMES.prefix],
  laterOrder: [NAMES.seg],
  capExemptTopics: [NAMES.dp],
};

const SHAPE: [string, TopicDifficulty][] = [
  ["e1", "Easy"],
  ["e2", "Easy"],
  ["m1", "Medium"],
  ["m2", "Medium"],
  ["m3", "Medium"],
  ["m4", "Medium"],
  ["h1", "Hard"],
];

/** A world where each topic has 2 Easy, 4 Medium, 1 Hard: pass 1 = 5 problems, block = 4. */
class World {
  topics: SelectorTopic[];
  attempts: PassAttempt[] = [];
  reviews: PassReview[] = [];
  pin: string | null = null;
  private minute = 0;

  constructor(keys: Key[] = BASE_KEYS) {
    this.topics = keys.map((k) => ({
      id: k,
      name: NAMES[k],
      problems: SHAPE.map(([s, d]) => ({ id: `${k}-${s}`, difficulty: d, status: "Not started" })),
    }));
  }

  solve(problemId: string, day: number, over: Partial<PassAttempt> = {}) {
    for (const t of this.topics) {
      t.problems = t.problems.map((p) => (p.id === problemId ? { ...p, status: "Solved" } : p));
    }
    this.attempts.push({
      problemId,
      solvedAt: T0 + day * DAY + this.minute++ * 60_000,
      dayKey: dayKey(day),
      mistakeTags: [],
      helpLevel: "none",
      usedHelp: false,
      patternGuess: null,
      ...over,
    });
    return this;
  }
  /** Pass 1: both Easy + 3 Medium, clean, on one day. */
  pass1(k: Key, day = 0) {
    for (const s of ["e1", "e2", "m1", "m2", "m3"]) this.solve(`${k}-${s}`, day);
    return this;
  }
  /** Pass 2: pass 1, then the one unseen Medium clean on a later day. */
  pass2(k: Key, day = 0) {
    this.pass1(k, day);
    return this.solve(`${k}-m4`, day + 1);
  }
  overdue(problemId: string, days: number, today: number) {
    this.reviews.push({ problemId, due: T0 + today * DAY + 12 * 3_600_000 - days * DAY });
    return this;
  }
  day(d: number, config = CONFIG): TwoLoopDay {
    return selectTwoLoopDay(
      {
        topics: this.topics,
        attempts: this.attempts,
        reviews: this.reviews,
        now: T0 + d * DAY + 12 * 3_600_000,
        pinnedTopicId: this.pin,
      },
      config,
    );
  }
  /** Solve today's picks, clean. */
  play(d: number, config = CONFIG): TwoLoopDay {
    const today = this.day(d, config);
    for (const p of today.picks) this.solve(p.problemId, d);
    return today;
  }
}

/** Today: Greedy and Recursion at pass 1; tp, sw, hash basics open (the cap is full). */
const startingWorld = () => new World().pass1("greedy").pass1("rec");

const topicNames = Object.values(NAMES);
const expectNoPatternNamed = (day: TwoLoopDay) => {
  for (const name of topicNames) expect(day.why).not.toContain(name);
  expect(day.picks.every((p) => !p.revealPattern)).toBe(true);
};

describe("two-loop selector — D13 starting set", () => {
  it("DP (1D) starts at once alongside the open basics, despite the full cap", () => {
    const today = startingWorld().day(1);
    expect(today.openTopicIds).toEqual(["tp", "sw", "hash"]);
    expect(today).toMatchObject({ dayKind: "block", phase: "block", blockTopicId: "dp" });
    expect(today.block).toEqual({ covered: 0, size: 4 });
    expect(today.why).toBe("New pattern: Dynamic Programming (1D). A short block of 4 problems, Easy first.");
    // Block problem shown, plus the basics offer, hidden.
    expect(today.picks.map((p) => [p.problemId, p.role, p.revealPattern])).toEqual([
      ["dp-e1", "block", true],
      ["tp-e1", "basic", false],
    ]);
  });

  it("without the exemption the full cap blocks every introduction: a mixed day", () => {
    const today = startingWorld().day(1, { ...CONFIG, capExemptTopics: [] });
    expect(today).toMatchObject({ dayKind: "mixed", phase: "mixed", blockTopicId: null });
    expectNoPatternNamed(today);
  });

  it("basics hold the cap: with three basics open, the next non-exempt pattern waits", () => {
    const w = startingWorld();
    w.pass1("dp"); // DP already past its block and at pass 1; DFS is next.
    const today = w.day(5);
    expect(today.openTopicIds).toEqual(["tp", "sw", "hash"]);
    expect(today.dayKind).toBe("mixed");
    expect(today.blockTopicId).toBeNull();
  });

  it("a basic only counts as a prerequisite at pass ≥ 1: DFS is skipped for Prefix Sum", () => {
    // Recursion below pass 1 (one problem), two basics done, so one slot is free.
    const w = new World().pass1("greedy").pass1("tp").pass1("sw").pass1("hash").pass1("dp");
    w.solve("rec-e1", 0);
    const today = w.day(2);
    expect(today.openTopicIds).toEqual(["rec"]);
    expect(today.blockTopicId).toBe("prefix");
  });
});

describe("two-loop selector — a block runs to completion, then mixed days", () => {
  it("serves the block on block days until it is done, then mixes the pattern in hidden", () => {
    const w = startingWorld();
    const days = [1, 2, 3, 4, 5].map((d) => w.play(d));
    // dp-e1 + basic, dp-e2 + basic, dp-m1 + basic, dp-m2 + basic: block of 4.
    expect(days.slice(0, 4).map((d) => d.blockTopicId)).toEqual(["dp", "dp", "dp", "dp"]);
    expect(days.slice(0, 4).map((d) => d.picks[0].problemId)).toEqual(["dp-e1", "dp-e2", "dp-m1", "dp-m2"]);
    expect(days[2].why).toBe("Dynamic Programming (1D): short block, 2 of 4 done.");
    // The basics offer rotated tp, sw, hash, tp: least recently practised first.
    expect(days.slice(0, 4).map((d) => d.picks[1].problemId)).toEqual(["tp-e1", "sw-e1", "hash-e1", "tp-e2"]);
    // Day 5: block done, DP below pass 1 (needs m3). A mixed day: DP's last pass-1 problem, then the basics offer.
    expect(days[4]).toMatchObject({ dayKind: "mixed", phase: "mixed" });
    expect(days[4].picks.map((p) => [p.problemId, p.role])).toEqual([
      ["dp-m3", "pool"],
      ["sw-e2", "basic"],
    ]);
    expectNoPatternNamed(days[4]);
    expect(days[4].why).toMatch(/^Mixed practice: \d+ patterns still need a first pass\.$/);
  });

  it("a topic marked covered by an import with no attempts is not introduced (Bit Manipulation case)", () => {
    const w = startingWorld();
    w.topics = w.topics.map((t) =>
      t.id === "dfs"
        ? { ...t, problems: t.problems.map((p) => (p.id === "dfs-e1" ? { ...p, status: "Solved" } : p)) }
        : t,
    );
    const today = w.day(1);
    expect(today.openTopicIds).not.toContain("dfs");
    expect(today.blockTopicId).toBe("dp");
  });
});

describe("two-loop selector — patterns started long ago (D14, P8.2)", () => {
  it("a block untouched for 14+ days is interrupted: DP starts, the old pattern joins mixed days", () => {
    // DFS: 2 of its 4 block problems, a month ago. DP untouched. Cap full with basics.
    const w = startingWorld();
    w.solve("dfs-e1", 0).solve("dfs-e2", 0);
    const now = 30;
    const today = w.day(now);
    expect(today).toMatchObject({ phase: "block", blockTopicId: "dp" });
    // Within 14 days it would still be the running block.
    expect(w.day(10).blockTopicId).toBe("dfs");
    // Once DP's block is done, the interrupted DFS shows up on mixed days, hidden.
    for (const s of ["e1", "e2", "m1", "m2"]) w.solve(`dp-${s}`, now);
    const mixed = w.day(now + 1);
    expect(mixed.dayKind).toBe("mixed");
    expect(mixed.picks.map((p) => p.topicId)).toContain("dfs");
    expectNoPatternNamed(mixed);
    // Practising it again on a mixed day doesn't revive the block.
    const dfsPick = mixed.picks.find((p) => p.topicId === "dfs")!;
    w.solve(dfsPick.problemId, now + 1);
    expect(w.day(now + 2).blockTopicId).not.toBe("dfs");
  });

  const bsgConfig = {
    ...CONFIG,
    basicTopics: [...CONFIG.basicTopics, NAMES.bs],
    coreOrder: [NAMES.greedy, NAMES.dp, NAMES.bsg],
  };
  /** DP already at pass 1, so it doesn't take the slots. */
  const bsgWorld = () =>
    new World(["tp", "sw", "hash", "rec", "greedy", "dp", "bs", "bsg"]).pass1("greedy").pass1("rec").pass1("dp", 1);

  it("a recent block waits while a hard prerequisite is below pass 1 (D13 decision 1)", () => {
    const w = bsgWorld();
    w.solve("bsg-e1", 28);
    expect(w.day(30, bsgConfig).blockTopicId).not.toBe("bsg");
    expect(w.day(30, bsgConfig).picks.map((p) => p.topicId)).not.toContain("bsg");
    w.pass1("bs", 30);
    expect(w.day(31, bsgConfig).blockTopicId).toBe("bsg");
  });

  it("an interrupted pattern also waits for its prerequisite before joining mixed days", () => {
    const w = bsgWorld();
    w.solve("bsg-e1", 0);
    expect(w.day(30, bsgConfig).picks.map((p) => p.topicId)).not.toContain("bsg");
    w.pass1("bs", 30);
    const today = w.day(31, bsgConfig);
    expect(today.dayKind).toBe("mixed");
    expect(today.picks.map((p) => p.topicId)).toContain("bsg");
  });
});

describe("two-loop selector — basics guard (D13)", () => {
  it("offers exactly one basics problem a day, and a skipped day doesn't stack", () => {
    const w = startingWorld();
    const d1 = w.day(1);
    const d2 = w.day(2); // nothing solved on day 1
    const d3 = w.day(3);
    for (const d of [d1, d2, d3]) expect(d.picks.filter((p) => p.role === "basic")).toHaveLength(1);
    expect(d2.picks).toEqual(d1.picks);
    expect(d3.picks).toEqual(d1.picks);
  });

  it("rotates across basics: the least recently practised comes first", () => {
    const w = startingWorld();
    w.solve("tp-e1", 1);
    expect(w.day(2).picks.find((p) => p.role === "basic")?.topicId).toBe("sw");
  });

  it("no basics below pass 1: no basics offer", () => {
    const w = new World().pass1("greedy").pass1("rec").pass1("tp").pass1("sw").pass1("hash");
    const today = w.day(1);
    expect(today.blockTopicId).toBe("dp");
    expect(today.picks.map((p) => p.role)).toEqual(["block", "block"]);
  });
});

describe("two-loop selector — cap and introductions", () => {
  it("the next pattern starts only once open patterns drop below 3", () => {
    const w = startingWorld();
    for (let d = 1; d <= 4; d++) w.play(d); // DP block done
    w.solve("dp-m3", 5); // DP at pass 1
    expect(w.day(6).blockTopicId).toBeNull(); // tp, sw, hash still open
    w.pass1("tp", 6);
    expect(w.day(7).openTopicIds).toEqual(["sw", "hash"]);
    expect(w.day(7).blockTopicId).toBe("dfs");
  });
});

describe("two-loop selector — mixed days and the transfer check", () => {
  // No basics open; DP open with its block done; pass-1 topics each have m4 unseen.
  const oneOpen = () => {
    const w = new World().pass1("greedy").pass1("rec").pass1("tp").pass1("sw").pass1("hash");
    for (const s of ["e1", "e2", "m1", "m2"]) w.solve(`dp-${s}`, 1);
    return w;
  };

  it("one open pattern: its pass-1 problem, plus one unseen problem from a pattern at pass 1", () => {
    const today = oneOpen().day(3, { ...CONFIG, maxOpen: 1 });
    expect(today.dayKind).toBe("mixed");
    expect(today.picks.map((p) => [p.problemId, p.role])).toEqual([
      ["dp-m3", "pool"],
      ["greedy-m4", "transfer"], // the least recently practised pattern at pass 1
    ]);
    expectNoPatternNamed(today);
  });

  it("two open patterns: both get a pass-1 problem and the transfer check waits", () => {
    const w = oneOpen();
    for (const s of ["e1", "e2", "m1", "m2"]) w.solve(`dfs-${s}`, 1); // DFS block done too
    const today = w.day(3, { ...CONFIG, maxOpen: 2 });
    expect(today.picks.map((p) => [p.topicId, p.role])).toEqual([
      ["dp", "pool"],
      ["dfs", "pool"],
    ]);
  });

  it("nothing to offer: an idle day that names nothing", () => {
    const w = new World(["tp"]).pass2("tp");
    const today = w.day(5, { ...CONFIG, basicTopics: [NAMES.tp], coreOrder: [], laterOrder: [] });
    expect(today).toMatchObject({ phase: "idle", picks: [] });
  });
});

describe("two-loop selector — consolidation day and pin", () => {
  it("2+ overdue re-solves on one topic make a mixed day led by them; 1 does not", () => {
    const w = startingWorld().overdue("greedy-m1", 3, 1);
    expect(w.day(1).phase).toBe("block");
    w.overdue("greedy-m2", 2, 1);
    const today = w.day(1);
    expect(today).toMatchObject({ dayKind: "mixed", phase: "consolidation-day", resolveTopicId: "greedy" });
    expect(today.why).toBe("Mixed practice: 2 re-solves from one pattern are overdue, so today starts with one.");
    expectNoPatternNamed(today);
  });

  it("a manual pin overrides everything, as a block day with the pattern shown", () => {
    const w = startingWorld().overdue("greedy-m1", 3, 1).overdue("greedy-m2", 3, 1);
    w.pin = "seg";
    const today = w.day(1);
    expect(today).toMatchObject({ dayKind: "block", phase: "pin", blockTopicId: "seg", why: "Pinned: Segment Tree / Fenwick Tree." });
    expect(today.picks.map((p) => [p.problemId, p.revealPattern])).toEqual([
      ["seg-e1", true],
      ["seg-e2", true],
    ]);
  });
});

describe("two-loop selector — consolidation loop", () => {
  const allCoreAtPass1 = () =>
    new World()
      .pass1("tp")
      .pass1("sw")
      .pass1("hash")
      .pass1("rec")
      .pass1("greedy")
      .pass1("dp")
      .pass1("dfs")
      .pass1("prefix");

  it("once every core pattern is at pass 1, nothing new starts and basics come first", () => {
    const today = allCoreAtPass1().day(3);
    expect(today).toMatchObject({ dayKind: "mixed", phase: "consolidation-loop", consolidating: true });
    expect(today.blockTopicId).toBeNull(); // Segment Tree's prerequisite is met, but no introductions now
    expect(today.picks.map((p) => [p.topicId, p.role])).toEqual([
      ["tp", "consolidate"],
      ["sw", "consolidate"],
    ]);
    expect(today.picks.every((p) => p.problemId.endsWith("-m4"))).toBe(true);
    expect(today.why).toBe("Mixed practice: 8 patterns still need a clean cold solve.");
    expectNoPatternNamed(today);
  });

  it("a topic whose prerequisite is below pass 2 sends you to the prerequisite first", () => {
    const w = new World()
      .pass2("tp")
      .pass2("sw")
      .pass2("hash")
      .pass2("rec")
      .pass2("greedy")
      .pass1("grids")
      .pass1("dp")
      .pass2("dfs")
      .pass2("prefix");
    const config = { ...CONFIG, coreOrder: [NAMES.greedy, NAMES.grids, NAMES.dp, NAMES.dfs, NAMES.prefix] };
    const today = w.day(5, config);
    expect(today.phase).toBe("consolidation-loop");
    // Grids comes first in the order, but DP (its prerequisite) is below pass 2.
    expect(today.picks[0]).toMatchObject({ topicId: "dp", problemId: "dp-m4" });
    w.solve("dp-m4", 5);
    expect(w.day(6, config).picks[0]).toMatchObject({ topicId: "grids" });
  });

  it("with basics and core at pass 2, the exposure loop resumes with the Later patterns", () => {
    const w = new World(["tp", "sw", "hash", "rec", "greedy", "dp", "dfs", "prefix", "seg"]);
    for (const k of ["tp", "sw", "hash", "rec", "greedy", "dp", "dfs", "prefix"] as Key[]) w.pass2(k);
    const today = w.day(5);
    expect(today).toMatchObject({ phase: "block", blockTopicId: "seg", consolidating: false });
  });
});

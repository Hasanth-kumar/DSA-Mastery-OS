import { describe, expect, it } from "vitest";
import { makeTopic } from "../test-fixtures/sample-topics.js";
import { CurriculumEngine, resolveTopicByLabel, type TopicProblemCounts } from "./CurriculumEngine.js";
import { DEFAULT_CURRICULUM_TOPICS } from "./default-topics.js";

/** Santosh's 50 Notion topic names (dev DB, 2026-10-24). */
const NOTION_TOPICS = [
  "BFS", "Binary Lifting / Sparse Table", "Binary Search", "Binary Search + Greedy",
  "Binary Search + Prefix Sum", "Binary Search on Matrix / 2D", "Bit Manipulation",
  "Counting / Frequency Map", "DFS (Tree/Graph)", "DP on Grids", "DP on Strings",
  "DP on Subarrays", "DP on Subsequences", "Divide and Conquer", "Dynamic Programming (1D)",
  "Fast & Slow Pointers", "Flood Fill / DFS on Matrix", "Geometry", "Graph Coloring / Bipartite",
  "Graph – Bellman-Ford", "Graph – Dijkstra’s Algorithm", "Graph – Eulerian Path / Circuit",
  "Graph – Floyd-Warshall", "Graph – Hamiltonian Path / TSP", "Graph – Minimum Spanning Tree",
  "Greedy + Sorting with Prefix", "Greedy Sorting", "Greedy with Heap", "Hashing + Set/Map",
  "Heap (Priority Queue)", "Kadane’s Algorithm (Dynamic Window)", "Matrix Exponentiation",
  "Meet in the Middle", "Monotonic Queue", "Monotonic Stack", "Monotonic Stack + String",
  "Pattern Recognition / Hybrid", "Prefix Sum / Difference Array", "Recursion & Backtracking",
  "Reservoir Sampling / Randomized", "Segment Tree / Fenwick Tree", "Sliding Window",
  "Sorting + Two Pointers", "Stack + String", "String Matching", "Top-K Pattern",
  "Topological Sort", "Trie (Prefix Tree)", "Two Pointers", "Union-Find (Disjoint Set)",
].map((name, i) => makeTopic({ id: `t${i}`, name }));

describe("resolveTopicByLabel on the real Notion names (P3.4)", () => {
  it("maps each default label to its own topic", () => {
    const resolved = Object.fromEntries(
      DEFAULT_CURRICULUM_TOPICS.map((label) => [label, resolveTopicByLabel(label, NOTION_TOPICS)?.name]),
    );
    expect(resolved).toEqual({
      "Binary Search": "Binary Search",
      Trees: "DFS (Tree/Graph)",
      Heaps: "Heap (Priority Queue)",
      Graphs: "BFS",
      "Sliding Window": "Sliding Window",
      Backtracking: "Recursion & Backtracking",
      Greedy: "Greedy Sorting",
      DP: "Dynamic Programming (1D)",
      Tries: "Trie (Prefix Tree)",
      "Union Find": "Union-Find (Disjoint Set)",
      "Monotonic Stack": "Monotonic Stack",
      "Segment Tree": "Segment Tree / Fenwick Tree",
    });
    expect(new Set(Object.values(resolved)).size).toBe(12);
  });

  it("does not match a topic just because an alias contains its name", () => {
    expect(resolveTopicByLabel("Tree BFS", [makeTopic({ id: "b", name: "BFS" })])).toBeNull();
  });
});

describe("CurriculumEngine.selectPrimaryTopic (P3.4)", () => {
  const engine = new CurriculumEngine();
  const topics = [
    makeTopic({ id: "bs", name: "Binary Search", confidence: 70, lastRevised: new Date() }),
    makeTopic({ id: "trees", name: "Trees", confidence: 20 }),
    makeTopic({ id: "graphs", name: "Graphs", confidence: 10 }),
  ];
  const names = ["Binary Search", "Trees", "Graphs"];
  const counts = new Map<string, TopicProblemCounts>([
    ["bs", { total: 5, unsolved: 3 }],
    ["trees", { total: 5, unsolved: 5 }],
    ["graphs", { total: 5, unsolved: 5 }],
  ]);
  const noEdges = { currentTopicId: null, edges: [] };

  it("honours a manual pin first", () => {
    const sel = engine.selectPrimaryTopic({ topicNames: names, activeTopicId: "bs" }, topics, counts, noEdges);
    expect(sel).toMatchObject({ source: "pin", topic: { id: "bs" } });
  });

  it("stays on the current topic while its first pass has work left", () => {
    const sel = engine.selectPrimaryTopic({ topicNames: names }, topics, counts, {
      currentTopicId: "bs",
      edges: [],
    });
    expect(sel).toMatchObject({ source: "current", topic: { id: "bs" } });
  });

  it("ranks ready topics by priority, not list order", () => {
    const sel = engine.selectPrimaryTopic({ topicNames: names }, topics, counts, noEdges);
    expect(sel?.source).toBe("ranked");
    expect(sel?.topic.id).toBe("graphs"); // weakest, so highest priority
    expect(sel?.index).toBe(2);
    expect(sel?.items[2]?.status).toBe("current");
  });

  it("skips a topic whose prerequisite has nothing covered yet", () => {
    // graphs needs trees; trees has 0 covered.
    const sel = engine.selectPrimaryTopic({ topicNames: names }, topics, counts, {
      currentTopicId: null,
      edges: [{ from: "trees", to: "graphs" }],
    });
    expect(sel?.topic.id).toBe("trees");
  });

  it("moves on when the current topic's first pass is complete", () => {
    const done = new Map(counts).set("bs", { total: 5, unsolved: 0 });
    const sel = engine.selectPrimaryTopic({ topicNames: names }, topics, done, {
      currentTopicId: "bs",
      edges: [],
    });
    expect(sel?.topic.id).not.toBe("bs");
    expect(sel?.source).toBe("ranked");
  });

  it("falls back to curriculum order when every candidate is blocked", () => {
    const sel = engine.selectPrimaryTopic({ topicNames: names }, topics, counts, {
      currentTopicId: null,
      edges: [
        { from: "x", to: "bs" },
        { from: "x", to: "trees" },
        { from: "x", to: "graphs" },
      ],
    });
    // "x" is unknown (no counts) → treated as satisfied, so nothing is blocked.
    expect(sel?.source).toBe("ranked");
    const blocked = engine.selectPrimaryTopic({ topicNames: names }, topics, counts, {
      currentTopicId: null,
      edges: [
        { from: "graphs", to: "bs" },
        { from: "graphs", to: "trees" },
        { from: "trees", to: "graphs" },
      ],
    });
    expect(blocked).toMatchObject({ source: "fallback", topic: { id: "bs" } });
  });

  it("reports completion when no listed topic has work left", () => {
    const allDone = new Map<string, TopicProblemCounts>([
      ["bs", { total: 5, unsolved: 0 }],
      ["trees", { total: 5, unsolved: 0 }],
      ["graphs", { total: 5, unsolved: 0 }],
    ]);
    expect(engine.selectPrimaryTopic({ topicNames: names }, topics, allDone, noEdges)?.source).toBe("complete");
  });
});

import type { TopicState } from "../types.js";

/**
 * Hard prerequisites between topics — the single source of truth (P7.2).
 *
 * Approved by Santosh 2026-10-25 in `docs/plans/topic-tiers.md` §4 (D13): only
 * where a pattern is built from another. `topic-prerequisites.test.ts` checks
 * this list against that table, so the doc and the code cannot drift apart.
 * Names are the exact topic names in the DB (curly apostrophes included;
 * matching normalizes punctuation).
 */
export const HARD_TOPIC_PREREQUISITES: readonly (readonly [prerequisite: string, topic: string])[] = [
  ["Binary Search", "Binary Search + Greedy"],
  ["Binary Search", "Binary Search on Matrix / 2D"],
  ["Recursion & Backtracking", "Dynamic Programming (1D)"],
  ["Recursion & Backtracking", "DFS (Tree/Graph)"],
  ["Recursion & Backtracking", "Divide and Conquer"],
  ["BFS", "Topological Sort"],
  ["BFS", "Graph – Dijkstra’s Algorithm"],
  ["BFS", "Graph Coloring / Bipartite"],
  ["Greedy Sorting", "Greedy with Heap"],
  ["Greedy Sorting", "Binary Search + Greedy"],
  ["Greedy Sorting", "Greedy + Sorting with Prefix"],
  ["Dynamic Programming (1D)", "DP on Subsequences"],
  ["Dynamic Programming (1D)", "DP on Grids"],
  ["Dynamic Programming (1D)", "DP on Strings"],
  ["Dynamic Programming (1D)", "DP on Subarrays"],
  ["Dynamic Programming (1D)", "Matrix Exponentiation"],
  ["DFS (Tree/Graph)", "Flood Fill / DFS on Matrix"],
  ["DFS (Tree/Graph)", "Binary Lifting / Sparse Table"],
  ["DFS (Tree/Graph)", "Graph – Eulerian Path / Circuit"],
  ["DFS (Tree/Graph)", "Graph – Hamiltonian Path / TSP"],
  ["Prefix Sum / Difference Array", "Segment Tree / Fenwick Tree"],
  ["Prefix Sum / Difference Array", "Greedy + Sorting with Prefix"],
  ["Stack + String", "Monotonic Stack"],
  ["Monotonic Stack", "Monotonic Queue"],
  ["Monotonic Stack", "Monotonic Stack + String"],
  ["Top-K Pattern", "Greedy with Heap"],
  ["Top-K Pattern", "Graph – Dijkstra’s Algorithm"],
  ["Union-Find (Disjoint Set)", "Graph – Minimum Spanning Tree"],
  ["Graph – Dijkstra’s Algorithm", "Graph – Bellman-Ford"],
  ["Graph – Dijkstra’s Algorithm", "Graph – Floyd-Warshall"],
];

/** P7.1 groups and order (`topic-tiers.md` §1–3), for the two-loop selector (P7.4). */
export const BASIC_TOPICS: readonly string[] = [
  "Two Pointers",
  "Fast & Slow Pointers",
  "Sliding Window",
  "Sorting + Two Pointers",
  "Hashing + Set/Map",
  "Counting / Frequency Map",
  "Binary Search",
  "Binary Search + Prefix Sum",
  "Recursion & Backtracking",
  "BFS",
  "String Matching",
];

export const CORE_TOPIC_ORDER: readonly string[] = [
  "Greedy Sorting",
  "Dynamic Programming (1D)",
  "DFS (Tree/Graph)",
  "Prefix Sum / Difference Array",
  "Stack + String",
  "Monotonic Stack",
  "Top-K Pattern",
  "DP on Subsequences",
  "Flood Fill / DFS on Matrix",
  "Topological Sort",
  "Union-Find (Disjoint Set)",
  "Kadane’s Algorithm (Dynamic Window)",
  "DP on Grids",
  "Greedy with Heap",
  "Binary Search + Greedy",
  "Trie (Prefix Tree)",
  "DP on Strings",
  "Bit Manipulation",
  "Graph – Dijkstra’s Algorithm",
  "Monotonic Queue",
  "DP on Subarrays",
];

export const LATER_TOPIC_ORDER: readonly string[] = [
  "Heap (Priority Queue)",
  "Graph Coloring / Bipartite",
  "Graph – Minimum Spanning Tree",
  "Graph – Bellman-Ford",
  "Graph – Floyd-Warshall",
  "Segment Tree / Fenwick Tree",
  "Binary Search on Matrix / 2D",
  "Greedy + Sorting with Prefix",
  "Monotonic Stack + String",
  "Divide and Conquer",
  "Matrix Exponentiation",
  "Binary Lifting / Sparse Table",
  "Geometry",
  "Meet in the Middle",
  "Reservoir Sampling / Randomized",
  "Graph – Eulerian Path / Circuit",
  "Graph – Hamiltonian Path / TSP",
  "Pattern Recognition / Hybrid",
];
type TopicRef = Pick<TopicState, "id" | "name">;

/** Lowercase, punctuation (including ’ vs ') folded to spaces. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Exact (normalized) name match only — no aliases, no partial matches. */
export function findTopicByName<T extends TopicRef>(name: string, topics: readonly T[]): T | null {
  const key = normalize(name);
  return topics.find((t) => normalize(t.name) === key) ?? null;
}

/**
 * Hard-prerequisite edges (prerequisite id → topic id) for the topics present.
 * Pairs whose topic is missing are skipped. Used by the curriculum and the
 * Knowledge Graph when `curriculumV2` is on.
 */
export function buildHardPrerequisiteEdges(
  topics: readonly TopicRef[],
): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const [prereq, topic] of HARD_TOPIC_PREREQUISITES) {
    const from = findTopicByName(prereq, topics);
    const to = findTopicByName(topic, topics);
    if (from && to && from.id !== to.id) edges.push({ from: from.id, to: to.id });
  }
  return edges;
}

/** Hard prerequisites of one topic, by name. */
export function hardPrerequisitesOf(topicName: string): string[] {
  const key = normalize(topicName);
  return HARD_TOPIC_PREREQUISITES.filter(([, t]) => normalize(t) === key).map(([p]) => p);
}

/** A cycle in name-level edges, or null. Used by the acyclicity test. */
export function findPrerequisiteCycle(
  edges: readonly (readonly [string, string])[] = HARD_TOPIC_PREREQUISITES,
): string[] | null {
  const next = new Map<string, string[]>();
  for (const [from, to] of edges) next.set(from, [...(next.get(from) ?? []), to]);
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];
  const visit = (node: string): string[] | null => {
    if (state.get(node) === "done") return null;
    if (state.get(node) === "visiting") return [...path.slice(path.indexOf(node)), node];
    state.set(node, "visiting");
    path.push(node);
    for (const n of next.get(node) ?? []) {
      const cycle = visit(n);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(node, "done");
    return null;
  };
  for (const node of next.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

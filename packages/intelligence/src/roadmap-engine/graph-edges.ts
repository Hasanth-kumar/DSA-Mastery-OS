import type { TopicState } from "../types.js";
import { DSA_PREREQUISITES } from "./dsa-roadmap.js";

type TopicRef = Pick<TopicState, "id" | "name" | "prerequisites">;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Whole-phrase containment: the topic name contains `name` as a phrase. */
function nameContains(topicName: string, name: string): boolean {
  const t = ` ${normalize(topicName)} `;
  const n = normalize(name);
  return n.length > 0 && t.includes(` ${n} `);
}

/** Canonical DSA labels → common Notion / mirror DB topic name variants. */
const CANONICAL_TOPIC_ALIASES: Record<string, string[]> = {
  Arrays: ["Hashing + Set/Map", "Prefix Sum / Difference Array", "Two Pointers"],
  "Linked Lists": ["Fast & Slow Pointers"],
  Stacks: ["Monotonic Stack", "Stack + String"],
  Trees: ["DFS (Tree/Graph)"],
  Graphs: ["DFS (Tree/Graph)", "BFS"],
  "Graph BFS": ["BFS"],
  "Graph DFS": ["DFS (Tree/Graph)"],
  "Dijkstra's Algorithm": ["Graph – Dijkstra's Algorithm"],
  Recursion: ["Recursion & Backtracking"],
  "Dynamic Programming": ["Dynamic Programming (1D)"],
};

/**
 * Canonical name → topic id. Exact (normalized) name, then an exact alias,
 * then a topic whose name contains the name or an alias as a phrase. Never an
 * alias containing the topic name: that matched "Arrays" to "DP on Subarrays"
 * and "Binary Search Tree" to "Binary Search" (P3.4).
 */
function resolveTopicId(name: string, topics: TopicRef[]): string | null {
  const candidates = [name, ...(CANONICAL_TOPIC_ALIASES[name] ?? [])];
  for (const c of candidates) {
    const exact = topics.find((t) => normalize(t.name) === normalize(c));
    if (exact) return exact.id;
  }
  for (const c of candidates) {
    const partial = topics.find((t) => nameContains(t.name, c));
    if (partial) return partial.id;
  }
  return null;
}

/**
 * Extended prerequisite pairs for the knowledge graph visualization only.
 * Does not affect roadmap unlock, scoring, or Notion sync.
 */
export const GRAPH_TOPIC_PREREQUISITES: [string, string][] = [
  ["Two Pointers", "Sliding Window"],
  ["Two Pointers", "Sorting + Two Pointers"],
  ["Two Pointers", "Fast & Slow Pointers"],
  ["Hashing + Set/Map", "Counting / Frequency Map"],
  ["Hashing + Set/Map", "Prefix Sum / Difference Array"],
  ["Hashing + Set/Map", "Trie (Prefix Tree)"],
  ["Binary Search", "Binary Search on Matrix / 2D"],
  ["Binary Search", "Binary Search + Prefix Sum"],
  ["Binary Search", "Binary Search + Greedy"],
  ["Prefix Sum / Difference Array", "Binary Search + Prefix Sum"],
  ["Prefix Sum / Difference Array", "Segment Tree / Fenwick Tree"],
  ["Prefix Sum / Difference Array", "Greedy + Sorting with Prefix"],
  ["Recursion & Backtracking", "Dynamic Programming (1D)"],
  ["Recursion & Backtracking", "Divide and Conquer"],
  ["Recursion & Backtracking", "DFS (Tree/Graph)"],
  ["Dynamic Programming (1D)", "DP on Subarrays"],
  ["Dynamic Programming (1D)", "DP on Strings"],
  ["Dynamic Programming (1D)", "DP on Grids"],
  ["Dynamic Programming (1D)", "Matrix Exponentiation"],
  ["DP on Subarrays", "DP on Subsequences"],
  ["DP on Subarrays", "Kadane's Algorithm (Dynamic Window)"],
  ["Stack + String", "Monotonic Stack"],
  ["Monotonic Stack", "Monotonic Queue"],
  ["Monotonic Stack", "Monotonic Stack + String"],
  ["Stack + String", "Monotonic Stack + String"],
  ["Stack + String", "String Matching"],
  ["Hashing + Set/Map", "String Matching"],
  ["Heap (Priority Queue)", "Greedy with Heap"],
  ["Heap (Priority Queue)", "Top-K Pattern"],
  ["Greedy Sorting", "Greedy with Heap"],
  ["Greedy Sorting", "Greedy + Sorting with Prefix"],
  ["Greedy Sorting", "Binary Search + Greedy"],
  ["DFS (Tree/Graph)", "BFS"],
  ["DFS (Tree/Graph)", "Flood Fill / DFS on Matrix"],
  ["DFS (Tree/Graph)", "Union-Find (Disjoint Set)"],
  ["BFS", "Topological Sort"],
  ["BFS", "Graph – Dijkstra's Algorithm"],
  ["BFS", "Graph Coloring / Bipartite"],
  ["BFS", "Graph – Bellman-Ford"],
  ["Heap (Priority Queue)", "Graph – Dijkstra's Algorithm"],
  ["Graph – Dijkstra's Algorithm", "Graph – Floyd-Warshall"],
  ["Union-Find (Disjoint Set)", "Graph – Minimum Spanning Tree"],
  ["DFS (Tree/Graph)", "Graph – Eulerian Path / Circuit"],
  ["Recursion & Backtracking", "Graph – Hamiltonian Path / TSP"],
  ["DFS (Tree/Graph)", "Graph – Hamiltonian Path / TSP"],
  ["Segment Tree / Fenwick Tree", "Binary Lifting / Sparse Table"],
  ["DFS (Tree/Graph)", "Binary Lifting / Sparse Table"],
  ["Divide and Conquer", "Meet in the Middle"],
  ["Sliding Window", "Pattern Recognition / Hybrid"],
  ["Two Pointers", "Pattern Recognition / Hybrid"],
  ["Dynamic Programming (1D)", "Pattern Recognition / Hybrid"],
  ["Hashing + Set/Map", "Reservoir Sampling / Randomized"],
];

function addEdge(
  edges: Map<string, { from: string; to: string }>,
  fromId: string,
  toId: string,
): void {
  if (fromId === toId) return;
  edges.set(`${fromId}|${toId}`, { from: fromId, to: toId });
}

/**
 * Build directed prerequisite edges for the knowledge graph.
 * Merges explicit DB/Notion prerequisites with inferred curriculum links.
 * Inference is visualization-only — roadmap unlock and scoring stay unchanged.
 */
export function buildTopicGraphEdges(
  topics: TopicRef[],
): Array<{ from: string; to: string }> {
  const edges = new Map<string, { from: string; to: string }>();
  const topicIds = new Set(topics.map((t) => t.id));

  for (const topic of topics) {
    for (const prereqId of topic.prerequisites) {
      if (topicIds.has(prereqId)) {
        addEdge(edges, prereqId, topic.id);
      }
    }
  }

  for (const [prereq, topic] of DSA_PREREQUISITES) {
    const from = resolveTopicId(prereq, topics);
    const to = resolveTopicId(topic, topics);
    if (from && to) addEdge(edges, from, to);
  }

  for (const [prereq, topic] of GRAPH_TOPIC_PREREQUISITES) {
    const from = resolveTopicId(prereq, topics);
    const to = resolveTopicId(topic, topics);
    if (from && to) addEdge(edges, from, to);
  }

  return [...edges.values()];
}

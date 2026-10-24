/** Default sequential study order — finish all problems in a topic before advancing. */
export const DEFAULT_CURRICULUM_TOPICS = [
  "Binary Search",
  "Trees",
  "Heaps",
  "Graphs",
  "Sliding Window",
  "Backtracking",
  "Greedy",
  "DP",
  "Tries",
  "Union Find",
  "Monotonic Stack",
  "Segment Tree",
] as const;

/**
 * Short labels → topic names in Notion / the mirror DB, most specific first.
 * The last entries are Santosh's actual Notion names (P3.4); resolution tries
 * an exact match on every alias before any partial match.
 */
export const TOPIC_NAME_ALIASES: Record<string, string[]> = {
  "Binary Search": ["Binary Search"],
  Trees: ["Trees", "Tree DFS", "Tree BFS", "Binary Search Tree", "DFS (Tree/Graph)"],
  Heaps: ["Heaps", "Heap", "Priority Queue", "Heap (Priority Queue)"],
  Graphs: ["Graphs", "Graph DFS", "Graph BFS", "BFS"],
  "Sliding Window": ["Sliding Window"],
  Backtracking: ["Backtracking", "Recursion & Backtracking"],
  Greedy: ["Greedy", "Greedy Sorting"],
  DP: ["DP", "Dynamic Programming", "Dynamic Programming (1D)"],
  Tries: ["Tries", "Trie", "Trie (Prefix Tree)"],
  "Union Find": ["Union Find", "Disjoint Set", "Union-Find", "Union-Find (Disjoint Set)"],
  "Monotonic Stack": ["Monotonic Stack"],
  "Segment Tree": ["Segment Tree", "Segment Trees", "Segment Tree / Fenwick Tree"],
};

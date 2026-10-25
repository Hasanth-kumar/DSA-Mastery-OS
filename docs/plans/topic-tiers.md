# Topic tiers — introduction order and hard prerequisites (P7.1)

**Status: draft for Santosh's approval** (QUESTIONS.md [D13]). Nothing in Phase 7 builds on it until approved.

Built from the 50 topics in the dev DB (2026-10-25). Two things only, per plan §6.2:

1. **An introduction order** — which pattern to start next. It is *not* a gate: a manual pin (Switch pattern) always wins, and nothing here stops you practising anything.
2. **A short list of hard prerequisites** — only where a pattern is built from another. Everything else has none.

"Pass 1" is the D3 rule: fewer than 4 problems → all of them; otherwise all Easy + up to 3 Medium. The *Pass 1 needs* column is that count for each pattern, so you can see the size of each step.

## 1. Basics — consolidate later (no intro block)

Patterns you have already started or called familiar. They are **not** introduced again as a block and **don't count against the 3-open-patterns cap** (P7.4). They come back in the consolidation loop, with Greedy and DP thinking, until each reaches pass 2. As prerequisites they count as **satisfied** (decision 1).

| Pattern | Problems | Covered now | Pass 1 needs |
|---|---|---|---|
| Two Pointers | 8 (3E · 4M · 1H) | 6 of 8 | 6 |
| Fast & Slow Pointers | 7 (4E · 3M · 0H) | 7 of 7 | 7 |
| Sliding Window | 13 (1E · 11M · 1H) | 1 of 13 | 4 |
| Sorting + Two Pointers | 8 (1E · 7M · 0H) | 1 of 8 | 4 |
| Hashing + Set/Map | 5 (3E · 2M · 0H) | 1 of 5 | 5 |
| Counting / Frequency Map | 5 (3E · 2M · 0H) | 0 of 5 | 5 |
| Binary Search | 8 (3E · 4M · 1H) | 0 of 8 | 6 |
| Binary Search + Prefix Sum | 4 (1E · 3M · 0H) | 4 of 4 | 4 |
| Recursion & Backtracking | 10 (0E · 8M · 2H) | 10 of 10 | 3 |
| BFS | 17 (3E · 11M · 3H) | 6 of 17 | 6 |
| String Matching | 4 (2E · 0M · 2H) | 0 of 4 | 2 |

## 2. Core — the exposure loop, in this order

Introduced one at a time with a short block (2–4 problems, pattern shown), at most 3 below pass 1 at once. A pattern is skipped (not blocked) while a hard prerequisite is below pass 1; the next eligible one is taken. The consolidation loop starts when all of these are at pass 1.

| # | Pattern | Problems | Covered now | Pass 1 needs | Hard prerequisites | Why here |
|---|---|---|---|---|---|---|
| 1 | Greedy Sorting | 10 (1E · 9M · 0H) | 6 of 10 | 4 | — | In progress now. Your chosen exposure pattern. |
| 2 | Dynamic Programming (1D) | 11 (2E · 8M · 1H) | 0 of 11 | 5 | Recursion & Backtracking | Early DP exposure, as you asked. Builds on recursion. |
| 3 | DFS (Tree/Graph) | 12 (7E · 4M · 1H) | 0 of 12 | 10 | Recursion & Backtracking | Trees and graph traversal; unlocks most graph patterns. |
| 4 | Prefix Sum / Difference Array | 5 (2E · 3M · 0H) | 0 of 5 | 5 | — | Small, common, and feeds Segment Tree and Greedy + Prefix later. |
| 5 | Stack + String | 9 (2E · 5M · 2H) | 0 of 9 | 5 | — | Stack basics on strings; the base for Monotonic Stack. |
| 6 | Monotonic Stack | 9 (1E · 7M · 1H) | 0 of 9 | 4 | Stack + String | Very common in interviews (next greater, histogram). |
| 7 | Top-K Pattern | 6 (1E · 5M · 0H) | 0 of 6 | 4 | — | Heap entry point (see decision 2). |
| 8 | DP on Subsequences | 7 (0E · 6M · 1H) | 0 of 7 | 3 | Dynamic Programming (1D) | Knapsack / LIS family: the core DP shapes. |
| 9 | Flood Fill / DFS on Matrix | 8 (2E · 6M · 0H) | 0 of 8 | 5 | DFS (Tree/Graph) | Grid DFS; quick once DFS is in. |
| 10 | Topological Sort | 5 (0E · 3M · 2H) | 0 of 5 | 3 | BFS | Ordering with BFS (Kahn) or DFS. |
| 11 | Union-Find (Disjoint Set) | 6 (1E · 5M · 0H) | 0 of 6 | 4 | — | Connectivity; unlocks MST. |
| 12 | Kadane’s Algorithm (Dynamic Window) | 4 (1E · 3M · 0H) | 0 of 4 | 4 | — | Short; max-subarray thinking. |
| 13 | DP on Grids | 7 (0E · 5M · 2H) | 0 of 7 | 3 | Dynamic Programming (1D) | 2D DP after 1D. |
| 14 | Greedy with Heap | 5 (0E · 4M · 1H) | 0 of 5 | 3 | Greedy Sorting, Top-K Pattern | Greedy + heap (scheduling, merging). |
| 15 | Binary Search + Greedy | 10 (1E · 7M · 2H) | 0 of 10 | 4 | Binary Search, Greedy Sorting | Binary search on the answer. |
| 16 | Trie (Prefix Tree) | 8 (0E · 6M · 2H) | 0 of 8 | 3 | — | Prefix problems; standalone. |
| 17 | DP on Strings | 9 (0E · 6M · 3H) | 0 of 9 | 3 | Dynamic Programming (1D) | Edit distance / LCS family. |
| 18 | Bit Manipulation | 9 (5E · 4M · 0H) | 1 of 9 | 8 | — | Standalone, 5 Easy problems. |
| 19 | Graph – Dijkstra’s Algorithm | 4 (0E · 2M · 2H) | 0 of 4 | 2 | BFS, Top-K Pattern | Weighted shortest path; needs BFS and a heap. |
| 20 | Monotonic Queue | 4 (0E · 2M · 2H) | 0 of 4 | 2 | Monotonic Stack | Sliding-window max; after Monotonic Stack. |
| 21 | DP on Subarrays | 6 (0E · 2M · 4H) | 0 of 6 | 2 | Dynamic Programming (1D) | Mostly Hard (4 of 6); last of the core DP. |

Pass 1 across the core: **86 problems** (some already covered).

## 3. Later — after the core, or whenever you pin one

Advanced, rare in interviews, or too few problems for a block. Not introduced automatically until every core pattern is at pass 1; pin any of them at any time.

| # | Pattern | Problems | Hard prerequisites | Note |
|---|---|---|---|---|
| 22 | Heap (Priority Queue) | 2 (0E · 0M · 2H) | — | Only 2 problems, both Hard. Heap ideas are already covered by Top-K. |
| 23 | Graph Coloring / Bipartite | 2 (0E · 2M · 0H) | BFS |  |
| 24 | Graph – Minimum Spanning Tree | 3 (0E · 3M · 0H) | Union-Find (Disjoint Set) |  |
| 25 | Graph – Bellman-Ford | 1 (0E · 1M · 0H) | Graph – Dijkstra’s Algorithm |  |
| 26 | Graph – Floyd-Warshall | 1 (0E · 1M · 0H) | Graph – Dijkstra’s Algorithm |  |
| 27 | Segment Tree / Fenwick Tree | 4 (0E · 2M · 2H) | Prefix Sum / Difference Array |  |
| 28 | Binary Search on Matrix / 2D | 3 (0E · 3M · 0H) | Binary Search |  |
| 29 | Greedy + Sorting with Prefix | 2 (1E · 0M · 1H) | Greedy Sorting, Prefix Sum / Difference Array |  |
| 30 | Monotonic Stack + String | 4 (0E · 3M · 1H) | Monotonic Stack |  |
| 31 | Divide and Conquer | 2 (0E · 1M · 1H) | Recursion & Backtracking |  |
| 32 | Matrix Exponentiation | 2 (1E · 1M · 0H) | Dynamic Programming (1D) |  |
| 33 | Binary Lifting / Sparse Table | 2 (0E · 2M · 0H) | DFS (Tree/Graph) |  |
| 34 | Geometry | 4 (0E · 2M · 2H) | — |  |
| 35 | Meet in the Middle | 4 (0E · 1M · 3H) | — |  |
| 36 | Reservoir Sampling / Randomized | 3 (0E · 3M · 0H) | — |  |
| 37 | Graph – Eulerian Path / Circuit | 2 (0E · 0M · 2H) | DFS (Tree/Graph) |  |
| 38 | Graph – Hamiltonian Path / TSP | 1 (0E · 0M · 1H) | DFS (Tree/Graph) |  |
| 39 | Pattern Recognition / Hybrid | 1 (0E · 1M · 0H) | — | One mixed problem; better as a final check than a block. |

## 4. Hard prerequisites (the whole list)

`prerequisite → pattern`. P7.2 turns exactly these into the shared DAG (tested acyclic).

| Prerequisite | Unlocks |
|---|---|
| Binary Search | Binary Search + Greedy, Binary Search on Matrix / 2D |
| Recursion & Backtracking | Dynamic Programming (1D), DFS (Tree/Graph), Divide and Conquer |
| BFS | Topological Sort, Graph – Dijkstra’s Algorithm, Graph Coloring / Bipartite |
| Greedy Sorting | Greedy with Heap, Binary Search + Greedy, Greedy + Sorting with Prefix |
| Dynamic Programming (1D) | DP on Subsequences, DP on Grids, DP on Strings, DP on Subarrays, Matrix Exponentiation |
| DFS (Tree/Graph) | Flood Fill / DFS on Matrix, Binary Lifting / Sparse Table, Graph – Eulerian Path / Circuit, Graph – Hamiltonian Path / TSP |
| Prefix Sum / Difference Array | Segment Tree / Fenwick Tree, Greedy + Sorting with Prefix |
| Stack + String | Monotonic Stack |
| Monotonic Stack | Monotonic Queue, Monotonic Stack + String |
| Top-K Pattern | Greedy with Heap, Graph – Dijkstra’s Algorithm |
| Union-Find (Disjoint Set) | Graph – Minimum Spanning Tree |
| Graph – Dijkstra’s Algorithm | Graph – Bellman-Ford, Graph – Floyd-Warshall |

30 edges.

## 5. Differences from the graph view's edges (`graph-edges.ts`)

Those edges are "related" links for the picture; these are only "built from". Dropped as hard prerequisites (they can stay as related links in the graph view if P7.2 keeps a second list):

- Basics-to-basics links (Two Pointers → Sliding Window / Sorting + Two Pointers / Fast & Slow; Hashing → Counting, Prefix Sum, Trie, String Matching; Stack + String → String Matching; Binary Search → Binary Search + Prefix Sum).
- DFS → BFS (BFS is already started; neither is built from the other), DFS → Union-Find, Recursion → Hamiltonian (kept via DFS).
- DP on Subarrays → DP on Subsequences and → Kadane's (Kadane's is the simpler one; both now only need DP 1D or nothing).
- Segment Tree → Binary Lifting (replaced by DFS → Binary Lifting).
- Heap (Priority Queue) → Greedy with Heap / Top-K / Dijkstra (replaced by Top-K, see decision 2).

Added: Top-K → Greedy with Heap and Dijkstra; Dijkstra → Bellman-Ford and Floyd-Warshall (same shortest-path ideas; replaces BFS → Bellman-Ford); DFS → Binary Lifting.

## 6. Decisions for Santosh

1. **Basics count as satisfied prerequisites.** You called them familiar, but in the app several are well below pass 1 (Binary Search 0 of 8 covered, Sliding Window 1 of 13). If they had to reach pass 1 first, Binary Search + Greedy and Binary Search on Matrix would wait on Binary Search, and the 11 basics would fill the 3-open cap so nothing new could start. *Proposed: satisfied; they return in the consolidation loop.*
2. **Top-K Pattern is the heap entry point.** "Heap (Priority Queue)" has only 2 problems, both Hard; as a prerequisite it would block Top-K, Greedy with Heap and Dijkstra behind two Hards (pass 1 of a < 4-problem topic = all of them). *Proposed: Top-K (1E · 5M) is the prerequisite instead; the Heap topic moves to Later.*
3. **Core size.** 21 patterns before the consolidation loop starts. At 1–2 problems a day that is months. *Alternative: end the core at #13 (DP on Grids) for a first round, then consolidate, then do #14–21.*
4. **DP order.** DP (1D) is #2 and DP on Subsequences #8 (your "DP early" direction). Say if you'd rather finish Greedy and the graph basics first.

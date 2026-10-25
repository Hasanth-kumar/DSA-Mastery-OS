import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BASIC_TOPICS,
  buildHardPrerequisiteEdges,
  CORE_TOPIC_ORDER,
  findPrerequisiteCycle,
  HARD_TOPIC_PREREQUISITES,
  hardPrerequisitesOf,
  LATER_TOPIC_ORDER,
} from "./topic-prerequisites.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const tiers = readFileSync(resolve(repoRoot, "docs/plans/topic-tiers.md"), "utf-8");

/** "| Prerequisite | A, B |" rows of topic-tiers.md §4. */
function docPairs(): string[] {
  const section = tiers.split("## 4. Hard prerequisites")[1].split("## 5.")[0];
  const pairs: string[] = [];
  for (const line of section.split("\n")) {
    const m = line.match(/^\| (.+?) \| (.+?) \|$/);
    if (!m || m[1] === "Prerequisite" || m[1].startsWith("---")) continue;
    for (const topic of m[2].split(", ")) pairs.push(`${m[1]} → ${topic}`);
  }
  return pairs.sort();
}

const ALL = [...BASIC_TOPICS, ...CORE_TOPIC_ORDER, ...LATER_TOPIC_ORDER];

describe("hard topic prerequisites (P7.2)", () => {
  it("match topic-tiers.md §4 exactly", () => {
    const code = HARD_TOPIC_PREREQUISITES.map(([p, t]) => `${p} → ${t}`).sort();
    expect(code).toEqual(docPairs());
    expect(code).toHaveLength(30);
  });

  it("form a DAG", () => {
    expect(findPrerequisiteCycle()).toBeNull();
    // the checker itself catches a cycle
    expect(findPrerequisiteCycle([["A", "B"], ["B", "C"], ["C", "A"]])).toEqual(["A", "B", "C", "A"]);
  });

  it("cover all 50 topics once, and name only topics in the tiers", () => {
    expect(ALL).toHaveLength(50);
    expect(new Set(ALL).size).toBe(50);
    for (const [p, t] of HARD_TOPIC_PREREQUISITES) {
      expect(ALL, p).toContain(p);
      expect(ALL, t).toContain(t);
    }
  });

  it("every prerequisite comes earlier in the order, or is a basic", () => {
    const order = [...CORE_TOPIC_ORDER, ...LATER_TOPIC_ORDER];
    for (const [p, t] of HARD_TOPIC_PREREQUISITES) {
      if (BASIC_TOPICS.includes(p)) continue;
      expect(order.indexOf(p), `${p} → ${t}`).toBeLessThan(order.indexOf(t));
    }
  });

  it("builds id edges by exact name, folding apostrophes, skipping missing topics", () => {
    const topics = [
      { id: "bfs", name: "BFS" },
      { id: "topk", name: "Top-K Pattern" },
      { id: "dij", name: "Graph – Dijkstra's Algorithm" }, // straight apostrophe
      { id: "bst", name: "Binary Search Tree" }, // must not match "Binary Search"
      { id: "bsg", name: "Binary Search + Greedy" },
    ];
    expect(buildHardPrerequisiteEdges(topics)).toEqual([
      { from: "bfs", to: "dij" },
      { from: "topk", to: "dij" },
    ]);
  });

  it("lists one topic's prerequisites", () => {
    expect(hardPrerequisitesOf("Graph – Dijkstra’s Algorithm").sort()).toEqual(["BFS", "Top-K Pattern"]);
    expect(hardPrerequisitesOf("Greedy Sorting")).toEqual([]);
  });
});

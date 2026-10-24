import type { CurriculumItem, TopicState } from "../types.js";
import { computePriorityScore } from "../topic-priority-engine/scoring.js";
import {
  DEFAULT_CURRICULUM_TOPICS,
  TOPIC_NAME_ALIASES,
} from "./default-topics.js";

export type CurriculumItemStatus = CurriculumItem["status"];

export interface TopicProblemCounts {
  total: number;
  /** Problems remaining in the first pass (see `problem-progress.ts`). */
  unsolved: number;
}

export interface CurriculumConfig {
  topicNames: string[];
  /** Manual override — stay on this topic until cleared. */
  activeTopicId?: string | null;
}

export interface CurriculumSelection {
  topic: TopicState;
  index: number;
  items: CurriculumItem[];
  reasoning: string;
}

/** How the primary topic was chosen (P3.4). */
export type PrimaryTopicSource = "pin" | "current" | "ranked" | "fallback" | "complete";

export interface RankedSelection extends CurriculumSelection {
  source: PrimaryTopicSource;
}

export interface RankedSelectionContext {
  /** The topic the curriculum was on last time (auto, not a manual pin). */
  currentTopicId: string | null;
  /** Prerequisite edges (prerequisite → topic), e.g. `buildTopicGraphEdges`. */
  edges: ReadonlyArray<{ from: string; to: string }>;
  now?: Date;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Whole-phrase containment: "Heap" is in "Heap (Priority Queue)", "BFS" is not in "Tree BFS"'s topic. */
function nameContains(topicName: string, alias: string): boolean {
  const t = ` ${normalize(topicName)} `;
  const a = normalize(alias);
  return a.length > 0 && t.includes(` ${a} `);
}

/**
 * Label → topic. Exact (normalized) match on the label or any alias first,
 * then a topic whose name contains an alias as a phrase. Never the reverse
 * (an alias containing the topic name), which mapped "Tree BFS" to "BFS".
 */
export function resolveTopicByLabel(
  label: string,
  topics: TopicState[],
): TopicState | null {
  const aliases = [label, ...(TOPIC_NAME_ALIASES[label] ?? [])];
  for (const alias of aliases) {
    const exact = topics.find((t) => normalize(t.name) === normalize(alias));
    if (exact) return exact;
  }
  for (const alias of aliases) {
    const partial = topics.find((t) => nameContains(t.name, alias));
    if (partial) return partial;
  }
  return null;
}

function isTopicWorkRemaining(
  counts: TopicProblemCounts | undefined,
): boolean {
  if (!counts || counts.total === 0) return false;
  return counts.unsolved > 0;
}

function buildItems(
  config: CurriculumConfig,
  topics: TopicState[],
  countsByTopicId: Map<string, TopicProblemCounts>,
  currentTopicId: string | null,
): CurriculumItem[] {
  return config.topicNames.map((name) => {
    const topic = resolveTopicByLabel(name, topics);
    const counts = topic ? countsByTopicId.get(topic.id) : undefined;
    const totalCount = counts?.total ?? 0;
    const unsolvedCount = counts?.unsolved ?? 0;

    let status: CurriculumItemStatus = "missing";
    if (!topic) {
      status = "missing";
    } else if (topic.id === currentTopicId) {
      status = "current";
    } else if (totalCount > 0 && unsolvedCount === 0) {
      status = "complete";
    } else {
      status = "upcoming";
    }

    return {
      name,
      topicId: topic?.id ?? null,
      status,
      unsolvedCount,
      totalCount,
    };
  });
}

export class CurriculumEngine {
  getDefaultTopicNames(): string[] {
    return [...DEFAULT_CURRICULUM_TOPICS];
  }

  selectCurrentTopic(
    config: CurriculumConfig,
    topics: TopicState[],
    countsByTopicId: Map<string, TopicProblemCounts>,
  ): CurriculumSelection | null {
    if (topics.length === 0) return null;

    if (config.activeTopicId) {
      const topic = topics.find((t) => t.id === config.activeTopicId);
      if (topic) {
        const index = config.topicNames.findIndex((name) => {
          const resolved = resolveTopicByLabel(name, topics);
          return resolved?.id === topic.id;
        });
        const counts = countsByTopicId.get(topic.id);
        const unsolved = counts?.unsolved ?? 0;
        const items = buildItems(config, topics, countsByTopicId, topic.id);
        return {
          topic,
          index: index >= 0 ? index : 0,
          items,
          reasoning: `Focused on ${topic.name} (manual selection). ${unsolved} problem(s) remaining.`,
        };
      }
    }

    for (let i = 0; i < config.topicNames.length; i++) {
      const label = config.topicNames[i];
      const topic = resolveTopicByLabel(label, topics);
      if (!topic) continue;

      const counts = countsByTopicId.get(topic.id);
      if (!isTopicWorkRemaining(counts)) continue;

      const unsolved = counts?.unsolved ?? 0;
      const items = buildItems(config, topics, countsByTopicId, topic.id);
      return {
        topic,
        index: i,
        items,
        reasoning: `Curriculum ${i + 1}/${config.topicNames.length}: ${label}. ${unsolved} problem(s) left before moving on.`,
      };
    }

    const fallback = resolveTopicByLabel(
      config.topicNames[config.topicNames.length - 1] ?? "",
      topics,
    ) ?? topics[0];
    const items = buildItems(config, topics, countsByTopicId, fallback.id);
    return {
      topic: fallback,
      index: config.topicNames.length - 1,
      items,
      reasoning: `Curriculum complete — all listed topics finished. Reviewing ${fallback.name}.`,
    };
  }

  /**
   * P3.4 primary-topic selection.
   * 1. A valid manual pin wins.
   * 2. Otherwise stay on the current topic while its first pass has work left,
   *    so the day-to-day pattern does not hop around.
   * 3. Otherwise rank the curriculum topics with work left whose prerequisites
   *    are started (roadmap edges) by `computePriorityScore`, curriculum order
   *    breaking ties. If none is ready, follow curriculum order.
   * Phase 7 replaces steps 2–3 with spiral passes behind `curriculumV2`.
   */
  selectPrimaryTopic(
    config: CurriculumConfig,
    topics: TopicState[],
    countsByTopicId: Map<string, TopicProblemCounts>,
    context: RankedSelectionContext,
  ): RankedSelection | null {
    if (topics.length === 0) return null;

    if (config.activeTopicId && topics.some((t) => t.id === config.activeTopicId)) {
      const pinned = this.selectCurrentTopic(config, topics, countsByTopicId);
      return pinned ? { ...pinned, source: "pin" } : null;
    }

    const candidates: Array<{ topic: TopicState; index: number; label: string }> = [];
    const seen = new Set<string>();
    config.topicNames.forEach((label, index) => {
      const topic = resolveTopicByLabel(label, topics);
      if (!topic || seen.has(topic.id)) return;
      seen.add(topic.id);
      if (isTopicWorkRemaining(countsByTopicId.get(topic.id))) {
        candidates.push({ topic, index, label });
      }
    });

    if (candidates.length === 0) {
      const done = this.selectCurrentTopic({ topicNames: config.topicNames }, topics, countsByTopicId);
      return done ? { ...done, source: "complete" } : null;
    }

    const pick = (
      c: { topic: TopicState; index: number },
      source: PrimaryTopicSource,
      reasoning: string,
    ): RankedSelection => ({
      topic: c.topic,
      index: c.index,
      items: buildItems(config, topics, countsByTopicId, c.topic.id),
      reasoning,
      source,
    });
    const left = (t: TopicState) => countsByTopicId.get(t.id)?.unsolved ?? 0;

    const current = candidates.find((c) => c.topic.id === context.currentTopicId);
    if (current) {
      return pick(
        current,
        "current",
        `Continuing ${current.topic.name}: ${left(current.topic)} problem(s) left in its first pass.`,
      );
    }

    const prereqsOf = (id: string) => context.edges.filter((e) => e.to === id).map((e) => e.from);
    const ready = candidates.filter((c) =>
      prereqsOf(c.topic.id).every((p) => prerequisiteStarted(countsByTopicId.get(p))),
    );

    if (ready.length === 0) {
      const first = candidates[0];
      return pick(
        first,
        "fallback",
        `Next up: ${first.topic.name} (curriculum order; no remaining topic has its prerequisites started). ${left(first.topic)} problem(s) in its first pass.`,
      );
    }

    const topicsMap = new Map(topics.map((t) => [t.id, t]));
    const now = context.now ?? new Date();
    const ranked = ready
      .map((c) => ({ c, score: computePriorityScore(c.topic, topicsMap, undefined, now).total }))
      .sort((a, b) => b.score - a.score || a.c.index - b.c.index);
    const best = ranked[0].c;
    return pick(
      best,
      "ranked",
      `Next up: ${best.topic.name}, the highest priority of ${ready.length} ready topic(s). ${left(best.topic)} problem(s) in its first pass.`,
    );
  }
}

function coveredCount(counts: TopicProblemCounts | undefined): number {
  return counts ? counts.total - counts.unsolved : 0;
}

/** A prerequisite is satisfied once it has a covered problem, or has no problems at all. */
function prerequisiteStarted(counts: TopicProblemCounts | undefined): boolean {
  return !counts || counts.total === 0 || coveredCount(counts) > 0;
}

export function createCurriculumEngine(): CurriculumEngine {
  return new CurriculumEngine();
}

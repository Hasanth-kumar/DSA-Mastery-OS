import type { CurriculumItem, TopicState } from "../types.js";
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

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function resolveTopicByLabel(
  label: string,
  topics: TopicState[],
): TopicState | null {
  const aliases = TOPIC_NAME_ALIASES[label] ?? [label];
  for (const alias of aliases) {
    const exact = topics.find((t) => namesMatch(t.name, alias));
    if (exact) return exact;
  }
  return topics.find((t) => namesMatch(t.name, label)) ?? null;
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
}

export function createCurriculumEngine(): CurriculumEngine {
  return new CurriculumEngine();
}

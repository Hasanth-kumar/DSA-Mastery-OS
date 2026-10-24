import {
  buildTopicProblemCounts,
  createCurriculumEngine,
  type CurriculumConfig,
  type CurriculumItem,
  type CurriculumProgress,
  type CurriculumSelection,
  type TopicProblemCounts,
  type TopicState,
} from "@dsa/intelligence";
import type { ProblemRepository } from "../repositories/ProblemRepository.js";
import type { SyncMetaRepository } from "../repositories/SyncMetaRepository.js";

const TOPICS_KEY = "curriculum_topics";
const ACTIVE_TOPIC_KEY = "curriculum_active_topic_id";

export interface CurriculumState {
  topicNames: string[];
  activeTopicId: string | null;
  selection: CurriculumSelection | null;
}

export class CurriculumService {
  private readonly engine = createCurriculumEngine();

  constructor(
    private readonly syncMetaRepo: SyncMetaRepository,
    private readonly problemRepo: ProblemRepository,
  ) {}

  getTopicNames(): string[] {
    const stored = this.syncMetaRepo.get(TOPICS_KEY);
    if (!stored) return this.engine.getDefaultTopicNames();
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        return parsed.length > 0 ? parsed : this.engine.getDefaultTopicNames();
      }
    } catch {
      // fall through
    }
    return this.engine.getDefaultTopicNames();
  }

  setTopicNames(names: string[]): string[] {
    const cleaned = names.map((n) => n.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      throw new Error("At least one topic name is required");
    }
    this.syncMetaRepo.set(TOPICS_KEY, JSON.stringify(cleaned));
    return cleaned;
  }

  getActiveTopicId(): string | null {
    return this.syncMetaRepo.get(ACTIVE_TOPIC_KEY);
  }

  setActiveTopicId(topicId: string | null): void {
    if (topicId) {
      this.syncMetaRepo.set(ACTIVE_TOPIC_KEY, topicId);
    } else {
      this.syncMetaRepo.set(ACTIVE_TOPIC_KEY, "");
    }
  }

  getConfig(): CurriculumConfig {
    const active = this.getActiveTopicId();
    return {
      topicNames: this.getTopicNames(),
      activeTopicId: active || null,
    };
  }

  /** First-pass counts per topic: `Revision needed` counts as covered (P3.1). */
  buildProblemCounts(): Map<string, TopicProblemCounts> {
    return buildTopicProblemCounts(this.problemRepo.findAll());
  }

  selectForTopics(topics: TopicState[]): CurriculumSelection | null {
    return this.engine.selectCurrentTopic(
      this.getConfig(),
      topics,
      this.buildProblemCounts(),
    );
  }

  getState(topics: TopicState[]): CurriculumState {
    return {
      topicNames: this.getTopicNames(),
      activeTopicId: this.getActiveTopicId(),
      selection: this.selectForTopics(topics),
    };
  }

  toProgress(selection: CurriculumSelection): CurriculumProgress {
    const config = this.getConfig();
    return {
      topicNames: config.topicNames,
      currentIndex: selection.index,
      activeTopicId: config.activeTopicId ?? null,
      items: selection.items,
    };
  }

  resetToDefault(): string[] {
    this.syncMetaRepo.set(TOPICS_KEY, "");
    return this.getTopicNames();
  }

  listItems(topics: TopicState[]): CurriculumItem[] {
    const counts = this.buildProblemCounts();
    return (
      this.engine.selectCurrentTopic(this.getConfig(), topics, counts)?.items ??
      this.engine
        .selectCurrentTopic({ topicNames: this.getTopicNames() }, topics, counts)
        ?.items ??
      []
    );
  }
}

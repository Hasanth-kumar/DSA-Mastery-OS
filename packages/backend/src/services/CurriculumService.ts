import {
  buildTopicProblemCounts,
  createCurriculumEngine,
  buildTopicGraphEdges,
  evaluatePinExpiry,
  PIN_MAX_AGE_DAYS,
  type PinExpiryReason,
  type PrimaryTopicSource,
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
const PIN_SET_AT_KEY = "curriculum_active_topic_set_at";
const PIN_LAST_EXPIRY_KEY = "curriculum_pin_last_expiry";
/** The topic the curriculum is working through (auto; not a manual pin). P3.4. */
const CURRENT_TOPIC_KEY = "curriculum_current_topic_id";

export interface PinExpiryRecord {
  topicId: string;
  reason: PinExpiryReason;
  at: number;
}

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

  setActiveTopicId(topicId: string | null, now = Date.now()): void {
    if (topicId) {
      this.syncMetaRepo.set(ACTIVE_TOPIC_KEY, topicId);
      this.syncMetaRepo.set(PIN_SET_AT_KEY, String(now));
    } else {
      this.syncMetaRepo.set(ACTIVE_TOPIC_KEY, "");
      this.syncMetaRepo.set(PIN_SET_AT_KEY, "");
    }
  }

  /** When the current pin was set, ms; null when unpinned or set before P3.3. */
  getPinnedAt(): number | null {
    const raw = this.syncMetaRepo.get(PIN_SET_AT_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  getLastPinExpiry(): PinExpiryRecord | null {
    const raw = this.syncMetaRepo.get(PIN_LAST_EXPIRY_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PinExpiryRecord;
    } catch {
      return null;
    }
  }

  /**
   * P3.3: clear the pin once the pinned topic's first pass is complete or
   * the pin is 7 days old. A pin set before P3.3 has no date; its clock
   * starts on the first check. Returns the expiry when one happened.
   */
  expirePinIfDue(now = Date.now()): PinExpiryRecord | null {
    const topicId = this.getActiveTopicId();
    if (!topicId) return null;

    let pinnedAt = this.getPinnedAt();
    if (pinnedAt == null) {
      pinnedAt = now;
      this.syncMetaRepo.set(PIN_SET_AT_KEY, String(now));
    }

    const decision = evaluatePinExpiry({
      pinnedAt,
      counts: this.buildProblemCounts().get(topicId),
      now,
    });
    if (!decision.expired) return null;

    const record: PinExpiryRecord = { topicId, reason: decision.reason, at: now };
    this.setActiveTopicId(null, now);
    this.syncMetaRepo.set(PIN_LAST_EXPIRY_KEY, JSON.stringify(record));
    console.info(`[curriculum] pin on ${topicId} expired: ${decision.reason}`);
    return record;
  }

  getConfig(): CurriculumConfig {
    this.expirePinIfDue();
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

  /**
   * Primary topic for today (P3.4): a valid pin, else the current topic while
   * its first pass has work left, else the highest-priority ready topic.
   * Remembers the auto-chosen topic so the next day continues it.
   */
  selectForTopics(
    topics: TopicState[],
  ): (CurriculumSelection & { source: PrimaryTopicSource }) | null {
    const selection = this.engine.selectPrimaryTopic(
      this.getConfig(),
      topics,
      this.buildProblemCounts(),
      {
        currentTopicId: this.syncMetaRepo.get(CURRENT_TOPIC_KEY) || null,
        edges: buildTopicGraphEdges(topics),
      },
    );
    if (
      selection &&
      (selection.source === "current" || selection.source === "ranked" || selection.source === "fallback") &&
      this.syncMetaRepo.get(CURRENT_TOPIC_KEY) !== selection.topic.id
    ) {
      this.syncMetaRepo.set(CURRENT_TOPIC_KEY, selection.topic.id);
    }
    return selection;
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
      pinExpiresAt: config.activeTopicId ? this.pinExpiresAt() : null,
      items: selection.items,
    };
  }

  private pinExpiresAt(): number | null {
    const pinnedAt = this.getPinnedAt();
    return pinnedAt == null ? null : pinnedAt + PIN_MAX_AGE_DAYS * 86_400_000;
  }

  resetToDefault(): string[] {
    this.syncMetaRepo.set(TOPICS_KEY, "");
    return this.getTopicNames();
  }

  listItems(topics: TopicState[]): CurriculumItem[] {
    return this.selectForTopics(topics)?.items ?? [];
  }
}

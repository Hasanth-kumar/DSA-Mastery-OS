import type { ProblemStatus } from "@dsa/database/notion-types";
import {
  createNotionClient,
  normalizeProblemStatus,
  syncNotionToSqlite,
  type NotionClient,
  type SyncResult,
} from "@dsa/integrations";
import type { AppConfig } from "@dsa/shared";
import type { ConflictRepository } from "../repositories/ConflictRepository.js";
import type { ProblemRepository } from "../repositories/ProblemRepository.js";
import type { SyncMetaRepository } from "../repositories/SyncMetaRepository.js";
import type { TopicRepository } from "../repositories/TopicRepository.js";
import type { MirrorCache } from "./MirrorCache.js";
import type { TopicDifficulty, TopicState, TopicStatus } from "@dsa/intelligence";
import {
  deriveTopicDifficultyFromConfidence,
  deriveTopicStatusAfterSession,
} from "@dsa/intelligence";
import type { ProblemRow } from "../repositories/ProblemRepository.js";

const LAST_SYNC_KEY = "last_sync_at";

/** Per-push cap so a slow/unreachable Notion can never hang a shutdown flush. */
const PUSH_TIMEOUT_MS = 4000;

/** Outcome of a push-only flush — counts for logging by callers/scripts. */
export interface FlushResult {
  pushedTopics: number;
  pushedProblems: number;
  failed: number;
}

export interface TopicSyncSnapshot {
  confidence: number;
  revisionCount: number;
  lastRevised: Date | null;
  nextRevisionAt: Date | null;
  sm2Interval?: number;
  sm2Repetition?: number;
  sm2Efactor?: number;
  isWeakArea: boolean;
  status: TopicStatus;
  difficulty: TopicDifficulty;
}

export interface SyncStatus extends SyncResult {
  syncedAt: string;
  direction: "pull" | "push" | "bidirectional";
  replayedTopics: number;
  replayedProblems: number;
  /** Schedule mirror columns added to the Notion Topics DB on this sync. */
  notionColumnsCreated?: string[];
}

export class NotionSyncService {
  private notion: NotionClient | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly topicRepo: TopicRepository,
    private readonly problemRepo: ProblemRepository,
    private readonly syncMeta: SyncMetaRepository,
    private readonly mirrorCache: MirrorCache,
    private readonly conflictRepo?: ConflictRepository,
  ) {}

  /** Sync health for /health (5.2). */
  getSyncHealth(): {
    lastSyncAt: string | null;
    pendingTopics: number;
    pendingProblems: number;
    unresolvedConflicts: number;
  } {
    return {
      lastSyncAt: this.syncMeta.get(LAST_SYNC_KEY),
      pendingTopics: this.syncMeta.pendingTopicsCount(),
      pendingProblems: this.syncMeta.pendingProblemsCount(),
      unresolvedConflicts: this.conflictRepo?.unresolvedCount() ?? 0,
    };
  }

  isConfigured(): boolean {
    if (this.config.notion.syncEnabled === false) return false;
    const { token, topicsDbId, problemsDbId, sessionsDbId } = this.config.notion;
    return Boolean(token && topicsDbId && problemsDbId && sessionsDbId);
  }

  getClient(): NotionClient {
    if (!this.notion) {
      const { token, topicsDbId, problemsDbId, sessionsDbId } = this.config.notion;
      this.notion = createNotionClient({
        token,
        topicsDbId,
        problemsDbId,
        sessionsDbId,
        writeEnabled: this.config.notion.writeEnabled,
      });
    }
    return this.notion;
  }

  /** Pull Notion → SQLite, then replay pending local mutations. */
  async pullFromNotion(): Promise<SyncStatus> {
    if (!this.isConfigured()) {
      throw new Error("Notion is not configured");
    }

    const pendingTopics = this.syncMeta.getPendingTopics();
    const pendingProblems = this.syncMeta.getPendingProblems();

    let notionColumnsCreated: string[] = [];
    try {
      notionColumnsCreated = await this.getClient().ensureTopicScheduleProperties();
    } catch {
      // Best-effort — sync still works; pushes skip fields when columns are missing.
    }

    const result = await syncNotionToSqlite(
      this.getClient(),
      this.config.sqlite.path,
    );
    this.mirrorCache.invalidate();

    // Conflict detection (5.2): merge pull may have updated mirrored fields from
    // Notion while preserving local schedule. Where a pending (locally-edited)
    // record's fields disagree with what Notion held, record both versions.
    this.detectConflicts(pendingTopics, pendingProblems);

    const { pushedTopics: replayedTopics, pushedProblems: replayedProblems } =
      await this.replayPending(pendingTopics, pendingProblems);

    this.mirrorCache.invalidate();

    const syncedAt = new Date().toISOString();
    this.syncMeta.set(LAST_SYNC_KEY, syncedAt);

    return {
      ...result,
      syncedAt,
      direction: "pull",
      replayedTopics,
      replayedProblems,
      notionColumnsCreated,
    };
  }

  /**
   * Drain the pending push queue to Notion **without pulling**. Safe to call on
   * shutdown / app-close: each push is time-bounded, and any failure stays
   * queued (exactly like the best-effort session push) to replay on next sync.
   * Pull deliberately stays on the startup path — a last-second pull here could
   * overwrite freshly-edited local rows with stale Notion values.
   */
  async flushPendingToNotion(): Promise<FlushResult> {
    if (!this.isConfigured()) {
      return { pushedTopics: 0, pushedProblems: 0, failed: 0 };
    }

    const pendingTopics = this.syncMeta.getPendingTopics();
    const pendingProblems = this.syncMeta.getPendingProblems();
    if (pendingTopics.length === 0 && pendingProblems.length === 0) {
      return { pushedTopics: 0, pushedProblems: 0, failed: 0 };
    }

    const result = await this.replayPending(pendingTopics, pendingProblems, {
      timeoutMs: PUSH_TIMEOUT_MS,
    });
    this.mirrorCache.invalidate();
    return result;
  }

  /**
   * Replay queued local mutations to Notion. Re-applies each pending snapshot
   * locally (a preceding pull may have overwritten it) then pushes; clears the
   * queue entry only on success so failures replay next time. Shared by the
   * pull replay loop and the push-only shutdown flush.
   */
  private async replayPending(
    pendingTopics: ReturnType<SyncMetaRepository["getPendingTopics"]>,
    pendingProblems: ReturnType<SyncMetaRepository["getPendingProblems"]>,
    options: { timeoutMs?: number } = {},
  ): Promise<FlushResult> {
    let pushedTopics = 0;
    let pushedProblems = 0;
    let failed = 0;

    await this.mirrorCache.batchAsync(async () => {
      for (const pending of pendingTopics) {
        this.topicRepo.applyPendingFields(pending.id, pending.fields);
        try {
          await withTimeout(this.pushTopicToNotion(pending.id), options.timeoutMs);
        } catch {
          failed += 1;
          continue;
        }
        this.syncMeta.clearTopic(pending.id);
        pushedTopics += 1;
      }

      for (const pending of pendingProblems) {
        this.problemRepo.update(pending.id, pending.fields);
        try {
          await withTimeout(this.pushProblemToNotion(pending.id), options.timeoutMs);
        } catch {
          failed += 1;
          continue;
        }
        this.syncMeta.clearProblem(pending.id);
        pushedProblems += 1;
      }
    });

    return { pushedTopics, pushedProblems, failed };
  }

  private detectConflicts(
    pendingTopics: ReturnType<SyncMetaRepository["getPendingTopics"]>,
    pendingProblems: ReturnType<SyncMetaRepository["getPendingProblems"]>,
  ): void {
    if (!this.conflictRepo) return;

    for (const pending of pendingTopics) {
      const remote = this.topicRepo.findById(pending.id);
      if (!remote) continue;
      const remoteFields = {
        confidence: remote.confidence,
        revisionCount: remote.revisionCount,
        lastRevised: remote.lastRevised?.getTime() ?? null,
        nextRevisionAt: remote.nextRevisionAt?.getTime() ?? null,
        sm2Interval: remote.sm2Interval,
        sm2Repetition: remote.sm2Repetition,
        sm2Efactor: remote.sm2Efactor,
        isWeakArea: remote.isWeakArea ? 1 : 0,
        status: remote.status,
        difficulty: remote.difficulty,
      };
      if (fieldsDiffer(pending.fields, remoteFields)) {
        this.conflictRepo.log({
          entityType: "topic",
          entityId: pending.id,
          entityName: remote.name,
          localValue: pending.fields as Record<string, unknown>,
          remoteValue: remoteFields,
        });
      }
    }

    for (const pending of pendingProblems) {
      const remote = this.problemRepo.findById(pending.id);
      if (!remote) continue;
      const remoteFields = {
        status: normalizeProblemStatus(remote.status),
        attempts: remote.attempts ?? 0,
        timeTaken: remote.timeTaken ?? null,
      };
      if (fieldsDiffer(pending.fields, remoteFields)) {
        this.conflictRepo.log({
          entityType: "problem",
          entityId: pending.id,
          entityName: remote.name,
          localValue: pending.fields as Record<string, unknown>,
          remoteValue: remoteFields,
        });
      }
    }
  }

  /** Resolve a logged conflict by re-applying the chosen side (5.2). */
  async resolveConflict(
    conflictId: string,
    winner: "local" | "remote",
  ): Promise<boolean> {
    if (!this.conflictRepo) return false;
    const conflict = this.conflictRepo.findById(conflictId);
    if (!conflict || conflict.resolvedAt) return false;

    // The replay path already applied + pushed the local version, so picking
    // "local" only marks the conflict resolved. Picking "remote" re-applies
    // Notion's version locally and pushes it back up.
    if (winner === "remote") {
      const remoteFields = JSON.parse(conflict.remoteValue) as Parameters<
        TopicRepository["applyPendingFields"]
      >[1] &
        Parameters<ProblemRepository["update"]>[1];
      if (conflict.entityType === "topic") {
        this.topicRepo.applyPendingFields(conflict.entityId, remoteFields);
        this.syncMeta.clearTopic(conflict.entityId);
        try {
          await this.pushTopicToNotion(conflict.entityId);
        } catch {
          // Notion may be briefly unreachable; the local row already matches remote.
        }
      } else {
        this.problemRepo.update(conflict.entityId, remoteFields);
        this.syncMeta.clearProblem(conflict.entityId);
        try {
          await this.pushProblemToNotion(conflict.entityId);
        } catch {
          // same as above
        }
      }
    }

    this.conflictRepo.resolve(conflictId, winner);
    return true;
  }

  /** Push a single topic's intelligence fields to Notion after local update. */
  async pushTopicToNotion(
    topicId: string,
    snapshot?: TopicSyncSnapshot | TopicState,
  ): Promise<void> {
    if (!this.isConfigured()) return;

    const topic = snapshot ?? this.topicRepo.findById(topicId);
    if (!topic) throw new Error(`Topic not found: ${topicId}`);

    const status = deriveTopicStatusAfterSession(
      topic.status,
      topic.confidence,
      topic.isWeakArea,
    );
    const difficulty = deriveTopicDifficultyFromConfidence(topic.confidence);

    if (
      snapshot == null &&
      (status !== topic.status || difficulty !== topic.difficulty)
    ) {
      this.topicRepo.update(topicId, { status, difficulty });
    }

    await this.getClient().updateTopic(topicId, {
      confidence: topic.confidence,
      revisionCount: topic.revisionCount,
      lastRevised: topic.lastRevised ?? undefined,
      isWeakArea: topic.isWeakArea,
      status,
      difficulty,
      nextRevisionAt: topic.nextRevisionAt,
      sm2Interval: topic.sm2Interval,
      sm2Efactor: topic.sm2Efactor,
    });
  }

  async pushProblemToNotion(
    problemId: string,
    snapshot?: ProblemRow,
  ): Promise<void> {
    if (!this.isConfigured()) return;

    const problem = snapshot ?? this.problemRepo.findById(problemId);
    if (!problem) throw new Error(`Problem not found: ${problemId}`);

    await this.getClient().updateProblem(problemId, {
      status: normalizeProblemStatus(problem.status) as ProblemStatus,
      attempts: problem.attempts ?? 0,
      timeTaken: problem.timeTaken ?? undefined,
    });
  }

  markTopicDirty(topicId: string, snapshot?: TopicSyncSnapshot | TopicState): void {
    const topic = snapshot ?? this.topicRepo.findById(topicId);
    if (!topic) return;

    this.syncMeta.markTopicPending(topicId, {
      confidence: topic.confidence,
      revisionCount: topic.revisionCount,
      lastRevised: topic.lastRevised?.getTime() ?? null,
      nextRevisionAt: topic.nextRevisionAt?.getTime() ?? null,
      sm2Interval: topic.sm2Interval,
      sm2Repetition: topic.sm2Repetition,
      sm2Efactor: topic.sm2Efactor,
      isWeakArea: topic.isWeakArea ? 1 : 0,
      status: topic.status,
      difficulty: topic.difficulty,
    });
  }

  markProblemDirty(problemId: string, snapshot?: ProblemRow): void {
    const problem = snapshot ?? this.problemRepo.findById(problemId);
    if (!problem) return;

    this.syncMeta.markProblemPending(problemId, {
      status: normalizeProblemStatus(problem.status),
      attempts: problem.attempts ?? 0,
      timeTaken: problem.timeTaken ?? null,
    });
  }

  /** Bidirectional sync: pull from Notion, replay pending local changes, push to Notion. */
  async sync(): Promise<SyncStatus> {
    const result = await this.pullFromNotion();
    return { ...result, direction: "bidirectional" };
  }
}

/**
 * Resolve with the promise, or reject once `timeoutMs` elapses. A `timeoutMs`
 * of `undefined` means "no cap" (used by the pull replay, which already runs
 * under the sync request's own lifetime).
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Notion push timed out")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fieldsDiffer(localInput: object, remoteInput: object): boolean {
  const local = localInput as Record<string, unknown>;
  const remote = remoteInput as Record<string, unknown>;
  return Object.keys(local).some((key) => {
    if (!(key in remote)) return false;
    return normalize(local[key]) !== normalize(remote[key]);
  });
}

function normalize(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

import { desc, gte, isNotNull, sql } from "drizzle-orm";
import { notes, problemAttempts, problems, sessions, topics } from "@dsa/database/schema";
import { buildTopicState, groupBy, type TopicState } from "@dsa/intelligence";
import type { SqliteDb } from "@dsa/integrations";
import type { ProblemRow } from "../repositories/ProblemRepository.js";
import type { SessionRow } from "../repositories/SessionRepository.js";
import { parseMistakeTags } from "../repositories/AttemptRepository.js";

const MISTAKE_WINDOW_DAYS = 90;

/** Max sessions loaded into mirror — analytics uses 500; extra headroom for streaks. */
export const MIRROR_SESSION_LIMIT = 1_000;

interface MirrorSnapshot {
  topicStates: TopicState[];
  topicById: Map<string, TopicState>;
  problemRows: ProblemRow[];
  sessionRows: SessionRow[];
  loadedAt: number;
}

export class MirrorCache {
  private snapshot: MirrorSnapshot | null = null;
  private batchDepth = 0;
  private batchDirty = false;

  constructor(
    private readonly db: SqliteDb,
    private readonly ttlMs = 10_000,
  ) {}

  invalidate(): void {
    if (this.batchDepth > 0) {
      this.batchDirty = true;
      return;
    }
    this.snapshot = null;
  }

  batch<T>(fn: () => T): T {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      this.flushBatch();
    }
  }

  async batchAsync<T>(fn: () => Promise<T>): Promise<T> {
    this.batchDepth++;
    try {
      return await fn();
    } finally {
      this.flushBatch();
    }
  }

  private flushBatch(): void {
    this.batchDepth--;
    if (this.batchDepth === 0 && this.batchDirty) {
      this.batchDirty = false;
      this.snapshot = null;
    }
  }

  private isFresh(): boolean {
    return (
      this.snapshot !== null &&
      Date.now() - this.snapshot.loadedAt < this.ttlMs
    );
  }

  private load(): MirrorSnapshot {
    if (this.isFresh()) return this.snapshot!;

    const topicRows = this.db.select().from(topics).all();
    const problemRows = this.db.select().from(problems).all();
    const sessionRows = this.db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.date))
      .limit(MIRROR_SESSION_LIMIT)
      .all();

    const problemsByTopic = groupBy(problemRows, (p) => p.topicId);
    const sessionsByTopic = groupBy(sessionRows, (s) => s.topicId);
    const mistakeTagsByTopic = this.loadMistakeTagCounts();
    const notedProblemIds = this.loadNotedProblemIds();
    const coachAssistByTopic = this.loadCoachAssist();
    const couldNotSolveTopics = this.loadLastAttemptCouldNotSolve();

    const topicStates = topicRows.map((topic) =>
      buildTopicState(
        topic,
        problemsByTopic.get(topic.id) ?? [],
        sessionsByTopic.get(topic.id) ?? [],
        {
          mistakeTagCounts: mistakeTagsByTopic.get(topic.id),
          notedProblemIds,
          coachAssist: coachAssistByTopic.get(topic.id),
          lastAttemptCouldNotSolve: couldNotSolveTopics.has(topic.id),
        },
      ),
    );

    const topicById = new Map(topicStates.map((t) => [t.id, t]));

    this.snapshot = {
      topicStates,
      topicById,
      problemRows,
      sessionRows,
      loadedAt: Date.now(),
    };
    return this.snapshot;
  }

  getTopicStates(): TopicState[] {
    return this.load().topicStates;
  }

  getTopicById(id: string): TopicState | null {
    return this.load().topicById.get(id) ?? null;
  }

  getProblemRows(): ProblemRow[] {
    return this.load().problemRows;
  }

  getSessionRows(limit = 500): SessionRow[] {
    const rows = this.load().sessionRows;
    return limit >= rows.length ? rows : rows.slice(0, limit);
  }

  private loadMistakeTagCounts(): Map<string, Record<string, number>> {
    const since = Date.now() - MISTAKE_WINDOW_DAYS * 86_400_000;
    const rows = this.db
      .select({
        topicId: problemAttempts.topicId,
        mistakeTag: problemAttempts.mistakeTag,
        count: sql<number>`count(*)`,
      })
      .from(problemAttempts)
      .where(gte(problemAttempts.solvedAt, since))
      .groupBy(problemAttempts.topicId, problemAttempts.mistakeTag)
      .all();

    const byTopic = new Map<string, Record<string, number>>();
    for (const row of rows) {
      if (!row.topicId || !row.mistakeTag) continue;
      const counts = byTopic.get(row.topicId) ?? {};
      counts[row.mistakeTag] = row.count;
      byTopic.set(row.topicId, counts);
    }
    return byTopic;
  }

  /** D4: coach-assisted vs total recent attempts per topic (weakness/difficulty input). */
  private loadCoachAssist(): Map<string, { assisted: number; solved: number }> {
    const since = Date.now() - MISTAKE_WINDOW_DAYS * 86_400_000;
    const rows = this.db
      .select({
        topicId: problemAttempts.topicId,
        assisted: sql<number>`coalesce(sum(case when ${problemAttempts.usedCoach} = 1 then 1 else 0 end), 0)`,
        solved: sql<number>`count(*)`,
      })
      .from(problemAttempts)
      .where(gte(problemAttempts.solvedAt, since))
      .groupBy(problemAttempts.topicId)
      .all();

    const byTopic = new Map<string, { assisted: number; solved: number }>();
    for (const row of rows) {
      if (!row.topicId) continue;
      byTopic.set(row.topicId, { assisted: row.assisted, solved: row.solved });
    }
    return byTopic;
  }

  /** Topics whose most recent attempt carries the could-not-solve tag (P3.5). */
  private loadLastAttemptCouldNotSolve(): Set<string> {
    const rows = this.db
      .select({
        topicId: problemAttempts.topicId,
        mistakeTag: problemAttempts.mistakeTag,
        solvedAt: problemAttempts.solvedAt,
      })
      .from(problemAttempts)
      .where(isNotNull(problemAttempts.topicId))
      .orderBy(desc(problemAttempts.solvedAt))
      .all();
    const seen = new Set<string>();
    const result = new Set<string>();
    for (const row of rows) {
      if (!row.topicId || seen.has(row.topicId)) continue;
      seen.add(row.topicId);
      if (parseMistakeTags(row.mistakeTag).includes("could-not-solve")) result.add(row.topicId);
    }
    return result;
  }

  private loadNotedProblemIds(): Set<string> {
    const rows = this.db
      .select({ problemId: notes.problemId })
      .from(notes)
      .where(isNotNull(notes.problemId))
      .all();
    return new Set(rows.map((r) => r.problemId!));
  }

  getCounts(): { topics: number; problems: number; sessions: number } {
    const s = this.load();
    return {
      topics: s.topicStates.length,
      problems: s.problemRows.length,
      sessions: s.sessionRows.length,
    };
  }
}

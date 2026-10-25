import { and, eq, sql } from "drizzle-orm";
import { problems } from "@dsa/database/schema";
import { isRemainingFirstPass, type TopicDifficulty } from "@dsa/intelligence";
import { normalizeProblemStatus, type SqliteDb } from "@dsa/integrations";
import type { MirrorCache } from "../services/MirrorCache.js";

export type ProblemRow = typeof problems.$inferSelect;

export interface ProblemUpdate {
  status?: string;
  attempts?: number;
  timeTaken?: number | null;
  notes?: string;
  githubUrl?: string;
}

const DIFFICULTY_RANK: Record<string, number> = { Easy: 0, Medium: 1, Hard: 2 };

function difficultyRank(difficulty: string | null): number {
  return DIFFICULTY_RANK[difficulty ?? ""] ?? 1;
}

export class ProblemRepository {
  constructor(
    private readonly db: SqliteDb,
    private readonly mirrorCache: MirrorCache,
  ) {}

  findAll(): ProblemRow[] {
    return this.mirrorCache.getProblemRows();
  }

  findFiltered(filters: { topicId?: string; status?: string }): ProblemRow[] {
    const conditions = [];
    if (filters.topicId) conditions.push(eq(problems.topicId, filters.topicId));
    if (filters.status) conditions.push(eq(problems.status, filters.status));
    if (conditions.length === 0) return this.findAll();
    return this.db
      .select()
      .from(problems)
      .where(and(...conditions))
      .all();
  }

  findByTopicId(topicId: string): ProblemRow[] {
    return this.db.select().from(problems).where(eq(problems.topicId, topicId)).all();
  }

  findById(id: string): ProblemRow | null {
    return this.db.select().from(problems).where(eq(problems.id, id)).get() ?? null;
  }

  /**
   * Problems not yet covered in the first pass (P3.1 `isRemainingFirstPass`),
   * Easy first. Uses the same rule as the curriculum counts, so a topic the
   * curriculum still serves always has a problem to suggest.
   */
  findRemainingFirstPassByTopicId(
    topicId: string,
    options: { difficulties?: TopicDifficulty[]; limit?: number } = {},
  ): ProblemRow[] {
    const { difficulties, limit = 3 } = options;
    return this.findByTopicId(topicId)
      .filter((p) => isRemainingFirstPass(p.status))
      .filter(
        (p) =>
          !difficulties ||
          difficulties.length === 0 ||
          difficulties.includes(p.difficulty as TopicDifficulty),
      )
      .sort((a, b) => difficultyRank(a.difficulty) - difficultyRank(b.difficulty))
      .slice(0, limit);
  }

  /** Solved problems for a topic, oldest update first (most decayed first). */
  findSolvedByTopicId(
    topicId: string,
    options: { limit?: number } = {},
  ): ProblemRow[] {
    return this.db
      .select()
      .from(problems)
      .where(and(eq(problems.topicId, topicId), eq(problems.status, "Solved")))
      .orderBy(problems.updatedAt)
      .limit(options.limit ?? 1)
      .all();
  }

  update(id: string, patch: ProblemUpdate): void {
    const now = Date.now();
    this.db
      .update(problems)
      .set({
        ...(patch.status != null
          ? { status: normalizeProblemStatus(patch.status) }
          : {}),
        ...(patch.attempts != null ? { attempts: patch.attempts } : {}),
        ...(patch.timeTaken !== undefined ? { timeTaken: patch.timeTaken } : {}),
        ...(patch.notes != null ? { notes: patch.notes } : {}),
        ...(patch.githubUrl != null ? { githubUrl: patch.githubUrl } : {}),
        updatedAt: now,
      })
      .where(eq(problems.id, id))
      .run();
    this.mirrorCache.invalidate();
  }

  recordSolve(id: string, timeTakenMinutes: number): ProblemRow | null {
    const problem = this.findById(id);
    if (!problem) return null;

    const attempts = (problem.attempts ?? 0) + 1;
    this.update(id, {
      status: "Solved",
      attempts,
      timeTaken: timeTakenMinutes,
    });
    return {
      ...problem,
      status: "Solved",
      attempts,
      timeTaken: timeTakenMinutes,
      updatedAt: Date.now(),
    };
  }

  /** Log time + attempt count without changing status — finalized after mistake capture. */
  recordAttempt(id: string, timeTakenMinutes: number): ProblemRow | null {
    const problem = this.findById(id);
    if (!problem) return null;

    const attempts = (problem.attempts ?? 0) + 1;
    this.update(id, {
      attempts,
      timeTaken: timeTakenMinutes,
    });
    return {
      ...problem,
      attempts,
      timeTaken: timeTakenMinutes,
      updatedAt: Date.now(),
    };
  }

  findByNameFuzzy(name: string): ProblemRow | null {
    const normalized = name.toLowerCase().trim();
    if (!normalized) return null;

    const exact =
      this.db
        .select()
        .from(problems)
        .where(sql`lower(${problems.name}) = ${normalized}`)
        .get() ?? null;
    if (exact) return exact;

    const contains = this.db
      .select()
      .from(problems)
      .where(sql`lower(${problems.name}) LIKE ${`%${normalized}%`}`)
      .all();
    if (contains.length === 1) return contains[0];
    if (contains.length > 1) {
      return contains.sort((a, b) => a.name.length - b.name.length)[0];
    }

    return null;
  }
}

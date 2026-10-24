import { and, eq, inArray } from "drizzle-orm";
import { problemReviews, problems } from "@dsa/database/schema";
import type { AdmissionReason } from "@dsa/intelligence";
import type { SqliteDb } from "@dsa/integrations";

export type ProblemReviewRow = typeof problemReviews.$inferSelect;

/** FSRS column patch — same field set the card review path writes. */
export interface ProblemReviewPatch {
  stability?: number | null;
  difficulty?: number | null;
  due?: number | null;
  lastReview?: number | null;
  reps?: number;
  lapses?: number;
  state?: number;
  elapsedDays?: number;
  scheduledDays?: number;
  learningSteps?: number;
  retired?: number;
  suspended?: number;
}

/**
 * Sole reader/writer of `problem_reviews` (design §9). Like cards, the pool is
 * local-only and not part of the MirrorCache snapshot (topics/problems/
 * sessions), so writes here never invalidate it.
 */
export class ProblemReviewRepository {
  constructor(private readonly db: SqliteDb) {}

  findById(problemId: string): ProblemReviewRow | null {
    return (
      this.db.select().from(problemReviews).where(eq(problemReviews.problemId, problemId)).get() ??
      null
    );
  }

  all(): ProblemReviewRow[] {
    return this.db.select().from(problemReviews).all();
  }

  /**
   * Admit a problem into the pool (§4). New rows start as FSRS New, due now.
   * Re-admitting an existing row (retired or suspended re-entry) clears the
   * flags but keeps its FSRS history; 'manual' also makes it due immediately.
   */
  admit(problemId: string, reason: AdmissionReason, now: number): ProblemReviewRow {
    const existing = this.findById(problemId);
    if (existing) {
      this.db
        .update(problemReviews)
        .set({
          retired: 0,
          suspended: 0,
          admissionReason: reason,
          due: reason === "manual" ? now : (existing.due ?? now),
          updatedAt: now,
        })
        .where(eq(problemReviews.problemId, problemId))
        .run();
    } else {
      this.db
        .insert(problemReviews)
        .values({
          problemId,
          admittedAt: now,
          admissionReason: reason,
          due: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    return this.findById(problemId)!;
  }

  /**
   * Remove a pool row only if it was never reviewed (P3.2 revert). Returns
   * whether a row was deleted; a row with review history is kept.
   */
  deleteIfUntouched(problemId: string): boolean {
    const row = this.findById(problemId);
    if (!row || row.reps > 0 || row.lastReview != null) return false;
    this.db.delete(problemReviews).where(eq(problemReviews.problemId, problemId)).run();
    return true;
  }

  update(problemId: string, patch: ProblemReviewPatch): ProblemReviewRow {
    this.db
      .update(problemReviews)
      .set({ ...patch, updatedAt: Date.now() })
      .where(eq(problemReviews.problemId, problemId))
      .run();
    return this.findById(problemId)!;
  }

  /** Persist plan-time deferrals (§6): push overflow due dates forward. */
  bulkSetDue(entries: { problemId: string; due: number }[]): void {
    if (entries.length === 0) return;
    const now = Date.now();
    for (const { problemId, due } of entries) {
      this.db
        .update(problemReviews)
        .set({ due, updatedAt: now })
        .where(eq(problemReviews.problemId, problemId))
        .run();
    }
  }

  /** Lift leech suspensions for a topic once its revision session completes (§5). */
  unsuspendByTopic(topicId: string): number {
    const ids = this.db
      .select({ id: problems.id })
      .from(problems)
      .where(eq(problems.topicId, topicId))
      .all()
      .map((r) => r.id);
    if (ids.length === 0) return 0;
    const result = this.db
      .update(problemReviews)
      .set({ suspended: 0, updatedAt: Date.now() })
      .where(and(inArray(problemReviews.problemId, ids), eq(problemReviews.suspended, 1)))
      .run();
    return Number(result.changes ?? 0);
  }

  /** Problem names/difficulty/links for pool rows, one query. */
  problemInfo(problemIds: string[]): Map<string, typeof problems.$inferSelect> {
    if (problemIds.length === 0) return new Map();
    const rows = this.db.select().from(problems).where(inArray(problems.id, problemIds)).all();
    return new Map(rows.map((r) => [r.id, r]));
  }
}

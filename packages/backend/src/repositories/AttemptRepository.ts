import { asc, desc, eq, gte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { problemAttempts } from "@dsa/database/schema";
import type { SqliteDb } from "@dsa/integrations";
import type { HelpLevel, HelpSource } from "@dsa/intelligence";
import type { MirrorCache } from "../services/MirrorCache.js";

export type AttemptRow = typeof problemAttempts.$inferSelect;

export interface CreateAttemptInput {
  problemId: string;
  topicId?: string | null;
  sessionId?: string | null;
  solvedAt?: Date;
  timeTaken?: number | null;
  mistakeTag?: string | null;
  /** Solved with coach help (D) — auto-captured from coach interactions. */
  usedCoach?: boolean;
  hintCount?: number;
  /** 'solve' (default) | 'resolve' — re-solves share the one attempt history. */
  kind?: "solve" | "resolve";
}

const MISTAKE_WINDOW_DAYS = 90;
/** P6.2: a takeaway is one line. */
export const TAKEAWAY_MAX_CHARS = 200;

/**
 * Decode the stored `mistake_tag` column into a list of tags. New rows hold a
 * JSON array; legacy rows hold a single bare tag string (or null).
 */
export function parseMistakeTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === "string");
  } catch {
    // Legacy single bare tag, e.g. "edge-case".
  }
  return [raw];
}

export class AttemptRepository {
  constructor(
    private readonly db: SqliteDb,
    private readonly mirrorCache: MirrorCache,
  ) {}

  create(input: CreateAttemptInput): AttemptRow {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .insert(problemAttempts)
      .values({
        id,
        problemId: input.problemId,
        topicId: input.topicId ?? null,
        sessionId: input.sessionId ?? null,
        solvedAt: (input.solvedAt ?? new Date()).getTime(),
        timeTaken: input.timeTaken ?? null,
        mistakeTag: input.mistakeTag ?? null,
        usedCoach: input.usedCoach ? 1 : 0,
        hintCount: input.hintCount ?? 0,
        kind: input.kind ?? "solve",
        createdAt: now,
      })
      .run();
    this.mirrorCache.invalidate();
    return this.findById(id)!;
  }

  /** P6.1: the learner's pattern guess on a hidden-pattern row (topic id or "unsure"). */
  setPatternGuess(id: string, guess: string): AttemptRow | null {
    if (!this.findById(id)) return null;
    this.db.update(problemAttempts).set({ patternGuess: guess }).where(eq(problemAttempts.id, id)).run();
    this.mirrorCache.invalidate();
    return this.findById(id);
  }

  /** P6.2: the most recent non-empty takeaway for a problem. */
  latestTakeaway(problemId: string): string | null {
    return (
      this.findByProblemId(problemId, 50).find((a) => a.takeaway && a.takeaway.trim())?.takeaway ??
      null
    );
  }

  findById(id: string): AttemptRow | null {
    return (
      this.db
        .select()
        .from(problemAttempts)
        .where(eq(problemAttempts.id, id))
        .get() ?? null
    );
  }

  /** The attempt a logged session produced (one problem per session). */
  findBySessionId(sessionId: string): AttemptRow | null {
    return (
      this.db
        .select()
        .from(problemAttempts)
        .where(eq(problemAttempts.sessionId, sessionId))
        .get() ?? null
    );
  }

  findByProblemId(problemId: string, limit = 10): AttemptRow[] {
    return this.db
      .select()
      .from(problemAttempts)
      .where(eq(problemAttempts.problemId, problemId))
      .orderBy(desc(problemAttempts.solvedAt))
      .limit(limit)
      .all();
  }

  /** Every attempt, oldest first (P7.5: pass tracking reads the whole history). */
  findAll(): AttemptRow[] {
    return this.db.select().from(problemAttempts).orderBy(asc(problemAttempts.solvedAt)).all();
  }

  findRecent(limit = 50): AttemptRow[] {
    return this.db
      .select()
      .from(problemAttempts)
      .orderBy(desc(problemAttempts.solvedAt))
      .limit(limit)
      .all();
  }

  /**
   * Save the captured mistake tags (stored as a JSON array). Empty tags clears
   * them (a "smooth solve"). Free-text reflection lives in the Obsidian note.
   */
  setMistake(
    id: string,
    input: {
      tags: string[];
      usedCoach?: boolean;
      /** P6.1: when set, `used_coach` is derived from it (help > none). */
      helpLevel?: HelpLevel;
      helpSource?: HelpSource | null;
      /** P6.2: one line; blank clears it. */
      takeaway?: string | null;
    },
  ): AttemptRow | null {
    const existing = this.findById(id);
    if (!existing) return null;
    const tags = input.tags.filter((t) => t.trim().length > 0);
    const usedCoach =
      input.helpLevel != null ? input.helpLevel !== "none" : input.usedCoach;
    const takeaway = input.takeaway?.trim().slice(0, TAKEAWAY_MAX_CHARS);
    this.db
      .update(problemAttempts)
      .set({
        mistakeTag: tags.length > 0 ? JSON.stringify(tags) : null,
        // Manual override from the capture step (D3) — absent leaves auto-capture.
        ...(usedCoach != null ? { usedCoach: usedCoach ? 1 : 0 } : {}),
        ...(input.helpLevel != null
          ? {
              helpLevel: input.helpLevel,
              helpSource: input.helpLevel === "none" ? null : (input.helpSource ?? null),
            }
          : {}),
        ...(input.takeaway !== undefined ? { takeaway: takeaway || null } : {}),
      })
      .where(eq(problemAttempts.id, id))
      .run();
    this.mirrorCache.invalidate();
    return this.findById(id);
  }

  /** Mistake-tag counts per topic over the recent window — weakness-engine input. */
  mistakeTagCountsByTopic(windowDays = MISTAKE_WINDOW_DAYS): Map<string, Record<string, number>> {
    const since = Date.now() - windowDays * 86_400_000;
    // Tags are JSON arrays now, so tally in JS rather than SQL GROUP BY.
    const rows = this.db
      .select({
        topicId: problemAttempts.topicId,
        mistakeTag: problemAttempts.mistakeTag,
      })
      .from(problemAttempts)
      .where(gte(problemAttempts.solvedAt, since))
      .all();

    const byTopic = new Map<string, Record<string, number>>();
    for (const row of rows) {
      if (!row.topicId || !row.mistakeTag) continue;
      const counts = byTopic.get(row.topicId) ?? {};
      for (const tag of parseMistakeTags(row.mistakeTag)) {
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
      byTopic.set(row.topicId, counts);
    }
    return byTopic;
  }

  /** Mistake-tag counts for one topic (e.g. coach context for an anchored problem). */
  mistakeTagCountsForTopic(topicId: string, windowDays = MISTAKE_WINDOW_DAYS): Record<string, number> {
    return this.mistakeTagCountsByTopic(windowDays).get(topicId) ?? {};
  }
}

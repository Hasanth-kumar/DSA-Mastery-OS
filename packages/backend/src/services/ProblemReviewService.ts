import type {
  AdmissionReason,
  CompletionOutcome,
  HelpLevel,
  IntelligenceOrchestrator,
  PoolBackfillItem,
  ProblemReviewConfig,
  ProblemReviewState,
  ResolveRating,
  TopicDifficulty,
} from "@dsa/intelligence";
import type { AppConfig } from "@dsa/shared";
import {
  parseMistakeTags,
  type AttemptRepository,
  type AttemptRow,
} from "../repositories/AttemptRepository.js";
import type { ProblemRepository } from "../repositories/ProblemRepository.js";
import type {
  ProblemReviewRepository,
  ProblemReviewRow,
} from "../repositories/ProblemReviewRepository.js";
import type { SyncMetaRepository } from "../repositories/SyncMetaRepository.js";
import type { EventBus } from "./EventBus.js";
import { applyFsrsRating, resolveRatingToGrade } from "./fsrs.js";

const MS_PER_DAY = 86_400_000;

/**
 * A failed re-solve is recorded with this mistake tag: honest signal (it IS a
 * mistake), keeps the problem admitted (§4), and lets the retirement streak be
 * reconstructed from attempt rows alone — no extra outcome column (§7).
 */
export const COULD_NOT_SOLVE_TAG = "could-not-solve";

/** Per-slot re-solve cost for plan duration estimates (§6). */
export function resolveSlotMinutes(difficulty: string | null): number {
  if (difficulty === "Hard") return 45;
  if (difficulty === "Easy") return 20;
  return 30;
}

export type ResolveOutcomeKind = "solved" | "assisted" | "failed";

export interface CompleteResolveInput {
  outcome: ResolveOutcomeKind;
  /** Minutes; null/absent = not timed. */
  timeTakenMin?: number | null;
  /** One-tap override of the inferred rating (§5). */
  ratingOverride?: ResolveRating;
}

export interface CompleteResolveResult {
  problemId: string;
  inferredRating: ResolveRating;
  rating: ResolveRating;
  due: number;
  intervalDays: number;
  /** Problem became a leech and was suspended pending topic re-study (§5). */
  leech: boolean;
  /** Clean streak + stability crossed the retirement bar (§4). */
  retired: boolean;
}

export type ResolveQueueStatus = "overdue" | "due" | "scheduled" | "retired" | "suspended";

export interface ResolveQueueItem {
  problemId: string;
  name: string;
  difficulty: TopicDifficulty | null;
  leetcodeLink: string | null;
  topicId: string | null;
  admissionReason: AdmissionReason;
  admittedAt: number;
  reason: string;
  status: ResolveQueueStatus;
  due: number | null;
  daysOverdue: number;
  stability: number | null;
  state: number;
  reps: number;
  lapses: number;
}

export interface ResolveDueSelection {
  slots: {
    problemId: string;
    name: string;
    difficulty: TopicDifficulty | null;
    leetcodeLink: string | null;
    topicId: string | null;
    daysOverdue: number;
    promoted: boolean;
    takeaway?: string;
    reason: string;
  }[];
  totalDue: number;
  deferredCount: number;
  capacity: number;
}

/**
 * Owns the problem re-solve pool (design §9): admission after attempts,
 * capacity-fitted due reads for the plan, and outcome recording (attempt row →
 * inferred rating → FSRS update → retire/leech checks). Pure decisions live in
 * ProblemReviewEngine; FSRS transitions in fsrs.ts; rows in the repository.
 */
export class ProblemReviewService {
  private readonly cfg: ProblemReviewConfig;

  constructor(
    private readonly config: AppConfig,
    private readonly intelligence: IntelligenceOrchestrator,
    private readonly reviewRepo: ProblemReviewRepository,
    private readonly problemRepo: ProblemRepository,
    private readonly attemptRepo: AttemptRepository,
    private readonly events: EventBus,
    /** Holds the pre-attempt FSRS state so MistakeCapture can redo a rating (P4.2). */
    private readonly syncMeta: SyncMetaRepository,
  ) {
    this.cfg = config.resolve.engine;
  }

  private get engine() {
    return this.intelligence.problemReview;
  }

  capacityFor(date: Date): number {
    const day = date.getDay();
    return day === 0 || day === 6
      ? this.config.resolve.slotsWeekend
      : this.config.resolve.slotsWeekday;
  }

  /**
   * Admission re-evaluation (§4) — call after every recorded attempt or
   * mistake-capture edit. Only admits problems outside the pool (or retired
   * re-entries); never unsuspends a leech — that waits for topic revision.
   */
  evaluateAdmission(problemId: string): AdmissionReason | null {
    const existing = this.reviewRepo.findById(problemId);
    if (existing && !existing.retired) return null;

    const problem = this.problemRepo.findById(problemId);
    if (!problem) return null;
    const attempts = this.attemptRepo.findByProblemId(problemId, 50);
    const reason = this.engine.shouldAdmit(
      { difficulty: toDifficulty(problem.difficulty) },
      attempts.map(toSignal),
      this.cfg,
    );
    if (!reason) return null;

    this.reviewRepo.admit(problemId, reason, Date.now());
    this.events.publish("resolve");
    return reason;
  }

  /** P3.2: `Revision needed` problems missing from the pool, with planned rows. */
  planRevisionNeededBackfill(now = Date.now()): PoolBackfillItem[] {
    const candidates = this.problemRepo
      .findAll()
      .filter((p) => p.status === "Revision needed")
      .map((p) => {
        const attempts = this.attemptRepo.findByProblemId(p.id, 50);
        const lastAttempt = attempts.reduce<number | null>(
          (max, a) => (a.solvedAt != null && (max == null || a.solvedAt > max) ? a.solvedAt : max),
          null,
        );
        return {
          problemId: p.id,
          status: p.status,
          difficulty: toDifficulty(p.difficulty),
          inPool: this.reviewRepo.findById(p.id) != null,
          attempts: attempts.map(toSignal),
          lastActivityAt: lastAttempt ?? p.updatedAt ?? null,
        };
      });
    return this.engine.planRevisionNeededBackfill(candidates, now, this.cfg);
  }

  /** Writes planned backfill rows. Skips any problem that joined the pool since planning. */
  applyRevisionNeededBackfill(items: readonly PoolBackfillItem[], now = Date.now()): string[] {
    const admitted: string[] = [];
    for (const item of items) {
      if (this.reviewRepo.findById(item.problemId)) continue;
      this.reviewRepo.admit(item.problemId, item.reason, now);
      this.reviewRepo.update(item.problemId, { due: item.due });
      admitted.push(item.problemId);
    }
    if (admitted.length > 0) this.events.publish("resolve");
    return admitted;
  }

  /** Reverts a backfill: removes the listed rows that were never reviewed. */
  revertRevisionNeededBackfill(problemIds: readonly string[]): { removed: string[]; kept: string[] } {
    const removed: string[] = [];
    const kept: string[] = [];
    for (const id of problemIds) {
      (this.reviewRepo.deleteIfUntouched(id) ? removed : kept).push(id);
    }
    if (removed.length > 0) this.events.publish("resolve");
    return { removed, kept };
  }

  /** Manual force-admit from the UI (§4) — clears retired/suspended, due now. */
  admit(problemId: string): ResolveQueueItem {
    const problem = this.problemRepo.findById(problemId);
    if (!problem) throw new Error(`Problem ${problemId} not found`);
    this.reviewRepo.admit(problemId, "manual", Date.now());
    this.events.publish("resolve");
    return this.queueItem(this.reviewRepo.findById(problemId)!);
  }

  /** Capacity-fitted slots for today's plan (§6). */
  dueSlots(
    now: number,
    options: {
      persistDeferrals?: boolean;
      /** P7.5: these due problems fill the slots first (a consolidation day). */
      preferProblemIds?: ReadonlySet<string>;
    } = {},
  ): ResolveDueSelection {
    const pool = this.reviewRepo.all().map(toState);
    const capacity = this.capacityFor(new Date(now));
    const { active, deferred } = this.engine.selectDueSlots(
      pool,
      capacity,
      now,
      this.cfg,
      options.preferProblemIds,
    );

    if (options.persistDeferrals && deferred.length > 0) {
      this.reviewRepo.bulkSetDue(
        deferred.map((d) => ({ problemId: d.review.problemId, due: d.due })),
      );
    }

    const info = this.reviewRepo.problemInfo(active.map((s) => s.review.problemId));
    return {
      slots: active.map((slot) => {
        const p = info.get(slot.review.problemId);
        return {
          problemId: slot.review.problemId,
          name: p?.name ?? slot.review.problemId,
          difficulty: toDifficulty(p?.difficulty ?? null),
          leetcodeLink: p?.leetcodeLink ?? null,
          topicId: p?.topicId ?? null,
          daysOverdue: slot.daysOverdue,
          promoted: slot.promoted,
          reason: this.describePool(slot.review.problemId, slot),
          // P6.2: the last takeaway, as a pre-solve reminder.
          ...this.takeawayFor(slot.review.problemId),
        };
      }),
      totalDue: active.length + deferred.length,
      deferredCount: deferred.length,
      capacity,
    };
  }

  /** The full pool for the Re-solve page (§10), most urgent first. */
  queue(): ResolveQueueItem[] {
    const rows = this.reviewRepo.all();
    const rank: Record<ResolveQueueStatus, number> = {
      overdue: 0,
      due: 1,
      scheduled: 2,
      suspended: 3,
      retired: 4,
    };
    return rows
      .map((row) => this.queueItem(row))
      .sort((a, b) => rank[a.status] - rank[b.status] || (a.due ?? 0) - (b.due ?? 0));
  }

  /**
   * Record a completed re-solve (§5): attempt row → inferred rating (with
   * optional override) → FSRS update → leech/retire checks.
   */
  complete(problemId: string, input: CompleteResolveInput): CompleteResolveResult {
    const review = this.reviewRepo.findById(problemId);
    if (!review) throw new Error(`Problem ${problemId} is not in the re-solve pool`);
    const problem = this.problemRepo.findById(problemId);
    const now = Date.now();

    const outcome = {
      solved: input.outcome !== "failed",
      usedCoach: input.outcome === "assisted",
      hintCount: 0,
      timeTakenMin: input.timeTakenMin ?? null,
      difficulty: toDifficulty(problem?.difficulty ?? null),
    };
    const inferredRating = this.engine.inferRating(outcome, this.cfg);
    const rating = input.ratingOverride ?? inferredRating;
    // Snapshot prior history before writing this attempt; the current rating
    // (override included) is prepended below.
    const priorRatings = this.pastResolveRatings(problemId);

    // A re-solve IS an attempt (§7) — one history per problem.
    this.attemptRepo.create({
      problemId,
      topicId: problem?.topicId ?? null,
      solvedAt: new Date(now),
      timeTaken: input.timeTakenMin ?? null,
      mistakeTag: outcome.solved ? null : JSON.stringify([COULD_NOT_SOLVE_TAG]),
      usedCoach: outcome.usedCoach,
      hintCount: 0,
      kind: "resolve",
    });

    const { patch, leech, retired } = this.applyRating(review, rating, now, priorRatings);

    // "attempt" drives the existing plan/analytics invalidation subscription.
    this.events.publish("attempt");
    this.events.publish("resolve");

    return {
      problemId,
      inferredRating,
      rating,
      due: patch.due,
      intervalDays: Math.max(0, Math.round((patch.due - now) / MS_PER_DAY)),
      leech,
      retired,
    };
  }

  private takeawayFor(problemId: string): { takeaway?: string } {
    if (!this.config.flags.takeawayField) return {};
    const takeaway = this.attemptRepo.latestTakeaway(problemId);
    return takeaway ? { takeaway } : {};
  }

  /** In the pool and not retired: a solve of it is a re-solve (P4.2). */
  isActiveInPool(problemId: string): boolean {
    const review = this.reviewRepo.findById(problemId);
    return review != null && !review.retired;
  }

  /**
   * P4.2 — the one completion path for a re-solve logged like a new problem
   * (Start → ✓ Done → MistakeCapture, no outcome picker). Called twice per
   * attempt: at ✓ Done (time and auto-captured help known) and again after
   * MistakeCapture (tags and the help tick known). The first call saves the
   * pre-attempt FSRS row; the second redoes the rating from it, so one attempt
   * is always exactly one FSRS review. If the row was reviewed again in
   * between, the second call leaves it alone. Returns null for a problem that
   * is not in the pool, or when nothing was changed.
   */
  completeAttempt(attempt: AttemptRow, now = Date.now()): CompleteResolveResult | null {
    const current = this.reviewRepo.findById(attempt.problemId);
    if (!current) return null;
    const key = `resolve_pre:${attempt.id}`;
    const saved = this.syncMeta.get(key);
    let base: ProblemReviewRow;
    let appliedAt: number;
    if (saved) {
      const pre = JSON.parse(saved) as { review: ProblemReviewRow; appliedAt: number };
      if (current.lastReview !== pre.appliedAt) return null;
      base = pre.review;
      appliedAt = pre.appliedAt;
    } else {
      if (current.retired) return null;
      base = current;
      appliedAt = now;
      this.syncMeta.set(key, JSON.stringify({ review: current, appliedAt }));
    }

    const problem = this.problemRepo.findById(attempt.problemId);
    const rating = this.engine.inferCompletionRating(completionOf(attempt, problem?.difficulty), this.cfg);
    const prior = this.pastResolveRatings(attempt.problemId, attempt.id);
    const { patch, leech, retired } = this.applyRating(base, rating, appliedAt, prior, {
      shortTermSteps: false,
    });

    this.events.publish("resolve");
    return {
      problemId: attempt.problemId,
      inferredRating: rating,
      rating,
      due: patch.due,
      intervalDays: Math.max(0, Math.round((patch.due - appliedAt) / MS_PER_DAY)),
      leech,
      retired,
    };
  }

  /** One FSRS review of a pooled problem: schedule, then leech and retire checks. */
  private applyRating(
    review: ProblemReviewRow,
    rating: ResolveRating,
    now: number,
    priorRatings: ResolveRating[],
    // The legacy outcome form keeps ts-fsrs's same-day steps until it is retired.
    fsrsOptions: { shortTermSteps?: boolean } = {},
  ) {
    const problemId = review.problemId;
    const patch = applyFsrsRating(review, resolveRatingToGrade(rating), now, fsrsOptions);
    const leech = rating === "again" && this.engine.isLeech({ lapses: patch.lapses }, this.cfg);
    const retired =
      !leech &&
      this.engine.shouldRetire({ stability: patch.stability }, [rating, ...priorRatings], this.cfg);

    this.reviewRepo.update(problemId, {
      stability: patch.stability,
      difficulty: patch.difficulty,
      due: patch.due,
      lastReview: patch.lastReview,
      reps: patch.reps,
      lapses: patch.lapses,
      state: patch.state,
      elapsedDays: patch.elapsedDays,
      scheduledDays: patch.scheduledDays,
      learningSteps: patch.learningSteps,
      suspended: leech ? 1 : review.suspended,
      retired: retired ? 1 : 0,
    });
    return { patch, leech, retired };
  }

  /** Skip = defer to tomorrow (§2) — never dropped, never stacked. */
  skip(problemId: string): ProblemReviewRow {
    const review = this.reviewRepo.findById(problemId);
    if (!review) throw new Error(`Problem ${problemId} is not in the re-solve pool`);
    const row = this.reviewRepo.update(problemId, { due: Date.now() + MS_PER_DAY });
    this.events.publish("resolve");
    return row;
  }

  /** Manual retire/suspend controls for the Re-solve page (§10). */
  setFlags(problemId: string, flags: { retired?: boolean; suspended?: boolean }): ResolveQueueItem {
    const review = this.reviewRepo.findById(problemId);
    if (!review) throw new Error(`Problem ${problemId} is not in the re-solve pool`);
    this.reviewRepo.update(problemId, {
      ...(flags.retired !== undefined ? { retired: flags.retired ? 1 : 0 } : {}),
      ...(flags.suspended !== undefined ? { suspended: flags.suspended ? 1 : 0 } : {}),
    });
    this.events.publish("resolve");
    return this.queueItem(this.reviewRepo.findById(problemId)!);
  }

  /** A completed revision session on a topic lifts its leech suspensions (§5). */
  onTopicRevised(topicId: string): void {
    if (this.reviewRepo.unsuspendByTopic(topicId) > 0) this.events.publish("resolve");
  }

  /** Count of problems due today — nav badge (§10). */
  dueCount(now = Date.now()): number {
    return this.reviewRepo
      .all()
      .filter((r) => !r.retired && !r.suspended && r.due != null && r.due <= now).length;
  }

  private queueItem(row: ProblemReviewRow): ResolveQueueItem {
    const p = this.reviewRepo.problemInfo([row.problemId]).get(row.problemId);
    const now = Date.now();
    const daysOverdue =
      row.due != null && row.due <= now ? Math.floor((now - row.due) / MS_PER_DAY) : 0;
    const status: ResolveQueueStatus = row.retired
      ? "retired"
      : row.suspended
        ? "suspended"
        : row.due != null && row.due <= now
          ? daysOverdue > 0
            ? "overdue"
            : "due"
          : "scheduled";
    return {
      problemId: row.problemId,
      name: p?.name ?? row.problemId,
      difficulty: toDifficulty(p?.difficulty ?? null),
      leetcodeLink: p?.leetcodeLink ?? null,
      topicId: p?.topicId ?? null,
      admissionReason: row.admissionReason as AdmissionReason,
      admittedAt: row.admittedAt,
      reason: this.describePool(row.problemId),
      status,
      due: row.due,
      daysOverdue,
      stability: row.stability,
      state: row.state,
      reps: row.reps,
      lapses: row.lapses,
    };
  }

  /**
   * The trust string (§10): why this problem is in the pool, from measured
   * signals — "2 mistakes, used coach" beats a bare enum.
   */
  private describePool(
    problemId: string,
    slot?: { promoted: boolean; daysOverdue: number },
  ): string {
    const attempts = this.attemptRepo.findByProblemId(problemId, 50);
    const parts: string[] = [];
    const mistakes = attempts.reduce(
      (n, a) => n + parseMistakeTags(a.mistakeTag).filter((t) => t !== COULD_NOT_SOLVE_TAG).length,
      0,
    );
    const failures = attempts.filter((a) =>
      parseMistakeTags(a.mistakeTag).includes(COULD_NOT_SOLVE_TAG),
    ).length;
    if (mistakes > 0) parts.push(`${mistakes} mistake${mistakes === 1 ? "" : "s"}`);
    if (failures > 0) parts.push(`${failures} failed re-solve${failures === 1 ? "" : "s"}`);
    if (attempts.some((a) => a.usedCoach || (a.hintCount ?? 0) > 0)) parts.push("used coach");
    const row = this.reviewRepo.findById(problemId);
    if (row?.admissionReason === "slow") parts.push("slow solve");
    if (row?.admissionReason === "hard") parts.push("Hard problem");
    if (row?.admissionReason === "manual") parts.push("manually queued");
    if (parts.length === 0) parts.push("in re-solve pool");
    if (slot?.promoted) parts.push(`overdue ${slot.daysOverdue} days — promoted`);
    return parts.join(", ");
  }

  /**
   * Retirement streak reconstruction (§4): prior re-solve attempt rows →
   * clean/not-clean. Clean = solved cold (no coach, no hints, no tags); the
   * exact good/easy split doesn't matter to shouldRetire.
   */
  private pastResolveRatings(problemId: string, excludeAttemptId?: string): ResolveRating[] {
    const unified = this.config.flags.unifiedCompletion;
    const difficulty = unified ? this.problemRepo.findById(problemId)?.difficulty : undefined;
    return this.attemptRepo
      .findByProblemId(problemId, 50)
      .filter((a) => a.kind === "resolve" && a.id !== excludeAttemptId)
      .map((a): ResolveRating => {
        // P4.2: attempts from the unified flow re-infer with the same rule.
        if (unified) return this.engine.inferCompletionRating(completionOf(a, difficulty), this.cfg);
        const tags = parseMistakeTags(a.mistakeTag);
        if (tags.includes(COULD_NOT_SOLVE_TAG)) return "again";
        if (a.usedCoach || (a.hintCount ?? 0) > 0 || tags.length > 0) return "hard";
        return "good";
      });
  }
}

function toDifficulty(value: string | null | undefined): TopicDifficulty | null {
  return value === "Easy" || value === "Medium" || value === "Hard" ? value : null;
}

/** The unified-flow signals of one attempt row (P4.2). */
function completionOf(a: AttemptRow, difficulty: string | null | undefined): CompletionOutcome {
  return {
    timeTakenMin: a.timeTaken,
    difficulty: toDifficulty(difficulty),
    mistakeTags: parseMistakeTags(a.mistakeTag),
    usedHelp: a.usedCoach === 1 || (a.hintCount ?? 0) > 0,
    helpLevel: asHelpLevel(a.helpLevel),
  };
}

/** A stored help level, or null for rows from before P6.1. */
export function asHelpLevel(value: string | null | undefined): HelpLevel | null {
  return value === "none" || value === "hint" || value === "approach" || value === "solution"
    ? value
    : null;
}

function toSignal(a: AttemptRow) {
  return {
    timeTaken: a.timeTaken,
    mistakeTags: parseMistakeTags(a.mistakeTag),
    usedCoach: a.usedCoach === 1,
    hintCount: a.hintCount ?? 0,
  };
}

function toState(row: ProblemReviewRow): ProblemReviewState {
  return {
    problemId: row.problemId,
    due: row.due,
    stability: row.stability,
    lapses: row.lapses,
    retired: row.retired === 1,
    suspended: row.suspended === 1,
  };
}

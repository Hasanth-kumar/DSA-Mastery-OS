import { APPROACH_MISTAKE_TAGS, type HelpLevel, type TopicDifficulty } from "../types.js";

/**
 * Problem re-solve engine (problem-spaced-repetition design §8) — the sixth
 * pure engine. Decides pool admission, infers FSRS ratings from re-solve
 * outcomes, and fits the due queue to daily capacity with compression
 * semantics. FSRS state *transitions* stay in the backend's ts-fsrs wrapper
 * (same split as cards); this engine is snapshot in → decision out, no I/O.
 */

const MS_PER_DAY = 86_400_000;

const DAY_MS = 86_400_000;

export interface ProblemReviewConfig {
  /** Admission slow-solve cutoffs in minutes (§4). Match the 0016 backfill. */
  slowThresholdMin: Record<TopicDifficulty, number>;
  /** Consecutive clean re-solves before retirement (§4). */
  retireCleanStreak: number;
  /** Minimum FSRS stability (days) before retirement (§4). */
  retireMinStabilityDays: number;
  /** Lapses before a problem is a leech and gets suspended (§5). */
  leechLapses: number;
  /** Days overdue past which a problem force-promotes onto Today (§6). */
  escalateDays: number;
}

export const DEFAULT_PROBLEM_REVIEW_CONFIG: ProblemReviewConfig = {
  slowThresholdMin: { Easy: 25, Medium: 45, Hard: 75 },
  retireCleanStreak: 3,
  retireMinStabilityDays: 90,
  leechLapses: 4,
  escalateDays: 14,
};

export type AdmissionReason = "mistake" | "coach" | "slow" | "hard" | "manual";
/** The admission reason, or null = stays out of the pool (§4). */
export type AdmissionDecision = AdmissionReason | null;

/** One attempt's struggle signals (mistake tags pre-parsed by the caller). */
export interface AttemptSignal {
  /** Minutes, null when not timed. */
  timeTaken: number | null;
  mistakeTags: string[];
  usedCoach: boolean;
  hintCount: number;
}

/** Maps 1:1 onto ts-fsrs Again/Hard/Good/Easy in the backend wrapper. */
/** A problem considered for the P3.2 pool backfill. */
export interface RevisionNeededCandidate {
  problemId: string;
  status: string | null;
  difficulty: TopicDifficulty | null;
  /** Already has a `problem_reviews` row (retired rows count). */
  inPool: boolean;
  attempts: AttemptSignal[];
  /** Latest attempt or problem update, ms; oldest is scheduled first. */
  lastActivityAt: number | null;
}

export interface PoolBackfillItem {
  problemId: string;
  reason: AdmissionReason;
  due: number;
}

export type ResolveRating = "again" | "hard" | "good" | "easy";

/** A completed re-solve, as reported by the completion flow (§5). */
export interface ResolveOutcome {
  solved: boolean;
  usedCoach: boolean;
  hintCount: number;
  /** Minutes, null when not timed. */
  timeTakenMin: number | null;
  difficulty: TopicDifficulty | null;
}

/**
 * P4.2: what the unified Start → ✓ Done → MistakeCapture flow knows about one
 * attempt. No outcome picker: the rating comes from these signals alone.
 */
export interface CompletionOutcome {
  /** Minutes from Start to ✓ Done; null when not timed. */
  timeTakenMin: number | null;
  difficulty: TopicDifficulty | null;
  /** Tags from MistakeCapture (empty = smooth, or not captured yet). */
  mistakeTags: readonly string[];
  /** Needed help: the "used coach / outside help" tick or in-app hints. */
  usedHelp: boolean;
  /**
   * P6.1: captured help level. When present it replaces `usedHelp`; a legacy
   * `usedHelp` counts as "approach" (the old rule rated any help Hard).
   */
  helpLevel?: HelpLevel | null;
}

/** Tags that mean the approach itself was missing, not a slip in the details (P6.3). */
const APPROACH_TAGS = new Set<string>(APPROACH_MISTAKE_TAGS);

/** Scheduling snapshot of one pooled problem (subset of `problem_reviews`). */
export interface ProblemReviewState {
  problemId: string;
  /** Epoch ms; null = never scheduled. */
  due: number | null;
  /** FSRS stability in days. */
  stability: number | null;
  lapses: number;
  retired?: boolean;
  suspended?: boolean;
}

export interface ResolveSlot {
  review: ProblemReviewState;
  daysOverdue: number;
  /** Escalation valve (§6): admitted past capacity because critically overdue. */
  promoted: boolean;
}

export interface SlotSelection {
  active: ResolveSlot[];
  /** Overflow rescheduled forward, never stacked (§6). New due in epoch ms. */
  deferred: { review: ProblemReviewState; due: number }[];
}

export class ProblemReviewEngine {
  /**
   * Pool admission (§4). Recomputed after every attempt; reason priority is
   * mistake > coach > slow > hard. 'manual' only ever comes from the UI
   * force-admit, never from here. A clean, fast, unaided Easy/Medium history
   * returns null.
   */
  shouldAdmit(
    problem: { difficulty: TopicDifficulty | null },
    attempts: AttemptSignal[],
    config: ProblemReviewConfig = DEFAULT_PROBLEM_REVIEW_CONFIG,
  ): AdmissionDecision {
    if (attempts.length === 0) return null;
    if (attempts.some((a) => a.mistakeTags.length > 0)) return "mistake";
    if (attempts.some((a) => a.usedCoach || a.hintCount > 0)) return "coach";
    const cutoff = config.slowThresholdMin[problem.difficulty ?? "Medium"];
    if (attempts.some((a) => a.timeTaken != null && a.timeTaken > cutoff)) return "slow";
    if (problem.difficulty === "Hard") return "hard";
    return null;
  }

  /**
   * P3.2: every `Revision needed` problem belongs in the re-solve pool. Plans
   * rows for those missing from it. The reason comes from the attempt history
   * like normal admission; with no recorded attempts (status set in Notion)
   * it is "mistake", which is what `Revision needed` records. Due dates are
   * staggered one per day, oldest activity first, wrapping after
   * `spreadDays`, so the backfill never lands as a wall of due work.
   */
  planRevisionNeededBackfill(
    candidates: readonly RevisionNeededCandidate[],
    now: number,
    config: ProblemReviewConfig = DEFAULT_PROBLEM_REVIEW_CONFIG,
    spreadDays = 21,
  ): PoolBackfillItem[] {
    return candidates
      .filter((c) => c.status === "Revision needed" && !c.inPool)
      .slice()
      .sort(
        (a, b) =>
          (a.lastActivityAt ?? 0) - (b.lastActivityAt ?? 0) ||
          a.problemId.localeCompare(b.problemId),
      )
      .map((c, i) => ({
        problemId: c.problemId,
        reason: this.shouldAdmit({ difficulty: c.difficulty }, c.attempts, config) ?? "mistake",
        due: now + (i % Math.max(1, spreadDays)) * DAY_MS,
      }));
  }

  /** Rating inference from measured signals (§5 table); UI may override. */
  inferRating(
    outcome: ResolveOutcome,
    config: ProblemReviewConfig = DEFAULT_PROBLEM_REVIEW_CONFIG,
  ): ResolveRating {
    if (!outcome.solved) return "again";
    if (outcome.usedCoach || outcome.hintCount > 0) return "hard";
    const cutoff = config.slowThresholdMin[outcome.difficulty ?? "Medium"];
    // Untimed cold solve → "good": don't stretch the interval without evidence.
    if (outcome.timeTakenMin == null || outcome.timeTakenMin > cutoff) return "good";
    return "easy";
  }

  /**
   * P4.2: rating for the unified completion flow (re-solves logged like new
   * problems). Time is judged against the per-difficulty target
   * (`slowThresholdMin`, 25 / 45 / 75 min by default):
   *
   * | Signals | Rating |
   * |---|---|
   * | `could-not-solve`, full solution, or approach help **and** a missing approach | again |
   * | approach help, a missing approach, or slower than the target | hard |
   * | a hint, only detail slips (edge case, off-by-one, loop bounds), or untimed | good |
   * | clean, at most the target | good |
   * | clean, at most half the target | easy |
   *
   * A hint still counts as clean (P6.1), so it caps the rating at good.
   */
  inferCompletionRating(
    outcome: CompletionOutcome,
    config: ProblemReviewConfig = DEFAULT_PROBLEM_REVIEW_CONFIG,
  ): ResolveRating {
    const tags = outcome.mistakeTags;
    const missingApproach = tags.some((t) => APPROACH_TAGS.has(t));
    const level: HelpLevel = outcome.helpLevel ?? (outcome.usedHelp ? "approach" : "none");
    const substantialHelp = level === "approach" || level === "solution";
    if (tags.includes("could-not-solve") || level === "solution") return "again";
    if (substantialHelp && missingApproach) return "again";
    const target = config.slowThresholdMin[outcome.difficulty ?? "Medium"];
    const slow = outcome.timeTakenMin != null && outcome.timeTakenMin > target;
    if (substantialHelp || missingApproach || slow) return "hard";
    if (level === "hint" || tags.length > 0 || outcome.timeTakenMin == null) return "good";
    return outcome.timeTakenMin <= target / 2 ? "easy" : "good";
  }

  /**
   * Fit the due pool to today's capacity (§6): the most overdue problems fill
   * the slots; the remainder is rescheduled forward at capacity/day starting
   * tomorrow (compressQueue semantics — never a guilt-list). The escalation
   * valve promotes at most ONE extra problem past capacity (even capacity 0)
   * when it is overdue beyond `escalateDays`.
   *
   * `prefer` (P7.5): due problems in this set fill the slots first, most
   * overdue first, so a consolidation day leads with its topic's re-solves.
   */
  selectDueSlots(
    pool: ProblemReviewState[],
    capacity: number,
    now: number,
    config: ProblemReviewConfig = DEFAULT_PROBLEM_REVIEW_CONFIG,
    prefer?: ReadonlySet<string>,
  ): SlotSelection {
    const preferred = (p: ProblemReviewState) => (prefer?.has(p.problemId) ? 0 : 1);
    const due = pool
      .filter((p) => !p.retired && !p.suspended && p.due != null && p.due <= now)
      .sort((a, b) => preferred(a) - preferred(b) || a.due! - b.due!);

    const daysOverdue = (p: ProblemReviewState) => Math.floor((now - p.due!) / MS_PER_DAY);
    const active: ResolveSlot[] = due
      .slice(0, Math.max(0, capacity))
      .map((review) => ({ review, daysOverdue: daysOverdue(review), promoted: false }));

    const next = due[active.length];
    if (next && daysOverdue(next) > config.escalateDays) {
      active.push({ review: next, daysOverdue: daysOverdue(next), promoted: true });
    }

    const rate = Math.max(1, capacity);
    const deferred = due.slice(active.length).map((review, i) => ({
      review,
      due: now + (Math.floor(i / rate) + 1) * MS_PER_DAY,
    }));

    return { active, deferred };
  }

  /**
   * Retirement (§4): N consecutive clean re-solves with stability past the
   * threshold. `recentRatings` is most-recent-first (re-infer from attempt
   * rows via inferRating).
   */
  shouldRetire(
    state: { stability: number | null },
    recentRatings: ResolveRating[],
    config: ProblemReviewConfig = DEFAULT_PROBLEM_REVIEW_CONFIG,
  ): boolean {
    if ((state.stability ?? 0) < config.retireMinStabilityDays) return false;
    if (recentRatings.length < config.retireCleanStreak) return false;
    return recentRatings
      .slice(0, config.retireCleanStreak)
      .every((r) => r === "good" || r === "easy");
  }

  /** Problem leech (§5): suspend and flag the topic instead of drilling harder. */
  isLeech(
    state: { lapses: number },
    config: ProblemReviewConfig = DEFAULT_PROBLEM_REVIEW_CONFIG,
  ): boolean {
    return state.lapses >= config.leechLapses;
  }
}

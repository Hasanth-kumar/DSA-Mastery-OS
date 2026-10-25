/**
 * Per-card FSRS engine wrapper (design §7, §13).
 *
 * This is the single place the app touches `ts-fsrs` (MIT). FSRS models
 * **stability, difficulty, and retrievability as independent axes**, so a card
 * the learner recalls easily but that is intrinsically hard is no longer
 * conflated the way SM-2's single `ease` number forces. There is NO topic-level
 * SM-2 here — scheduling is per card.
 *
 * The functions are pure (state in → patch out) and DB-free, so they unit-test
 * in any Node ≥ 18 without a native SQLite binding. Fuzz is disabled so the
 * schedule is deterministic and testable.
 */
import {
  fsrs,
  generatorParameters,
  Rating,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";
import type { ResolveRating } from "@dsa/intelligence";
import type { CardRow, ReviewPatch } from "./cardTypes.js";

const MS_PER_DAY = 86_400_000;

/**
 * A card lapsed this many times is flagged a leech (§7). Full leech *handling*
 * (LLM reformulation / resurfacing prerequisite concepts) is stage 8; here we
 * only raise the flag and log the event so the data exists for it.
 */
export const LEECH_LAPSE_THRESHOLD = 8;

// Deterministic scheduler (no fuzz) shared across reviews.
const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

// P4.2: a re-solve is a 20–45 min cold solve, so its next review is days away.
// ts-fsrs's default short-term learning steps (1 min / 10 min) would make a
// fresh problem due again the same day and put it back on Today.
const dayScheduler = fsrs(generatorParameters({ enable_fuzz: false, enable_short_term: false }));

/**
 * Map a 0–5 self-grade (the warm-up/review scale) to an FSRS rating.
 * `<3` = forgot → Again, `3` = Hard, `4` = Good, `5` = Easy. The frontend
 * grade buttons (1/3/4/5) line up with this directly.
 */
export function selfGradeToRating(quality: number): Grade {
  const q = Math.round(quality);
  if (q <= 2) return Rating.Again;
  if (q === 3) return Rating.Hard;
  if (q === 4) return Rating.Good;
  return Rating.Easy;
}

/**
 * The FSRS column set shared by `cards` and `problem_reviews` rows — the
 * scheduling functions below only touch these fields.
 */
export type FsrsFields = Pick<
  CardRow,
  | "stability"
  | "difficulty"
  | "due"
  | "lastReview"
  | "reps"
  | "lapses"
  | "state"
  | "elapsedDays"
  | "scheduledDays"
  | "learningSteps"
>;

/** A stored FSRS row (card or problem review) → the ts-fsrs `Card` shape (epoch ms → Date). */
export function rowToFsrsCard(row: FsrsFields, nowMs: number): FsrsCard {
  return {
    due: row.due != null ? new Date(row.due) : new Date(nowMs),
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    elapsed_days: row.elapsedDays ?? 0,
    scheduled_days: row.scheduledDays ?? 0,
    reps: row.reps ?? 0,
    lapses: row.lapses ?? 0,
    learning_steps: row.learningSteps ?? 0,
    state: (row.state ?? 0) as FsrsCard["state"],
    last_review: row.lastReview != null ? new Date(row.lastReview) : undefined,
  };
}

/** A scheduled ts-fsrs `Card` → the DB column patch (Date → epoch ms). */
export function fsrsCardToPatch(card: FsrsCard): ReviewPatch {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    due: card.due.getTime(),
    lastReview: card.last_review ? card.last_review.getTime() : null,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
  };
}

/** ProblemReviewEngine rating names → ts-fsrs grades (1:1 by design). */
const RESOLVE_RATING_GRADE: Record<ResolveRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export function resolveRatingToGrade(rating: ResolveRating): Grade {
  return RESOLVE_RATING_GRADE[rating];
}

/**
 * Apply one explicit FSRS rating to any FSRS-bearing row (problem re-solve
 * path — cards go through {@link reviewRow}'s self-grade scale instead).
 */
export function applyFsrsRating(
  row: FsrsFields,
  rating: Grade,
  nowMs: number,
  options: { shortTermSteps?: boolean } = {},
): ReviewPatch {
  const s = options.shortTermSteps === false ? dayScheduler : scheduler;
  const { card } = s.next(rowToFsrsCard(row, nowMs), new Date(nowMs), rating);
  return fsrsCardToPatch(card);
}

export interface ReviewOutcome {
  patch: ReviewPatch;
  rating: Grade;
  /** Whole days until the card is next due (0 for sub-day learning steps). */
  intervalDays: number;
  /** True only on the review that first crosses {@link LEECH_LAPSE_THRESHOLD}. */
  leechTriggered: boolean;
}

/**
 * Apply one self-graded review to a card and return the next FSRS state as a
 * column patch — the core of per-card spaced repetition. No I/O.
 */
export function reviewRow(row: CardRow, quality: number, nowMs: number): ReviewOutcome {
  const rating = selfGradeToRating(quality);
  const { card } = scheduler.next(rowToFsrsCard(row, nowMs), new Date(nowMs), rating);
  const patch = fsrsCardToPatch(card);
  const intervalDays = Math.max(0, Math.round((patch.due - nowMs) / MS_PER_DAY));
  const leechTriggered = row.leech !== 1 && patch.lapses >= LEECH_LAPSE_THRESHOLD;
  if (leechTriggered) patch.leech = true;
  return { patch, rating, intervalDays, leechTriggered };
}

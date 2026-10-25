import type { HelpLevel, TopicDifficulty } from "./types.js";

/**
 * Outcome-based session scoring (0–100).
 *
 * The old score was derived from session *length* alone, so a 1-minute session
 * scored 100 and every topic looked mastered. This scores what actually
 * happened: did you need help, did you make mistakes, and how long did it take
 * relative to an interview-style target for that difficulty.
 */

/** Interview-style time targets in minutes (matches ProblemReviewEngine's slow cut-offs). */
export const TARGET_MINUTES: Record<TopicDifficulty, number> = {
  Easy: 25,
  Medium: 45,
  Hard: 75,
};

export interface SessionOutcomeInput {
  /** Minutes spent on the problem. */
  durationMin: number;
  difficulty: TopicDifficulty | null;
  /** Needed outside help: in-app coach, ChatGPT/Gemini, an editorial... */
  usedHelp: boolean;
  /** In-app hint count (adds to the help penalty when heavy). */
  hintCount?: number;
  /**
   * P6.1: captured help level. When present it sets the base instead of
   * `usedHelp`: approach and full solution weigh more than a hint.
   */
  helpLevel?: HelpLevel | null;
  /**
   * Mistake tags once captured. `undefined` = not captured yet, which gives a
   * provisional score that is re-computed when the tags arrive.
   */
  mistakeTags?: string[];
}

const COULD_NOT_SOLVE = "could-not-solve";
const COLD_BASE = 80;
const HELP_BASE = 50;
const HELP_LEVEL_BASE: Record<HelpLevel, number> = {
  none: COLD_BASE,
  hint: 70,
  approach: HELP_BASE,
  solution: 30,
};
const HEAVY_HINTS = 3;
const MAX_TAG_PENALTY = 24;
const PER_TAG_PENALTY = 8;
const COULD_NOT_SOLVE_CAP = 25;

/** Score one problem session: cold + clean + fast is ~90, needing help tops out near 60. */
export function deriveSessionOutcomeScore(input: SessionOutcomeInput): number {
  const hints = input.hintCount ?? 0;
  const helped = input.usedHelp || hints > 0;
  const tags = [...new Set((input.mistakeTags ?? []).filter((t) => t.trim().length > 0))];

  let score = input.helpLevel
    ? HELP_LEVEL_BASE[input.helpLevel]
    : helped
      ? HELP_BASE
      : COLD_BASE;
  if (hints >= HEAVY_HINTS) score -= 10;

  const realTags = tags.filter((t) => t !== COULD_NOT_SOLVE);
  score -= Math.min(MAX_TAG_PENALTY, PER_TAG_PENALTY * realTags.length);

  const target = TARGET_MINUTES[input.difficulty ?? "Medium"];
  const ratio = Math.max(1, input.durationMin) / target;
  if (ratio <= 0.6) score += 10;
  else if (ratio <= 1) score += 5;
  else if (ratio > 1.5) score -= 10;

  if (tags.includes(COULD_NOT_SOLVE)) score = Math.min(score, COULD_NOT_SOLVE_CAP);

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * How much a session moves a topic's confidence. Replaces the old
 * `(productivity - 50) / 10`, which added +4–5 to every session regardless of
 * how it went.
 */
export function confidenceDeltaForScore(score: number): number {
  if (score >= 85) return 4;
  if (score >= 70) return 2;
  if (score >= 55) return 1;
  if (score >= 40) return 0;
  if (score >= 25) return -1;
  return -2;
}

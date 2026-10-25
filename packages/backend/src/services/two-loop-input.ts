/**
 * P7.5: map mirror rows into the two-loop selector's input. One mapping for
 * PlanService and `pnpm dev:simulate-plan`, so both see the same facts.
 */
import type {
  HelpLevel,
  PassAttempt,
  PassReview,
  PickRole,
  SelectorTopic,
  TwoLoopInput,
} from "@dsa/intelligence";
import type { AttemptRow } from "../repositories/AttemptRepository.js";
import { parseMistakeTags } from "../repositories/AttemptRepository.js";
import type { ProblemRow } from "../repositories/ProblemRepository.js";
import type { ProblemReviewRow } from "../repositories/ProblemReviewRepository.js";
import { dayKeyInTimeZone } from "../lib/dayKey.js";
import { asDifficulty } from "./ProblemSuggestionService.js";

const HELP_LEVELS = new Set<string>(["none", "hint", "approach", "solution"]);

export interface TwoLoopRows {
  topics: readonly { id: string; name: string }[];
  problems: readonly ProblemRow[];
  attempts: readonly AttemptRow[];
  reviews: readonly ProblemReviewRow[];
  pinnedTopicId: string | null;
  now: number;
  timeZone: string;
}

export function toSelectorTopics(
  topics: TwoLoopRows["topics"],
  problems: readonly ProblemRow[],
): SelectorTopic[] {
  const byTopic = new Map<string, ProblemRow[]>();
  for (const p of problems) {
    if (!p.topicId) continue;
    byTopic.set(p.topicId, [...(byTopic.get(p.topicId) ?? []), p]);
  }
  return topics.map((t) => ({
    id: t.id,
    name: t.name,
    problems: (byTopic.get(t.id) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, difficulty: asDifficulty(p.difficulty), status: p.status })),
  }));
}

export function toPassAttempt(a: AttemptRow, timeZone: string): PassAttempt {
  return {
    problemId: a.problemId,
    solvedAt: a.solvedAt,
    dayKey: dayKeyInTimeZone(a.solvedAt, timeZone),
    mistakeTags: parseMistakeTags(a.mistakeTag),
    helpLevel: a.helpLevel && HELP_LEVELS.has(a.helpLevel) ? (a.helpLevel as HelpLevel) : null,
    // Same legacy rule as the re-solve rating (ProblemReviewService).
    usedHelp: a.usedCoach === 1 || (a.hintCount ?? 0) > 0,
    patternGuess: a.patternGuess ?? null,
  };
}

export function toPassReview(r: ProblemReviewRow): PassReview {
  return { problemId: r.problemId, due: r.due, retired: r.retired === 1, suspended: r.suspended === 1 };
}

export function buildTwoLoopInput(rows: TwoLoopRows): TwoLoopInput {
  return {
    topics: toSelectorTopics(rows.topics, rows.problems),
    attempts: rows.attempts.map((a) => toPassAttempt(a, rows.timeZone)),
    reviews: rows.reviews.map(toPassReview),
    now: rows.now,
    pinnedTopicId: rows.pinnedTopicId,
  };
}

/** Row reason on Today. Hidden rows never name their pattern (§6.4). */
export const PICK_REASONS: Record<PickRole, string> = {
  pin: "Pinned pattern",
  block: "New pattern · short block",
  basic: "Basics · first pass",
  pool: "First pass",
  transfer: "Unseen problem · cold check",
  consolidate: "Consolidation · cold solve",
};

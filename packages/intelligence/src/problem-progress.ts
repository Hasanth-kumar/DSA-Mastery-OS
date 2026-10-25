/**
 * One definition of first-pass progress for a problem (overhaul P3.1).
 *
 * - Covered: the learner has worked the problem once. `Solved` and
 *   `Revision needed` both count. Keeping a `Revision needed` problem in
 *   memory is the job of problem re-solve (FSRS `problem_reviews`), not the
 *   curriculum, so it must not hold a topic open.
 * - Remaining: everything else. Statuses are normalized on write
 *   (`normalizeProblemStatus`), so in practice this is `Not started`, plus a
 *   null status (the column default).
 *
 * `CurriculumService` (topic counts) and `ProblemRepository` (suggestions)
 * both use these, so "topic has work left" and "there is a problem to
 * suggest" can no longer disagree.
 */
import type { TopicProblemCounts } from "./curriculum-engine/CurriculumEngine.js";

export function isFirstPassCovered(status: string | null | undefined): boolean {
  return status === "Solved" || status === "Revision needed";
}

export function isRemainingFirstPass(status: string | null | undefined): boolean {
  return !isFirstPassCovered(status);
}

export interface ProblemProgressInput {
  topicId: string | null;
  status: string | null;
}

/**
 * Per-topic totals for the curriculum. `unsolved` keeps its field name for
 * the existing API, and means problems remaining in the first pass.
 */
export function buildTopicProblemCounts(
  problems: readonly ProblemProgressInput[],
): Map<string, TopicProblemCounts> {
  const counts = new Map<string, TopicProblemCounts>();
  for (const problem of problems) {
    if (!problem.topicId) continue;
    const entry = counts.get(problem.topicId) ?? { total: 0, unsolved: 0 };
    entry.total += 1;
    if (isRemainingFirstPass(problem.status)) entry.unsolved += 1;
    counts.set(problem.topicId, entry);
  }
  return counts;
}

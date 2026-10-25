import type {
  DayKind,
  FocusWeek,
  ProblemSuggestion,
  ResolvePlanSlot,
  TodayDecision,
  TodayQueue,
  TodayQueueBlock,
  TopicStage,
} from "../types.js";
import {
  computeGap,
  computeWeek,
  DEFAULT_WEEKLY_TARGET,
  difficultyRank,
  minutesFor,
  REENTRY_GAP_DAYS,
} from "./FocusPlanner.js";

/**
 * P5.1 — Today's single ordered list of problems. Pure: the backend supplies
 * the facts, this decides the rows.
 *
 *  1. At most one re-solve: the most overdue, preferring a pattern other than
 *     today's block (so it is a real cold check).
 *  2. One or two progression problems: the first always, the second only if
 *     it still fits the session budget.
 *  3. After a gap of 3+ days: one short Easy problem only, no backlog.
 *
 * Re-solves never reveal their pattern before ✓ Done (§6.4). Until P7.4 every
 * day is a block day for the primary topic, so progression rows show it.
 */

/** Session budget for the queue: the top of the learner's 60–90 min block. */
export const QUEUE_SESSION_MINUTES = 90;
const REENTRY_MINUTES = 20;
const DAY_MS = 86_400_000;

/**
 * P7.5: one progression row chosen by the two-loop selector. Each carries its
 * own topic and whether its pattern shows (a block day shows the block's
 * problems; the basics offer and mixed rows stay hidden).
 */
export interface TodayQueuePick {
  problem: ProblemSuggestion;
  topicId: string;
  revealPattern: boolean;
  /** Only when `revealPattern`. */
  topicName?: string;
  /** Row reason; must not name the pattern when hidden. */
  reason: string;
  /** Kept even past the session budget (the D13 basics offer). */
  keep?: boolean;
}

export interface TodayQueueInput {
  /** Today's calendar date in the learner's timezone, "YYYY-MM-DD". */
  todayKey: string;
  /** Calendar dates ("YYYY-MM-DD") that had a logged session. */
  activeDayKeys: string[];
  /** Capacity-fitted due re-solves, most overdue first. */
  dueResolves: ResolvePlanSlot[];
  /** Stage-appropriate new problems for the block's topic, in order. */
  newProblems: ProblemSuggestion[];
  topic: {
    id: string;
    name: string;
    stage: TopicStage | null;
    covered: number;
    total: number;
  };
  /** Why the block's topic was chosen (curriculum reasoning). Block days only. */
  why: string;
  /** Mixed days: a reason that names no pattern (P7.4). `why` is never used then. */
  mixedWhy?: string;
  /** Per-row reason for progression problems, e.g. "Practicing: Medium". */
  progressionReason?: string;
  dayKind?: DayKind;
  /** P7.5: the two-loop selector's rows, used instead of `newProblems`. */
  picks?: TodayQueuePick[];
  /** P7.5: a consolidation day leads with this topic's re-solve. */
  preferResolveTopicId?: string | null;
  minutes?: number;
  weeklyTarget?: number;
}

function keyMinusDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - days * DAY_MS).toISOString().slice(0, 10);
}

function resolveRow(slot: ResolvePlanSlot, minutes: number, todayKey: string): TodayQueueBlock {
  return {
    kind: "resolve",
    problemId: slot.problemId,
    name: slot.name,
    difficulty: slot.difficulty,
    leetcodeLink: slot.leetcodeLink,
    topicId: slot.topicId,
    revealPattern: false,
    minutes,
    reason: slot.reason,
    dueSince: keyMinusDays(todayKey, Math.max(0, slot.daysOverdue)),
    ...(slot.takeaway ? { takeaway: slot.takeaway } : {}),
  };
}

function pickRow(pick: TodayQueuePick, minutes: number): TodayQueueBlock {
  return {
    kind: "progression",
    problemId: pick.problem.problemId,
    name: pick.problem.name,
    difficulty: pick.problem.difficulty,
    leetcodeLink: pick.problem.leetcodeLink ?? null,
    topicId: pick.topicId,
    revealPattern: pick.revealPattern,
    ...(pick.revealPattern && pick.topicName ? { topicName: pick.topicName } : {}),
    minutes,
    reason: pick.reason,
  };
}

export function buildTodayQueue(input: TodayQueueInput): TodayQueue {
  const dayKind = input.dayKind ?? "block";
  const reveal = dayKind === "block";
  const budget = input.minutes ?? QUEUE_SESSION_MINUTES;
  const week: FocusWeek = computeWeek(
    input.todayKey,
    input.activeDayKeys,
    input.weeklyTarget ?? DEFAULT_WEEKLY_TARGET,
  );
  const gapDays = computeGap(input.todayKey, input.activeDayKeys);
  const picks: TodayQueuePick[] =
    input.picks ??
    input.newProblems
      .filter((p) => !p.problemId.includes("-suggested-"))
      .map((problem) => ({
        problem,
        topicId: input.topic.id,
        revealPattern: reveal,
        topicName: input.topic.name,
        reason: input.progressionReason ?? "New problem",
      }));
  const due = input.dueResolves;
  const reentry = gapDays != null && gapDays >= REENTRY_GAP_DAYS;

  const blocks: TodayQueueBlock[] = [];
  if (reentry) {
    const easiestDue = [...due].sort(
      (a, b) => difficultyRank(a.difficulty) - difficultyRank(b.difficulty) || b.daysOverdue - a.daysOverdue,
    )[0];
    const easiestNew = [...picks].sort(
      (a, b) => difficultyRank(a.problem.difficulty) - difficultyRank(b.problem.difficulty),
    )[0];
    if (easiestDue) {
      blocks.push(resolveRow(easiestDue, Math.min(REENTRY_MINUTES, minutesFor(easiestDue.difficulty)), input.todayKey));
    } else if (easiestNew) {
      blocks.push(pickRow(easiestNew, REENTRY_MINUTES));
    }
  } else {
    let left = budget;
    const resolve =
      (input.preferResolveTopicId ? due.find((s) => s.topicId === input.preferResolveTopicId) : undefined) ??
      due.find((s) => s.topicId !== input.topic.id) ??
      due[0];
    if (resolve) {
      const m = minutesFor(resolve.difficulty);
      blocks.push(resolveRow(resolve, m, input.todayKey));
      left -= m;
    }
    picks.slice(0, 2).forEach((p, i) => {
      const m = minutesFor(p.problem.difficulty);
      if (i === 0 || m <= left || p.keep) {
        blocks.push(pickRow(p, m));
        left -= m;
      }
    });
  }

  const decision: TodayDecision = {
    dayKind,
    mode: reentry ? "reentry" : "normal",
    topic: reveal ? { ...input.topic } : null,
    why: reentry
      ? `${gapDays} days since your last session. Forget the backlog: one short problem restarts the habit.`
      : reveal
        ? input.why
        : (input.mixedWhy ?? `Mixed practice: ${blocks.length} problem${blocks.length === 1 ? "" : "s"}.`),
    week,
    gapDays,
  };

  return {
    dayKind,
    blocks,
    totalMinutes: blocks.reduce((n, b) => n + b.minutes, 0),
    decision,
  };
}

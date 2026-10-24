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
  };
}

function progressionRow(
  p: ProblemSuggestion,
  minutes: number,
  input: TodayQueueInput,
  reveal: boolean,
): TodayQueueBlock {
  return {
    kind: "progression",
    problemId: p.problemId,
    name: p.name,
    difficulty: p.difficulty,
    leetcodeLink: p.leetcodeLink ?? null,
    topicId: input.topic.id,
    revealPattern: reveal,
    ...(reveal ? { topicName: input.topic.name } : {}),
    minutes,
    reason: input.progressionReason ?? "New problem",
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
  const fresh = input.newProblems.filter((p) => !p.problemId.includes("-suggested-"));
  const due = input.dueResolves;
  const reentry = gapDays != null && gapDays >= REENTRY_GAP_DAYS;

  const blocks: TodayQueueBlock[] = [];
  if (reentry) {
    const easiestDue = [...due].sort(
      (a, b) => difficultyRank(a.difficulty) - difficultyRank(b.difficulty) || b.daysOverdue - a.daysOverdue,
    )[0];
    const easiestNew = [...fresh].sort(
      (a, b) => difficultyRank(a.difficulty) - difficultyRank(b.difficulty),
    )[0];
    if (easiestDue) {
      blocks.push(resolveRow(easiestDue, Math.min(REENTRY_MINUTES, minutesFor(easiestDue.difficulty)), input.todayKey));
    } else if (easiestNew) {
      blocks.push(progressionRow(easiestNew, REENTRY_MINUTES, input, reveal));
    }
  } else {
    let left = budget;
    const resolve = due.find((s) => s.topicId !== input.topic.id) ?? due[0];
    if (resolve) {
      const m = minutesFor(resolve.difficulty);
      blocks.push(resolveRow(resolve, m, input.todayKey));
      left -= m;
    }
    fresh.slice(0, 2).forEach((p, i) => {
      const m = minutesFor(p.difficulty);
      if (i === 0 || m <= left) {
        blocks.push(progressionRow(p, m, input, reveal));
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

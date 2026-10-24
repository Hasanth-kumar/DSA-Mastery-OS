import type {
  FocusBlock,
  FocusMode,
  FocusPlan,
  FocusWeek,
  ProblemSuggestion,
  ResolvePlanSlot,
  TopicDifficulty,
} from "../types.js";

/**
 * "Do this now": turns the due re-solves, the next new problems and the
 * learner's recent consistency into one time-boxed session. Pure — the backend
 * supplies the facts, this decides the shape of the day.
 *
 * Design rules (for a learner who works full time and has bursts and gaps):
 *  - a weekly target, not a daily streak;
 *  - after a gap, restart with ONE easy problem — no backlog guilt;
 *  - re-solves come first (that is what locks a pattern in), then new material;
 *  - the day is already decided, so starting costs no thinking.
 */

export const DEFAULT_WEEKLY_TARGET = 5;
export const DEFAULT_SESSION_MINUTES = 60;
/** Days without a session before the plan switches to a gentle restart. */
export const REENTRY_GAP_DAYS = 3;
const LOG_BLOCK_MINUTES = 5;
const REENTRY_MINUTES = 20;
const BONUS_MINUTES = 25;

export interface FocusInput {
  /** Today's calendar date in the learner's timezone, "YYYY-MM-DD". */
  todayKey: string;
  /** Calendar dates ("YYYY-MM-DD", learner timezone) that had a logged session. */
  activeDayKeys: string[];
  /** Capacity-fitted due re-solves, most urgent first. */
  dueResolves: ResolvePlanSlot[];
  /** Next new problems for the primary topic. */
  newProblems: ProblemSuggestion[];
  primaryTopicName: string | null;
  /** Most repeated mistake tag across topics. */
  topMistake: { tag: string; count: number } | null;
  minutes?: number;
  weeklyTarget?: number;
}

const CHECKLISTS: Record<string, string[]> = {
  "off-by-one": [
    "Does the loop touch the first AND last index?",
    "Check < versus <= at every boundary",
    "Dry-run an empty input and a one-element input",
  ],
  "edge-case": [
    "Try empty, one element and all-equal input",
    "Think duplicates and negative numbers",
    "Try the smallest and largest allowed input",
  ],
  "wrong-approach": [
    "Name the pattern before writing any code",
    "Say why brute force is too slow and where the bottleneck is",
    "Run one example by hand against your approach first",
  ],
  "pattern-recall": [
    "What does the input shape hint at: sorted, window, graph, intervals?",
    "Which similar problem have you solved before?",
    "Write the pattern name next to the problem before you code",
  ],
};

/** Time to budget for a problem by difficulty (minutes). */
export function minutesFor(difficulty: TopicDifficulty | null | undefined): number {
  if (difficulty === "Easy") return 20;
  if (difficulty === "Hard") return 50;
  return 35;
}

export function difficultyRank(d: TopicDifficulty | null | undefined): number {
  return d === "Easy" ? 0 : d === "Medium" || d == null ? 1 : 2;
}

// --- calendar-date helpers (keys are plain dates, so UTC math is timezone-safe) ---

function keyToUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function diffDays(laterKey: string, earlierKey: string): number {
  return Math.round((keyToUtc(laterKey) - keyToUtc(earlierKey)) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday for a calendar date. */
function weekdayMondayFirst(key: string): number {
  const js = new Date(keyToUtc(key)).getUTCDay(); // 0 = Sunday
  return (js + 6) % 7;
}

export function computeWeek(
  todayKey: string,
  activeDayKeys: string[],
  target: number,
): FocusWeek {
  const offset = weekdayMondayFirst(todayKey);
  const weekStart = keyToUtc(todayKey) - offset * 86_400_000;
  const done = new Set(
    activeDayKeys.filter((k) => keyToUtc(k) >= weekStart && keyToUtc(k) <= keyToUtc(todayKey)),
  ).size;
  const todayDone = activeDayKeys.includes(todayKey);
  const daysLeft = 7 - offset - (todayDone ? 1 : 0);
  const remaining = Math.max(0, target - done);
  return { target, done, remaining, daysLeft, onTrack: remaining <= daysLeft };
}

export function computeGap(todayKey: string, activeDayKeys: string[]): number | null {
  const past = activeDayKeys.filter((k) => k <= todayKey).sort();
  if (past.length === 0) return null;
  return diffDays(todayKey, past[past.length - 1]);
}

function resolveBlock(slot: ResolvePlanSlot, minutes: number): FocusBlock {
  return {
    kind: "resolve",
    title: `Re-solve: ${slot.name}`,
    minutes,
    instruction:
      "Cold re-solve. Say the pattern out loud first, then code with no AI help. Log honestly.",
    problemId: slot.problemId,
    leetcodeLink: slot.leetcodeLink,
    difficulty: slot.difficulty,
  };
}

function learnBlock(p: ProblemSuggestion, minutes: number, topic: string | null): FocusBlock {
  return {
    kind: "learn",
    title: `New: ${p.name}`,
    minutes,
    instruction:
      "Name the pattern you would try, then solve. Stuck for 20 minutes? Get a hint, then log it honestly.",
    problemId: p.problemId,
    leetcodeLink: p.leetcodeLink,
    difficulty: p.difficulty,
    topicName: topic ?? undefined,
  };
}

function logBlock(): FocusBlock {
  return {
    kind: "log",
    title: "Log it",
    minutes: LOG_BLOCK_MINUTES,
    instruction:
      "Log the session, mark whether you needed help, tag any mistakes, and write one line: what was the key insight?",
  };
}

export function buildFocusPlan(input: FocusInput): FocusPlan {
  const target = input.weeklyTarget ?? DEFAULT_WEEKLY_TARGET;
  const minutes = input.minutes ?? DEFAULT_SESSION_MINUTES;
  const week = computeWeek(input.todayKey, input.activeDayKeys, target);
  const gapDays = computeGap(input.todayKey, input.activeDayKeys);
  const doneToday = input.activeDayKeys.includes(input.todayKey);

  const tip =
    input.topMistake && CHECKLISTS[input.topMistake.tag]
      ? {
          tag: input.topMistake.tag,
          count: input.topMistake.count,
          checklist: CHECKLISTS[input.topMistake.tag],
        }
      : null;

  const due = input.dueResolves;
  const fresh = input.newProblems.filter((p) => !p.problemId.includes("-suggested-"));

  const base = (mode: FocusMode, headline: string, reason: string, blocks: FocusBlock[]) => ({
    mode,
    headline,
    reason,
    blocks,
    totalMinutes: blocks.reduce((n, b) => n + b.minutes, 0),
    week,
    gapDays,
    tip,
  });

  // 1. Already studied today — celebrate, offer one optional extra.
  if (doneToday) {
    const extra = due[0] ? [resolveBlock(due[0], Math.min(BONUS_MINUTES, minutesFor(due[0].difficulty)))] : [];
    return base(
      "done",
      "Today's session is done",
      week.remaining > 0
        ? `${week.done} of ${week.target} sessions this week. ${extra.length ? "Optional: one more re-solve if you have energy." : "Rest is part of the plan."}`
        : `Weekly target reached (${week.done}/${week.target}). Anything more is a bonus.`,
      extra,
    );
  }

  // 2. Long gap — restart small, no backlog guilt.
  if (gapDays != null && gapDays >= REENTRY_GAP_DAYS) {
    const easiestDue = [...due].sort(
      (a, b) => difficultyRank(a.difficulty) - difficultyRank(b.difficulty) || b.daysOverdue - a.daysOverdue,
    )[0];
    const easiestNew = [...fresh].sort(
      (a, b) => difficultyRank(a.difficulty) - difficultyRank(b.difficulty),
    )[0];
    const blocks: FocusBlock[] = [];
    if (easiestDue) blocks.push(resolveBlock(easiestDue, Math.min(REENTRY_MINUTES, minutesFor(easiestDue.difficulty))));
    else if (easiestNew) blocks.push(learnBlock(easiestNew, REENTRY_MINUTES, input.primaryTopicName));
    blocks.push(logBlock());
    return base(
      "reentry",
      "Welcome back — start small",
      `${gapDays} days since your last session. Forget the backlog: one problem today restarts the habit.`,
      blocks,
    );
  }

  // 3. Normal day: re-solves first, then new material, then log.
  const blocks: FocusBlock[] = [];
  let budget = minutes - LOG_BLOCK_MINUTES;

  if (due[0]) {
    const m = Math.min(budget, minutesFor(due[0].difficulty));
    blocks.push(resolveBlock(due[0], m));
    budget -= m;
  }
  if (fresh[0] && budget >= 15) {
    const m = Math.min(budget, minutesFor(fresh[0].difficulty));
    blocks.push(learnBlock(fresh[0], m, input.primaryTopicName));
    budget -= m;
  }
  if (due[1] && budget >= 20) {
    const m = Math.min(budget, minutesFor(due[1].difficulty));
    blocks.push(resolveBlock(due[1], m));
    budget -= m;
  }
  if (blocks.length === 0) {
    blocks.push({
      kind: "learn",
      title: input.primaryTopicName ? `Practice: ${input.primaryTopicName}` : "Pick one problem",
      minutes: budget,
      instruction: "Pick one problem on your current topic, name the pattern first, then solve it.",
      topicName: input.primaryTopicName ?? undefined,
    });
  }
  blocks.push(logBlock());

  const problems = blocks.filter((b) => b.kind !== "log").length;
  const lead = blocks[0];
  const why =
    lead.kind === "resolve"
      ? `Start with the re-solve${due[0].daysOverdue > 0 ? ` (${due[0].daysOverdue}d overdue)` : ""}: re-solving is what locks a pattern in.`
      : "Nothing is due for re-solve, so today is for new material.";
  const pace = week.onTrack
    ? `${week.done}/${week.target} sessions this week.`
    : `${week.done}/${week.target} sessions this week — finishing needs a session on each remaining day, so keep today short and finish it.`;

  const totalMinutes = blocks.reduce((n, b) => n + b.minutes, 0);
  return base(
    "normal",
    `Today: ${problems} problem${problems === 1 ? "" : "s"} · about ${totalMinutes} min`,
    `${why} ${pace}`,
    blocks,
  );
}

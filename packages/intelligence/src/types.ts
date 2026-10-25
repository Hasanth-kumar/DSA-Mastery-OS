/** Shared intelligence types — engines are pure computation, no I/O. */

export type TopicDifficulty = "Easy" | "Medium" | "Hard";
export type TopicStatus = "Not started" | "In progress" | "Mastered";

/**
 * Where the learner is with a topic. First exposure to a pattern is expected to
 * be messy (wrong approach, hints) — that is "learning", not "weak".
 */
export type TopicStage = "learning" | "practicing" | "retaining";

export interface TopicState {
  id: string;
  name: string;
  difficulty: TopicDifficulty;
  status: TopicStatus;
  confidence: number;
  revisionCount: number;
  lastRevised: Date | null;
  nextRevisionAt: Date | null;
  /** Persisted SM-2 interval in days (source of truth for scheduling math). */
  sm2Interval: number;
  /** Persisted SM-2 repetition count (successful reviews). */
  sm2Repetition: number;
  /** Persisted SM-2 ease factor. */
  sm2Efactor: number;
  isWeakArea: boolean;
  problemsSolved: number;
  totalAttempts: number;
  averageTimeTaken: number;
  prerequisites: string[];
  recentSessions: SessionSnapshot[];
  /** Mistake-tag counts from recent problem attempts (e.g. { "off-by-one": 3 }). */
  mistakeTagCounts?: Record<string, number>;
  /** Note coverage: solved problems vs solved problems that have an Obsidian note. */
  noteCoverage?: { solved: number; withNotes: number };
  /** Recent attempts solved with coach help vs total (D) — "with coach" < "cold". */
  coachAssist?: { assisted: number; solved: number };
  /** The topic's most recent attempt was tagged could-not-solve (P3.5). */
  lastAttemptCouldNotSolve?: boolean;
  /**
   * Due dates of the topic's active re-solves (`problem_reviews`, not retired or
   * suspended; null = not yet scheduled). Present only when topic SM-2 is retired
   * (`hideTopicRevision`, P4.1): urgency then comes from problem FSRS, not
   * `nextRevisionAt`. Undefined keeps the SM-2 rule.
   */
  resolveDueAt?: (Date | null)[];
}

/** One-tap mistake taxonomy captured after logging a problem. */
/**
 * The closed mistake vocabulary — the single source of truth (P6.3). Every
 * per-tag table (labels, weakness advice, FocusPlanner checklists) is typed
 * `Record<MistakeTag, …>`, so adding a tag here fails the build until each
 * table covers it. `could-not-solve` is a system tag for failed re-solves,
 * not a capture option.
 */
export type MistakeTag =
  | "wrong-approach"
  | "edge-case"
  | "off-by-one"
  | "pattern-recall"
  | "greedy-invariant"
  | "loop-bounds";

export const MISTAKE_TAG_LABELS: Record<MistakeTag, string> = {
  "wrong-approach": "Wrong approach",
  "edge-case": "Missed edge case",
  "off-by-one": "Off-by-one",
  "pattern-recall": "Couldn't recall pattern",
  "greedy-invariant": "Wrong greedy choice",
  "loop-bounds": "Loop bounds / termination",
};

/**
 * P6.1: how much help a solve needed, replacing the "used coach" checkbox.
 * "Clean" in the overhaul plan = no `wrong-approach` and help ≤ `hint`.
 */
export type HelpLevel = "none" | "hint" | "approach" | "solution";
/** P6.1: where the help came from. */
export type HelpSource = "coach" | "external-ai" | "other";

export const HELP_LEVELS: readonly HelpLevel[] = ["none", "hint", "approach", "solution"];
export const HELP_LEVEL_LABELS: Record<HelpLevel, string> = {
  none: "None",
  hint: "Hint",
  approach: "Approach",
  solution: "Full solution",
};
export const HELP_SOURCE_LABELS: Record<HelpSource, string> = {
  coach: "In-app coach",
  "external-ai": "External AI",
  other: "Other",
};

/** Capture order on MistakeCapture. The last two were added in P6.3. */
export const MISTAKE_TAGS: readonly MistakeTag[] = [
  "wrong-approach",
  "edge-case",
  "off-by-one",
  "pattern-recall",
  "greedy-invariant",
  "loop-bounds",
];

/** Tags meaning the core idea was missing, not a slip in the details. */
export const APPROACH_MISTAKE_TAGS: readonly MistakeTag[] = [
  "wrong-approach",
  "pattern-recall",
  "greedy-invariant",
];

export interface SessionSnapshot {
  date: Date;
  problemsSolved: number;
  productivityScore: number;
  duration: number;
}

export interface PriorityScore {
  topicId: string;
  total: number;
  breakdown: {
    urgency: number;
    weakness: number;
    confidence: number;
    prerequisiteReady: number;
    recency: number;
    difficulty: number;
  };
  recommendation: "Study now" | "Review soon" | "Practice more" | "Maintain";
  /**
   * Recall looks fine (SM-2 not due) but execution signals are weak —
   * "recallable but unsolvable."
   */
  memoryExecutionDivergence: boolean;
}

export interface ProblemSuggestion {
  problemId: string;
  name: string;
  difficulty: TopicDifficulty;
  leetcodeLink?: string;
}

export interface CurriculumItem {
  name: string;
  topicId: string | null;
  status: "complete" | "current" | "upcoming" | "missing";
  unsolvedCount: number;
  totalCount: number;
}

export interface CurriculumProgress {
  topicNames: string[];
  currentIndex: number;
  activeTopicId: string | null;
  /** When the manual pin ends on age (P3.3), ms; null when unpinned or no clock yet. */
  pinExpiresAt?: number | null;
  items: CurriculumItem[];
}

/** A concrete solved problem surfaced for revision (C). */
export interface RevisionProblem {
  problemId: string;
  name: string;
  difficulty: TopicDifficulty | null;
  leetcodeLink?: string;
  topicId: string;
  topicName: string;
  /** recall ≈ 5 min check; resolve = full re-solve (weak topic). */
  mode: "recall" | "resolve";
}

export interface StudyPlan {
  date: Date;
  primaryTopic: TopicState;
  revisionTopics: TopicState[];
  /** Clickable solved problems for the due revision topics (max 2/day). */
  revisionProblems: RevisionProblem[];
  suggestedProblems: ProblemSuggestion[];
  estimatedDuration: number;
  reasoning: string;
  curriculum?: CurriculumProgress;
  /** Total topics due for revision (before catch-up compression). */
  revisionTotalDue?: number;
  /** Topics pushed forward by catch-up compression on this plan. */
  revisionDeferred?: number;
  /** Primary topic has recall-strong / execution-weak divergence. */
  memoryExecutionDivergence?: boolean;
  /** Other topics with the same divergence signal (dashboard surfacing). */
  divergentTopics?: { id: string; name: string }[];
  /** Capacity-fitted problem re-solve slots (re-solve design §6, §10). */
  resolveSlots?: ResolvePlanSlot[];
  /** Problems due for re-solve today (before capacity fitting). */
  resolveTotalDue?: number;
  /** Re-solves pushed forward by capacity compression on this plan. */
  resolveDeferred?: number;
  /** The one-screen "do this now" plan (time-boxed, gap-aware). */
  focus?: FocusPlan;
  /** P5.1: Today's single ordered list of problems (`todayQueueV2`). */
  queue?: TodayQueue;
}

/**
 * P5.1 / plan §6.4. A block day works through one pattern's short block with
 * the pattern shown; a mixed day hides patterns. Until P7.4, every day is a
 * block day for the primary topic.
 */
export type DayKind = "block" | "mixed";

/** One row of Today's queue. */
export interface TodayQueueBlock {
  kind: "resolve" | "progression";
  problemId: string;
  name: string;
  difficulty: TopicDifficulty | null;
  leetcodeLink: string | null;
  /** Opaque id the log is recorded against. Never a name. */
  topicId: string | null;
  /** False for re-solves and mixed rows: no pattern name until ✓ Done (§6.4). */
  revealPattern: boolean;
  /** Present only when `revealPattern` is true. */
  topicName?: string;
  minutes: number;
  /** Why this row is here. Never names a hidden row's pattern. */
  reason: string;
  /** Re-solves: the calendar day it first fell due, "YYYY-MM-DD". */
  dueSince?: string;
  /** Re-solves: the learner's last takeaway (P6.2), a pre-solve reminder. */
  takeaway?: string;
}

/** Why today looks the way it does (banner, P5.3). */
export interface TodayDecision {
  dayKind: DayKind;
  /** "reentry" after a gap of 3+ days: one short Easy problem, no backlog. */
  mode: "normal" | "reentry";
  /** The block's pattern. Null on a mixed day, so nothing names it. */
  topic: {
    id: string;
    name: string;
    stage: TopicStage | null;
    /** First-pass progress: problems covered of the topic's total. */
    covered: number;
    total: number;
  } | null;
  why: string;
  week: FocusWeek;
  gapDays: number | null;
}

export interface TodayQueue {
  dayKind: DayKind;
  blocks: TodayQueueBlock[];
  totalMinutes: number;
  decision: TodayDecision;
}

/** What kind of day this is: a normal session, a gentle restart after a gap, or already done. */
export type FocusMode = "normal" | "reentry" | "done";

/** One time-boxed step of the focus plan. */
export interface FocusBlock {
  kind: "resolve" | "learn" | "log";
  title: string;
  minutes: number;
  /** What to actually do in this block — one sentence. */
  instruction: string;
  problemId?: string;
  leetcodeLink?: string | null;
  difficulty?: TopicDifficulty | null;
  topicName?: string;
}

/** Weekly quota progress — a weekly target replaces a fragile daily streak. */
export interface FocusWeek {
  target: number;
  done: number;
  remaining: number;
  /** Days left this week including today (if today is not done yet). */
  daysLeft: number;
  /** True when the remaining sessions still fit in the remaining days. */
  onTrack: boolean;
}

export interface FocusPlan {
  mode: FocusMode;
  headline: string;
  reason: string;
  totalMinutes: number;
  blocks: FocusBlock[];
  week: FocusWeek;
  /** Days since the last logged session; null when there is no history. */
  gapDays: number | null;
  /** Pre-submit checklist for the learner's most repeated mistake (cross-topic). */
  tip: { tag: string; count: number; checklist: string[] } | null;
}

/** One committed re-solve on today's plan (re-solve design §6, §10). */
export interface ResolvePlanSlot {
  problemId: string;
  name: string;
  difficulty: TopicDifficulty | null;
  leetcodeLink: string | null;
  /** The problem's topic: a re-solve logged on Today counts toward it (P4.2). */
  topicId: string | null;
  daysOverdue: number;
  /** Escalation promotion (§6) — rendered uncollapsed with its reason. */
  promoted: boolean;
  /** Why it's in the pool ("2 mistakes, used coach") — the trust string. */
  reason: string;
  /** P6.2: the learner's last one-line takeaway on this problem. */
  takeaway?: string;
}

export interface PlanOptions {
  maxRevisionTopics?: number;
  availableMinutes?: number;
  /** Sessions per week the learner is aiming for (focus plan). Default 5. */
  weeklyTarget?: number;
}

export interface PriorityWeights {
  urgency: number;
  weakness: number;
  confidence: number;
  prerequisite: number;
  recency: number;
}

export interface SM2State {
  interval: number;
  repetition: number;
  efactor: number;
  nextRevisionAt: Date;
}

export interface WeaknessSignal {
  name: string;
  weight: number;
  value: number;
  description: string;
}

export interface WeaknessAnalysis {
  topicId: string;
  score: number;
  isWeak: boolean;
  /** Learning stage the verdict was made at (a topic in "learning" is never flagged weak). */
  stage?: TopicStage;
  signals: WeaknessSignal[];
  recommendation: string;
}

export interface WeaknessReport {
  weakTopics: WeaknessAnalysis[];
  strongTopics: WeaknessAnalysis[];
  summary: string;
}

export interface DifficultyRecommendation {
  primary: TopicDifficulty;
  secondary: TopicDifficulty | null;
  ratio: [number, number];
  /** Stage that produced it (P3.5). */
  stage?: TopicStage;
  /** Plain-English reason, e.g. "Practicing: Medium". */
  reason?: string;
}

export interface IntelligenceUpdate {
  sm2: SM2State;
  weaknessUpdate: WeaknessAnalysis;
}

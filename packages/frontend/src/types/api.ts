/**
 * API response shapes. Date-free domain types come straight from
 * `@dsa/intelligence` (single source of truth); types whose Date fields
 * arrive JSON-serialized as strings are re-declared here in wire form
 * (e.g. `Topic` vs intelligence's `TopicState`).
 */
import type {
  AdmissionReason,
  CurriculumItem,
  CurriculumProgress,
  DifficultyAnalysis,
  MasteryVelocityPoint,
  MistakeTag,
  ResolvePlanSlot,
  ResolveRating,
  RevisionProblem,
  TodayQueue,
  TopicDifficulty,
  TopicStatus,
  WeaknessTrendPoint,
} from "@dsa/intelligence";

export type {
  AdmissionReason,
  CurriculumItem,
  CurriculumProgress,
  DifficultyAnalysis,
  DifficultyBucket,
  MasteryVelocityPoint,
  MistakeTag,
  PriorityScore,
  ResolvePlanSlot,
  ResolveRating,
  RevisionProblem,
  StreakInfo,
  TodayQueue,
  HelpLevel,
  HelpSource,
  TopicDifficulty,
  TopicDifficultyAlignment,
  TopicStatus,
  WeaknessTrendPoint,
} from "@dsa/intelligence";

export interface Topic {
  id: string;
  name: string;
  difficulty: TopicDifficulty;
  status: TopicStatus;
  confidence: number;
  revisionCount: number;
  lastRevised: string | null;
  nextRevisionAt: string | null;
  isWeakArea: boolean;
  problemsSolved: number;
  totalAttempts: number;
  averageTimeTaken: number;
  prerequisites: string[];
}

export interface Problem {
  id: string;
  name: string;
  topicId: string | null;
  difficulty: TopicDifficulty | null;
  leetcodeLink: string | null;
  githubUrl: string | null;
  status: string;
  attempts: number;
}

export interface Session {
  id: string;
  date: number;
  topicId: string | null;
  problemsSolved: number;
  studyDuration: number;
  productivityScore: number;
}

export interface CurriculumState {
  topicNames: string[];
  activeTopicId: string | null;
  selection: {
    topic: Topic;
    index: number;
    items: CurriculumItem[];
    reasoning: string;
  } | null;
}

export type FocusMode = "normal" | "reentry" | "done";

export interface FocusBlock {
  kind: "resolve" | "learn" | "log";
  title: string;
  minutes: number;
  instruction: string;
  problemId?: string;
  leetcodeLink?: string;
  difficulty?: TopicDifficulty;
  topicName?: string;
}

export interface FocusPlan {
  mode: FocusMode;
  headline: string;
  reason: string;
  totalMinutes: number;
  blocks: FocusBlock[];
  week: { target: number; done: number; remaining: number; daysLeft: number; onTrack: boolean };
  gapDays: number;
  tip: { tag: string; count: number; checklist: string[] } | null;
}

/** Overhaul feature flags (`GET /api/flags`, read-only; `FLAG_<NAME>` in the backend `.env`). */
export interface FeatureFlags {
  todayQueueV2: boolean;
  unifiedCompletion: boolean;
  /** Topic SM-2 retired: Today hides the Revision column and the post-solve revision offer (P4.3). */
  hideTopicRevision: boolean;
  helpLevelCapture: boolean;
  takeawayField: boolean;
  curriculumV2: boolean;
  spiralPasses: boolean;
}

export interface StudyPlan {
  date: string;
  /** Time-boxed daily plan; absent on cached plans from before this field existed. */
  focus?: FocusPlan;
  primaryTopic: Topic;
  revisionTopics: Topic[];
  /** Optional: cached plans from before this field existed won't have it. */
  revisionProblems?: RevisionProblem[];
  suggestedProblems: {
    problemId: string;
    name: string;
    difficulty: TopicDifficulty;
    leetcodeLink?: string;
  }[];
  estimatedDuration: number;
  reasoning: string;
  curriculum?: CurriculumProgress;
  revisionTotalDue?: number;
  revisionDeferred?: number;
  memoryExecutionDivergence?: boolean;
  divergentTopics?: { id: string; name: string }[];
  resolveSlots?: ResolvePlanSlot[];
  resolveTotalDue?: number;
  resolveDeferred?: number;
  /** P5.1: Today's single ordered list of problems (`todayQueueV2`). */
  queue?: TodayQueue;
}

export type ResolveOutcomeKind = "solved" | "assisted" | "failed";
export type ResolveStatus = "overdue" | "due" | "scheduled" | "retired" | "suspended";

/** One pooled problem on the Re-solve page (re-solve design §10). */
export interface ResolveQueueItem {
  problemId: string;
  name: string;
  difficulty: TopicDifficulty | null;
  leetcodeLink: string | null;
  topicId: string | null;
  admissionReason: AdmissionReason;
  admittedAt: number;
  reason: string;
  status: ResolveStatus;
  due: number | null;
  daysOverdue: number;
  stability: number | null;
  state: number;
  reps: number;
  lapses: number;
}

export interface ResolveQueueResponse {
  items: ResolveQueueItem[];
  slots: ResolvePlanSlot[];
  capacity: number;
  dueCount: number;
  slowThresholdMin: Record<TopicDifficulty, number>;
}

export interface ResolveCompleteResult {
  problemId: string;
  inferredRating: ResolveRating;
  rating: ResolveRating;
  due: number;
  intervalDays: number;
  leech: boolean;
  retired: boolean;
}

export const MISTAKE_TAG_OPTIONS: { tag: MistakeTag; label: string }[] = [
  { tag: "wrong-approach", label: "Wrong approach" },
  { tag: "edge-case", label: "Missed edge case" },
  { tag: "off-by-one", label: "Off-by-one" },
  { tag: "pattern-recall", label: "Couldn't recall pattern" },
];

const MISTAKE_TAG_LABELS: Record<string, string> = Object.fromEntries(
  MISTAKE_TAG_OPTIONS.map((o) => [o.tag, o.label]),
);

/** Human label for a stored mistake tag, falling back to the raw key. */
export function mistakeTagLabel(tag: string): string {
  return MISTAKE_TAG_LABELS[tag] ?? tag;
}

export interface ProblemNote {
  path: string;
  title: string;
  content: string;
  contentPlain: string;
  matchedBy: "frontmatter" | "filename" | null;
  updatedAt: string;
}

export interface WarmupAnswer {
  answer: string;
  unavailableReason?: "coach_offline" | "generation_failed";
}

export interface WarmupQuestion {
  question: string;
  answer: string;
  /** Source card id (warm-up cards are now drawn from the local SR bank). */
  cardId?: string | null;
  /** Card type (§3): plain-recall | pattern-trigger | cloze | … */
  type?: string;
  /** True = non-counting preview filler shown when nothing is due (§11). */
  preview?: boolean;
}

export interface WarmupQuestions {
  topicId: string;
  topicName: string;
  questions: WarmupQuestion[];
  /** `due` = real due cards; `preview` = filler only; `empty` = bank empty. */
  source: "due" | "preview" | "empty";
}

export interface RecallGradeResult {
  topicId: string;
  quality: number;
  nextRevisionAt: string | null;
  intervalDays: number;
}

/** One card in the flashcard-review queue (§11). */
export interface ReviewCard {
  id: string;
  topicId: string | null;
  type: string;
  front: string;
  back: string;
  lapses: number;
  /** Flagged a leech (§7) — surfaced so it isn't drilled silently forever. */
  leech: boolean;
  due: number | null;
}

export interface LeechAdvisory {
  cardId: string;
  front: string;
  prerequisiteConcepts: string[];
  noteExcerpt?: string;
}

export interface ReviewQueue {
  cards: ReviewCard[];
  cap: number;
  hasMore: boolean;
  leechAdvisories: LeechAdvisory[];
}

export interface ReviewGradeResult {
  cardId: string;
  due: number;
  intervalDays: number;
  state: number;
  lapses: number;
  leech: boolean;
}

export interface ScoreExplanation {
  topicId: string;
  topicName: string;
  total: number;
  recommendation: string;
  memoryExecutionDivergence?: boolean;
  breakdown: {
    urgency: number;
    weakness: number;
    confidence: number;
    prerequisiteReady: number;
    recency: number;
    difficulty: number;
  };
  weights: string;
  explanation: string[];
}

export interface WeaknessEvidence {
  topicId: string;
  topicName: string;
  analysis: {
    score: number;
    isWeak: boolean;
    signals: { name: string; weight: number; value: number; description: string }[];
    recommendation: string;
  };
  evidence: {
    mistakeTagCounts: Record<string, number>;
    noteCoverage: { solved: number; withNotes: number };
    slowProblems: { id: string; name: string; timeTaken: number | null }[];
    lowProductivitySessions: { date: string; productivityScore: number; duration: number }[];
  };
}

export interface SyncConflict {
  id: string;
  entityType: "topic" | "problem";
  entityId: string;
  entityName: string | null;
  localValue: Record<string, unknown>;
  remoteValue: Record<string, unknown>;
  detectedAt: string;
}

export interface SyncStatusInfo {
  lastSyncAt: string | null;
  pendingTopics: number;
  pendingProblems: number;
  unresolvedConflicts: number;
}

export interface ServiceHealth {
  status: "ok" | "degraded" | "down";
  message?: string;
  latencyMs?: number;
}

export interface HealthInfo {
  status: "ok" | "degraded" | "down";
  timestamp: string;
  services?: {
    api: ServiceHealth;
    sqlite: ServiceHealth;
    notion: ServiceHealth;
    llm: ServiceHealth;
  };
  sync?: SyncStatusInfo;
}

export interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  sessionsCount: number;
  sessionsThisMonth?: number;
  problemsSolved: number;
  totalStudyMinutes: number;
  averageProductivity: number;
  currentStreakDays: number;
  longestStreakDays: number;
  weakTopics?: { id: string; name: string; score: number }[];
  divergentTopics?: { id: string; name: string }[];
  masteredTopics: number;
  inProgressTopics: number;
  velocityTrend: "up" | "down" | "stable";
  problemsPerHour: number;
  weaknessTrendDirection: "improving" | "worsening" | "stable";
}

export interface SessionResult {
  session: Session;
  topicId: string;
  problemId?: string;
  attemptId?: string;
  /** Auto-captured coach usage (D2) — pre-checks the capture-step toggle. */
  usedCoach?: boolean;
  confidence: number;
  isWeakArea: boolean;
  summary: string;
}

export interface AnalyticsDashboard {
  summary: WeeklySummary;
  velocity: {
    weekly: MasteryVelocityPoint[];
    topics: { topicId: string; topicName: string; problemsSolved: number }[];
  };
  weaknessTrend: WeaknessTrendPoint[];
  difficulty: DifficultyAnalysis;
  plan?: StudyPlan;
}

export interface LeetCodeDifficultyStats {
  difficulty: TopicDifficulty | "All";
  solved: number;
  submissions: number;
}

export interface LeetCodeUserStats {
  username: string;
  ranking: number | null;
  totalSolved: number;
  totalSubmissions: number;
  byDifficulty: LeetCodeDifficultyStats[];
  fetchedAt: string;
}

/** ISO date (YYYY-MM-DD, UTC) → accepted submissions that day */
export interface LeetCodeActivity {
  username: string;
  dailyCounts: Record<string, number>;
  currentStreak: number;
  fetchedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ChatThread {
  threadId: string;
  messages: ChatMessage[];
  updatedAt: string;
}

export interface CoachModel {
  id: string;
  label: string;
  model: string;
}

export interface CoachModelList {
  models: CoachModel[];
  defaultModelId: string;
}

export interface ChatStreamEvent {
  type: "meta" | "chunk" | "done" | "error";
  threadId?: string;
  userMessage?: ChatMessage;
  text?: string;
  assistantMessage?: ChatMessage;
  message?: string;
}

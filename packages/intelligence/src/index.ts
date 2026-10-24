/**
 * Intelligence layer — six engines + orchestrator (pure TS, no I/O).
 */
export type {
  DifficultyRecommendation,
  PlanOptions,
  PriorityScore,
  ProblemSuggestion,
  ResolvePlanSlot,
  RevisionProblem,
  SessionSnapshot,
  SM2State,
  StudyPlan,
  TopicDifficulty,
  TopicState,
  TopicStatus,
  CurriculumItem,
  CurriculumProgress,
  MistakeTag,
  TopicStage,
  FocusBlock,
  FocusMode,
  FocusPlan,
  FocusWeek,
  DayKind,
  TodayDecision,
  TodayQueue,
  TodayQueueBlock,
} from "./types.js";

export { MISTAKE_TAG_LABELS } from "./types.js";

export { computePriorityScore } from "./topic-priority-engine/scoring.js";
export {
  ProblemReviewEngine,
  type AdmissionReason,
  type CompletionOutcome,
  type ProblemReviewConfig,
  type PoolBackfillItem,
  type ProblemReviewState,
  type ResolveRating,
} from "./problem-review-engine/ProblemReviewEngine.js";
export {
  deriveTopicDifficultyFromConfidence,
  deriveTopicStatusAfterSession,
} from "./topic-progression.js";
export { deriveProductivityFromDuration } from "./session-productivity.js";
export {
  confidenceDeltaForScore,
  deriveSessionOutcomeScore,
  TARGET_MINUTES,
  type SessionOutcomeInput,
} from "./session-outcome.js";
export { deriveTopicStage, LEARNING_MIN_ATTEMPTS } from "./topic-stage.js";
export { suggestionSlots } from "./difficulty-engine/DifficultyEngine.js";
export { maxIntervalDaysForConfidence } from "./revision-engine/sm2.js";
export { planScheduleRepair, type ScheduleRepairItem } from "./revision-engine/schedule-repair.js";
export { buildFocusPlan, type FocusInput } from "./focus-engine/FocusPlanner.js";
export { buildTodayQueue, type TodayQueueInput } from "./focus-engine/TodayQueue.js";
export { buildTopicGraphEdges } from "./roadmap-engine/graph-edges.js";
export {
  createIntelligenceOrchestrator,
  IntelligenceOrchestrator,
} from "./orchestrator/IntelligenceOrchestrator.js";

export {
  gradeWarmup,
  initWarmupQueue,
  warmupAverageQuality,
  type WarmupQueueState,
} from "./warmup/warmupQueue.js";
export { formatWarmupAnswer, isWalkthroughWarmupAnswer } from "./warmup/formatAnswer.js";

export { DEFAULT_CURRICULUM_TOPICS } from "./curriculum-engine/default-topics.js";
export { buildTopicProblemCounts, isRemainingFirstPass } from "./problem-progress.js";
export { evaluatePinExpiry, PIN_MAX_AGE_DAYS, type PinExpiryReason } from "./curriculum-engine/pin-expiry.js";
export {
  createCurriculumEngine,
  type CurriculumConfig,
  type CurriculumSelection,
  type PrimaryTopicSource,
  type TopicProblemCounts,
} from "./curriculum-engine/CurriculumEngine.js";

export type {
  AnalyticsProblemInput,
  AnalyticsSessionInput,
  AnalyticsTopicInput,
  DifficultyAnalysis,
  DifficultyBucket,
  MasteryVelocityPoint,
  StreakInfo,
  TopicDifficultyAlignment,
  TopicVelocity,
  WeaknessTrendPoint,
} from "./analytics/types.js";
export {
  AnalyticsEngine,
  createAnalyticsEngine,
} from "./analytics/AnalyticsEngine.js";
export {
  buildTopicState,
  groupBy,
  type TopicSignalExtras,
} from "./analytics/build-topic-snapshot.js";

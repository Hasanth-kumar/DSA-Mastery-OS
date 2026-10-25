import type {
  IntelligenceOrchestrator,
  SessionSnapshot,
  SM2State,
  TopicState,
} from "@dsa/intelligence";
import {
  confidenceDeltaForScore,
  deriveProductivityFromDuration,
  deriveSessionOutcomeScore,
  deriveTopicDifficultyFromConfidence,
  deriveTopicStatusAfterSession,
} from "@dsa/intelligence";
import type { AppConfig } from "@dsa/shared";
import {
  parseMistakeTags,
  type AttemptRepository,
  type AttemptRow,
} from "../repositories/AttemptRepository.js";
import { asHelpLevel, type ProblemReviewService } from "./ProblemReviewService.js";
import type { ProblemRepository, ProblemRow } from "../repositories/ProblemRepository.js";
import type {
  CreateSessionInput,
  SessionRepository,
  SessionRow,
  UpdateSessionInput,
} from "../repositories/SessionRepository.js";
import type { SyncMetaRepository } from "../repositories/SyncMetaRepository.js";
import type { TopicRepository } from "../repositories/TopicRepository.js";
import type { NotionSyncService, TopicSyncSnapshot } from "./NotionSyncService.js";
import type { PlanService } from "./PlanService.js";
import { asDifficulty } from "./ProblemSuggestionService.js";
import {
  clearWarmupSrsFlag,
  markWarmupSrsApplied,
  wasWarmupSrsAppliedToday,
} from "./warmupSrs.js";

export interface CompleteSessionInput extends CreateSessionInput {
  pushToNotion?: boolean;
  problemId?: string;
  /** One-tap mistake taxonomy tag captured with (or after) the log. */
  mistakeTag?: string | null;
  /**
   * When true, warm-up already drove SRS for this topic today — session logging
   * must not reschedule (confidence / weakness still update).
   */
  warmupGraded?: boolean;
  /**
   * When false, mark the problem Solved immediately (WhatsApp / inline mistakeTag).
   * Default: defer until POST /attempts/:id/mistake when attemptRepo is wired.
   */
  deferProblemStatus?: boolean;
}

export interface SessionResult {
  session: SessionRow;
  topicId: string;
  problemId?: string;
  /** Attempt record id — target for the post-log mistake-capture PATCH. */
  attemptId?: string;
  /** Auto-captured coach usage (D2) — pre-checks the capture-step toggle. */
  usedCoach?: boolean;
  nextRevisionAt: string | null;
  confidence: number;
  isWeakArea: boolean;
  summary: string;
}

export interface RecallResult {
  topicId: string;
  quality: number;
  nextRevisionAt: string | null;
  intervalDays: number;
}

/** A session with no problem attached has no outcome to judge — keep its score modest. */
const NO_PROBLEM_SCORE_CAP = 70;

/**
 * Topic state captured just before a session is applied. The session is saved
 * first and its mistake tags / "needed help" flag arrive afterwards, so the
 * topic update is provisional until then and is re-applied from this snapshot.
 */
interface SessionPreState {
  confidence: number;
  revisionCount: number;
  lastRevised: number | null;
  nextRevisionAt: number | null;
  sm2Interval: number;
  sm2Repetition: number;
  sm2Efactor: number;
  isWeakArea: boolean;
  status: TopicState["status"];
  difficulty: TopicState["difficulty"];
  /** Warm-up already drove SRS today — this session never reschedules. */
  skipScheduling: boolean;
  /** `lastRevised` (ms) this session wrote — proves nothing else touched the topic since. */
  appliedAt: number;
}

const preStateKey = (sessionId: string) => `session_pre:${sessionId}`;

export class SessionService {
  constructor(
    private readonly config: AppConfig,
    private readonly intelligence: IntelligenceOrchestrator,
    private readonly sessionRepo: SessionRepository,
    private readonly topicRepo: TopicRepository,
    private readonly problemRepo: ProblemRepository,
    private readonly planService: PlanService,
    private readonly notionSync: NotionSyncService,
    private readonly syncMetaRepo: SyncMetaRepository,
    private readonly attemptRepo?: AttemptRepository,
    /** Coach interactions per problemId (D2) — read + cleared when the attempt is stamped. */
    private readonly coachUsage?: Map<string, number>,
    /** Re-solve pool hooks (re-solve design §9): admission re-eval + leech unsuspend. */
    private readonly problemReviews?: ProblemReviewService,
  ) {}

  list(limit = 50): SessionRow[] {
    return this.sessionRepo.findAll(limit);
  }

  getActivityDailyCounts(days = 182): Record<string, number> {
    const sinceMs = Date.now() - days * 86_400_000;
    return this.sessionRepo.getDailyProblemCounts(sinceMs);
  }

  getById(id: string): SessionRow | null {
    return this.sessionRepo.findById(id);
  }

  async completeSession(input: CompleteSessionInput): Promise<SessionResult> {
    const topic = this.topicRepo.findById(input.topicId);
    if (!topic) {
      throw new Error(`Topic not found: ${input.topicId}`);
    }

    const problem = input.problemId ? this.problemRepo.findById(input.problemId) : null;
    if (input.problemId && !problem) {
      throw new Error(`Problem not found: ${input.problemId}`);
    }
    if (problem?.topicId && problem.topicId !== input.topicId) {
      throw new Error(`Problem ${input.problemId} does not belong to topic ${input.topicId}`);
    }

    const studyDuration = Math.max(1, Math.round(input.studyDuration));

    // Outcome-based score. In-app hints are known now; mistake tags and the
    // "needed outside help" flag usually arrive later (see rescoreAfterMistakeCapture),
    // so this score is provisional unless the tags came with the log.
    const hintCount = input.problemId ? (this.coachUsage?.get(input.problemId) ?? 0) : 0;
    const tagsKnown = input.mistakeTag !== undefined;
    const productivityScore = problem
      ? deriveSessionOutcomeScore({
          durationMin: studyDuration,
          difficulty: asDifficulty(problem.difficulty),
          usedHelp: hintCount > 0,
          hintCount,
          mistakeTags: tagsKnown ? parseMistakeTags(input.mistakeTag ?? null) : undefined,
        })
      : Math.min(NO_PROBLEM_SCORE_CAP, deriveProductivityFromDuration(studyDuration));

    const sessionRow = this.sessionRepo.create({
      ...input,
      studyDuration,
      productivityScore,
    });
    const sessionSnapshot: SessionSnapshot = {
      date: new Date(sessionRow.date),
      problemsSolved: sessionRow.problemsSolved ?? 0,
      productivityScore: sessionRow.productivityScore ?? 0,
      duration: sessionRow.studyDuration ?? 0,
    };

    const skipScheduling =
      input.warmupGraded === true ||
      wasWarmupSrsAppliedToday(this.syncMetaRepo, input.topicId);

    // Remember where the topic stood so the update can be redone once the
    // outcome is fully known.
    const pre: SessionPreState = {
      confidence: topic.confidence,
      revisionCount: topic.revisionCount,
      lastRevised: topic.lastRevised?.getTime() ?? null,
      nextRevisionAt: topic.nextRevisionAt?.getTime() ?? null,
      sm2Interval: topic.sm2Interval,
      sm2Repetition: topic.sm2Repetition,
      sm2Efactor: topic.sm2Efactor,
      isWeakArea: topic.isWeakArea,
      status: topic.status,
      difficulty: topic.difficulty,
      skipScheduling,
      appliedAt: sessionSnapshot.date.getTime(),
    };
    if (problem) {
      this.syncMetaRepo.set(preStateKey(sessionRow.id), JSON.stringify(pre));
    }

    const { patch, topicSnapshot } = this.applySessionToTopic(
      topic,
      sessionSnapshot,
      skipScheduling,
    );
    this.topicRepo.update(input.topicId, patch);

    if (skipScheduling) {
      clearWarmupSrsFlag(this.syncMetaRepo, input.topicId);
    }

    this.notionSync.markTopicDirty(input.topicId, topicSnapshot);

    let solvedProblem = problem;
    let attemptId: string | undefined;
    let usedCoach: boolean | undefined;
    if (input.problemId && problem) {
      solvedProblem = this.problemRepo.recordAttempt(
        input.problemId,
        input.studyDuration,
      );
      const deferStatus =
        input.deferProblemStatus ??
        Boolean(this.attemptRepo && input.mistakeTag == null);

      if (solvedProblem && !deferStatus) {
        const tags = parseMistakeTags(input.mistakeTag ?? null);
        solvedProblem = this.applyProblemStatus(input.problemId, tags, solvedProblem);
      } else if (solvedProblem) {
        this.notionSync.markProblemDirty(input.problemId, solvedProblem);
      }

      const hintCount = this.coachUsage?.get(input.problemId) ?? 0;
      usedCoach = hintCount > 0;
      this.coachUsage?.delete(input.problemId);
      // P4.2: a problem in the re-solve pool logged through the normal flow is
      // a re-solve. It records as one, and its FSRS rating is inferred here and
      // redone after MistakeCapture (ProblemReviewService.completeAttempt).
      const isResolve =
        this.config.flags.unifiedCompletion &&
        (this.problemReviews?.isActiveInPool(input.problemId) ?? false);
      const attempt = this.attemptRepo?.create({
        problemId: input.problemId,
        topicId: input.topicId,
        sessionId: sessionRow.id,
        solvedAt: sessionSnapshot.date,
        timeTaken: input.studyDuration,
        mistakeTag: input.mistakeTag ?? null,
        usedCoach,
        hintCount,
        kind: isResolve ? "resolve" : "solve",
      });
      attemptId = attempt?.id;
      if (isResolve && attempt) {
        this.problemReviews?.completeAttempt(attempt);
      } else {
        // Admission re-eval after every attempt (re-solve design §4).
        this.problemReviews?.evaluateAdmission(input.problemId);
      }
    }
    // A completed session on the topic lifts its leech suspensions (§5).
    this.problemReviews?.onTopicRevised(input.topicId);

    // Notion push is best-effort: the records are already marked dirty above,
    // so a failed push (offline, schema drift) replays on the next sync rather
    // than failing the one-tap logging loop.
    let notionWarning: string | null = null;
    if (input.pushToNotion !== false && this.notionSync.isConfigured()) {
      const pushes: Promise<void>[] = [
        this.notionSync.pushTopicToNotion(input.topicId, topicSnapshot),
      ];
      if (input.problemId && solvedProblem) {
        pushes.push(
          this.notionSync.pushProblemToNotion(input.problemId, solvedProblem),
        );
      }
      pushes.push(this.pushSessionToNotion(sessionRow));
      try {
        await Promise.all(pushes);
      } catch (err) {
        notionWarning =
          err instanceof Error ? err.message : "Notion push failed";
      }
    }

    await this.planService.invalidateTodaysPlan();

    return {
      session: sessionRow,
      topicId: input.topicId,
      problemId: input.problemId,
      attemptId,
      usedCoach,
      nextRevisionAt: topicSnapshot.nextRevisionAt?.toISOString() ?? null,
      confidence: topicSnapshot.confidence,
      isWeakArea: topicSnapshot.isWeakArea,
      summary: `Session logged. Next review: ${
        topicSnapshot.nextRevisionAt?.toISOString().slice(0, 10) ?? "not scheduled"
      }.${notionWarning ? ` (Notion push failed — queued for next sync: ${notionWarning})` : ""}`,
    };
  }

  /**
   * Apply one session's outcome to a topic: confidence moves by how the session
   * actually went, review scheduling uses the post-session confidence (so weak
   * topics come back soon), and weakness is re-judged with the new session.
   */
  private applySessionToTopic(
    topic: TopicState,
    session: SessionSnapshot,
    skipScheduling: boolean,
  ) {
    const confidence = Math.max(
      0,
      Math.min(100, topic.confidence + confidenceDeltaForScore(session.productivityScore)),
    );
    const updated: TopicState = { ...topic, confidence };

    // Branch explicitly so the SM-2 result is only typed/available on the
    // schedule-owning path (warm-up skipped). The execution-only path returns
    // weakness signals without `sm2`.
    const fullUpdate = skipScheduling
      ? null
      : this.intelligence.updateAfterSession(updated, session);
    const weaknessUpdate = fullUpdate
      ? fullUpdate.weaknessUpdate
      : this.intelligence.updateExecutionAfterSession(updated, session).weaknessUpdate;

    const status = deriveTopicStatusAfterSession(topic.status, confidence, weaknessUpdate.isWeak);
    const difficulty = deriveTopicDifficultyFromConfidence(confidence);
    const nextRevisionAt = fullUpdate ? fullUpdate.sm2.nextRevisionAt : topic.nextRevisionAt;
    // P4.1 (F6): with topic SM-2 retired, a graded warm-up no longer stops the
    // session from counting toward `revision_count`, which weakness reads.
    const countsAsRevision = !skipScheduling || this.config.flags.hideTopicRevision;
    const revisionCount = countsAsRevision ? topic.revisionCount + 1 : topic.revisionCount;

    const topicSnapshot: TopicSyncSnapshot = {
      confidence,
      revisionCount,
      lastRevised: session.date,
      nextRevisionAt,
      isWeakArea: weaknessUpdate.isWeak,
      status,
      difficulty,
    };

    const patch = {
      confidence,
      revisionCount,
      lastRevised: session.date,
      nextRevisionAt,
      ...(fullUpdate ? sm2TopicPatch(fullUpdate.sm2) : {}),
      isWeakArea: weaknessUpdate.isWeak,
      priorityScore: weaknessUpdate.score,
      status,
      difficulty,
    };

    return { patch, topicSnapshot };
  }

  /**
   * Called after the mistake-capture step (tags + "needed outside help"). The
   * session was saved with a provisional score; now the outcome is known, so
   * re-score the session and redo its effect on the topic from the saved
   * pre-session state.
   */
  async rescoreAfterMistakeCapture(attempt: AttemptRow): Promise<void> {
    if (!attempt.sessionId || !attempt.topicId) return;
    const session = this.sessionRepo.findById(attempt.sessionId);
    if (!session) return;
    const problem = this.problemRepo.findById(attempt.problemId);

    const score = deriveSessionOutcomeScore({
      durationMin: session.studyDuration ?? attempt.timeTaken ?? 1,
      difficulty: asDifficulty(problem?.difficulty),
      usedHelp: Boolean(attempt.usedCoach),
      hintCount: attempt.hintCount ?? 0,
      helpLevel: asHelpLevel(attempt.helpLevel),
      mistakeTags: parseMistakeTags(attempt.mistakeTag),
    });

    const previousScore = session.productivityScore ?? 0;
    if (score === previousScore) return;
    this.sessionRepo.update(session.id, { productivityScore: score });

    const topic = this.topicRepo.findById(attempt.topicId);
    if (!topic) return;

    let pre: SessionPreState | null = null;
    try {
      const raw = this.syncMetaRepo.get(preStateKey(session.id));
      pre = raw ? (JSON.parse(raw) as SessionPreState) : null;
    } catch {
      pre = null;
    }

    const untouchedSince =
      pre != null && (topic.lastRevised?.getTime() ?? null) === pre.appliedAt;

    if (pre && untouchedSince) {
      // Redo the whole session effect from the saved pre-session state.
      const preTopic: TopicState = {
        ...topic,
        confidence: pre.confidence,
        revisionCount: pre.revisionCount,
        lastRevised: pre.lastRevised != null ? new Date(pre.lastRevised) : null,
        nextRevisionAt: pre.nextRevisionAt != null ? new Date(pre.nextRevisionAt) : null,
        sm2Interval: pre.sm2Interval,
        sm2Repetition: pre.sm2Repetition,
        sm2Efactor: pre.sm2Efactor,
        isWeakArea: pre.isWeakArea,
        status: pre.status,
        difficulty: pre.difficulty,
        recentSessions: topic.recentSessions.filter(
          (s) => s.date.getTime() !== session.date,
        ),
      };
      const snapshot: SessionSnapshot = {
        date: new Date(session.date),
        problemsSolved: session.problemsSolved ?? 0,
        productivityScore: score,
        duration: session.studyDuration ?? 0,
      };
      const { patch, topicSnapshot } = this.applySessionToTopic(
        preTopic,
        snapshot,
        pre.skipScheduling,
      );
      this.topicRepo.update(attempt.topicId, patch);
      this.notionSync.markTopicDirty(attempt.topicId, topicSnapshot);
    } else {
      // Another session touched the topic since (or there is no snapshot for a
      // session logged before this feature): only correct confidence by the
      // difference between the new and the old score, leave the schedule alone.
      const delta = confidenceDeltaForScore(score) - confidenceDeltaForScore(previousScore);
      if (delta !== 0) {
        const confidence = Math.max(0, Math.min(100, topic.confidence + delta));
        this.topicRepo.update(attempt.topicId, {
          confidence,
          difficulty: deriveTopicDifficultyFromConfidence(confidence),
        });
        this.notionSync.markTopicDirty(attempt.topicId);
      }
    }

    await this.planService.invalidateTodaysPlan();
  }

  /**
   * Finalize problem status after mistake capture (1.4): tags → Revision needed,
   * smooth solve → Solved.
   */
  async finalizeProblemAfterMistake(
    problemId: string,
    tags: string[],
    attempt?: AttemptRow,
  ): Promise<void> {
    const problem = this.problemRepo.findById(problemId);
    if (!problem) return;
    // P6.1: approach help or a full solution also means "not clean yet".
    const level = this.config.flags.helpLevelCapture ? asHelpLevel(attempt?.helpLevel) : null;
    const needsRevision = level === "approach" || level === "solution";
    this.applyProblemStatus(problemId, tags, problem, needsRevision);
    // P4.2: tags and the help tick are known now — redo the re-solve's rating.
    if (attempt?.kind === "resolve" && this.config.flags.unifiedCompletion) {
      this.problemReviews?.completeAttempt(attempt);
    }
    // Tags recorded after the attempt can flip the admission decision (§4).
    this.problemReviews?.evaluateAdmission(problemId);
    await this.planService.invalidateTodaysPlan();
  }

  /**
   * One-time repair: problems tagged with mistakes on their latest attempt
   * should not stay Solved.
   */
  async repairProblemStatusesFromAttempts(): Promise<number> {
    const REPAIR_KEY = "problem_status_mistake_repair_v1";
    if (this.syncMetaRepo.get(REPAIR_KEY)) return 0;
    if (!this.attemptRepo) return 0;

    let repaired = 0;
    for (const problem of this.problemRepo.findAll()) {
      const [latest] = this.attemptRepo.findByProblemId(problem.id, 1);
      if (!latest) continue;
      const tags = parseMistakeTags(latest.mistakeTag);
      if (tags.length > 0 && problem.status !== "Revision needed") {
        this.applyProblemStatus(problem.id, tags, problem);
        repaired++;
      }
    }
    this.syncMetaRepo.set(REPAIR_KEY, "1");
    if (repaired > 0) {
      await this.planService.invalidateTodaysPlan();
    }
    return repaired;
  }

  private applyProblemStatus(
    problemId: string,
    tags: string[],
    current: ProblemRow,
    needsRevision = false,
  ): ProblemRow {
    const status = tags.length > 0 || needsRevision ? "Revision needed" : "Solved";
    const updated = this.problemRepo.update(problemId, { status });
    const row = updated ?? { ...current, status, updatedAt: Date.now() };
    this.notionSync.markProblemDirty(problemId, row);
    return row;
  }

  /**
   * Active-recall warm-up grade (3.1): feed an explicit SM-2 quality (0–5)
   * for a topic — a cleaner scheduling signal than productivity inference.
   */
  applyRecallQuality(topicId: string, quality: number): RecallResult {
    const topic = this.topicRepo.findById(topicId);
    if (!topic) {
      throw new Error(`Topic not found: ${topicId}`);
    }
    const clamped = Math.max(0, Math.min(5, Math.round(quality)));
    const sm2 = this.intelligence.applyRecallQuality(topic, clamped);
    const now = new Date();

    this.topicRepo.update(topicId, {
      revisionCount: topic.revisionCount + 1,
      lastRevised: now,
      ...sm2TopicPatch(sm2),
    });
    markWarmupSrsApplied(this.syncMetaRepo, topicId);
    this.notionSync.markTopicDirty(topicId);

    return {
      topicId,
      quality: clamped,
      nextRevisionAt: sm2.nextRevisionAt.toISOString(),
      intervalDays: sm2.interval,
    };
  }

  update(id: string, patch: UpdateSessionInput): SessionRow | null {
    const existing = this.sessionRepo.findById(id);
    if (!existing) return null;

    const studyDuration = patch.studyDuration ?? existing.studyDuration ?? 1;
    // A logged-problem session keeps its outcome-based score (editing the
    // duration must not turn it back into a length-based one); only sessions
    // with no attempt fall back to the capped duration score.
    const linkedAttempt = this.attemptRepo?.findBySessionId(id) ?? null;
    let productivityScore = patch.productivityScore ?? existing.productivityScore ?? 0;
    if (patch.productivityScore == null) {
      if (linkedAttempt) {
        productivityScore = deriveSessionOutcomeScore({
          durationMin: studyDuration,
          difficulty: asDifficulty(this.problemRepo.findById(linkedAttempt.problemId)?.difficulty),
          usedHelp: Boolean(linkedAttempt.usedCoach),
          hintCount: linkedAttempt.hintCount ?? 0,
          helpLevel: asHelpLevel(linkedAttempt.helpLevel),
          mistakeTags: parseMistakeTags(linkedAttempt.mistakeTag),
        });
      } else if (patch.studyDuration != null) {
        productivityScore = Math.min(
          NO_PROBLEM_SCORE_CAP,
          deriveProductivityFromDuration(studyDuration),
        );
      }
    }
    return this.sessionRepo.update(id, {
      ...patch,
      studyDuration,
      productivityScore,
    });
  }

  delete(id: string): boolean {
    return this.sessionRepo.delete(id);
  }

  private async pushSessionToNotion(session: SessionRow): Promise<void> {
    if (!session.topicId || !this.notionSync.isConfigured()) return;
    const { sessionsDbId } = this.config.notion;
    if (!sessionsDbId) return;

    await this.notionSync.getClient().createSession(sessionsDbId, {
      date: new Date(session.date),
      topicId: session.topicId,
      problemsSolved: session.problemsSolved ?? 0,
      studyDuration: session.studyDuration ?? 0,
      productivityScore: session.productivityScore ?? 0,
    });
  }
}

function sm2TopicPatch(sm2: SM2State) {
  return {
    sm2Interval: sm2.interval,
    sm2Repetition: sm2.repetition,
    sm2Efactor: sm2.efactor,
    nextRevisionAt: sm2.nextRevisionAt,
  };
}

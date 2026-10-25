import type {
  IntelligenceOrchestrator,
  PlanOptions,
  ResolvePlanSlot,
  RevisionProblem,
  StudyPlan,
  TodayQueuePick,
  TopicState,
  TwoLoopDay,
} from "@dsa/intelligence";
import {
  buildFocusPlan,
  buildTodayQueue,
  computePriorityScore,
  selectTwoLoopDay,
} from "@dsa/intelligence";
import type { AttemptRepository } from "../repositories/AttemptRepository.js";
import type { ProblemReviewRepository } from "../repositories/ProblemReviewRepository.js";
import type { ProblemRepository } from "../repositories/ProblemRepository.js";
import type { SessionRepository } from "../repositories/SessionRepository.js";
import type { TopicRepository } from "../repositories/TopicRepository.js";
import { dayKeyInTimeZone, learnerTimeZone } from "../lib/dayKey.js";
import { formatDateKey } from "../lib/json.js";
import type { CacheService } from "./CacheService.js";
import type { CurriculumService } from "./CurriculumService.js";
import { asDifficulty, ProblemSuggestionService } from "./ProblemSuggestionService.js";
import { resolveSlotMinutes, type ProblemReviewService } from "./ProblemReviewService.js";
import { buildTwoLoopInput, PICK_REASONS } from "./two-loop-input.js";

export class PlanService {
  private readonly problemSuggestions: ProblemSuggestionService;

  constructor(
    private readonly intelligence: IntelligenceOrchestrator,
    private readonly topicRepo: TopicRepository,
    private readonly problemRepo: ProblemRepository,
    private readonly cache: CacheService,
    private readonly curriculumService: CurriculumService,
    private readonly problemReviews?: ProblemReviewService,
    /** Session history for the focus plan's weekly target and gap detection. */
    private readonly sessionRepo?: SessionRepository,
    private readonly configuredTimeZone?: string,
    /** Overhaul flags this service reads (P4.3, P7.5). */
    private readonly flags: {
      hideTopicRevision?: boolean;
      todayQueueV2?: boolean;
      curriculumV2?: boolean;
      spiralPasses?: boolean;
    } = {},
    /** P7.5: history the two-loop selector reads. */
    private readonly twoLoopRepos: {
      attemptRepo?: AttemptRepository;
      problemReviewRepo?: ProblemReviewRepository;
    } = {},
  ) {
    this.problemSuggestions = new ProblemSuggestionService(problemRepo);
  }

  async generateTodaysPlan(options: PlanOptions = {}): Promise<StudyPlan> {
    const cacheKey = `plan:${formatDateKey(new Date())}`;
    try {
      const cached = await this.cache.get<StudyPlan>(cacheKey);
      if (cached) return cached;
    } catch {
      // cache is best-effort — continue without it
    }

    const topics = this.topicRepo.findAll();
    if (topics.length === 0) {
      throw new Error("No topics in mirror. Run sync or db:seed first.");
    }

    const plan = this.buildPlan(topics, options, {
      rescheduleDeferred: true,
    });

    try {
      await this.cache.set(cacheKey, plan, 3600);
    } catch {
      // cache is best-effort
    }
    return plan;
  }

  buildPlan(
    topics: TopicState[],
    options: PlanOptions = {},
    internal: { rescheduleDeferred?: boolean } = {},
  ): StudyPlan {
    const selection = this.curriculumService.selectForTopics(topics);
    if (!selection) {
      throw new Error("No topics available for planning");
    }

    // P7.5: the two-loop selector reads re-solves as stored, before today's
    // overflow is pushed forward, so a consolidation day can see the backlog.
    // On its block days the block's pattern is the plan's primary topic, so
    // the hero, warm-up, coach and nav agree with the queue.
    const twoLoop = this.selectTwoLoop(topics);
    const primaryTopic =
      (twoLoop?.blockTopicId ? topics.find((t) => t.id === twoLoop.blockTopicId) : undefined) ??
      selection.topic;
    const difficultyRec = this.intelligence.getDifficultyRecommendation(primaryTopic);
    const suggestedProblems = this.problemSuggestions.selectForTopic(
      primaryTopic,
      difficultyRec,
    );

    // P4.3 (verification.md F1–F3): with topic SM-2 retired there is no topic
    // revision queue, so nothing is deferred (no nextRevisionAt write) and no
    // revision minutes are budgeted. Due re-solves come from problem FSRS below.
    const queue = this.flags.hideTopicRevision
      ? []
      : this.intelligence.getRevisionQueue(topics).filter((t) => t.id !== primaryTopic.id);

    // Catch-up compression (1.5): after skipped days, never stack the whole
    // backlog into one plan — keep 1–2 items and push the rest forward.
    const { active, deferred } = this.intelligence.compressRevisionQueue(queue, {
      maxPerDay: options.maxRevisionTopics ?? 2,
    });
    const scored = active.slice(0, options.maxRevisionTopics ?? 2);

    if (internal.rescheduleDeferred && deferred.length > 0) {
      this.topicRepo.bulkUpdate(
        deferred.map(({ topic, nextRevisionAt }) => ({
          id: topic.id,
          patch: { nextRevisionAt },
        })),
      );
    }

    // Re-solve slots (re-solve design §6): additive to the primary topic's new
    // problems, capacity-fitted, overflow deferred forward like compressQueue.
    const preferProblemIds = twoLoop?.resolveTopicId
      ? new Set(
          this.problemRepo
            .findAll()
            .filter((p) => p.topicId === twoLoop.resolveTopicId)
            .map((p) => p.id),
        )
      : undefined;

    let resolveSlots: ResolvePlanSlot[] = [];
    let resolveTotalDue = 0;
    let resolveDeferred = 0;
    if (this.problemReviews) {
      const selection = this.problemReviews.dueSlots(Date.now(), {
        persistDeferrals: internal.rescheduleDeferred,
        preferProblemIds,
      });
      resolveSlots = selection.slots;
      resolveTotalDue = selection.totalDue;
      resolveDeferred = selection.deferredCount;
    }

    let estimatedDuration =
      this.estimateDuration(primaryTopic, scored) +
      resolveSlots.reduce((n, s) => n + resolveSlotMinutes(s.difficulty), 0);

    // Over daily budget → drop re-solve slots first (§6); new learning keeps
    // priority. Escalation promotions are the one thing not allowed to drop.
    if (options.availableMinutes != null) {
      while (
        estimatedDuration > options.availableMinutes &&
        resolveSlots.some((s) => !s.promoted)
      ) {
        const dropped = resolveSlots.pop()!;
        estimatedDuration -= resolveSlotMinutes(dropped.difficulty);
        resolveDeferred += 1;
      }
    }
    const topicsMap = new Map(topics.map((t) => [t.id, t]));
    const primaryScore = computePriorityScore(primaryTopic, topicsMap);
    const divergentTopics = topics
      .map((t) => ({ topic: t, score: computePriorityScore(t, topicsMap) }))
      .filter((s) => s.score.memoryExecutionDivergence)
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, 5)
      .map((s) => ({ id: s.topic.id, name: s.topic.name }));

    let reasoning = twoLoop ? twoLoop.why : selection.reasoning;
    if (primaryScore.memoryExecutionDivergence) {
      // P4.1 (F5): under FSRS urgency there is no review date to point at.
      reasoning += primaryTopic.resolveDueAt
        ? " No re-solve is due, but execution is still weak — practice anyway."
        : " Recall looks fine but execution is weak — practice anyway despite a far-out review date.";
    }
    for (const slot of resolveSlots.filter((s) => s.promoted)) {
      reasoning += ` Re-solve promoted: ${slot.name} is ${slot.daysOverdue} days overdue.`;
    }

    const days = this.dayKeys();
    const focus = this.buildFocus(topics, primaryTopic, suggestedProblems, resolveSlots, options, days);
    const curriculum = this.curriculumService.toProgress(selection);

    // P5.1: Today's single ordered list (todayQueueV2). Without the two-loop
    // selector every day is a block day for the primary topic (P3.4).
    let todayQueue: StudyPlan["queue"];
    if (twoLoop) {
      todayQueue = this.buildTwoLoopQueue(twoLoop, topics, resolveSlots, days, options);
    } else if (this.flags.todayQueueV2) {
      const item = curriculum?.items.find((i) => i.topicId === primaryTopic.id);
      todayQueue = buildTodayQueue({
        todayKey: days.todayKey,
        activeDayKeys: days.activeDayKeys,
        dueResolves: resolveSlots,
        newProblems: suggestedProblems,
        topic: {
          id: primaryTopic.id,
          name: primaryTopic.name,
          stage: difficultyRec.stage ?? null,
          covered: item ? item.totalCount - item.unsolvedCount : 0,
          total: item?.totalCount ?? 0,
        },
        why: reasoning,
        progressionReason: difficultyRec.reason,
        minutes: options.availableMinutes,
        weeklyTarget: options.weeklyTarget,
      });
    }

    return {
      date: new Date(),
      primaryTopic,
      revisionTopics: scored,
      revisionProblems: this.selectRevisionProblems(scored),
      suggestedProblems,
      estimatedDuration,
      reasoning,
      curriculum,
      revisionTotalDue: queue.length,
      revisionDeferred: deferred.length,
      memoryExecutionDivergence: primaryScore.memoryExecutionDivergence,
      divergentTopics,
      resolveSlots,
      resolveTotalDue,
      resolveDeferred,
      focus,
      ...(todayQueue ? { queue: todayQueue } : {}),
    };
  }

  /**
   * P7.5: the two-loop selector (P7.4) when `curriculumV2` and `spiralPasses`
   * are on. Its picks reach the learner through the Today queue, so it also
   * needs `todayQueueV2`; otherwise null and the P3.4 path stands.
   */
  private selectTwoLoop(topics: TopicState[]): TwoLoopDay | null {
    const { attemptRepo, problemReviewRepo } = this.twoLoopRepos;
    if (
      !this.flags.todayQueueV2 ||
      !this.flags.curriculumV2 ||
      !this.flags.spiralPasses ||
      !attemptRepo ||
      !problemReviewRepo
    ) {
      return null;
    }
    return selectTwoLoopDay(
      buildTwoLoopInput({
        topics,
        problems: this.problemRepo.findAll(),
        attempts: attemptRepo.findAll(),
        reviews: problemReviewRepo.all(),
        pinnedTopicId: this.curriculumService.getConfig().activeTopicId ?? null,
        now: Date.now(),
        timeZone: learnerTimeZone(this.configuredTimeZone),
      }),
    );
  }

  private buildTwoLoopQueue(
    day: TwoLoopDay,
    topics: TopicState[],
    resolveSlots: ResolvePlanSlot[],
    days: { todayKey: string; activeDayKeys: string[] },
    options: PlanOptions,
  ): StudyPlan["queue"] {
    const problems = new Map(this.problemRepo.findAll().map((p) => [p.id, p]));
    const topicsById = new Map(topics.map((t) => [t.id, t]));
    const picks: TodayQueuePick[] = day.picks.flatMap((pick) => {
      const row = problems.get(pick.problemId);
      if (!row) return [];
      return [
        {
          problem: {
            problemId: row.id,
            name: row.name,
            difficulty: asDifficulty(row.difficulty) ?? "Medium",
            leetcodeLink: row.leetcodeLink ?? undefined,
          },
          topicId: pick.topicId,
          revealPattern: pick.revealPattern,
          ...(pick.revealPattern ? { topicName: topicsById.get(pick.topicId)?.name } : {}),
          reason: PICK_REASONS[pick.role],
          keep: pick.role === "basic",
        },
      ];
    });
    const blockTopic = day.blockTopicId ? topicsById.get(day.blockTopicId) : undefined;
    const blockPass = day.passes.find((p) => p.topicId === day.blockTopicId);
    return buildTodayQueue({
      todayKey: days.todayKey,
      activeDayKeys: days.activeDayKeys,
      dueResolves: resolveSlots,
      newProblems: [],
      picks,
      preferResolveTopicId: day.resolveTopicId,
      dayKind: day.dayKind,
      topic: blockTopic
        ? {
            id: blockTopic.id,
            name: blockTopic.name,
            stage: this.intelligence.getDifficultyRecommendation(blockTopic).stage ?? null,
            covered: blockPass?.pass1.covered ?? 0,
            total: blockPass?.pass1.total ?? 0,
          }
        : { id: "", name: "", stage: null, covered: 0, total: 0 },
      why: day.why,
      mixedWhy: day.why,
      minutes: options.availableMinutes,
      weeklyTarget: options.weeklyTarget,
    });
  }

  /** Today's date and the days with a logged session, in the learner's timezone. */
  private dayKeys(): { todayKey: string; activeDayKeys: string[] } {
    const timeZone = learnerTimeZone(this.configuredTimeZone);
    return {
      todayKey: dayKeyInTimeZone(Date.now(), timeZone),
      activeDayKeys: [
        ...new Set(
          (this.sessionRepo?.findAll(400) ?? []).map((s) => dayKeyInTimeZone(s.date, timeZone)),
        ),
      ],
    };
  }

  /** The one-screen "do this now" plan: due re-solves, then new material, sized to the day. */
  private buildFocus(
    topics: TopicState[],
    primaryTopic: TopicState,
    suggestedProblems: StudyPlan["suggestedProblems"],
    resolveSlots: ResolvePlanSlot[],
    options: PlanOptions,
    days: { todayKey: string; activeDayKeys: string[] },
  ): StudyPlan["focus"] {
    const { activeDayKeys } = days;

    // Most repeated mistake across ALL topics — off-by-one hurts everywhere.
    const totals = new Map<string, number>();
    for (const t of topics) {
      for (const [tag, n] of Object.entries(t.mistakeTagCounts ?? {})) {
        if (tag === "could-not-solve") continue;
        totals.set(tag, (totals.get(tag) ?? 0) + n);
      }
    }
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];

    return buildFocusPlan({
      todayKey: days.todayKey,
      activeDayKeys,
      dueResolves: resolveSlots,
      newProblems: suggestedProblems,
      primaryTopicName: primaryTopic.name,
      topMistake: top ? { tag: top[0], count: top[1] } : null,
      minutes: options.availableMinutes,
      weeklyTarget: options.weeklyTarget,
    });
  }

  /**
   * One concrete solved problem per due revision topic (max 2/day via the
   * already-compressed `scored` list) — clickable revision instead of bare
   * topic names. Never takes the new-problem slot.
   */
  private selectRevisionProblems(scored: TopicState[]): RevisionProblem[] {
    const picks: RevisionProblem[] = [];
    for (const topic of scored) {
      const problem = this.problemRepo.findSolvedByTopicId(topic.id, { limit: 1 })[0];
      if (!problem) continue;
      picks.push({
        problemId: problem.id,
        name: problem.name,
        difficulty: asDifficulty(problem.difficulty),
        leetcodeLink: problem.leetcodeLink ?? undefined,
        topicId: topic.id,
        topicName: topic.name,
        mode: topic.isWeakArea || topic.confidence < 40 ? "resolve" : "recall",
      });
    }
    return picks;
  }

  private estimateDuration(primary: TopicState, revisions: TopicState[]): number {
    const base = 45 + (100 - primary.confidence) * 0.3;
    const revisionMinutes = revisions.length * 25;
    return Math.round(base + revisionMinutes);
  }

  async invalidateTodaysPlan(): Promise<void> {
    try {
      await this.cache.del(`plan:${formatDateKey(new Date())}`);
    } catch {
      // cache is best-effort
    }
  }
}

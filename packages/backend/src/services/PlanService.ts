import type {
  IntelligenceOrchestrator,
  PlanOptions,
  ResolvePlanSlot,
  RevisionProblem,
  StudyPlan,
  TopicState,
} from "@dsa/intelligence";
import { buildFocusPlan, computePriorityScore } from "@dsa/intelligence";
import type { ProblemRepository } from "../repositories/ProblemRepository.js";
import type { SessionRepository } from "../repositories/SessionRepository.js";
import type { TopicRepository } from "../repositories/TopicRepository.js";
import { dayKeyInTimeZone, learnerTimeZone } from "../lib/dayKey.js";
import { formatDateKey } from "../lib/json.js";
import type { CacheService } from "./CacheService.js";
import type { CurriculumService } from "./CurriculumService.js";
import { asDifficulty, ProblemSuggestionService } from "./ProblemSuggestionService.js";
import { resolveSlotMinutes, type ProblemReviewService } from "./ProblemReviewService.js";

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
    /** Overhaul flags this service reads (P4.3). */
    private readonly flags: { hideTopicRevision?: boolean } = {},
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

    const primaryTopic = selection.topic;
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
    let resolveSlots: ResolvePlanSlot[] = [];
    let resolveTotalDue = 0;
    let resolveDeferred = 0;
    if (this.problemReviews) {
      const selection = this.problemReviews.dueSlots(Date.now(), {
        persistDeferrals: internal.rescheduleDeferred,
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

    let reasoning = selection.reasoning;
    if (primaryScore.memoryExecutionDivergence) {
      // P4.1 (F5): under FSRS urgency there is no review date to point at.
      reasoning += primaryTopic.resolveDueAt
        ? " No re-solve is due, but execution is still weak — practice anyway."
        : " Recall looks fine but execution is weak — practice anyway despite a far-out review date.";
    }
    for (const slot of resolveSlots.filter((s) => s.promoted)) {
      reasoning += ` Re-solve promoted: ${slot.name} is ${slot.daysOverdue} days overdue.`;
    }

    const focus = this.buildFocus(topics, primaryTopic, suggestedProblems, resolveSlots, options);

    return {
      date: new Date(),
      primaryTopic,
      revisionTopics: scored,
      revisionProblems: this.selectRevisionProblems(scored),
      suggestedProblems,
      estimatedDuration,
      reasoning,
      curriculum: this.curriculumService.toProgress(selection),
      revisionTotalDue: queue.length,
      revisionDeferred: deferred.length,
      memoryExecutionDivergence: primaryScore.memoryExecutionDivergence,
      divergentTopics,
      resolveSlots,
      resolveTotalDue,
      resolveDeferred,
      focus,
    };
  }

  /** The one-screen "do this now" plan: due re-solves, then new material, sized to the day. */
  private buildFocus(
    topics: TopicState[],
    primaryTopic: TopicState,
    suggestedProblems: StudyPlan["suggestedProblems"],
    resolveSlots: ResolvePlanSlot[],
    options: PlanOptions,
  ): StudyPlan["focus"] {
    const timeZone = learnerTimeZone(this.configuredTimeZone);
    const activeDayKeys = [
      ...new Set(
        (this.sessionRepo?.findAll(400) ?? []).map((s) => dayKeyInTimeZone(s.date, timeZone)),
      ),
    ];

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
      todayKey: dayKeyInTimeZone(Date.now(), timeZone),
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

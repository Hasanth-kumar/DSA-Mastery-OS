import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { CheckCircleIcon, EmptyState } from "../components/EmptyState.js";
import { FocusCard } from "../components/FocusCard.js";
import { MasteryRing } from "../components/MasteryRing.js";
import { MistakeCapture } from "../components/MistakeCapture.js";
import { MistakeCaptureV2 } from "../components/MistakeCaptureV2.js";
import { PageHeader } from "../components/PageHeader.js";
import { ProblemNotePanel } from "../components/ProblemNotePanel.js";
import { ResolveTodaySection, type UnifiedResolveFlow } from "../components/ResolveTodaySection.js";
import { RevisionGradeButtons } from "../components/RevisionGradeButtons.js";
import { ScoreBar } from "../components/ScoreBar.js";
import {
  SESSION_STEPS,
  SESSION_STEPS_REVISE,
  SessionProgress,
} from "../components/SessionProgress.js";
import { Skeleton, SkeletonLines, SkeletonRows } from "../components/Skeleton.js";
import { UpNextTimeline } from "../components/UpNextTimeline.js";
import { WarmupCard } from "../components/WarmupCard.js";
import { useAppPreferences } from "../hooks/useAppPreferences.js";
import { usePolling } from "../hooks/usePolling.js";
import { formatRelativeTime } from "../lib/formatRelative.js";
import { formatTodayDate } from "../lib/greeting.js";
import {
  loadStarts,
  saveStarts,
  sessionsThisMonth,
  studyHoursThisMonth,
} from "../lib/todayStats.js";
import type {
  FeatureFlags,
  Problem,
  ProblemNote,
  RecallGradeResult,
  RevisionProblem,
  ScoreExplanation,
  Topic,
} from "../types/api.js";

const PLAN_POLL_MS = 60_000;

/** One row of the Suggested problems list: a queue block (P5.2) or a legacy suggestion. */
interface TodayRow {
  problemId: string;
  name: string;
  difficulty: string | null;
  leetcodeLink?: string | null;
  /** null: let the backend use the problem's own topic (hidden-pattern rows). */
  topicId?: string | null;
  kind: "resolve" | "progression";
  revealPattern: boolean;
  reason?: string;
  dueSince?: string;
  /** P6.2: the last takeaway, shown on a re-solve as a reminder. */
  takeaway?: string;
}

const STAGE_LABEL: Record<string, string> = {
  learning: "Learning",
  practicing: "Practicing",
  retaining: "Retaining",
};

/** "2026-10-20" → "Oct 20" (calendar date, no timezone shift). */
function formatDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const FLAGS_OFF: FeatureFlags = {
  todayQueueV2: false,
  unifiedCompletion: false,
  hideTopicRevision: false,
  helpLevelCapture: false,
  takeawayField: false,
  curriculumV2: false,
  spiralPasses: false,
};
const SESSIONS_POLL_MS = 60_000;
/** Date marker — once graded or skipped, the revision offer never nags again that day (C). */
const REVISION_OFFER_KEY = "dsa-revision-offer-day";
const DEFAULT_MINUTES = 25;

interface Props {
  onOpenCoach: (problemId: string, options?: { hidePattern?: boolean }) => void;
}

type Flow =
  | { kind: "idle" }
  | { kind: "warmup" }
  | {
      kind: "mistake";
      attemptId: string;
      problemId: string;
      problemName: string;
      usedCoach?: boolean;
      /** P6.1: the row's pattern was hidden, so capture asks for a guess first. */
      hiddenPattern?: boolean;
    }
  | { kind: "note-offer"; problemId: string; problemName: string }
  | { kind: "revision-offer"; problem: RevisionProblem }
  | { kind: "revision-active"; problem: RevisionProblem };

export function TodayPage({ onOpenCoach }: Props) {
  const { focusMode } = useAppPreferences();
  const fetchPlan = useCallback(() => api.getPlan(), []);
  const { data: plan, error, loading, refresh } = usePolling(fetchPlan, PLAN_POLL_MS);

  const fetchSessions = useCallback(
    () => api.getSessions(100).then((r) => r.sessions),
    [],
  );
  const { data: sessions } = usePolling(fetchSessions, SESSIONS_POLL_MS, {
    initialLoading: false,
  });

  const fetchTopics = useCallback(() => api.getTopics(), []);
  const { data: topicsData } = usePolling(fetchTopics, PLAN_POLL_MS, {
    initialLoading: false,
  });

  const fetchStreak = useCallback(() => api.getStreak(), []);
  const { data: streak } = usePolling(fetchStreak, PLAN_POLL_MS, { initialLoading: false });

  const fetchDashboard = useCallback(() => api.getDashboard(4), []);
  const { data: dashboard } = usePolling(fetchDashboard, PLAN_POLL_MS, {
    initialLoading: false,
  });

  const fetchSync = useCallback(() => api.getSyncStatus(), []);
  const { data: sync } = usePolling(fetchSync, PLAN_POLL_MS, { initialLoading: false });

  // Overhaul flags. `null` until loaded; a failed fetch means "all off" (live behavior).
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  useEffect(() => {
    api
      .getFlags()
      .then(setFlags)
      .catch(() => setFlags({ ...FLAGS_OFF }));
  }, []);
  // P4.3: with topic SM-2 retired, no Revision column and no post-solve revision
  // offer. Hidden until the flags arrive so the overhaul build never flashes it.
  const showTopicRevision = flags != null && !flags.hideTopicRevision;

  const [flow, setFlow] = useState<Flow>({ kind: "idle" });
  const [starts, setStarts] = useState<Record<string, number>>(loadStarts);
  // One problem at a time (todayQueueV2): starting one locks the others until
  // it is Done or its timer is stopped. The running one is the latest start.
  const singleActive = flags?.todayQueueV2 === true;
  const activeId = singleActive
    ? (Object.entries(starts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null)
    : null;

  // P5.2: with todayQueueV2 the queue is the one list of problems on Today.
  const queue = flags?.todayQueueV2 ? plan?.queue : undefined;
  const mixedDay = queue?.dayKind === "mixed";
  const rows: TodayRow[] = queue
    ? queue.blocks.map((b) => ({ ...b, topicId: b.topicId }))
    : (plan?.suggestedProblems.slice(0, 3) ?? []).map((p) => ({
        problemId: p.problemId,
        name: p.name,
        difficulty: p.difficulty,
        leetcodeLink: p.leetcodeLink,
        kind: "progression" as const,
        revealPattern: true,
      }));

  // P5.3 strip: problem counts (only fetched with the queue on).
  const fetchProblemList = useCallback(
    (): Promise<Problem[] | null> =>
      flags?.todayQueueV2 ? api.getProblems().then((r) => r.problems) : Promise.resolve(null),
    [flags?.todayQueueV2],
  );
  const { data: problemList } = usePolling(fetchProblemList, PLAN_POLL_MS, {
    initialLoading: false,
  });
  const [notes, setNotes] = useState<Record<string, ProblemNote>>({});
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [explain, setExplain] = useState<ScoreExplanation | null>(null);
  const [showExplain, setShowExplain] = useState(false);
  const [showAllRevisions, setShowAllRevisions] = useState(false);
  const [revisionQueue, setRevisionQueue] = useState<Topic[] | null>(null);
  const [revisionGrades, setRevisionGrades] = useState<Record<string, RecallGradeResult>>({});
  const [gradingTopic, setGradingTopic] = useState<string | null>(null);
  const [logging, setLogging] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [celebrateAt, setCelebrateAt] = useState<number | null>(null);
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [warmupGraded, setWarmupGraded] = useState(false);

  useEffect(() => {
    if (celebrateAt == null) return;
    const id = setTimeout(() => setCelebrateAt(null), 2800);
    return () => clearTimeout(id);
  }, [celebrateAt]);

  useEffect(() => {
    // Same as clicking "Start session" (rendered only while the flow is idle).
    const onStart = () =>
      document.querySelector<HTMLButtonElement>("[data-start-session='true']")?.click();
    const onFocusDone = () => {
      document.querySelector<HTMLButtonElement>("[data-done-button='true']")?.focus();
    };
    window.addEventListener("dsa:start-session", onStart);
    window.addEventListener("dsa:focus-done", onFocusDone);
    return () => {
      window.removeEventListener("dsa:start-session", onStart);
      window.removeEventListener("dsa:focus-done", onFocusDone);
    };
  }, []);

  useEffect(() => {
    if (!plan) return;
    let cancelled = false;
    void Promise.all(
      plan.suggestedProblems.map(async (p) => {
        try {
          const note = await api.getProblemNote(p.problemId);
          return [p.problemId, note] as const;
        } catch {
          return [p.problemId, null] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, ProblemNote> = {};
      for (const [id, note] of entries) {
        if (note) next[id] = note;
      }
      setNotes(next);
    });
    return () => {
      cancelled = true;
    };
  }, [plan]);

  // Drop start timers for problems that aren't on today's plan — leftover
  // localStorage entries were pinning the WARM-UP→FOCUS strip open forever.
  useEffect(() => {
    if (!plan) return;
    const allowed = new Set([
      ...plan.suggestedProblems.map((p) => p.problemId),
      // P4.2: a started re-solve keeps its timer too.
      ...(plan.resolveSlots ?? []).map((s) => s.problemId),
    ]);
    setStarts((prev) => {
      const next: Record<string, number> = {};
      for (const [id, startedAt] of Object.entries(prev)) {
        if (allowed.has(id)) next[id] = startedAt;
      }
      // One problem at a time: older timers from before the rule keep only the latest.
      if (singleActive) {
        const latest = Object.entries(next).sort((a, b) => b[1] - a[1])[0];
        for (const id of Object.keys(next)) if (id !== latest?.[0]) delete next[id];
      }
      if (Object.keys(next).length === Object.keys(prev).length) return prev;
      saveStarts(next);
      return next;
    });
  }, [plan, singleActive]);

  const startProblem = (problemId: string) => {
    if (singleActive && activeId && activeId !== problemId) return;
    const next = singleActive
      ? { [problemId]: Date.now() }
      : { ...starts, [problemId]: Date.now() };
    setStarts(next);
    saveStarts(next);
  };

  /** Stop the running timer without logging (one-problem-at-a-time mode). */
  const stopProblem = (problemId: string) => {
    const next = { ...starts };
    delete next[problemId];
    setStarts(next);
    saveStarts(next);
  };

  /** Another problem is running, so this one can't be started or logged yet. */
  const blockedBy = (problemId: string): string | null => {
    if (!singleActive || !activeId || activeId === problemId) return null;
    return (
      plan?.suggestedProblems.find((p) => p.problemId === activeId)?.name ??
      plan?.resolveSlots?.find((s) => s.problemId === activeId)?.name ??
      "the running problem"
    );
  };

  const elapsedMinutes = (problemId: string): number | null => {
    const start = starts[problemId];
    if (!start) return null;
    return Math.max(1, Math.round((Date.now() - start) / 60_000));
  };

  const markDone = async (problemId: string, problemName: string, topicId?: string | null) => {
    if (!plan || logging) return;
    setLogging(problemId);
    setMessage(null);
    try {
      const minutes = elapsedMinutes(problemId) ?? DEFAULT_MINUTES;
      const result = await api.logSession({
        // null = hidden-pattern row: the backend takes the problem's own topic.
        topicId: topicId === null ? undefined : (topicId ?? plan.primaryTopic.id),
        problemId,
        studyDuration: minutes,
        warmupGraded,
      });
      const next = { ...starts };
      delete next[problemId];
      setStarts(next);
      saveStarts(next);

      if (result.attemptId) {
        setFlow({
          kind: "mistake",
          attemptId: result.attemptId,
          problemId,
          problemName,
          usedCoach: result.usedCoach,
          hiddenPattern: rows.find((r) => r.problemId === problemId)?.revealPattern === false,
        });
      } else {
        setMessage({ text: `Logged ${problemName} (${minutes} min).`, ok: true });
        setCelebrateAt(Date.now());
      }
      void refresh();
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : "Failed to log problem",
        ok: false,
      });
    } finally {
      setLogging(null);
    }
  };

  // P4.4 (D5): with `todayQueueV2` the flashcard warm-up is opt-in — "Start
  // session" goes straight to the first problem; "Warm up first" is a quiet link.
  const warmupOptIn = flags?.todayQueueV2 === true;
  const beginSession = (withWarmup: boolean) => {
    setCelebrateAt(null);
    setWarmupGraded(false);
    if (withWarmup) {
      setFlow({ kind: "warmup" });
      return;
    }
    const first = rows[0];
    if (!first || starts[first.problemId] || activeId) return;
    if (first.leetcodeLink) window.open(first.leetcodeLink, "_blank", "noopener,noreferrer");
    startProblem(first.problemId);
  };

  // P4.2 (`unifiedCompletion`): a re-solve logs like a new problem — Start opens
  // LeetCode and starts the timer, ✓ Done logs it, then MistakeCapture.
  const unifiedResolve: UnifiedResolveFlow | undefined = flags?.unifiedCompletion
    ? {
        startedAt: (problemId) => starts[problemId],
        elapsedMinutes,
        onStart: (slot) => {
          if (slot.leetcodeLink) window.open(slot.leetcodeLink, "_blank", "noopener,noreferrer");
          startProblem(slot.problemId);
        },
        onDone: (slot) => void markDone(slot.problemId, slot.name, slot.topicId ?? undefined),
        onStop: singleActive ? (slot) => stopProblem(slot.problemId) : undefined,
        blockedBy,
        loggingId: logging,
      }
    : undefined;

  /** One-tap SM-2 grade for a revision problem's topic (C). */
  const gradeRevisionProblem = async (p: RevisionProblem, quality: number) => {
    if (gradingTopic) return;
    setGradingTopic(p.topicId);
    setMessage(null);
    try {
      const result = await api.gradeRevision(p.topicId, quality);
      setRevisionGrades((g) => ({ ...g, [p.topicId]: result }));
      localStorage.setItem(REVISION_OFFER_KEY, new Date().toDateString());
      setMessage({
        text: `${p.topicName} revised — next review ${
          result.nextRevisionAt
            ? new Date(result.nextRevisionAt).toLocaleDateString()
            : "unscheduled"
        }.`,
        ok: true,
      });
      void refresh();
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : "Grade failed",
        ok: false,
      });
    } finally {
      setGradingTopic(null);
    }
  };

  /** After the capture chain: offer optional revision once per day (C). */
  const finishCapture = () => {
    setCelebrateAt(Date.now());
    const problem = showTopicRevision ? plan?.revisionProblems?.[0] : undefined;
    const today = new Date().toDateString();
    if (problem && localStorage.getItem(REVISION_OFFER_KEY) !== today) {
      setFlow({ kind: "revision-offer", problem });
    } else {
      setFlow({ kind: "idle" });
    }
  };

  const toggleExplain = async () => {
    if (showExplain) {
      setShowExplain(false);
      return;
    }
    setShowExplain(true);
    if (!explain && plan) {
      try {
        setExplain(await api.getScoreExplanation(plan.primaryTopic.id));
      } catch {
        // best-effort
      }
    }
  };

  const toggleAllRevisions = async () => {
    if (showAllRevisions) {
      setShowAllRevisions(false);
      return;
    }
    setShowAllRevisions(true);
    if (!revisionQueue) {
      try {
        const res = await api.getRevisionQueue();
        setRevisionQueue(res.queue);
      } catch {
        setRevisionQueue([]);
      }
    }
  };

  const runSync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      await api.triggerSync();
      setMessage({ text: "Notion sync complete.", ok: true });
      void refresh();
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : "Sync failed",
        ok: false,
      });
    } finally {
      setSyncing(false);
    }
  };

  // P5.3: "Switch pattern" pins a pattern (P3.3 expiry applies).
  const [switchingPattern, setSwitchingPattern] = useState(false);
  const switchPattern = async (topicId: string) => {
    setSwitchingPattern(false);
    if (!topicId) return;
    setMessage(null);
    try {
      await api.setCurriculumActiveTopic(topicId);
      void refresh();
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : "Could not switch pattern",
        ok: false,
      });
    }
  };

  const [unpinning, setUnpinning] = useState(false);
  const unpin = async () => {
    setUnpinning(true);
    setMessage(null);
    try {
      await api.setCurriculumActiveTopic(null);
      void refresh();
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : "Could not unpin",
        ok: false,
      });
    } finally {
      setUnpinning(false);
    }
  };

  const monthCount = useMemo(() => sessionsThisMonth(sessions ?? []), [sessions]);
  const monthHours = useMemo(() => studyHoursThisMonth(sessions ?? []), [sessions]);
  const dueTotal = plan?.revisionTotalDue ?? plan?.revisionTopics.length ?? 0;
  const topRevision = plan?.revisionTopics[0] ?? null;

  const topics = topicsData?.topics ?? [];
  const masteredCount = topics.filter((t) => t.status === "Mastered").length;
  const inProgressCount = topics.filter((t) => t.status === "In progress").length;
  const totalTopics = topics.length || 1;
  const masteryPct = Math.round((masteredCount / totalTopics) * 100);

  const summary = dashboard?.summary;
  const pace = summary?.problemsPerHour ?? 0;
  const paceTrend = summary?.velocityTrend;

  const hasStarts = Object.keys(starts).length > 0;
  const revisionFlow = flow.kind === "revision-offer" || flow.kind === "revision-active";
  const sessionStep =
    flow.kind === "warmup"
      ? 0
      : flow.kind === "mistake" || flow.kind === "note-offer"
        ? 2
        : revisionFlow
          ? 3
          : celebrateAt != null
            ? 3
            : hasStarts
              ? 1
              : -1;

  const curriculumItems = plan?.curriculum?.items ?? [];
  // P7.5: with the two-loop selector on, the old curriculum order (Up next,
  // "step N of M") no longer decides anything, and on a mixed day it would
  // name patterns, so neither is shown.
  const twoLoop = queue != null && flags?.curriculumV2 === true && flags?.spiralPasses === true;
  const showUpNext = !focusMode && !twoLoop && curriculumItems.length > 0;
  // Nothing left for the right column → the left column takes the full width.
  const showRightColumn = showTopicRevision || showUpNext;
  const curriculumStep = plan?.curriculum && !twoLoop
    ? `${plan.curriculum.currentIndex + 1} of ${plan.curriculum.topicNames.length}`
    : null;

  // P3.3: a manual pin is shown with its end date and can be removed in one tap.
  const pinnedTopicId = plan?.curriculum?.activeTopicId ?? null;
  const pinnedName = pinnedTopicId
    ? plan?.primaryTopic.id === pinnedTopicId
      ? plan.primaryTopic.name
      : (plan?.curriculum?.items.find((i) => i.topicId === pinnedTopicId)?.name ?? null)
    : null;
  const pinDaysLeft =
    pinnedTopicId && plan?.curriculum?.pinExpiresAt != null
      ? Math.max(1, Math.ceil((plan.curriculum.pinExpiresAt - Date.now()) / 86_400_000))
      : null;

  const syncLabel = syncing
    ? "Syncing…"
    : sync?.lastSyncAt
      ? `Synced ${formatRelativeTime(sync.lastSyncAt)}`
      : "Sync now";

  if (loading && !plan) {
    return (
      <div className="page-content">
        <PageHeader title="Today" subtitle="Loading your plan…" />
        <div aria-busy="true">
          <Skeleton variant="block" height={220} />
          <SkeletonRows rows={3} />
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="today-focus-meta">
        <div className="today-focus-meta-copy">
          <span className="today-focus-meta-kicker">Today&apos;s focus</span>
          <span className="today-focus-meta-rule" aria-hidden />
          <span className="today-focus-meta-date">
            {formatTodayDate()}
            {curriculumStep ? ` · step ${curriculumStep}` : ""}
          </span>
          {pinnedTopicId && (
            <>
              <span className="today-focus-meta-date">
                Pinned{pinnedName ? ` · ${pinnedName}` : ""}
                {pinDaysLeft != null ? ` · ${pinDaysLeft} day${pinDaysLeft === 1 ? "" : "s"} left` : ""}
              </span>
              <button
                type="button"
                className="today-sync-link"
                disabled={unpinning}
                onClick={() => void unpin()}
                title="Unpin and let the curriculum pick the next topic"
              >
                Unpin
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          className="today-sync-link"
          disabled={syncing}
          onClick={() => void runSync()}
          title="Sync with Notion now"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2v3h-3" />
          </svg>
          {syncLabel}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {message && (
        <div className={message.ok ? "success-banner" : "error-banner"}>{message.text}</div>
      )}

      {plan && (
        <>
          {sessionStep >= 0 && (
            <SessionProgress
              step={sessionStep}
              steps={revisionFlow ? SESSION_STEPS_REVISE : SESSION_STEPS}
            />
          )}

          {plan.focus && !queue && <FocusCard focus={plan.focus} />}

          <div className="focus-hero-wrap">
            <section className="focus-hero">
              <div>
                <div className="focus-hero-title-row">
                  <h2 className="focus-hero-title">
                    {mixedDay ? "Mixed practice" : plan.primaryTopic.name}
                  </h2>
                  {plan.memoryExecutionDivergence && !mixedDay && (
                    <span className="chip-v2">
                      <span className="chip-v2-dot" aria-hidden />
                      Recall ≠ execution
                    </span>
                  )}
                </div>
                <p className="focus-hero-reason">{queue ? queue.decision.why : plan.reasoning}</p>
                {queue && (
                  <p className="focus-hero-decision">
                    {mixedDay || !queue.decision.topic
                      ? `${rows.length} problem${rows.length === 1 ? "" : "s"} · ~${queue.totalMinutes} min`
                      : [
                          queue.decision.topic.stage ? STAGE_LABEL[queue.decision.topic.stage] : null,
                          queue.decision.topic.total > 0
                            ? `${queue.decision.topic.covered} of ${queue.decision.topic.total} covered`
                            : null,
                          `~${queue.totalMinutes} min`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                    {` · ${queue.decision.week.done} of ${queue.decision.week.target} sessions this week`}
                  </p>
                )}
                <div className="focus-hero-actions">
                  {flow.kind === "idle" && (
                    <button
                      type="button"
                      className="btn-primary-v2"
                      data-start-session="true"
                      onClick={() => beginSession(!warmupOptIn)}
                    >
                      <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                        <path d="M4 2.5v11l9-5.5z" />
                      </svg>
                      Start session
                    </button>
                  )}
                  {!mixedDay && (
                    <button type="button" className="btn-secondary-v2" onClick={() => void toggleExplain()}>
                      {showExplain ? "Hide" : "Why this?"}
                    </button>
                  )}
                  {queue && flow.kind === "idle" && (
                    switchingPattern ? (
                      <select
                        className="coach-select"
                        aria-label="Switch pattern"
                        autoFocus
                        defaultValue=""
                        onBlur={() => setSwitchingPattern(false)}
                        onChange={(e) => void switchPattern(e.target.value)}
                      >
                        <option value="" disabled>
                          Pick a pattern…
                        </option>
                        {[...topics]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <button
                        type="button"
                        className="today-show-more-link"
                        style={{ marginTop: 0 }}
                        title="Pin a pattern for up to 7 days"
                        onClick={() => setSwitchingPattern(true)}
                      >
                        Switch pattern
                      </button>
                    )
                  )}
                  {warmupOptIn ? (
                    // P7.5: warm-up cards are the topic's own, so a mixed day offers none.
                    flow.kind === "idle" && !mixedDay && (
                      <button
                        type="button"
                        className="today-show-more-link"
                        style={{ marginTop: 0 }}
                        onClick={() => beginSession(true)}
                      >
                        Warm up first · 3 cards
                      </button>
                    )
                  ) : (
                    <div className="warmup-queue-hint">
                      <span className="warmup-queue-dots" aria-hidden>
                        <span /><span /><span />
                      </span>
                      3 warm-up cards queued
                    </div>
                  )}
                </div>
                {showExplain && (
                  <div className="today-explain" style={{ marginTop: "1rem" }}>
                    {explain ? <ScoreBar explanation={explain} /> : <SkeletonLines lines={2} />}
                  </div>
                )}
              </div>
              <MasteryRing
                percent={masteryPct}
                sublabel={`${masteredCount}/${totalTopics}`}
              />
            </section>
          </div>

          {flow.kind === "warmup" && (
            <div style={{ marginBottom: "1.4rem" }}>
              <WarmupCard
                topicId={plan.primaryTopic.id}
                topicName={plan.primaryTopic.name}
                firstProblemUrl={rows[0]?.leetcodeLink ?? null}
                onComplete={(graded) => {
                  setWarmupGraded(graded);
                  setFlow({ kind: "idle" });
                  const first = rows[0];
                  if (first && !starts[first.problemId] && !activeId) startProblem(first.problemId);
                }}
              />
            </div>
          )}

          {flow.kind === "mistake" && (
            <div className="panel-v2 flow-reveal" style={{ marginBottom: "1.4rem" }}>
              {flags?.helpLevelCapture ? (
                <MistakeCaptureV2
                  attemptId={flow.attemptId}
                  problemName={flow.problemName}
                  usedCoach={flow.usedCoach}
                  // P6.1: on a hidden row, guess among the patterns already introduced
                  // (P7.5: a logged attempt or a covered problem, so a pattern started
                  // in its block is always on the list).
                  guessOptions={
                    flow.hiddenPattern
                      ? topics
                          .filter(
                            (t) =>
                              t.totalAttempts > 0 ||
                              (problemList ?? []).some(
                                (p) =>
                                  p.topicId === t.id &&
                                  (p.status === "Solved" || p.status === "Revision needed"),
                              ),
                          )
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((t) => ({ id: t.id, name: t.name }))
                      : undefined
                  }
                  takeawayField={flags.takeawayField}
                  onDone={() =>
                    setFlow({
                      kind: "note-offer",
                      problemId: flow.problemId,
                      problemName: flow.problemName,
                    })
                  }
                />
              ) : (
                <MistakeCapture
                  attemptId={flow.attemptId}
                  problemName={flow.problemName}
                  usedCoach={flow.usedCoach}
                  onDone={() =>
                    setFlow({
                      kind: "note-offer",
                      problemId: flow.problemId,
                      problemName: flow.problemName,
                    })
                  }
                />
              )}
            </div>
          )}

          {flow.kind === "note-offer" && (
            <div className="panel-v2 note-offer flow-reveal" style={{ marginBottom: "1.4rem" }}>
              <span>
                Capture your insight on <strong>{flow.problemName}</strong> in Obsidian?
              </span>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn-secondary-v2"
                  onClick={() => {
                    const problemId = flow.problemId;
                    finishCapture();
                    api
                      .createNoteTemplate(problemId)
                      .then((res) =>
                        setMessage({
                          text: res.created
                            ? `Note created in vault: ${res.path}`
                            : "Note not created",
                          ok: res.created,
                        }),
                      )
                      .catch((err) =>
                        setMessage({
                          text: err instanceof Error ? err.message : "Note creation failed",
                          ok: false,
                        }),
                      );
                  }}
                >
                  Create note
                </button>
                <button
                  type="button"
                  className="btn-ghost-v2"
                  onClick={() => finishCapture()}
                >
                  Skip
                </button>
              </div>
            </div>
          )}

          {flow.kind === "revision-offer" && (
            <div className="panel-v2 note-offer flow-reveal" style={{ marginBottom: "1.4rem" }}>
              <span>
                Optional: quick revision — <strong>{flow.problem.name}</strong> (
                {flow.problem.topicName}) ·{" "}
                {flow.problem.mode === "resolve" ? "full re-solve" : "~5 min recall"}.
              </span>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn-secondary-v2"
                  onClick={() => {
                    const p = flow.problem;
                    localStorage.setItem(REVISION_OFFER_KEY, new Date().toDateString());
                    if (p.leetcodeLink) {
                      window.open(p.leetcodeLink, "_blank", "noopener,noreferrer");
                    }
                    if (p.mode === "resolve") startProblem(p.problemId);
                    setFlow({ kind: "revision-active", problem: p });
                  }}
                >
                  Start
                </button>
                <button
                  type="button"
                  className="btn-ghost-v2"
                  onClick={() => {
                    localStorage.setItem(REVISION_OFFER_KEY, new Date().toDateString());
                    setFlow({ kind: "idle" });
                  }}
                >
                  Skip
                </button>
              </div>
            </div>
          )}

          {flow.kind === "revision-active" && (
            <div className="panel-v2 note-offer flow-reveal" style={{ marginBottom: "1.4rem" }}>
              <span>
                Revising <strong>{flow.problem.name}</strong> ({flow.problem.topicName}) —{" "}
                {flow.problem.mode === "resolve"
                  ? "mark done when re-solved."
                  : "grade your recall."}
              </span>
              {flow.problem.mode === "resolve" ? (
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn-done-v2"
                    disabled={logging === flow.problem.problemId}
                    onClick={() =>
                      void markDone(
                        flow.problem.problemId,
                        flow.problem.name,
                        flow.problem.topicId,
                      )
                    }
                  >
                    {logging === flow.problem.problemId ? "Saving…" : "✓ Done"}
                  </button>
                </div>
              ) : (
                <RevisionGradeButtons
                  busy={gradingTopic != null}
                  onGrade={(quality) => {
                    void gradeRevisionProblem(flow.problem, quality).then(() =>
                      setFlow({ kind: "idle" }),
                    );
                  }}
                />
              )}
            </div>
          )}

          {!focusMode && queue && (
            <section className="stats-strip">
              <div className="stats-strip-cell">
                <div className="stats-strip-label">Patterns</div>
                <div className="stats-strip-value">
                  {topics.filter((t) => t.totalAttempts > 0).length}
                  <span>/ {topics.length} touched</span>
                </div>
              </div>
              <div className="stats-strip-cell">
                <div className="stats-strip-label">Problems</div>
                <div className="stats-strip-value">
                  {problemList ? problemList.filter((p) => p.status !== "Not started").length : "–"}
                  <span>
                    attempted
                    {problemList && (
                      <>
                        {` · ${problemList.filter((p) => p.status === "Solved").length} clean · `}
                        <span style={{ whiteSpace: "nowrap", marginLeft: 0 }}>
                          {problemList.filter((p) => p.status === "Revision needed").length} to re-solve
                        </span>
                      </>
                    )}
                  </span>
                </div>
              </div>
              <div className="stats-strip-cell">
                <div className="stats-strip-label">This week</div>
                <div className="stats-strip-value">
                  {queue.decision.week.done}
                  <span>
                    / {queue.decision.week.target} sessions · {queue.decision.week.daysLeft} day
                    {queue.decision.week.daysLeft === 1 ? "" : "s"} left
                  </span>
                </div>
              </div>
              <div className="stats-strip-cell">
                <div className="stats-strip-label">Stage</div>
                <div className="stats-strip-value">
                  {mixedDay || !queue.decision.topic?.stage
                    ? "Mixed"
                    : STAGE_LABEL[queue.decision.topic.stage]}
                  <span>
                    {mixedDay || !queue.decision.topic
                      ? "patterns hidden today"
                      : `${queue.decision.topic.covered} / ${queue.decision.topic.total} covered`}
                  </span>
                </div>
              </div>
            </section>
          )}

          {!focusMode && !queue && (
            <section className="stats-strip">
              <div className="stats-strip-cell">
                <div className="stats-strip-label">Streak</div>
                <div className="stats-strip-value">
                  {streak?.currentStreakDays ?? 0}
                  <span>days · best {streak?.longestStreakDays ?? 0}</span>
                </div>
              </div>
              <div className="stats-strip-cell">
                <div className="stats-strip-label">This month</div>
                <div className="stats-strip-value">
                  {monthCount}
                  <span>sessions · {monthHours} hrs</span>
                </div>
              </div>
              <div className="stats-strip-cell">
                <div className="stats-strip-label">Pace</div>
                <div className="stats-strip-value">
                  {pace.toFixed(1)}
                  <span>
                    /hr · problems solved
                    {paceTrend === "up" ? " ▲" : ""}
                  </span>
                </div>
              </div>
              <div className="stats-strip-cell">
                <div className="stats-strip-label">Mastered</div>
                <div className="stats-strip-value">
                  {masteredCount}
                  <span>/ {totalTopics} · {inProgressCount} in progress</span>
                </div>
              </div>
            </section>
          )}

          <div className={showRightColumn ? "today-grid" : "today-grid today-grid--single"}>
            <div className="today-grid-col today-grid-col--left">
            <section>
              <div className="panel-v2-header">
                <h3 className="panel-v2-title">Suggested problems</h3>
                <span className="panel-v2-meta">
                  {queue ? `${rows.length} · ~${queue.totalMinutes} min` : `${rows.length} picked`}
                </span>
              </div>
              {rows.length === 0 && (
                <p className="muted text-sm">
                  {queue
                    ? "Nothing queued today."
                    : "No unsolved problems for this topic — add some in Notion or just revise."}
                </p>
              )}
              {rows.map((p, i) => {
                const started = starts[p.problemId] != null;
                const blocker = blockedBy(p.problemId);
                const lockedTitle = blocker ? `Finish or stop ${blocker} first` : undefined;
                // Hidden-pattern rows show no note: it may name the pattern (§6.4).
                const note = p.revealPattern ? notes[p.problemId] : undefined;
                const minutes = elapsedMinutes(p.problemId);
                const diffClass = `diff-${p.difficulty?.toLowerCase() ?? "medium"}`;
                return (
                  <div
                    key={p.problemId}
                    className={`problem-row-v2${started ? " problem-row-v2--active" : ""}${
                      blocker ? " problem-row-v2--locked" : ""
                    }`}
                  >
                    <span className="problem-row-index" aria-hidden>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {p.kind === "resolve" && (
                      <div className="problem-row-kicker">
                        Re-solve{p.dueSince ? ` · due since ${formatDayKey(p.dueSince)}` : ""}
                      </div>
                    )}
                    <div className="problem-row-top">
                      {p.leetcodeLink ? (
                        <a
                          href={p.leetcodeLink}
                          target="_blank"
                          rel="noreferrer"
                          className="problem-row-name"
                        >
                          {p.name}
                        </a>
                      ) : (
                        <span className="problem-row-name">{p.name}</span>
                      )}
                      <span className="problem-row-fill" aria-hidden />
                      <span className={`diff-badge ${diffClass}`}>
                        {(p.difficulty ?? "?").slice(0, 3).toUpperCase()}
                      </span>
                      {note && (
                        <button
                          type="button"
                          className="note-chip"
                          onClick={() =>
                            setOpenNoteId(openNoteId === p.problemId ? null : p.problemId)
                          }
                        >
                          note
                        </button>
                      )}
                      {started && minutes != null && (
                        <span className="problem-row-timer">
                          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6">
                            <circle cx="8" cy="8" r="6" />
                            <path d="M8 5v3l2 1.4" strokeLinecap="round" />
                          </svg>
                          {minutes} min
                        </span>
                      )}
                    </div>
                    {p.kind === "resolve" && p.reason && (
                      <p className="problem-row-reason">{p.reason}</p>
                    )}
                    {p.kind === "resolve" && p.takeaway && (
                      <p className="problem-row-reason problem-row-takeaway">
                        Last time: &ldquo;{p.takeaway}&rdquo;
                      </p>
                    )}
                    <div className="problem-row-actions">
                      {!started && (
                        <button
                          type="button"
                          className="btn-secondary-v2"
                          disabled={blocker != null}
                          title={lockedTitle}
                          onClick={() => {
                            if (p.leetcodeLink) {
                              window.open(p.leetcodeLink, "_blank", "noopener,noreferrer");
                            }
                            startProblem(p.problemId);
                          }}
                        >
                          Start
                        </button>
                      )}
                      <button
                        type="button"
                        className={`btn-done-v2${pulseId === p.problemId ? " btn--confirm-pulse" : ""}`}
                        data-done-button="true"
                        disabled={logging === p.problemId || blocker != null}
                        title={lockedTitle}
                        onClick={() => {
                          setPulseId(p.problemId);
                          void markDone(
                            p.problemId,
                            p.name,
                            queue ? (p.topicId ?? null) : undefined,
                          );
                        }}
                        onAnimationEnd={() =>
                          setPulseId((id) => (id === p.problemId ? null : id))
                        }
                      >
                        {logging === p.problemId ? "Saving…" : "✓ Done"}
                      </button>
                      {singleActive && started && (
                        <button
                          type="button"
                          className="btn-secondary-v2 btn-compact-v2"
                          onClick={() => stopProblem(p.problemId)}
                        >
                          Stop timer
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-ghost-v2 today-coach-btn"
                        onClick={() => onOpenCoach(p.problemId, { hidePattern: !p.revealPattern })}
                      >
                        Coach <span className="today-coach-arrow" aria-hidden>↗</span>
                      </button>
                    </div>
                    {openNoteId === p.problemId && note && <ProblemNotePanel note={note} />}
                  </div>
                );
              })}
            </section>

            {/* Committed re-solve slots (§10) — collapsed, never the full pool. */}
            {!queue && (
              <ResolveTodaySection
                slots={plan.resolveSlots ?? []}
                onChanged={() => void refresh()}
                unified={unifiedResolve}
              />
            )}
            </div>

            {showRightColumn && (
              <div className="today-grid-col today-grid-col--right">
                {showTopicRevision && (
                  <section className="revision-panel">
                    <div className="panel-v2-header">
                      <h3 className="panel-v2-title">Revision</h3>
                      <span className="panel-v2-meta">{dueTotal} due</span>
                    </div>
                    {dueTotal === 0 && (
                      <EmptyState
                        compact
                        icon={<CheckCircleIcon />}
                        title="Nothing due today"
                        hint="Spaced repetition is happy."
                      />
                    )}
                    {topRevision && (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.55rem" }}>
                          <span className="revision-hero-name">{topRevision.name}</span>
                          {topRevision.isWeakArea && <span className="weak-badge">WEAK</span>}
                        </div>
                        <div className="revision-progress">
                          <div className="revision-bar">
                            <div
                              className="revision-bar-fill"
                              style={{ width: `${topRevision.confidence}%` }}
                            />
                          </div>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--text-muted)" }}>
                            {topRevision.confidence}
                          </span>
                        </div>
                        <div className="revision-meta">
                          confidence ·{" "}
                          {topRevision.lastRevised
                            ? `last revised ${new Date(topRevision.lastRevised).toLocaleDateString()}`
                            : "never revised"}
                        </div>
                      </>
                    )}
                    {(plan.revisionProblems ?? []).map((p) => {
                      const graded = revisionGrades[p.topicId];
                      return (
                        <div key={p.problemId} className="revision-problem-row">
                          <div className="problem-row-top">
                            {p.leetcodeLink ? (
                              <a
                                href={p.leetcodeLink}
                                target="_blank"
                                rel="noreferrer"
                                className="problem-row-name"
                              >
                                {p.name}
                              </a>
                            ) : (
                              <span className="problem-row-name">{p.name}</span>
                            )}
                            <span
                              className={`diff-badge diff-${p.difficulty?.toLowerCase() ?? "medium"}`}
                            >
                              {(p.difficulty ?? "?").slice(0, 3).toUpperCase()}
                            </span>
                            <span className="chip-v2">
                              {p.mode === "resolve" ? "re-solve" : "recall"}
                            </span>
                          </div>
                          <div className="revision-meta">{p.topicName}</div>
                          {graded ? (
                            <div className="revision-meta">
                              next review{" "}
                              {graded.nextRevisionAt
                                ? new Date(graded.nextRevisionAt).toLocaleDateString()
                                : "unscheduled"}
                            </div>
                          ) : (
                            <RevisionGradeButtons
                              busy={gradingTopic != null}
                              onGrade={(quality) => void gradeRevisionProblem(p, quality)}
                            />
                          )}
                        </div>
                      );
                    })}
                    {dueTotal > 1 && (
                      <button
                        type="button"
                        className="today-show-more-link"
                        onClick={() => void toggleAllRevisions()}
                      >
                        {showAllRevisions ? "Show less" : `Show all ${dueTotal} →`}
                      </button>
                    )}
                    {showAllRevisions && revisionQueue && (
                      <ul className="today-revision-list">
                        {revisionQueue.map((t) => (
                          <li key={t.id}>
                            <span>{t.name}</span>
                            <span className="muted">
                              {t.nextRevisionAt
                                ? `due ${new Date(t.nextRevisionAt).toLocaleDateString()}`
                                : "never revised"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}

                {showUpNext && (
                  <section className="today-up-next">
                    <h3 className="panel-v2-title" style={{ marginBottom: "1.1rem" }}>
                      Up next
                    </h3>
                    <UpNextTimeline
                      items={curriculumItems}
                      startIndex={plan.curriculum?.currentIndex ?? 0}
                    />
                  </section>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

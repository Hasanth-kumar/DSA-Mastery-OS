import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { CheckCircleIcon, EmptyState } from "../components/EmptyState.js";
import { FocusCard } from "../components/FocusCard.js";
import { MasteryRing } from "../components/MasteryRing.js";
import { MistakeCapture } from "../components/MistakeCapture.js";
import { PageHeader } from "../components/PageHeader.js";
import { ProblemNotePanel } from "../components/ProblemNotePanel.js";
import { ResolveTodaySection } from "../components/ResolveTodaySection.js";
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
  ProblemNote,
  RecallGradeResult,
  RevisionProblem,
  ScoreExplanation,
  Topic,
} from "../types/api.js";

const PLAN_POLL_MS = 60_000;
const SESSIONS_POLL_MS = 60_000;
/** Date marker — once graded or skipped, the revision offer never nags again that day (C). */
const REVISION_OFFER_KEY = "dsa-revision-offer-day";
const DEFAULT_MINUTES = 25;

interface Props {
  onOpenCoach: (problemId: string) => void;
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

  const [flow, setFlow] = useState<Flow>({ kind: "idle" });
  const [starts, setStarts] = useState<Record<string, number>>(loadStarts);
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
    const onStart = () => setFlow((f) => (f.kind === "idle" ? { kind: "warmup" } : f));
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
    const allowed = new Set(plan.suggestedProblems.map((p) => p.problemId));
    setStarts((prev) => {
      const next: Record<string, number> = {};
      for (const [id, startedAt] of Object.entries(prev)) {
        if (allowed.has(id)) next[id] = startedAt;
      }
      if (Object.keys(next).length === Object.keys(prev).length) return prev;
      saveStarts(next);
      return next;
    });
  }, [plan]);

  const startProblem = (problemId: string) => {
    const next = { ...starts, [problemId]: Date.now() };
    setStarts(next);
    saveStarts(next);
  };

  const elapsedMinutes = (problemId: string): number | null => {
    const start = starts[problemId];
    if (!start) return null;
    return Math.max(1, Math.round((Date.now() - start) / 60_000));
  };

  const markDone = async (problemId: string, problemName: string, topicId?: string) => {
    if (!plan || logging) return;
    setLogging(problemId);
    setMessage(null);
    try {
      const minutes = elapsedMinutes(problemId) ?? DEFAULT_MINUTES;
      const result = await api.logSession({
        topicId: topicId ?? plan.primaryTopic.id,
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
    const problem = plan?.revisionProblems?.[0];
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
  const curriculumStep = plan?.curriculum
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

          {plan.focus && <FocusCard focus={plan.focus} />}

          <div className="focus-hero-wrap">
            <section className="focus-hero">
              <div>
                <div className="focus-hero-title-row">
                  <h2 className="focus-hero-title">{plan.primaryTopic.name}</h2>
                  {plan.memoryExecutionDivergence && (
                    <span className="chip-v2">
                      <span className="chip-v2-dot" aria-hidden />
                      Recall ≠ execution
                    </span>
                  )}
                </div>
                <p className="focus-hero-reason">{plan.reasoning}</p>
                <div className="focus-hero-actions">
                  {flow.kind === "idle" && (
                    <button
                      type="button"
                      className="btn-primary-v2"
                      onClick={() => {
                        setCelebrateAt(null);
                        setWarmupGraded(false);
                        setFlow({ kind: "warmup" });
                      }}
                    >
                      <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                        <path d="M4 2.5v11l9-5.5z" />
                      </svg>
                      Start session
                    </button>
                  )}
                  <button type="button" className="btn-secondary-v2" onClick={() => void toggleExplain()}>
                    {showExplain ? "Hide" : "Why this?"}
                  </button>
                  <div className="warmup-queue-hint">
                    <span className="warmup-queue-dots" aria-hidden>
                      <span /><span /><span />
                    </span>
                    3 warm-up cards queued
                  </div>
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
                firstProblemUrl={plan.suggestedProblems[0]?.leetcodeLink ?? null}
                onComplete={(graded) => {
                  setWarmupGraded(graded);
                  setFlow({ kind: "idle" });
                  const first = plan.suggestedProblems[0];
                  if (first && !starts[first.problemId]) startProblem(first.problemId);
                }}
              />
            </div>
          )}

          {flow.kind === "mistake" && (
            <div className="panel-v2 flow-reveal" style={{ marginBottom: "1.4rem" }}>
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

          {!focusMode && (
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

          <div className="today-grid">
            <div className="today-grid-col today-grid-col--left">
            <section>
              <div className="panel-v2-header">
                <h3 className="panel-v2-title">Suggested problems</h3>
                <span className="panel-v2-meta">
                  {Math.min(plan.suggestedProblems.length, 3)} picked
                </span>
              </div>
              {plan.suggestedProblems.length === 0 && (
                <p className="muted text-sm">
                  No unsolved problems for this topic — add some in Notion or just revise.
                </p>
              )}
              {plan.suggestedProblems.slice(0, 3).map((p, i) => {
                const started = starts[p.problemId] != null;
                const note = notes[p.problemId];
                const minutes = elapsedMinutes(p.problemId);
                const diffClass = `diff-${p.difficulty?.toLowerCase() ?? "medium"}`;
                return (
                  <div
                    key={p.problemId}
                    className={`problem-row-v2${started ? " problem-row-v2--active" : ""}`}
                  >
                    <span className="problem-row-index" aria-hidden>
                      {String(i + 1).padStart(2, "0")}
                    </span>
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
                    <div className="problem-row-actions">
                      {!started && (
                        <button
                          type="button"
                          className="btn-secondary-v2"
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
                        disabled={logging === p.problemId}
                        onClick={() => {
                          setPulseId(p.problemId);
                          void markDone(p.problemId, p.name);
                        }}
                        onAnimationEnd={() =>
                          setPulseId((id) => (id === p.problemId ? null : id))
                        }
                      >
                        {logging === p.problemId ? "Saving…" : "✓ Done"}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost-v2 today-coach-btn"
                        onClick={() => onOpenCoach(p.problemId)}
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
            <ResolveTodaySection
              slots={plan.resolveSlots ?? []}
              onChanged={() => void refresh()}
            />
            </div>

            <div className="today-grid-col today-grid-col--right">
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

              {!focusMode && curriculumItems.length > 0 && (
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
          </div>
        </>
      )}
    </div>
  );
}

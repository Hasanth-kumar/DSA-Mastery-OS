import { useCallback } from "react";
import { api } from "../api/client.js";
import { usePolling } from "./usePolling.js";

const NAV_POLL_MS = 60_000;

export interface NavMeta {
  todayTopic: string | null;
  todayDuration: number | null;
  coachContext: string | null;
  reviewDue: number | null;
  resolveDue: number | null;
  topicCount: number | null;
  streakDays: number | null;
  syncLabel: string | null;
}

export function useNavMeta(activeTab: string, coachAnchorId: string | null): NavMeta {
  const fetchPlan = useCallback(() => api.getPlan(), []);
  const { data: plan } = usePolling(fetchPlan, NAV_POLL_MS, { initialLoading: false });

  const fetchReview = useCallback(
    () =>
      api.getReviewQueue(20).then((q) => {
        if (q.cards.length === 0) return 0;
        return q.cards.length + (q.hasMore ? 1 : 0);
      }),
    [],
  );
  const { data: reviewDue } = usePolling(fetchReview, NAV_POLL_MS, { initialLoading: false });

  const fetchResolve = useCallback(() => api.getResolveQueue().then((q) => q.dueCount), []);
  const { data: resolveDue } = usePolling(fetchResolve, NAV_POLL_MS, { initialLoading: false });

  const fetchTopics = useCallback(
    () => api.getTopics().then((r) => r.count),
    [],
  );
  const { data: topicCount } = usePolling(fetchTopics, NAV_POLL_MS, { initialLoading: false });

  const fetchStreak = useCallback(() => api.getStreak(), []);
  const { data: streak } = usePolling(fetchStreak, NAV_POLL_MS, { initialLoading: false });

  const fetchSync = useCallback(() => api.getSyncStatus(), []);
  const { data: sync } = usePolling(fetchSync, NAV_POLL_MS, { initialLoading: false });

  // P7.5: a mixed day names no pattern anywhere, the nav included (§6.4).
  const mixedDay = plan?.queue?.dayKind === "mixed";
  const todayLabel = mixedDay ? "Mixed practice" : (plan?.primaryTopic.name ?? null);
  const coachContext =
    coachAnchorId && plan
      ? (plan.suggestedProblems.find((p) => p.problemId === coachAnchorId)?.name ?? todayLabel)
      : todayLabel;

  return {
    todayTopic: todayLabel,
    todayDuration: plan?.queue ? plan.queue.totalMinutes : (plan?.estimatedDuration ?? null),
    coachContext: activeTab === "coach" ? coachContext : null,
    reviewDue: reviewDue ?? null,
    resolveDue: resolveDue ?? null,
    topicCount: topicCount ?? null,
    streakDays: streak?.currentStreakDays ?? null,
    syncLabel: sync?.lastSyncAt ?? null,
  };
}

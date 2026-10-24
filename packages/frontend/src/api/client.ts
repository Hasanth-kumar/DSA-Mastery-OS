import type {
  AnalyticsDashboard,
  ChatThread,
  CoachModelList,
  CurriculumState,
  FeatureFlags,
  HealthInfo,
  LeetCodeUserStats,
  LeetCodeActivity,
  PriorityScore,
  Problem,
  ProblemNote,
  RecallGradeResult,
  ResolveCompleteResult,
  ResolveOutcomeKind,
  ResolveQueueItem,
  ResolveQueueResponse,
  ResolveRating,
  ReviewCard,
  ReviewGradeResult,
  ReviewQueue,
  ScoreExplanation,
  Session,
  SessionResult,
  StreakInfo,
  StudyPlan,
  SyncConflict,
  SyncStatusInfo,
  Topic,
  WarmupAnswer,
  WarmupQuestions,
  WeaknessEvidence,
} from "../types/api.js";
import { cachedFetch, invalidateCache } from "./cache.js";

const LOCAL_API_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DEFAULT_API_PORT = "3000";
const DEFAULT_API_ORIGIN = `http://127.0.0.1:${DEFAULT_API_PORT}`;

function rewriteLocalhostForLan(apiOrigin: string, pageHost: string): string {
  try {
    const apiUrl = new URL(apiOrigin);
    if (LOCAL_API_HOSTS.has(apiUrl.hostname) && !LOCAL_API_HOSTS.has(pageHost)) {
      apiUrl.hostname = pageHost;
      return apiUrl.origin;
    }
    return apiUrl.origin;
  } catch {
    return apiOrigin;
  }
}

/**
 * Always hit the Fastify API directly in dev (CORS enabled on backend).
 * Vite's /api proxy returns HTML in Cursor's embedded browser.
 */
function resolveApiBase(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, "");

  if (typeof window === "undefined") {
    return configured || DEFAULT_API_ORIGIN;
  }

  const pageHost = window.location.hostname;

  if (import.meta.env.DEV) {
    return rewriteLocalhostForLan(configured || DEFAULT_API_ORIGIN, pageHost);
  }

  // Production: same-origin when the API serves the built SPA (pnpm start /
  // study:prod). Set VITE_API_BASE_URL when the UI is hosted separately.
  return configured || window.location.origin;
}

const BASE = resolveApiBase();

/** Absolute API origin — used by the SSE EventSource connection. */
export const API_BASE = BASE;

function htmlInsteadOfJsonMessage(path: string): string {
  const target = `${BASE}${path}`;
  return (
    `API at ${target} returned HTML instead of JSON. ` +
    "Start the backend with `pnpm dev` (port 3000), then refresh."
  );
}

async function parseJsonBody<T>(res: Response, path: string): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json() as Promise<T>;
  }

  const text = await res.text();
  if (text.trimStart().startsWith("<!")) {
    throw new Error(htmlInsteadOfJsonMessage(path));
  }
  throw new Error(`Expected JSON from ${path}, got ${contentType || "unknown content type"}`);
}

interface RequestOptions extends RequestInit {
  /** Statuses that resolve to null instead of throwing (e.g. 404 = no note). */
  nullOn?: number[];
}

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const { nullOn, ...fetchInit } = init ?? {};
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: "application/json",
      // Fastify rejects an empty body when Content-Type: application/json is
      // set, so only declare JSON when something is actually sent.
      ...(fetchInit.body != null ? { "Content-Type": "application/json" } : {}),
      ...fetchInit.headers,
    },
    ...fetchInit,
  });
  if (nullOn?.includes(res.status)) return null as T;
  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      await parseJsonBody<never>(res, path);
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return parseJsonBody<T>(res, path);
}

/** Resolve `promise`, then drop the given cache prefixes (all caches when none given). */
function invalidating<T>(promise: Promise<T>, ...keys: string[]): Promise<T> {
  return promise.then((result) => {
    if (keys.length === 0) invalidateCache();
    else for (const key of keys) invalidateCache(key);
    return result;
  });
}

const CACHE_TTL = {
  topics: 60_000,
  problems: 60_000,
  sessions: 15_000,
  plan: 30_000,
  // Flags come from the backend .env and only change on restart.
  flags: 3_600_000,
  leetcode: 3_600_000,
  curriculum: 60_000,
  activity: 60_000,
  // Longer than the 60s plan poll so note refetches stay cache hits; the SSE
  // "note" event invalidates on real changes.
  note: 300_000,
  streak: 30_000,
  syncStatus: 30_000,
  review: 30_000,
  resolve: 30_000,
} as const;

export const api = {
  getHealth: () =>
    request<{ status: string }>("/health"),

  getTopics: () =>
    cachedFetch("topics", CACHE_TTL.topics, () =>
      request<{ topics: Topic[]; scores: PriorityScore[]; count: number }>("/api/topics"),
    ),

  getProblems: () =>
    cachedFetch("problems", CACHE_TTL.problems, () =>
      request<{ problems: Problem[]; count: number }>("/api/problems"),
    ),

  getFlags: () => cachedFetch("flags", CACHE_TTL.flags, () => request<FeatureFlags>("/api/flags")),

  getPlan: () =>
    cachedFetch("plan", CACHE_TTL.plan, () => request<StudyPlan>("/api/plan/today")),

  getCurriculum: () =>
    cachedFetch("curriculum", CACHE_TTL.curriculum, () =>
      request<CurriculumState>("/api/curriculum"),
    ),

  updateCurriculum: (topicNames: string[]) =>
    invalidating(
      request<CurriculumState>("/api/curriculum", {
        method: "PUT",
        body: JSON.stringify({ topicNames }),
      }),
      "curriculum",
      "plan",
      "dashboard",
    ),

  setCurriculumActiveTopic: (topicId: string | null) =>
    invalidating(
      request<CurriculumState>("/api/curriculum/active", {
        method: "PUT",
        body: JSON.stringify({ topicId }),
      }),
      "curriculum",
      "plan",
      "dashboard",
    ),

  resetCurriculum: () =>
    invalidating(
      request<CurriculumState>("/api/curriculum/reset", { method: "POST" }),
      "curriculum",
      "plan",
      "dashboard",
    ),

  getSessions: (limit = 50) =>
    cachedFetch(`sessions:${limit}`, CACHE_TTL.sessions, () =>
      request<{ sessions: Session[]; count: number }>(`/api/session?limit=${limit}`),
    ),

  getSessionActivity: (days = 182) =>
    cachedFetch(`activity:${days}`, CACHE_TTL.activity, () =>
      request<{ dailyCounts: Record<string, number>; days: number }>(
        `/api/session/activity?days=${days}`,
      ),
    ),

  logSession: (body: {
    topicId: string;
    problemId?: string;
    problemsSolved?: number;
    studyDuration: number;
    productivityScore?: number;
    pushToNotion?: boolean;
    mistakeTag?: string | null;
    warmupGraded?: boolean;
  }) =>
    invalidating(
      request<SessionResult>("/api/session", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      "sessions:",
      "activity:",
      "topics",
      "problems",
      "plan",
      "dashboard",
      "streak",
    ),

  setMistake: (attemptId: string, input: { tags: string[]; usedCoach?: boolean }) =>
    invalidating(
      request<{ attempt: { id: string; mistakeTag: string | null } }>(
        `/api/attempts/${attemptId}/mistake`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
      "topics",
      "dashboard",
      "activity:",
    ),

  /** Returns null when no note matched this problem (404). */
  getProblemNote: (problemId: string): Promise<ProblemNote | null> =>
    cachedFetch(`problem-note:${problemId}`, CACHE_TTL.note, async () => {
      const data = await request<{ note: ProblemNote } | null>(
        `/api/problems/${problemId}/note`,
        { nullOn: [404] },
      );
      return data?.note ?? null;
    }),

  createNoteTemplate: (problemId: string) =>
    request<{ created: boolean; path?: string }>(
      `/api/problems/${problemId}/note/template`,
      { method: "POST" },
    ),

  getWarmupQuestions: (topicId: string) =>
    request<WarmupQuestions>(`/api/warmup?topicId=${encodeURIComponent(topicId)}`),

  revealWarmupAnswer: (topicId: string, question: string) =>
    request<WarmupAnswer>("/api/warmup/answer", {
      method: "POST",
      body: JSON.stringify({ topicId, question }),
    }),

  gradeWarmup: (topicId: string, quality: number) =>
    invalidating(
      request<RecallGradeResult>("/api/warmup/grade", {
        method: "POST",
        body: JSON.stringify({ topicId, quality }),
      }),
      "topics",
      "plan",
      "dashboard",
    ),

  getReviewQueue: (cap = 20) =>
    cachedFetch(`review-queue:${cap}`, CACHE_TTL.review, () =>
      request<ReviewQueue>(`/api/review/queue?cap=${cap}`),
    ),

  getResolveQueue: () =>
    cachedFetch("resolve-queue", CACHE_TTL.resolve, () =>
      request<ResolveQueueResponse>("/api/resolve/queue"),
    ),

  completeResolve: (
    problemId: string,
    body: { outcome: ResolveOutcomeKind; timeTakenMin?: number | null; ratingOverride?: ResolveRating },
  ) =>
    invalidating(
      request<ResolveCompleteResult>(`/api/resolve/${problemId}/complete`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      "resolve-queue",
      "plan",
      "dashboard",
    ),

  skipResolve: (problemId: string) =>
    invalidating(
      request<{ problemId: string; due: number }>(`/api/resolve/${problemId}/skip`, {
        method: "POST",
      }),
      "resolve-queue",
      "plan",
    ),

  admitResolve: (problemId: string) =>
    invalidating(
      request<ResolveQueueItem>(`/api/resolve/${problemId}/admit`, { method: "POST" }),
      "resolve-queue",
      "plan",
    ),

  setResolveFlags: (problemId: string, flags: { retired?: boolean; suspended?: boolean }) =>
    invalidating(
      request<ResolveQueueItem>(`/api/resolve/${problemId}`, {
        method: "PATCH",
        body: JSON.stringify(flags),
      }),
      "resolve-queue",
      "plan",
    ),

  gradeReviewCard: (cardId: string, quality: number) =>
    invalidating(
      request<ReviewGradeResult>("/api/review/grade", {
        method: "POST",
        body: JSON.stringify({ cardId, quality }),
      }),
      "topics",
      "plan",
      "dashboard",
      "review-queue:",
    ),

  suspendReviewCard: (cardId: string) =>
    invalidating(
      request<{ suspended: boolean }>(`/api/review/${cardId}/suspend`, {
        method: "POST",
      }),
      "review-queue:",
    ),

  deleteReviewCard: (cardId: string) =>
    invalidating(
      request<{ deleted: boolean }>(`/api/review/${cardId}`, {
        method: "DELETE",
      }),
      "review-queue:",
    ),

  editReviewCard: (cardId: string, front: string, back: string) =>
    invalidating(
      request<ReviewCard>(`/api/review/${cardId}`, {
        method: "PATCH",
        body: JSON.stringify({ front, back }),
      }),
      "review-queue:",
    ),

  getOrphanTopics: () =>
    request<{ orphans: Topic[]; count: number }>("/api/topics/orphans"),

  getScoreExplanation: (topicId: string) =>
    request<ScoreExplanation>(`/api/topics/${topicId}/score/explain`),

  getWeaknessEvidence: (topicId: string) =>
    request<WeaknessEvidence>(`/api/topics/${topicId}/weakness`),

  getRevisionQueue: () =>
    request<{ queue: Topic[]; count: number }>("/api/revision"),

  gradeRevision: (topicId: string, quality: number) =>
    invalidating(
      request<RecallGradeResult>(`/api/revision/${topicId}/grade`, {
        method: "POST",
        body: JSON.stringify({ quality }),
      }),
      "topics",
      "plan",
      "dashboard",
    ),

  triggerSync: () =>
    invalidating(
      request<{ topics: number; problems: number; sessions: number; syncedAt: string }>(
        "/api/sync",
        { method: "POST" },
      ),
    ),

  getSyncStatus: () =>
    cachedFetch("sync-status", CACHE_TTL.syncStatus, () =>
      request<SyncStatusInfo>("/api/sync/status"),
    ),

  getSyncConflicts: () =>
    request<{ conflicts: SyncConflict[]; count: number }>("/api/sync/conflicts"),

  resolveSyncConflict: (id: string, winner: "local" | "remote") =>
    invalidating(
      request<{ resolved: boolean; winner: string }>(
        `/api/sync/conflicts/${id}/resolve`,
        { method: "POST", body: JSON.stringify({ winner }) },
      ),
    ),

  getFullHealth: () =>
    cachedFetch("health:full", 20_000, () => request<HealthInfo>("/health")),

  getDashboard: (weeks = 8) =>
    cachedFetch(`dashboard:${weeks}`, 25_000, () =>
      request<AnalyticsDashboard>(`/api/analytics/dashboard?weeks=${weeks}`),
    ),

  getStreak: () =>
    cachedFetch("streak", CACHE_TTL.streak, () =>
      request<StreakInfo>("/api/analytics/streak"),
    ),

  /** Returns null when LEETCODE_USERNAME is not set (503). */
  getLeetCodeStats: (): Promise<LeetCodeUserStats | null> =>
    cachedFetch("leetcode:stats", CACHE_TTL.leetcode, () =>
      request<LeetCodeUserStats | null>("/api/integrations/leetcode/stats", {
        nullOn: [503],
      }),
    ),

  /** Returns null when LEETCODE_USERNAME is not set (503). */
  getLeetCodeActivity: (): Promise<LeetCodeActivity | null> =>
    cachedFetch("leetcode:activity", CACHE_TTL.leetcode, () =>
      request<LeetCodeActivity | null>("/api/integrations/leetcode/activity", {
        nullOn: [503],
      }),
    ),

  getCoachModels: () => request<CoachModelList>("/api/coaching/models"),

  getChatThread: (threadId: string) =>
    request<ChatThread>(`/api/coaching/chat/${threadId}`),

  clearChatThread: (threadId: string) =>
    request<void>(`/api/coaching/chat/${threadId}`, { method: "DELETE" }),
};

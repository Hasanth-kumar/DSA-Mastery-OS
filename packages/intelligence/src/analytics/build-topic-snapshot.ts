/**
 * Single source of truth for mapping raw topic/problem/session rows into the
 * `TopicState` the engines consume. Both the backend mirror (Drizzle rows +
 * mirror-only extras) and the analytics engine (plain inputs, no extras) build
 * through here — keep it that way instead of copying the mapping.
 */
import type {
  AnalyticsProblemInput,
  AnalyticsSessionInput,
  AnalyticsTopicInput,
} from "./types.js";
import type { SessionSnapshot, TopicDifficulty, TopicState, TopicStatus } from "../types.js";

const DIFFICULTIES: TopicDifficulty[] = ["Easy", "Medium", "Hard"];
const STATUSES: TopicStatus[] = ["Not started", "In progress", "Mastered"];

function asDifficulty(value: string | null | undefined): TopicDifficulty {
  if (value && DIFFICULTIES.includes(value as TopicDifficulty)) {
    return value as TopicDifficulty;
  }
  return "Medium";
}

function asStatus(value: string | null | undefined): TopicStatus {
  if (value && STATUSES.includes(value as TopicStatus)) {
    return value as TopicStatus;
  }
  return "Not started";
}

function parsePrerequisites(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Nullable-tolerant row shapes satisfied by both DB rows and analytics inputs. */
export interface TopicStateTopicRow {
  id: string;
  name: string;
  difficulty: string | null;
  status: string | null;
  confidence: number | null;
  revisionCount: number | null;
  lastRevised: number | null;
  nextRevisionAt: number | null;
  sm2Interval?: number | null;
  sm2Repetition?: number | null;
  sm2Efactor?: number | null;
  isWeakArea: number | boolean | null;
  prerequisites: string | null;
}

export interface TopicStateProblemRow {
  id?: string;
  status: string | null;
  attempts: number | null;
  timeTaken: number | null;
}

export interface TopicStateSessionRow {
  date: number;
  problemsSolved: number | null;
  productivityScore: number | null;
  studyDuration: number | null;
}

/** Per-topic signals only the backend mirror can supply (D-series inputs). */
export interface TopicSignalExtras {
  /** Mistake-tag counts from recent problem attempts for this topic. */
  mistakeTagCounts?: Record<string, number>;
  /** Problem ids that have a matched Obsidian note. */
  notedProblemIds?: ReadonlySet<string>;
  /** Coach-assisted vs total recent attempts (D4). */
  coachAssist?: { assisted: number; solved: number };
  /** Latest attempt on this topic was tagged could-not-solve (P3.5). */
  lastAttemptCouldNotSolve?: boolean;
}

/**
 * Map one topic's rows to a `TopicState`. When `extras` is passed (backend
 * mirror path) the mistake/note/coach signal fields are always populated; when
 * omitted (analytics path) they are left absent so weakness signals that key
 * off their presence stay quiet.
 */
export function buildTopicState(
  topic: TopicStateTopicRow,
  topicProblems: TopicStateProblemRow[],
  topicSessions: TopicStateSessionRow[],
  extras?: TopicSignalExtras,
): TopicState {
  const solved = topicProblems.filter((p) => p.status === "Solved");
  const totalAttempts = topicProblems.reduce((sum, p) => sum + (p.attempts ?? 0), 0);
  const times = topicProblems
    .map((p) => p.timeTaken)
    .filter((t): t is number => t != null && t > 0);
  const averageTimeTaken =
    times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;

  const recentSessions: SessionSnapshot[] = [...topicSessions]
    .sort((a, b) => b.date - a.date)
    .slice(0, 8)
    .map((s) => ({
      date: new Date(s.date),
      problemsSolved: s.problemsSolved ?? 0,
      productivityScore: s.productivityScore ?? 0,
      duration: s.studyDuration ?? 0,
    }));

  const state: TopicState = {
    id: topic.id,
    name: topic.name,
    difficulty: asDifficulty(topic.difficulty),
    status: asStatus(topic.status),
    confidence: topic.confidence ?? 0,
    revisionCount: topic.revisionCount ?? 0,
    lastRevised: topic.lastRevised ? new Date(topic.lastRevised) : null,
    nextRevisionAt: topic.nextRevisionAt ? new Date(topic.nextRevisionAt) : null,
    sm2Interval: topic.sm2Interval ?? 1,
    sm2Repetition: topic.sm2Repetition ?? 0,
    sm2Efactor: topic.sm2Efactor ?? 2.5,
    isWeakArea: Boolean(topic.isWeakArea),
    problemsSolved: solved.length,
    totalAttempts,
    averageTimeTaken,
    prerequisites: parsePrerequisites(topic.prerequisites),
    recentSessions,
  };

  if (!extras) return state;

  return {
    ...state,
    mistakeTagCounts: extras.mistakeTagCounts ?? {},
    coachAssist: extras.coachAssist,
    lastAttemptCouldNotSolve: extras.lastAttemptCouldNotSolve ?? false,
    noteCoverage: {
      solved: solved.length,
      withNotes: extras.notedProblemIds
        ? solved.filter((p) => p.id != null && extras.notedProblemIds!.has(p.id)).length
        : 0,
    },
  };
}

export function buildTopicStatesFromData(
  topicRows: AnalyticsTopicInput[],
  problemRows: AnalyticsProblemInput[],
  sessionRows: AnalyticsSessionInput[],
): TopicState[] {
  const problemsByTopic = groupBy(problemRows, (p) => p.topicId);
  const sessionsByTopic = groupBy(sessionRows, (s) => s.topicId);

  return topicRows.map((topic) =>
    buildTopicState(
      topic,
      problemsByTopic.get(topic.id) ?? [],
      sessionsByTopic.get(topic.id) ?? [],
    ),
  );
}

export function groupBy<T>(
  items: T[],
  keyFn: (item: T) => string | null | undefined,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

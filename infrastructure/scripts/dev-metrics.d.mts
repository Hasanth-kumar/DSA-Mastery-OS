export function parseMistakeTags(raw: string | null | undefined): string[];

export interface BaselineTopic {
  id: string;
  name: string;
  confidence: number | null;
  nextRevisionAt: number | null;
  sm2Interval: number | null;
}

export interface BaselineMetrics {
  sessions: number;
  totalMinutes: number;
  attempts: number;
  coachUsedAttempts: number;
  problemReviews: number;
  problemReviewsDue: number;
  cards: number;
  cardEvents: number;
  lastChatMessageAt: number | null;
  curriculumActiveTopicId: string | null;
  problemsByStatus: { status: string; count: number }[];
  mistakeTags: { tag: string; count: number }[];
  topics: BaselineTopic[];
}

export interface MetricsDb {
  prepare(sql: string): {
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  };
}

export function collectBaselineMetrics(db: MetricsDb, nowMs: number): BaselineMetrics;

export function formatBaselineMetrics(
  report: BaselineMetrics & {
    generatedAt: string;
    dbLabel: string;
    nowMs: number;
  },
): string;

export function runDevMetrics(options: {
  repoRoot: string;
  env?: Record<string, string | undefined>;
  now?: Date;
}): string;

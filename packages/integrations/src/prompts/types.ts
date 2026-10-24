import type { TopicDifficulty } from "@dsa/intelligence";

export interface HintContext {
  problemName: string;
  topicName: string;
  difficulty: TopicDifficulty;
  confidence: number;
  attempts: number;
  recommendedDifficulty?: TopicDifficulty;
  /** Graduated hint ladder: 1 conceptual nudge, 2 pattern name, 3 pseudocode, 4 full solution. */
  hintLevel?: 1 | 2 | 3 | 4;
}

export interface DebriefContext {
  topicName: string;
  problemName?: string;
  problemsSolved: number;
  studyDuration: number;
  productivityScore: number;
  confidence: number;
  isWeakArea: boolean;
  weaknessScore: number;
  weaknessSignals: string[];
  sessionsThisWeekOnTopic: number;
  averageProductivityThisWeek: number;
  streakDays: number;
  recommendation: string;
}

export interface ChatLearningContext {
  todayPlan?: {
    primaryTopic: string;
    reasoning: string;
    estimatedDuration: number;
    suggestedProblems: string[];
  };
  weakTopics?: {
    name: string;
    score: number;
    recommendation: string;
  }[];
  streakDays?: number;
  problem?: {
    name: string;
    /** Absent when `patternHidden`. */
    topicName?: string;
    /** P5.2: the learner is practising recognition; never name the pattern unprompted. */
    patternHidden?: boolean;
    difficulty: string;
    attempts: number;
    status: string;
    confidence: number;
    /** Recent attempt log for this problem (most recent first). */
    solveHistory?: {
      solvedAt: string;
      timeTakenMinutes: number | null;
      mistakeTag: string | null;
    }[];
    /** Mistake-tag counts on similar problems (same topic). */
    topicMistakeTags?: Record<string, number>;
    /** Active weakness signals for the problem's topic. */
    weaknessSignals?: string[];
    /** The user's own Obsidian note for this problem (wiki-links resolved). */
    note?: string;
  };
}

export interface ChatCoachOptions {
  directMode?: boolean;
  /** True when the chat is anchored to a specific problem — enables the hint ladder. */
  anchored?: boolean;
}

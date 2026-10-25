import type {
  DifficultyRecommendation,
  TopicDifficulty,
  TopicStage,
  TopicState,
} from "../types.js";
import { deriveTopicStage } from "../topic-stage.js";

/**
 * Attempts in a pattern after which difficulty moves from "learning" (one
 * Easy, then a standard Medium) to "practicing" (Medium). Difficulty only:
 * the weakness engine keeps `LEARNING_MIN_ATTEMPTS` (5) for first exposure.
 */
export const DIFFICULTY_LEARNING_MAX_ATTEMPTS = 2;

/** Stage used for difficulty (P3.5). */
export function difficultyStage(
  topic: Pick<TopicState, "totalAttempts" | "confidence" | "coachAssist">,
): TopicStage {
  if (deriveTopicStage(topic) === "retaining") return "retaining";
  return topic.totalAttempts <= DIFFICULTY_LEARNING_MAX_ATTEMPTS ? "learning" : "practicing";
}

/**
 * Difficulty by stage, not raw confidence (overhaul P3.5).
 *
 * | Stage | Serves |
 * |---|---|
 * | learning (≤ 2 attempts in the pattern) | 1 Easy, then a standard Medium |
 * | practicing (3+ attempts) | Medium; Easy only if the last attempt was could-not-solve |
 * | retaining (confidence ≥ 70, coach assist < 25%, 5+ attempts) | Medium and Hard |
 */
export class DifficultyEngine {
  recommendDifficulty(topic: TopicState): DifficultyRecommendation {
    const stage = difficultyStage(topic);
    switch (stage) {
      case "learning":
        return {
          primary: "Easy",
          secondary: "Medium",
          ratio: [0.5, 0.5],
          stage,
          reason: "Learning: one Easy, then a standard Medium",
        };
      case "practicing":
        if (topic.lastAttemptCouldNotSolve) {
          return {
            primary: "Easy",
            secondary: null,
            ratio: [1, 0],
            stage,
            reason: "Practicing, but the last attempt could not be solved: Easy",
          };
        }
        return { primary: "Medium", secondary: null, ratio: [1, 0], stage, reason: "Practicing: Medium" };
      case "retaining":
        return {
          primary: "Medium",
          secondary: "Hard",
          ratio: [0.5, 0.5],
          stage,
          reason: "Retaining: Medium and Hard",
        };
    }
  }

  pickProblemDifficulties(
    recommendation: DifficultyRecommendation,
    count: number,
  ): TopicDifficulty[] {
    return suggestionSlots(recommendation, count);
  }
}

/** One difficulty per suggestion slot, primary first, split by `ratio`. */
export function suggestionSlots(
  recommendation: DifficultyRecommendation,
  count: number,
): TopicDifficulty[] {
  const result: TopicDifficulty[] = [];
  const [primaryRatio] = recommendation.ratio;
  const primaryCount = Math.round(count * primaryRatio);
  const secondaryCount = count - primaryCount;

  for (let i = 0; i < primaryCount; i++) result.push(recommendation.primary);
  if (recommendation.secondary && secondaryCount > 0) {
    for (let i = 0; i < secondaryCount; i++) result.push(recommendation.secondary);
  }
  while (result.length < count) result.push(recommendation.primary);
  return result;
}

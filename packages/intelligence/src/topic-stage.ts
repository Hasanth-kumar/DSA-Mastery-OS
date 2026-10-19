import type { TopicStage, TopicState } from "./types.js";

/** Attempts before a topic stops counting as "first exposure". */
export const LEARNING_MIN_ATTEMPTS = 5;

/**
 * Where the learner is with a topic:
 * - learning: fewer than 5 attempts — misses and hints are expected, not a weakness
 * - practicing: past first exposure but still leaning on help
 * - retaining: confident and mostly solving without help — time to space reviews out
 */
export function deriveTopicStage(
  topic: Pick<TopicState, "totalAttempts" | "confidence" | "coachAssist">,
): TopicStage {
  if (topic.totalAttempts < LEARNING_MIN_ATTEMPTS) return "learning";
  const assist = topic.coachAssist;
  const assistRate = assist && assist.solved >= 3 ? assist.assisted / assist.solved : 1;
  if (topic.confidence >= 70 && assistRate < 0.25) return "retaining";
  return "practicing";
}

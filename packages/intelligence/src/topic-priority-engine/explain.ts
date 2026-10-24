import type { PriorityScore, TopicState } from "../types.js";
import { summarizeResolveDue } from "./resolve-urgency.js";

function urgencyReason(topic: TopicState, urgency: number, now = new Date()): string {
  if (topic.resolveDueAt) {
    if (!topic.lastRevised && topic.resolveDueAt.length === 0) {
      return "never studied — maximum urgency";
    }
    const { dueCount, maxDaysOverdue } = summarizeResolveDue(topic.resolveDueAt, now);
    if (dueCount === 0) return "no re-solve due";
    const late = maxDaysOverdue > 0 ? `, the oldest ${maxDaysOverdue} days overdue` : "";
    return `${dueCount} re-solve${dueCount === 1 ? "" : "s"} due${late}`;
  }
  if (!topic.lastRevised) return "never studied — maximum urgency";
  return urgency > 0.5 ? "revision is overdue" : "revision not yet due";
}

export function explainPriorityScore(
  score: PriorityScore,
  topic: TopicState,
): {
  topicId: string;
  topicName: string;
  total: number;
  recommendation: PriorityScore["recommendation"];
  memoryExecutionDivergence: boolean;
  breakdown: PriorityScore["breakdown"];
  weights: string;
  explanation: string[];
} {
  const b = score.breakdown;
  const explanation = [
    `Topic "${topic.name}" has a priority score of ${score.total.toFixed(1)}/100 (${score.recommendation}).`,
    `Urgency (${(b.urgency * 100).toFixed(0)}%): ${urgencyReason(topic, b.urgency)}.`,
    `Weakness (${(b.weakness * 100).toFixed(0)}%): ${
      topic.isWeakArea
        ? "flagged weak area"
        : b.weakness > 0.3
          ? "low confidence or slow progress signals"
          : "no major weakness signals"
    }.`,
    `Confidence gap (${(b.confidence * 100).toFixed(0)}%): confidence is ${topic.confidence}/100.`,
    `Prerequisites (${(b.prerequisiteReady * 100).toFixed(0)}%): ${
      b.prerequisiteReady === 0
        ? "blocked — prerequisites not mastered"
        : topic.prerequisites.length === 0
          ? "foundational topic"
          : "unlocked and ready"
    }.`,
    `Recency (${(b.recency * 100).toFixed(0)}%): ${
      !topic.lastRevised ? "never studied" : "time since last session"
    }.`,
    `Difficulty weight: ${(b.difficulty * 100).toFixed(0)}% (${topic.difficulty}).`,
  ];

  if (score.memoryExecutionDivergence) {
    explanation.push(
      "Memory/execution divergence: SM-2 says revision is not due, but solve-time and weakness signals are high — keep practicing so recallable topics do not drop off the plan.",
    );
  }

  return {
    topicId: topic.id,
    topicName: topic.name,
    total: score.total,
    recommendation: score.recommendation,
    memoryExecutionDivergence: score.memoryExecutionDivergence,
    breakdown: score.breakdown,
    weights:
      "Composite = (W₁·urgency + W₂·weakness + W₃·confidence + W₄·prereq + W₅·recency) × difficulty",
    explanation,
  };
}

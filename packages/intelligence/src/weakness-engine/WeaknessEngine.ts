import type { TopicState, WeaknessAnalysis, WeaknessReport } from "../types.js";
import {
  coachRelianceSignal,
  confidenceSignal,
  MISTAKE_TAG_ADVICE,
  mistakeTagSignal,
  noteCoverageSignal,
  revisionFailureSignal,
  retryRateSignal,
  sessionProductivitySignal,
  timeSignal,
  WEAKNESS_THRESHOLD,
} from "./signals.js";
import { deriveTopicStage } from "../topic-stage.js";

export class WeaknessEngine {
  analyzeWeakness(topic: TopicState): WeaknessAnalysis {
    const signals = [
      confidenceSignal(topic),
      retryRateSignal(topic),
      timeSignal(topic),
      sessionProductivitySignal(topic),
      revisionFailureSignal(topic),
      mistakeTagSignal(topic),
      noteCoverageSignal(topic),
      coachRelianceSignal(topic),
    ];

    const score = signals.reduce((acc, s) => acc + s.weight * s.value, 0);
    // First exposure to a pattern is messy by nature: misses and hints there are
    // learning, not weakness. Only judge a topic once it is past that stage.
    const stage = deriveTopicStage(topic);
    const isWeak = stage !== "learning" && score > WEAKNESS_THRESHOLD;

    return {
      topicId: topic.id,
      score,
      isWeak,
      stage,
      signals: signals.filter((s) => s.value > 0),
      recommendation:
        stage === "learning"
          ? this.learningRecommendation(topic)
          : this.buildRecommendation(signals, isWeak, topic),
    };
  }

  detectAllWeaknesses(topics: TopicState[]): WeaknessReport {
    const analyses = topics.map((t) => this.analyzeWeakness(t));
    const weakTopics = analyses.filter((a) => a.isWeak);
    const strongTopics = analyses.filter((a) => !a.isWeak && a.score < 0.2);

    return {
      weakTopics,
      strongTopics,
      summary: this.summarize(analyses, weakTopics.length),
    };
  }

  private learningRecommendation(topic: TopicState): string {
    return `Still learning ${topic.name} — misses are expected. Aim for one solve with no outside help on an Easy problem, then add Mediums.`;
  }

  private buildRecommendation(
    signals: ReturnType<typeof confidenceSignal>[],
    isWeak: boolean,
    topic: TopicState,
  ): string {
    const mistakeAdvice = this.mistakeTagRecommendation(topic);
    if (!isWeak) {
      return mistakeAdvice ?? "Continue current pace; no major weakness detected.";
    }

    const active = signals.filter((s) => s.value > 0).map((s) => s.name);
    if (mistakeAdvice && active.includes("repeated_mistakes")) {
      return mistakeAdvice;
    }
    if (active.includes("low_confidence")) {
      return "Rebuild fundamentals: review concepts, then solve easy problems.";
    }
    if (active.includes("high_retry_rate")) {
      return "Focus on pattern recognition; study solutions before re-attempting.";
    }
    if (active.includes("slow_solution_time")) {
      return "Practice timed easy/medium problems to build speed.";
    }
    return "Schedule extra revision sessions and track productivity per session.";
  }

  /** Targeted advice when one mistake tag repeats in this topic (e.g. off-by-one ×3). */
  private mistakeTagRecommendation(topic: TopicState): string | null {
    const counts = topic.mistakeTagCounts ?? {};
    const dominant = Object.entries(counts)
      .filter(([tag, n]) => n >= 2 && adviceFor(tag))
      .sort((a, b) => b[1] - a[1])[0];
    if (!dominant) return null;
    return `Repeated "${dominant[0]}" mistakes — ${adviceFor(dominant[0])} in ${topic.name}.`;
  }

  private summarize(
    analyses: WeaknessAnalysis[],
    weakCount: number,
  ): string {
    if (weakCount === 0) {
      return `All ${analyses.length} topics look stable — maintain with spaced revision.`;
    }
    return `${weakCount} of ${analyses.length} topics flagged as weak areas needing focused practice.`;
  }
}

/** Advice for a stored tag; stored rows may hold tags outside the closed set. */
function adviceFor(tag: string): string | undefined {
  return (MISTAKE_TAG_ADVICE as Record<string, string | undefined>)[tag];
}

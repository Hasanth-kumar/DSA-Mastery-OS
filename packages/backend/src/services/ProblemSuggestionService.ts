import {
  suggestionSlots,
  type DifficultyRecommendation,
  type ProblemSuggestion,
  type StudyPlan,
  type TopicDifficulty,
  type TopicState,
} from "@dsa/intelligence";
import type { ProblemRepository } from "../repositories/ProblemRepository.js";

export function asDifficulty(value: string | null | undefined): TopicDifficulty | null {
  if (value === "Easy" || value === "Medium" || value === "Hard") return value;
  return null;
}

/** Fallback order when a slot's difficulty has nothing left. */
const NEAREST: Record<TopicDifficulty, TopicDifficulty[]> = {
  Easy: ["Easy", "Medium", "Hard"],
  Medium: ["Medium", "Easy", "Hard"],
  Hard: ["Hard", "Medium", "Easy"],
};

export class ProblemSuggestionService {
  constructor(private readonly problemRepo: ProblemRepository) {}

  /**
   * P3.5: one problem per difficulty slot from the stage recommendation
   * (learning → Easy then Medium, practicing → Medium, retaining → Medium
   * and Hard). A slot with nothing left takes the nearest difficulty. The
   * Notion placeholder appears only when the topic has no first-pass work left.
   */
  selectForTopic(
    topic: TopicState,
    difficultyRec: DifficultyRecommendation,
    limit = 2,
  ): ProblemSuggestion[] {
    const remaining = this.problemRepo.findRemainingFirstPassByTopicId(topic.id, { limit: 500 });
    if (remaining.length > 0) {
      const chosen: typeof remaining = [];
      for (const slot of suggestionSlots(difficultyRec, limit)) {
        for (const d of NEAREST[slot]) {
          const p = remaining.find((r) => asDifficulty(r.difficulty) === d && !chosen.includes(r));
          if (p) {
            chosen.push(p);
            break;
          }
        }
      }
      for (const r of remaining) {
        if (chosen.length >= Math.min(limit, remaining.length)) break;
        if (!chosen.includes(r)) chosen.push(r);
      }
      return chosen.map((p) => ({
        problemId: p.id,
        name: p.name,
        difficulty: asDifficulty(p.difficulty) ?? difficultyRec.primary,
        leetcodeLink: p.leetcodeLink ?? undefined,
      }));
    }

    const difficulties: TopicDifficulty[] = [difficultyRec.primary];
    if (difficultyRec.secondary) difficulties.push(difficultyRec.secondary);
    return difficulties.slice(0, limit).map((d, i) => ({
      problemId: `${topic.id}-suggested-${i}`,
      name: `${topic.name} — ${d} practice (add problems in Notion)`,
      difficulty: d,
    }));
  }

  enrichPlan(plan: StudyPlan, difficultyRec: DifficultyRecommendation): StudyPlan {
    const suggestedProblems = this.selectForTopic(plan.primaryTopic, difficultyRec);
    return { ...plan, suggestedProblems };
  }
}

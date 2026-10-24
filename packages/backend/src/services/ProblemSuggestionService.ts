import type {
  DifficultyRecommendation,
  ProblemSuggestion,
  StudyPlan,
  TopicDifficulty,
  TopicState,
} from "@dsa/intelligence";
import type { ProblemRepository } from "../repositories/ProblemRepository.js";

export function asDifficulty(value: string | null | undefined): TopicDifficulty | null {
  if (value === "Easy" || value === "Medium" || value === "Hard") return value;
  return null;
}

export class ProblemSuggestionService {
  constructor(private readonly problemRepo: ProblemRepository) {}

  selectForTopic(
    topic: TopicState,
    difficultyRec: DifficultyRecommendation,
    limit = 2,
  ): ProblemSuggestion[] {
    const difficulties: TopicDifficulty[] = [difficultyRec.primary];
    if (difficultyRec.secondary) difficulties.push(difficultyRec.secondary);

    const unsolved = this.problemRepo.findRemainingFirstPassByTopicId(topic.id, {
      difficulties,
      limit,
    });

    if (unsolved.length > 0) {
      return unsolved.map((p) => ({
        problemId: p.id,
        name: p.name,
        difficulty: asDifficulty(p.difficulty) ?? difficultyRec.primary,
        leetcodeLink: p.leetcodeLink ?? undefined,
      }));
    }

    const anyUnsolved = this.problemRepo.findRemainingFirstPassByTopicId(topic.id, { limit });
    if (anyUnsolved.length > 0) {
      return anyUnsolved.map((p) => ({
        problemId: p.id,
        name: p.name,
        difficulty: asDifficulty(p.difficulty) ?? topic.difficulty,
        leetcodeLink: p.leetcodeLink ?? undefined,
      }));
    }

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

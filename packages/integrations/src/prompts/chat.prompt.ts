import type { ChatCoachOptions, ChatLearningContext } from "./types.js";

function formatLearningContext(ctx: ChatLearningContext): string {
  const sections: string[] = [];

  if (ctx.todayPlan) {
    const problems =
      ctx.todayPlan.suggestedProblems.length > 0
        ? ctx.todayPlan.suggestedProblems.join(", ")
        : "none listed";
    sections.push(
      `Today's plan: focus on ${ctx.todayPlan.primaryTopic} (~${ctx.todayPlan.estimatedDuration} min). ` +
        `Reasoning: ${ctx.todayPlan.reasoning} Suggested problems: ${problems}.`,
    );
  }

  if (ctx.weakTopics && ctx.weakTopics.length > 0) {
    const lines = ctx.weakTopics
      .slice(0, 3)
      .map((w) => `- ${w.name} (weakness ${w.score}/100): ${w.recommendation}`)
      .join("\n");
    sections.push(`Weak areas:\n${lines}`);
  }

  if (ctx.streakDays != null) {
    sections.push(`Current study streak: ${ctx.streakDays} day(s).`);
  }

  if (ctx.problem) {
    const p = ctx.problem;
    const lines = p.patternHidden
      ? [
          `Anchored problem: ${p.name} (${p.difficulty}), status ${p.status}, ${p.attempts} attempt(s).`,
          "The student is practising pattern recognition on this problem: they were not told which " +
            "pattern it uses. Do not name or hint at the pattern, technique or data structure unless " +
            "they explicitly ask for that rung of the hint ladder.",
        ]
      : [
          `Anchored problem: ${p.name} (${p.difficulty}) — topic ${p.topicName}, ` +
            `status ${p.status}, ${p.attempts} attempt(s), topic confidence ${p.confidence}/100.`,
        ];

    if (p.solveHistory && p.solveHistory.length > 0) {
      const history = p.solveHistory
        .slice(0, 5)
        .map(
          (h) =>
            `  - ${h.solvedAt.slice(0, 10)}: ${
              h.timeTakenMinutes != null ? `${h.timeTakenMinutes} min` : "time unknown"
            }${h.mistakeTag ? `, struggled with: ${h.mistakeTag}` : ""}`,
        )
        .join("\n");
      lines.push(`Past attempts on this problem:\n${history}`);
    }

    const tagEntries = Object.entries(p.topicMistakeTags ?? {}).filter(([, n]) => n > 0);
    if (tagEntries.length > 0) {
      const tags = tagEntries
        .sort((a, b) => b[1] - a[1])
        .map(([tag, n]) => `${tag} ×${n}`)
        .join(", ");
      lines.push(`Recent mistake patterns on similar ${p.topicName} problems: ${tags}.`);
    }

    if (p.weaknessSignals && p.weaknessSignals.length > 0) {
      lines.push(`Active weakness signals for ${p.topicName}: ${p.weaknessSignals.join("; ")}.`);
    }

    if (p.note) {
      lines.push(
        `The student's own note on this problem (from their Obsidian vault):\n"""\n${p.note}\n"""`,
      );
    }

    sections.push(lines.join("\n"));
  }

  return sections.length > 0 ? sections.join("\n\n") : "No learner context available.";
}

export function buildChatSystemPrompt(
  learningContext: ChatLearningContext | null,
  options: ChatCoachOptions = {},
): string {
  const style = options.directMode
    ? "Explain concepts clearly and directly when asked."
    : "Use a Socratic style by default: guide with questions and hints before full explanations.";

  const contextBlock = learningContext
    ? `\n\nLearner context:\n${formatLearningContext(learningContext)}`
    : "";

  return `You are a personal DSA interview coach. Be concise; use markdown when helpful.
${style}${contextBlock}`;
}

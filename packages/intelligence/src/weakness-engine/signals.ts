import type { TopicState, WeaknessSignal } from "../types.js";
import { latestSessions } from "../utils/sessions.js";

const SIGNAL_WEIGHTS = {
  confidence: 0.25,
  retryRate: 0.2,
  slowTime: 0.15,
  sessionProductivity: 0.125,
  revisionFailure: 0.125,
  mistakeTags: 0.1,
  noteCoverage: 0.05,
  // D: additive on top of the original 1.0 — the threshold is absolute, so a
  // coach-reliant topic simply reads weaker; it never dilutes other signals.
  coachReliance: 0.1,
} as const;

export function confidenceSignal(topic: TopicState): WeaknessSignal {
  let value = 0;
  if (topic.confidence < 50) value = 1;
  else if (topic.confidence < 70) value = 0.5;

  return {
    name: "low_confidence",
    weight: SIGNAL_WEIGHTS.confidence,
    value,
    description:
      value > 0
        ? `Confidence is ${topic.confidence}% (below target)`
        : "Confidence is adequate",
  };
}

export function retryRateSignal(topic: TopicState): WeaknessSignal {
  const ratio =
    topic.problemsSolved > 0
      ? topic.totalAttempts / topic.problemsSolved
      : topic.totalAttempts > 0
        ? 3
        : 0;
  const value = ratio > 2.5 ? 1 : ratio > 1.5 ? 0.5 : 0;

  return {
    name: "high_retry_rate",
    weight: SIGNAL_WEIGHTS.retryRate,
    value,
    description:
      value > 0
        ? `High retry ratio (${ratio.toFixed(1)} attempts per solve)`
        : "Retry rate is normal",
  };
}

export function timeSignal(topic: TopicState): WeaknessSignal {
  const value = topic.averageTimeTaken > 45 ? 1 : topic.averageTimeTaken > 30 ? 0.5 : 0;

  return {
    name: "slow_solution_time",
    weight: SIGNAL_WEIGHTS.slowTime,
    value,
    description:
      value > 0
        ? `Average time ${topic.averageTimeTaken} min (above 45 min threshold)`
        : "Solution time is acceptable",
  };
}

export function sessionProductivitySignal(topic: TopicState): WeaknessSignal {
  const sessions = topic.recentSessions;
  if (sessions.length === 0) {
    return {
      name: "low_session_productivity",
      weight: SIGNAL_WEIGHTS.sessionProductivity,
      value: 0,
      description: "No recent sessions to evaluate",
    };
  }

  const avg =
    sessions.reduce((acc, s) => acc + s.productivityScore, 0) / sessions.length;
  const value = avg < 60 ? 1 : avg < 75 ? 0.5 : 0;

  return {
    name: "low_session_productivity",
    weight: SIGNAL_WEIGHTS.sessionProductivity,
    value,
    description:
      value > 0
        ? `Recent session productivity avg ${avg.toFixed(0)}%`
        : "Session productivity is healthy",
  };
}

export function revisionFailureSignal(topic: TopicState): WeaknessSignal {
  const recent = latestSessions(topic.recentSessions, 3);
  const failures = recent.filter((s) => s.productivityScore < 60).length;
  const value =
    failures >= 2 ? 1 : failures === 1 ? 0.5 : topic.revisionCount > 0 && topic.confidence < 50 ? 0.5 : 0;

  return {
    name: "revision_failures",
    weight: SIGNAL_WEIGHTS.revisionFailure,
    value,
    description:
      value > 0
        ? `${failures} recent low-productivity sessions`
        : "Revision performance is stable",
  };
}

/** Human-readable practice advice per repeated mistake tag. */
export const MISTAKE_TAG_ADVICE: Record<string, string> = {
  "off-by-one": "practice boundary conditions and loop invariants",
  "edge-case": "enumerate edge cases (empty, single element, duplicates) before coding",
  "wrong-approach": "slow down on approach selection; name the pattern before coding",
  "pattern-recall": "drill pattern recognition with flashcard-style review",
};

export function mistakeTagSignal(topic: TopicState): WeaknessSignal {
  const counts = topic.mistakeTagCounts ?? {};
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  const total = entries.reduce((acc, [, n]) => acc + n, 0);
  const dominant = entries.sort((a, b) => b[1] - a[1])[0];

  const value = total >= 4 ? 1 : total >= 2 ? 0.5 : 0;

  return {
    name: "repeated_mistakes",
    weight: SIGNAL_WEIGHTS.mistakeTags,
    value,
    description:
      value > 0 && dominant
        ? `${total} recent mistake tags (mostly "${dominant[0]}")`
        : "No repeated mistake pattern",
  };
}

/** D: "solved with coach" is a weaker mastery signal than "solved cold". */
export function coachRelianceSignal(topic: TopicState): WeaknessSignal {
  const assist = topic.coachAssist;
  if (!assist || assist.solved < 2) {
    return {
      name: "coach_reliance",
      weight: SIGNAL_WEIGHTS.coachReliance,
      value: 0,
      description: "Not enough recent solves to judge coach reliance",
    };
  }

  const rate = assist.assisted / assist.solved;
  const value = rate >= 0.5 ? 1 : rate >= 0.25 ? 0.5 : 0;

  return {
    name: "coach_reliance",
    weight: SIGNAL_WEIGHTS.coachReliance,
    value,
    description:
      value > 0
        ? `${assist.assisted}/${assist.solved} recent solves needed the coach`
        : "Solving without coach help",
  };
}

export function noteCoverageSignal(topic: TopicState): WeaknessSignal {
  const coverage = topic.noteCoverage;
  if (!coverage || coverage.solved < 3) {
    return {
      name: "low_note_coverage",
      weight: SIGNAL_WEIGHTS.noteCoverage,
      value: 0,
      description: "Not enough solved problems to judge note coverage",
    };
  }

  const ratio = coverage.withNotes / coverage.solved;
  const value = ratio < 0.2 ? 1 : ratio < 0.5 ? 0.5 : 0;

  return {
    name: "low_note_coverage",
    weight: SIGNAL_WEIGHTS.noteCoverage,
    value,
    description:
      value > 0
        ? `Only ${coverage.withNotes}/${coverage.solved} solved problems have notes (possible rushing)`
        : "Note coverage is healthy",
  };
}

export const WEAKNESS_THRESHOLD = 0.45;

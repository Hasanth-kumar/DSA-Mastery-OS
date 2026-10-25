/**
 * Pass tracking per topic (overhaul P7.3; plan §6.3, D3, D4). Pure: snapshots
 * in, a pass level and its evidence out.
 *
 * | Pass | Rule |
 * |---|---|
 * | 0 | below pass 1 (`touched` says whether anything was worked yet) |
 * | 1 exposure | fewer than 4 problems: all covered; else all Easy covered and `min(3, #Medium)` Medium covered |
 * | 2 consolidated | pass 1, every problem that needed help (or wasn't clean) re-solved clean on a later day, and `min(2, unseen Easy/Medium left at pass 1)` of those unseen problems solved clean on the first try |
 * | 3 retained | pass 2, 2+ hidden-pattern attempts with the right guess and a clean solve, and no overdue re-solves |
 *
 * - "Covered" is the P3.1 status rule (`Solved` or `Revision needed`).
 * - "Clean" (§6.3) is no missing-approach tag (`APPROACH_MISTAKE_TAGS`, which
 *   includes `wrong-approach`), not `could-not-solve`, and help at most a Hint
 *   (P6.1). A legacy row with no help level counts its help flag as Approach,
 *   the same rule the re-solve rating uses.
 * - "A later session" is a later calendar day (`dayKey`, learner timezone).
 *   Twelve dev-DB attempts carry no session id, and two attempts on one day
 *   are not spaced practice.
 * - Hards are never required for passes 1–2 and don't count as transfer
 *   problems; a hidden Hard counts toward pass 3 like any other.
 * - Performance and evidence stay separate (§6.3): `evidence` reports the
 *   clean rate and the amount of cold practice, not one blended score.
 *
 * The level is the topic's current state, so it can drop: a new attempt that
 * needed help reopens pass 2, an overdue re-solve takes pass 3 away.
 */
import { APPROACH_MISTAKE_TAGS, type HelpLevel, type TopicDifficulty } from "../types.js";
import { isFirstPassCovered } from "../problem-progress.js";

export type TopicPassLevel = 0 | 1 | 2 | 3;

export interface PassProblem {
  id: string;
  /** Null is treated as Medium. */
  difficulty: TopicDifficulty | null;
  status: string | null;
}

export interface PassTopic {
  id: string;
  problems: readonly PassProblem[];
}

export interface PassAttempt {
  problemId: string;
  /** Epoch ms. */
  solvedAt: number;
  /** Calendar date of the attempt in the learner's timezone, "YYYY-MM-DD". */
  dayKey: string;
  mistakeTags: readonly string[];
  /** P6.1 help level; null on rows from before migration 0017. */
  helpLevel: HelpLevel | null;
  /** Legacy help flag (`used_coach` or in-app hints), read only when `helpLevel` is null. */
  usedHelp: boolean;
  /** P6.1: topic id guessed on a hidden-pattern row, `unsure`, or null when not asked. */
  patternGuess: string | null;
}

export interface PassReview {
  problemId: string;
  /** Epoch ms; null = never scheduled. */
  due: number | null;
  retired?: boolean;
  suspended?: boolean;
}

export interface TopicPassResult {
  topicId: string;
  pass: TopicPassLevel;
  /** Any problem covered or attempted. Pass 0 and touched = introduced, below pass 1. */
  touched: boolean;
  evidence: {
    attempts: number;
    cleanAttempts: number;
    /** Clean attempts / attempts; null with no attempts. */
    cleanRate: number | null;
    /** Hidden-pattern attempts, plus repeat attempts on a later day than the previous one. */
    coldAttempts: number;
    coldCleanAttempts: number;
  };
  pass1: {
    met: boolean;
    total: number;
    covered: number;
    easyTotal: number;
    easyCovered: number;
    mediumCovered: number;
    mediumNeeded: number;
    /** Uncovered problems that can still complete pass 1: every missing Easy, plus every uncovered Medium while Medium is short. */
    remaining: string[];
    /** Calendar day pass 1 was reached; null when not met or reached before any attempt. */
    reachedOn: string | null;
  };
  pass2: {
    met: boolean;
    /** Problems still waiting for a clean solve on a later day (problem ids). */
    awaitingCleanResolve: string[];
    transferNeeded: number;
    transferClean: number;
  };
  pass3: {
    met: boolean;
    hiddenCorrectClean: number;
    hiddenNeeded: number;
    overdueResolves: number;
  };
}

export interface TopicPassConfig {
  /** Topics smaller than this need every problem for pass 1 (D3). */
  smallTopicSize: number;
  /** Medium problems needed for pass 1, capped at the topic's count (D3). */
  pass1Medium: number;
  /** Unseen problems solved clean first try for pass 2 (D4). */
  pass2Transfer: number;
  /** Hidden-pattern clean solves with the right guess for pass 3. */
  pass3Hidden: number;
  /** A re-solve is overdue once it is this many days past due. */
  overdueDays: number;
}

export const DEFAULT_TOPIC_PASS_CONFIG: TopicPassConfig = {
  smallTopicSize: 4,
  pass1Medium: 3,
  pass2Transfer: 2,
  pass3Hidden: 2,
  overdueDays: 1,
};

const MS_PER_DAY = 86_400_000;
const COULD_NOT_SOLVE = "could-not-solve";
const APPROACH_TAGS = new Set<string>(APPROACH_MISTAKE_TAGS);

/** §6.3 clean: no missing approach, solved, help at most a Hint. */
export function isCleanAttempt(
  attempt: Pick<PassAttempt, "mistakeTags" | "helpLevel" | "usedHelp">,
): boolean {
  if (attempt.mistakeTags.some((t) => t === COULD_NOT_SOLVE || APPROACH_TAGS.has(t))) {
    return false;
  }
  const level: HelpLevel = attempt.helpLevel ?? (attempt.usedHelp ? "approach" : "none");
  return level === "none" || level === "hint";
}

const difficultyOf = (p: PassProblem): TopicDifficulty => p.difficulty ?? "Medium";

/** Pass 1 rule (D3) on a set of covered problem ids. */
function pass1Met(
  problems: readonly PassProblem[],
  covered: ReadonlySet<string>,
  config: TopicPassConfig,
): boolean {
  if (problems.length === 0) return false;
  if (problems.length < config.smallTopicSize) return problems.every((p) => covered.has(p.id));
  const easy = problems.filter((p) => difficultyOf(p) === "Easy");
  const medium = problems.filter((p) => difficultyOf(p) === "Medium");
  const mediumNeeded = Math.min(config.pass1Medium, medium.length);
  const mediumCovered = medium.filter((p) => covered.has(p.id)).length;
  if (easy.length === 0 && mediumNeeded === 0) {
    // Only Hards (no such topic in the dev DB): pass 1 still needs a touch.
    return covered.size > 0;
  }
  return easy.every((p) => covered.has(p.id)) && mediumCovered >= mediumNeeded;
}

export function topicPass(
  topic: PassTopic,
  attempts: readonly PassAttempt[],
  reviews: readonly PassReview[],
  now: number,
  config: TopicPassConfig = DEFAULT_TOPIC_PASS_CONFIG,
): TopicPassResult {
  const problems = topic.problems;
  const ids = new Set(problems.map((p) => p.id));
  const byProblem = new Map<string, PassAttempt[]>();
  for (const a of attempts) {
    if (!ids.has(a.problemId)) continue;
    const list = byProblem.get(a.problemId) ?? [];
    list.push(a);
    byProblem.set(a.problemId, list);
  }
  for (const list of byProblem.values()) list.sort((a, b) => a.solvedAt - b.solvedAt);
  const own = [...byProblem.values()].flat();

  // --- evidence ---
  let cleanAttempts = 0;
  let coldAttempts = 0;
  let coldCleanAttempts = 0;
  for (const list of byProblem.values()) {
    list.forEach((a, i) => {
      const clean = isCleanAttempt(a);
      if (clean) cleanAttempts += 1;
      const repeatLater = i > 0 && a.dayKey > list[i - 1].dayKey;
      if (a.patternGuess != null || repeatLater) {
        coldAttempts += 1;
        if (clean) coldCleanAttempts += 1;
      }
    });
  }

  // --- pass 1 ---
  const coveredNow = new Set(problems.filter((p) => isFirstPassCovered(p.status)).map((p) => p.id));
  const easy = problems.filter((p) => difficultyOf(p) === "Easy");
  const medium = problems.filter((p) => difficultyOf(p) === "Medium");
  const small = problems.length < config.smallTopicSize;
  const mediumNeeded = small ? 0 : Math.min(config.pass1Medium, medium.length);
  const p1 = pass1Met(problems, coveredNow, config);
  const remaining = small
    ? problems.filter((p) => !coveredNow.has(p.id)).map((p) => p.id)
    : [
        ...easy.filter((p) => !coveredNow.has(p.id)),
        ...(medium.filter((p) => coveredNow.has(p.id)).length >= mediumNeeded
          ? []
          : medium.filter((p) => !coveredNow.has(p.id))),
      ].map((p) => p.id);

  // When pass 1 was reached: replay covered problems in the order they were
  // first worked (status-only rows with no attempts count from the start).
  let reachedOn: string | null = null;
  if (p1) {
    const coverOrder = [...coveredNow]
      .map((id) => {
        const list = byProblem.get(id) ?? [];
        const first = list.find((a) => !a.mistakeTags.includes(COULD_NOT_SOLVE)) ?? list[0];
        return { id, at: first?.solvedAt ?? -Infinity, day: first?.dayKey ?? null };
      })
      .sort((a, b) => a.at - b.at);
    const replay = new Set<string>();
    for (const step of coverOrder) {
      replay.add(step.id);
      if (pass1Met(problems, replay, config)) {
        reachedOn = step.day;
        break;
      }
    }
  }

  // --- pass 2 ---
  const awaitingCleanResolve: string[] = [];
  for (const p of problems) {
    const list = byProblem.get(p.id) ?? [];
    if (list.length === 0) {
      // Imported as "Revision needed" with no attempt rows: needs a clean solve.
      if (p.status === "Revision needed") awaitingCleanResolve.push(p.id);
      continue;
    }
    let lastNotClean: PassAttempt | null = null;
    for (const a of list) if (!isCleanAttempt(a)) lastNotClean = a;
    if (!lastNotClean) continue;
    const day = lastNotClean.dayKey;
    if (!list.some((a) => a.dayKey > day && isCleanAttempt(a))) awaitingCleanResolve.push(p.id);
  }

  // Transfer: Easy/Medium problems still unseen at the end of the pass-1 day.
  const unseenAtPass1 = problems.filter((p) => {
    if (difficultyOf(p) === "Hard") return false;
    const list = byProblem.get(p.id) ?? [];
    if (list.length === 0) return !coveredNow.has(p.id);
    // Reached with no attempt day (status-only rows): every attempt came after.
    return p1 && (reachedOn == null || list[0].dayKey > reachedOn);
  });
  const transferNeeded = Math.min(config.pass2Transfer, unseenAtPass1.length);
  const transferClean = unseenAtPass1.filter((p) => {
    const first = byProblem.get(p.id)?.[0];
    return first != null && isCleanAttempt(first);
  }).length;
  const p2 = p1 && awaitingCleanResolve.length === 0 && transferClean >= transferNeeded;

  // --- pass 3 ---
  const hiddenCorrectClean = own.filter(
    (a) => a.patternGuess === topic.id && isCleanAttempt(a),
  ).length;
  const overdueResolves = reviews.filter(
    (r) =>
      ids.has(r.problemId) &&
      !r.retired &&
      !r.suspended &&
      r.due != null &&
      now - r.due >= config.overdueDays * MS_PER_DAY,
  ).length;
  const p3 = p2 && hiddenCorrectClean >= config.pass3Hidden && overdueResolves === 0;

  const pass: TopicPassLevel = p3 ? 3 : p2 ? 2 : p1 ? 1 : 0;
  return {
    topicId: topic.id,
    pass,
    touched: coveredNow.size > 0 || own.length > 0,
    evidence: {
      attempts: own.length,
      cleanAttempts,
      cleanRate: own.length > 0 ? cleanAttempts / own.length : null,
      coldAttempts,
      coldCleanAttempts,
    },
    pass1: {
      met: p1,
      total: problems.length,
      covered: coveredNow.size,
      easyTotal: easy.length,
      easyCovered: easy.filter((p) => coveredNow.has(p.id)).length,
      mediumCovered: medium.filter((p) => coveredNow.has(p.id)).length,
      mediumNeeded,
      remaining: p1 ? [] : remaining,
      reachedOn,
    },
    pass2: { met: p2, awaitingCleanResolve, transferNeeded, transferClean },
    pass3: {
      met: p3,
      hiddenCorrectClean,
      hiddenNeeded: config.pass3Hidden,
      overdueResolves,
    },
  };
}

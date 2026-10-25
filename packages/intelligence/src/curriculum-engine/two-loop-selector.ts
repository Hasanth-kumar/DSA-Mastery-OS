/**
 * Two-loop selector (overhaul P7.4; plan §6.2, D11, D12, D13). Pure: today's
 * topics, problems, attempts and re-solves in; the day's kind and its
 * progression picks out. P7.5 wires it into PlanService behind the flags.
 *
 * Each day, in order:
 *  1. **Pin.** A valid manual pin (P3.3; the caller handles expiry) is a block
 *     day for that topic, pattern shown.
 *  2. **Consolidation day.** A topic with 2+ overdue re-solves makes a mixed
 *     day led by its re-solves (`resolveTopicId`; pattern still hidden).
 *  3. **Exposure loop.** A running short block continues as a block day. With
 *     no block running and fewer than 3 patterns open, the next pattern in the
 *     P7.1 order whose hard prerequisites are at pass ≥ 1 starts its block.
 *  4. **Mixed day.** Remaining pass-1 problems from open patterns, plus at most
 *     one unseen problem from a pattern at pass ≥ 1 (the transfer check), all
 *     hidden.
 *  5. **Consolidation loop.** Once every core pattern is at pass ≥ 1, nothing
 *     new is introduced; mixed days take the lowest-pass topics, basics first,
 *     until each reaches pass 2. A topic whose hard prerequisite is below pass
 *     2 sends you to that prerequisite first. When basics and core are all at
 *     pass 2, the exposure loop resumes with the Later patterns.
 *
 * D13 rules: basics are never a block; a basic below pass 1 is open (counts
 * against the cap) and counts as a prerequisite only at pass ≥ 1. DP (1D) may
 * start despite the cap (`capExemptTopics`). While a basic is below pass 1,
 * the picks include one of its remaining pass-1 problems: an offer, so a
 * skipped day adds nothing to the next (the selector keeps no counter).
 *
 * Derived, no new state: a non-basic pattern is introduced once it has an
 * attempt or is at pass ≥ 1; its block is the first 2–4 pass-1 problems
 * (Easy first) and is done once that many of the topic's problems are
 * covered. A topic marked covered by an import with no attempts (Bit
 * Manipulation in the dev DB) is not yet introduced.
 *
 * The `why` of a mixed day never names a pattern (§6.4).
 */
import type { DayKind, TopicDifficulty } from "../types.js";
import { isFirstPassCovered } from "../problem-progress.js";
import {
  BASIC_TOPICS,
  CORE_TOPIC_ORDER,
  LATER_TOPIC_ORDER,
  findTopicByName,
  hardPrerequisitesOf,
} from "../roadmap-engine/topic-prerequisites.js";
import {
  DEFAULT_TOPIC_PASS_CONFIG,
  topicPass,
  type PassAttempt,
  type PassProblem,
  type PassReview,
  type TopicPassConfig,
  type TopicPassResult,
} from "./topic-pass.js";

export interface SelectorTopic {
  id: string;
  name: string;
  /** In a stable order (the caller's usual problem order); ties keep it. */
  problems: readonly PassProblem[];
}

export interface TwoLoopInput {
  topics: readonly SelectorTopic[];
  attempts: readonly PassAttempt[];
  reviews: readonly PassReview[];
  now: number;
  /** A manual pin that is still valid (P3.3 expiry already applied), or null. */
  pinnedTopicId: string | null;
}

export type TwoLoopPhase =
  | "pin"
  | "consolidation-day"
  | "block"
  | "mixed"
  | "consolidation-loop"
  | "idle";

export type PickRole = "pin" | "block" | "basic" | "pool" | "transfer" | "consolidate";

export interface TwoLoopPick {
  problemId: string;
  topicId: string;
  difficulty: TopicDifficulty | null;
  /** True only for the block's (or pin's) own problems on a block day. */
  revealPattern: boolean;
  role: PickRole;
}

export interface TwoLoopDay {
  dayKind: DayKind;
  phase: TwoLoopPhase;
  /** Block days: the pattern served (shown). Null on mixed days. */
  blockTopicId: string | null;
  /** Block days: covered so far and the block's size. */
  block: { covered: number; size: number } | null;
  /** Consolidation day: the topic whose re-solves lead (never shown). */
  resolveTopicId: string | null;
  /** Up to `maxPicks`, in order. */
  picks: TwoLoopPick[];
  /** Banner reason. Names a pattern only on a block day. */
  why: string;
  /** Patterns open (below pass 1, introduced or basic), for the cap. */
  openTopicIds: string[];
  /** Whether the consolidation loop is running. */
  consolidating: boolean;
  passes: TopicPassResult[];
}

export interface TwoLoopConfig {
  maxOpen: number;
  blockMin: number;
  blockMax: number;
  maxPicks: number;
  /** Overdue re-solves on one topic that make a consolidation day. */
  consolidationOverdue: number;
  basicTopics: readonly string[];
  coreOrder: readonly string[];
  laterOrder: readonly string[];
  /** May start while the cap is full (D13: DP (1D)). */
  capExemptTopics: readonly string[];
  pass: TopicPassConfig;
}

export const DEFAULT_TWO_LOOP_CONFIG: TwoLoopConfig = {
  maxOpen: 3,
  blockMin: 2,
  blockMax: 4,
  maxPicks: 2,
  consolidationOverdue: 2,
  basicTopics: BASIC_TOPICS,
  coreOrder: CORE_TOPIC_ORDER,
  laterOrder: LATER_TOPIC_ORDER,
  capExemptTopics: ["Dynamic Programming (1D)"],
  pass: DEFAULT_TOPIC_PASS_CONFIG,
};

const RANK: Record<TopicDifficulty, number> = { Easy: 0, Medium: 1, Hard: 2 };
const rank = (p: PassProblem) => RANK[p.difficulty ?? "Medium"];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const needs = (n: number) => `${plural(n, "pattern")} still need${n === 1 ? "s" : ""}`;

interface TopicView {
  topic: SelectorTopic;
  pass: TopicPassResult;
  basic: boolean;
  introduced: boolean;
  /** Most recent attempt, ms; -Infinity if never (sorts first: least recent). */
  lastPracticed: number;
  /** Problem ids attempted at least once. */
  seen: Set<string>;
}

export function selectTwoLoopDay(
  input: TwoLoopInput,
  config: TwoLoopConfig = DEFAULT_TWO_LOOP_CONFIG,
): TwoLoopDay {
  const { topics, attempts, reviews, now } = input;
  const byId = new Map<string, TopicView>();
  const problemTopic = new Map<string, string>();
  for (const t of topics) for (const p of t.problems) problemTopic.set(p.id, t.id);
  const lastByTopic = new Map<string, number>();
  const seenByTopic = new Map<string, Set<string>>();
  for (const a of attempts) {
    const tid = problemTopic.get(a.problemId);
    if (!tid) continue;
    lastByTopic.set(tid, Math.max(lastByTopic.get(tid) ?? -Infinity, a.solvedAt));
    const seen = seenByTopic.get(tid) ?? new Set<string>();
    seen.add(a.problemId);
    seenByTopic.set(tid, seen);
  }
  const basicIds = new Set(
    config.basicTopics.map((n) => findTopicByName(n, topics)?.id).filter((id): id is string => !!id),
  );
  for (const t of topics) {
    const pass = topicPass(t, attempts, reviews, now, config.pass);
    byId.set(t.id, {
      topic: t,
      pass,
      basic: basicIds.has(t.id),
      introduced: pass.pass >= 1 || pass.evidence.attempts > 0,
      lastPracticed: lastByTopic.get(t.id) ?? -Infinity,
      seen: seenByTopic.get(t.id) ?? new Set(),
    });
  }
  const views = [...byId.values()];
  const passes = views.map((v) => v.pass);
  const ordered = (names: readonly string[]) =>
    names.map((n) => findTopicByName(n, topics)).flatMap((t) => (t ? [byId.get(t.id)!] : []));
  const basics = ordered(config.basicTopics);
  const core = ordered(config.coreOrder);
  const later = ordered(config.laterOrder);
  const orderIndex = new Map([...basics, ...core, ...later].map((v, i) => [v.topic.id, i]));
  const idx = (v: TopicView) => orderIndex.get(v.topic.id) ?? Number.MAX_SAFE_INTEGER;

  const isOpen = (v: TopicView) =>
    v.pass.pass < 1 && v.topic.problems.length > 0 && (v.basic || v.introduced);
  const open = views.filter(isOpen);
  const openTopicIds = open.sort((a, b) => idx(a) - idx(b)).map((v) => v.topic.id);

  const prereqsAt = (v: TopicView, level: number) =>
    hardPrerequisitesOf(v.topic.name).every((name) => {
      const t = findTopicByName(name, topics);
      return !t || byId.get(t.id)!.pass.pass >= level;
    });

  const blockOf = (v: TopicView) => {
    const p1 = v.pass.pass1;
    const needed = p1.total < config.pass.smallTopicSize ? p1.total : p1.easyTotal + p1.mediumNeeded;
    const size = Math.min(v.topic.problems.length, config.blockMax, Math.max(config.blockMin, needed));
    return { size, covered: p1.covered, done: p1.covered >= size };
  };

  /** Next uncovered problems toward pass 1, Easy first (Hard only where pass 1 needs it). */
  const pass1Next = (v: TopicView): PassProblem[] => {
    const remaining = new Set(v.pass.pass1.remaining);
    return v.topic.problems.filter((p) => remaining.has(p.id)).sort((a, b) => rank(a) - rank(b));
  };
  /** Unseen Easy/Medium problems: the transfer check (P7.3 pass 2). */
  const unseen = (v: TopicView): PassProblem[] =>
    v.topic.problems
      .filter((p) => (p.difficulty ?? "Medium") !== "Hard")
      .filter((p) => !v.seen.has(p.id) && !isFirstPassCovered(p.status))
      .sort((a, b) => rank(a) - rank(b));

  const pick = (p: PassProblem, v: TopicView, role: PickRole, reveal: boolean): TwoLoopPick => ({
    problemId: p.id,
    topicId: v.topic.id,
    difficulty: p.difficulty,
    revealPattern: reveal,
    role,
  });
  const byRecency = (a: TopicView, b: TopicView) => a.lastPracticed - b.lastPracticed || idx(a) - idx(b);
  const basicsBelowPass1 = basics.filter((v) => v.pass.pass < 1 && pass1Next(v).length > 0);
  const guardPick = (exclude: Set<string>): TwoLoopPick | null => {
    const v = [...basicsBelowPass1].sort(byRecency).find((b) => !exclude.has(b.topic.id));
    return v ? pick(pass1Next(v)[0], v, "basic", false) : null;
  };

  const coreAll1 = core.every((v) => v.pass.pass >= 1);
  const consolidationDone = coreAll1 && [...basics, ...core].every((v) => v.pass.pass >= 2);
  const consolidating = coreAll1 && !consolidationDone;
  const day = (over: Partial<TwoLoopDay> & Pick<TwoLoopDay, "dayKind" | "phase" | "picks" | "why">): TwoLoopDay => ({
    blockTopicId: null,
    block: null,
    resolveTopicId: null,
    openTopicIds,
    consolidating,
    passes,
    ...over,
  });

  // --- mixed composition (steps 4 and 5) ---
  const mixedPicks = (): TwoLoopPick[] => {
    const picks: TwoLoopPick[] = [];
    const used = new Set<string>();
    const add = (p: TwoLoopPick | null) => {
      if (p && picks.length < config.maxPicks && !used.has(p.topicId)) {
        picks.push(p);
        used.add(p.topicId);
      }
    };
    add(guardPick(used));
    if (consolidating) {
      // Lowest pass first, basics first, then the intro order; prerequisites below pass 2 first.
      const targets = views
        .filter((v) => (v.basic || core.includes(v)) && v.pass.pass < 2 && v.topic.problems.length > 0)
        .sort((a, b) => a.pass.pass - b.pass.pass || Number(b.basic) - Number(a.basic) || idx(a) - idx(b));
      const sendBack = (v: TopicView, depth = 0): TopicView => {
        if (depth > 10) return v;
        for (const name of hardPrerequisitesOf(v.topic.name)) {
          const t = findTopicByName(name, topics);
          const pv = t ? byId.get(t.id)! : null;
          if (pv && pv.pass.pass < 2) return sendBack(pv, depth + 1);
        }
        return v;
      };
      for (const target of targets) {
        const v = sendBack(target);
        const next = v.pass.pass < 1 ? pass1Next(v) : unseen(v);
        if (next.length > 0) add(pick(next[0], v, "consolidate", false));
      }
      return picks;
    }
    const pool = views.filter((v) => isOpen(v) && !v.basic && v.introduced && blockOf(v).done && pass1Next(v).length > 0);
    for (const v of [...pool].sort(byRecency)) add(pick(pass1Next(v)[0], v, "pool", false));
    const transfer = views
      .filter((v) => v.pass.pass >= 1 && v.pass.pass < 2 && v.pass.pass2.transferClean < v.pass.pass2.transferNeeded)
      .filter((v) => unseen(v).length > 0)
      .sort(byRecency)
      .find((v) => !used.has(v.topic.id));
    if (transfer) add(pick(unseen(transfer)[0], transfer, "transfer", false));
    for (const v of [...basicsBelowPass1].sort(byRecency)) add(pick(pass1Next(v)[0], v, "basic", false));
    return picks;
  };

  // 1. Pin.
  const pinned = input.pinnedTopicId ? byId.get(input.pinnedTopicId) : undefined;
  if (pinned) {
    const next = [
      ...pass1Next(pinned),
      ...pinned.topic.problems
        .filter((p) => !isFirstPassCovered(p.status) && !pinned.pass.pass1.remaining.includes(p.id))
        .sort((a, b) => rank(a) - rank(b)),
    ];
    return day({
      dayKind: "block",
      phase: "pin",
      blockTopicId: pinned.topic.id,
      picks: next.slice(0, config.maxPicks).map((p) => pick(p, pinned, "pin", true)),
      why: `Pinned: ${pinned.topic.name}.`,
    });
  }

  // 2. Consolidation day.
  const backlog = views
    .filter((v) => v.pass.pass3.overdueResolves >= config.consolidationOverdue)
    .sort((a, b) => b.pass.pass3.overdueResolves - a.pass.pass3.overdueResolves || idx(a) - idx(b))[0];
  if (backlog) {
    return day({
      dayKind: "mixed",
      phase: "consolidation-day",
      resolveTopicId: backlog.topic.id,
      picks: mixedPicks(),
      why: `Mixed practice: ${plural(backlog.pass.pass3.overdueResolves, "re-solve")} from one pattern are overdue, so today starts with one.`,
    });
  }

  // 3. Exposure loop: a running block, or a new one.
  const introOrder = consolidationDone ? later : consolidating ? [] : core;
  const running = views
    .filter((v) => !v.basic && v.introduced && v.pass.pass < 1 && !blockOf(v).done && pass1Next(v).length > 0)
    .sort((a, b) => idx(a) - idx(b))[0];
  const exempt = new Set(
    config.capExemptTopics.map((n) => findTopicByName(n, topics)?.id).filter((id): id is string => !!id),
  );
  const starting = running
    ? null
    : introOrder.find(
        (v) =>
          !v.basic &&
          !v.introduced &&
          v.topic.problems.length > 0 &&
          prereqsAt(v, 1) &&
          (open.length < config.maxOpen || exempt.has(v.topic.id)),
      );
  const blockTopic = running ?? starting;
  if (blockTopic) {
    const block = blockOf(blockTopic);
    const own = pass1Next(blockTopic).slice(0, Math.max(0, block.size - block.covered));
    // The basics offer (D13) takes the second slot; otherwise two block problems.
    const guard = guardPick(new Set([blockTopic.topic.id]));
    const picks = own
      .slice(0, guard ? config.maxPicks - 1 : config.maxPicks)
      .map((p) => pick(p, blockTopic, "block", true));
    if (guard) picks.push(guard);
    return day({
      dayKind: "block",
      phase: "block",
      blockTopicId: blockTopic.topic.id,
      block: { covered: block.covered, size: block.size },
      picks,
      why: running
        ? `${blockTopic.topic.name}: short block, ${block.covered} of ${block.size} done.`
        : `New pattern: ${blockTopic.topic.name}. A short block of ${block.size} problems, Easy first.`,
    });
  }

  // 4–5. Mixed day.
  const picks = mixedPicks();
  if (picks.length === 0) {
    return day({ dayKind: "mixed", phase: "idle", picks, why: "Nothing new today: re-solves only." });
  }
  const left = consolidating
    ? views.filter((v) => (v.basic || core.includes(v)) && v.pass.pass < 2).length
    : open.length;
  return day({
    dayKind: "mixed",
    phase: consolidating ? "consolidation-loop" : "mixed",
    picks,
    why: consolidating
      ? `Mixed practice: ${needs(left)} a clean cold solve.`
      : `Mixed practice: ${needs(left)} a first pass.`,
  });
}

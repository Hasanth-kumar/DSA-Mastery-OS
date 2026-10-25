/**
 * P7.5: compare the P3.4 curriculum and the two-loop selector (P7.4) over the
 * next N days on the dev DB, for Santosh to eyeball.
 *
 *   pnpm dev:simulate-plan            # 14 days
 *   pnpm dev:simulate-plan --days 7
 *
 * Reads a temporary copy of the dev DB (the dev DB itself is never opened for
 * writing) and simulates in memory. Assumptions, printed with the output:
 * every progression pick is solved clean on its day; one re-solve is done a
 * day (the configured capacity) and the overflow moves forward as Today does;
 * the old path's topic signals (confidence, stage) stay as they are today.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  createIntelligenceOrchestrator,
  isRemainingFirstPass,
  ProblemReviewEngine,
  selectTwoLoopDay,
  type PassAttempt,
  type PassReview,
  type TopicState,
  type TwoLoopDay,
} from "@dsa/intelligence";
import { loadConfig } from "@dsa/shared";
import { createAppContext } from "../context.js";
import type { ProblemRepository, ProblemRow } from "../repositories/ProblemRepository.js";
import type { SyncMetaRepository } from "../repositories/SyncMetaRepository.js";
import { CurriculumService } from "../services/CurriculumService.js";
import { ProblemSuggestionService } from "../services/ProblemSuggestionService.js";
import { buildTwoLoopInput, PICK_REASONS } from "../services/two-loop-input.js";
import { dayKeyInTimeZone, learnerTimeZone } from "../lib/dayKey.js";

const DAY = 86_400_000;
const RANK: Record<string, number> = { Easy: 0, Medium: 1, Hard: 2 };

function argDays(): number {
  const i = process.argv.indexOf("--days");
  const n = i >= 0 ? Number(process.argv[i + 1]) : 14;
  return Number.isInteger(n) && n > 0 && n <= 90 ? n : 14;
}

/** Copy the dev DB (and its WAL) to a temp dir; refuse anything outside data/dev. */
function copyDevDb(path: string): { dir: string; copy: string } {
  const abs = resolve(path);
  if (!abs.includes(`${sep}data${sep}dev${sep}`)) {
    throw new Error(`Refusing to simulate on ${abs}: only a dev DB under data/dev/ is allowed.`);
  }
  if (!existsSync(abs)) throw new Error(`No dev DB at ${abs}`);
  const dir = mkdtempSync(join(tmpdir(), "dsa-simulate-"));
  const copy = join(dir, "sim.db");
  copyFileSync(abs, copy);
  for (const suffix of ["-wal", "-shm"]) if (existsSync(abs + suffix)) copyFileSync(abs + suffix, copy + suffix);
  return { dir, copy };
}

/** Just enough of ProblemRepository for CurriculumService and ProblemSuggestionService. */
function memoryProblemRepo(rows: ProblemRow[]): ProblemRepository {
  const byTopic = (topicId: string) => rows.filter((p) => p.topicId === topicId);
  return {
    findAll: () => rows,
    findByTopicId: byTopic,
    findRemainingFirstPassByTopicId: (topicId: string, options: { limit?: number } = {}) =>
      byTopic(topicId)
        .filter((p) => isRemainingFirstPass(p.status))
        .sort((a, b) => (RANK[a.difficulty ?? ""] ?? 1) - (RANK[b.difficulty ?? ""] ?? 1))
        .slice(0, options.limit ?? 3),
  } as unknown as ProblemRepository;
}

function memorySyncMeta(seed: Map<string, string>): SyncMetaRepository {
  return {
    get: (k: string) => seed.get(k) ?? null,
    set: (k: string, v: string) => void seed.set(k, v),
  } as unknown as SyncMetaRepository;
}

async function main(): Promise<void> {
  const days = argDays();
  const config = loadConfig();
  const { dir, copy } = copyDevDb(config.sqlite.path);
  const timeZone = learnerTimeZone(config.schedulers.timezone);

  let topics: TopicState[];
  let problemRows: ProblemRow[];
  let base: ReturnType<typeof buildTwoLoopInput>;
  const meta = new Map<string, string>();
  try {
    const ctx = createAppContext({
      ...config,
      sqlite: { path: copy },
      schedulers: { ...config.schedulers, enabled: false },
    });
    try {
      topics = ctx.topicRepo.findAll();
      problemRows = ctx.problemRepo.findAll().map((p) => ({ ...p }));
      for (const key of [
        "curriculum_topics",
        "curriculum_active_topic_id",
        "curriculum_active_topic_set_at",
        "curriculum_current_topic_id",
      ]) {
        const v = ctx.syncMetaRepo.get(key);
        if (v != null) meta.set(key, v);
      }
      base = buildTwoLoopInput({
        topics,
        problems: problemRows,
        attempts: ctx.attemptRepo.findAll(),
        reviews: ctx.problemReviewRepo.all(),
        pinnedTopicId: ctx.curriculumService.getConfig().activeTopicId ?? null,
        now: Date.now(),
        timeZone,
      });
    } finally {
      await ctx.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const topicName = new Map(topics.map((t) => [t.id, t.name]));
  const problemInfo = new Map(problemRows.map((p) => [p.id, p]));
  const label = (id: string) => {
    const p = problemInfo.get(id);
    return p ? `${p.name} (${p.difficulty?.[0] ?? "?"})` : id;
  };

  // Old world: P3.4 curriculum + stage-based suggestions on its own copy of the statuses.
  const oldRows = problemRows.map((p) => ({ ...p }));
  const oldRepo = memoryProblemRepo(oldRows);
  const curriculum = new CurriculumService(memorySyncMeta(meta), oldRepo, {
    curriculumV2: config.flags.curriculumV2,
  });
  const suggestions = new ProblemSuggestionService(oldRepo);
  const intelligence = createIntelligenceOrchestrator();

  // New world: the selector's input, advanced in memory.
  let newTopics = base.topics.map((t) => ({ ...t, problems: t.problems.map((p) => ({ ...p })) }));
  const attempts: PassAttempt[] = [...base.attempts];
  const reviews: PassReview[] = base.reviews.map((r) => ({ ...r }));
  const engine = new ProblemReviewEngine();

  const start = Date.now();
  console.log(`Simulating ${days} days from ${dayKeyInTimeZone(start, timeZone)} on a copy of ${config.sqlite.path}`);
  console.log(
    "Assumptions: each pick solved clean on its day; re-solves at the configured capacity, overflow moved forward; old path's topic signals frozen at today.",
  );
  console.log("Re-solves come from the same pool either way, so they are listed under the new path only.");
  console.log(
    `Flags in .env: curriculumV2=${config.flags.curriculumV2} spiralPasses=${config.flags.spiralPasses} todayQueueV2=${config.flags.todayQueueV2}\n`,
  );

  const counts = { old: new Map<string, number>(), new: new Map<string, number>() };
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (let d = 0; d < days; d++) {
    const now = start + d * DAY;
    const key = dayKeyInTimeZone(now, timeZone);
    const weekday = new Date(now).toLocaleDateString("en-GB", { weekday: "short", timeZone });
    console.log(`Day ${d + 1} · ${weekday} ${key}`);

    // --- old ---
    const sel = curriculum.selectForTopics(topics);
    if (sel) {
      const rec = intelligence.getDifficultyRecommendation(sel.topic);
      const picks = suggestions
        .selectForTopic(sel.topic, rec)
        .filter((p) => !p.problemId.includes("-suggested-"))
        .slice(0, 2);
      console.log(`  old  block · ${sel.topic.name}: ${picks.map((p) => label(p.problemId)).join(", ") || "nothing left"}`);
      for (const p of picks) {
        const row = oldRows.find((r) => r.id === p.problemId);
        if (row) row.status = "Solved";
        bump(counts.old, sel.topic.name);
      }
    } else {
      console.log("  old  (no topic)");
    }

    // --- new ---
    const capacity = [0, 6].includes(new Date(now).getDay()) ? config.resolve.slotsWeekend : config.resolve.slotsWeekday;
    const day: TwoLoopDay = selectTwoLoopDay({ topics: newTopics, attempts, reviews, now, pinnedTopicId: base.pinnedTopicId });
    const prefer = day.resolveTopicId
      ? new Set(newTopics.find((t) => t.id === day.resolveTopicId)?.problems.map((p) => p.id) ?? [])
      : undefined;
    const slots = engine.selectDueSlots(
      reviews.map((r) => ({ problemId: r.problemId, due: r.due, stability: null, lapses: 0, retired: r.retired, suspended: r.suspended })),
      capacity,
      now,
      undefined,
      prefer,
    );
    for (const def of slots.deferred) {
      const r = reviews.find((x) => x.problemId === def.review.problemId);
      if (r) r.due = def.due;
    }
    const head = day.blockTopicId ? `block · ${topicName.get(day.blockTopicId)}` : `mixed`;
    console.log(`  new  ${head} (${day.phase}; ${day.openTopicIds.length} open)`);
    console.log(`       why: ${day.why}`);
    for (const s of slots.active) {
      console.log(`       re-solve  ${label(s.review.problemId)} [${topicName.get(problemInfo.get(s.review.problemId)?.topicId ?? "") ?? "?"}] hidden`);
      const r = reviews.find((x) => x.problemId === s.review.problemId);
      if (r) r.due = now + 7 * DAY; // done; next due in a week (rough)
    }
    for (const p of day.picks) {
      console.log(
        `       ${p.role.padEnd(9)} ${label(p.problemId)} [${topicName.get(p.topicId)}] ${p.revealPattern ? "shown" : "hidden"} · ${PICK_REASONS[p.role]}`,
      );
      bump(counts.new, topicName.get(p.topicId) ?? p.topicId);
      newTopics = newTopics.map((t) => ({
        ...t,
        problems: t.problems.map((x) => (x.id === p.problemId ? { ...x, status: "Solved" } : x)),
      }));
      attempts.push({ problemId: p.problemId, solvedAt: now, dayKey: key, mistakeTags: [], helpLevel: "none", usedHelp: false, patternGuess: null });
    }
    if (day.picks.length === 0) console.log("       (no new problems)");
    console.log("");
  }

  const summary = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
  const final = selectTwoLoopDay({ topics: newTopics, attempts, reviews, now: start + days * DAY, pinnedTopicId: null });
  const byPass = [0, 1, 2, 3].map((n) => final.passes.filter((p) => p.pass === n).length);
  console.log(`Problems by pattern, old: ${summary(counts.old)}`);
  console.log(`Problems by pattern, new: ${summary(counts.new)}`);
  console.log(`New path after ${days} days: topics by pass 0/1/2/3 = ${byPass.join(" / ")}; open: ${final.openTopicIds.map((id) => topicName.get(id)).join(", ") || "none"}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

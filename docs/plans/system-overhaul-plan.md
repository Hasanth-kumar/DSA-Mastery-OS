# DSA Mastery OS — System Overhaul Plan

> **Audience:** autonomous coding agents working one session per day, plus Santosh reviewing weekly.
> **Location in repo:** `docs/plans/system-overhaul-plan.md`. It enters git through the WIP commit in §1 setup, so it is present on both `wip/focus-planner` and `overhaul`.
> **Required reading:** `docs/design-taste-and-preferences.md` is binding for every task in this plan (see §2.1 below).
> **Companion files (agents create and maintain):** `docs/plans/PROGRESS.md`, `docs/plans/QUESTIONS.md`.
> **Source:** problems identified in the Gemini review of Oct 19, 2026, plus a second-opinion review. Those findings are **claims, not verified facts.** Phase 1 verifies them before anything is built on them.

---

## 0. Why this plan exists (read once)

The backend intelligence is sophisticated, but daily use has too much friction:

| # | Problem | Severity | Phase |
|---|---|---|---|
| 1 | SM-2 schedules corrupted (weak topics scheduled for 2027–2037) by old duration-based scoring | Bug, high | 2 |
| 2 | Today page has ~5 competing sections; FocusCard is not actionable | UX, high | 5 |
| 3 | Three overlapping retention systems (topic SM-2, problem FSRS, flashcard FSRS) | Design, high | 4 |
| 4 | In-app coach and flashcards largely unused; external LLM help recorded only as a checkbox | Signal quality, medium | 6 |
| 5 | Post-solve reflection is generic tags only; no one-line takeaway | UX, medium | 6 |
| 6 | Curriculum pinned to Greedy Sorting; default list covers 12 of 50 Notion topics; PlanService ignores TopicPriorityEngine and RoadmapEngine | Bug + design, high | 3, 7 |
| 7 | "Revision needed" deadlock: CurriculumService treats it as unsolved, while ProblemRepository suggests only "Not started" problems | Bug, critical | 3 |
| 8 | DifficultyEngine gates Medium on confidence ≥ 40, so coach use keeps the learner on Easy | Design, medium | 3 |
| 9 | Prerequisite graph is visualization-only; no spiral or multi-pass curriculum | Feature, large | 7 |

**Guiding principle:** the app's most important job is to reliably put the right *due re-solve* and the right *next problem* in front of Santosh with zero hunting. Every task should serve that. Do not add features beyond this plan.

**Code corrections from P1.1 (2026-10-22).** Evidence is in `docs/plans/verification.md`. Far-future dates, the stored pin value, and the topics-table size were not queried (no dev database in that session).

- **#1.** Problem-linked sessions already use outcome scoring. `RevisionEngine.applyQuality` already clamps intervals to 7 / 21 / 45 / 120 days by confidence. Do not replace that with a flat 180-day cap (see P2.1). A one-minute helped session still maps to SM-2 quality 3, which still lengthens the interval up to the cap.
- **#6.** There is no `RoadmapEngine` class. Planning never consults `DSA_PREREQUISITES`. Primary-topic selection is `CurriculumEngine` only. The default list is 12 labels. `computePriorityScore` annotates the chosen topic; it does not choose it.
- **#8.** Medium as the primary difficulty requires confidence ≥ 60 and recent productivity ≥ 60. Confidence ≥ 40 still offers Medium as the secondary slot. Below 40 is Easy only. Coach assist subtracts 8 or 15 points before those gates.

---

## 1. Isolation strategy (decided)

**Decision: a separate git branch checked out in a separate worktree folder, with its own copy of the database and all external writes disabled.**

Why not a brand-new project folder: it loses git history and makes merging back painful, and agents would re-scaffold things that already exist. A worktree gives a physically separate folder (the live app keeps running from the original folder) while staying in the same repo, so every change merges back as a reviewable diff.

### What "not affecting the live system" means here

| Live asset | Risk | Protection |
|---|---|---|
| `main` branch / working folder | Agents edit live code | Agents work only in the `../dsa-mastery-os-overhaul` worktree on branch `overhaul`. Never check out, commit to, or push `main`. |
| Uncommitted in-flight work (`session-outcome.ts`, `topic-stage.ts`, `FocusPlanner.ts`, `FocusCard.tsx`) | Lost or duplicated | Santosh commits it to `wip/focus-planner` first; `overhaul` branches from that. |
| `dsa.db` (live SQLite) | Schedule repair or migrations corrupt real history | The worktree uses `data/dev/dsa.dev.db`, a **copy**. The live DB is never opened by agents. |
| Notion (source of truth for content) | Sync jobs write to the real workspace | Notion **writes** disabled in the worktree via env flag. Reads are allowed only if Santosh opts in; default is no network. |
| WhatsApp, OpenRouter, Ollama, Redis/BullMQ | Messages sent, quota burned, shared queues | Disabled or mocked in the worktree env. Use a different Redis DB index or prefix if Redis is required. |
| Ports | Clash with the running live app | Worktree uses different backend and frontend ports. |
| Obsidian vault | Agents append notes to the real vault | Point the vault path to `data/dev/vault/` (a copy or an empty fixture). |

### One-time setup (Santosh, about 15 minutes, before the first scheduled run)

```bash
# 1. Save in-flight work so the overhaul builds on it
cd dsa-mastery-os
git checkout -b wip/focus-planner
git add -A && git commit -m "WIP: outcome scoring, topic stages, focus planner"
git checkout main            # live app goes back to committed main

# 2. Create the isolated worktree + branch
git worktree add ../dsa-mastery-os-overhaul -b overhaul wip/focus-planner

# 3. Give it its own data
mkdir -p ../dsa-mastery-os-overhaul/data/dev
cp <path-to-live>/dsa.db ../dsa-mastery-os-overhaul/data/dev/dsa.dev.db
cp ../dsa-mastery-os-overhaul/data/dev/dsa.dev.db ../dsa-mastery-os-overhaul/data/dev/dsa.snapshot-2026-10-19.db  # pristine baseline

# 4. Copy env and override (see .env.overhaul below), then install
cd ../dsa-mastery-os-overhaul && pnpm install

# 5. Confirm the plan and design doc came across (both were committed in step 1)
ls docs/plans/system-overhaul-plan.md docs/design-taste-and-preferences.md AGENTS.md
```

If `wip/focus-planner` is not wanted (for example, the WIP is abandoned), branch `overhaul` from `main` instead and tell agents in `QUESTIONS.md`.

`.env` overrides for the worktree (exact variable names must match the codebase; task **P0.1** makes these exist if they don't):

```
DSA_DB_PATH=./data/dev/dsa.dev.db
NOTION_WRITE_ENABLED=false
NOTION_SYNC_ENABLED=false
WHATSAPP_ENABLED=false
LLM_PROVIDER=mock            # or disabled
OBSIDIAN_VAULT_PATH=./data/dev/vault
BACKEND_PORT=<live+100>
FRONTEND_PORT=<live+100>
REDIS_PREFIX=overhaul:
```

### Feature flags (so merging is safe)

Every user-visible behavior change ships behind a flag stored in the app's settings or preferences mechanism (reuse what exists; do not invent a second config system). Defaults on the `overhaul` branch are **on**. At merge time Santosh can flip them one by one on live.

Flags: `todayQueueV2`, `unifiedCompletion`, `hideTopicRevision`, `helpLevelCapture`, `takeawayField`, `curriculumV2`, `spiralPasses`.

Where they live (decided 2026-10-24, [Q-flags]): `.env` as `FLAG_<NAME>=true|false` (for example `FLAG_HIDE_TOPIC_REVISION`), read by `loadConfig` into `AppConfig.flags`. Unset means **off**, so a merge leaves live unchanged; the overhaul worktree's `.env` sets them on. `GET /api/flags` exposes them read-only. `hideTopicRevision` means "topic SM-2 retired": it switches decision signals to problem FSRS (P4.1) as well as hiding the UI (P4.3).

---

## 2. Daily agent protocol (every scheduled run)

Each run is **one session = one task** (occasionally two if both are XS). Agents must follow this exactly.

1. **Orient (≤ 5 min).** `cd` into the worktree. Confirm `git branch --show-current` is `overhaul`. If it isn't, **stop** and write to `QUESTIONS.md`. Read `CLAUDE.md`, `docs/design-taste-and-preferences.md`, this plan, `PROGRESS.md` and `QUESTIONS.md`.
2. **Pick.** Take the first task in phase order whose status is `todo` and whose dependencies are `done`. Skip tasks blocked on an unanswered question in `QUESTIONS.md`. If Santosh has answered a question, apply the answer.
3. **Safety check.** Confirm `.env` points at `data/dev/dsa.dev.db` and external writes are disabled. If anything points at live data, **stop**.
4. **Implement** following the task's *Approach*. Match the house style: pure I/O-free engines in `@dsa/intelligence`, wiring in the `context.ts` composition root, the single `buildTopicState` mapper, closed `concepts.yaml` vocabularies, and the visual rules in the design-taste doc.
5. **Test.** Add or extend unit tests for any engine or service logic. Run `pnpm typecheck`, `pnpm test` and lint. A task is not done with failing checks.
6. **Verify against the dev DB** when the task touches data (scripts are in the Appendix). Record before/after numbers in PROGRESS.md.
7. **Commit** on `overhaul` with message `overhaul(<task-id>): <summary>`. Small commits. **Never** push to or merge into `main`. Never rewrite history.
8. **Log.** Append an entry to `PROGRESS.md` (template in the Appendix), and update the task's status there.
9. **Stop.** Don't start the next task "since there's time". If the task is bigger than one session, split it into sub-tasks in PROGRESS.md, finish one sub-task cleanly, and stop.

### 2.1 Design taste is binding

`docs/design-taste-and-preferences.md` is the canonical source of the product's visual and interaction style ("Atelier Editorial"), its UX and pedagogical guardrails, and its architectural house style. Every agent reads it in full on every run, and follows it:

- **Before any UI task** (anything in `@dsa/frontend`, especially Phases 4–6), re-read §2 (visual aesthetic) and §3 (UX principles). Reuse existing tokens, type voices and components. No new colors, fonts, shadows, boxed card grids, pills or rounded thick progress bars. Sections sit on the canvas separated by hairlines.
- **Before any engine or service task**, re-read §4 (architecture house style).
- **Product guardrails apply to every task:** zero LLM and zero network on the hot path (warm-up, review, re-solve, Today queue); tap-driven logging; no backlog guilt; protect problem-solving time.
- In the PROGRESS.md entry for any UI task, add a line `Design check:` naming which rules from the doc the change follows, or which it deviates from and why.
- If a task in this plan seems to conflict with the design doc, the design doc wins. Write the conflict to `QUESTIONS.md` and pick the design-doc-compliant option.
- **One sanctioned exception:** the design doc's §1.3 "pull features by real pain / under ~1 hour" rule limits *new features*. This plan is the reviewed, approved scope for the overhaul, so its tasks may run longer than an hour. Anything *not* in this plan still falls under §1.3 and goes to `## Ideas (not scheduled)`.

### Hard rules

- Never touch the live DB, the live Notion workspace, the real Obsidian vault, or `main`.
- Never delete user data, even in the dev DB, without a reversible migration and a snapshot.
- No new dependencies unless the task says so. If one seems necessary, ask in `QUESTIONS.md`.
- No scope creep. Ideas go in a `## Ideas (not scheduled)` section of PROGRESS.md.
- Any decision marked **🔶 Santosh decides** uses the stated *default* only if that question has gone unanswered for 3 runs. Log that the default was taken.
- If a Phase 1 verification contradicts this plan, **correct the plan** (edit the task, note why in PROGRESS.md) instead of building on a false premise.

---

## 3. Phases and tasks

Sizes: **XS** < 30 min · **S** ≈ 1 session · **M** ≈ 2 sessions (split it) · **L** ≈ 3+ sessions (split it).

### Phase 0 — Environment hardening

**P0.1 Make data paths and external integrations configurable** · S
- *Goal:* the worktree can run with zero risk to live assets.
- *Approach:* find where the DB path, Notion client, WhatsApp, LLM provider, Obsidian path, Redis connection and ports are configured. Route each through env vars (see §1). Notion: add a write guard at the adapter layer in `@dsa/integrations`, so any write call becomes a logged no-op when `NOTION_WRITE_ENABLED=false`. Same for WhatsApp sends.
- *Acceptance:* with the overhaul `.env`, starting backend and frontend makes no outbound writes (grep the logs). The app reads `dsa.dev.db`. A test asserts the Notion write guard.

**P0.2 Dev-DB snapshot and reset scripts** · XS
- `pnpm dev:snapshot` copies `dsa.dev.db` to `data/dev/snapshots/<timestamp>.db`. `pnpm dev:reset` restores from the pristine baseline. Agents snapshot before any data-mutating task.

**P0.3 Baseline metrics script** · S
- `pnpm dev:metrics` prints the numbers Gemini quoted, so every later claim is checkable: sessions, total minutes, attempts, problems by status, per-topic confidence and SM-2 `next_review` / `sm2_interval`, `problem_reviews` count and due count, `cards` and `card_events` counts, last `chat_messages` date, coach-used attempts, the mistake-tag distribution, and `sync_meta.curriculum_active_topic_id`.
- Save the first output to `docs/plans/baseline-metrics.md`.

### Phase 1 — Verify the diagnosis (no behavior changes)

**P1.1 Verify problems #1, #6, #7, #8 in code and data** · S
- Confirm or refute each, with file and line references and query output:
  - SM-2 far-future dates exist, and identify the scoring code that caused them.
  - `CurriculumService.buildProblemCounts()` treats `status !== "Solved"` as unsolved.
  - `ProblemRepository.findUnsolvedByTopicId()` queries only `"Not started"`.
  - `PlanService` bypasses `TopicPriorityEngine` / `RoadmapEngine`.
  - `curriculum_active_topic_id` pin value, and how it is set and cleared.
  - `default-topics.ts` coverage versus the topics table.
  - `DifficultyEngine` thresholds.
- *Output:* `docs/plans/verification.md`, with a table of claim → verdict (confirmed / partly / wrong) → evidence. Update this plan where wrong.

**P1.2 Map dependents of topic-level SM-2** · S
- *Goal:* know what breaks if the SM-2 UI is retired.
- List every reader of SM-2 fields (`sm2_interval`, ease, next review, revision grades): engines, services, routes, UI, and analytics such as the knowledge graph and topic priority. Classify each as *UI only* (safe to hide) or *feeds decisions* (needs a replacement signal).
- *Output:* a section in `verification.md`. This gates Phase 4.

**P1.3 Map the Today page data flow** · XS
- List every component on `TodayPage.tsx`, its endpoint and its source service. Note duplicates (the same problem shown in two places). This is the input for Phase 5.

### Phase 2 — Data integrity (#1)

**P2.1 Confirm the scorer fix stops the corruption** · S · depends P1.1
- Already on this branch (P1.1): problem-linked sessions call `deriveSessionOutcomeScore`, and `RevisionEngine.applyQuality` passes `maxIntervalDaysForConfidence` (7 / 21 / 45 / 120 days). Keep those caps. A flat 180-day cap would loosen them. `sm2Update` stays uncapped only when a caller omits `maxInterval`; production has one caller and it passes the cap.
- *Acceptance:* one regression test through the production path shows a 1-minute session with heavy hints on a weak topic stays inside that topic's confidence cap and is not scored as SM-2 quality 5. Do not change the rule that quality ≥ 3 lengthens the interval. That is ordinary SM-2; the far-future bug was quality 5 with no cap.

**P2.2 Run and validate schedule repair on the dev DB** · S · depends P2.1, P0.2
- Snapshot, then run `pnpm db:repair-schedules` against `dsa.dev.db`. Re-run `dev:metrics`. Every weak topic (confidence < 40) must have `topics.next_revision_at` (the column this plan calls `next_review`) within 14 days, and none beyond the confidence cap from P2.1.
- If the repair logic is wrong, fix it (with tests) and re-run from the snapshot.
- *Output:* before/after table in PROGRESS.md. Write `docs/plans/live-migration-steps.md` describing exactly how Santosh should run this on the live DB at merge time (backup command first). **Agents never run it on live.**

### Phase 3 — Unblock the curriculum (#7, #6, #8)

**P3.1 One definition of "covered" vs "mastered"** · S · depends P1.1
- *Approach:* introduce a single pure helper in `@dsa/intelligence` (for example `problemProgress.ts`):
  - `isFirstPassCovered(status)` → `Solved` or `Revision needed`.
  - `isRemainingFirstPass(status)` → `Not started`.
  - Retention of `Revision needed` problems is owned by FSRS `problem_reviews`, not by the curriculum.
- Make both `CurriculumService.buildProblemCounts()` and `ProblemRepository` / `ProblemSuggestionService` use it. Remove the divergent logic.
- *Acceptance:* tests show (a) a topic whose problems are all `Revision needed` counts as first-pass complete, and (b) suggestions never return "add problems in Notion" while other topics still have `Not started` problems.

**P3.2 Ensure every `Revision needed` problem is in the re-solve pool** · XS · depends P3.1
- Audit: each problem with status `Revision needed` must have a `problem_reviews` row. Backfill the missing ones with a reversible migration (snapshot first). Log the count.

**P3.3 Make the manual topic pin safe** · S · depends P3.1
- Keep manual pinning as a user override, but:
  - show it visibly ("Pinned: Greedy Sorting · Unpin") on Today;
  - auto-expire the pin when the pinned topic's first pass is complete (P3.1 definition), or after **7 days** (D2 answered 2026-10-24), whichever comes first, logging the reason.
- Clear the current pin in the **dev DB** only. Add the live-unpin step to `live-migration-steps.md`.
- *Acceptance:* tests for expiry. Today on the dev DB no longer serves only Greedy Sorting.

**P3.4 PlanService consults the priority and roadmap engines** · S · depends P3.1
- Primary-topic selection: honor a valid manual pin, else ask the curriculum for the next topic, ranked by `TopicPriorityEngine` among candidates the roadmap allows. Keep it a pure engine call wired in `context.ts`.
- There is no `RoadmapEngine` today (P1.1). Roadmap data is `DSA_PREREQUISITES` plus visualization-only graph edges. This task introduces the consultation; it does not wrap an existing engine. `PlanService` already calls `computePriorityScore` after the topic is chosen, for a divergence note only.
- This is the interim selector. Phase 7 replaces its internals with spiral passes behind `curriculumV2`.

**P3.5 Difficulty by stage, not raw confidence** · S · depends P3.1
- Current gates are confidence plus recent productivity, not confidence alone (P1.1): Medium as primary starts at 60 with productivity ≥ 60; ≥ 40 is Easy primary with Medium secondary; below 40 is Easy only. Coach assist discounts confidence first. Replace that table with stage-aware picking (use `topic-stage.ts` stages):
  - `learning` (attempts 1–2 in the pattern): 1 Easy, then a standard Medium.
  - `practicing` (attempt 3+): Medium. Drop to Easy only if the last attempt was `could-not-solve`.
  - `retaining` (confidence ≥ 70 and coach assist < 25%): Hard or hybrid Medium allowed.
- *Acceptance:* table-driven tests for each stage. On the dev DB, Two Pointers or BFS now offers Medium.

### Phase 4 — Unify retention (#3)

Target model, with one job each:

| System | Job | Unit | Where it appears |
|---|---|---|---|
| **Problem re-solve (FSRS)** | Cold code execution | 20–45 min | Today queue (≤ 1 due per day by default) and Re-solve tab |
| **Flashcards (FSRS)** | Pattern recognition | seconds | Review tab, opt-in; optional 3-card warm-up |
| **Topic SM-2** | *Retired from UI.* Topic analytics keep a replacement signal if P1.2 says it's needed | — | Nowhere on Today |

**P4.1 Replacement signal for any decision that reads SM-2** · S · depends P1.2
- For each "feeds decisions" dependent found in P1.2, derive the signal from problem-level FSRS (for example, a topic is "due" if it has ≥ 1 overdue re-solve; topic retention = mean FSRS retrievability of its problems). Pure function plus tests. Skip this task if P1.2 found none.
- P1.2 found two that need a replacement (`verification.md` F4, F6): `urgencyScore` in topic priority, and `revision_count` skipping increments after a graded warm-up. The plan's revision queue, its duration minutes and its deferral write (F1–F3) need an off switch, not a new signal.

**P4.2 One completion flow for new problems and re-solves** · M (split: backend, then UI) · depends P3.2
- *Backend:* a single "complete attempt" service path that handles both kinds. It infers the FSRS rating from solve time versus the target (25 / 45 / 75 min for E/M/H), help level, and mistake tags, so no manual rating is needed. A problem that was hard or needed help enters or updates `problem_reviews`. A clean, fast cold solve extends its interval and can eventually retire it.
- *UI:* `ResolveCompleteForm` is replaced by the same Done → MistakeCapture flow (flag `unifiedCompletion`). Santosh's requirement (2026-10-24): a re-solve logs exactly like a new problem on Today — Start opens the LeetCode tab and starts the timer, the time runs until ✓ Done, then MistakeCapture flags mistakes. No outcome picker.
- *Acceptance:* tests for rating inference across the matrix (fast and clean → Easy/Good; slow or heavy help → Hard/Again).

**P4.3 Hide the topic Revision column and the post-solve revision popup** · XS · depends P4.1
- Behind `hideTopicRevision`. Hide only; don't delete code until after merge and a week of live use.
- With the flag on, `PlanService` also skips the revision queue's deferral write and its 25 minutes per revision topic (P1.2, `verification.md` F2–F3). Otherwise hidden topics keep being rescheduled and budgeted.

**P4.4 Demote flashcards from the hot path** · XS
- Warm-up on Today becomes optional and collapsed (default **off**; decided by Santosh 2026-10-24, D5). The Review tab is unchanged.

### Phase 5 — One Today cockpit (#2)

**P5.1 Today session queue endpoint** · M · depends P3.4, P3.5, P4.2
- One backend endpoint (for example `GET /today/plan`) returns an ordered list of blocks, built by `FocusPlanner`:
  1. *(optional)* warm-up flashcards
  2. **Re-solve**: at most 1 due FSRS problem, the most overdue first, preferring patterns other than today's primary topic
  3. **Progression**: 1–2 problems at stage-appropriate difficulty. On a **block day** (a new pattern's short block is in progress, §6.2) these come from that pattern. On a **mixed day** they come from covered patterns: remaining pass-1 problems, plus at most 1 unseen problem from a pattern already at pass 1 as a cold transfer check (§6.3).
- The queue carries a `dayKind` (`block` | `mixed`). Every block carries `revealPattern: boolean`: true only for the current block's own problems. Re-solves and mixed rows are false, and the API must not send their topic name to Today until the attempt is done (§6.4). Until P7.4 lands, every day is a block day for the P3.4 primary topic, which is today's behavior.
- Each block carries `problemId`, kind, estimated minutes, and a `reason` string ("needed help on Oct 2 · due today"). A reason for a hidden-pattern row never names the pattern or a pattern-specific mistake.
- Keep the existing re-entry mode (≥ 3-day gap → one 20-minute Easy, no backlog) and catch-up compression rules.
- A `decision` object explains the day: primary topic, stage, progress in pattern, and why.
- P1.3 (`verification.md`, P1.3 section): the queue must be the only list of problems on Today (duplicates D1–D4). Invalidate the cached plan on `"resolve"` events too, so a skipped re-solve leaves Today at once. Build the plan once per poll, not also inside `/api/analytics/dashboard`.

**P5.2 Render the queue in the Suggested problems list** · S · depends P5.1
- Decided with Santosh (2026-10-24): the queue renders in the existing Suggested problems section, which he likes; no new FocusCard surface. The re-solve block is the first row, marked as a re-solve with a small label in the existing type voices and a hairline (for example `RE-SOLVE · due since Oct 2`) plus its `reason`; no new colors, badges or pills. Progression rows below keep today's look. The FocusCard is hidden; its reasoning and week progress move into the P5.3 banner. See `docs/design-taste-and-preferences.md` §3.3.
- Each block has **Start** (timer), **✓ Done** (opens the unified completion flow), and **Coach ↗**. Completing a block advances the queue in place. No scrolling, no hunting.
- Header (decided with Santosh 2026-10-25, §6.4): on a block day the hero shows the pattern name exactly as Today does now. On a mixed day it shows its own header, `Mixed practice · N problems · ~M min`, and names no pattern. Rows with `revealPattern: false` show only the problem name, difficulty and the reason. Coach ↗ on a hidden row must not put the pattern name in the coach prompt before the attempt is done.

**P5.3 Stats strip and decision banner** · S · depends P5.1
- Strip: topics touched / total; problems attempted, clean solved, and in re-solve cycle; sessions this week / target 5; current tier and stage.
- Banner: the `decision` text plus a "Switch pattern" override, which creates a pin (with P3.3 expiry).
- On a mixed day neither the strip nor the banner names today's patterns (§6.4). Show overall progress instead (patterns at each pass, sessions this week), and keep the per-pattern detail on the Graph and Re-solve tabs.

**P5.4 Remove duplicate surfaces from Today** · S · depends P5.2, P5.3
- Behind `todayQueueV2`: the Suggested problems list becomes the queue (P5.2). Hide the collapsed `ResolveTodaySection`, the `FocusCard`, and (with `hideTopicRevision`) the topic Revision column and post-solve revision offer. The full pools stay on their own tabs. Today = banner, strip, queue list, Up next.
- *Acceptance:* every problem appears at most once on Today. Visual check against the design-taste doc (canvas-first, hairline separators, no boxed cards).

### Phase 6 — Better signals: help capture and reflection (#4, #5)

**P6.1 Help-level capture replaces the coach checkbox** · S
- MistakeCapture gets a 4-option tap row: **None / Hint / Approach / Full solution**, plus a source (In-app coach / External AI / Other).
- Store it with a reversible migration. Keep the old boolean derived (`help > None`) for backward compatibility. Feed help level into the P4.2 rating inference and the confidence updates. "Approach" and "Full solution" weigh more than "Hint".
- Flag `helpLevelCapture`.
- Same tap row, added 2026-10-25 (§6.4): for a hidden-pattern row, MistakeCapture first asks **"Which pattern did you use?"** (one tap from the patterns already introduced, plus "Not sure"), then reveals the real pattern. Store the guess on the attempt. A correct guess is the recognition signal that pass 3 uses (§6.3).
- "Clean" everywhere in this plan means: no `wrong-approach` tag and help ≤ Hint.

**P6.2 One-line takeaway field** · S
- An optional single-line input: "What tripped you up / the invariant". Saved on the attempt. Appended to the problem's Obsidian note when the vault integration is enabled (dev vault only in the worktree). The latest takeaway shows on that problem's re-solve block as a pre-solve reminder.
- Flag `takeawayField`.

**P6.3 Sharper mistake tags** · XS
- Add `greedy-invariant` and `loop-bounds` to the closed vocabulary, and make sure `FocusPlanner` CHECKLISTS tags and the teaching-strategy tags match (Gemini flagged a mismatch). Single source of truth for tags.
- Corrected 2026-10-25 while building it: `concepts.yaml` is the per-pattern flashcard concept vocabulary, not the mistake tags. The mistake vocabulary is `MistakeTag` in `packages/intelligence/src/types.ts`; that is now the single source.

**P6.4 Pre-solve pattern gate** · **dropped** (D6, Santosh 2026-10-25: over-engineering). Do not build.

### Phase 7 — Two-loop curriculum with spaced passes (#9, rest of #6)

**Behind `curriculumV2` and `spiralPasses`.** Redesigned 2026-10-25 from Santosh's own approach and the research in §6. Read §6 before any Phase 7 task. Start simple and extend only if needed.

**P7.1 Introduction order and hard prerequisites for all 50 topics** · S · 🔶 Santosh approves (D7)
- Produce `docs/plans/topic-tiers.md` with two things for every Notion topic (the 50 real names, not the generic list):
  1. A **priority order for introducing** patterns (what to start next). This is not a gate. Start from Santosh's direction: early exposure to Greedy and DP is wanted, and the basics (Two Pointers, Sliding Window, Hashing, Fast & Slow, Stack, Binary Search) are already familiar enough to consolidate later.
  2. A short list of **hard prerequisites**: only where a pattern is built from another (for example Recursion & Backtracking → DP topics; BFS / DFS → Topological Sort, Dijkstra, Union-Find, MST; Heap → Top-K, Greedy with Heap; Binary Search → Binary Search + Greedy / + Prefix Sum / on Matrix). Everything else has none.
- **Stop and ask Santosh to approve it in `QUESTIONS.md`** before P7.4. Default after 3 unanswered runs: the agent's proposal.

**P7.2 Promote prerequisites to a shared DAG** · S · depends P7.1
- Move prerequisite data out of the visualization-only `graph-edges.ts` into a shared module consumed by both the graph view and the curriculum. Its edges are the P7.1 hard prerequisites. Validate it as acyclic in a test. One source of truth.

**P7.3 Pass tracking per topic** · S · depends P3.1, P6.1
- Pure function `topicPass(topic, attempts, reviews)` → (decided 2026-10-25, D4; §6.3). "Covered" is the P3.1 definition; "clean" is no wrong-approach and help ≤ Hint (P6.1; before P6.1 lands, use the coach flag as help > None).
  - `0` untouched.
  - `1` **exposure** (D3): if the topic has fewer than 4 problems, all of them covered; otherwise all Easy covered **and** at least `min(3, #Medium)` Medium covered.
  - `2` **consolidated**: pass 1, **and** every problem in the topic that was solved with help (or not clean) has since had a clean cold solve in a *later* session (a re-solve), **and** at least `min(2, unseen Easy/Medium left)` problems first attempted after pass 1 were solved clean on the first try. A topic with no unseen problems left skips that last part. No fixed problem count.
  - `3` **retained**: pass 2, **and** at least 2 hidden-pattern attempts on this topic where the pattern guess was right and the solve was clean, **and** no overdue re-solves. Hards count toward pass 3 only; they are never required for passes 1–2.
- Keep performance and evidence separate (§6.3): expose the clean-solve rate and the number of cold attempts, not one blended score.
- Tests for each boundary, including a 2-problem topic, a topic with no Easy, and a topic where every remaining problem is Hard.

**P7.4 Two-loop selector** · M · depends P7.2, P7.3, P3.4
- Pure engine. Each day it returns `dayKind` and the progression picks for P5.1:
  1. A manual pin (P3.3) overrides everything; a pinned topic is served as a block.
  2. **Consolidation day:** if a covered topic has ≥ 2 overdue re-solves, today is a mixed day led by that topic's re-solves (pattern still hidden).
  3. **Exposure loop:** if fewer than 3 patterns are introduced but below pass 1, start the next pattern in the P7.1 order whose hard prerequisites are at pass ≥ 1. Its **short block** is its first 2–4 problems (Easy first, then Medium), served on block days with the pattern shown (§6.2). When the block is done, its remaining pass-1 problems join the mixed pool.
  4. Otherwise a **mixed day**: remaining pass-1 problems from introduced patterns, plus at most 1 unseen problem from a pattern at pass ≥ 1 (the transfer check), all hidden.
  5. **Consolidation loop:** once the core patterns in the P7.1 order are all at pass ≥ 1, step 3 stops introducing and mixed days favor the lowest-pass topics, starting with the basics, until they reach pass 2. A topic whose hard prerequisite is below pass 2 sends you back to that prerequisite first.
- Emits the `decision` reason for the banner. On a mixed day it must not name today's patterns (§6.4), for example "Mixed practice: 3 patterns still need a clean cold solve."
- From D13 (2026-10-25, `topic-tiers.md` §1, §6): **basics** (topic-tiers §1) are never introduced as a block; a basic below pass 1 is open and counts against the 3-open cap, and counts as a prerequisite only at pass ≥ 1. **Starting set:** DP (1D) is introduced at once alongside the open basics, as the one exception to the cap. **Basics guard:** while any basic is below pass 1, each day's progression picks include at least one remaining pass-1 problem from a basic. It is an offer, not a debt: a skipped day adds nothing to the next.
- From D14 (2026-10-25, the P8.2 dry run on live): a block with a gap of 14+ days between its attempts (or since the last) is interrupted for good; its pass-1 problems join mixed days and it never becomes a block day again. A started pattern, in a block or mixed, is served only once its hard prerequisites are at pass ≥ 1.
- *Acceptance:* scenario tests covering a block running to completion, the switch to mixed days, the 3-open-pattern cap, a consolidation day, a prerequisite send-back, and the move into the consolidation loop; plus the D13 rules: basics hold the cap, the DP (1D) starting exception, the one-basic-a-day guard, and no stacking after a skipped day.

**P7.5 Wire into PlanService behind the flag; compare old vs new** · S · depends P7.4
- With `curriculumV2` off, use P3.4 behavior. With it on, use the two-loop selector. Add `pnpm dev:simulate-plan --days 14`, which prints both selectors' picks and each day's `dayKind` for the dev DB, for Santosh to eyeball.

### Phase 8 — Merge readiness

**P8.1 Live migration runbook** · S
- Complete `docs/plans/live-migration-steps.md`: backup command, migrations in order, schedule repair, unpin, flag defaults, rollback steps, and verification queries.

**P8.2 Dry-run the runbook on a fresh copy of the live DB** · S
- Santosh supplies a fresh copy. The agent runs the runbook against it in `data/dev/` and confirms metrics.

**P8.3 Merge PR description** · XS
- Summarize all changes, flags, migrations and known gaps. **Santosh merges; agents never do.**

---

## 4. Open decisions for Santosh

Agents copy these into `QUESTIONS.md` on day 1. Defaults apply only after 3 unanswered runs.

| ID | Question | Default |
|---|---|---|
| D1 | Branch `overhaul` from the WIP commit (`wip/focus-planner`) or from `main`? | WIP |
| D2 | Pin auto-expiry duration | 14 days (answered 2026-10-24: 7 days) |
| D3 | Pass 1 quota per pattern (3 / 4 / 5) | 4 (answered 2026-10-24: difficulty-aware rule, see P7.3) |
| D4 | Pass 2 gate: count only, or count + ≥ 2 clean cold solves | count + clean (answered 2026-10-25: spaced clean re-solves + transfer, no fixed count; see P7.3, §6.3) |
| D5 | Flashcard warm-up on Today: off / optional / always | optional, off (answered 2026-10-24: optional, off) |
| D6 | Build the pre-solve pattern gate? | build, flag off (answered 2026-10-25: no, dropped) |
| D7 | Approve the introduction order and hard prerequisites in `topic-tiers.md` (redefined 2026-10-25) | proposal in P7.1 |
| D8 | Max re-solves on Today per day | 1 (answered 2026-10-24: 1) |
| D9 | Allow Notion **reads** in the worktree (needed if 50-topic data isn't fully in the dev DB) | no; use dev DB only |
| D11 | Short block size for a new pattern | answered 2026-10-25: 2–4 problems |
| D12 | Mixed-day composition | answered 2026-10-25: 1 re-solve + 1–2 problems, with at most 1 unseen transfer-check problem |

---

## 5. Expected pace and weekly review

About 30 tasks, roughly **5–6 weeks** at one task per day (19 left on 2026-10-25, P6.4 dropped). Phases 0–3 (the critical bug fixes) should land in about week 1–2.

**Weekly review checklist for Santosh (≈ 20 min):**
1. Read `PROGRESS.md` entries since the last review and answer anything in `QUESTIONS.md`.
2. `git log main..overhaul --oneline` to scan commits. Spot-check one diff.
3. Run the worktree app (`pnpm dev` on the overhaul ports) and click through Today once.
4. Run `pnpm dev:metrics` and compare against `baseline-metrics.md`.
5. Correct course by editing this plan; agents follow the plan as written.

---

## 6. Learning model (decided 2026-10-25)

Agreed with Santosh after a research pass. Phases 5–7 implement it. Where a task and this section disagree, this section wins; note the conflict in PROGRESS.md.

### 6.1 Research basis
- **Mixed practice trains pattern recognition.** In a 9-week classroom study, interleaved maths practice scored about 72% on a delayed test against about 38% for blocked practice (d = 1.05). The mechanism: blocked practice tells you the strategy, so you never practise choosing it. A 59-study meta-analysis finds a moderate overall benefit (g = 0.42), smaller and less consistent for maths-type tasks (g = 0.34), and largest when categories look alike, which fits DSA patterns. Learners nearly always *feel* blocked practice is better; 87% did in one study even when tests showed otherwise.
- **Beginners need a short block first.** The expertise-reversal research: worked examples and similar problems back to back help novices, and the same support becomes redundant once the pattern is known. Mixing pays off once the patterns can be told apart.
- **Early struggle is fine; shallow coverage is not.** Productive-failure work supports attempting problems before feeling ready. The main criticism of spiral curricula is "a mile wide and an inch deep": revisits stacked on weak foundations. Real prerequisites still matter; a fixed topic order has no evidence behind it.
- **Spaced cold success beats finishing a topic.** Successive relearning: recalling an item once in each of 3 spaced sessions gave 68% one-week retention, against 26% for 3 recalls in one session. A randomised ALEKS study found a higher mastery bar cost about 30% more time for a small retention gain that faded. Mastery research recommends tracking performance and amount of evidence separately.
- **Help changes what counts.** In the ALEKS study the higher bar mattered most when the learner had viewed an explanation.
- **Data fit.** The dev DB has 286 problems (52 Easy, 183 Medium, 51 Hard); the median topic has 5 problems and only 19 of 50 have 7 or more, so pass rules scale per topic.
- **Limits.** Most evidence is from maths, physics and category learning, not DSA; no study compares DSA curricula. Sources: Brunmair & Richter 2019 (Psychological Bulletin); Rohrer, Dedrick & Burgess 2014; Yan & Sana 2021; Rawson & Dunlosky successive-relearning review (Current Directions, 2022); ALEKS mastery-threshold experiment (JEDM); Pelánek, conceptual issues in mastery criteria; Cepeda et al. 2008; Sinha & Kapur 2021.

### 6.2 Order of learning: two loops
- **Exposure loop.** Move through the core patterns, Greedy and DP included, without waiting to perfect the basics. Each new pattern gets a **short block of 2–4 problems** with its name shown. After that it only comes back mixed.
- **Consolidation loop.** Return to the basics and deepen them, bringing Greedy and DP thinking along, then the other patterns, until each reaches pass 2.
- **Tiers are only an introduction order**, never a gate. A pattern waits only on its hard prerequisites (P7.1).

### 6.3 Passes (per topic)
| Pass | What it takes |
|---|---|
| 1 Exposure | All Easy plus up to 3 Medium, or everything if the topic has fewer than 4 problems |
| 2 Consolidated | Problems needing help re-solved clean in a later session, plus up to 2 unseen problems solved clean first try |
| 3 Retained | Recognised and solved clean when hidden in mixed practice (2+ times), Hards, no overdue re-solves |

"Clean" = no wrong-approach and help ≤ Hint. Exact rules in P7.3.

### 6.4 Today page
- **Block day:** the hero shows the pattern name as it does now.
- **Mixed day:** its own header, `Mixed practice · N problems · ~M min`, no pattern names.
- **Re-solves and mixed rows** never show their pattern before Done: only the problem, difficulty and a reason that doesn't name the pattern ("needed help on Oct 2 · due today").
- **After ✓ Done** on a hidden row: "Which pattern did you use?" (one tap), then the real pattern is revealed (P6.1).
- **Strip and banner** never name today's patterns on a mixed day (P5.3).
- **Accepted leaks:** LeetCode's own Topics tags (don't expand them) and titles that give the pattern away.

---

## Appendix A — PROGRESS.md template

```markdown
# Overhaul Progress

## Status board
| Task | Status | Commit | Notes |
|---|---|---|---|
| P0.1 | done | abc123 | ... |
| P0.2 | todo | | |

## Log
### 2026-10-20 — P0.1 Make data paths configurable
- Did: ...
- Tests: typecheck ✅ test ✅ lint ✅
- Data check: (before/after if relevant)
- Surprises / plan corrections: ...
- Next suggested task: P0.2

## Ideas (not scheduled)
- ...
```

## Appendix B — QUESTIONS.md template

```markdown
# Questions for Santosh
## Open
- [D3] Pass 1 quota per pattern — default 4. Asked 2026-10-20. Runs waiting: 0
## Answered
- [D1] → WIP branch (2026-10-21)
```

## Appendix C — Daily scheduled-task prompt

> You are continuing the DSA Mastery OS system overhaul. Work only in the `dsa-mastery-os-overhaul` worktree on branch `overhaul`. Read `CLAUDE.md`, `docs/design-taste-and-preferences.md` (in full; it is binding, see §2.1 of the plan) and `docs/plans/system-overhaul-plan.md`, then follow §2 "Daily agent protocol" exactly: orient, pick the next eligible task, run the safety check, implement, test, commit to `overhaul`, append to `docs/plans/PROGRESS.md`, and stop. Never touch `main`, the live database, Notion writes, WhatsApp, or the real Obsidian vault. If anything is unclear or unsafe, write to `docs/plans/QUESTIONS.md` and stop. End with a 3-line summary: task done, tests status, next task.

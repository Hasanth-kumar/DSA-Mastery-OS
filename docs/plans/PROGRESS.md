# Overhaul Progress

## Status board
| Task | Status | Commit | Notes |
|---|---|---|---|
| P0.1 | done | 01fb24f | isolation env vars + Notion/WhatsApp write guards |
| P0.2 | done | 54b560f | snapshot and reset scripts; refuse live paths |
| P0.3 | done | 9968459 | script only; baseline-metrics.md is local-only (no dev db) and gitignored |
| P1.1 | done | 9b234f2 | code verdicts in verification.md; data queries local-only |
| P1.2 | done | 0c66fa9 | SM-2 dependents in verification.md; 7 feed decisions, 10 UI only |
| P1.3 | done | 738d136 | Today data flow in verification.md; 11 surfaces, 7 duplicates |
| P2.1 | done | c1f4139 | regression test only; existing 7/21/45/120 caps kept |
| P2.2 | todo | | local-only (needs dev db) |
| P3.1 | todo | | |
| P3.2 | todo | | |
| P3.3 | todo | | |
| P3.4 | todo | | |
| P3.5 | todo | | |
| P4.1 | todo | | |
| P4.2 | todo | | |
| P4.3 | todo | | |
| P4.4 | todo | | |
| P5.1 | todo | | |
| P5.2 | todo | | |
| P5.3 | todo | | |
| P5.4 | todo | | |
| P6.1 | todo | | |
| P6.2 | todo | | |
| P6.3 | todo | | |
| P6.4 | todo | | |
| P7.1 | todo | | |
| P7.2 | todo | | |
| P7.3 | todo | | |
| P7.4 | todo | | |
| P7.5 | todo | | |
| P8.1 | todo | | |
| P8.2 | todo | | |
| P8.3 | todo | | |

## Log
### 2026-10-24 — P2.1 Confirm the scorer fix stops the corruption
- Did: Added one regression test to `packages/backend/src/services/session-outcome-scoring.test.ts`. It runs the production path: four coach hints recorded through `ctx.coachUsage`, then `SessionService.completeSession`, then `RevisionEngine.applyQuality`. The weak topic (confidence 20) starts from a grown SM-2 state (interval 30, repetition 4, ease 2.5). A 1-minute session logged as smooth scores below 80, so it does not get SM-2 quality 5. The interval stays at or under the 7-day cap for confidence below 40, and `next_revision_at` is no more than 7 days out. The ease factor drops below 2.5, which only happens at quality 3 or lower. No production code changed. The 7 / 21 / 45 / 120 caps and the rule that quality ≥ 3 lengthens the interval are unchanged.
- Tests: `pnpm build` ✅ `pnpm lint` ✅ `pnpm test` ✅ (no `pnpm typecheck` script; build typechecks). Mutation check: with the cap in `RevisionEngine.applyQuality` replaced by infinity, the new test fails (interval 71 days against a cap of 7), and so does the existing "never schedules a topic beyond…" test. I then restored the cap. The health test again created `data/sqlite/dsa.db`, which I deleted.
- Data check: code-only mode — no `.env`, no credentials, no `data/dev/dsa.dev.db`. No data needed.
- Surprises / plan corrections: none. P2.2 needs the dev database (schedule repair plus before/after metrics), so it is local-only here. The next eligible code task is P3.1.
- Next suggested task: P2.2 locally; in code-only mode, P3.1.

### 2026-10-23 — P1.3 Map the Today page data flow
- Did: Added a P1.3 section to `docs/plans/verification.md`. It lists the six endpoints Today polls every 60 seconds and the service behind each, the 11 surfaces on `TodayPage.tsx` (T1–T11) with their data and actions, and seven duplicates (D1–D7). The same new problem appears in FocusCard and as Suggested row 01 (D1). The same due re-solve appears in FocusCard and in the Re-solve section (D2). A solved problem can appear in both the Revision column and the re-solve slots (D3). The first revision problem appears in the Revision column and in the post-solve offer (D4). There are two Start paths (D5). The plan is built twice per poll, once by `/api/plan/today` and once inside `/api/analytics/dashboard`, whose copy no page reads (D6). Due slots are computed twice (D7). FocusCard has no actions at all. Added a short P1.3 note to P5.1 in the plan. No behavior change.
- Tests: `pnpm build` ✅ `pnpm lint` ✅ `pnpm test` ✅ (no `pnpm typecheck` script; build typechecks). Docs only, no new tests. This VM had no `node_modules`, so I ran `pnpm install --frozen-lockfile` first (no lockfile change). The health test again created `data/sqlite/dsa.db`, which I deleted.
- Data check: code-only mode — no `.env`, no credentials, no `data/dev/dsa.dev.db`. No data queries were needed for this task.
- Surprises / plan corrections: there are three completion paths for a problem. Suggested ✓ Done logs a session. Re-solve ✓ Done uses the FSRS form without MistakeCapture. The post-solve revision offer's ✓ Done logs a session against the revision topic, and for a problem already in the pool that writes an attempt but leaves its `problem_reviews` row unchanged. P4.2 covers this. **Bug (not fixed):** re-solve `skip`, `admit` and `setFlags` publish only `"resolve"`, which the `context.ts` subscriber does not treat as a plan invalidation. A skipped re-solve can stay on Today until the one-hour server cache expires. Noted for P5.1. "3 warm-up cards queued" on the hero is static text.
- Next suggested task: P2.1 (code-only).

### 2026-10-23 — P1.2 Map dependents of topic-level SM-2
- Did: Added a P1.2 section to `docs/plans/verification.md` listing every reader of `next_revision_at`, `sm2_interval`, `sm2_repetition` and `sm2_efactor`, plus `revision_count` and `last_revised` where they share the SM-2 paths. No behavior change. Seven readers feed decisions: the plan's revision queue (F1), its 25 minutes per revision topic (F2), the plan's deferral write that pushes `next_revision_at` forward on every uncached plan build (F3), `urgencyScore` in topic priority (F4), the memory/execution divergence sentence that reaches Today, WhatsApp and the coach prompt (F5), the warm-up skip that also stops `revision_count` from incrementing, which the weakness signal reads (F6), and the SM-2 writers themselves (F7). Ten are UI only: the Today revision column, the post-solve revision offer, the divergence chip, the "Why this?" urgency text, `GET /api/revision`, the graph's due ring and label, the WhatsApp plan and log replies, the Notion push, and the unused `scores` on `GET /api/topics`. Added short notes to P4.1 and P4.3 in the plan.
- Tests: `pnpm build` ✅ `pnpm lint` ✅ `pnpm test` ✅ (no `pnpm typecheck` script; build typechecks). Docs only, no new tests.
- Data check: code-only mode — no `.env`, no credentials, no `data/dev/dsa.dev.db`. No data queries were needed for this task.
- Surprises / plan corrections: P4.1 is not skipped. F4 and F6 need replacement signals, and F1–F3 need an off switch. P4.3 should stop the deferral write and the revision minutes as well as hiding the UI, or hidden topics keep being rescheduled and budgeted. P3.4 will rank on SM-2 urgency until P4.1 swaps its input. `availableMinutes` trimming is latent: Today does not send it. **Test hygiene:** `packages/backend/src/health.test.ts` calls `createAppContext(loadConfig("/nonexistent/.env"))`, which opens `./data/sqlite/dsa.db` at the default path and runs migrations against it. In this checkout `pnpm test` created an empty, gitignored `data/sqlite/dsa.db`, which I deleted. In a folder where that path is a real mirror, the test would open it. See Ideas and QUESTIONS.md.
- Next suggested task: P1.3 (code-only).

### 2026-10-22 — P1.1 Verify problems #1, #6, #7, #8 in code and data
- Did: Wrote `docs/plans/verification.md` from code, with no behavior change. Confirmed the "Revision needed" deadlock: `buildProblemCounts()` counts every non-`Solved` status as unsolved, and `findUnsolvedByTopicId()` returns only `"Not started"`, so suggestions fall through to the "add problems in Notion" placeholder. The default curriculum is 12 labels, each resolving to one topic. Primary-topic selection is `CurriculumEngine` only. Corrected the plan: keep the existing SM-2 caps (7 / 21 / 45 / 120), there is no `RoadmapEngine`, and Medium-as-primary starts at confidence ≥ 60 with recent productivity ≥ 60.
- Tests: `pnpm build` ✅ `pnpm lint` ✅ `pnpm test` ✅ (no `pnpm typecheck` script; build typechecks). No new tests.
- Data check: code-only mode — no `.env`, no credentials, no `data/dev/dsa.dev.db`. Did not create a database and did not run `pnpm db:repair-schedules` (it would open, and by default create, `./data/sqlite/dsa.db`). Local-only until a dev database exists: whether far-future SM-2 dates are still stored, the `curriculum_active_topic_id` value, the topics-table size versus the 12 labels, and whether any topic is actually stuck on "Revision needed" with no "Not started" problems.
- Surprises / plan corrections: problem-linked sessions already use `deriveSessionOutcomeScore`, and `RevisionEngine.applyQuality` is the only production caller of `sm2Update` and already passes the confidence cap. A 1-minute session scores 100 under the old length formula (SM-2 quality 5). A helped 1-minute session now scores about 50 (quality 3), which still lengthens the interval up to the cap. `namesMatch` can bind the label "Greedy" to a topic named "Greedy Sorting" without a manual pin. P2.1 is the regression test, not a new 180-day clamp.
- Next suggested task: P1.2. It is code-only. P1.1's data queries stay local-only.

### 2026-10-21 — P0.3 Baseline metrics script
- Did: Added `pnpm dev:metrics` (`infrastructure/scripts/dev-metrics.mjs`). It prints sessions, total minutes (`sessions.study_duration`), attempts, problems by status, per-topic confidence and `topics.next_revision_at` / `sm2_interval` (the plan's `next_review` name), `problem_reviews` count and due count, `cards` and `card_events` counts, last `chat_messages` date, coach-used attempts (`used_coach > 0`), the mistake-tag distribution, and `sync_meta.curriculum_active_topic_id`. The script ignores `SQLITE_PATH`, refuses paths outside `data/dev` and symlinks, and refuses a path argument. A missing file is an error and is not created. The dev file is not opened in place: SQLite would create `-wal`/`-shm` beside it and would miss uncheckpointed WAL pages, so the script copies the db and any sidecars to a temp directory, reads the copy, and deletes it. Row text (problem names, chat bodies, other `.env` keys) is not printed. `docs/plans/baseline-metrics.md` is gitignored and was not written.
- Tests: `pnpm build` ✅ `pnpm lint` ✅ `pnpm test` ✅ (no `pnpm typecheck` script; build typechecks). New coverage: 10 tests in `packages/shared/src/dev-metrics-script.test.ts`.
- Data check: code-only mode — no `.env`, no credentials, no `data/dev/dsa.dev.db`. Did not create a dev database. Did not save `docs/plans/baseline-metrics.md` (P0.3 output is local-only until a dev database exists). Tests used temp fixture files.
- Surprises / plan corrections: the SM-2 next-review column is `topics.next_revision_at`, not `next_review`. The report names that alias. Due reviews are `retired = 0 AND suspended = 0 AND due IS NOT NULL AND due <= now`.
- Next suggested task: P1.1. In code-only mode, do the code verification and mark the dev-database queries local-only.

### 2026-10-20 — P0.2 Dev-DB snapshot and reset scripts
- Did: Added `pnpm dev:snapshot` and `pnpm dev:reset` (`infrastructure/scripts/dev-db.mjs`). Snapshot copies `data/dev/dsa.dev.db` (or `DSA_DB_PATH` from the environment or `.env`) to `data/dev/snapshots/<UTC timestamp>.db`, including `-wal` and `-shm` sidecars. Reset restores `data/dev/dsa.snapshot-2026-10-19.db` (or `DSA_DB_BASELINE`), drops a stale dev wal/shm so it cannot replay onto the restored file, and copies baseline sidecars. Both ignore `SQLITE_PATH`, refuse anything outside `data/dev`, refuse symlinks, and refuse identical source and destination. A missing dev db or baseline exits with an error and does not create a database.
- Tests: `pnpm build` ✅ `pnpm lint` ✅ `pnpm test` ✅ (no `pnpm typecheck` script; build typechecks). New coverage: 7 tests in `packages/shared/src/dev-db-script.test.ts`.
- Data check: code-only mode — no `.env`, no credentials, no `data/dev/dsa.dev.db`. Did not create a dev database. Tests used temp fixture files, not SQLite.
- Surprises / plan corrections: none. The pristine baseline path is the setup copy `data/dev/dsa.snapshot-2026-10-19.db`.
- Next suggested task: P0.3

### 2026-10-19 — P0.1 Make data paths and external integrations configurable
- Did: Routed the DB path (`DSA_DB_PATH` overrides `SQLITE_PATH`), backend/frontend ports (`BACKEND_PORT`, `FRONTEND_PORT`), Obsidian vault (already `OBSIDIAN_VAULT_PATH`), and Redis settings (`REDIS_URL`, `REDIS_PREFIX`) through `loadConfig`. Notion writes and WhatsApp sends are logged no-ops when `NOTION_WRITE_ENABLED=false` / `WHATSAPP_ENABLED=false`. `NOTION_SYNC_ENABLED=false` skips Notion pull/push and uses the local card export. `LLM_PROVIDER=mock|disabled` never calls OpenRouter or Ollama. Defaults stay on so an unset live `.env` keeps today's behavior. Documented the vars in `infrastructure/.env.example`.
- Tests: `pnpm build` (no `pnpm typecheck` script), `pnpm lint`, and `pnpm test` passed. New coverage: config routing, Notion client write guard, card-bank push guard, WhatsApp send guard, mock LLM.
- Data check: code-only mode — no `.env`, no credentials, no `data/dev/dsa.dev.db`. Did not start the app and did not create a dev database. Startup log grep from the acceptance note is still local-only.
- Surprises / plan corrections: there is no Redis client in the repo; the prefix and URL are stored on config and unused. A disabled card push reports every card as failed so dirty rows are not marked synced.
- Next suggested task: P0.2

### 2026-10-19 — Setup
- Did: isolated worktree created from the focus-planner WIP. No overhaul task started.
- Tests: not run (setup only)
- Data check: dev DB is a copy of the live SQLite file; live DB was not opened for writes
- Surprises / plan corrections: outcome scoring and FocusPlanner were already committed on `feat/session-outcome-focus` (`bb8cfb6`), so `wip/focus-planner` starts there. Env keys that exist today are `SQLITE_PATH` and `PORT`; `DSA_DB_PATH`, `NOTION_WRITE_ENABLED`, and `FRONTEND_PORT` are reserved for P0.1.
- Next suggested task: P0.1

## Ideas (not scheduled)
- Treat `"resolve"` events as a plan invalidation in the `context.ts` subscriber, so a skipped or admitted re-solve updates Today immediately (P1.3). Folded into P5.1 unless Santosh wants it sooner.
- Point `packages/backend/src/health.test.ts` at a temp `SQLITE_PATH` / `DSA_DB_PATH` like the other backend tests, so `pnpm test` never opens or creates `./data/sqlite/dsa.db`. Waiting on QUESTIONS.md [Q-health-test].

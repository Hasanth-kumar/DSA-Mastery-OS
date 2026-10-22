# Overhaul Progress

## Status board
| Task | Status | Commit | Notes |
|---|---|---|---|
| P0.1 | done | 01fb24f | isolation env vars + Notion/WhatsApp write guards |
| P0.2 | done | 54b560f | snapshot and reset scripts; refuse live paths |
| P0.3 | done | 9968459 | script only; baseline-metrics.md is local-only (no dev db) and gitignored |
| P1.1 | done | 9b234f2 | code verdicts in verification.md; data queries local-only |
| P1.2 | todo | | |
| P1.3 | todo | | |
| P2.1 | todo | | |
| P2.2 | todo | | |
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
- ...

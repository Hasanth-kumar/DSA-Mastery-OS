# Overhaul Progress

## Status board
| Task | Status | Commit | Notes |
|---|---|---|---|
| P0.1 | done | 01fb24f | isolation env vars + Notion/WhatsApp write guards |
| P0.2 | done | 54b560f | snapshot and reset scripts; refuse live paths |
| P0.3 | todo | | |
| P1.1 | todo | | |
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

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DSA Mastery OS is a single-learner study system (no accounts, no multi-tenancy by design) that layers learning intelligence over a personal Notion DSA workspace. Notion is the canonical store; the backend mirrors it into local SQLite for fast queries and offline intelligence, then syncs edits back. Node ≥ 20, pnpm 9 (`corepack enable`), TypeScript ESM throughout.

The **flashcard bank** is a first-class subsystem: seeded baseline cards, per-card FSRS scheduling, batch LLM generation from notes, local embeddings for dedup, and a separate Review tab. Warm-up reads due cards locally with zero LLM calls. See `docs/flashcard-system-design.md` for the full spec.

## Design taste is binding — read it first

Before changing anything in this repo, read `docs/design-taste-and-preferences.md` in full. It is the canonical source for the visual aesthetic ("Atelier Editorial"), interaction patterns, pedagogical guardrails, and architectural house style, and it applies to every feature, fix and refactor.

- Frontend work: re-read its §2 (visual aesthetic) and §3 (UX principles) first. Reuse existing tokens, type voices and components; don't introduce new colors, fonts, shadows, boxed card grids or pills.
- Engine, service and backend work: re-read its §4 (architecture house style) first.
- If a request conflicts with the design doc, follow the doc and say so.

Agents working on the system overhaul also follow `docs/plans/system-overhaul-plan.md`. `AGENTS.md` carries the same instructions for non-Claude agents.

## Commands

```bash
pnpm setup            # first run: scaffold .env, install, build
pnpm study            # full study mode: API + dashboard + sync + opens browser
pnpm study:stop       # stop study mode

pnpm dev              # API only (tsx watch, hot reload)
pnpm dev:web          # dashboard only (Vite on :5173)
pnpm dev:all          # API (:3000) + dashboard (:5173) in parallel

pnpm build            # build all packages (see ordering note below)
pnpm test             # all Vitest suites
pnpm lint             # ESLint across packages

pnpm dev:snapshot     # copy data/dev/dsa.dev.db to data/dev/snapshots/<timestamp>.db
pnpm dev:reset        # restore data/dev/dsa.dev.db from the pristine baseline
pnpm dev:simulate-plan --days 14  # old curriculum vs two-loop selector, day by day, on a copy of the dev DB

pnpm db:seed          # Notion -> SQLite initial sync (topics/problems/sessions)
pnpm db:seed-cards    # load seed flashcards from database/seeds
pnpm db:embed-cards   # compute local embedding vectors
pnpm db:generate-cards # batch-generate cards for dirty topics
pnpm db:dedupe-problems
```

Run a single package's suite or one test:

```bash
pnpm --filter @dsa/intelligence test
pnpm --filter @dsa/backend test src/whatsapp.test.ts
pnpm --filter @dsa/intelligence exec vitest run -t "weakness"   # by test name
pnpm --filter @dsa/backend test src/services/CardService.test.ts
```

Health: `curl http://localhost:3000/health` (or `bash infrastructure/scripts/health-check.sh`) returns per-service status for SQLite, Notion, LLM, and sync health (pending topic/problem edits + dirty card count).

## Build ordering matters

`pnpm build` is **not** a plain `-r` build: it builds `@dsa/database` first, then everything else. `@dsa/database` compiles the Drizzle schema and Notion types into `dist/`, which the other packages import as `@dsa/database/schema` and `@dsa/database/notion-types`. If you see unresolved type errors for those imports, the database package hasn't been built yet.

## Workspace layout (pnpm workspaces)

Packages live in `packages/*` plus the top-level `database/`. Dependency direction:

- `@dsa/shared` — config loading (`loadConfig`) and shared types. Bottom of the stack.
- `@dsa/database` — Drizzle SQLite schema (`schema/sqlite.schema.ts`) + Notion type definitions. The single source of truth for table shapes; SQL lives in `database/migrations/`.
- `@dsa/intelligence` — pure, I/O-free decision engines (see below).
- `@dsa/integrations` — all external I/O: Notion, WhatsApp, LeetCode, OpenRouter/LLM, the SQLite driver (`better-sqlite3`), embeddings, card generation, card sync adapters.
- `@dsa/backend` — Fastify API that wires everything together via dependency injection.
- `@dsa/frontend` — React 19 + Vite + D3 dashboard (Today, Review, Coach, Graph, Activity, Session tabs).

## Architecture (the parts that span files)

**Composition root.** `packages/backend/src/context.ts` (`createAppContext`) is where the whole graph is constructed: it runs migrations, opens SQLite, then instantiates repositories → services → the intelligence orchestrator, and returns an `AppContext`. Everything downstream receives its dependencies from here — to add a service or repo, wire it in `context.ts` and add it to the `AppContext` interface. `server.ts` is the entry point (boot, schedulers, Obsidian watcher, nightly backup, graceful shutdown); `app.ts` builds the Fastify instance and registers routes.

**Repositories vs. services.** Repositories (`backend/src/repositories/*`) are the only things that touch the SQLite mirror, going through `MirrorCache`. Services (`backend/src/services/*`) hold business logic and orchestrate repos, the intelligence orchestrator, and integration clients. Routes (`backend/src/routes/*`) stay thin and call services.

**Intelligence engines are pure.** `@dsa/intelligence` contains the engines — topic priority, revision (SM-2), weakness, difficulty, roadmap, curriculum, problem re-solve (`ProblemReviewEngine`) — plus analytics and an `IntelligenceOrchestrator`. They take snapshot data in and return results with **no I/O, no DB, no network**. The backend feeds them data and persists outcomes. Keep them that way: this is what makes them unit-testable in isolation, and most of the test suite lives here. The topic→`TopicState` mapper (`buildTopicState` in `analytics/build-topic-snapshot.ts`) is the single source of truth used by both the backend mirror and the analytics engine — don't re-copy it. The package barrel (`src/index.ts`) is the deliberate public API; internal helpers stay exported from their own modules only.

**Dual scheduling (intentional).** Flashcards use **per-card FSRS** (`ts-fsrs` via `CardService` / `fsrs.ts`). The legacy **topic-level SM-2** path (`RevisionEngine`, `SessionService.applyRecallQuality`) still powers the revision queue and session analytics. Warm-up and Review tab scheduling are FSRS-only; do not conflate the two.

**Flashcard hot path.** `CardService` serves warm-up (`buildWarmup`) and review (`reviewQueue`, `review`, triage) entirely from local SQLite — no LLM, no network. `WarmupService` delegates to `CardService`. Leech handling skips drilling leech cards and resurfaces prerequisite concepts (`leechRemediation.ts`); leech detection marks the topic dirty for batch reformulation. Mastery trigger (`masteryTrigger.ts`) marks topics dirty when ≥80% of cards are mature.

**Card bank sync seam.** The Notion API client for the **card bank** must stay behind `SyncTarget` in `integrations/src/sync/`. Only `NotionSyncTarget.ts` may import `@notionhq/client` for cards; enforced by `no-direct-notion-import.test.ts`. `CardBankSyncService` (backend) wires `CardSyncService` to either Notion (when `NOTION_CARDS_DB_ID` is set) or a local JSON+MD export (`CARDS_EXPORT_DIR`). Periodic flush via `CARDS_SYNC_FLUSH_INTERVAL_MS`; shutdown flush in `server.ts` and `context.close()`.

**Legacy Notion sync.** Topics, problems, and sessions still sync through `NotionSyncService` + `NotionClient.ts` (separate from the card-bank seam). Push-only flush on shutdown via `flushPendingToNotion()`; `POST /api/sync/flush`.

**Sync model.** Notion is canonical. Reads serve from the SQLite mirror; local edits queue and flush back to Notion (push-only on shutdown via `flushPendingToNotion` + card bank flush, plus `POST /api/sync`). Failed pushes stay queued and replay on the next sync. Conflicts surface through `ConflictRepository` / `GET /api/sync/conflicts`.

**Dual LLM config.** Coaching uses a dedicated coach LLM (`createCoachLLMService`) for hint/debrief/chat. Batch card generation uses a separate Ollama-first chain (`createGenerationLLMClient`). Tests inject a stub coach via `createAppContext(config, { coachLlm })` to avoid real LLM calls — follow that pattern when testing coaching paths.

**Live updates.** Dashboard receives push updates over SSE at `GET /api/events`, backed by the in-process `EventBus`. Background work (weekly digest only) runs on in-process `node-cron` schedulers gated by `ENABLE_SCHEDULERS` — Docker is **not** required for normal dev; it's only for running the API in a container.

## Config & environment

Config is centralized in `@dsa/shared` `loadConfig()`, read from a single `.env` at the repo root (copy from `infrastructure/.env.example` or run `pnpm setup`). Required for core function: `NOTION_TOKEN` + the three `NOTION_*_DB_ID`s and `OPENROUTER_API_KEY`. Optional card bank: `NOTION_CARDS_DB_ID` (falls back to `CARDS_EXPORT_DIR`). WhatsApp and LeetCode vars are optional.

## Gotchas

- **Don't statically serve `packages/frontend/dist/`** alone — it has no API proxy and will fail with JSON parse errors. In dev the frontend calls the API at `http://127.0.0.1:3000`; in production, proxy `/api` via `infrastructure/nginx/nginx.conf`.
- SQLite mirror lives in `data/sqlite/` (gitignored). Schema changes go through a new numbered file in `database/migrations/` **and** the ordered `MIGRATIONS` list in `integrations/src/sqlite/migrations.ts`.
- Embeddings live in `card_embeddings` (local only, never synced). Generation dirty flags live in `topic_generation` (separate from per-card `cards.dirty` sync flags).
- ESLint flags unused vars as errors; prefix intentionally-unused identifiers with `_`.
- CI (`.github/workflows/ci.yml`) runs install → build → lint → test on push/PR to main/master. Run `pnpm build && pnpm lint && pnpm test` locally before pushing.

# Questions for Santosh
## Open
- [D2] Pin auto-expiry duration — default 14 days. Asked 2026-10-19. Runs waiting: 0
- [D3] Pass 1 quota per pattern (3 / 4 / 5) — default 4. Asked 2026-10-19. Runs waiting: 0
- [D4] Pass 2 gate: count only, or count + ≥ 2 clean cold solves — default count + clean. Asked 2026-10-19. Runs waiting: 0
- [D5] Flashcard warm-up on Today: off / optional / always — default optional, off. Asked 2026-10-19. Runs waiting: 0
- [D6] Build the pre-solve pattern gate? — default build, flag off. Asked 2026-10-19. Runs waiting: 0
- [D7] Approve the topic tiers in `topic-tiers.md` — default proposal in P7.1. Asked 2026-10-19. Runs waiting: 0
- [D9] Allow Notion reads in the worktree — default no; use dev DB only. Asked 2026-10-19. Runs waiting: 0
- [Q-health-test] `packages/backend/src/health.test.ts` opens `./data/sqlite/dsa.db` (default path) and runs migrations, so `pnpm test` creates that file in a checkout without one, and would open it in a checkout that has a real mirror there. May an agent fix it as a small unscheduled test-only change (temp DB path, as in the other backend tests)? Default: no fix until answered; agents delete the stray empty file after each test run. Asked 2026-10-23. Runs waiting: 0
## Answered
- [D8] → 1 re-solve per day on Today (the default). Answered 2026-10-24.
- [Today layout] → Re-solves appear as the first, marked row of the Suggested problems list and log through the same Start → timer → ✓ Done → MistakeCapture flow. The separate Re-solve section, topic Revision column and FocusCard are hidden behind flags. Decided 2026-10-24; recorded in the design doc §3.3 and plan P4.2, P5.2, P5.4.
- [D10] → Yes. A cloud run that is fast-forward with `origin/overhaul` but not checked out as `overhaul` should switch to `overhaul` and continue. Answered 2026-10-19.
- [D1] → WIP branch. Setup on 2026-10-19 branched `overhaul` from `wip/focus-planner`, which points at `feat/session-outcome-focus` (`bb8cfb6`) plus the plan docs.

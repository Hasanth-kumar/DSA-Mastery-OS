# Questions for Santosh
## Open
- [D4] Pass 2 gate: count only, or count + ≥ 2 clean cold solves — default count + clean. Asked 2026-10-19. Runs waiting: 0
- [D6] Build the pre-solve pattern gate? — default build, flag off. Asked 2026-10-19. Runs waiting: 0
- [D7] Approve the topic tiers in `topic-tiers.md` — default proposal in P7.1. Asked 2026-10-19. Runs waiting: 0
- [D9] Allow Notion reads in the worktree — default no; use dev DB only. Asked 2026-10-19. Runs waiting: 0
## Answered
- [Q-flags] → `FLAG_<NAME>=true|false` in `.env`, read by `loadConfig` into `AppConfig.flags`, off when unset, on in the overhaul worktree's `.env`, read-only at `GET /api/flags`. Answered 2026-10-24.
- [Q-health-test] → Yes, fix it (temp DB path). Done 2026-10-24.
- [D5] → Flashcard warm-up on Today is optional and off by default (the default). Answered 2026-10-24.
- [D8] → 1 re-solve per day on Today (the default). Answered 2026-10-24.
- [Today layout] → Re-solves appear as the first, marked row of the Suggested problems list and log through the same Start → timer → ✓ Done → MistakeCapture flow. The separate Re-solve section, topic Revision column and FocusCard are hidden behind flags. Decided 2026-10-24; recorded in the design doc §3.3 and plan P4.2, P5.2, P5.4.
- [D10] → Yes. A cloud run that is fast-forward with `origin/overhaul` but not checked out as `overhaul` should switch to `overhaul` and continue. Answered 2026-10-19.
- [D1] → WIP branch. Setup on 2026-10-19 branched `overhaul` from `wip/focus-planner`, which points at `feat/session-outcome-focus` (`bb8cfb6`) plus the plan docs.
- [D2] → 7 days (2026-10-24). The pin also auto-expires as soon as the pinned topic's first pass is complete (every problem `Solved` or `Revision needed`, per P3.1); selection then falls through to the normal next-topic logic (P3.4 / spiral selector). Whichever comes first wins; log the expiry reason.
- [D3] → Replace the flat quota with a difficulty-aware rule (2026-10-24). Pass 1 (foundation) is reached when: if the topic has fewer than 4 problems, **all** of its problems are covered; otherwise **all Easy** problems are covered **and** at least `min(3, #Medium)` Medium problems are covered. "Covered" uses the P3.1 definition (`Solved` or `Revision needed`). Update P7.3 and its boundary tests to match. Dev DB check (2026-10-24): 14 of 50 topics have < 4 problems; heaviest case is DFS (Tree/Graph) at 7 Easy + 3 Medium = 10 of 12.

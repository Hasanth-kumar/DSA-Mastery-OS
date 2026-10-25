# Questions for Santosh
## Open
- [D13] Approve `docs/plans/topic-tiers.md` (P7.1): the introduction order (11 basics, 21 core, 18 later), the 30 hard prerequisites, and its four decisions (basics count as satisfied prerequisites; Top-K is the heap entry point; core size; DP order). P7.2–P7.5 wait on it. Asked 2026-10-25. Runs waiting: 0
- [D9] Allow Notion reads in the worktree — default no; use dev DB only. Asked 2026-10-19. Runs waiting: 0
## Answered
- [D4] → No fixed count. Pass 2 = every problem that needed help re-solved clean in a later session, plus up to 2 unseen problems solved clean first try. Answered 2026-10-25 with the learning model in plan §6; rules in P7.3.
- [D6] → Dropped. Santosh: over-engineering. P6.4 is not built. Answered 2026-10-25.
- [D7] → Redefined 2026-10-25: tiers are only an introduction order plus a short list of hard prerequisites (plan P7.1, §6.2). The agent asks for approval of `topic-tiers.md` when P7.1 produces it.
- [D11] → Short block for a new pattern: 2–4 problems, pattern shown. Answered 2026-10-25.
- [D12] → Mixed days: 1 re-solve + 1–2 problems, at most 1 of them an unseen transfer-check problem; all with the pattern hidden. Answered 2026-10-25.
- [Today header] → Block days keep the current pattern-name header; mixed days get their own `Mixed practice` header and name no pattern. Decided 2026-10-25 (design doc §3.3, plan §6.4).
- [Q-flags] → `FLAG_<NAME>=true|false` in `.env`, read by `loadConfig` into `AppConfig.flags`, off when unset, on in the overhaul worktree's `.env`, read-only at `GET /api/flags`. Answered 2026-10-24.
- [Q-health-test] → Yes, fix it (temp DB path). Done 2026-10-24.
- [D5] → Flashcard warm-up on Today is optional and off by default (the default). Answered 2026-10-24.
- [D8] → 1 re-solve per day on Today (the default). Answered 2026-10-24.
- [Today layout] → Re-solves appear as the first, marked row of the Suggested problems list and log through the same Start → timer → ✓ Done → MistakeCapture flow. The separate Re-solve section, topic Revision column and FocusCard are hidden behind flags. Decided 2026-10-24; recorded in the design doc §3.3 and plan P4.2, P5.2, P5.4.
- [D10] → Yes. A cloud run that is fast-forward with `origin/overhaul` but not checked out as `overhaul` should switch to `overhaul` and continue. Answered 2026-10-19.
- [D1] → WIP branch. Setup on 2026-10-19 branched `overhaul` from `wip/focus-planner`, which points at `feat/session-outcome-focus` (`bb8cfb6`) plus the plan docs.
- [D2] → 7 days (2026-10-24). The pin also auto-expires as soon as the pinned topic's first pass is complete (every problem `Solved` or `Revision needed`, per P3.1); selection then falls through to the normal next-topic logic (P3.4 / spiral selector). Whichever comes first wins; log the expiry reason.
- [D3] → Replace the flat quota with a difficulty-aware rule (2026-10-24). Pass 1 (foundation) is reached when: if the topic has fewer than 4 problems, **all** of its problems are covered; otherwise **all Easy** problems are covered **and** at least `min(3, #Medium)` Medium problems are covered. "Covered" uses the P3.1 definition (`Solved` or `Revision needed`). Update P7.3 and its boundary tests to match. Dev DB check (2026-10-24): 14 of 50 topics have < 4 problems; heaviest case is DFS (Tree/Graph) at 7 Easy + 3 Medium = 10 of 12.

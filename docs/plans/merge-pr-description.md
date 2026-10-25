# PR: System overhaul (overhaul → main)

**Title:** System overhaul: data fixes, one Today list, two-loop curriculum (new behavior behind flags)

**Base:** `main` (`f60c5dc`) · **Compare:** `overhaul` · **Merge with:** "Create a merge commit" (not squash), so one `git revert -m 1` undoes it. Santosh merges; agents never do.

---

## Summary

The overhaul from `docs/plans/system-overhaul-plan.md`, Phases 0–8: about 70 commits, 157 files. Every new user-visible behavior is behind a flag in `.env` (`FLAG_<NAME>=true`; unset = off), so merging with no flags set changes only the bug fixes listed under "Lands with every flag off". The steps for turning it on live, the order of the flags and rollback are in `docs/plans/live-migration-steps.md`; the runbook was dry-run on a copy of the live DB on 2026-10-25 (P8.2).

## What's in it

- **Phase 0, isolation.** `DSA_DB_PATH`, ports, `NOTION_WRITE_ENABLED`, `NOTION_SYNC_ENABLED`, `WHATSAPP_ENABLED`, `LLM_PROVIDER=mock|disabled`, dev snapshot/reset/metrics scripts. Defaults keep live behavior.
- **Phase 1–2, data integrity.** Sessions scored by outcome, not length (`bb8cfb6`); schedule repair fixed (it moved past dates and wasn't safe to re-run) and validated.
- **Phase 3, curriculum unblocked.** One "covered" rule (`Revision needed` counts), every `Revision needed` problem in the re-solve pool (reversible script), pins that expire (7 days or first pass done), topic choice that stays on the current topic, suggestions by stage.
- **Phase 4, one retention system.** Topic urgency from problem re-solves (FSRS) instead of topic SM-2; one completion flow for new problems and re-solves with an inferred rating; fixed re-solves coming back in 10 minutes; flashcard warm-up optional.
- **Phase 5, one Today list.** `buildTodayQueue`: one hidden re-solve, then 1–2 problems; re-entry after a 3-day gap; one problem in progress at a time; new stats strip; duplicate surfaces hidden.
- **Phase 6, better signals.** Help level (None / Hint / Approach / Full solution) and source, "Which pattern did you use?" on hidden rows, one-line takeaways appended to existing Obsidian notes, one mistake vocabulary (+2 tags).
- **Phase 7, two-loop curriculum.** Approved introduction order and 30 hard prerequisites (`topic-tiers.md`, D13); pass 0–3 per topic (`topicPass`); the two-loop selector (short blocks, mixed days with patterns hidden everywhere, a daily basics offer, consolidation days and loop, D14 for patterns started long ago); wired into Today; `pnpm dev:simulate-plan` compares old and new day by day.
- **Phase 8.** Runbook, dry run on live data, this description.

## Lands with every flag off

- Outcome-based session scoring (stops the years-out review dates).
- `Revision needed` counts as covered, so a topic's first pass can finish.
- Pins expire after 7 days or when the topic's first pass is complete.
- Today's topic stays on the current topic while it has first-pass work (the hero may name a different topic than before).
- Suggested difficulty by stage, not raw confidence.
- MistakeCapture lists "Wrong greedy choice" and "Loop bounds / termination".
- The Graph tab draws fewer inferred edges.
- Migration 0017 adds four nullable columns to `problem_attempts`; nothing else in the schema changes.

## Flags

Turn on in three groups, a few days apart (runbook step 7):

| Group | Flags | What you get |
|---|---|---|
| A | `FLAG_HIDE_TOPIC_REVISION`, `FLAG_UNIFIED_COMPLETION`, `FLAG_TODAY_QUEUE_V2` | Topic SM-2 retired; re-solves logged like new problems; Today as one ordered list |
| B | `FLAG_HELP_LEVEL_CAPTURE`, `FLAG_TAKEAWAY_FIELD` | Help level and pattern guess; takeaways (writes to existing Obsidian notes) |
| C | `FLAG_CURRICULUM_V2`, `FLAG_SPIRAL_PASSES` | Approved prerequisites; the two-loop selector drives Today (needs group A) |

## Data changes on live

All in the runbook, each with a dry run, a backup and an undo:

- `pnpm db:repair-schedules --apply`: 6 topics on the 2026-10-25 live copy, pushed to Notion on the next sync.
- `pnpm db:backfill-resolve-pool --apply`: 5 problems into the re-solve pool (`--revert` undoes it).
- Clear the stale pin (Greedy + Sorting with Prefix).
- Migration 0017 runs by itself on first open; `database/migrations/down/0017_attempt_signals.down.sql` reverses it.

## How it was verified

- `pnpm build`, `pnpm lint`, `pnpm test` green: shared 23, intelligence 276, integrations 200, backend 162 = 661 tests, against 373 on `main` (+288).
- Mutation checks on every rule change: each rule broken on purpose, a test fails, then restored.
- Data checks against copies of the dev DB for every task touching data; before/after numbers in `PROGRESS.md`.
- Browser checks (desktop and phone) of Today for every UI phase, including block, mixed and re-entry days and the hidden-row Done → guess → reveal flow.
- P8.2: the whole runbook on a copy of the live DB, all three flag groups, `--revert`, and `main` booting on the migrated copy (rollback). The live file was only read.

## Known gaps

- The day's plan is cached per day (1 hour), so the queue doesn't change after a Done until it expires; done rows show as done.
- The pattern-guess list is "patterns touched or covered", not the selector's open set; near-duplicate options (Two Pointers vs Sorting + Two Pointers) make a wrong guess easy.
- Pin expiry uses "every problem covered", not pass 1.
- Legacy plan fields (`suggestedProblems`, `focus`, curriculum list) are still built from the old selection for surfaces outside the Today list; `graph-edges.ts` stays for the flag-off path (delete after the flags are on for good).
- The Re-solve tab still uses the old outcome form.
- With the coach's full learning context on, its general weak-topics list can still name patterns (not linked to the problem).
- A D13 day of three Mediums (re-solve, DP problem, basics offer) is about 105 minutes, over the 90-minute target; kept by choice.
- Backend tests still read the repo `.env` in four files; the overhaul-flag tests pin their own config (Ideas list in `PROGRESS.md`).

## Reviewer checklist (Santosh)

- [ ] Skim `docs/plans/PROGRESS.md` from the top (newest first) and `QUESTIONS.md` (nothing open but D9: no Notion reads in the worktree).
- [ ] `git log main..overhaul --oneline`; spot-check one diff.
- [ ] Run the overhaul worktree (`pnpm study` there) and click through Today once with all flags on.
- [ ] Read `live-migration-steps.md` §0 and §7 before merging.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Uaz7pu8FeKdrQmuoWp5Aet

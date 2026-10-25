# Live migration steps

The runbook for turning the overhaul on in the **live** app, for Santosh to run. Agents never run these on live; P8.2 dry-runs this document on a fresh copy of the live DB and fills in the expected numbers.

The live app runs from `~/Desktop/dsa-mastery-os` on `main`, with `SQLITE_PATH=./data/sqlite/dsa.db` and `PORT=3000`. Every command below runs from that folder. Allow about 30 minutes for steps 0–6; the flags in step 7 go on over a week or two.

**Dry run (P8.2, 2026-10-25).** Every step below was run on a copy of the live DB taken that day (last session 2026-10-24), with the overhaul build, Notion, WhatsApp and the LLM off. All steps behaved as written; the "What to expect" numbers below are from that copy. It found one curriculum problem (patterns started in July would have run before DP), fixed as D14 before merge. The live file was only read (checksum unchanged).

## At a glance

| # | Step | App | Undo |
|---|---|---|---|
| 0 | Check the preconditions | — | — |
| 1 | Stop, back up, record "before" counts | stopped | — |
| 2 | Merge `overhaul` into `main`, install, build | stopped | §9 level 3 |
| 3 | Schema migration 0017 (runs by itself) | stopped | §9 level 3 |
| 4 | Repair topic review schedules (P2.2) | stopped | restore backup |
| 5 | Put every "Revision needed" problem in the re-solve pool (P3.2) | stopped | `--revert` |
| 6 | Start with every flag off; clear the stale pin (P3.3); check Today | running | re-pin |
| 7 | Turn the flags on, one group at a time | restart per group | remove the flag |
| 8 | Verification queries (used throughout) | either | — |
| 9 | Rollback, three levels | stopped | — |

## 0. Preconditions

- P8.2 has dry-run this runbook on a fresh copy of the live DB, with no surprises.
- Live is on `main` with a clean tree: `git status` shows nothing to commit.
- `overhaul` is pushed: `git push origin overhaul` from the overhaul worktree.
- The live `.env` has **no** `FLAG_…` lines, no `DSA_DB_PATH`, and no `NOTION_WRITE_ENABLED=false` / `NOTION_SYNC_ENABLED=false` / `WHATSAPP_ENABLED=false`. Those belong to the overhaul worktree only. Unset means "on" for Notion and WhatsApp (today's behavior) and "off" for every flag.
- `sqlite3` is available (it ships with macOS: `sqlite3 --version`).

**What changes the moment the merge lands, with every flag off.** These have no flag; they are the bug fixes the overhaul exists for:

- Sessions are scored by outcome, not length (`bb8cfb6`, confirmed in P2.1), so weak topics stop getting review dates years out.
- A `Revision needed` problem counts as covered (P3.1), so a topic's first pass can finish.
- A curriculum pin ends by itself after 7 days or when the topic's first pass is complete (P3.3).
- Today's topic stays on the current topic while it has first-pass work, then goes to the highest-priority ready topic (P3.4). The hero may name a different topic than before the merge.
- Suggested difficulty follows the topic's stage, not raw confidence (P3.5).
- MistakeCapture lists two more tags: "Wrong greedy choice" and "Loop bounds / termination" (P6.3).
- The Graph tab draws fewer inferred edges (P3.4).
- `pnpm study` reads `PORT` / `FRONTEND_PORT` (unchanged with the defaults).

## 1. Stop, back up, record the "before" counts

```bash
cd ~/Desktop/dsa-mastery-os
pnpm study:stop                       # nothing may hold the database open
mkdir -p data/backups/pre-overhaul
STAMP=$(date +%Y%m%d-%H%M%S)
cp data/sqlite/dsa.db "data/backups/pre-overhaul/dsa-$STAMP.db"
for f in data/sqlite/dsa.db-wal data/sqlite/dsa.db-shm; do [ -f "$f" ] && cp "$f" "data/backups/pre-overhaul/$(basename "$f")-$STAMP"; done
git rev-parse --short HEAD > data/backups/pre-overhaul/main-before-$STAMP.txt   # the commit to go back to
```

If `takeawayField` will be turned on (step 7, group B), back up the Obsidian vault too: it is the first feature that writes to existing notes.

Record the counts (query 8.1) and keep the output.

Rollback for every step below: §9.

## 2. Merge and build

Merge with a merge commit so the whole overhaul can be undone with one `git revert` (§9 level 3):

```bash
git fetch origin
git checkout main
git merge --no-ff origin/overhaul -m "Merge the system overhaul (flags off)"
pnpm install
pnpm build
```

Or merge the GitHub PR from P8.3 with "Create a merge commit" (not squash), then `git pull`, `pnpm install`, `pnpm build`.

## 3. Schema migration 0017 (automatic)

There is no migrations table: every file in `database/migrations/` re-runs whenever the app or a script opens the database, and a re-run that only re-adds an existing column is ignored. The overhaul adds one file, `0017_attempt_signals.sql`. It adds four nullable columns to `problem_attempts` (`help_level`, `help_source`, `pattern_guess`, `takeaway`) and changes no existing value. It runs the first time step 4's script opens the database.

Verify after step 4: query 8.3 lists the four columns.

## 4. Repair topic review schedules (P2.2)

Old length-based scoring gave weak topics review dates years out. The repair pulls each one back to its confidence cap (under 40% → 7 days, under 60% → 21, under 80% → 45, otherwise 120). A date that is already past stays as is.

```bash
pnpm db:repair-schedules              # dry run: lists what would change, writes nothing
pnpm db:repair-schedules --apply      # backs up into data/backups/, then applies
pnpm db:repair-schedules              # should now say "Nothing to do"
```

What to expect: on the 2026-10-25 live copy the dry run listed 6 topics:

| Topic | Confidence | Interval | Next review |
|---|---|---|---|
| Recursion & Backtracking | 32% | 3900 → 7 days | 2037-03-09 → tomorrow |
| Fast & Slow Pointers | 30% | 1459 → 7 days | 2030-10-09 → tomorrow |
| Two Pointers | 53% | 456 → 21 days | 2027-12-19 → tomorrow |
| BFS | 22% | 380 → 7 days | 2027-09-17 → tomorrow |
| Greedy Sorting | 28% | 49 → 7 days | 2026-12-11 → 2026-10-30 |
| Binary Search + Prefix Sum | 43% | 42 → 21 days | unchanged (already due) |

`--apply` backed up first, the re-run said "Nothing to do", query 8.4 was empty and 8.7 listed 6 pending pushes.

Live data has moved on since then, so the list may differ. Read it before `--apply`. Anything with a date years out, or an interval in the hundreds, is the bug being fixed.

Notes:
- `--apply` marks the repaired topics for a Notion push, so Notion's "Next Review" fields update on the next sync. That is intended.
- "Tomorrow" means all repaired topics become due the same day. Catch-up compression spreads them across days, so Today does not show a wall of revisions. With `hideTopicRevision` on (step 7), topic revisions leave Today altogether.

Verify: query 8.4 returns no rows.

## 5. Put every "Revision needed" problem in the re-solve pool (P3.2)

Some problems are marked `Revision needed` (often in Notion) but have no re-solve row, so they never come back for a re-solve. This adds the missing rows. It is local-only: `problem_reviews` never syncs to Notion.

```bash
pnpm db:backfill-resolve-pool            # dry run: lists the problems it would add
pnpm db:backfill-resolve-pool --apply    # backs up into data/backups/, then adds them
pnpm db:backfill-resolve-pool            # should now say "Nothing to do"
```

What to expect: on the 2026-10-25 live copy it added 5 (Maximum Depth of N-ary Tree, Two Sum, Subsets, Subsets II, Maximum Sum Subarray of Size K), `problem_reviews` 39 → 44. Due dates are spread one per day, oldest first, so only one lands today. `--revert` took it back to 39 and a second `--apply` to 44 again.

Verify: query 8.5 returns 0.

Rollback: `pnpm db:backfill-resolve-pool --revert` removes exactly the rows `--apply` added (their ids are recorded in `sync_meta`), except any you have re-solved since.

## 6. Start with every flag off; clear the stale pin (P3.3)

```bash
pnpm study
curl -s http://127.0.0.1:3000/api/flags      # every value false
curl -s http://127.0.0.1:3000/health         # status "ok" (sqlite and notion "ok")
```

Live is pinned to **Greedy + Sorting with Prefix** (on the 2026-10-25 copy). A pin from before the merge has no date, so its 7-day clock starts the first time the app plans the day. To clear it right away, do either:

- On Today, tap **Unpin** next to "Pinned · Greedy + Sorting with Prefix".
- Or from a terminal:

  ```bash
  curl -s -X PUT http://127.0.0.1:3000/api/curriculum/active \
    -H 'Content-Type: application/json' -d '{"topicId": null}'
  ```

Verify: Today no longer shows "Pinned" and the hero names the curriculum's next topic (DFS (Tree/Graph) on the live copy, which already has 2 problems covered); query 8.6 shows empty values. Click through Today, Re-solve, Review and Coach once: apart from the list at the top of §0 they behave as before the merge. Use the app like this for a day before step 7.

Rollback: pin it again from Settings → Curriculum → Switch.

## 7. Turn the flags on, one group at a time

For each group: add the lines to the live `.env`, restart (`pnpm study:stop && pnpm study`), check `curl -s http://127.0.0.1:3000/api/flags`, then use the app for a few days before the next group. To turn one off, delete its line (or set it to `false`) and restart.

**Group A: one Today list.** Turn these three on together; the Today list's re-solve rows log through the unified flow.

| Flag | What changes | What it writes | Turning it off later |
|---|---|---|---|
| `FLAG_HIDE_TOPIC_REVISION=true` | Topic SM-2 is retired: a topic's urgency comes from its due re-solves; the Revision column and the post-solve revision offer are hidden; no topic revision queue (P4.1, P4.3) | Nothing new; it stops the catch-up deferral writes to `next_revision_at` | Topic revisions come back from their stored dates, some likely due; catch-up compression spreads them |
| `FLAG_UNIFIED_COMPLETION=true` | A re-solve is logged like a new problem: Start → timer → ✓ Done → MistakeCapture, one FSRS review per attempt, rating inferred from tags, help and time; fixes re-solves coming back in 10 minutes (P4.2) | FSRS rows as before; `resolve_pre:<attempt>` keys in `sync_meta` (the pre-attempt state, for redoing the rating) | The old outcome form returns; schedules already written stay |
| `FLAG_TODAY_QUEUE_V2=true` | Today is one ordered list: 1 re-solve (pattern hidden), then 1–2 problems; one problem in progress at a time; warm-up becomes an opt-in link; the separate Re-solve section and FocusCard are hidden; new stats strip (P4.4, P5, Today lock) | Nothing | The old Today returns |

Check: Today shows "Suggested problems" with a `RE-SOLVE · DUE SINCE …` row first, no Revision column, no Re-solve section. Starting a problem locks the other rows. ✓ Done on a re-solve opens MistakeCapture.

**Group B: better signals.**

| Flag | What changes | What it writes | Turning it off later |
|---|---|---|---|
| `FLAG_HELP_LEVEL_CAPTURE=true` | MistakeCapture asks Help (None / Hint / Approach / Full solution) and From (coach / external AI / other); on a hidden-pattern row it first asks "Which pattern did you use?" and reveals the answer (P6.1) | `help_level`, `help_source`, `pattern_guess` on the attempt; approach help or a full solution marks the problem `Revision needed`, which syncs to Notion | The old checkbox form returns; stored values stay and are ignored |
| `FLAG_TAKEAWAY_FIELD=true` | A one-line takeaway after a solve, shown again on that problem's next re-solve (P6.2) | `takeaway` on the attempt, and a line `- YYYY-MM-DD: …` appended under `## Takeaways` at the end of the problem's **existing** Obsidian note (never creates or rewrites a note) | No more appends; lines already written stay in the notes |

Check: log one problem with Help = Hint and a takeaway; the problem's note ends with the takeaway line.

**Group C: the two-loop curriculum.** Needs group A (the selector reaches you through the Today list).

| Flag | What changes | What it writes | Turning it off later |
|---|---|---|---|
| `FLAG_CURRICULUM_V2=true` | Curriculum ranking and the Graph tab use only the 30 approved hard prerequisites (`topic-tiers.md` §4, P7.2) | Nothing | The old merged prerequisites return |
| `FLAG_SPIRAL_PASSES=true` | With the two above, Today comes from the two-loop selector: short blocks for new patterns (pattern shown), mixed days (patterns hidden everywhere), one basics problem offered a day while a basic is below pass 1, consolidation days, the consolidation loop (P7.3–P7.5). "Up next" and "step N of M" are hidden | Nothing new (it keeps no state of its own) | Today goes back to one topic a day (P3.4) |

Before group C, run `pnpm dev:simulate-plan` in the overhaul worktree on a fresh copy of the live DB (put it at `data/dev/…` and point `DSA_DB_PATH` at it) to see the next 14 days. Check: on the first day Today reads "New pattern: Dynamic Programming (1D)" (if DP is still untouched), with one hidden basics problem; once DP's block is done, "Mixed practice" with no pattern named in the hero, strip, nav or rows.

On the 2026-10-25 live copy: days 1–4 DP (1D) block (Climbing Stairs, Min Cost Climbing Stairs, Coin Change, Count Vowels Permutation), each with one basics problem; then mixed days, where DFS (Tree/Graph) and Prefix Sum, started in July, come back hidden (D14) and Binary Search + Greedy waits for Binary Search; Greedy + Sorting with Prefix finishes its block once Prefix Sum reaches pass 1.

## 8. Verification queries

Read-only. Run with the app stopped, or add `-readonly`:

```bash
sqlite3 -readonly data/sqlite/dsa.db "<query>"
```

**8.1 Counts (before step 2 and after step 6).** Only `problem_reviews` should grow, by the number step 5 added. On the 2026-10-25 copy: 50 / 291 / 66 / 45 / 39 / 40 before, reviews 44 after.

```sql
SELECT (SELECT count(*) FROM topics) AS topics, (SELECT count(*) FROM problems) AS problems,
       (SELECT count(*) FROM problem_attempts) AS attempts, (SELECT count(*) FROM sessions) AS sessions,
       (SELECT count(*) FROM problem_reviews) AS reviews, (SELECT count(*) FROM cards) AS cards;
```

**8.2 Integrity.** Expect `ok`.

```sql
PRAGMA integrity_check;
```

**8.3 Migration 0017.** Expect four rows.

```sql
SELECT name FROM pragma_table_info('problem_attempts')
 WHERE name IN ('help_level', 'help_source', 'pattern_guess', 'takeaway');
```

**8.4 No review interval past its confidence cap** (the caps step 4 uses). Expect no rows after step 4; before it, the same topics the dry run lists.

```sql
SELECT name, confidence, sm2_interval, date(next_revision_at / 1000, 'unixepoch') AS next_review
  FROM topics
 WHERE sm2_interval > CASE WHEN confidence < 40 THEN 7 WHEN confidence < 60 THEN 21
                           WHEN confidence < 80 THEN 45 ELSE 120 END;
```

**8.5 Every "Revision needed" problem is in the re-solve pool.** Expect 0.

```sql
SELECT count(*) FROM problems p
 WHERE p.status = 'Revision needed'
   AND NOT EXISTS (SELECT 1 FROM problem_reviews r WHERE r.problem_id = p.id);
```

**8.6 No pin left.** Expect both values empty.

```sql
SELECT key, value FROM sync_meta
 WHERE key IN ('curriculum_active_topic_id', 'curriculum_active_topic_set_at');
```

**8.7 Repaired topics waiting for Notion.** After step 4, a JSON list with one entry per repaired topic (its new `sm2Interval` and `nextRevisionAt`); the next sync pushes them and empties it.

```sql
SELECT value FROM sync_meta WHERE key = 'pending_topic_pushes';
```

**8.8 With the app running.**

```bash
curl -s http://127.0.0.1:3000/api/flags
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/api/plan/today | python3 -c 'import json,sys; p=json.load(sys.stdin); q=p.get("queue"); print(p["primaryTopic"]["name"], "|", q and q["dayKind"], "|", q and q["decision"]["why"])'
```

`queue` is absent until group A is on; `dayKind` is `mixed` on some days only once group C is on.

## 9. Rollback

Whenever you copy a database file back, delete its `-wal` and `-shm` files first. In the dry run, a leftover `-wal` silently replayed a test solve onto a restored copy.

**Level 1: a flag misbehaves.** Delete its line from `.env` and restart. No data to undo; the table in step 7 says what each one leaves behind. Turn off group C before group A (C depends on A).

**Level 2: a data step went wrong.**
- Step 5: `pnpm db:backfill-resolve-pool --revert`.
- Step 4: stop the app and restore the backup the script made in `data/backups/` (or step 1's), then remove any newer `-wal` / `-shm`. Notion keeps the repaired "Next Review" dates if a sync already pushed them; local scheduling is owned by SQLite, so a Notion pull won't bring them back.
- Step 6: re-pin from Settings → Curriculum → Switch.

**Level 3: back out the whole overhaul.**

```bash
pnpm study:stop
git revert -m 1 <merge commit from step 2>    # git log --merges -1 shows it
pnpm install && pnpm build
```

Then either:
- **Keep the data** (sessions logged since the merge stay). `main` without the overhaul ignores the four 0017 columns: in the P8.2 dry run, `main` at `f60c5dc` booted on the fully migrated copy and served Today with no errors. To drop them anyway: `sqlite3 data/sqlite/dsa.db < database/migrations/down/0017_attempt_signals.down.sql` (back up first; it needs SQLite 3.35+, which macOS has). Dry run: dropped exactly the four columns, kept all 66 attempts, integrity `ok`.
- **Or restore step 1's backup** over `data/sqlite/dsa.db` (and remove any newer `-wal` / `-shm`). Everything done since step 1 is lost, and Notion still has anything a sync pushed since.

`FLAG_…` lines left in `.env` are ignored by the old code.

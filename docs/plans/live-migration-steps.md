# Live migration steps

Steps for Santosh to run on the **live** app when `overhaul` is merged. Agents never run these on live. Each phase adds its own section; P8.1 completes the runbook (order, flags, rollback).

The live app runs from `~/Desktop/dsa-mastery-os` with `SQLITE_PATH=./data/sqlite/dsa.db` and `PORT=3000`.

## 0. Before anything: stop the app and back up

```bash
cd ~/Desktop/dsa-mastery-os
pnpm study:stop                       # nothing may hold the database open
mkdir -p data/backups/pre-overhaul
cp data/sqlite/dsa.db "data/backups/pre-overhaul/dsa-$(date +%Y%m%d-%H%M%S).db"
# copy the -wal / -shm files too if they exist
for f in data/sqlite/dsa.db-wal data/sqlite/dsa.db-shm; do [ -f "$f" ] && cp "$f" data/backups/pre-overhaul/; done
```

Rollback for every step below: stop the app and copy that backup back over `data/sqlite/dsa.db` (and remove any newer `-wal` / `-shm`).

## P2.2 — Repair topic review schedules

Old length-based scoring gave weak topics review dates years out. The repair pulls each one back to its confidence cap (under 40% → 7 days, under 60% → 21, under 80% → 45, otherwise 120). A date that is already past stays as is.

```bash
pnpm db:repair-schedules              # dry run: lists what would change, writes nothing
pnpm db:repair-schedules --apply      # backs up into data/backups/, then applies
```

What to expect: on the 2026-10-19 copy of the live data (the dev DB), the dry run listed 5 topics:

| Topic | Confidence | Interval | Next review |
|---|---|---|---|
| Recursion & Backtracking | 32% | 3900 → 7 days | 2037-03-09 → tomorrow |
| Fast & Slow Pointers | 30% | 1459 → 7 days | 2030-10-09 → tomorrow |
| Two Pointers | 53% | 456 → 21 days | 2027-12-19 → tomorrow |
| BFS | 22% | 380 → 7 days | 2027-09-17 → tomorrow |
| Binary Search + Prefix Sum | 43% | 42 → 21 days | unchanged (already due) |

Live data has moved on since then, so the list may differ. Read it before `--apply`. Anything with a date years out, or an interval in the hundreds, is the bug being fixed.

Notes:
- `--apply` marks the repaired topics for a Notion push, so Notion's "Next Review" fields update on the next sync. That is intended.
- "Tomorrow" means all repaired topics become due the same day. Catch-up compression spreads them across days, so Today does not show a wall of revisions.

Verify (with the app still stopped):

```bash
pnpm db:repair-schedules              # should now say "Nothing to do"
```

## P3.2 — Put every "Revision needed" problem in the re-solve pool

Some problems are marked `Revision needed` (often in Notion) but have no re-solve row, so they never come back for a re-solve. This adds the missing rows. It is local-only: `problem_reviews` never syncs to Notion.

```bash
pnpm db:backfill-resolve-pool            # dry run: lists the problems it would add
pnpm db:backfill-resolve-pool --apply    # backs up into data/backups/, then adds them
pnpm db:backfill-resolve-pool            # should now say "Nothing to do"
```

What to expect: on the dev DB it added 5 (Maximum Depth of N-ary Tree, Two Sum, Subsets, Subsets II, Maximum Sum Subarray of Size K). Due dates are spread one per day, oldest first, so only one lands today.

Rollback: `pnpm db:backfill-resolve-pool --revert` removes exactly the rows `--apply` added (their ids are recorded in `sync_meta`), except any you have re-solved since.

## P3.3 — Clear the stale curriculum pin

Live is pinned to Greedy Sorting (the dev copy was). After the merge a pin ends by itself when the topic's first pass is complete or 7 days after it was set. A pin from before the merge has no date, so its 7-day clock starts the first time the app plans the day. To clear it right away instead, start the app and do either:

- On Today, tap **Unpin** next to "Pinned · Greedy Sorting".
- Or from a terminal:

  ```bash
  curl -s -X PUT http://127.0.0.1:3000/api/curriculum/active \
    -H 'Content-Type: application/json' -d '{"topicId": null}'
  ```

Verify: Today no longer shows "Pinned", and the hero names the curriculum's next topic (BFS on the dev copy). Rollback: pin it again from Settings → Curriculum → Switch.

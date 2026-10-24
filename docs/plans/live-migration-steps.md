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

## P3.3 — Clear the stale curriculum pin

_Added with P3.3._

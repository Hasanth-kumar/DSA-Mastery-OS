/**
 * P3.2: put every `Revision needed` problem into the re-solve pool.
 *
 *   pnpm db:backfill-resolve-pool            # dry run: lists what WOULD be added
 *   pnpm db:backfill-resolve-pool --apply    # backs up the database, then adds rows
 *   pnpm db:backfill-resolve-pool --revert   # removes the rows the last --apply added,
 *                                            # unless they have been reviewed since
 *
 * Rows are local-only (`problem_reviews`, never synced to Notion). The ids an
 * --apply added are recorded in sync_meta so --revert removes exactly those.
 * Run it with the API stopped (pnpm study:stop).
 */
import { loadConfig } from "@dsa/shared";
import { createAppContext } from "../context.js";

const RECORD_KEY = "resolve_pool_backfill_p3_2";
const apply = process.argv.includes("--apply");
const revert = process.argv.includes("--revert");
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function main(): Promise<void> {
  if (apply && revert) throw new Error("Pass --apply or --revert, not both.");
  const ctx = createAppContext(loadConfig());
  try {
    if (revert) {
      const raw = ctx.syncMetaRepo.get(RECORD_KEY);
      const ids = raw ? ((JSON.parse(raw) as { ids?: string[] }).ids ?? []) : [];
      if (ids.length === 0) {
        console.log("No recorded backfill to revert.");
        return;
      }
      const backup = await ctx.backupService.backupNow();
      console.log(`Backed up the database first: ${JSON.stringify(backup)}`);
      const { removed, kept } = ctx.problemReviewService.revertRevisionNeededBackfill(ids);
      ctx.syncMetaRepo.set(RECORD_KEY, JSON.stringify({ revertedAt: Date.now(), ids: kept }));
      console.log(`Removed ${removed.length} row(s). Kept ${kept.length} that were reviewed since.`);
      await ctx.planService.invalidateTodaysPlan();
      return;
    }

    const items = ctx.problemReviewService.planRevisionNeededBackfill();
    if (items.length === 0) {
      console.log("Every Revision needed problem is already in the re-solve pool. Nothing to do.");
      return;
    }
    const names = new Map(ctx.problemRepo.findAll().map((p) => [p.id, p.name]));
    console.log(`${items.length} Revision needed problem(s) are missing from the re-solve pool:\n`);
    for (const i of items) {
      console.log(`  ${(names.get(i.problemId) ?? i.problemId).padEnd(52)} ${i.reason.padEnd(8)} due ${fmt(i.due)}`);
    }
    if (!apply) {
      console.log("\nDry run only — nothing was changed. Re-run with --apply to add these.");
      return;
    }

    const backup = await ctx.backupService.backupNow();
    console.log(`\nBacked up the database first: ${JSON.stringify(backup)}`);
    const admitted = ctx.problemReviewService.applyRevisionNeededBackfill(items);
    const previous = ctx.syncMetaRepo.get(RECORD_KEY);
    const prevIds = previous ? ((JSON.parse(previous) as { ids?: string[] }).ids ?? []) : [];
    ctx.syncMetaRepo.set(
      RECORD_KEY,
      JSON.stringify({ appliedAt: Date.now(), ids: [...new Set([...prevIds, ...admitted])] }),
    );
    await ctx.planService.invalidateTodaysPlan();
    console.log(`Added ${admitted.length} problem(s) to the re-solve pool.`);
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

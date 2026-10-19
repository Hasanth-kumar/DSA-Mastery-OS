/**
 * Repair topic review schedules that run longer than the topic's confidence allows
 * (e.g. a 30%-confidence topic scheduled for 2030, caused by sessions being scored
 * on length instead of outcome).
 *
 *   pnpm db:repair-schedules            # dry run: prints what WOULD change, writes nothing
 *   pnpm db:repair-schedules --apply    # backs up the database first, then applies
 *
 * Changes go through the normal topic update + Notion dirty-marking, so they sync
 * like any other edit. Run it with the API stopped (pnpm study:stop) or accept that
 * the running server's cache may show old dates until its next refresh.
 */
import { planScheduleRepair } from "@dsa/intelligence";
import { loadConfig } from "@dsa/shared";
import { createAppContext } from "../context.js";

const apply = process.argv.includes("--apply");
const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "none");

async function main(): Promise<void> {
  const ctx = createAppContext(loadConfig());
  try {
    const items = planScheduleRepair(ctx.topicRepo.findAll());

    if (items.length === 0) {
      console.log("No topic schedules exceed their confidence cap. Nothing to do.");
      return;
    }

    console.log(`${items.length} topic schedule(s) are longer than their confidence allows:\n`);
    for (const i of items) {
      console.log(
        `  ${i.name.padEnd(34)} conf ${String(i.confidence).padStart(3)}%  ` +
          `interval ${String(i.currentIntervalDays).padStart(5)}d -> ${String(i.newIntervalDays).padStart(3)}d   ` +
          `next ${fmt(i.currentNextRevisionAt)} -> ${fmt(i.newNextRevisionAt)}`,
      );
    }

    if (!apply) {
      console.log("\nDry run only — nothing was changed. Re-run with --apply to write these.");
      return;
    }

    const backup = await ctx.backupService.backupNow();
    console.log(`\nBacked up the database first: ${JSON.stringify(backup)}`);

    for (const i of items) {
      ctx.topicRepo.update(i.topicId, {
        sm2Interval: i.newIntervalDays,
        nextRevisionAt: i.newNextRevisionAt,
      });
      ctx.notionSync.markTopicDirty(i.topicId);
    }
    await ctx.planService.invalidateTodaysPlan();
    console.log(`Applied ${items.length} schedule repair(s). They will sync to Notion on the next sync.`);
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

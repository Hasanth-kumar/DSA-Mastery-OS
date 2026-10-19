/**
 * Remove duplicate problem rows from Notion (same LeetCode URL).
 * Keeps the best row per URL, merges topic relations, archives the rest.
 *
 * Usage:
 *   pnpm db:dedupe-problems           # dry run
 *   pnpm db:dedupe-problems -- --apply
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@dsa/shared";
import { createNotionClient } from "../notion/NotionClient.js";
import {
  countUniqueProblems,
  describeDuplicateGroup,
  filterFullProblemPages,
  groupProblemDuplicates,
} from "../notion/dedupe-problems.js";
import { syncNotionToSqlite } from "../sqlite/sync.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const apply = process.argv.includes("--apply");

async function main() {
  const cfg = loadConfig(resolve(repoRoot, ".env"));
  if (!cfg.notion.syncEnabled) {
    console.warn("[notion] dedupe skipped: NOTION_SYNC_ENABLED=false");
    return;
  }
  const notion = createNotionClient(cfg.notion);
  const rawPages = await notion.queryDatabase(cfg.notion.problemsDbId!);
  const pages = filterFullProblemPages(rawPages);
  const groups = groupProblemDuplicates(pages);

  const rowsToArchive = groups.reduce((sum, g) => sum + g.duplicates.length, 0);

  console.log(`Problems before: ${pages.length}`);
  console.log(`Unique by LeetCode URL: ${countUniqueProblems(pages)}`);
  console.log(`Duplicate groups: ${groups.length}`);
  console.log(`Rows to archive: ${rowsToArchive}`);
  console.log(`Mode: ${apply ? "APPLY (will modify Notion)" : "DRY RUN"}`);
  console.log("");

  if (groups.length > 0) {
    console.log("Sample groups:");
    for (const group of groups.slice(0, 8)) {
      console.log(`  ${describeDuplicateGroup(group)}`);
    }
    if (groups.length > 8) {
      console.log(`  ... and ${groups.length - 8} more`);
    }
  }

  if (!apply) {
    console.log("\nRe-run with --apply to archive duplicates in Notion.");
    return;
  }

  if (rowsToArchive === 0) {
    console.log("\nNothing to do.");
    return;
  }

  let mergedTopics = 0;
  let archived = 0;

  for (const group of groups) {
    const keeperTopics = new Set(
      (group.keeper.properties.Topic?.type === "relation"
        ? group.keeper.properties.Topic.relation
        : []
      ).map((r) => r.id),
    );
    const needsTopicMerge =
      group.mergedTopicIds.length > keeperTopics.size ||
      group.mergedTopicIds.some((id) => !keeperTopics.has(id));

    if (needsTopicMerge && group.mergedTopicIds.length > 0) {
      await notion.setProblemTopics(group.keeper.id, group.mergedTopicIds);
      mergedTopics += 1;
    }

    for (const duplicate of group.duplicates) {
      await notion.archivePage(duplicate.id);
      archived += 1;
      if (archived % 25 === 0) {
        console.log(`Archived ${archived}/${rowsToArchive}...`);
      }
    }
  }

  const result = await syncNotionToSqlite(notion, cfg.sqlite.path);

  console.log("\nDone.");
  console.log(`Merged topics on ${mergedTopics} keeper rows`);
  console.log(`Archived ${archived} duplicate rows`);
  console.log(`SQLite resynced: ${result.problems} problems`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

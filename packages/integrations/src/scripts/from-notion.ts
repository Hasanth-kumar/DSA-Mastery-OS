/**
 * One-way sync: Notion → SQLite mirror.
 * Run via: pnpm db:seed (from repo root)
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@dsa/shared";
import { createNotionClient } from "../notion/NotionClient.js";
import { syncNotionToSqlite } from "../sqlite/sync.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));

async function main() {
  const cfg = loadConfig(resolve(repoRoot, ".env"));
  if (!cfg.notion.syncEnabled) {
    console.warn("[notion] seed skipped: NOTION_SYNC_ENABLED=false");
    return;
  }
  const notion = createNotionClient(cfg.notion);
  const result = await syncNotionToSqlite(notion, cfg.sqlite.path);

  console.log("Sync complete:", result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Orphan-topic problem suggestions (E3). Suggest, don't auto-create:
 *
 *   pnpm db:suggest-problems               propose problems for topics with none
 *                                          → review file data/problem-suggestions.{json,md}
 *   pnpm db:suggest-problems -- --approve  create the reviewed rows in Notion, then resync
 *
 * Off the hot path: uses the generation chain (local Ollama first, free cloud
 * fallback). Slugs are best-effort validated against LeetCode's public API —
 * rows that can't be checked stay in the file for the human to judge.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { loadConfig } from "@dsa/shared";
import { createSqliteDb, runMigrations } from "../sqlite/client.js";
import { createLeetCodeClient } from "../leetcode/LeetCodeClient.js";
import { createNotionClient } from "../notion/NotionClient.js";
import {
  buildSuggestionPrompt,
  createBatchGenerationClient,
  parseProblemSuggestions,
  DEFAULT_OLLAMA_GEN_MODEL,
  type ProblemSuggestionDraft,
} from "../generation/index.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const REVIEW_JSON = resolve(repoRoot, "data/problem-suggestions.json");
const REVIEW_MD = resolve(repoRoot, "data/problem-suggestions.md");

interface TopicSuggestions {
  topicId: string;
  topicName: string;
  suggestions: (ProblemSuggestionDraft & { slugValid: boolean | null })[];
}

function findOrphanTopics(sqlite: Database.Database): { id: string; name: string }[] {
  return sqlite
    .prepare(
      `SELECT t.id, t.name FROM topics t
       LEFT JOIN problems p ON p.topic_id = t.id
       WHERE p.id IS NULL ORDER BY t.name`,
    )
    .all() as { id: string; name: string }[];
}

async function suggest(): Promise<void> {
  const cfg = loadConfig(resolve(repoRoot, ".env"));
  runMigrations(cfg.sqlite.path);
  const { sqlite } = createSqliteDb(cfg.sqlite.path);

  try {
    const orphans = findOrphanTopics(sqlite);
    if (orphans.length === 0) {
      console.log("No orphan topics — every topic has at least one problem.");
      return;
    }
    console.log(`${orphans.length} orphan topic(s): ${orphans.map((t) => t.name).join(", ")}`);

    const llm = createBatchGenerationClient({
      provider: cfg.llm.provider,
      localModel: process.env.OLLAMA_GEN_MODEL ?? DEFAULT_OLLAMA_GEN_MODEL,
      cloud: {
        apiKey: cfg.llm.openrouter.apiKey ?? "",
        model: cfg.llm.model,
        baseUrl: cfg.llm.openrouter.baseUrl,
        siteUrl: cfg.llm.openrouter.siteUrl,
        siteName: cfg.llm.openrouter.siteName,
      },
    });
    const leetcode = createLeetCodeClient({ username: cfg.leetcode?.username ?? "" });

    const results: TopicSuggestions[] = [];
    for (const topic of orphans) {
      const raw = await llm.generate(buildSuggestionPrompt(topic.name));
      const drafts = parseProblemSuggestions(raw).slice(0, 3);
      const suggestions: TopicSuggestions["suggestions"] = [];
      for (const draft of drafts) {
        const slugValid = await leetcode.validateProblemSlug(draft.slug);
        if (slugValid === false) {
          console.log(`  [${topic.name}] dropped "${draft.name}" — slug not on LeetCode`);
          continue;
        }
        suggestions.push({ ...draft, slugValid });
      }
      results.push({ topicId: topic.id, topicName: topic.name, suggestions });
      console.log(`  [${topic.name}] ${suggestions.length} suggestion(s)`);
    }

    mkdirSync(resolve(repoRoot, "data"), { recursive: true });
    writeFileSync(REVIEW_JSON, JSON.stringify(results, null, 2));
    writeFileSync(
      REVIEW_MD,
      [
        "# Problem suggestions for orphan topics",
        "",
        "Review, edit `problem-suggestions.json` (delete rows you don't want),",
        "then run `pnpm db:suggest-problems -- --approve` to create them in Notion.",
        "",
        ...results.flatMap((r) => [
          `## ${r.topicName}`,
          ...r.suggestions.map(
            (s) =>
              `- [${s.name}](${s.link}) — ${s.difficulty}` +
              (s.slugValid === null ? " (slug unverified)" : ""),
          ),
          "",
        ]),
      ].join("\n"),
    );
    console.log(`Review files written:\n  ${REVIEW_JSON}\n  ${REVIEW_MD}`);
  } finally {
    sqlite.close();
  }
}

async function approve(): Promise<void> {
  const cfg = loadConfig(resolve(repoRoot, ".env"));
  if (!cfg.notion.writeEnabled) {
    console.warn("[notion] approve skipped: NOTION_WRITE_ENABLED=false");
    return;
  }
  const results = JSON.parse(readFileSync(REVIEW_JSON, "utf-8")) as TopicSuggestions[];
  const notion = createNotionClient(cfg.notion);

  let created = 0;
  for (const r of results) {
    for (const s of r.suggestions) {
      await notion.createProblem({
        name: s.name,
        topicId: r.topicId,
        difficulty: s.difficulty,
        leetcodeLink: s.link,
      });
      created++;
      console.log(`  [${r.topicName}] created "${s.name}" in Notion`);
    }
  }
  console.log(
    `${created} problem(s) created. Pull them into the mirror with: pnpm db:seed (or POST /api/sync).`,
  );
}

const mode = process.argv.includes("--approve") ? approve : suggest;
mode().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

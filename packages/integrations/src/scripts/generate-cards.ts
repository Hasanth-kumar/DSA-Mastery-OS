/**
 * Batch card-generation pipeline runner (design §5).
 * Run via: pnpm db:generate-cards                  (drain the dirty topic queue)
 *          pnpm db:generate-cards -- --topic <id>  (generate one topic now)
 *          pnpm db:generate-cards -- --mark <id>   (mark a topic dirty, no gen)
 *
 * Off the hot path: identifies uncovered concepts from the closed vocabulary,
 * asks the configured generation LLM (local Ollama first, free cloud tier as a
 * fallback — §13/§14) to fill ONLY those concepts, runs Stage A + Stage B dedup,
 * and stores unique cards with provenance + a CardGenerated event. Vectors are
 * embedded locally and never synced.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@dsa/shared";
import { createSqliteDb, runMigrations } from "../sqlite/client.js";
import { createOllamaEmbedder } from "../embeddings/index.js";
import {
  CardGenerationService,
  createBatchGenerationClient,
  createSeedVocabularyResolver,
  createDbNoteProvider,
  markTopicDirty,
  DEFAULT_OLLAMA_GEN_MODEL,
} from "../generation/index.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const cfg = loadConfig(resolve(repoRoot, ".env"));
  runMigrations(cfg.sqlite.path);
  const { sqlite } = createSqliteDb(cfg.sqlite.path);

  try {
    const markTopic = arg("--mark");
    if (markTopic) {
      markTopicDirty(sqlite, markTopic);
      console.log(`Marked topic dirty: ${markTopic}`);
      return;
    }

    const localModel = process.env.OLLAMA_GEN_MODEL ?? DEFAULT_OLLAMA_GEN_MODEL;
    const cloudModel = cfg.llm.model;
    const llm = createBatchGenerationClient({
      provider: cfg.llm.provider,
      localModel,
      cloud: {
        apiKey: cfg.llm.openrouter.apiKey ?? "",
        model: cloudModel,
        baseUrl: cfg.llm.openrouter.baseUrl,
        siteUrl: cfg.llm.openrouter.siteUrl,
        siteName: cfg.llm.openrouter.siteName,
      },
    });

    const service = new CardGenerationService({
      db: sqlite,
      llm,
      embedder: createOllamaEmbedder(),
      resolveVocabulary: createSeedVocabularyResolver(resolve(repoRoot, "database/seeds")),
      loadNotes: createDbNoteProvider(sqlite),
      modelVersion: process.env.GENERATION_PROVIDER === "ollama" ? localModel : cloudModel,
    });

    const single = arg("--topic");
    const reports = single
      ? [await service.generateForTopic(single, { clearDirty: true })]
      : await service.generateForDirtyTopics();

    if (reports.length === 0) {
      console.log("No dirty topics to generate. Mark one with --mark <topicId>.");
    }
    for (const r of reports) {
      console.log(
        `[${r.topicId}] uncovered=${r.uncovered.length} sanitized=${r.sanitized} ` +
          `dropDup=${r.droppedByDedup} stored=${r.stored}` +
          (r.skipped ? ` skipped=${r.skipped}` : ""),
      );
    }
  } finally {
    sqlite.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

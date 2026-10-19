import { loadConfig } from "@dsa/shared";
import { buildApp } from "./app.js";
import { createAppContext } from "./context.js";
import { startSchedulers } from "./schedulers/index.js";

async function main() {
  const config = loadConfig();
  const ctx = createAppContext(config);

  const schedulers = startSchedulers(ctx);
  const app = buildApp(config, ctx);

  // Obsidian vault ingestion (Phase 2): full scan + live watcher.
  if (ctx.obsidianNotes.isConfigured()) {
    try {
      const scan = ctx.obsidianNotes.scanVault();
      app.log.info(
        `Obsidian vault scanned: ${scan.scanned} notes, ${scan.matched} matched to problems`,
      );
    } catch (err) {
      app.log.warn({ err }, "Obsidian vault scan failed");
    }
    ctx.obsidianNotes.startWatching((err) =>
      app.log.warn({ err }, "Obsidian watcher error"),
    );
  }

  // Nightly SQLite backup with rotation (5.1).
  ctx.backupService.start((err) => app.log.warn({ err }, "SQLite backup failed"));

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    // Hard backstop: always exit even if a flush/close hangs past its own caps.
    const deadline = setTimeout(() => process.exit(0), 8000);
    deadline.unref();

    // Flush pending local edits to Notion before closing the SQLite handle.
    // Push-only (never pulls); failures stay queued and replay on next sync.
    if (ctx.notionSync.isConfigured()) {
      try {
        const flushed = await ctx.notionSync.flushPendingToNotion();
        app.log.info(
          `Shutdown flush: pushed ${flushed.pushedTopics} topics / ${flushed.pushedProblems} problems, ${flushed.failed} queued for next sync`,
        );
      } catch (err) {
        app.log.warn({ err }, "Shutdown flush failed — pending edits replay on next sync");
      }
    }

    try {
      const cardFlush = await ctx.cardBankSync.flush();
      if (cardFlush.pushed > 0) {
        app.log.info(
          `Card bank shutdown flush: pushed ${cardFlush.pushed}, ${cardFlush.failed} still dirty`,
        );
      }
    } catch (err) {
      app.log.warn({ err }, "Card bank shutdown flush failed — dirty cards replay on next flush");
    }

    await schedulers.close();
    await ctx.close();
    await app.close();
  };

  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    app.log.info(`API listening on http://localhost:${config.port}`);
    app.log.info(`SQLite ${config.sqlite.path}`);
    if (!config.notion.syncEnabled || !config.notion.writeEnabled) {
      app.log.info(
        `Notion isolation: sync=${config.notion.syncEnabled} writes=${config.notion.writeEnabled}`,
      );
    }
    if (!config.whatsapp.enabled) {
      app.log.info("WhatsApp sends disabled (WHATSAPP_ENABLED=false)");
    }
    if (config.llm.provider !== "openrouter") {
      app.log.info(`LLM provider ${config.llm.provider} (no outbound calls)`);
    }
    if (config.schedulers.enabled) {
      app.log.info("Weekly digest scheduler active (in-process cron — daily pushes removed)");
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();

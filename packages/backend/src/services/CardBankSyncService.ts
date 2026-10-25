/**
 * Card-bank sync wiring (design §8, §10, build-order stage 6). Batched,
 * delta-only flush to Notion when configured, otherwise the local JSON+MD export
 * hedge. The app never imports `@notionhq/client` here — only {@link SyncTarget}
 * adapters from `@dsa/integrations`.
 */
import {
  CardSyncService,
  createJsonFileSyncTarget,
  createNotionSyncTarget,
  type CardSyncReport,
  type PullApplyResult,
  type SqliteLike,
} from "@dsa/integrations";
import type { AppConfig } from "@dsa/shared";

export interface CardSyncHealth {
  target: string;
  configured: boolean;
  pendingDirty: number;
  lastFlushAt: string | null;
}

const LAST_FLUSH_KEY = "cards_sync_last_flush_at";

export class CardBankSyncService {
  private readonly sync: CardSyncService;
  private readonly meta: { get(key: string): string | null; set(key: string, value: string): void };
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    sqlite: SqliteLike,
    config: AppConfig,
    meta: { get(key: string): string | null; set(key: string, value: string): void },
  ) {
    const notionReady =
      config.notion.syncEnabled !== false &&
      Boolean(config.notion.token && config.notion.cardsDbId);
    const target = notionReady
      ? createNotionSyncTarget({
          token: config.notion.token,
          cardsDbId: config.notion.cardsDbId,
          writeEnabled: config.notion.writeEnabled,
        })
      : createJsonFileSyncTarget({ dir: config.cards.exportDir });
    this.sync = new CardSyncService(sqlite, target);
    this.meta = meta;
  }

  getHealth(): CardSyncHealth {
    return {
      target: this.sync.targetName,
      configured: this.sync.isConfigured(),
      pendingDirty: this.sync.pendingCount(),
      lastFlushAt: this.meta.get(LAST_FLUSH_KEY),
    };
  }

  /** Batched delta flush (§8) — safe to call often; no-op when nothing is dirty. */
  async flush(now: number = Date.now()): Promise<CardSyncReport> {
    const report = await this.sync.flush(now);
    if (report.pushed > 0) {
      this.meta.set(LAST_FLUSH_KEY, new Date(now).toISOString());
    }
    return report;
  }

  async firstUpload(now: number = Date.now()): Promise<CardSyncReport> {
    const report = await this.sync.firstUpload(now);
    if (report.pushed > 0) {
      this.meta.set(LAST_FLUSH_KEY, new Date(now).toISOString());
    }
    return report;
  }

  async pull(now: number = Date.now()): Promise<PullApplyResult | null> {
    return this.sync.pull(now);
  }

  /** Periodic batched flush — never per-card (§8). */
  startPeriodicFlush(intervalMs: number): void {
    this.stopPeriodicFlush();
    if (intervalMs <= 0) return;
    this.intervalId = setInterval(() => {
      void this.flush().catch((err) => {
        console.error("Card sync periodic flush failed:", err);
      });
    }, intervalMs);
    this.intervalId.unref?.();
  }

  stopPeriodicFlush(): void {
    if (this.intervalId != null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

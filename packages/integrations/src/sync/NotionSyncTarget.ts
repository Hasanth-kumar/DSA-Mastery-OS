/**
 * Notion adapter for the card bank (design §8, §10, §13). This is the **only**
 * module in the codebase allowed to touch `@notionhq/client`; everything else
 * speaks {@link SyncTarget}. Uses the official client (free tier — not an MCP,
 * §10/§13), throttled to Notion's ~3 req/s limit (§8), and pushes **deltas
 * only** (the caller passes dirty cards). Field ownership lives in the pure
 * mapper: content + SR write-only mirror + provenance go up; a pull reads
 * content back only (§8).
 */
import { Client } from "@notionhq/client";
import PQueue from "p-queue";
import {
  cardToNotionProperties,
  cardToNotionPageBlocks,
  notionPageToContent,
  NOTION_CARD_SCHEMA,
  type NotionCardPropertyName,
} from "./card-properties.js";
import type { CardSyncRecord, SyncPushResult, SyncTarget } from "./SyncTarget.js";

/** Notion's published rate limit is ~3 requests/second (§8). */
export const NOTION_RATE_LIMIT = { intervalCap: 3, interval: 1000 } as const;

export interface NotionSyncConfig {
  token?: string;
  /** The single card database id (one DB, one row per card — §8). */
  cardsDbId?: string;
  /** Inject a client for tests; defaults to a real `@notionhq/client`. */
  client?: NotionClientLike;
  /**
   * When false, schema updates and card pushes are logged no-ops.
   * Pulls stay available. Omit to keep writes enabled.
   */
  writeEnabled?: boolean;
}

/** The minimal slice of `@notionhq/client` this adapter needs (keeps it stubbable). */
export interface NotionClientLike {
  pages: {
    create(args: {
      parent: { database_id: string };
      properties: Record<string, unknown>;
      /** Page-body blocks — code-heavy card bodies go here, not properties (§8). */
      children?: unknown[];
    }): Promise<{ id: string }>;
    update(args: { page_id: string; properties: Record<string, unknown> }): Promise<unknown>;
  };
  databases: {
    query(args: {
      database_id: string;
      start_cursor?: string;
    }): Promise<{ results: unknown[]; has_more: boolean; next_cursor: string | null }>;
    retrieve(args: { database_id: string }): Promise<{
      properties?: Record<string, { type?: string }>;
    }>;
    update(args: {
      database_id: string;
      properties: Record<string, unknown>;
    }): Promise<unknown>;
  };
}

const PROPERTY_DEFS: Record<string, () => Record<string, unknown>> = {
  rich_text: () => ({ rich_text: {} }),
  number: () => ({ number: { format: "number" } }),
  date: () => ({ date: {} }),
  select: () => ({ select: {} }),
  multi_select: () => ({ multi_select: {} }),
  checkbox: () => ({ checkbox: {} }),
};

export class NotionSyncTarget implements SyncTarget {
  readonly name = "notion";
  private readonly client: NotionClientLike;
  private readonly queue: PQueue;
  private schemaEnsured = false;

  constructor(private readonly config: NotionSyncConfig) {
    this.client = config.client ?? wrapRealClient(config.token ?? "");
    this.queue = new PQueue(NOTION_RATE_LIMIT);
  }

  /** Exposed so tests can assert the ~3 req/s throttle is wired (§8). */
  get rateLimit(): typeof NOTION_RATE_LIMIT {
    return NOTION_RATE_LIMIT;
  }

  isConfigured(): boolean {
    return Boolean(this.config.token && this.config.cardsDbId);
  }

  private refuseWrite(action: string): boolean {
    if (this.config.writeEnabled !== false) return false;
    console.warn(`[notion] write skipped (${action}): NOTION_WRITE_ENABLED=false`);
    return true;
  }

  /** Add any missing card-DB columns (§8 shape). Best-effort, runs once. */
  async ensureSchema(): Promise<void> {
    if (this.refuseWrite("ensureSchema")) return;
    if (this.schemaEnsured || !this.isConfigured()) return;
    const dbId = this.config.cardsDbId!;
    const current = await this.queue.add(() =>
      this.client.databases.retrieve({ database_id: dbId }),
    );
    const existing = current?.properties ?? {};
    assertSchemaTypes(existing);
    const toAdd: Record<string, unknown> = {};
    for (const [name, type] of Object.entries(NOTION_CARD_SCHEMA) as [
      NotionCardPropertyName,
      string,
    ][]) {
      if (type === "title") continue; // the DB already has exactly one title
      if (existing[name]) continue;
      const make = PROPERTY_DEFS[type];
      if (make) toAdd[name] = make();
    }
    if (Object.keys(toAdd).length > 0) {
      await this.queue.add(() =>
        this.client.databases.update({ database_id: dbId, properties: toAdd }),
      );
    }
    this.schemaEnsured = true;
  }

  /**
   * Push a delta of dirty cards (§8). Create when there is no `notionPageId`
   * mapping yet (capturing the new id back), update otherwise. Each card is a
   * single throttled request; one failure increments `failed` and leaves that
   * card dirty for the next flush — never aborts the batch.
   */
  async pushCards(records: CardSyncRecord[]): Promise<SyncPushResult> {
    if (this.refuseWrite("pushCards")) {
      // Leave every card dirty. A no-op must not look like a successful push.
      return {
        pushed: 0,
        failed: records.length,
        failedIds: records.map((record) => record.id),
        pageIds: {},
      };
    }
    if (records.length === 0 || !this.isConfigured()) {
      return { pushed: 0, failed: 0, pageIds: {} };
    }
    await this.ensureSchema();

    const dbId = this.config.cardsDbId!;
    const pageIds: Record<string, string> = {};
    const failedIds: string[] = [];
    let pushed = 0;
    let lastError: string | undefined;

    await Promise.all(
      records.map((record) =>
        this.queue.add(async () => {
          const properties = cardToNotionProperties(record) as Record<string, unknown>;
          try {
            if (record.notionPageId) {
              await this.client.pages.update({
                page_id: record.notionPageId,
                properties,
              });
            } else {
              // Attach a page body only for code-heavy cards (§8): their
              // formatted Front/Back live in blocks, not length-limited props.
              const children = cardToNotionPageBlocks(record);
              const created = await this.client.pages.create({
                parent: { database_id: dbId },
                properties,
                ...(children.length > 0 ? { children } : {}),
              });
              if (created?.id) pageIds[record.id] = created.id;
            }
            pushed += 1;
          } catch (err) {
            const message = formatNotionError(err);
            lastError = message;
            console.error(`Notion card sync failed for ${record.id}: ${message}`);
            failedIds.push(record.id);
          }
        }),
      ),
    );

    if (failedIds.length > 0 && lastError) {
      console.error(
        `Notion card sync: ${failedIds.length} failed, ${pushed} pushed. Last error: ${lastError}`,
      );
    }

    return { pushed, failed: failedIds.length, failedIds, pageIds };
  }

  /** Pull the full bank (content-authoritative, §8) for a new-device rebuild. */
  async pullCards(): Promise<CardSyncRecord[]> {
    if (!this.isConfigured()) return [];
    const dbId = this.config.cardsDbId!;
    const out: CardSyncRecord[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.queue.add(() =>
        this.client.databases.query({ database_id: dbId, start_cursor: cursor }),
      );
      for (const result of page?.results ?? []) {
        const content = notionPageToContent(result as { id?: string; properties?: Record<string, unknown> });
        if (content) out.push(contentToRecord(content));
      }
      cursor = page?.has_more ? (page.next_cursor ?? undefined) : undefined;
    } while (cursor);

    return out;
  }
}

/** Wrap content in a record with neutral SR placeholders — the store's
 *  `applyPulledContent` reads content only, so SR fields here are never used. */
function contentToRecord(c: ReturnType<typeof notionPageToContent> & object): CardSyncRecord {
  return {
    id: c.id,
    topicId: c.topicId,
    type: c.type,
    front: c.front,
    back: c.back,
    conceptTags: c.conceptTags,
    stability: null,
    difficulty: null,
    due: null,
    lastReview: null,
    reps: 0,
    lapses: 0,
    state: 0,
    suspended: false,
    origin: "manual",
    sourceHash: null,
    modelVersion: null,
    promptVersion: null,
    noteVersion: null,
    notionPageId: c.notionPageId,
    updatedAt: 0,
  };
}

/** Isolate the real-client casting in one spot (the rest of the app stays clean). */
function wrapRealClient(token: string): NotionClientLike {
  const client = new Client({ auth: token });
  return {
    pages: {
      create: (args) =>
        client.pages.create(
          args as Parameters<Client["pages"]["create"]>[0],
        ) as Promise<{ id: string }>,
      update: (args) =>
        client.pages.update(args as Parameters<Client["pages"]["update"]>[0]),
    },
    databases: {
      query: (args) =>
        client.databases.query(args) as Promise<{
          results: unknown[];
          has_more: boolean;
          next_cursor: string | null;
        }>,
      retrieve: (args) =>
        client.databases.retrieve(args) as Promise<{
          properties?: Record<string, { type?: string }>;
        }>,
      update: (args) =>
        client.databases.update(
          args as Parameters<Client["databases"]["update"]>[0],
        ),
    },
  };
}

export function createNotionSyncTarget(config: NotionSyncConfig): NotionSyncTarget {
  return new NotionSyncTarget(config);
}

/** CSV import often creates text columns where we need select/multi_select. */
export function assertSchemaTypes(
  existing: Record<string, { type?: string }>,
): void {
  const mismatches: string[] = [];
  for (const [name, expectedType] of Object.entries(NOTION_CARD_SCHEMA) as [
    NotionCardPropertyName,
    string,
  ][]) {
    const actualType = existing[name]?.type;
    if (actualType && actualType !== expectedType) {
      mismatches.push(`"${name}" is ${actualType}, expected ${expectedType}`);
    }
  }
  if (mismatches.length === 0) return;
  throw new Error(
    `Notion card database schema mismatch: ${mismatches.join("; ")}. ` +
      "Delete the mismatched columns in Notion (CSV import often creates them as text), " +
      "then run flush again — the app will recreate them with the correct types.",
  );
}

function formatNotionError(err: unknown): string {
  const body = (err as { body?: { message?: string } })?.body;
  if (body?.message) return body.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

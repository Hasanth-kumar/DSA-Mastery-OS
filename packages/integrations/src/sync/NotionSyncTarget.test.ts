import { describe, it, expect, vi } from "vitest";
import {
  NotionSyncTarget,
  NOTION_RATE_LIMIT,
  assertSchemaTypes,
  type NotionClientLike,
} from "./NotionSyncTarget.js";
import type { CardSyncRecord } from "./SyncTarget.js";

function card(id: string, over: Partial<CardSyncRecord> = {}): CardSyncRecord {
  return {
    id,
    topicId: "two-pointers",
    type: "plain-recall",
    front: `front ${id}`,
    back: `back ${id}`,
    conceptTags: ["overflow"],
    stability: null,
    difficulty: null,
    due: 1000,
    lastReview: null,
    reps: 0,
    lapses: 0,
    state: 0,
    suspended: false,
    origin: "seed",
    sourceHash: null,
    modelVersion: null,
    promptVersion: null,
    noteVersion: null,
    notionPageId: null,
    updatedAt: 1000,
    ...over,
  };
}

interface Calls {
  created: string[];
  updated: string[];
  schemaProps: string[];
}

function stubClient(opts: {
  failId?: string;
  existingProps?: Array<string | [string, string]>;
} = {}): {
  client: NotionClientLike;
  calls: Calls;
} {
  const calls: Calls = { created: [], updated: [], schemaProps: [] };
  const existing = Object.fromEntries(
    (opts.existingProps ?? []).map((entry) => {
      const [name, type] = Array.isArray(entry) ? entry : [entry, "rich_text"];
      return [name, { type }];
    }),
  );
  const client: NotionClientLike = {
    pages: {
      create: async ({ properties }) => {
        const uuid = (properties.UUID as { rich_text: Array<{ text: { content: string } }> })
          .rich_text[0].text.content;
        if (uuid === opts.failId) throw new Error("notion 500");
        calls.created.push(uuid);
        return { id: `page-${uuid}` };
      },
      update: async ({ page_id }) => {
        if (page_id === opts.failId) throw new Error("notion 500");
        calls.updated.push(page_id);
        return {};
      },
    },
    databases: {
      query: async () => ({ results: [], has_more: false, next_cursor: null }),
      retrieve: async () => ({ properties: existing }),
      update: async ({ properties }) => {
        calls.schemaProps.push(...Object.keys(properties));
        return {};
      },
    },
  };
  return { client, calls };
}

const CONFIG = { token: "t", cardsDbId: "db" };

describe("NotionSyncTarget (§8, §10, §13)", () => {
  it("respects Notion's ~3 req/s rate limit config (§8)", () => {
    const target = new NotionSyncTarget({ ...CONFIG, client: stubClient().client });
    expect(target.rateLimit).toEqual(NOTION_RATE_LIMIT);
    expect(NOTION_RATE_LIMIT).toEqual({ intervalCap: 3, interval: 1000 });
  });

  it("creates cards without a page id and captures the mapping back", async () => {
    const { client, calls } = stubClient({ existingProps: Object.keys({}) });
    const target = new NotionSyncTarget({ ...CONFIG, client });
    const res = await target.pushCards([card("a"), card("b")]);
    expect(res.pushed).toBe(2);
    expect(res.failed).toBe(0);
    expect(calls.created.sort()).toEqual(["a", "b"]);
    expect(res.pageIds).toEqual({ a: "page-a", b: "page-b" });
  });

  it("updates cards that already have a page-id mapping (delta, §8)", async () => {
    const { client, calls } = stubClient();
    const target = new NotionSyncTarget({ ...CONFIG, client });
    const res = await target.pushCards([card("a", { notionPageId: "page-existing" })]);
    expect(res.pushed).toBe(1);
    expect(calls.updated).toEqual(["page-existing"]);
    expect(calls.created).toEqual([]);
  });

  it("keeps a failed card dirty via failedIds without aborting the batch (§8)", async () => {
    const { client } = stubClient({ failId: "bad" });
    const target = new NotionSyncTarget({ ...CONFIG, client });
    const res = await target.pushCards([card("good"), card("bad")]);
    expect(res.pushed).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.failedIds).toEqual(["bad"]);
  });

  it("ensures only missing schema columns (best-effort, §8 shape)", async () => {
    const { client, calls } = stubClient({ existingProps: ["UUID", "Back"] });
    const target = new NotionSyncTarget({ ...CONFIG, client });
    await target.ensureSchema();
    expect(calls.schemaProps).toContain("Stability");
    expect(calls.schemaProps).toContain("Concept Tags");
    expect(calls.schemaProps).not.toContain("UUID"); // already present
    expect(calls.schemaProps).not.toContain("Front"); // title is never added
  });

  it("skips card pushes when writes are disabled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, calls } = stubClient();
    const target = new NotionSyncTarget({ ...CONFIG, client, writeEnabled: false });
    const res = await target.pushCards([card("a"), card("b", { notionPageId: "page-b" })]);
    expect(res).toEqual({
      pushed: 0,
      failed: 2,
      failedIds: ["a", "b"],
      pageIds: {},
    });
    expect(calls.created).toEqual([]);
    expect(calls.updated).toEqual([]);
    expect(calls.schemaProps).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NOTION_WRITE_ENABLED=false"));
    warn.mockRestore();
  });

  it("returns zero counts when not configured (graceful, §1/§10)", async () => {
    const target = new NotionSyncTarget({ token: undefined, cardsDbId: undefined });
    expect(target.isConfigured()).toBe(false);
    expect(await target.pushCards([card("a")])).toEqual({
      pushed: 0,
      failed: 0,
      pageIds: {},
    });
  });

  it("rejects CSV-imported text columns where select/multi_select are required", () => {
    expect(() =>
      assertSchemaTypes({
        Front: { type: "title" },
        Type: { type: "rich_text" },
        "Concept Tags": { type: "rich_text" },
      }),
    ).toThrow(/schema mismatch.*Type.*Concept Tags/s);
  });
});

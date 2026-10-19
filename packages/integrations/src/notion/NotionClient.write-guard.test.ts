import type { Client } from "@notionhq/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotionClient } from "./NotionClient.js";

function stubClient() {
  const calls = {
    retrieve: 0,
    dbUpdate: 0,
    pageUpdate: 0,
    pageCreate: 0,
    append: 0,
    me: 0,
  };
  const client = {
    users: {
      me: async () => {
        calls.me += 1;
        return {};
      },
    },
    databases: {
      update: async () => {
        calls.dbUpdate += 1;
        return {};
      },
      query: async () => ({
        results: [],
        has_more: false,
        next_cursor: null,
      }),
      retrieve: async () => {
        calls.retrieve += 1;
        return {
          properties: {
            Confidence: { type: "number" },
            Status: { type: "status" },
            Attempts: { type: "number" },
          },
        };
      },
    },
    pages: {
      update: async () => {
        calls.pageUpdate += 1;
        return {};
      },
      create: async () => {
        calls.pageCreate += 1;
        return { id: "page-1" };
      },
    },
    blocks: {
      children: {
        append: async () => {
          calls.append += 1;
          return {};
        },
      },
    },
  };
  return { calls, client: client as unknown as Client };
}

const base = {
  token: "t",
  topicsDbId: "topics",
  problemsDbId: "problems",
  sessionsDbId: "sessions",
};

describe("Notion write guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips every write and does not call Notion when NOTION_WRITE_ENABLED=false", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls, client } = stubClient();
    const notion = new NotionClient({ ...base, client, writeEnabled: false });

    await notion.ensureTopicScheduleProperties();
    await notion.updateTopic("page", { confidence: 10 });
    await notion.updateProblem("page", { status: "Solved", attempts: 1 });
    const sessionId = await notion.createSession("sessions", {
      date: new Date("2026-10-19T00:00:00Z"),
      topicId: "topic",
      problemsSolved: 1,
      studyDuration: 10,
      productivityScore: 1,
    });
    const problemId = await notion.createProblem({ name: "Two Sum", topicId: "topic" });
    await notion.archivePage("page");
    await notion.setProblemTopics("page", ["topic"]);
    await notion.appendTopicNote("page", "note");

    expect(sessionId).toBe("notion-write-disabled");
    expect(problemId).toBe("notion-write-disabled");
    expect(calls).toEqual({
      retrieve: 0,
      dbUpdate: 0,
      pageUpdate: 0,
      pageCreate: 0,
      append: 0,
      me: 0,
    });
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "NOTION_WRITE_ENABLED=false",
    );
  });

  it("updates a page when writes are enabled", async () => {
    const { calls, client } = stubClient();
    const notion = new NotionClient({ ...base, client, writeEnabled: true });
    await notion.updateTopic("page-1", { confidence: 42 });
    expect(calls.retrieve).toBe(1);
    expect(calls.pageUpdate).toBe(1);
  });
});

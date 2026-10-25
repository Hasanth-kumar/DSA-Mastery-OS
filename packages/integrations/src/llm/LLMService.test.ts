import { describe, expect, it, vi } from "vitest";
import type { LLMChatMessage, LLMClient } from "./LLMClient.js";
import { createLLMService, LLMService, type ChatHistoryMessage } from "./LLMService.js";

function stubClient(overrides: Partial<LLMClient> = {}): LLMClient & { calls: LLMChatMessage[][] } {
  const calls: LLMChatMessage[][] = [];
  return {
    calls,
    isConfigured: () => true,
    generate: vi.fn().mockResolvedValue("ok"),
    chat: vi.fn(async (messages: LLMChatMessage[]) => {
      calls.push(messages);
      return "ok";
    }),
    async *chatStream() {
      yield "ok";
    },
    ...overrides,
  };
}

function newService(client: LLMClient) {
  return new LLMService({ model: "test-model", openrouter: { apiKey: "x" } }, client);
}

describe("LLMService.buildChatMessages (A3 input budget)", () => {
  it("keeps only the last 12 history messages", async () => {
    const client = stubClient();
    const service = newService(client);
    const history: ChatHistoryMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
    }));

    await service.generateChatReply(null, history, "latest question");

    const sent = client.calls[0]!;
    // system + 12 history + user
    expect(sent).toHaveLength(14);
    expect(sent[1]!.content).toBe("msg 8");
    expect(sent[12]!.content).toBe("msg 19");
  });

  it("drops oldest history messages once the char budget is exceeded", async () => {
    const client = stubClient();
    const service = newService(client);
    const history: ChatHistoryMessage[] = Array.from({ length: 10 }, () => ({
      role: "user",
      content: "x".repeat(2_000),
    }));

    await service.generateChatReply(null, history, "hi");

    const sent = client.calls[0]!;
    const historyChars = sent.slice(1, -1).reduce((sum, m) => sum + m.content.length, 0);
    expect(historyChars).toBeLessThanOrEqual(8_000);
  });

  it("truncates an oversized user message, keeping head and tail", async () => {
    const client = stubClient();
    const service = newService(client);
    const head = "A".repeat(12_000);
    const tail = "B".repeat(8_000);
    const middle = "C".repeat(10_000);
    const longMessage = head + middle + tail;

    await service.generateChatReply(null, [], longMessage);

    const sent = client.calls[0]!;
    const userMessage = sent[sent.length - 1]!.content;
    expect(userMessage.startsWith(head)).toBe(true);
    expect(userMessage.endsWith(tail)).toBe(true);
    expect(userMessage).toContain(`[...truncated ${middle.length} chars...]`);
  });

  it("leaves short user messages untouched", async () => {
    const client = stubClient();
    const service = newService(client);

    await service.generateChatReply(null, [], "a short question");

    const sent = client.calls[0]!;
    expect(sent[sent.length - 1]!.content).toBe("a short question");
  });
});

describe("LLMService.generateChatReply error surfacing (A3/A4)", () => {
  it("surfaces a specific message for context-length errors", async () => {
    const client = stubClient({
      chat: vi.fn().mockRejectedValue(new Error("This model's maximum context length is 8192 tokens")),
    });
    const service = newService(client);

    await expect(service.generateChatReply(null, [], "hi")).rejects.toThrow(
      "Input too large for the current model — trim your code or switch models.",
    );
  });

  it("wraps other failures with the generic unavailable message", async () => {
    const client = stubClient({
      chat: vi.fn().mockRejectedValue(new Error("All models failed (tried: a, b): boom")),
    });
    const service = newService(client);

    await expect(service.generateChatReply(null, [], "hi")).rejects.toThrow(
      "Coach is temporarily unavailable (All models failed (tried: a, b): boom). Please try again.",
    );
  });
});

describe("LLM provider mock", () => {
  it("answers locally and never calls fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const service = createLLMService({
      provider: "mock",
      model: "mock-model",
      openrouter: { apiKey: "should-not-be-used" },
    });
    const text = await service.generateChatReply(null, [], "hello");
    expect(text).toBe("[mock] outbound LLM disabled");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

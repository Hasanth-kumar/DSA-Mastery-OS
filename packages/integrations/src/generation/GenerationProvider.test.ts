import { describe, it, expect, vi } from "vitest";
import {
  createBatchGenerationClient,
  createGenerationClient,
  createOllamaGenerationClient,
  type GenerationClient,
} from "./GenerationProvider.js";

/**
 * Stage-5 runtime acceptance (design §13, §14). The generation client must
 * default to the local provider and transparently fall back to the free cloud
 * tier — both free, plugged into one chain.
 */
function fixed(text: string | null, configured = true): GenerationClient {
  return { isConfigured: () => configured, generate: async () => text };
}

describe("createGenerationClient — local-first fallback chain (§14)", () => {
  it("uses the local client when it returns content", async () => {
    const cloud = { isConfigured: () => true, generate: vi.fn(async () => "cloud") };
    const client = createGenerationClient({ local: fixed("local"), cloud });
    expect(await client.generate("p")).toBe("local");
    expect(cloud.generate).not.toHaveBeenCalled();
  });

  it("falls back to cloud when local is unconfigured", async () => {
    const client = createGenerationClient({ local: fixed("x", false), cloud: fixed("cloud") });
    expect(await client.generate("p")).toBe("cloud");
  });

  it("falls back to cloud when local throws", async () => {
    const local: GenerationClient = {
      isConfigured: () => true,
      generate: async () => {
        throw new Error("ollama down");
      },
    };
    const client = createGenerationClient({ local, cloud: fixed("cloud") });
    expect(await client.generate("p")).toBe("cloud");
  });

  it("falls back to cloud when local returns empty", async () => {
    const client = createGenerationClient({ local: fixed("   "), cloud: fixed("cloud") });
    expect(await client.generate("p")).toBe("cloud");
  });

  it("isConfigured is true if either link is configured", () => {
    expect(createGenerationClient({ local: fixed("x", false), cloud: fixed("y") }).isConfigured()).toBe(true);
    expect(createGenerationClient({ local: fixed("x", false), cloud: fixed("y", false) }).isConfigured()).toBe(false);
  });
});

describe("createBatchGenerationClient", () => {
  it("does not call fetch when the provider is mock", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createBatchGenerationClient({
      provider: "mock",
      cloud: { apiKey: "should-not-be-used", model: "google/gemma" },
    });
    expect(client.isConfigured()).toBe(true);
    expect(await client.generate("prompt")).toBe("[mock] outbound LLM disabled");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("LLM_PROVIDER=mock"));
    fetchSpy.mockRestore();
    warn.mockRestore();
  });
});

describe("createOllamaGenerationClient", () => {
  it("posts a non-streaming prompt to the local daemon and returns the response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ response: "  generated  " }),
      text: async () => "",
    })) as unknown as typeof fetch;
    const client = createOllamaGenerationClient({ fetchImpl, model: "qwen2.5" });
    expect(client.isConfigured()).toBe(true);
    expect(await client.generate("hello")).toBe("generated");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toContain("localhost:11434/api/generate");
    expect(JSON.parse(String((init as RequestInit).body)).stream).toBe(false);
  });
});

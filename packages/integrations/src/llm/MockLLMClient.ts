import type { LLMChatMessage, LLMClient } from "./LLMClient.js";

const MOCK_TEXT = "[mock] outbound LLM disabled";

/**
 * In-process stand-in for OpenRouter. `mock` answers locally; `disabled`
 * reports itself unconfigured so callers use their existing fallbacks.
 * Neither mode calls fetch.
 */
export function createMockLLMClient(mode: "mock" | "disabled"): LLMClient {
  const configured = mode === "mock";
  return {
    isConfigured: () => configured,
    generate: async () => (configured ? MOCK_TEXT : null),
    chat: async (_messages: LLMChatMessage[]) => (configured ? MOCK_TEXT : null),
    async *chatStream(_messages: LLMChatMessage[]) {
      if (configured) yield MOCK_TEXT;
    },
  };
}

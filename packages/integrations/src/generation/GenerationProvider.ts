import { createOpenRouterClient } from "../llm/OpenRouterClient.js";

/**
 * Batch-generation LLM runtime (design §13, §14).
 *
 * Card expansion runs OFF the hot path, in batch, so it can use a slower/cheaper
 * model. Per §14 the runtime is configurable and defaults to **local Ollama**
 * (Llama 3.1 / Qwen2.5 — true $0, nothing leaves the machine) with a **free
 * cloud tier kept as a fallback** in the chain. Both options are free; no paid
 * tier is ever required.
 *
 * The contract is the `generate(prompt)` subset of the existing `LLMClient`
 * (`llm.factory`), so the repo's OpenRouter client (free models like
 * `google/gemma-4-31b-it:free`) can serve as the cloud fallback with zero adaptation.
 */

/** Minimal generation contract — a subset of {@link LLMClient}. */
export interface GenerationClient {
  /** Whether this client is usable (configured / reachable). */
  isConfigured(): boolean;
  /** Produce text for a prompt, or null when unavailable/empty. */
  generate(prompt: string): Promise<string | null>;
}

export interface OllamaGenerationConfig {
  baseUrl?: string;
  /** Local model to use (must be pulled in Ollama). */
  model?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Request timeout (ms). Generation is batch/off-path so this can be generous. */
  timeoutMs?: number;
}

export const DEFAULT_OLLAMA_GEN_MODEL = "qwen2.5";

interface OllamaGenerateResponse {
  response?: string;
}

/**
 * A {@link GenerationClient} backed by a local Ollama daemon's `/api/generate`
 * (non-streaming). `isConfigured()` is true whenever a base URL is set — the
 * daemon's reachability is discovered at call time (and the factory's fallback
 * takes over if it throws).
 */
export function createOllamaGenerationClient(
  config: OllamaGenerationConfig = {},
): GenerationClient {
  const baseUrl = (config.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
  const model = config.model ?? DEFAULT_OLLAMA_GEN_MODEL;
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 120_000;

  return {
    isConfigured: () => baseUrl.length > 0,
    async generate(prompt: string): Promise<string | null> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await doFetch(`${baseUrl}/api/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, prompt, stream: false }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Ollama generate failed (${res.status}): ${await res.text()}`);
        }
        const body = (await res.json()) as OllamaGenerateResponse;
        const text = body.response?.trim();
        return text && text.length > 0 ? text : null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export interface FallbackGenerationConfig {
  /** Preferred (local) client, tried first. */
  local?: GenerationClient;
  /** Cloud free-tier client, used if local is unconfigured/throws/empty. */
  cloud?: GenerationClient;
}

/**
 * Build the generation client chain (§14): try local first, fall back to the
 * free cloud tier. `isConfigured()` is true if either link is. A local error or
 * empty response transparently rolls over to the cloud client when present.
 */
export function createGenerationClient(config: FallbackGenerationConfig): GenerationClient {
  const { local, cloud } = config;

  return {
    isConfigured: () =>
      Boolean((local && local.isConfigured()) || (cloud && cloud.isConfigured())),
    async generate(prompt: string): Promise<string | null> {
      if (local && local.isConfigured()) {
        try {
          const text = await local.generate(prompt);
          if (text && text.trim().length > 0) return text;
        } catch {
          // fall through to cloud
        }
      }
      if (cloud && cloud.isConfigured()) {
        return cloud.generate(prompt);
      }
      return null;
    },
  };
}

export interface BatchGenerationOptions {
  provider: "openrouter" | "mock" | "disabled";
  localModel?: string;
  cloud: {
    apiKey: string;
    model: string;
    baseUrl?: string;
    siteUrl?: string;
    siteName?: string;
  };
}

/**
 * Batch card generation honors `LLM_PROVIDER`. `mock` and `disabled` never
 * call Ollama or OpenRouter.
 */
export function createBatchGenerationClient(options: BatchGenerationOptions): GenerationClient {
  if (options.provider !== "openrouter") {
    const mock = options.provider === "mock";
    return {
      isConfigured: () => mock,
      async generate(): Promise<string | null> {
        console.warn(`[llm] generation skipped: LLM_PROVIDER=${options.provider}`);
        return mock ? "[mock] outbound LLM disabled" : null;
      },
    };
  }
  return createGenerationClient({
    local: createOllamaGenerationClient({ model: options.localModel }),
    cloud: createOpenRouterClient({
      apiKey: options.cloud.apiKey,
      model: options.cloud.model,
      baseUrl: options.cloud.baseUrl,
      siteUrl: options.cloud.siteUrl,
      siteName: options.cloud.siteName,
    }),
  });
}

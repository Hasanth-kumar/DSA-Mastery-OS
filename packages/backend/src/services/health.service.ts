import type { AppConfig, HealthResponse, ServiceHealth } from "@dsa/shared";
import type { AppContext } from "../context.js";

const DEEP_HEALTH_TTL_MS = 30_000;

let cachedDeepHealth: { response: HealthResponse; expiresAt: number } | null = null;

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - start };
}

function aggregateStatus(services: ServiceHealth[]): HealthResponse["status"] {
  if (services.every((s) => s.status === "ok")) return "ok";
  if (services.some((s) => s.status === "down")) return "degraded";
  return "degraded";
}

/** Process liveness — no external dependency checks. */
export function checkHealthLive(): Pick<HealthResponse, "status" | "timestamp" | "version"> {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  };
}

export async function checkHealthFromContext(
  ctx: AppContext,
  options: { deep?: boolean } = {},
): Promise<HealthResponse> {
  const deep = options.deep === true;
  if (deep) {
    const now = Date.now();
    if (cachedDeepHealth && cachedDeepHealth.expiresAt > now) {
      return cachedDeepHealth.response;
    }
  }

  const response = await buildHealth(ctx, deep);
  if (deep) {
    cachedDeepHealth = {
      response,
      expiresAt: Date.now() + DEEP_HEALTH_TTL_MS,
    };
  }
  return response;
}

/**
 * One builder for both probe depths: shallow reports Notion/LLM from config
 * presence only; deep actually pings them (in parallel).
 */
async function buildHealth(ctx: AppContext, deep: boolean): Promise<HealthResponse> {
  const api: ServiceHealth = { status: "ok" };
  let counts: HealthResponse["counts"];

  let sqlite: ServiceHealth;
  try {
    const mirror = ctx.mirrorCache.getCounts();
    counts = mirror;
    sqlite = {
      status: "ok",
      message: `${mirror.topics} topics, ${mirror.problems} problems, ${mirror.sessions} sessions`,
    };
  } catch (err) {
    sqlite = {
      status: "down",
      message: err instanceof Error ? err.message : "SQLite check failed",
    };
  }

  const [notion, llm] = deep
    ? await Promise.all([checkNotion(ctx), checkLlmHealth(ctx.config)])
    : [
        ctx.notionSync.isConfigured()
          ? { status: "ok" as const, message: "not probed (use /health/ready)" }
          : { status: "down" as const, message: "Not configured" },
        ctx.config.llm.provider !== "openrouter"
          ? {
              status: "ok" as const,
              message: `LLM provider ${ctx.config.llm.provider} (no outbound calls)`,
            }
          : ctx.config.llm.openrouter.apiKey
            ? { status: "ok" as const, message: "not probed (use /health/ready)" }
            : { status: "down" as const, message: "OPENROUTER_API_KEY not set" },
      ];

  const services = { api, sqlite, notion, llm };

  let sync: HealthResponse["sync"];
  try {
    sync = {
      ...ctx.notionSync.getSyncHealth(),
      cards: ctx.cardBankSync.getHealth(),
    };
  } catch {
    sync = undefined;
  }

  return {
    status: aggregateStatus(Object.values(services)),
    timestamp: new Date().toISOString(),
    version: "0.1.0",
    services,
    counts,
    sync,
  };
}

async function checkNotion(ctx: AppContext): Promise<ServiceHealth> {
  if (!ctx.notionSync.isConfigured()) {
    return { status: "down", message: "Not configured" };
  }
  try {
    const { latencyMs } = await timed(() => ctx.notionSync.getClient().ping());
    return { status: "ok", latencyMs };
  } catch (err) {
    return {
      status: "down",
      message: err instanceof Error ? err.message : "Notion unreachable",
    };
  }
}

async function checkLlmHealth(config: AppConfig): Promise<ServiceHealth> {
  if (config.llm.provider !== "openrouter") {
    return {
      status: config.llm.provider === "mock" ? "ok" : "down",
      message: `LLM provider ${config.llm.provider} (no outbound calls)`,
    };
  }
  const apiKey = config.llm.openrouter.apiKey;
  if (!apiKey) {
    return { status: "down", message: "OPENROUTER_API_KEY not set" };
  }
  try {
    const baseUrl = config.llm.openrouter.baseUrl.replace(/\/$/, "");
    const { latencyMs } = await timed(async () => {
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`OpenRouter returned ${res.status}`);
    });
    return {
      status: "ok",
      latencyMs,
      message: `OpenRouter · ${config.llm.model}`,
    };
  } catch (err) {
    return {
      status: "down",
      message: err instanceof Error ? err.message : "OpenRouter unreachable",
    };
  }
}

import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, resetConfigCache } from "./config.js";

describe("loadConfig", () => {
  afterEach(() => {
    resetConfigCache();
  });

  it("routes coach models to the coach OpenRouter key", () => {
    process.env.OPENROUTER_API_KEY = "main-key";
    process.env.OPENROUTER_COACH_API_KEY = "coach-key";
    process.env.OPENROUTER_MODEL = "google/gemma-4-26b-a4b-it:free";
    process.env.COACH_LLM_MODEL = "openai/gpt-oss-120b:free";
    process.env.COACH_LLM_FALLBACK_MODELS =
      "openai/gpt-oss-20b:free,nvidia/nemotron-3-nano-30b-a3b:free,google/gemma-4-26b-a4b-it:free";
    resetConfigCache();

    const routed = loadConfig("/nonexistent/.env");
    expect(routed.llm.openrouter.apiKey).toBe("main-key");
    expect(routed.coachLlm.openrouter.apiKey).toBe("coach-key");

    const byModel = Object.fromEntries(
      routed.coachLlm.models.map((m) => [m.model, m.apiKey]),
    );
    // GPT-OSS → coach key; Gemma → general key; other fallbacks → coach key.
    expect(byModel["openai/gpt-oss-120b:free"]).toBe("coach-key");
    expect(byModel["openai/gpt-oss-20b:free"]).toBe("coach-key");
    expect(byModel["google/gemma-4-26b-a4b-it:free"]).toBe("main-key");
    expect(byModel["nvidia/nemotron-3-nano-30b-a3b:free"]).toBe("coach-key");

    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_COACH_API_KEY;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.COACH_LLM_MODEL;
    delete process.env.COACH_LLM_FALLBACK_MODELS;
    resetConfigCache();
  });

  it("honors COACH_LLM_FALLBACK_MODELS over the auto-fallback", () => {
    process.env.OPENROUTER_API_KEY = "main-key";
    process.env.OPENROUTER_COACH_API_KEY = "coach-key";
    process.env.OPENROUTER_MODEL = "google/gemma-4-26b-a4b-it:free";
    process.env.COACH_LLM_MODEL = "openai/gpt-oss-120b:free";
    process.env.COACH_LLM_FALLBACK_MODELS =
      "openai/gpt-oss-20b:free, google/gemma-4-26b-a4b-it:free";
    resetConfigCache();

    const cfg = loadConfig("/nonexistent/.env");
    expect(cfg.coachLlm.fallbackModels).toEqual([
      "openai/gpt-oss-20b:free",
      "google/gemma-4-26b-a4b-it:free",
    ]);
    // Fallback models are also offered in the picker.
    expect(cfg.coachLlm.models.map((m) => m.model)).toEqual([
      "openai/gpt-oss-120b:free",
      "google/gemma-4-26b-a4b-it:free",
      "openai/gpt-oss-20b:free",
    ]);
    const byModel = Object.fromEntries(
      cfg.coachLlm.models.map((m) => [m.model, m.apiKey]),
    );
    expect(byModel["openai/gpt-oss-120b:free"]).toBe("coach-key");
    expect(byModel["openai/gpt-oss-20b:free"]).toBe("coach-key");
    expect(byModel["google/gemma-4-26b-a4b-it:free"]).toBe("main-key");

    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_COACH_API_KEY;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.COACH_LLM_MODEL;
    delete process.env.COACH_LLM_FALLBACK_MODELS;
    resetConfigCache();
  });

  it("routes isolation env vars and lets DSA_DB_PATH override SQLITE_PATH", () => {
    process.env.DSA_DB_PATH = "./data/dev/dsa.dev.db";
    process.env.SQLITE_PATH = "./data/sqlite/dsa.db";
    process.env.NOTION_WRITE_ENABLED = "false";
    process.env.NOTION_SYNC_ENABLED = "false";
    process.env.WHATSAPP_ENABLED = "false";
    process.env.LLM_PROVIDER = "mock";
    process.env.BACKEND_PORT = "3100";
    process.env.PORT = "3000";
    process.env.FRONTEND_PORT = "5273";
    process.env.REDIS_PREFIX = "overhaul:";
    process.env.OBSIDIAN_VAULT_PATH = "./data/dev/vault";
    resetConfigCache();

    try {
      const cfg = loadConfig("/nonexistent/.env");
      expect(cfg.sqlite.path).toMatch(/data\/dev\/dsa\.dev\.db$/);
      expect(cfg.notion.writeEnabled).toBe(false);
      expect(cfg.notion.syncEnabled).toBe(false);
      expect(cfg.whatsapp.enabled).toBe(false);
      expect(cfg.llm.provider).toBe("mock");
      expect(cfg.port).toBe(3100);
      expect(cfg.frontendPort).toBe(5273);
      expect(cfg.redis.prefix).toBe("overhaul:");
      expect(cfg.obsidian.vaultPath).toMatch(/data\/dev\/vault$/);
    } finally {
      for (const key of [
        "DSA_DB_PATH",
        "SQLITE_PATH",
        "NOTION_WRITE_ENABLED",
        "NOTION_SYNC_ENABLED",
        "WHATSAPP_ENABLED",
        "LLM_PROVIDER",
        "BACKEND_PORT",
        "PORT",
        "FRONTEND_PORT",
        "REDIS_PREFIX",
        "OBSIDIAN_VAULT_PATH",
      ]) {
        delete process.env[key];
      }
      resetConfigCache();
    }
  });

  it("keeps live defaults when isolation flags are unset", () => {
    delete process.env.DSA_DB_PATH;
    delete process.env.NOTION_WRITE_ENABLED;
    delete process.env.NOTION_SYNC_ENABLED;
    delete process.env.WHATSAPP_ENABLED;
    delete process.env.LLM_PROVIDER;
    delete process.env.BACKEND_PORT;
    delete process.env.FRONTEND_PORT;
    process.env.SQLITE_PATH = "./data/sqlite/dsa.db";
    process.env.PORT = "3000";
    resetConfigCache();

    try {
      const cfg = loadConfig("/nonexistent/.env");
      expect(cfg.sqlite.path).toMatch(/data\/sqlite\/dsa\.db$/);
      expect(cfg.notion.writeEnabled).toBe(true);
      expect(cfg.notion.syncEnabled).toBe(true);
      expect(cfg.whatsapp.enabled).toBe(true);
      expect(cfg.llm.provider).toBe("openrouter");
      expect(cfg.port).toBe(3000);
      expect(cfg.frontendPort).toBe(5173);
    } finally {
      delete process.env.SQLITE_PATH;
      delete process.env.PORT;
      resetConfigCache();
    }
  });
});

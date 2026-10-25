import {
  createLLMService,
  type LLMService,
  type LLMServiceConfig,
} from "@dsa/integrations";
import type { AppConfig, CoachModelOption } from "@dsa/shared";

/** Coaching/hint/debrief LLM — honors COACH_LLM_MODEL for a stronger coach model. */
export function toCoachLLMServiceConfig(config: AppConfig): LLMServiceConfig {
  const modelApiKeys = coachModelApiKeys(config);
  return {
    provider: config.llm.provider,
    model: config.coachLlm.model,
    models: [config.coachLlm.model, ...config.coachLlm.fallbackModels],
    modelApiKeys,
    openrouter: {
      apiKey:
        modelApiKeys[config.coachLlm.model] ??
        config.coachLlm.openrouter.apiKey ??
        config.llm.openrouter.apiKey ??
        "",
      baseUrl: config.llm.openrouter.baseUrl,
      siteUrl: config.llm.openrouter.siteUrl,
      siteName: config.llm.openrouter.siteName,
    },
  };
}

export function createCoachLLMService(config: AppConfig): LLMService {
  return createLLMService(toCoachLLMServiceConfig(config));
}

/**
 * Build a coach LLM for a specific user-selected model (from config.coachLlm.models),
 * so the coach chat can switch between models (e.g. GPT-OSS 120B vs Gemma 4) at runtime.
 */
export function toCoachModelServiceConfig(
  config: AppConfig,
  option: CoachModelOption,
): LLMServiceConfig {
  const modelApiKeys = coachModelApiKeys(config);
  return {
    provider: config.llm.provider,
    model: option.model,
    // When the user picks a specific model, still fall back to the configured chain.
    models: [option.model, ...config.coachLlm.fallbackModels.filter((m) => m !== option.model)],
    modelApiKeys,
    openrouter: {
      apiKey:
        option.apiKey ??
        modelApiKeys[option.model] ??
        config.coachLlm.openrouter.apiKey ??
        config.llm.openrouter.apiKey ??
        "",
      baseUrl: config.llm.openrouter.baseUrl,
      siteUrl: config.llm.openrouter.siteUrl,
      siteName: config.llm.openrouter.siteName,
    },
  };
}

export function createCoachModelLLMService(
  config: AppConfig,
  option: CoachModelOption,
): LLMService {
  return createLLMService(toCoachModelServiceConfig(config, option));
}

function coachModelApiKeys(config: AppConfig): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const opt of config.coachLlm.models) {
    if (opt.apiKey) keys[opt.model] = opt.apiKey;
  }
  return keys;
}

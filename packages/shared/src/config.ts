import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";

/** Walk up from cwd to find the pnpm workspace root (repo root). */
export function findRepoRoot(startDir = process.cwd()): string {
  let dir = resolve(startDir);
  const filesystemRoot = resolve("/");
  while (dir !== filesystemRoot) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return resolve(startDir);
}

/** Treat blank env values as unset so defaults still apply. */
function emptyToUndefined(value: unknown): unknown {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const boolFlag = (defaultValue: "true" | "false") =>
  z.preprocess(
    emptyToUndefined,
    z
      .enum(["true", "false"])
      .default(defaultValue)
      .transform((v) => v === "true"),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  /** Preferred backend listen port. Overrides `PORT` when set (overhaul isolation). */
  BACKEND_PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  /** Vite dev-server port. */
  FRONTEND_PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(5173),
  ),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  /** Serve the built frontend (packages/frontend/dist) from the API process.
   *  Unset → defaults on when NODE_ENV=production, off otherwise. */
  SERVE_FRONTEND: z.enum(["true", "false"]).optional(),
  NOTION_TOKEN: z.string().optional(),
  NOTION_TOPICS_DB_ID: z.string().optional(),
  NOTION_PROBLEMS_DB_ID: z.string().optional(),
  NOTION_SESSIONS_DB_ID: z.string().optional(),
  /** Optional Notion card bank database (one row per card — §8). Falls back to local JSON export. */
  NOTION_CARDS_DB_ID: z.string().optional(),
  /**
   * When false, Notion adapter writes (pages, schema, archives) are logged no-ops.
   * Default true so an unset live `.env` keeps syncing.
   */
  NOTION_WRITE_ENABLED: boolFlag("true"),
  /** When false, Notion pull/push/sync does not run (no Notion network). */
  NOTION_SYNC_ENABLED: boolFlag("true"),
  // Overhaul feature flags (plan §1). Off when unset so the live app is unchanged.
  FLAG_TODAY_QUEUE_V2: boolFlag("false"),
  FLAG_UNIFIED_COMPLETION: boolFlag("false"),
  FLAG_HIDE_TOPIC_REVISION: boolFlag("false"),
  FLAG_HELP_LEVEL_CAPTURE: boolFlag("false"),
  FLAG_TAKEAWAY_FIELD: boolFlag("false"),
  FLAG_CURRICULUM_V2: boolFlag("false"),
  FLAG_SPIRAL_PASSES: boolFlag("false"),
  /** Directory for the canonical local card export when Notion cards DB is unset (§10). */
  CARDS_EXPORT_DIR: z.string().default("./data/cards-export"),
  /** Batched card-sync flush interval in ms (§8). 0 disables the timer. */
  CARDS_SYNC_FLUSH_INTERVAL_MS: z.coerce.number().default(300_000),
  /** Model override for the coach (defaults to OPENROUTER_MODEL). */
  COACH_LLM_MODEL: z.string().optional(),
  /** Comma-separated models tried in order after COACH_LLM_MODEL fails. */
  COACH_LLM_FALLBACK_MODELS: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  /** Separate OpenRouter key for coach paths (falls back to OPENROUTER_API_KEY). */
  OPENROUTER_COACH_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("google/gemma-4-31b-it:free"),
  OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
  OPENROUTER_SITE_URL: z.string().default("http://localhost:5173"),
  OPENROUTER_SITE_NAME: z.string().default("DSA Mastery OS"),
  /** `openrouter` calls the network. `mock` and `disabled` never do. */
  LLM_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(["openrouter", "mock", "disabled"]).default("openrouter"),
  ),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default("v21.0"),
  /** Default recipient for scheduled notifications (E.164 without +, e.g. 15551234567) */
  WHATSAPP_DEFAULT_RECIPIENT: z.string().optional(),
  /** Comma-separated wa_ids allowed to use bot commands (empty = allow all) */
  WHATSAPP_ALLOWED_RECIPIENTS: z.string().optional(),
  /** Optional shared secret for POST /api/notifications/weekly-digest */
  WHATSAPP_NOTIFY_SECRET: z.string().optional(),
  /** Meta app secret — enables X-Hub-Signature-256 verification on webhook POSTs */
  WHATSAPP_APP_SECRET: z.string().optional(),
  /** When false, WhatsApp `sendText` is a logged no-op. */
  WHATSAPP_ENABLED: boolFlag("true"),
  SQLITE_PATH: z.string().default("./data/sqlite/dsa.db"),
  /** Overrides `SQLITE_PATH` when set. Worktree uses `./data/dev/dsa.dev.db`. */
  DSA_DB_PATH: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Absolute or repo-relative path to the DSA folder of an Obsidian vault */
  OBSIDIAN_VAULT_PATH: z.string().optional(),
  BACKUP_DIR: z.string().default("./data/backups"),
  BACKUP_KEEP: z.coerce.number().default(14),
  WEIGHT_URGENCY: z.coerce.number().default(0.3),
  WEIGHT_WEAKNESS: z.coerce.number().default(0.25),
  WEIGHT_CONFIDENCE: z.coerce.number().default(0.2),
  WEIGHT_PREREQUISITE: z.coerce.number().default(0.15),
  WEIGHT_RECENCY: z.coerce.number().default(0.1),
  ENABLE_SCHEDULERS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  WEEKLY_DIGEST_CRON: z.string().default("0 20 * * 0"),
  SCHEDULER_TIMEZONE: z.string().default("UTC"),
  /** Problem re-solve capacity (spaced-repetition design §6, §12). Tune after ~2 weeks. */
  RESOLVE_SLOTS_WEEKDAY: z.coerce.number().default(1),
  RESOLVE_SLOTS_WEEKEND: z.coerce.number().default(2),
  /** Admission slow-solve cutoffs in minutes (§4). */
  RESOLVE_SLOW_THRESHOLD_EASY_MIN: z.coerce.number().default(25),
  RESOLVE_SLOW_THRESHOLD_MEDIUM_MIN: z.coerce.number().default(45),
  RESOLVE_SLOW_THRESHOLD_HARD_MIN: z.coerce.number().default(75),
  RESOLVE_RETIRE_CLEAN_STREAK: z.coerce.number().default(3),
  RESOLVE_RETIRE_MIN_STABILITY_DAYS: z.coerce.number().default(90),
  RESOLVE_LEECH_LAPSES: z.coerce.number().default(4),
  RESOLVE_ESCALATE_DAYS: z.coerce.number().default(14),
  LEETCODE_USERNAME: z.string().optional(),
  /** Optional Redis URL. The app has no Redis client today; stored so a later
   *  client cannot silently share a live instance. */
  REDIS_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Key prefix for any future Redis usage. Live default is empty. */
  REDIS_PREFIX: z.string().default(""),
});

/** A coach LLM the user can pick from in the UI. */
export type CoachModelOption = {
  /** Stable id used by the picker and chat requests (e.g. "openrouter:openai/gpt-oss-120b:free"). */
  id: string;
  /** Human-friendly name shown in the picker. */
  label: string;
  /** Provider-specific model identifier sent to the API. */
  model: string;
  /** OpenRouter key for this model (never sent to the frontend). */
  apiKey?: string;
};

export type AppConfig = {
  nodeEnv: string;
  port: number;
  logLevel: string;
  web: {
    /** Whether this process serves the built frontend at "/". */
    serveFrontend: boolean;
    /** Absolute path to packages/frontend/dist. */
    frontendDist: string;
  };
  notion: {
    token?: string;
    topicsDbId?: string;
    problemsDbId?: string;
    sessionsDbId?: string;
    cardsDbId?: string;
    /** False → adapter writes are logged no-ops (`NOTION_WRITE_ENABLED`). */
    writeEnabled: boolean;
    /** False → no Notion pull, push, or sync (`NOTION_SYNC_ENABLED`). */
    syncEnabled: boolean;
  };
  cards: {
    exportDir: string;
    flushIntervalMs: number;
  };
  llm: {
    /** `mock` and `disabled` never open a network connection. */
    provider: "openrouter" | "mock" | "disabled";
    model: string;
    openrouter: {
      apiKey?: string;
      baseUrl: string;
      siteUrl: string;
      siteName: string;
    };
  };
  /** Coaching/hint/debrief LLM — may use a different model than the general LLM. */
  coachLlm: {
    model: string;
    openrouter: {
      apiKey?: string;
    };
    /** Id (within `models`) selected when the user hasn't chosen one. */
    defaultModelId: string;
    /** Models the user can switch between in the coach UI. */
    models: CoachModelOption[];
    /** Fallback models tried in order after `model` fails (COACH_LLM_FALLBACK_MODELS). */
    fallbackModels: string[];
  };
  whatsapp: {
    /** False → sends are logged no-ops (`WHATSAPP_ENABLED`). */
    enabled: boolean;
    phoneNumberId?: string;
    accessToken?: string;
    verifyToken?: string;
    apiVersion: string;
    defaultRecipient?: string;
    allowedRecipients: string[];
    notifySecret?: string;
    appSecret?: string;
  };
  sqlite: { path: string };
  flags: FeatureFlags;
  /** Vite port. The API process does not listen here. */
  frontendPort: number;
  /** No Redis client is constructed. Present so isolation env is explicit. */
  redis: { url?: string; prefix: string };
  obsidian: { vaultPath?: string };
  backup: { dir: string; keep: number };
  intelligenceWeights: {
    urgency: number;
    weakness: number;
    confidence: number;
    prerequisite: number;
    recency: number;
  };
  schedulers: {
    enabled: boolean;
    weeklyDigestCron: string;
    timezone: string;
  };
  leetcode: { username?: string };
  /** Problem re-solve scheduling (spaced-repetition design §6, §12). `engine`
   *  is shape-compatible with @dsa/intelligence ProblemReviewConfig. */
  resolve: {
    slotsWeekday: number;
    slotsWeekend: number;
    engine: {
      slowThresholdMin: { Easy: number; Medium: number; Hard: number };
      retireCleanStreak: number;
      retireMinStabilityDays: number;
      leechLapses: number;
      escalateDays: number;
    };
  };
};

/**
 * Overhaul feature flags, read from `.env` as `FLAG_<NAME>=true|false`.
 * Unset means off, so merging the overhaul leaves the live app unchanged.
 */
export interface FeatureFlags {
  todayQueueV2: boolean;
  unifiedCompletion: boolean;
  /** Topic SM-2 is retired: decisions use problem-FSRS signals (P4.1), and the UI hides it (P4.3). */
  hideTopicRevision: boolean;
  helpLevelCapture: boolean;
  takeawayField: boolean;
  curriculumV2: boolean;
  spiralPasses: boolean;
}

export const FEATURE_FLAGS_OFF: FeatureFlags = {
  todayQueueV2: false,
  unifiedCompletion: false,
  hideTopicRevision: false,
  helpLevelCapture: false,
  takeawayField: false,
  curriculumV2: false,
  spiralPasses: false,
};

let cached: AppConfig | null = null;

export function loadConfig(envPath?: string): AppConfig {
  if (cached) return cached;

  const repoRoot = findRepoRoot();
  const dotenvPath = envPath ?? resolve(repoRoot, ".env");
  loadDotenv({ path: dotenvPath });
  const env = envSchema.parse(process.env);

  const dbPathRaw = env.DSA_DB_PATH ?? env.SQLITE_PATH;
  const sqlitePath = isAbsolute(dbPathRaw) ? dbPathRaw : resolve(repoRoot, dbPathRaw);
  const backendPort = env.BACKEND_PORT ?? env.PORT;

  const frontendDist = resolve(repoRoot, "packages/frontend/dist");
  const serveFrontend =
    env.SERVE_FRONTEND !== undefined
      ? env.SERVE_FRONTEND === "true"
      : env.NODE_ENV === "production";

  cached = {
    nodeEnv: env.NODE_ENV,
    port: backendPort,
    logLevel: env.LOG_LEVEL,
    web: { serveFrontend, frontendDist },
    notion: {
      token: env.NOTION_TOKEN,
      topicsDbId: env.NOTION_TOPICS_DB_ID,
      problemsDbId: env.NOTION_PROBLEMS_DB_ID,
      sessionsDbId: env.NOTION_SESSIONS_DB_ID,
      cardsDbId: env.NOTION_CARDS_DB_ID,
      writeEnabled: env.NOTION_WRITE_ENABLED,
      syncEnabled: env.NOTION_SYNC_ENABLED,
    },
    cards: {
      exportDir: isAbsolute(env.CARDS_EXPORT_DIR)
        ? env.CARDS_EXPORT_DIR
        : resolve(repoRoot, env.CARDS_EXPORT_DIR),
      flushIntervalMs: env.CARDS_SYNC_FLUSH_INTERVAL_MS,
    },
    llm: {
      provider: env.LLM_PROVIDER,
      model: env.OPENROUTER_MODEL,
      openrouter: {
        apiKey: env.OPENROUTER_API_KEY,
        baseUrl: env.OPENROUTER_BASE_URL,
        siteUrl: env.OPENROUTER_SITE_URL,
        siteName: env.OPENROUTER_SITE_NAME,
      },
    },
    coachLlm: resolveCoachLlm(env),
    whatsapp: {
      enabled: env.WHATSAPP_ENABLED,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      verifyToken: env.WHATSAPP_VERIFY_TOKEN,
      apiVersion: env.WHATSAPP_API_VERSION,
      defaultRecipient: env.WHATSAPP_DEFAULT_RECIPIENT,
      allowedRecipients: env.WHATSAPP_ALLOWED_RECIPIENTS
        ? env.WHATSAPP_ALLOWED_RECIPIENTS.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      notifySecret: env.WHATSAPP_NOTIFY_SECRET,
      appSecret: env.WHATSAPP_APP_SECRET,
    },
    sqlite: { path: sqlitePath },
    flags: {
      todayQueueV2: env.FLAG_TODAY_QUEUE_V2,
      unifiedCompletion: env.FLAG_UNIFIED_COMPLETION,
      hideTopicRevision: env.FLAG_HIDE_TOPIC_REVISION,
      helpLevelCapture: env.FLAG_HELP_LEVEL_CAPTURE,
      takeawayField: env.FLAG_TAKEAWAY_FIELD,
      curriculumV2: env.FLAG_CURRICULUM_V2,
      spiralPasses: env.FLAG_SPIRAL_PASSES,
    },
    frontendPort: env.FRONTEND_PORT,
    redis: {
      url: env.REDIS_URL,
      prefix: env.REDIS_PREFIX,
    },
    obsidian: {
      vaultPath: env.OBSIDIAN_VAULT_PATH
        ? isAbsolute(env.OBSIDIAN_VAULT_PATH)
          ? env.OBSIDIAN_VAULT_PATH
          : resolve(repoRoot, env.OBSIDIAN_VAULT_PATH)
        : undefined,
    },
    backup: {
      dir: isAbsolute(env.BACKUP_DIR)
        ? env.BACKUP_DIR
        : resolve(repoRoot, env.BACKUP_DIR),
      keep: env.BACKUP_KEEP,
    },
    intelligenceWeights: {
      urgency: env.WEIGHT_URGENCY,
      weakness: env.WEIGHT_WEAKNESS,
      confidence: env.WEIGHT_CONFIDENCE,
      prerequisite: env.WEIGHT_PREREQUISITE,
      recency: env.WEIGHT_RECENCY,
    },
    schedulers: {
      enabled: env.ENABLE_SCHEDULERS,
      weeklyDigestCron: env.WEEKLY_DIGEST_CRON,
      timezone: env.SCHEDULER_TIMEZONE,
    },
    leetcode: { username: env.LEETCODE_USERNAME },
    resolve: {
      slotsWeekday: env.RESOLVE_SLOTS_WEEKDAY,
      slotsWeekend: env.RESOLVE_SLOTS_WEEKEND,
      engine: {
        slowThresholdMin: {
          Easy: env.RESOLVE_SLOW_THRESHOLD_EASY_MIN,
          Medium: env.RESOLVE_SLOW_THRESHOLD_MEDIUM_MIN,
          Hard: env.RESOLVE_SLOW_THRESHOLD_HARD_MIN,
        },
        retireCleanStreak: env.RESOLVE_RETIRE_CLEAN_STREAK,
        retireMinStabilityDays: env.RESOLVE_RETIRE_MIN_STABILITY_DAYS,
        leechLapses: env.RESOLVE_LEECH_LAPSES,
        escalateDays: env.RESOLVE_ESCALATE_DAYS,
      },
    },
  };

  return cached;
}

type ParsedEnv = z.infer<typeof envSchema>;

function coachOpenRouterKey(env: ParsedEnv): string | undefined {
  return env.OPENROUTER_COACH_API_KEY ?? env.OPENROUTER_API_KEY;
}

/**
 * Split rate-limit pools across the two OpenRouter keys:
 * - Gemma / general `OPENROUTER_MODEL` → OPENROUTER_API_KEY
 * - GPT-OSS / other coach models → OPENROUTER_COACH_API_KEY (falls back to general)
 */
function apiKeyForCoachModel(env: ParsedEnv, model: string): string | undefined {
  if (model === env.OPENROUTER_MODEL || model.startsWith("google/")) {
    return env.OPENROUTER_API_KEY ?? coachOpenRouterKey(env);
  }
  return coachOpenRouterKey(env);
}

/**
 * The coach can use a stronger model than the general LLM via COACH_LLM_MODEL.
 * Fallback chain: COACH_LLM_FALLBACK_MODELS, or OPENROUTER_MODEL when it differs.
 */
function resolveCoachLlm(env: ParsedEnv): AppConfig["coachLlm"] {
  const model = env.COACH_LLM_MODEL ?? env.OPENROUTER_MODEL;
  const apiKey = apiKeyForCoachModel(env, model);
  const models = buildCoachModels(env, { model, apiKey });
  const fallbackModels = resolveCoachFallbackModels(env, model);

  return {
    model,
    openrouter: { apiKey },
    defaultModelId: coachModelId(model),
    models,
    fallbackModels,
  };
}

function resolveCoachFallbackModels(env: ParsedEnv, primary: string): string[] {
  if (env.COACH_LLM_FALLBACK_MODELS) {
    return env.COACH_LLM_FALLBACK_MODELS.split(",")
      .map((s) => s.trim())
      .filter((m) => m.length > 0 && m !== primary);
  }
  // Auto-fallback to the general model when it differs from the coach primary.
  if (env.OPENROUTER_MODEL && env.OPENROUTER_MODEL !== primary) {
    return [env.OPENROUTER_MODEL];
  }
  return [];
}

function coachModelId(model: string): string {
  return `openrouter:${model}`;
}

/** "openai/gpt-oss-120b:free" → "Gpt Oss 120b". */
function prettyModelLabel(model: string): string {
  const base = (model.split("/").pop() ?? model).split(":")[0] ?? model;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Models offered in the coach picker: the configured coach model (default,
 * listed first) and the general model (e.g. Gemma 4). Entries without an
 * OpenRouter key are dropped; duplicates are de-duplicated.
 * GPT-OSS uses the coach key; Gemma / OPENROUTER_MODEL uses the general key.
 */
function buildCoachModels(
  env: ParsedEnv,
  coach: { model: string; apiKey?: string },
): CoachModelOption[] {
  const models: CoachModelOption[] = [];

  const add = (opt: { model: string; apiKey?: string }) => {
    if (!opt.apiKey) return;
    const id = coachModelId(opt.model);
    if (models.some((m) => m.id === id)) return;
    models.push({ id, label: prettyModelLabel(opt.model), ...opt });
  };

  add(coach);
  if (env.OPENROUTER_MODEL !== coach.model) {
    add({
      model: env.OPENROUTER_MODEL,
      apiKey: apiKeyForCoachModel(env, env.OPENROUTER_MODEL),
    });
  }
  // Surface fallback-chain models in the picker so a working option is selectable
  // when the primary free models are rate-limited upstream.
  for (const model of resolveCoachFallbackModels(env, coach.model)) {
    add({ model, apiKey: apiKeyForCoachModel(env, model) });
  }

  return models;
}

export function resetConfigCache(): void {
  cached = null;
}

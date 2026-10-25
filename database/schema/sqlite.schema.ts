import { sqliteTable, text, integer, real, blob } from "drizzle-orm/sqlite-core";

export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  difficulty: text("difficulty"),
  status: text("status").default("Not started"),
  revisionCount: integer("revision_count").default(0),
  lastRevised: integer("last_revised"),
  confidence: integer("confidence").default(0),
  isWeakArea: integer("is_weak_area").default(0),
  priorityScore: real("priority_score"),
  nextRevisionAt: integer("next_revision_at"),
  sm2Interval: integer("sm2_interval").default(1),
  sm2Repetition: integer("sm2_repetition").default(0),
  sm2Efactor: real("sm2_efactor").default(2.5),
  prerequisites: text("prerequisites"),
  updatedAt: integer("updated_at").notNull(),
});

export const problems = sqliteTable("problems", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  topicId: text("topic_id").references(() => topics.id),
  difficulty: text("difficulty"),
  leetcodeLink: text("leetcode_link"),
  githubUrl: text("github_url"),
  status: text("status").default("Not started"),
  attempts: integer("attempts").default(0),
  timeTaken: integer("time_taken"),
  notes: text("notes"),
  updatedAt: integer("updated_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  date: integer("date").notNull(),
  topicId: text("topic_id").references(() => topics.id),
  problemsSolved: integer("problems_solved").default(0),
  studyDuration: integer("study_duration"),
  productivityScore: integer("productivity_score"),
  updatedAt: integer("updated_at").notNull(),
});

export const syncMeta = sqliteTable("sync_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * Per-problem attempt log — survives Notion pulls (which wipe/rebuild
 * topics/problems/sessions). Holds local-only signals like mistake tags.
 * Topic pulls use merge (not wipe) for schedule-critical fields — see sync.ts.
 */
export const problemAttempts = sqliteTable("problem_attempts", {
  id: text("id").primaryKey(),
  problemId: text("problem_id").notNull(),
  topicId: text("topic_id"),
  sessionId: text("session_id"),
  solvedAt: integer("solved_at").notNull(),
  timeTaken: integer("time_taken"),
  /** JSON array of mistake tags (legacy rows may hold a single bare tag string). */
  mistakeTag: text("mistake_tag"),
  /** Solved with coach help (D) — weaker mastery signal than a cold solve. */
  usedCoach: integer("used_coach").default(0),
  /** Coach interactions (hints + chat messages) recorded for this problem. */
  hintCount: integer("hint_count").default(0),
  /** 'solve' | 'resolve' — a re-solve is recorded as a normal attempt row. */
  kind: text("kind").notNull().default("solve"),
  /** P6.1: 'none' | 'hint' | 'approach' | 'solution'. NULL on rows from before 0017. */
  helpLevel: text("help_level"),
  /** P6.1: 'coach' | 'external-ai' | 'other'. */
  helpSource: text("help_source"),
  /** P6.1: topic id named on a hidden-pattern row, or 'unsure'. */
  patternGuess: text("pattern_guess"),
  /** P6.2: one-line takeaway. */
  takeaway: text("takeaway"),
  createdAt: integer("created_at").notNull(),
});

/**
 * Per-problem re-solve pool (problem spaced-repetition design §7). One row per
 * admitted problem; FSRS runtime state mirrors `cards`. LOCAL-ONLY — never
 * synced, never wiped by Notion pulls (same class as problem_attempts /
 * card_embeddings). Scheduling is per-problem FSRS, NOT the topic-level SM-2.
 */
export const problemReviews = sqliteTable("problem_reviews", {
  problemId: text("problem_id")
    .primaryKey()
    .references(() => problems.id),
  admittedAt: integer("admitted_at").notNull(),
  /** 'mistake' | 'coach' | 'slow' | 'hard' | 'manual' */
  admissionReason: text("admission_reason").notNull(),
  retired: integer("retired").notNull().default(0),
  /** Leech suspension — resurfaces after the topic's next revision session. */
  suspended: integer("suspended").notNull().default(0),
  // Per-problem FSRS state (ts-fsrs Card shape, same columns as `cards`).
  stability: real("stability"),
  difficulty: real("difficulty"),
  due: integer("due"),
  lastReview: integer("last_review"),
  reps: integer("reps").notNull().default(0),
  lapses: integer("lapses").notNull().default(0),
  /** FSRS state enum: 0=New, 1=Learning, 2=Review, 3=Relearning. */
  state: integer("state").notNull().default(0),
  elapsedDays: integer("elapsed_days").notNull().default(0),
  scheduledDays: integer("scheduled_days").notNull().default(0),
  learningSteps: integer("learning_steps").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Obsidian note metadata + cached content; the vault is the source of truth. */
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  path: text("path").notNull().unique(),
  title: text("title").notNull(),
  problemId: text("problem_id"),
  topicId: text("topic_id"),
  frontmatter: text("frontmatter"),
  content: text("content"),
  contentHash: text("content_hash"),
  matchedBy: text("matched_by"),
  updatedAt: integer("updated_at").notNull(),
});

/** Both versions of a record edited locally and in Notion between syncs. */
export const syncConflicts = sqliteTable("sync_conflicts", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  entityName: text("entity_name"),
  localValue: text("local_value").notNull(),
  remoteValue: text("remote_value").notNull(),
  detectedAt: integer("detected_at").notNull(),
  resolvedAt: integer("resolved_at"),
  winner: text("winner"),
});

export const chatThreads = sqliteTable("chat_threads", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => chatThreads.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
});

/**
 * Flashcards (Rev 2). One row per card. Content fields (type/front/back, plus
 * concept tags via `card_concepts`) are Notion-authoritative; the FSRS runtime
 * state is local-authoritative and pushed to Notion as a write-only mirror
 * (design §8). Per-card FSRS (§7) — NOT the legacy topic-level SM-2 on `topics`.
 * Primary key is an app-generated UUID; `notion_page_id` is only a mapping.
 */
export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  topicId: text("topic_id").references(() => topics.id),
  /** plain-recall | pattern-trigger | cloze | predict-complexity | predict-output | mistake-derived | confusion-pair */
  type: text("type").notNull(),
  front: text("front").notNull(),
  back: text("back").notNull(),
  noteRef: text("note_ref"),
  suspended: integer("suspended").notNull().default(0),
  leech: integer("leech").notNull().default(0),
  // Per-card FSRS state (ts-fsrs Card shape).
  stability: real("stability"),
  difficulty: real("difficulty"),
  due: integer("due"),
  lastReview: integer("last_review"),
  reps: integer("reps").notNull().default(0),
  lapses: integer("lapses").notNull().default(0),
  /** FSRS state enum: 0=New, 1=Learning, 2=Review, 3=Relearning. */
  state: integer("state").notNull().default(0),
  elapsedDays: integer("elapsed_days").notNull().default(0),
  scheduledDays: integer("scheduled_days").notNull().default(0),
  learningSteps: integer("learning_steps").notNull().default(0),
  // Provenance (§8). generation_confidence / quality_score deliberately absent.
  origin: text("origin").notNull().default("manual"),
  sourceHash: text("source_hash"),
  modelVersion: text("model_version"),
  promptVersion: text("prompt_version"),
  noteVersion: text("note_version"),
  seedVersion: integer("seed_version"),
  // Sync + generation-trigger bookkeeping.
  notionPageId: text("notion_page_id"),
  dirty: integer("dirty").notNull().default(1),
  syncedAt: integer("synced_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Normalized concept tagging (§4). The closed vocabulary lives in
 * version-controlled concepts.yaml per topic; this junction only references
 * existing concept ids. Coverage = distinct concept_id with >=1 card.
 */
export const cardConcepts = sqliteTable("card_concepts", {
  cardId: text("card_id")
    .notNull()
    .references(() => cards.id),
  conceptId: text("concept_id").notNull(),
});

/**
 * Append-only event log alongside the mutable card rows (§9). NOT event
 * sourcing — state is never rebuilt by replay. Types: CardReviewed,
 * CardGenerated, CardEdited, CardSuspended, CardDeleted, CardMerged,
 * LeechDetected.
 */
export const cardEvents = sqliteTable("card_events", {
  id: text("id").primaryKey(),
  cardId: text("card_id").notNull(),
  type: text("type").notNull(),
  /** JSON payload: rating, response_ms, prev/next FSRS state, etc. */
  payload: text("payload"),
  createdAt: integer("created_at").notNull(),
});

/**
 * Local embedding store for semantic dedup (§6). Vectors live as a raw
 * little-endian Float32 BLOB — no separate vector DB. This is a SEPARATE table
 * from `cards` so the §8 Notion sync layer (which reads `cards` only) can never
 * sync vectors: embeddings are strictly local (§6).
 */
export const cardEmbeddings = sqliteTable("card_embeddings", {
  cardId: text("card_id")
    .primaryKey()
    .references(() => cards.id),
  /** Embedding model id (e.g. 'nomic-embed-text', 'Xenova/all-MiniLM-L6-v2'). */
  model: text("model").notNull(),
  /** Vector dimension (nomic-embed-text=768, all-MiniLM-L6-v2=384). */
  dim: integer("dim").notNull(),
  /** Raw little-endian Float32 vector (dim * 4 bytes). */
  vector: blob("vector").notNull(),
  /** cards.source_hash at embed time — detects stale vectors after an edit. */
  sourceHash: text("source_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Batch-generation dirty queue (§5). A note change marks its topic dirty here;
 * a debounced batch job drains the dirty set and runs the generation pipeline
 * once. This is the trigger — generation never runs inline on the edit. Coarse
 * per-topic granularity (single user); distinct from the per-card `cards.dirty`
 * Notion-sync delta flag.
 */
export const topicGeneration = sqliteTable("topic_generation", {
  topicId: text("topic_id")
    .primaryKey()
    .references(() => topics.id),
  dirty: integer("dirty").notNull().default(0),
  dirtySince: integer("dirty_since"),
  noteHash: text("note_hash"),
  lastGeneratedAt: integer("last_generated_at"),
  lastGeneratedHash: text("last_generated_hash"),
});

/** Closed card-type vocabulary (§3). Generation may use these types only. */
export const CARD_TYPES = [
  "plain-recall",
  "pattern-trigger",
  "cloze",
  "predict-complexity",
  "predict-output",
  "mistake-derived",
  "confusion-pair",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** Card origin — how the card entered the bank (provenance, §8). */
export const CARD_ORIGINS = ["seed", "generated", "manual"] as const;
export type CardOrigin = (typeof CARD_ORIGINS)[number];

/** Append-only event-log types (§9). */
export const CARD_EVENT_TYPES = [
  "CardReviewed",
  "CardGenerated",
  "CardEdited",
  "CardSuspended",
  "CardDeleted",
  "CardMerged",
  "LeechDetected",
] as const;
export type CardEventType = (typeof CARD_EVENT_TYPES)[number];

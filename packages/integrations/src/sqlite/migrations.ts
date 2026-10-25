/**
 * Ordered list of SQLite migration files applied by {@link runMigrations}.
 * Kept in its own module (free of the better-sqlite3 native binding) so the
 * list can be imported by tooling and tests without loading the driver.
 */
export const MIGRATIONS = [
  "0001_initial.sql",
  "0002_sync_meta.sql",
  "0003_github_solutions.sql",
  "0004_chat.sql",
  "0005_performance_indexes.sql",
  "0006_query_indexes.sql",
  "0007_attempts_notes_conflicts.sql",
  "0008_problem_status_notion.sql",
  "0009_sm2_state.sql",
  "0010_drop_mistake_note.sql",
  "0011_flashcards.sql",
  "0012_card_embeddings.sql",
  "0013_generation_queue.sql",
  "0014_cards_front_index.sql",
  "0015_coach_usage.sql",
  "0016_problem_reviews.sql",
  "0017_attempt_signals.sql",
] as const;

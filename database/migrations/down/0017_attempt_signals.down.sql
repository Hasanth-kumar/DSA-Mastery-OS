-- Reverses 0017_attempt_signals.sql (SQLite 3.35+). Drops only the four P6
-- columns; used_coach, mistake_tag and every other column are untouched.
-- Take a snapshot first (pnpm dev:snapshot) and remove
-- 0017_attempt_signals.sql from MIGRATIONS, or the next start re-adds them.
ALTER TABLE problem_attempts DROP COLUMN takeaway;
ALTER TABLE problem_attempts DROP COLUMN pattern_guess;
ALTER TABLE problem_attempts DROP COLUMN help_source;
ALTER TABLE problem_attempts DROP COLUMN help_level;

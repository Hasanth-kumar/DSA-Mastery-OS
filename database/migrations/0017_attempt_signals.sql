-- P6.1 / P6.2: richer post-solve signals on each attempt. All nullable and
-- local-only (problem_attempts is never synced). Legacy rows stay NULL.
--   help_level    'none' | 'hint' | 'approach' | 'solution'  (used_coach = help_level <> 'none')
--   help_source   'coach' | 'external-ai' | 'other'
--   pattern_guess topic id the learner named on a hidden-pattern row, or 'unsure'
--   takeaway      one line: what tripped you up / the invariant
-- Reverse with database/migrations/down/0017_attempt_signals.down.sql.
ALTER TABLE problem_attempts ADD COLUMN help_level TEXT;
ALTER TABLE problem_attempts ADD COLUMN help_source TEXT;
ALTER TABLE problem_attempts ADD COLUMN pattern_guess TEXT;
ALTER TABLE problem_attempts ADD COLUMN takeaway TEXT;

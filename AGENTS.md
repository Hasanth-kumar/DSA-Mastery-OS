# AGENTS.md

Instructions for any AI coding agent working in this repository (Claude Code, Codex, Cursor, Gemini CLI, and others).

## Read before doing anything

1. **`CLAUDE.md`**: commands, workspace layout, architecture, gotchas. It applies to every agent, not only Claude.
2. **`docs/design-taste-and-preferences.md`**: **binding.** The product's visual style ("Atelier Editorial"), UX and pedagogical guardrails, and architectural house style. Read it in full at the start of every session. Re-read §2–3 before any frontend change and §4 before any engine or service change. When a request conflicts with it, follow the design doc and say so.
3. **`docs/teaching-strategy.md`**: the learning model the features exist to serve.

## If you are working on the system overhaul

Follow `docs/plans/system-overhaul-plan.md`, starting with its §2 "Daily agent protocol". Work only in the overhaul worktree on the `overhaul` branch. Never modify `main`, the live SQLite database, Notion, WhatsApp, or the real Obsidian vault.

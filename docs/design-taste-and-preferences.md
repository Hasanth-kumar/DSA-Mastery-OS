# DSA Mastery OS — Design Taste, UX & Architectural Preferences (AI Reference)

> **Scope:** Extracted strictly from committed work on `main` (`HEAD` @ `f60c5dc`).
> **Purpose:** Canonical aesthetic, interaction, pedagogical, and engineering taste guide for AI assistants building or refining features in this repository.

---

## 1. Core Product Identity & Meta-Philosophy

1. **One Learner, One Workspace, One Machine:**
   - This is a personal mastery instrument, **not** a multi-tenant SaaS. Never introduce user accounts, auth flows, role abstractions, generic onboarding wizards, or marketing chrome.
2. **Protect Problem-Solving Time Above All Else:**
   - The learner is a full-time engineer working in **60–90 minute daily blocks**. Solving problems and retaining patterns is the goal; everything else (warm-up, logging, flashcards, analytics) must stay fast, tap-driven, and out of the way.
3. **Pull Features by Real Pain (`docs/teaching-strategy.md` §11):**
   - A solo-built system's biggest risk is building instead of studying. A feature earns its place only if it **(a)** reuses existing plumbing, **(b)** takes under ~1 hour, and **(c)** solves friction felt at least ~3 times in real sessions. Speculative ideas go to the wishlist, not into code.
4. **Zero LLM / Zero Network on the Hot Path:**
   - Warm-up (`WarmupCard`), flashcard review (`ReviewPage`), and problem re-solve (`ResolvePage` / `ResolveTodaySection`) read and write **locally against SQLite in milliseconds**. LLMs are reserved strictly for opt-in coaching (`CoachingPage`) and background/batch card generation.

---

## 2. Visual Aesthetic: "Atelier Editorial"

The UI rejects generic SaaS dashboard tropes (cold `#000`/`#fff` contrast, heavy drop-shadow card grids, neon status pills, thick progress bars) in favor of an **Atelier Editorial** aesthetic—warm paper/ink surfaces, high-contrast literary serif display typography, hairline rules, dotted tabular leaders, and quiet monospace metadata.

### 2.1 Color & Surface Palette (`global.css` + `useAppPreferences.ts`)

 Surfaces are warm and organic in both themes—never pure black or stark white:

| Token | Dark Mode ("Deep Warm-Black") | Light Mode ("Cream Paper") | Usage |
|---|---|---|---|
| `--bg` | `#0f0e0c` | `#f4f1e9` | Main viewport canvas |
| `--bg-elevated` | `#141210` | `#efeadd` | Modals, review cards, coach composer, inputs |
| `--bg-card` | `#1a1815` | `#e7e1d2` | Secondary stat cards, hover states, code blocks |
| `--bg-surface` | `#221f1a` | `#ddd6c4` | Subtle fills, inline code, inactive tracks |
| `--text` | `#f5f2ea` | `#221e15` | Primary ink (warm cream / deep espresso) |
| `--text-muted` | `#9b968b` | `#6d6759` | Secondary prose, descriptions, inactive labels |
| `--text-subtle` | `#67635a` | `#9a927d` | Eyebrow kickers, timestamps, keyboard hints |
| `--border` | `rgba(245,242,234,0.10)` | `rgba(34,30,21,0.16)` | Hairline structural dividers |
| `--border-soft` | `rgba(245,242,234,0.06)` | `rgba(34,30,21,0.09)` | Row separators, subtle outlines |
| `--ghost` | `rgba(245,242,234,0.04)` | `rgba(34,30,21,0.05)` | Oversized background watermarks (`01`, `02`) |

* **Curated Accent Presets (`ACCENT_PRESETS`):**
  * **Coral (Default):** `#cc785c` (Light mode ink: `#a8502e`)
  * **Amber:** `#c98a4b` (Light mode ink: `#a06d2a`)
  * **Sage:** `#7c9885` (Light mode ink: `#3e7d54`)
  * **Slate:** `#6f8fb0` (Light mode ink: `#3465c0`)
  * Separate `--accent` (fills/glows) from `--accent-ink` (text/hairlines, darkened in light mode for legibility).
* **Semantic Status Tokens:** Muted, earthy tones—never saturated neon (`--success: #7fbb8f` / `#3e7d54`, `--warning: #e0a75e` / `#a06d2a`, `--danger: #d96c5a` / `#a83e2e`, `--info: #5db8a6` / `#5e83a8`).
* **Ambient Accent Glow (`.main-accent-glow`):** A toggleable, non-interactive `560×560px` radial gradient (`radial-gradient(circle, var(--accent-soft), transparent 62%)`) sitting behind the top-right of the canvas.

### 2.2 Typography Triad

Every screen balances three distinct type voices:

1. **Display Serif (`--font-display: "Spectral", Georgia, serif`):**
   - Used for hero topic titles (`74px`, `font-weight: 400`, `letter-spacing: -0.035em`, `line-height: 0.98`), page titles (`44px`, `-0.03em`), mastery ring numbers (`52px`), stat strip values (`30px–34px`), flashcard questions (`25px`, `text-wrap: balance`), problem row titles (`18px`, `font-weight: 500`), and `6.25rem` (`100px`) `.problem-row-index` ghost numerals (`01`, `02`, `03`).
   - **Rule:** Display headings use regular weight (`400` or `500`), never heavy bold (`700`). Let scale and negative tracking create hierarchy.
2. **UI Sans (`--font-sans: "Hanken Grotesk", system-ui, sans-serif`):**
   - Used for body copy, reasoning blurbs (`max-width: 46–50ch`, `text-wrap: pretty`), buttons, settings labels, and D3 node labels.
3. **Technical Monospace (`--font-mono: "JetBrains Mono", ui-monospace, monospace`):**
   - Used for uppercase section eyebrows (`10px–10.5px`, `letter-spacing: 0.18em–0.22em`), timestamps, live timers (`64px` on Session page), difficulty badges (`EAS`, `MED`, `HAR`), numeric table columns, and code snippets.

### 2.3 Layout, Borders & Component Geometry

* **Canvas-First Over Boxed Cards:**
  * On primary editorial views (`TodayPage`, `OverviewPage`, `ActivityPage`), content sits directly on the `--bg` canvas, divided by full-bleed `1px solid var(--border)` grid hairlines (`.stats-strip`, `.today-grid`, `.overview-grid-2`) rather than wrapping every widget in a rounded card box.
  * Elevated cards (`.review-card-v2`, `.session-hero`, `.panel-v2` for inline flows like `MistakeCapture`) are reserved for focused interactive stages (`border-radius: 18px–22px`, `1px solid var(--border-soft)`).
* **Editorial Problem Rows (`.problem-row-v2`):**
  * Each row features a giant `--ghost` serif index (`01`) tucked behind the left margin (`padding-left: 80px`), the problem title in `Spectral` (`18px`), a **1px dotted horizontal leader** (`.problem-row-fill`) stretching to the 3-letter monospace difficulty badge, and compact pill actions below.
* **Razor-Thin Hairline Progress & Data Bars:**
  * Progress and distribution tracks (`.revision-bar`, `.diff-bar-track`, `.weak-bar-track`, `.leetcode-v2-track`, `.review-progress-bar`) are **2px high with `border-radius: 0`**, reading like ruled ink lines rather than chunky progress bars.
  * Velocity bars (`.velocity-bar`) use `color-mix(in oklab, var(--accent) ..., var(--bg-surface))` so historical weeks recede quietly while the current week (`.velocity-bar--current`) blooms with full accent color and a soft ring shadow.
* **Pill Buttons with High-Contrast Primary Fill:**
  * Primary CTAs (`.btn-primary-v2`) use `border-radius: 999px`, warm cream fill (`--btn: #f5f2ea`) with dark text (`--btn-text: #0f0e0c`), transitioning to `--accent` with a soft bloom (`0 6px 28px var(--accent-soft)`) on hover.
  * Completion buttons (`.btn-done-v2`) use a `1px solid var(--accent-ink)` outline in `--accent-ink` text, filling with `--accent` on hover.

### 2.4 Signature Navigation & Motion Choreography

* **Bowed-Arc Fan Sidebar (`.fan-nav` on Desktop `≥961px`):**
  * No permanent left rail steals horizontal viewport width (`grid-template-columns: 1fr`).
  * **At rest:** Navigation collapses into a tight vertical/bowed cluster of tiny `scale(0.185)` dots hugging the left edge (`10px` from left). Active and badged tabs glow in `--accent` / `--accent-ink`.
  * **On hover or `:focus-visible`:** A `320px` soft gradient scrim fades in over the left edge, and the `38px` circular icon chips fan out along a shallow cosine arc (`translate(calc(24px + var(--bow) * 44px), calc(var(--row) * 48px - 19px))`) with staggered per-item delays (`--d`, `--d-out`) and spring physics (`cubic-bezier(0.22, 1.15, 0.35, 1)`).
  * **Bottom-Right Utility Cluster (`.corner-utils`):** Shortcuts (`?`) and theme toggle (`t`) live in two quiet `36px` circular buttons pinned to the bottom-right corner on desktop.
  * **Mobile (`≤960px`):** Converts cleanly into a fixed bottom tab bar respecting `env(safe-area-inset-bottom)`.
* **Purposeful Micro-Motion (`prefers-reduced-motion` respected):**
  * Mastery ring SVG stroke draws in on mount (`drawRing 1.1s ease`).
  * Active warm-up and session step dots pulse gently (`pulseDot 1.6s–1.8s`).
  * Flashcards remount on ID change to trigger a subtle vertical lift (`ui-card-advance 0.32s cubic-bezier(0.22, 1, 0.36, 1)`).
  * Code copy buttons pop their checkmark with a spring overshoot (`ui-icon-pop 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)`).

### 2.5 Claude-Style Coaching Surface (`CoachingPage`)

* **Full-Viewport Immersion:** When the Coach tab is active (`.app-shell-v2.coach-active`), main padding drops to `0` and the layout locks to `100dvh` with an internal scrolling thread (`max-width: 48rem`) and a bottom-pinned composer.
* **Asymmetric Conversation Turns:**
  * **User turns:** Right-aligned, capped at `60ch`, inside a warm elevated bubble (`--bg-elevated`, `16px` radius).
  * **Assistant turns:** Left-aligned with a `30px` coral gradient badge (`.coach-msg-avatar`), **no bubble**—rendered as flowing editorial prose (`14.5px`, `line-height: 1.65`, `Spectral` headings, KaTeX math, bordered markdown tables, and dark `#1a1917` code blocks with language headers).
* **Code-Friendly Composer:** Auto-resizing textarea with a floating top-right expand toggle (`.coach-composer-expand-btn`) that switches the input to `--font-mono` for pasting/editing code, model selector in the bottom-left footer, and pill-shaped prompt starters below when empty.

---

## 3. UX & Pedagogical Design Principles

1. **Acquire Directly, Consolidate Through Struggle (`docs/teaching-strategy.md`):**
   - **Teaching Mode** (`directMode: ON`, no problem anchor) teaches unseen patterns directly without cryptic gating.
   - **Coaching Mode** (`directMode: OFF`, anchored to a problem) enforces a learner-driven 4-rung hint ladder (conceptual nudge → pattern name → pseudocode → full solution). Every reply must obey the **Help Budget**: deliver *insight + reasoning + one concrete next step*.
2. **Never Induce Backlog Guilt (Catch-Up Compression):**
   - Both topic revision (`RevisionEngine.compressQueue`) and problem re-solve (`ProblemReviewEngine.selectDueSlots`) bound daily due items to capacity and **silently reschedule overflow forward**. Skipping a few days must never greet the learner with a wall of overdue tasks.
3. **Hybrid Surface Separation (Committed vs. Browsable Pool):**
   - **Today Page:** Shows only today's committed work (top 3 suggested problems for the primary topic, collapsed `▶ Re-solve (N due)` teaser unless a problem is `≥14` days overdue and force-promoted, and max 1–2 due revision topics).
   - **Today with `todayQueueV2` on (agreed with Santosh, 2026-10-24):** the Suggested problems list is the single list of problems on Today. A due re-solve appears as the **first row of that list**, at most 1 per day, marked as a re-solve with a small label in the existing type voices and hairlines (for example `RE-SOLVE · due since Oct 2`), plus its reason and, once P6.2 lands, its last takeaway. No new colors, badges or pills. Below it sit 1–2 new problems for the primary topic, unchanged in look. Every row, re-solve or new, uses the same Start (timer + LeetCode tab) → ✓ Done → `MistakeCapture` flow, with Coach ↗. The separate `ResolveTodaySection`, the topic Revision column, the post-solve revision offer and the `FocusCard` are hidden; the FocusCard's reasoning and week progress move into the hero banner. The full re-solve pool stays on `ResolvePage`.
   - **Block days and mixed days (agreed with Santosh, 2026-10-25; plan §6.4):** while a new pattern's short block is running, the hero shows the pattern name exactly as Today does now. On a mixed day the hero has its own header, `Mixed practice · N problems · ~M min`, and names no pattern. Re-solve and mixed rows never show their pattern before ✓ Done — only the problem, difficulty and a reason that doesn't name the pattern — and the stats strip and banner don't name today's patterns either. Same type voices, hairlines and rows; no new surfaces.
   - **Dedicated Pool Pages (`ReviewPage`, `ResolvePage`):** Hold the full flashcard review queue (hard-capped at 20 cards/day with inline 1-keystroke edit/suspend/delete triage) and the full problem re-solve pool.
4. **Tap-Only Post-Solve Reflection & Inferred Grading:**
   - Completing a problem (`✓ Done`) transitions inline through:
     1. `MistakeCapture`: Multi-select tap buttons (`wrong-approach`, `edge-case`, `off-by-one`, `pattern-recall`), auto-prechecked `Used coach on this problem` (driven by backend hint telemetry), or a single-tap `Smooth ✓` exit. For a row whose pattern was hidden, it first asks "Which pattern did you use?" (one tap, plus "Not sure"), then reveals the real pattern (plan P6.1).
     2. `note-offer`: One-tap Obsidian note template creation or skip.
     3. `revision-offer`: Offered at most **once per calendar day** (`localStorage` date guard) so it never nags after every problem.
   - In `ResolveCompleteForm`, the system **infers the FSRS rating** (`Again` / `Hard` / `Good` / `Easy`) from solve outcome + elapsed time + help usage, while giving the learner a 1-tap override.
5. **Explainable Intelligence ("Why this?"):**
   - Automated choices always expose their reasoning in plain English: the primary topic hero has a toggleable `Why this?` score breakdown (`ScoreBar`), and every pooled re-solve problem states its exact admission trigger (e.g., *"2 mistakes, used coach last time"*).
6. **Keyboard-First Ergonomics (`App.tsx`):**
   - Global single-key bindings when not focused in an input: `s` (start session on Today), `l` (focus Done button), `c` (jump to Coach), `t` (toggle dark/light theme), `?` or `⌘K` (accessible keyboard shortcuts modal with focus trap), and `Space` / `1–4` / `e` / `s` during flashcard review.

---

## 4. Architectural & Codebase House Style (`CLAUDE.md` & ADRs)

1. **Strict Package Boundaries & Build Order:**
   - `@dsa/shared` → `@dsa/database` (must build first; owns Drizzle SQLite schema & Notion types) → `@dsa/intelligence` (pure TypeScript) → `@dsa/integrations` (all external I/O) → `@dsa/backend` (Fastify DI wiring) → `@dsa/frontend` (React 19 + Vite + D3).
   - Barrels (`packages/*/src/index.ts`) export **only** what another package actually imports (ADR 0002 Decision B).
2. **Pure, I/O-Free Intelligence Layer (`@dsa/intelligence`):**
   - All decision engines (`TopicPriorityEngine`, `RevisionEngine`, `WeaknessEngine`, `DifficultyEngine`, `RoadmapEngine`, `CurriculumEngine`, `ProblemReviewEngine`) take immutable snapshots in and return decisions out—**zero DB, zero network, zero side effects**.
   - `buildTopicState` in `packages/intelligence/src/analytics/build-topic-snapshot.ts` is the **single source of truth** for mapping raw rows into `TopicState` (ADR 0002 Decision A). Never duplicate mappers in the backend.
3. **Single Composition Root (`packages/backend/src/context.ts`):**
   - `createAppContext` constructs the entire dependency graph (migrations → SQLite → repositories → services → intelligence orchestrator). Repositories are the only layer touching SQLite (via `MirrorCache`); routes stay thin and delegate to services.
4. **Three Independent Scheduling Tiers & Field Ownership (`ADR 0001`):**
   - **Topic revision:** SM-2 (`RevisionEngine`), stored on `topics`.
   - **Flashcard review:** Per-card FSRS (`CardService` via `ts-fsrs`), stored on `cards`.
   - **Problem re-solve:** Per-problem FSRS (`ProblemReviewEngine` via `ts-fsrs`), stored on local-only `problem_reviews`.
   - **Sync ownership rule:** Notion owns *content* (titles, notes, card front/back); local SQLite owns *scheduling & telemetry state* (`nextRevisionAt`, `sm2_*`, FSRS columns, `problem_attempts`, `problem_reviews`, `card_embeddings`). A Notion pull must **never** overwrite or wipe local scheduling fields.
   - **Card bank sync seam:** Only `NotionSyncTarget.ts` may import `@notionhq/client` for cards, enforced by `no-direct-notion-import.test.ts`.
5. **Closed Concept Vocabulary (`database/seeds/*/concepts.yaml`):**
   - Flashcard concept tags are a closed, flat, human-authored YAML vocabulary with static `requires` prerequisite edges. LLMs may only assign existing concept tags—never invent new ones.
6. **CSS Architecture (`global.css` + `design.css`):**
   - Plain semantic CSS with custom properties—no Tailwind, no CSS-in-JS.
   - `global.css` provides the standalone base token palette and foundational component rules; `design.css` layers the v2 and Atelier Editorial overrides on top (`CSS_AUDIT.md`). Keep selectors clean and semantic (`BEM`-style modifiers like `.problem-row-v2--active`).

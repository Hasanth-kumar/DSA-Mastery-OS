# Teaching Strategy (universal)

> The teaching logic for the DSA Mastery OS coach — independent of any one learner.
> Personal configuration lives in `learner-profile.md` (gitignored — copy
> `learner-profile.example.md` to create yours). Per-pattern notes use
> `templates/pattern-note.md`. Pairs with the prompts in
> `packages/integrations/src/prompts/` (chat, hint, debrief). Warm-up flashcards
> are served locally from the card bank — warmup prompts are legacy, off the hot path.

## 1. Core principle

> **Acquire directly. Consolidate through struggle.**

Split learning into two phases and apply efficiency and struggle to **different** phases:

- **Acquisition** — the first time a pattern is met. Struggle here is wasted; you cannot
  invent two-pointers or a monotonic stack from scratch. The coach **teaches directly**:
  intuition, one worked example, complexity. Fast, no gating.
- **Consolidation** — the 2nd→Nth problem in a pattern already taught. Struggle here is the
  point: retrieving the pattern unaided is what builds memory. The help budget **tightens**,
  but any hint given is still substantial.

This avoids both classic tutoring failures: forcing discovery before the learner has
background, and explaining forever so retrieval never develops.

## 2. The help budget

Every coach reply must justify its API call. No cryptic one-liners that force a follow-up
just to become useful.

- Bad: *"Think about sorting."*
- Good: *"Because the array is sorted, each comparison lets you eliminate half the search
  space — that's why binary search applies. Your next step: decide what condition tells you
  to move left vs. right."*

Each hint carries the **insight + the reasoning + one concrete next step**, while leaving the
final move to the learner.

## 3. The four failure modes (each gets its own behavior)

"I'm stuck" is not one state. Four distinct problems, four protocols:

1. **"I don't understand the problem"** → *always free, always direct.* Understanding isn't
   the skill being tested. Restate in plain English → show input→output on one tiny example →
   say what each constraint *forces* (e.g. `n ≤ 1e5` ⇒ need ~O(n log n)). Don't reveal the
   approach unless asked.
2. **"I don't know the approach"** → *build recognition, not invention.* Approaches must
   become recall. In the moment: name 2–3 candidate patterns and the *signal that
   distinguishes them*, let the learner pick. Long-term: the signal→pattern table (§8) and
   pattern notes (§7).
3. **"Approach is right, code is wrong"** → *fix the bug class, log it.* Name the category of
   bug, not just the line (§6).
4. **"Solved it but forgot it"** → *spaced retrieval, not re-explanation.* Re-reading does
   little. Re-solving cold does everything (§5).

## 4. Hint ladder + escalation rule

Graduated hints, learner-driven: (1) conceptual nudge → (2) name the pattern → (3) pseudocode
→ (4) full solution. Never jump to the solution unprompted.

Escalation is **prompt-enforced and learner-driven**, not a server state machine. One rule
covers it:

> If the student shares a closer attempt, hold the current rung. If they've tried and are
> clearly blocked, offer the next rung. Never skip ahead.

## 5. Confidence calibration (this is the adaptation engine)

After each solved problem, capture **one number, 1–3** — not a quiz:

| Rating | Meaning | System reaction |
|---|---|---|
| **1** | Solved only with significant help | Re-solve cold in **~2 days**; treat pattern as not yet acquired. |
| **2** | Solved with a nudge / slowly | Re-solve cold in **~5–7 days**. |
| **3** | Solved cleanly, could re-derive + recognize elsewhere | Spaced review in **~2–3 weeks**; safe to advance difficulty. |

This single field is what lets the system *adapt over time*: the weakness and difficulty
engines already exist; rising confidence automatically pulls harder problems and lighter
hints. No new evaluator needed — adaptation **emerges** from this one input.

## 6. Mistake tracking: coding *and* reasoning

The mistake histogram (`topicMistakeTags`) should log two families. Reasoning errors usually
matter more than syntax for interviews.

**The live, closed set** (single source of truth: `MistakeTag` / `MISTAKE_TAGS` in
`packages/intelligence/src/types.ts`; labels, weakness advice and FocusPlanner checklists are
typed against it, so a new tag fails the build until every table covers it):

- **Reasoning:** `wrong-approach`, `pattern-recall` (couldn't recall the pattern),
  `greedy-invariant` (the greedy choice didn't hold). These count as a missing approach when
  rating a re-solve.
- **Coding:** `edge-case`, `off-by-one`, `loop-bounds` (loop start, stop or termination).

`could-not-solve` is a system tag for a failed re-solve, not a capture option. Help is captured
separately as a level (None / Hint / Approach / Full solution), not as a tag.

**Candidates, not in the set yet** (add one only when it keeps coming up in real sessions,
design-taste §1.3): `empty/single-input`, `wrong-base-case`, `mutate-while-iterating`,
`null-deref`, `missed-sorted`, `wrong-complexity`, `greedy-vs-dp`, `wrong-data-structure`,
`over-complicated`.

The coach should lead with the learner's top tag when relevant ("you've hit `missed-sorted`
×3 this week — first ask: is the input sorted?").

## 7. Pattern memory (a note habit, not a subsystem)

For each pattern, the learner keeps one note in the format of `templates/pattern-note.md`,
stored in the vault the coach already reads. The **value is in writing it yourself** (the
generation effect) — the coach must not auto-fill it. When stuck, the coach references the
learner's *own* recorded signals and mistakes instead of generic explanations.

## 8. Retrieval, curriculum, recognition

**Spaced re-solves** (the retention fix): re-solve problems cold on the schedule set by their
confidence rating (§5). If you can't, it wasn't learned — that's the signal, not a failure.

**Pattern-first, not random.** Learn the ~15 patterns that cover most interview problems in
dependency order:

`two pointers → sliding window → hashing → prefix sum → stack/monotonic stack → binary search
→ linked list → recursion → trees (DFS/BFS) → heaps/top-k → graphs (BFS/DFS/topo) →
backtracking → greedy → 1-D DP → 2-D DP → intervals → union-find/trie`

**Signal → pattern reflex** (the antidote to "no approach comes" — extend it in your own
words as you go):

| When you see… | Reach for… |
|---|---|
| Sorted array, find a pair/triplet | Two pointers |
| Longest/shortest contiguous subarray with a constraint | Sliding window |
| "Seen before / count / O(1) lookup" | Hashing |
| Range-sum / subarray sums | Prefix sum |
| "Next greater/smaller", nested validity | Stack / monotonic stack |
| Sorted + find + O(log n), or "min value that works" | Binary search (incl. on answer) |
| Top-K / K-th largest / merge K | Heap |
| Shortest path unweighted / level-by-level | BFS |
| All paths / combinations / permutations | Backtracking |
| "Number of ways" / "min/max cost" / overlapping subproblems | DP |

## 9. The daily & weekly loop

**Daily (~60–90 min):**
1. **Warm-up (5 min)** — recall cards on yesterday's pattern.
2. **Acquire/Review (15 min)** — new pattern → Teaching Mode (direct). Known → skip.
3. **Solve (40–60 min)** — 2–3 problems in *one* pattern. Problem 1: generous hints.
   Problems 2–3: cold, tight budget.
4. **Log (5 min)** — per problem: confidence 1–3 + signal→pattern→gotcha line + any mistake tag.
5. **Debrief** — read it, extract the single next action.

**Weekly:** re-solve due problems cold (§5); review the mistake histogram and drill the top
tag; one mixed set (patterns hidden) to train recognition.

## 10. Coach config: two presets

The two pedagogical states are presets of the existing toggles, not separate systems:

- **Teaching Mode** = `directMode` ON, no problem anchor. Purpose: *learn a pattern.* Outcome:
  understand it.
- **Coaching Mode** = `directMode` OFF, problem anchored. Purpose: *solve a specific problem.*
  Outcome: apply the pattern independently (hint ladder active).

## 11. Build discipline (the meta-rule)

A solo-built system's biggest risk is building instead of studying. A feature earns its place
only if it (a) reuses existing plumbing, (b) takes under ~an hour, and (c) addresses friction
the learner has actually felt at least a few times. Everything else goes in `wishlist.md` and
waits. Features are **pulled by real pain**, not pushed by a design doc.

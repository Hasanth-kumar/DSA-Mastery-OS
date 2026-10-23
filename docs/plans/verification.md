# Phase 1 verification

Code reading on `overhaul` at the P1.1 session (2026-10-22). No database was opened. This checkout has no `.env`, no credentials, and no `data/dev/dsa.dev.db`. Claims that need query output are marked **unverified (local-only)**. That is not a refutation.

`pnpm dev:metrics` already prints the fields a later local run needs (per-topic `next_revision_at` / `sm2_interval`, problem status counts, `curriculum_active_topic_id`). Do not commit that output. Do not run `pnpm db:repair-schedules` in code-only mode: it calls `createAppContext(loadConfig())`, and the default path `./data/sqlite/dsa.db` would create a database.

## Verdicts

| Claim | Verdict | Evidence |
|---|---|---|
| #1 Far-future SM-2 dates exist in the data | unverified (local-only) | No dev database. Repair fixtures illustrate the shape; they are not a query. |
| #1 Duration scoring is what pushed intervals out to 2027–2037 | partly | The length-based scorer and uncapped SM-2 growth are real. New writes through `RevisionEngine` are already clamped, and problem-linked sessions no longer use the length score. |
| #7 `buildProblemCounts()` treats `status !== "Solved"` as unsolved | confirmed | `CurriculumService.ts` |
| #7 `findUnsolvedByTopicId()` queries only `"Not started"` | confirmed | `ProblemRepository.ts`. Together these are the deadlock. |
| #6 Stored pin is Greedy Sorting | unverified (local-only) | The pin mechanism is confirmed; the stored value was not read. |
| #6 Default list covers 12 of 50 topics | partly | The default list is 12 labels. The topics-table size was not queried. Each label resolves to one topic. |
| #6 `PlanService` bypasses `TopicPriorityEngine` and `RoadmapEngine` | partly | Primary-topic selection uses `CurriculumEngine` only. There is no `RoadmapEngine` class. Priority scoring is read after selection, not used to choose the topic. |
| #8 `DifficultyEngine` gates Medium on confidence ≥ 40 | partly | Below 40 is Easy only. At ≥ 40 Medium is the secondary slot. Medium as *primary* needs confidence ≥ 60 and recent productivity ≥ 60. Coach assist discounts confidence before the gates. |

## #1 — SM-2 dates and the duration scorer

**Dates.** Not queried. `packages/intelligence/src/revision-engine/schedule-repair.test.ts` uses far-future fixtures (a 2030 date with interval 1459, a 2037 date with interval 3900) to lock `planScheduleRepair`. Those fixtures are not study data and are not evidence the database still contains those rows.

**How a short session used to become a multi-year interval.**

1. `deriveProductivityFromDuration` (`packages/intelligence/src/session-productivity.ts`) scores length, and shorter scores higher. At or under 30 minutes the score is `round(100 - (minutes / 30) * 10)`, so a 1-minute session scores 100. A 60-minute session scores 75. The floor is 40.
2. `topicToSM2Quality` (`packages/intelligence/src/revision-engine/sm2.ts`) maps that score onto SM-2 quality 0–5. A score of 80 or more is quality 5. Quality under 3 resets the interval to 1 day; quality 3 or more grows it.
3. `sm2Update` grows geometrically once `repetition >= 2`: `round(interval * efactor)`, and its default `maxInterval` is infinity. The comment on `maxIntervalDaysForConfidence` says this growth pushed a 30%-confidence topic out to 2030. The old confidence step `(productivity - 50) / 10` (comment in `packages/intelligence/src/session-outcome.ts`) added roughly +4 to +5 on every high length-score, so the same short sessions also inflated confidence.

**What current code already does.**

- A session linked to a problem is scored with `deriveSessionOutcomeScore` in `SessionService.completeSession`, not with the length formula. A 1-minute session that needed help lands near 50 (help base 50, plus 10 for being fast relative to the Medium target, minus 10 when hint count is at least 3). Quality for 50 is 3, which still lengthens the interval. It is not quality 5.
- A session with no problem still uses `deriveProductivityFromDuration`, capped at 70 (`NO_PROBLEM_SCORE_CAP` in `SessionService.ts`). Score 70 is quality 4, which also lengthens the interval.
- `RevisionEngine.applyQuality` passes `maxIntervalDaysForConfidence`: under 40 → 7 days, under 60 → 21, under 80 → 45, otherwise 120. That is the only production caller of `sm2Update`. New reviews cannot recreate a 2027–2037 date. `sm2Update` itself stays uncapped when `maxInterval` is omitted (tests rely on that).
- Repair of rows already stored is `planScheduleRepair` plus `pnpm db:repair-schedules` (dry-run unless `--apply`). Applying it also marks topics dirty for Notion. Agents do not run `--apply` on a live database.

**Plan correction.** P2.1 must not replace the 7/21/45/120 caps with a flat 180-day cap. The remaining work is a regression test through the production path: a 1-minute heavy-hint session on a weak topic stays inside the confidence cap and is not scored as a perfect review. Quality 3 still advances the interval; that is classic SM-2 and is not, by itself, the far-future bug.

## #7 — "Revision needed" deadlock

Confirmed in code. No data check of whether a topic is stuck on it today.

`CurriculumService.buildProblemCounts` (`packages/backend/src/services/CurriculumService.ts`) counts every problem whose status is not exactly `"Solved"` as unsolved. A null or `"Revision needed"` status increments `unsolved`.

`"Revision needed"` is a real problem status (`database/schema/notion-types.ts`). Mistake tags set it in `SessionService.applyProblemStatus`. `CurriculumEngine` treats `unsolved > 0` as work remaining, so a topic whose problems are all `"Revision needed"` never becomes complete and the curriculum does not advance.

`ProblemRepository.findUnsolvedByTopicId` (`packages/backend/src/repositories/ProblemRepository.ts`) filters with `eq(problems.status, "Not started")` before the optional difficulty filter.

`ProblemSuggestionService.selectForTopic` uses that query. When it returns nothing, the suggestion is a placeholder named `"<topic> — <difficulty> practice (add problems in Notion)"`. A topic the curriculum refuses to leave can therefore offer no real problem.

P3.1's helper (`isFirstPassCovered` = Solved or Revision needed, `isRemainingFirstPass` = Not started) matches this split. No plan change.

## #6 — Pin, default list, priority, roadmap

**Pin value.** Not read. `sync_meta` key `curriculum_active_topic_id` (`CurriculumService.ts`).

**How it is set and cleared.**

- `setActiveTopicId` writes the topic id, or `""` when passed null. It does not delete the row. `getConfig` treats `""` as no pin.
- `PUT /api/curriculum/active` sets it (`packages/backend/src/routes/curriculum.routes.ts`). The body topic must exist. `topicId: null` clears it.
- `POST /api/curriculum/reset` restores the default name list and clears the pin.
- The settings curriculum panel (`CurriculumPanel.tsx`) sends the topic id on Switch and null on Auto-advance.
- While the pin resolves to a topic, `CurriculumEngine.selectCurrentTopic` returns that topic and ignores remaining-problem counts. The reasoning string says `manual selection`. There is no expiry and no "first pass complete" check. That is what P3.3 adds.

**Default list.** `DEFAULT_CURRICULUM_TOPICS` in `packages/intelligence/src/curriculum-engine/default-topics.ts` has 12 labels: Binary Search, Trees, Heaps, Graphs, Sliding Window, Backtracking, Greedy, DP, Tries, Union Find, Monotonic Stack, Segment Tree. `resolveTopicByLabel` returns the first topic whose name matches the label or an alias, so the list covers at most 12 topics no matter how many rows the topics table has. The "50 Notion topics" count was not queried.

`namesMatch` is a substring check. The label `"Greedy"` matches a topic named `"Greedy Sorting"` if that row is the first hit. A manual pin is not required for the default list to land there. Whether the mirror actually contains that name is local-only.

**Priority and roadmap.** `PlanService.buildPlan` takes the primary topic from `curriculumService.selectForTopics` only. It then calls `computePriorityScore` to annotate memory/execution divergence and to append a sentence to the reasoning. It does not call `TopicPriorityEngine.scoreAll` or `IntelligenceOrchestrator.scoreTopics`, so the score never chooses the topic. `scoreTopics` is used by the topics API.

There is no `RoadmapEngine` class. `packages/intelligence/src/roadmap-engine/` exports `DSA_PREREQUISITES` and `buildTopicGraphEdges`. The graph module says the extra edges do not affect roadmap unlock, scoring, or Notion sync. `PlanService` does not import them. P3.4 has to introduce that consultation; it cannot call an engine that is already wired.

## #8 — DifficultyEngine thresholds

`DifficultyEngine.recommendDifficulty` discounts confidence for coach assist, then gates:

| Adjusted confidence | Also required | Primary | Secondary |
|---|---|---|---|
| ≥ 80 | recent productivity ≥ 75 | Hard | Medium (30%) |
| ≥ 60 | recent productivity ≥ 60 | Medium | Hard (20%) |
| ≥ 40 | — | Easy | Medium (30%) |
| below 40 | — | Easy | none |

Coach assist, when at least two solved attempts are recorded: assist rate ≥ 0.5 subtracts 15, rate ≥ 0.25 subtracts 8. The discount is applied before the table above.

Recent productivity is the mean `productivityScore` of the latest 3 sessions. With no sessions the mean defaults to 50, so a topic at confidence 70 and no recent sessions fails the Medium-primary gate and gets Easy primary with Medium secondary.

The diagnosis "gates Medium on confidence ≥ 40, so coach use keeps the learner on Easy" is the Easy-only band (below 40) and the coach discount, overstated. Medium as the main assignment starts at 60, and only with productivity at least 60. P3.5's stage table still replaces these gates. The stage rules in the plan are unchanged.

## Local-only follow-up

When a dev database exists, read `pnpm dev:metrics` (do not commit it) and record:

- Any topic with confidence under 40 whose `next_revision_at` is more than 14 days out, or whose `sm2_interval` exceeds `maxIntervalDaysForConfidence`.
- The `curriculum_active_topic_id` line, and the topic name it points at.
- How many topic rows exist against the 12 default labels.
- Whether any topic has `"Revision needed"` problems and zero `"Not started"` problems. The metrics script prints global status counts only, so this cross-check is a separate read of the dev copy.

## P1.2 — Dependents of topic-level SM-2

Code reading on `overhaul` at the P1.2 session (2026-10-23). No database was opened. This gates Phase 4.

**Fields.** The SM-2 state on `topics` is `next_revision_at` (`nextRevisionAt`), `sm2_interval`, `sm2_repetition` and `sm2_efactor`. Two neighbouring fields are written on the same paths and are listed where they matter: `revision_count` and `last_revised`. `last_revised` is set by every completed session as well as by the recall grade, so it outlives SM-2. `cards.due` and `WarmupGradeResult.nextRevisionAt` (`CardService.ts`) are per-card FSRS and are out of scope, despite the shared field name.

**Classes.** *UI only*: displays the value, or sends it somewhere a person reads it, and changes no decision. Safe to hide. *Feeds decisions*: changes what the plan serves, how a topic is scored, or what other state is written. Needs a replacement signal or an explicit removal.

### Readers that feed decisions

| # | Reader | What it decides | Replacement (P4.1) |
|---|---|---|---|
| F1 | `PlanService.buildPlan` → `IntelligenceOrchestrator.getRevisionQueue` → `RevisionEngine.getRevisionQueue` / `isDue` (`PlanService.ts:80`) | Due topics (any non-`Not started` topic with `nextRevisionAt` null or past), excluding the primary topic. They become `plan.revisionTopics`, `revisionTotalDue`, and through `selectRevisionProblems` one solved problem per topic in `plan.revisionProblems`. | Under `hideTopicRevision`, return empty revision lists. Due re-solves already come from `ProblemReviewService.dueSlots` (problem FSRS). If a topic-level "due" flag is still wanted: the topic has ≥ 1 overdue `problem_reviews` row. |
| F2 | `PlanService.estimateDuration` (`PlanService.ts:230`) | Adds 25 minutes per revision topic. When `availableMinutes` is passed, that total drops non-promoted re-solve slots first (`PlanService.ts:120`). Today does not pass `availableMinutes` (`client.ts` calls `/api/plan/today` with no query), so this is latent; the API query parameter still reaches it. | Drop the revision minutes when F1 is off, so retired topic revision never displaces an FSRS re-solve. |
| F3 | `RevisionEngine.compressQueue` via `compressRevisionQueue` (`PlanService.ts:86`) | Writes, not only reads. On every uncached `generateTodaysPlan` (Today, `/api/analytics/dashboard`, the coach chat context in `ChatService.ts:424`, the WhatsApp `plan` command), overflow topics get `nextRevisionAt` pushed forward with `topicRepo.bulkUpdate`. | Stop this write together with F1. Hiding the UI alone leaves it running. |
| F4 | `urgencyScore` in `topic-priority-engine/scoring.ts:31` | Urgency is 30% of `computePriorityScore` (default weights). It sets `recommendation` ("Study now", "Review soon") and, with weakness ≥ 0.4 and urgency < 0.1, `memoryExecutionDivergence` and its +12 boost. Today the score only annotates the chosen topic (P1.1). **P3.4 makes this score rank primary-topic candidates**, so it becomes decision-critical in Phase 3, before Phase 4 starts. | Urgency from problem FSRS: overdue re-solve count for the topic, or 1 − mean retrievability of its `problem_reviews`. Pure function in `@dsa/intelligence`, fed by the backend. Topics with no reviews keep the "never studied" rule from `last_revised`. |
| F5 | `memoryExecutionDivergence` consumers (from F4) | Appends "practice anyway despite a far-out review date" to `plan.reasoning` (`PlanService.ts:140`). That reasoning reaches the Today hero, the WhatsApp plan message, and the coach system prompt (`ChatService.ts:434`). Also fills `plan.divergentTopics` and `WeeklySummary.divergentTopics` (`AnalyticsService.ts:201`). Neither divergent list is rendered in the frontend or in the WhatsApp digest. | Follows F4. With FSRS urgency the label means "no overdue re-solve, but still weak". Reword the sentence, which names a review date. |
| F6 | `SessionService.applySessionToTopic` `skipScheduling` (`SessionService.ts:177`) | When the warm-up was graded (`warmupGraded` from Today, or the same-day `sync_meta` key `warmup_srs:<topicId>` set by the recall grade), the session writes no SM-2 state and does not increment `revision_count`. `revision_count > 0 && confidence < 50` is one branch of `revisionFailureSignal` (`weakness-engine/signals.ts:97`, weight 0.125), which feeds `isWeakArea`. So a flashcard (FSRS) warm-up grade currently changes a topic-level counter that weakness reads. | When SM-2 is retired, increment `revision_count` on every completed session (drop the `skipScheduling` branch for it), or replace the branch with "has ≥ 1 attempt". No new signal needed. |
| F7 | `readSM2State` / `topicToSM2Quality` / `sm2Update` via `updateAfterSession` and `applyRecallQuality` | The SM-2 writers themselves: completed sessions (unless F6 skips) and `POST /api/revision/:topicId/grade`. They read the prior interval, repetition and ease. | None. Retiring SM-2 means removing these calls. Keep the code until after merge per P4.3. |

### Readers that are UI only

| # | Reader | Surface |
|---|---|---|
| U1 | `TodayPage.tsx` revision column (`topRevision`, `revisionProblems` rows, `RevisionGradeButtons`, "Show all N →" list from `GET /api/revision`) | Today. Shows `last revised`, `next review`, `due <date>`. Grades write SM-2 through F7. |
| U2 | `TodayPage.tsx` post-solve `revision-offer` / `revision-active` flow (`finishCapture`, once per day by `dsa-revision-offer-day`) | Today, after MistakeCapture. Offers `plan.revisionProblems[0]`. Hidden by P4.3. |
| U3 | `TodayPage.tsx` "Recall ≠ execution" chip | Today hero. Shows F5's flag. |
| U4 | `ScoreBar` with `GET /api/topics/:id/score/explain` (`explain.ts`) | Today "Why this?". Urgency segment and its "revision is overdue / not yet due" text. Follows F4. |
| U5 | `GET /api/revision` (`revision.routes.ts:10`) | Feeds U1's full list; also returns `dueWithin24h`, which nothing reads. |
| U6 | `KnowledgeGraph.tsx:96` `isDue` ring, and `GraphPage.tsx:64` `dueLabel` | Graph tab: dashed "Revision due" ring and the node detail line. |
| U7 | `formatStudyPlanForWhatsApp` (`plan.formatter.ts:18`) | WhatsApp `plan` reply: "🔄 REVISION (N)" with "(overdue)". |
| U8 | `completeSession` result `nextRevisionAt` and summary "Next review: …" (`SessionService.ts:282`) | WhatsApp log reply (`WhatsAppCommandService.ts:192`). The Today page ignores both fields. |
| U9 | Notion push (`NotionSyncService` → `NotionClient.updateTopic` "Next Review", interval, ease) | Notion topic properties a person reads in Notion. Pull keeps the local schedule (`preserveLocalSchedule` in `integrations/src/sqlite/sync.ts`) and seeds it only for a new topic, so Notion never drives a decision. |
| U10 | `GET /api/topics` `scores` | Returned with the topic list; the frontend client types it but no component reads it. |

### Tooling (neither class)

- `planScheduleRepair` and `pnpm db:repair-schedules` (`schedule-repair.ts`, `scripts/repair-topic-schedules.ts`). Needed for P2.2 and the live migration. Retire after merge with the rest of SM-2.
- `pnpm dev:metrics` prints `next_revision_at` and `sm2_interval`. Keep while the overhaul compares before and after.
- `buildTopicState` and `AnalyticsService.topicToInput` only map the fields. The analytics metrics (velocity, weakness trend, difficulty) do not read them.

### Not dependent

`CurriculumEngine` and `CurriculumService`, `DifficultyEngine`, `FocusPlanner`, `ProblemReviewEngine`, `WeaknessEngine` (apart from `revision_count` in F6), `deriveTopicStatusAfterSession`, and confidence updates (`confidenceDeltaForScore` uses the session score, not SM-2 quality) read none of the SM-2 fields.

### What this means for Phase 4

- P4.1 is not skipped. It has two real replacements: F4 (FSRS-based urgency, needed by P3.4's ranking) and F6 (`revision_count` independent of the warm-up skip). F1–F3 need an off switch, not a new signal: due re-solves already come from problem FSRS.
- P4.3 should also stop F3's compression write and F2's revision minutes when `hideTopicRevision` is on. Hiding only U1–U3 leaves the plan rescheduling hidden topics and still budgeting time for them.
- P3.4 runs before P4.1 and will rank with SM-2 urgency. That is acceptable as an interim; P4.1 then swaps the urgency input without touching the ranking code.

import {
  createIntelligenceOrchestrator,
  type IntelligenceOrchestrator,
} from "@dsa/intelligence";
import { createSqliteDb, runMigrations, createSeedVocabularyResolver, markTopicDirty } from "@dsa/integrations";
import type { LLMService } from "@dsa/integrations";
import { createCoachLLMService } from "./llm.factory.js";
import { TopicRepository } from "./repositories/TopicRepository.js";
import { AttemptRepository } from "./repositories/AttemptRepository.js";
import { CardRepository } from "./repositories/CardRepository.js";
import { ConflictRepository } from "./repositories/ConflictRepository.js";
import { NoteRepository } from "./repositories/NoteRepository.js";
import { ProblemRepository } from "./repositories/ProblemRepository.js";
import { ProblemReviewRepository } from "./repositories/ProblemReviewRepository.js";
import { SessionRepository } from "./repositories/SessionRepository.js";
import { SyncMetaRepository } from "./repositories/SyncMetaRepository.js";
import { AnalyticsService } from "./services/AnalyticsService.js";
import { BackupService } from "./services/BackupService.js";
import { CacheService } from "./services/CacheService.js";
import { DebriefService } from "./services/DebriefService.js";
import { EventBus } from "./services/EventBus.js";
import { ChatService } from "./services/ChatService.js";
import { HintService } from "./services/HintService.js";
import { ChatRepository } from "./repositories/ChatRepository.js";
import { LeetCodeService } from "./services/LeetCodeService.js";
import { MirrorCache } from "./services/MirrorCache.js";
import { NotionSyncService } from "./services/NotionSyncService.js";
import { ObsidianNoteService } from "./services/ObsidianNoteService.js";
import { CurriculumService } from "./services/CurriculumService.js";
import { PlanService } from "./services/PlanService.js";
import { ProblemReviewService } from "./services/ProblemReviewService.js";
import { SessionService } from "./services/SessionService.js";
import type { SqliteLike } from "@dsa/integrations";
import { findRepoRoot, type AppConfig } from "@dsa/shared";
import { CardBankSyncService } from "./services/CardBankSyncService.js";
import { CardService, type CardServiceDeps } from "./services/CardService.js";
import { createConceptGraph } from "./services/leechRemediation.js";
import { WarmupService } from "./services/WarmupService.js";
import { resolve } from "node:path";

export interface AppContext {
  config: AppConfig;
  intelligence: IntelligenceOrchestrator;
  mirrorCache: MirrorCache;
  topicRepo: TopicRepository;
  problemRepo: ProblemRepository;
  sessionRepo: SessionRepository;
  syncMetaRepo: SyncMetaRepository;
  attemptRepo: AttemptRepository;
  problemReviewRepo: ProblemReviewRepository;
  cardRepo: CardRepository;
  noteRepo: NoteRepository;
  conflictRepo: ConflictRepository;
  cache: CacheService;
  events: EventBus;
  curriculumService: CurriculumService;
  planService: PlanService;
  problemReviewService: ProblemReviewService;
  sessionService: SessionService;
  cardService: CardService;
  cardBankSync: CardBankSyncService;
  analyticsService: AnalyticsService;
  debriefService: DebriefService;
  hintService: HintService;
  chatService: ChatService;
  warmupService: WarmupService;
  leetcodeService: LeetCodeService;
  notionSync: NotionSyncService;
  obsidianNotes: ObsidianNoteService;
  backupService: BackupService;
  /**
   * Coach interactions per problemId since boot (D2) — stamped onto the attempt
   * at logSession, then cleared. ponytail: in-memory (lost on restart) is fine —
   * a coach session and its solve happen in the same process lifetime.
   */
  coachUsage: Map<string, number>;
  close: () => Promise<void>;
}

export interface CreateAppContextOptions {
  /** Inject a mock/stub for coaching routes in tests (avoids real LLM calls). */
  coachLlm?: LLMService;
}

export function createAppContext(
  config: AppConfig,
  options: CreateAppContextOptions = {},
): AppContext {
  runMigrations(config.sqlite.path);
  const { db, sqlite } = createSqliteDb(config.sqlite.path);

  const mirrorCache = new MirrorCache(db, undefined, {
    resolveUrgency: config.flags.hideTopicRevision,
  });
  const topicRepo = new TopicRepository(db, mirrorCache);
  const problemRepo = new ProblemRepository(db, mirrorCache);
  const sessionRepo = new SessionRepository(db, mirrorCache);
  const syncMetaRepo = new SyncMetaRepository(db);
  const attemptRepo = new AttemptRepository(db, mirrorCache);
  const cardRepo = new CardRepository(db);
  const noteRepo = new NoteRepository(db, mirrorCache);
  const conflictRepo = new ConflictRepository(db);
  const cache = new CacheService();
  const events = new EventBus();
  const intelligence = createIntelligenceOrchestrator(config.intelligenceWeights);
  const notionSync = new NotionSyncService(
    config,
    topicRepo,
    problemRepo,
    syncMetaRepo,
    mirrorCache,
    conflictRepo,
  );
  const obsidianNotes = new ObsidianNoteService(config, noteRepo, problemRepo, topicRepo, () =>
    events.publish("note"),
  );
  const curriculumService = new CurriculumService(syncMetaRepo, problemRepo);
  const problemReviewRepo = new ProblemReviewRepository(db);
  const problemReviewService = new ProblemReviewService(
    config,
    intelligence,
    problemReviewRepo,
    problemRepo,
    attemptRepo,
    events,
  );
  const planService = new PlanService(
    intelligence,
    topicRepo,
    problemRepo,
    cache,
    curriculumService,
    problemReviewService,
    sessionRepo,
    config.schedulers.timezone,
    { hideTopicRevision: config.flags.hideTopicRevision },
  );
  const coachUsage = new Map<string, number>();
  const sessionService = new SessionService(
    config,
    intelligence,
    sessionRepo,
    topicRepo,
    problemRepo,
    planService,
    notionSync,
    syncMetaRepo,
    attemptRepo,
    coachUsage,
    problemReviewService,
  );
  void sessionService.repairProblemStatusesFromAttempts();
  const analyticsService = new AnalyticsService(
    intelligence,
    topicRepo,
    sessionRepo,
    problemRepo,
  );
  events.subscribe((event) => {
    if (
      event.type === "session" ||
      event.type === "topic" ||
      event.type === "problem" ||
      event.type === "attempt"
    ) {
      analyticsService.invalidateDashboard();
      void planService.invalidateTodaysPlan();
    }
  });
  // Coaching paths (debrief/hint/chat) build their own LLM from coachLlm config (3.3).
  const coachLlm = options.coachLlm ?? createCoachLLMService(config);
  const debriefService = new DebriefService(
    config,
    intelligence,
    sessionRepo,
    topicRepo,
    analyticsService,
    coachLlm,
  );
  const hintService = new HintService(config, intelligence, coachLlm, cache);
  const chatRepo = new ChatRepository(db);
  const chatService = new ChatService(
    config,
    chatRepo,
    planService,
    analyticsService,
    intelligence,
    topicRepo,
    problemRepo,
    coachLlm,
    attemptRepo,
    noteRepo,
  );
  const cardService = new CardService(cardRepo, syncMetaRepo, buildCardServiceDeps(sqlite, noteRepo, cardRepo));
  const cardBankSync = new CardBankSyncService(sqlite, config, syncMetaRepo);
  cardBankSync.startPeriodicFlush(config.cards.flushIntervalMs);
  const warmupService = new WarmupService(topicRepo, cardService);
  const leetcodeService = new LeetCodeService(config, syncMetaRepo);
  const backupService = new BackupService(config, sqlite);

  return {
    config,
    intelligence,
    mirrorCache,
    topicRepo,
    problemRepo,
    sessionRepo,
    syncMetaRepo,
    attemptRepo,
    problemReviewRepo,
    cardRepo,
    noteRepo,
    conflictRepo,
    cache,
    events,
    curriculumService,
    planService,
    problemReviewService,
    sessionService,
    cardService,
    cardBankSync,
    analyticsService,
    debriefService,
    hintService,
    chatService,
    warmupService,
    leetcodeService,
    notionSync,
    obsidianNotes,
    backupService,
    coachUsage,
    async close() {
      cardBankSync.stopPeriodicFlush();
      try {
        await cardBankSync.flush();
      } catch {
        // Best-effort — dirty cards replay on next flush.
      }
      backupService.stop();
      await obsidianNotes.stopWatching();
      sqlite.close();
      await cache.disconnect();
    },
  };
}

function buildCardServiceDeps(
  sqlite: SqliteLike,
  noteRepo: NoteRepository,
  cardRepo: CardRepository,
): CardServiceDeps {
  const seedsRoot = resolve(findRepoRoot(), "database/seeds");
  const vocab = createSeedVocabularyResolver(seedsRoot);
  const conceptGraph = createConceptGraph((topicId) => vocab(topicId));

  const masteryMarked = new Set<string>();

  return {
    conceptGraph,
    onLeechDetected(topicId) {
      if (topicId) markTopicDirty(sqlite, topicId);
    },
    onReviewComplete(topicId) {
      if (!topicId || masteryMarked.has(topicId)) return;
      if (cardRepo.isTopicNearlyMature(topicId)) {
        markTopicDirty(sqlite, topicId);
        masteryMarked.add(topicId);
      }
    },
    noteExcerpt(topicId) {
      if (!topicId) return null;
      const notes = noteRepo.findByTopicId(topicId);
      const text = notes
        .map((n) => n.content?.trim())
        .filter(Boolean)
        .join("\n\n");
      if (!text) return null;
      return text.length <= 400 ? text : `${text.slice(0, 400)}…`;
    },
  };
}

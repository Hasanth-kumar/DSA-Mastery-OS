import { existsSync } from "node:fs";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { AppConfig } from "@dsa/shared";
import type { AppContext } from "./context.js";
import { healthRoutes } from "./routes/health.routes.js";
import { curriculumRoutes } from "./routes/curriculum.routes.js";
import { planRoutes } from "./routes/plan.routes.js";
import { revisionRoutes } from "./routes/revision.routes.js";
import { topicsRoutes } from "./routes/topics.routes.js";
import { sessionRoutes } from "./routes/session.routes.js";
import { analyticsRoutes } from "./routes/analytics.routes.js";
import { problemsRoutes } from "./routes/problems.routes.js";
import { coachingRoutes } from "./routes/coaching.routes.js";
import { integrationsRoutes } from "./routes/integrations.routes.js";
import { syncRoutes } from "./routes/sync.routes.js";
import { notesRoutes } from "./routes/notes.routes.js";
import { warmupRoutes } from "./routes/warmup.routes.js";
import { reviewRoutes } from "./routes/review.routes.js";
import { resolveRoutes } from "./routes/resolve.routes.js";
import { exportRoutes } from "./routes/export.routes.js";
import { eventsRoutes } from "./routes/events.routes.js";
import { flagsRoutes } from "./routes/flags.routes.js";
import {
  whatsappNotificationRoutes,
  whatsappWebhookRoutes,
} from "./routes/whatsapp.routes.js";

export function buildApp(config: AppConfig, ctx: AppContext) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        config.nodeEnv === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  void app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Production: this same process serves the built frontend (one Node server
  // instead of the Vite + tsx dev servers). Off if the build is missing.
  const serveFrontend =
    config.web.serveFrontend && existsSync(config.web.frontendDist);
  if (config.web.serveFrontend && !serveFrontend) {
    app.log.warn(
      `SERVE_FRONTEND is on but ${config.web.frontendDist} is missing — run \`pnpm build\`. Serving API only.`,
    );
  }

  // Root: API index in dev; the SPA owns "/" when the frontend is served.
  if (!serveFrontend)
    app.get("/", async () => ({
    name: "DSA Mastery OS API",
    version: "0.2.0",
    health: "/health",
    api: {
      plan: "GET /api/plan/today",
      flags: "GET /api/flags",
      curriculum: {
        get: "GET /api/curriculum",
        update: "PUT /api/curriculum",
        active: "PUT /api/curriculum/active",
        reset: "POST /api/curriculum/reset",
      },
      revision: "GET /api/revision",
      topics: "GET /api/topics",
      problems: "GET /api/problems",
      session: "POST /api/session",
      analytics: {
        streak: "GET /api/analytics/streak",
        dashboard: "GET /api/analytics/dashboard?weeks=8",
      },
      explainScore: "GET /api/topics/:id/score/explain",
      weaknessEvidence: "GET /api/topics/:id/weakness",
      coaching: {
        debrief: "GET /api/coaching/debrief",
        debriefBySession: "GET /api/coaching/debrief/:sessionId",
        hint: "GET /api/coaching/hint?name=<problem>&level=<1-4>",
        chat: "POST /api/coaching/chat",
        chatThread: "GET /api/coaching/chat/:threadId",
      },
      notes: {
        problemNote: "GET /api/problems/:id/note",
        template: "POST /api/problems/:id/note/template",
        scan: "POST /api/notes/scan",
      },
      warmup: {
        questions: "GET /api/warmup?topicId=<id>",
        answer: "POST /api/warmup/answer",
        grade: "POST /api/warmup/grade",
      },
      review: {
        queue: "GET /api/review/queue?cap=<n>",
        grade: "POST /api/review/grade",
        suspend: "POST /api/review/:cardId/suspend",
        edit: "PATCH /api/review/:cardId",
        delete: "DELETE /api/review/:cardId",
      },
      attempts: "PATCH /api/attempts/:id/mistake",
      export: "GET /api/export",
      backup: "POST /api/backup",
      events: "GET /api/events (SSE)",
      syncStatus: "GET /api/sync/status",
      syncConflicts: "GET /api/sync/conflicts",
      integrations: {
        leetcodeStats: "GET /api/integrations/leetcode/stats",
        leetcodeActivity: "GET /api/integrations/leetcode/activity",
      },
      sync: "POST /api/sync",
      syncFlush: "POST /api/sync/flush",
      syncCardsFlush: "POST /api/sync/cards/flush",
      syncCardsStatus: "GET /api/sync/cards/status",
      syncCardsPull: "POST /api/sync/cards/pull",
      notifications: {
        weeklyDigest: "POST /api/notifications/weekly-digest",
      },
    },
    webhooks: {
      whatsapp: "GET|POST /webhooks/whatsapp",
    },
  }));

  app.register(async (instance) => {
    await healthRoutes(instance, ctx);
  });

  app.register(
    async (instance) => {
      await planRoutes(instance, ctx);
      await curriculumRoutes(instance, ctx);
      await revisionRoutes(instance, ctx);
      await topicsRoutes(instance, ctx);
      await problemsRoutes(instance, ctx);
      await sessionRoutes(instance, ctx);
      await analyticsRoutes(instance, ctx);
      await coachingRoutes(instance, ctx);
      await integrationsRoutes(instance, ctx);
      await syncRoutes(instance, ctx);
      await notesRoutes(instance, ctx);
      await warmupRoutes(instance, ctx);
      await reviewRoutes(instance, ctx);
      await resolveRoutes(instance, ctx);
      await exportRoutes(instance, ctx);
      await eventsRoutes(instance, ctx);
      await flagsRoutes(instance, ctx);
      await whatsappNotificationRoutes(instance, ctx);
    },
    { prefix: "/api" },
  );

  app.register(async (instance) => {
    await whatsappWebhookRoutes(instance, ctx);
  }, { prefix: "/webhooks" });

  // Serve the built SPA from this process. The frontend talks to /api on the
  // same origin (no CORS hop), so this is all it takes.
  if (serveFrontend) {
    void app.register(fastifyStatic, {
      root: config.web.frontendDist,
      wildcard: false,
    });
    // SPA fallback: a browser navigation that isn't a real file or an
    // API/health/webhook route gets index.html; API misses stay JSON 404s.
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split("?")[0] ?? "/";
      if (
        request.method === "GET" &&
        !path.startsWith("/api") &&
        !path.startsWith("/health") &&
        !path.startsWith("/webhooks")
      ) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not Found", path });
    });
  }

  return app;
}

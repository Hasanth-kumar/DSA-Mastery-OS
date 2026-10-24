import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { serializeForJson } from "../lib/json.js";

function parseWeeks(value: unknown, fallback = 8): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 52);
}

export async function analyticsRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/analytics/streak", async (_request, reply) => {
    const streak = ctx.analyticsService.getStreak();
    return reply.send(serializeForJson(streak));
  });

  app.get<{ Querystring: { weeks?: string } }>(
    "/analytics/dashboard",
    async (request, reply) => {
      const weeks = parseWeeks(request.query.weeks);
      // P5.1 (P1.3 D6): no page reads the embedded plan; build it once per poll, on /plan/today.
      if (ctx.config.flags.todayQueueV2) {
        return reply.send(serializeForJson({ ...ctx.analyticsService.getDashboard(weeks), plan: null }));
      }
      const [dashboard, plan] = await Promise.all([
        Promise.resolve(ctx.analyticsService.getDashboard(weeks)),
        ctx.planService.generateTodaysPlan(),
      ]);
      return reply.send(serializeForJson({ ...dashboard, plan }));
    },
  );
}

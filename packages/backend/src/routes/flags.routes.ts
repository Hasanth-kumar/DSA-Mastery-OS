import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

/** Read-only overhaul feature flags (`FLAG_<NAME>` in `.env`) for the dashboard. */
export async function flagsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/flags", async () => ({ ...ctx.config.flags }));
}

import type { FastifyInstance } from "fastify";
import { stripWikiLinks } from "@dsa/integrations";
import type { AppContext } from "../context.js";
import { serializeForJson } from "../lib/json.js";

export async function notesRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  /** The user's Obsidian note for a problem, if one matched (2.3). */
  app.get<{ Params: { id: string } }>(
    "/problems/:id/note",
    async (request, reply) => {
      const note = ctx.obsidianNotes.getNoteForProblem(request.params.id);
      if (!note) {
        return reply.status(404).send({
          error: "No note for this problem",
          configured: ctx.obsidianNotes.isConfigured(),
        });
      }
      return reply.send(
        serializeForJson({
          note: {
            path: note.path,
            title: note.title,
            content: note.content ?? "",
            contentPlain: stripWikiLinks(note.content ?? ""),
            matchedBy: note.matchedBy,
            updatedAt: new Date(note.updatedAt).toISOString(),
          },
        }),
      );
    },
  );

  /** Generate a pre-filled vault note (2.4) — new files only. */
  app.post<{ Params: { id: string } }>(
    "/problems/:id/note/template",
    async (request, reply) => {
      const result = ctx.obsidianNotes.createTemplateForProblem(
        request.params.id,
        ctx.config.flags.takeawayField ? ctx.attemptRepo.takeawaysFor(request.params.id) : [],
      );
      if (!result.created) {
        return reply.status(409).send({ error: result.reason ?? "Not created" });
      }
      ctx.events.publish("note");
      return reply.status(201).send(result);
    },
  );

  /** Rescan the vault on demand. */
  app.post("/notes/scan", async (_request, reply) => {
    if (!ctx.obsidianNotes.isConfigured()) {
      return reply.status(503).send({ error: "Obsidian vault not configured" });
    }
    const result = ctx.obsidianNotes.scanVault();
    ctx.events.publish("note");
    return reply.send(result);
  });
}

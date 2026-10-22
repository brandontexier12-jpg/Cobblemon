import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

const id = z.object({ id: z.string().uuid() });

/** Mode carrière : création, déroulement, classements, circuit, palmarès. */
export function registerCareerRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/careers", async () => ctx.careers.list());
  app.get("/api/careers/options", async () => ctx.careers.options());
  app.post("/api/careers", async (req, reply) => reply.code(201).send(ctx.careers.create(req.body)));
  app.get("/api/careers/:id", async (req) => ctx.careers.get(id.parse(req.params).id));
  // Suppression ouverte à tous (confirmée dans l'interface) : elle n'efface ni matchs ni statistiques.
  app.delete("/api/careers/:id", async (req) => ctx.careers.delete(id.parse(req.params).id));

  /** Lance (ou retrouve) le match à jouer ; avec Autodarts, la partie est liée à la cible. */
  app.post("/api/careers/:id/play", async (req) => {
    const { inputMode } = z.object({ inputMode: z.enum(["manual", "autodarts"]).default("manual") }).parse(req.body ?? {});
    const result = ctx.careers.play(id.parse(req.params).id, inputMode);
    const snapshot = ctx.matches.get(result.matchId);
    if (snapshot.match.status === "active" && snapshot.match.inputMode === "autodarts") ctx.autodarts.bind(result.matchId);
    return result;
  });
  app.post("/api/careers/:id/continue", async (req) => ctx.careers.continue(id.parse(req.params).id));

  app.get("/api/careers/:id/rankings", async (req) => {
    const q = z.object({ category: z.enum(["pdc", "protour", "eurotour", "pc", "ws", "challenge", "wdf"]).default("pdc") }).parse(req.query);
    return ctx.careers.rankings(id.parse(req.params).id, q.category);
  });
  app.get("/api/careers/:id/players", async (req) => ctx.careers.circuit(id.parse(req.params).id));
  app.patch("/api/careers/:id/players/:playerId", async (req) => {
    const p = z.object({ id: z.string().uuid(), playerId: z.string().regex(/^p\d{1,5}$/) }).parse(req.params);
    return ctx.careers.renamePlayer(p.id, p.playerId, req.body);
  });
  app.get("/api/careers/:id/history", async (req) => ctx.careers.history(id.parse(req.params).id));
}

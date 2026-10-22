import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, type AppContext } from "../context.js";
import { StatsFilter } from "../services/stats.js";

const id = z.object({ id: z.string().uuid() });

/** Statistiques, accueil, entraînements, objectifs, compétitions. */
export function registerDataRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = requireAdmin(ctx);

  // ---------- Statistiques ----------
  app.get("/api/stats/summary", async (req) => ctx.stats.summary(StatsFilter.parse(req.query)));
  app.get("/api/stats/series", async (req) => {
    const q = StatsFilter.extend({ granularity: z.enum(["day", "week", "month"]).default("day") }).parse(req.query);
    return ctx.stats.series(q, q.granularity);
  });
  app.get("/api/stats/calendar", async (req) => ctx.stats.calendar(StatsFilter.parse(req.query)));
  app.get("/api/stats/compare", async (req) => {
    const q = StatsFilter.extend({
      aFrom: z.string().max(40).optional(),
      aTo: z.string().max(40).optional(),
      bFrom: z.string().max(40).optional(),
      bTo: z.string().max(40).optional(),
    }).parse(req.query);
    return ctx.stats.compare(q, { from: q.aFrom, to: q.aTo }, { from: q.bFrom, to: q.bTo });
  });
  app.get("/api/stats/leaderboard", async (req) => ctx.stats.leaderboard(StatsFilter.omit({ playerId: true }).parse(req.query)));
  app.get("/api/stats/head-to-head", async (req) => {
    const q = z.object({ a: z.string().uuid(), b: z.string().uuid() }).parse(req.query);
    return ctx.stats.headToHead(q.a, q.b);
  });

  /** Tableau de bord de la page d'accueil pour le profil actif. */
  app.get("/api/home", async (req) => {
    const q = z.object({ playerId: z.string().uuid().optional() }).parse(req.query);
    const general = ctx.settings.general();
    let playerId = q.playerId ?? general.activePlayerId ?? null;
    if (playerId) {
      try {
        if (ctx.players.get(playerId).archivedAt) playerId = null;
      } catch {
        playerId = null;
      }
    }
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    return {
      player: playerId ? ctx.players.get(playerId) : null,
      stats: playerId ? ctx.stats.summary({ playerId }) : null,
      progression: playerId ? ctx.stats.series({ playerId, from: since }, "day").series : [],
      recent: ctx.matches.list({ playerId: playerId ?? undefined, limit: 6 }).items,
      active: ctx.matches.list({ status: "active", limit: 10, includeSimulation: true }).items,
      autodarts: ctx.autodarts.overview(),
    };
  });

  // ---------- Entraînements ----------
  app.get("/api/exercises", async () => ctx.training.exercises());
  app.post("/api/exercises", async (req, reply) => reply.code(201).send(ctx.training.createExercise(req.body)));
  app.delete("/api/exercises/:id", async (req, reply) => {
    ctx.training.deleteExercise(id.parse(req.params).id);
    return reply.code(204).send();
  });
  app.get("/api/goals", async (req) => ctx.training.goals(z.object({ playerId: z.string().uuid() }).parse(req.query).playerId));
  app.post("/api/goals", async (req, reply) => reply.code(201).send(ctx.training.createGoal(req.body)));
  app.delete("/api/goals/:id", async (req, reply) => {
    ctx.training.deleteGoal(id.parse(req.params).id);
    return reply.code(204).send();
  });

  // ---------- Compétitions ----------
  app.get("/api/competitions", async () => ctx.competitions.list());
  app.post("/api/competitions", async (req, reply) => reply.code(201).send(ctx.competitions.create(req.body)));
  app.get("/api/competitions/:id", async (req) => ctx.competitions.get(id.parse(req.params).id));
  app.post("/api/competitions/:id/fixtures/:fixtureId/start", async (req) => {
    const p = z.object({ id: z.string().uuid(), fixtureId: z.string().uuid() }).parse(req.params);
    const body = z.object({ inputMode: z.enum(["manual", "autodarts"]).default("manual") }).parse(req.body ?? {});
    const isSimulation = body.inputMode === "autodarts" && ctx.autodarts.simulationActive;
    const snapshot = ctx.competitions.startFixture(p.id, p.fixtureId, body.inputMode, isSimulation);
    if (body.inputMode === "autodarts") ctx.autodarts.bind(snapshot.match.id);
    return snapshot;
  });
  app.post("/api/competitions/:id/fixtures/:fixtureId/result", async (req) => {
    const p = z.object({ id: z.string().uuid(), fixtureId: z.string().uuid() }).parse(req.params);
    return ctx.competitions.setManualResult(p.id, p.fixtureId, req.body);
  });
  app.get("/api/competitions/:id/export.csv", async (req, reply) => {
    const compId = id.parse(req.params).id;
    const csv = ctx.competitions.exportCsv(compId);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="classement-${compId.slice(0, 8)}.csv"`)
      .send(`﻿${csv}`);
  });
  app.delete("/api/competitions/:id", { preHandler: admin }, async (req, reply) => {
    ctx.competitions.delete(id.parse(req.params).id);
    return reply.code(204).send();
  });
}

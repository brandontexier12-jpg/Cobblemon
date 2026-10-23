import { MODES, OPTION_SCHEMAS, suggestCheckouts, type GameModeId } from "@darts-evolution/game-engine";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, SESSION_COOKIE, type AppContext } from "../context.js";
import { badRequest, unauthorized } from "../errors.js";
import { CommandInput } from "../services/matches.js";

const id = z.object({ id: z.string().uuid() });

function defaultsOf(mode: GameModeId): unknown {
  const schema = OPTION_SCHEMAS[mode];
  const r = schema.safeParse({});
  return r.success ? r.data : null;
}

/** Joueurs, modes, parties, checkout. */
export function registerGameRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = requireAdmin(ctx);

  // ---------- Joueurs ----------
  app.get("/api/players", async (req) => {
    const q = z.object({ archived: z.coerce.boolean().optional(), guests: z.coerce.boolean().optional() }).parse(req.query);
    return ctx.players.list({ includeArchived: q.archived, includeGuests: q.guests });
  });
  app.post("/api/players", async (req, reply) => reply.code(201).send(ctx.players.create(req.body)));
  app.post("/api/players/guest", async (req, reply) => {
    const body = z.object({ name: z.string().max(32).optional() }).parse(req.body ?? {});
    return reply.code(201).send(ctx.players.createGuest(body.name));
  });
  // ---------- Bots (adversaires virtuels, créés à la première utilisation) ----------
  app.get("/api/bots", async () => ctx.players.botLevels());
  app.post("/api/bots/:average", async (req) => {
    const { average } = z.object({ average: z.coerce.number().int() }).parse(req.params);
    return ctx.players.bot(average);
  });
  app.get("/api/players/:id", async (req) => ctx.players.get(id.parse(req.params).id));

  // Photo de profil : image envoyée telle quelle (déjà recadrée et réduite par l'application).
  app.get("/api/players/:id/photo", async (req, reply) => {
    const photo = ctx.players.photo(id.parse(req.params).id);
    // L'adresse change à chaque nouvelle photo (?v=…) : le navigateur peut la garder en cache.
    return reply.header("content-type", photo.mime).header("cache-control", "private, max-age=31536000, immutable").send(Buffer.from(photo.data));
  });
  app.post("/api/players/:id/photo", { bodyLimit: 3 * 1024 * 1024 }, async (req) => {
    if (!Buffer.isBuffer(req.body)) throw badRequest("Envoyez l'image en application/octet-stream.");
    const player = ctx.players.setPhoto(id.parse(req.params).id, req.body);
    ctx.matches.clearCache(); // les parties en cours affichent la nouvelle photo
    return player;
  });
  app.delete("/api/players/:id/photo", async (req) => {
    const player = ctx.players.removePhoto(id.parse(req.params).id);
    ctx.matches.clearCache();
    return player;
  });
  app.patch("/api/players/:id", async (req) => ctx.players.update(id.parse(req.params).id, req.body));
  app.delete("/api/players/:id", async (req) => {
    const q = z.object({ permanent: z.coerce.boolean().optional() }).parse(req.query);
    if (q.permanent && !ctx.auth.isAdmin(req.cookies[SESSION_COOKIE])) throw unauthorized();
    return ctx.players.remove(id.parse(req.params).id, q.permanent);
  });
  app.post("/api/players/:id/restore", async (req) => ctx.players.restore(id.parse(req.params).id));

  // ---------- Modes de jeu ----------
  app.get("/api/modes", async () => MODES.map((m) => ({ ...m, defaults: defaultsOf(m.id) })));

  app.get("/api/checkout", async (req) => {
    const q = z
      .object({
        score: z.coerce.number().int().min(1).max(180),
        outRule: z.enum(["single", "double", "master"]).default("double"),
        dartsLeft: z.coerce.number().int().min(1).max(3).default(3),
        strategy: z.enum(["classique", "bull", "double_favori"]).optional(),
        favoriteDouble: z.coerce.number().int().optional(),
        limit: z.coerce.number().int().min(1).max(10).default(5),
      })
      .parse(req.query);
    const routes = suggestCheckouts(q.score, { ...q, strategy: q.strategy ?? ctx.settings.general().checkoutStrategy });
    return { score: q.score, possible: routes.length > 0, routes: routes.map((r) => r.display) };
  });

  // ---------- Parties ----------
  app.post("/api/matches", async (req, reply) => {
    const body = z.object({ inputMode: z.enum(["manual", "autodarts"]).default("manual") }).passthrough().parse(req.body ?? {});
    const isSimulation = body.inputMode === "autodarts" && ctx.autodarts.simulationActive;
    const snapshot = ctx.matches.create(req.body, { isSimulation });
    if (body.inputMode === "autodarts") ctx.autodarts.bind(snapshot.match.id);
    return reply.code(201).send(snapshot);
  });

  app.get("/api/matches", async (req) => {
    const q = z
      .object({
        status: z.enum(["active", "finished", "abandoned"]).optional(),
        hideAbandoned: z.coerce.boolean().optional(),
        playerId: z.string().uuid().optional(),
        mode: z.string().max(40).optional(),
        category: z.enum(["game", "training"]).optional(),
        from: z.string().max(40).optional(),
        to: z.string().max(40).optional(),
        simulation: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(req.query);
    return ctx.matches.list({ ...q, includeSimulation: q.simulation });
  });

  app.get("/api/matches/:id", async (req) => ctx.matches.get(id.parse(req.params).id));
  app.get("/api/matches/:id/visits", async (req) => ctx.matches.visits(id.parse(req.params).id));
  app.get("/api/rooms/:code", async (req) => {
    const { code } = z.object({ code: z.string().trim().min(4).max(8) }).parse(req.params);
    return ctx.matches.getByRoomCode(code);
  });

  app.post("/api/matches/:id/commands", async (req) => {
    const matchId = id.parse(req.params).id;
    const command = CommandInput.parse(req.body);
    return ctx.matches.command(matchId, { ...command, source: "manual" });
  });

  app.post("/api/matches/:id/input-mode", async (req) => {
    const matchId = id.parse(req.params).id;
    const { mode } = z.object({ mode: z.enum(["manual", "autodarts"]) }).parse(req.body);
    const snapshot = ctx.matches.setInputMode(matchId, mode);
    if (mode === "autodarts" && snapshot.match.status === "active") ctx.autodarts.bind(matchId);
    else if (ctx.autodarts.boundMatchId === matchId) ctx.autodarts.bind(null);
    return snapshot;
  });

  /**
   * Quitter une partie sans la terminer (« garder pour plus tard ») : elle reste en cours mais n'est
   * plus liée à Autodarts, pour que la cible n'alimente pas une partie que personne ne regarde.
   */
  app.post("/api/matches/:id/leave", async (req) => {
    const snapshot = ctx.matches.get(id.parse(req.params).id);
    if (ctx.autodarts.boundMatchId === snapshot.match.id) ctx.autodarts.bind(null);
    return snapshot;
  });

  /** Reprendre une partie interrompue : la relie à nouveau à Autodarts si elle était en détection automatique. */
  app.post("/api/matches/:id/resume", async (req) => {
    const snapshot = ctx.matches.get(id.parse(req.params).id);
    if (snapshot.match.status === "active" && snapshot.match.inputMode === "autodarts") ctx.autodarts.bind(snapshot.match.id);
    return snapshot;
  });

  app.delete("/api/matches/:id", { preHandler: admin }, async (req, reply) => {
    ctx.matches.delete(id.parse(req.params).id);
    return reply.code(204).send();
  });
}

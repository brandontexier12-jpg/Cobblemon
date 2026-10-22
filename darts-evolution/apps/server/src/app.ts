import { existsSync } from "node:fs";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import type { AdapterLogger } from "@darts-evolution/autodarts-adapter";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import type { Server as IoServer } from "socket.io";
import { ZodError } from "zod";
import type { AppConfig } from "./config.js";
import type { AppContext } from "./context.js";
import { Database } from "./db/database.js";
import { AppError } from "./errors.js";
import { attachRealtime } from "./http/realtime.js";
import { registerAdminRoutes } from "./http/routes-admin.js";
import { registerDataRoutes } from "./http/routes-data.js";
import { registerGameRoutes } from "./http/routes-game.js";
import { installFrenchErrors } from "./http/zod-fr.js";
import { AuthService } from "./services/auth.js";
import { AutodartsService } from "./services/autodarts.js";
import { BackupService } from "./services/backups.js";
import { CompetitionService } from "./services/competitions.js";
import { ExportService } from "./services/export.js";
import { MatchService } from "./services/matches.js";
import { PlayerService } from "./services/players.js";
import { SettingsService } from "./services/settings.js";
import { StatsService } from "./services/stats.js";
import { TrainingService } from "./services/training.js";
import { UpdateService } from "./services/updates.js";
import { BotService, DEFAULT_BOT_TIMING, type BotTiming } from "./services/bots.js";
import { VoiceService } from "./services/voices.js";
import { registerVoiceRoutes } from "./http/routes-voices.js";
import { registerUpdateRoutes } from "./http/routes-update.js";
import { registerCareerRoutes } from "./http/routes-career.js";
import { CareerService } from "./services/careers.js";

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
  io: IoServer;
  /** Démarre l'écoute réseau, la connexion Autodarts et la planification des sauvegardes. */
  listen(): Promise<string>;
  close(): Promise<void>;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export interface BuildOptions {
  logger?: boolean;
  /** Redémarrage demandé (mise à jour installée) : le lanceur relance le serveur. */
  onRestartRequested?: () => void;
  /** Rythme des bots (accéléré dans les tests). */
  botTiming?: BotTiming;
}

export async function buildApp(config: AppConfig, options: BuildOptions = {}): Promise<BuiltApp> {
  installFrenchErrors();
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            // Jamais de cookie de session ni d'en-tête d'autorisation dans les journaux.
            redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
          },
    bodyLimit: 1024 * 1024,
    // Journal de chaque requête uniquement en mode debug (sinon trop bavard pour un NAS).
    logController: new LogController({ disableRequestLogging: config.logLevel !== "debug" && config.logLevel !== "trace" }),
  });

  const log: AdapterLogger = {
    debug: (msg, meta) => app.log.debug(meta ?? {}, msg),
    info: (msg, meta) => app.log.info(meta ?? {}, msg),
    warn: (msg, meta) => app.log.warn(meta ?? {}, msg),
    error: (msg, meta) => app.log.error(meta ?? {}, msg),
  };

  // ---------- Base de données et migrations (sauvegarde automatique avant migration) ----------
  const db = new Database(config.databasePath);
  const backups = new BackupService(db, config.backupPath);
  const applied = db.migrate((from, to) => {
    const file = backups.create("pre-migration");
    app.log.info({ from, to, backup: file.name }, "Sauvegarde avant migration du schéma.");
  });
  if (applied.length) app.log.info({ applied }, "Migrations appliquées.");

  const settings = new SettingsService(db, {
    autodarts: config.autodarts,
    backup: { intervalHours: config.backupIntervalHours, retention: config.backupRetention },
  });
  const players = new PlayerService(db);
  const matches = new MatchService(db, players);
  const stats = new StatsService(db, players);
  const competitions = new CompetitionService(db, players, matches);
  const autodarts = new AutodartsService(db, settings, matches, log);
  const training = new TrainingService(db, players, stats);
  const bots = new BotService(matches, log, options.botTiming ?? DEFAULT_BOT_TIMING);
  const careers = new CareerService(db, players, matches, (playerId) => stats.summary({ playerId }).summary.x01.average3);
  const exportsService = new ExportService(db, config.version);
  const auth = new AuthService(config.adminPassword, config.sessionHours);
  const updates = new UpdateService(config, backups, () => auth.enabled, () => {
    app.log.info("Redémarrage pour terminer la mise à jour…");
    options.onRestartRequested?.();
  });

  matches.hooks = {
    onFinished: (snapshot, state) => {
      competitions.onMatchFinished(snapshot, (state.m as { totalLegsWon?: number[] }).totalLegsWon);
      careers.onMatchFinished(snapshot, state);
    },
    onReopened: (matchId) => {
      careers.onMatchReopened(matchId);
      competitions.onMatchReopened(matchId);
    },
  };

  const ctx: AppContext = {
    config,
    db,
    players,
    matches,
    stats,
    settings,
    auth,
    backups,
    competitions,
    autodarts,
    training,
    exports: exportsService,
    updates,
    bots,
    careers,
    voices: new VoiceService(config.voicesPath),
    startedAt: Date.now(),
    runScheduledBackup() {
      const { intervalHours, retention } = settings.backup();
      if (intervalHours <= 0) return;
      const last = settings.lastBackupAt();
      if (last && Date.now() - Date.parse(last) < intervalHours * 3600_000) return;
      const hasData = (db.get<{ n: number }>("SELECT COUNT(*) AS n FROM players")?.n ?? 0) > 0;
      if (!hasData) return;
      const file = backups.create("auto");
      settings.setLastBackupAt(new Date().toISOString());
      const removed = backups.prune(retention);
      app.log.info({ backup: file.name, removed }, "Sauvegarde automatique effectuée.");
    },
    async reloadAfterRestore() {
      db.migrate();
      matches.clearCache();
      await autodarts.stop();
      await autodarts.start();
      app.log.warn("Base restaurée depuis une sauvegarde.");
    },
  };

  // ---------- HTTP ----------
  await app.register(fastifyCookie);
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: 512 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header("Referrer-Policy", "same-origin");
    const type = String(reply.getHeader("content-type") ?? "");
    if (type.includes("text/html")) reply.header("Content-Security-Policy", CSP);
    if (request.url.startsWith("/api/") && !reply.getHeader("cache-control")) reply.header("Cache-Control", "no-store");
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
      return reply.code(400).send({ error: "validation", message: `${issue?.message ?? "Requête invalide."}${where}` });
    }
    if (error instanceof AppError) return reply.code(error.status).send({ error: error.code, message: error.message });
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 413) return reply.code(413).send({ error: "too_large", message: "Fichier ou requête trop volumineux." });
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: "bad_request", message: "Requête invalide." });
    }
    request.log.error({ err: error }, "Erreur interne");
    return reply.code(500).send({ error: "internal", message: "Erreur interne du serveur." });
  });

  registerAdminRoutes(app, ctx);
  registerGameRoutes(app, ctx);
  registerDataRoutes(app, ctx);
  registerUpdateRoutes(app, ctx);
  registerVoiceRoutes(app, ctx);
  registerCareerRoutes(app, ctx);

  // ---------- Interface web (fichiers construits par Vite) ----------
  const webDist = config.webDistPath ?? path.resolve(process.cwd(), "apps/web/dist");
  const hasWeb = existsSync(path.join(webDist, "index.html"));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: webDist, maxAge: "1h" });
  }
  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api/") && !request.url.startsWith("/socket.io") && hasWeb) {
      return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-cache").sendFile("index.html");
    }
    return reply.code(404).send({ error: "not_found", message: "Ressource introuvable." });
  });

  await app.ready();
  const io = attachRealtime(app.server, ctx);

  let backupTimer: NodeJS.Timeout | null = null;
  return {
    app,
    ctx,
    io,
    async listen() {
      const address = await app.listen({ port: config.port, host: config.host });
      await autodarts.start();
      bots.start();
      backupTimer = setInterval(() => {
        try {
          ctx.runScheduledBackup();
        } catch (error) {
          app.log.error({ err: error }, "Échec de la sauvegarde automatique.");
        }
      }, 5 * 60_000);
      backupTimer.unref();
      if (!hasWeb) app.log.warn({ webDist }, "Interface web introuvable : seule l'API est servie.");
      if (!auth.enabled) app.log.warn("ADMIN_PASSWORD non défini : les actions d'administration ne sont pas protégées.");
      return address;
    },
    async close() {
      if (backupTimer) clearInterval(backupTimer);
      bots.stop();
      await autodarts.stop();
      io.close();
      await app.close();
      db.close();
    },
  };
}

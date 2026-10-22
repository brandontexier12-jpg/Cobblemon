import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, SESSION_COOKIE, type AppContext } from "../context.js";
import { MIGRATIONS } from "../db/migrations.js";
import { badRequest } from "../errors.js";
import { BackupSettings, GeneralSettings } from "../services/settings.js";

/** Santé, authentification, réglages, sauvegardes, exports, Autodarts. */
export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = requireAdmin(ctx);

  app.get("/api/health", async (_req, reply) => {
    let database = "ok";
    try {
      ctx.db.get("SELECT 1");
    } catch {
      database = "erreur";
    }
    const body = {
      status: database === "ok" ? "ok" : "degraded",
      version: ctx.config.version,
      uptimeSeconds: Math.round((Date.now() - ctx.startedAt) / 1000),
      database,
      schemaVersion: ctx.db.currentVersion(),
      autodarts: ctx.autodarts.overview().status.state,
      time: new Date().toISOString(),
    };
    return reply.code(database === "ok" ? 200 : 503).send(body);
  });

  // ---------- Authentification ----------
  app.get("/api/auth/status", async (req) => ({
    adminConfigured: ctx.auth.enabled,
    isAdmin: ctx.auth.isAdmin(req.cookies[SESSION_COOKIE]),
  }));

  app.post("/api/auth/login", async (req, reply) => {
    const { password } = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
    const session = ctx.auth.login(password, req.ip);
    reply.setCookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.protocol === "https",
      path: "/",
      expires: new Date(session.expiresAt),
    });
    return { isAdmin: true, expiresAt: session.expiresAt };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    ctx.auth.logout(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { isAdmin: false };
  });

  // ---------- Réglages ----------
  app.get("/api/settings", async () => ({
    general: ctx.settings.general(),
    backup: { ...ctx.settings.backup(), lastBackupAt: ctx.settings.lastBackupAt(), path: ctx.config.backupPath },
    adminConfigured: ctx.auth.enabled,
    version: ctx.config.version,
    schemaVersion: ctx.db.currentVersion(),
  }));

  // Le profil actif et la stratégie de checkout sont des préférences d'usage courant.
  app.put("/api/settings/general", async (req) => ctx.settings.setGeneral(GeneralSettings.partial().parse(req.body)));
  app.put("/api/settings/backup", { preHandler: admin }, async (req) => ctx.settings.setBackup(BackupSettings.partial().parse(req.body)));

  // ---------- Sauvegardes ----------
  app.get("/api/backups", { preHandler: admin }, async () => ctx.backups.list());
  app.post("/api/backups", { preHandler: admin }, async (_req, reply) => reply.code(201).send(ctx.backups.create("manuelle")));
  app.get("/api/backups/:name", { preHandler: admin }, async (req, reply) => {
    const { name } = z.object({ name: z.string().max(120) }).parse(req.params);
    const file = ctx.backups.file(name);
    return reply
      .header("content-type", "application/vnd.sqlite3")
      .header("content-disposition", `attachment; filename="${name}"`)
      .send(createReadStream(file));
  });
  app.delete("/api/backups/:name", { preHandler: admin }, async (req, reply) => {
    const { name } = z.object({ name: z.string().max(120) }).parse(req.params);
    ctx.backups.delete(name);
    return reply.code(204).send();
  });

  const maxSchema = MIGRATIONS[MIGRATIONS.length - 1]!.version;

  app.post("/api/backups/:name/restore", { preHandler: admin }, async (req) => {
    const { name } = z.object({ name: z.string().max(120) }).parse(req.params);
    const result = ctx.backups.restore({ name }, maxSchema);
    await ctx.reloadAfterRestore();
    return result;
  });

  app.post("/api/backups/upload-restore", { preHandler: admin, bodyLimit: 512 * 1024 * 1024 }, async (req) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) throw badRequest("Envoyez le fichier de sauvegarde (.db) en application/octet-stream.");
    const result = ctx.backups.restore({ data: req.body }, maxSchema);
    await ctx.reloadAfterRestore();
    return result;
  });

  // ---------- Exports ----------
  app.get("/api/export/json", { preHandler: admin }, async (_req, reply) => {
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header("content-disposition", `attachment; filename="darts-evolution-export-${stamp}.json"`)
      .send(JSON.stringify(ctx.exports.json(), null, 2));
  });
  app.get("/api/export/csv", async () => ctx.exports.csvTables());
  app.get("/api/export/csv/:table", async (req, reply) => {
    const { table } = z.object({ table: z.string().max(40) }).parse(req.params);
    const csv = ctx.exports.csv(table);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="darts-evolution-${table}.csv"`)
      .send(`﻿${csv}`);
  });

  // ---------- Autodarts ----------
  app.get("/api/autodarts", async () => ctx.autodarts.overview());
  app.put("/api/autodarts/config", { preHandler: admin }, async (req) => {
    const body = z
      .object({
        enabled: z.boolean().optional(),
        host: z.string().trim().max(253).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        protocol: z.enum(["http", "https"]).optional(),
      })
      .strict()
      .parse(req.body);
    return ctx.autodarts.applySettings(body);
  });
  app.post("/api/autodarts/test", { preHandler: admin }, async (req) => {
    const body = z
      .object({ host: z.string().trim().max(253).optional(), port: z.number().int().min(1).max(65535).optional(), protocol: z.enum(["http", "https"]).optional() })
      .parse(req.body ?? {});
    return ctx.autodarts.test(body);
  });
  app.get("/api/autodarts/journal", async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(100) }).parse(req.query);
    return ctx.autodarts.journalList(q.limit);
  });
  app.post("/api/autodarts/reset-board", async () => {
    await ctx.autodarts.resetBoard();
    return { ok: true };
  });
  // Calibration automatique des caméras (toutes, ou une seule avec « camera »).
  app.post("/api/autodarts/calibrate", async (req) => {
    const { camera } = z.object({ camera: z.number().int().min(0).max(7).optional() }).parse(req.body ?? {});
    return ctx.autodarts.calibrate(camera);
  });
  app.get("/api/autodarts/cameras", async () => ({ count: await ctx.autodarts.cameraCount() }));
  app.post("/api/autodarts/bind", async (req) => {
    const { matchId } = z.object({ matchId: z.string().uuid().nullable() }).parse(req.body);
    if (matchId) {
      const snapshot = ctx.matches.get(matchId);
      if (snapshot.match.status !== "active") throw badRequest("Seule une partie en cours peut être liée à Autodarts.");
      if (snapshot.match.inputMode !== "autodarts") ctx.matches.setInputMode(matchId, "autodarts");
    }
    ctx.autodarts.bind(matchId);
    return ctx.autodarts.overview();
  });

  // ---------- Mode test (simulation clairement identifiée) ----------
  app.post("/api/autodarts/simulation/start", { preHandler: admin }, async () => ctx.autodarts.startSimulation());
  app.post("/api/autodarts/simulation/stop", { preHandler: admin }, async () => ctx.autodarts.stopSimulation());
  app.post("/api/autodarts/simulation/action", async (req) => {
    const sim = ctx.autodarts.simulatorInstance;
    if (!sim) throw badRequest("Le mode test n'est pas actif.");
    const body = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("throw"), dart: z.string().max(8), bouncer: z.boolean().optional() }),
        z.object({ action: z.literal("correct"), slot: z.number().int().min(0).max(5), dart: z.string().max(8) }),
        z.object({ action: z.literal("takeout") }),
        z.object({ action: z.literal("reset") }),
        z.object({ action: z.literal("disconnect") }),
        z.object({ action: z.literal("duplicate") }),
        z.object({ action: z.literal("invalid") }),
        z.object({ action: z.literal("stop-detection") }),
        z.object({ action: z.literal("start-detection") }),
      ])
      .parse(req.body);
    try {
      switch (body.action) {
        case "throw":
          sim.throwDart(body.dart, { bouncer: body.bouncer });
          break;
        case "correct":
          sim.correctDart(body.slot, body.dart);
          break;
        case "takeout":
          sim.takeout();
          break;
        case "reset":
          sim.manualReset();
          break;
        case "disconnect":
          sim.dropConnections();
          break;
        case "duplicate":
          sim.repeatLastMessage();
          break;
        case "invalid":
          sim.sendRaw(JSON.stringify({ type: "state", data: { running: "invalide", throws: "?" } }));
          break;
        case "stop-detection":
          sim.stopDetection();
          break;
        case "start-detection":
          sim.startDetection();
          break;
      }
    } catch (error) {
      throw badRequest((error as Error).message);
    }
    return { ok: true, board: sim.snapshot };
  });
}

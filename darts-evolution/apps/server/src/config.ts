import path from "node:path";
import { z } from "zod";
import { releasesPath } from "./update/releases.js";
import { BUNDLED_VERSION } from "./version.js";

const bool = z
  .string()
  .optional()
  .transform((v) => ["1", "true", "yes", "oui", "on"].includes((v ?? "").trim().toLowerCase()));

const EnvSchema = z.object({
  APP_PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  APP_HOST: z.string().default("0.0.0.0"),
  DATABASE_PATH: z.string().default("./data/darts-evolution.db"),
  BACKUP_PATH: z.string().default("./backups"),
  BACKUP_INTERVAL_HOURS: z.coerce.number().min(0).max(24 * 30).default(24),
  BACKUP_RETENTION: z.coerce.number().int().min(1).max(1000).default(14),
  ADMIN_PASSWORD: z.string().optional(),
  AUTODARTS_ENABLED: bool,
  AUTODARTS_HOST: z.string().optional(),
  AUTODARTS_PORT: z.coerce.number().int().min(1).max(65535).default(3180),
  AUTODARTS_PROTOCOL: z.enum(["http", "https"]).default("http"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  WEB_DIST_PATH: z.string().optional(),
  SESSION_HOURS: z.coerce.number().min(1).max(24 * 30).default(12),
});

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  backupPath: string;
  backupIntervalHours: number;
  backupRetention: number;
  adminPassword: string | null;
  autodarts: { enabled: boolean; host: string; port: number; protocol: "http" | "https" };
  logLevel: z.infer<typeof EnvSchema>["LOG_LEVEL"];
  webDistPath: string | null;
  sessionHours: number;
  version: string;
  /** Packs de voix importés (dans le volume de données). */
  voicesPath: string;
  /** Mise à jour depuis l'application (versions installées dans le volume de données). */
  update: {
    /** Le serveur tourne sous le lanceur superviseur du conteneur (redémarrage possible). */
    supervised: boolean;
    supervisorProtocol: number;
    releasesPath: string;
    builtinVersion: string;
    running: "builtin" | "installed";
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Configuration invalide : ${issue?.path.join(".")} — ${issue?.message}`);
  }
  const e = parsed.data;
  // La version assemblée fait foi (une ancienne variable APP_VERSION ne doit pas la masquer).
  const version = BUNDLED_VERSION ?? env.APP_VERSION ?? "0.0.0-dev";
  return {
    port: e.APP_PORT,
    host: e.APP_HOST,
    databasePath: path.resolve(e.DATABASE_PATH),
    backupPath: path.resolve(e.BACKUP_PATH),
    backupIntervalHours: e.BACKUP_INTERVAL_HOURS,
    backupRetention: e.BACKUP_RETENTION,
    adminPassword: e.ADMIN_PASSWORD && e.ADMIN_PASSWORD.length > 0 ? e.ADMIN_PASSWORD : null,
    autodarts: {
      enabled: e.AUTODARTS_ENABLED,
      host: (e.AUTODARTS_HOST ?? "").trim(),
      port: e.AUTODARTS_PORT,
      protocol: e.AUTODARTS_PROTOCOL,
    },
    logLevel: e.LOG_LEVEL,
    webDistPath: e.WEB_DIST_PATH ? path.resolve(e.WEB_DIST_PATH) : null,
    sessionHours: e.SESSION_HOURS,
    version,
    voicesPath: path.join(path.dirname(path.resolve(e.DATABASE_PATH)), "voices"),
    update: {
      supervised: env.DE_SUPERVISED === "1",
      supervisorProtocol: Number(env.DE_SUPERVISOR_PROTOCOL ?? 0) || 0,
      releasesPath: releasesPath(env),
      builtinVersion: env.DE_BUILTIN_VERSION ?? version,
      running: env.DE_RUNNING === "installed" ? "installed" : "builtin",
    },
  };
}

import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/database.js";
import { unauthorized } from "./errors.js";
import type { AuthService } from "./services/auth.js";
import type { AutodartsService } from "./services/autodarts.js";
import type { BackupService } from "./services/backups.js";
import type { CompetitionService } from "./services/competitions.js";
import type { ExportService } from "./services/export.js";
import type { MatchService } from "./services/matches.js";
import type { PlayerService } from "./services/players.js";
import type { SettingsService } from "./services/settings.js";
import type { StatsService } from "./services/stats.js";
import type { TrainingService } from "./services/training.js";
import type { UpdateService } from "./services/updates.js";
import type { BotService } from "./services/bots.js";
import type { VoiceService } from "./services/voices.js";

export interface AppContext {
  config: AppConfig;
  db: Database;
  players: PlayerService;
  matches: MatchService;
  stats: StatsService;
  settings: SettingsService;
  auth: AuthService;
  backups: BackupService;
  competitions: CompetitionService;
  autodarts: AutodartsService;
  training: TrainingService;
  exports: ExportService;
  updates: UpdateService;
  bots: BotService;
  voices: VoiceService;
  startedAt: number;
  /** Prochaine sauvegarde automatique (vérification périodique). */
  runScheduledBackup(): void;
  /** Recharge tout ce qui dépend du contenu de la base (après restauration). */
  reloadAfterRestore(): Promise<void>;
}

export const SESSION_COOKIE = "de_session";

export function requireAdmin(ctx: AppContext) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!ctx.auth.isAdmin(request.cookies[SESSION_COOKIE])) throw unauthorized();
  };
}

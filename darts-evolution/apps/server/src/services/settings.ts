import { z } from "zod";
import { nowIso, parseJson, type Database } from "../db/database.js";

export const AutodartsSettings = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(253),
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(["http", "https"]),
});

export const BackupSettings = z.object({
  intervalHours: z.number().min(0).max(24 * 30),
  retention: z.number().int().min(1).max(1000),
});

export const GeneralSettings = z.object({
  checkoutStrategy: z.enum(["classique", "bull", "double_favori"]),
  activePlayerId: z.string().uuid().nullable(),
});

export type AutodartsSettings = z.infer<typeof AutodartsSettings>;
export type BackupSettings = z.infer<typeof BackupSettings>;
export type GeneralSettings = z.infer<typeof GeneralSettings>;

/**
 * Réglages persistants. Les variables d'environnement fournissent les valeurs par défaut ;
 * une valeur enregistrée depuis l'interface les remplace ensuite.
 */
export class SettingsService {
  constructor(
    private readonly db: Database,
    private readonly defaults: { autodarts: AutodartsSettings; backup: BackupSettings },
  ) {}

  private read<T>(key: string): T | null {
    const row = this.db.get<{ value: string }>("SELECT value FROM settings WHERE key = $k", { $k: key });
    return row ? parseJson<T | null>(row.value, null) : null;
  }

  private write(key: string, value: unknown): void {
    this.db.run(
      "INSERT INTO settings (key, value, updated_at) VALUES ($k, $v, $at) ON CONFLICT(key) DO UPDATE SET value = $v, updated_at = $at",
      { $k: key, $v: JSON.stringify(value), $at: nowIso() },
    );
  }

  autodarts(): AutodartsSettings {
    const saved = AutodartsSettings.partial().safeParse(this.read("autodarts") ?? {});
    return { ...this.defaults.autodarts, ...(saved.success ? saved.data : {}) };
  }

  setAutodarts(input: unknown): AutodartsSettings {
    const value = AutodartsSettings.parse({ ...this.autodarts(), ...(input as object) });
    this.write("autodarts", value);
    return value;
  }

  backup(): BackupSettings {
    const saved = BackupSettings.partial().safeParse(this.read("backup") ?? {});
    return { ...this.defaults.backup, ...(saved.success ? saved.data : {}) };
  }

  setBackup(input: unknown): BackupSettings {
    const value = BackupSettings.parse({ ...this.backup(), ...(input as object) });
    this.write("backup", value);
    return value;
  }

  general(): GeneralSettings {
    const saved = GeneralSettings.partial().safeParse(this.read("general") ?? {});
    return { checkoutStrategy: "classique", activePlayerId: null, ...(saved.success ? saved.data : {}) };
  }

  setGeneral(input: unknown): GeneralSettings {
    const value = GeneralSettings.parse({ ...this.general(), ...(input as object) });
    this.write("general", value);
    return value;
  }

  /** Partie actuellement liée à la détection Autodarts (survit à un redémarrage). */
  boundMatchId(): string | null {
    return this.read<string>("autodarts.boundMatch");
  }

  setBoundMatchId(id: string | null): void {
    this.write("autodarts.boundMatch", id);
  }

  lastBackupAt(): string | null {
    return this.read<string>("backup.last");
  }

  setLastBackupAt(at: string): void {
    this.write("backup.last", at);
  }
}

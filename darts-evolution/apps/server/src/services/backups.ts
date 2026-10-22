import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Database } from "../db/database.js";
import { badRequest, notFound } from "../errors.js";

export type BackupReason = "auto" | "manuelle" | "pre-migration" | "pre-restauration" | "pre-mise-a-jour";

export interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
  reason: BackupReason | "inconnue";
}

const NAME = /^darts-evolution-(\d{8}-\d{6})-(auto|manuelle|pre-migration|pre-restauration|pre-mise-a-jour)(?:-\d+)?\.db$/;

function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/**
 * Sauvegardes de la base SQLite (copie cohérente par VACUUM INTO).
 * Seules les sauvegardes automatiques sont élaguées selon la rétention ; les sauvegardes manuelles,
 * pré-migration, pré-restauration et pré-mise à jour ne sont jamais supprimées automatiquement.
 */
export class BackupService {
  constructor(
    private readonly db: Database,
    private readonly dir: string,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  private pathOf(name: string): string {
    if (!NAME.test(name) || name.includes("/") || name.includes("\\")) throw badRequest("Nom de sauvegarde invalide.");
    const full = path.join(this.dir, name);
    if (path.dirname(full) !== path.resolve(this.dir)) throw badRequest("Nom de sauvegarde invalide.");
    return full;
  }

  create(reason: BackupReason): BackupFile {
    let name = `darts-evolution-${stamp()}-${reason}.db`;
    for (let i = 2; existsSync(path.join(this.dir, name)); i++) name = `darts-evolution-${stamp()}-${reason}-${i}.db`;
    this.db.backupTo(path.join(this.dir, name));
    return this.describe(name);
  }

  private describe(name: string): BackupFile {
    const st = statSync(path.join(this.dir, name));
    const match = NAME.exec(name);
    return { name, size: st.size, createdAt: st.mtime.toISOString(), reason: (match?.[2] as BackupReason) ?? "inconnue" };
  }

  list(): BackupFile[] {
    return readdirSync(this.dir)
      .filter((n) => NAME.test(n))
      .map((n) => this.describe(n))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
  }

  file(name: string): string {
    const full = this.pathOf(name);
    if (!existsSync(full)) throw notFound("Sauvegarde");
    return full;
  }

  delete(name: string): void {
    rmSync(this.file(name));
  }

  /** Élague les sauvegardes automatiques au-delà de `keep`. */
  prune(keep: number): string[] {
    const autos = this.list().filter((b) => b.reason === "auto");
    const removed = autos.slice(keep).map((b) => b.name);
    for (const name of removed) rmSync(path.join(this.dir, name));
    return removed;
  }

  /** Vérifie qu'un fichier est une base DARTS EVOLUTION intègre. */
  static validate(file: string): { schemaVersion: number } {
    let conn: DatabaseSync | null = null;
    try {
      conn = new DatabaseSync(file, { readOnly: true });
      const integrity = conn.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
      if (integrity?.integrity_check !== "ok") throw badRequest("Fichier de sauvegarde corrompu.");
      const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
      const names = new Set(tables.map((t) => t.name));
      for (const required of ["schema_migrations", "players", "matches", "match_events"]) {
        if (!names.has(required)) throw badRequest("Ce fichier n'est pas une sauvegarde DARTS EVOLUTION.");
      }
      const row = conn.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
      return { schemaVersion: row.v ?? 0 };
    } catch (error) {
      if (error instanceof Error && error.name === "AppError") throw error;
      throw badRequest("Fichier illisible : ce n'est pas une base SQLite valide.");
    } finally {
      conn?.close();
    }
  }

  /**
   * Restaure une sauvegarde (existante ou envoyée). Une sauvegarde de sécurité de l'état actuel est
   * créée d'abord. La base est ensuite remplacée puis rouverte ; les migrations manquantes s'appliquent.
   */
  restore(source: { name: string } | { data: Buffer }, maxSchemaVersion = Number.POSITIVE_INFINITY): { safetyBackup: BackupFile; schemaVersion: number } {
    let file: string;
    let temp: string | null = null;
    if ("name" in source) {
      file = this.file(source.name);
    } else {
      temp = path.join(this.dir, `.upload-${Date.now()}.db`);
      writeFileSync(temp, source.data);
      file = temp;
    }
    try {
      const { schemaVersion } = BackupService.validate(file);
      if (schemaVersion > maxSchemaVersion) {
        throw badRequest("Cette sauvegarde provient d'une version plus récente de DARTS EVOLUTION : mettez l'application à jour avant de la restaurer.");
      }
      const safetyBackup = this.create("pre-restauration");
      this.db.close();
      for (const suffix of ["-wal", "-shm"]) rmSync(`${this.db.file}${suffix}`, { force: true });
      copyFileSync(file, this.db.file);
      this.db.reopen();
      return { safetyBackup, schemaVersion };
    } finally {
      if (temp) rmSync(temp, { force: true });
    }
  }
}

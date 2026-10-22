import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { MIGRATIONS, type Migration } from "./migrations.js";

export type Params = Record<string, SQLInputValue>;

/**
 * Accès SQLite (module natif node:sqlite, sans dépendance compilée).
 * Les appels sont synchrones : une commande de jeu s'exécute entièrement dans une transaction,
 * sans entrelacement possible avec une autre requête.
 */
export class Database {
  private conn: DatabaseSync;
  private depth = 0;
  private closed = false;

  constructor(readonly file: string) {
    this.conn = Database.open(file);
  }

  static open(file: string): DatabaseSync {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    const conn = new DatabaseSync(file);
    conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
    return conn;
  }

  /** Remplace la connexion (restauration d'une sauvegarde). */
  reopen(): void {
    this.close();
    this.conn = Database.open(this.file);
    this.closed = false;
  }

  close(): void {
    if (this.closed) return;
    this.conn.close();
    this.closed = true;
  }

  run(sql: string, params: Params = {}): { changes: number; lastInsertRowid: number | bigint } {
    const r = this.conn.prepare(sql).run(params);
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }

  get<T>(sql: string, params: Params = {}): T | undefined {
    return this.conn.prepare(sql).get(params) as T | undefined;
  }

  all<T>(sql: string, params: Params = {}): T[] {
    return this.conn.prepare(sql).all(params) as T[];
  }

  exec(sql: string): void {
    this.conn.exec(sql);
  }

  /** Transaction imbriquable (les niveaux internes utilisent des points de sauvegarde). */
  transaction<T>(fn: () => T): T {
    const savepoint = `sp_${this.depth}`;
    this.conn.exec(this.depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      this.conn.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.depth--;
      this.conn.exec(this.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw error;
    }
  }

  /** Copie cohérente de la base (fonctionne pendant l'utilisation). */
  backupTo(target: string): void {
    mkdirSync(path.dirname(target), { recursive: true });
    this.conn.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  }

  currentVersion(): number {
    this.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    const row = this.get<{ v: number | null }>("SELECT MAX(version) AS v FROM schema_migrations");
    return row?.v ?? 0;
  }

  pendingMigrations(migrations: Migration[] = MIGRATIONS): Migration[] {
    const current = this.currentVersion();
    return migrations.filter((m) => m.version > current);
  }

  /**
   * Applique les migrations manquantes. Si la base contient déjà des données,
   * `beforeMigrate` est appelé d'abord (sauvegarde automatique avant migration).
   */
  migrate(beforeMigrate?: (from: number, to: number) => void, migrations: Migration[] = MIGRATIONS): number[] {
    const pending = this.pendingMigrations(migrations);
    if (pending.length === 0) return [];
    const from = this.currentVersion();
    if (from > 0 && beforeMigrate) beforeMigrate(from, pending[pending.length - 1]!.version);
    const applied: number[] = [];
    for (const m of pending) {
      this.transaction(() => {
        this.exec(m.sql);
        this.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES ($v, $n, $at)", {
          $v: m.version,
          $n: m.name,
          $at: new Date().toISOString(),
        });
      });
      applied.push(m.version);
    }
    return applied;
  }

  static exists(file: string): boolean {
    return existsSync(file);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

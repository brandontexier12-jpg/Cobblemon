import type { Database } from "../db/database.js";
import { badRequest } from "../errors.js";
import { csvCell } from "./competitions.js";

const TABLES = [
  "players",
  "matches",
  "match_players",
  "match_events",
  "match_visits",
  "match_results",
  "exercises",
  "weekly_goals",
  "competitions",
  "competition_players",
  "competition_fixtures",
  "settings",
] as const;

const CSV_QUERIES: Record<string, string> = {
  joueurs: "SELECT id, name AS pseudo, level AS niveau, is_guest AS invite, created_at AS cree_le, archived_at AS archive_le FROM players ORDER BY name",
  parties: `SELECT m.id, m.mode, m.category AS categorie, m.status AS statut, m.is_simulation AS simulation, m.created_at AS debut, m.finished_at AS fin,
              (SELECT group_concat(name, ' / ') FROM match_players mp WHERE mp.match_id = m.id) AS joueurs, m.winner_ids AS gagnants
            FROM matches m ORDER BY m.created_at`,
  visites: `SELECT v.match_id AS partie, v.visit_index AS visite, p.name AS joueur, v.mode, v.leg, v.set_no AS set_, v.round AS manche, v.points,
              v.darts_count AS flechettes, v.bust, v.checkout, v.remaining_before AS restant_avant, v.remaining_after AS restant_apres,
              v.hits AS touches, v.played_at AS date, v.is_simulation AS simulation
            FROM match_visits v LEFT JOIN players p ON p.id = v.player_id ORDER BY v.played_at`,
  resultats: `SELECT r.match_id AS partie, p.name AS joueur, r.won AS gagne, r.final_score AS score_final, r.darts AS flechettes, r.points,
                r.legs_won AS legs, r.average3 AS moyenne_3
              FROM match_results r LEFT JOIN players p ON p.id = r.player_id ORDER BY r.match_id, r.position`,
};

export class ExportService {
  constructor(
    private readonly db: Database,
    private readonly version: string,
  ) {}

  /** Export complet en JSON (toutes les tables de données). */
  json(): Record<string, unknown> {
    const data: Record<string, unknown[]> = {};
    for (const table of TABLES) data[table] = this.db.all(`SELECT * FROM ${table}`);
    return { application: "DARTS EVOLUTION", version: this.version, exportedAt: new Date().toISOString(), schemaVersion: this.db.currentVersion(), data };
  }

  csvTables(): string[] {
    return Object.keys(CSV_QUERIES);
  }

  csv(table: string): string {
    const sql = CSV_QUERIES[table];
    if (!sql) throw badRequest(`Export CSV inconnu : ${table}`);
    const rows = this.db.all<Record<string, unknown>>(sql);
    if (rows.length === 0) return "";
    const header = Object.keys(rows[0]!);
    return [header.join(";"), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(";"))].join("\r\n");
  }
}

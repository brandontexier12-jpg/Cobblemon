import { randomUUID } from "node:crypto";
import { z } from "zod";
import { nowIso, type Database } from "../db/database.js";
import { badRequest, conflict, notFound } from "../errors.js";

export const LEVELS = ["debutant", "intermediaire", "confirme", "expert"] as const;

export interface Player {
  id: string;
  name: string;
  avatar: string;
  color: string;
  level: (typeof LEVELS)[number];
  isGuest: boolean;
  favoriteDouble: number | null;
  createdAt: string;
  archivedAt: string | null;
}

interface PlayerRow {
  id: string;
  name: string;
  avatar: string;
  color: string;
  level: Player["level"];
  is_guest: number;
  favorite_double: number | null;
  created_at: string;
  archived_at: string | null;
}

const toPlayer = (r: PlayerRow): Player => ({
  id: r.id,
  name: r.name,
  avatar: r.avatar,
  color: r.color,
  level: r.level,
  isGuest: r.is_guest === 1,
  favoriteDouble: r.favorite_double,
  createdAt: r.created_at,
  archivedAt: r.archived_at,
});

export const PlayerInput = z.object({
  name: z.string().trim().min(1, "Le pseudo est obligatoire.").max(32, "Pseudo trop long (32 caractères max)."),
  avatar: z.string().trim().min(1).max(16).default("🎯"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide.").default("#ff6a00"),
  level: z.enum(LEVELS).default("debutant"),
  favoriteDouble: z.number().int().refine((v) => (v >= 1 && v <= 20) || v === 25).nullable().optional(),
});

export class PlayerService {
  constructor(private readonly db: Database) {}

  list(options: { includeArchived?: boolean; includeGuests?: boolean } = {}): Player[] {
    const where = [
      options.includeArchived ? null : "archived_at IS NULL",
      options.includeGuests ? null : "is_guest = 0",
    ].filter(Boolean);
    const sql = `SELECT * FROM players ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY is_guest, name COLLATE NOCASE`;
    return this.db.all<PlayerRow>(sql).map(toPlayer);
  }

  get(id: string): Player {
    const row = this.db.get<PlayerRow>("SELECT * FROM players WHERE id = $id", { $id: id });
    if (!row) throw notFound("Joueur");
    return toPlayer(row);
  }

  getMany(ids: string[]): Player[] {
    return ids.map((id) => this.get(id));
  }

  create(input: unknown): Player {
    const data = PlayerInput.parse(input);
    this.assertNameFree(data.name);
    const id = randomUUID();
    this.db.run(
      `INSERT INTO players (id, name, avatar, color, level, is_guest, favorite_double, created_at)
       VALUES ($id, $name, $avatar, $color, $level, 0, $fav, $at)`,
      { $id: id, $name: data.name, $avatar: data.avatar, $color: data.color, $level: data.level, $fav: data.favoriteDouble ?? null, $at: nowIso() },
    );
    return this.get(id);
  }

  /** Joueur invité : utilisable immédiatement, masqué des classements. */
  createGuest(name?: string): Player {
    const count = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM players WHERE is_guest = 1")?.n ?? 0;
    const id = randomUUID();
    this.db.run(
      `INSERT INTO players (id, name, avatar, color, level, is_guest, created_at) VALUES ($id, $name, '👤', '#9ca3af', 'debutant', 1, $at)`,
      { $id: id, $name: (name?.trim() || `Invité ${count + 1}`).slice(0, 32), $at: nowIso() },
    );
    return this.get(id);
  }

  update(id: string, input: unknown): Player {
    const current = this.get(id);
    const data = PlayerInput.partial().parse(input);
    if (data.name && data.name.toLowerCase() !== current.name.toLowerCase() && !current.isGuest) this.assertNameFree(data.name);
    this.db.run(
      `UPDATE players SET name = $name, avatar = $avatar, color = $color, level = $level, favorite_double = $fav WHERE id = $id`,
      {
        $id: id,
        $name: data.name ?? current.name,
        $avatar: data.avatar ?? current.avatar,
        $color: data.color ?? current.color,
        $level: data.level ?? current.level,
        $fav: data.favoriteDouble === undefined ? current.favoriteDouble : data.favoriteDouble,
      },
    );
    return this.get(id);
  }

  /**
   * Suppression : le joueur est archivé (masqué) et son historique conservé.
   * La suppression définitive n'est possible que pour un joueur sans aucune partie.
   */
  remove(id: string, permanent = false): { archived: boolean; deleted: boolean } {
    this.get(id);
    const matches = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM match_players WHERE player_id = $id", { $id: id })?.n ?? 0;
    if (permanent) {
      if (matches > 0) throw conflict("Ce joueur a des parties enregistrées : il ne peut qu'être archivé, pour préserver l'historique.");
      this.db.transaction(() => {
        this.db.run("DELETE FROM weekly_goals WHERE player_id = $id", { $id: id });
        this.db.run("DELETE FROM players WHERE id = $id", { $id: id });
      });
      return { archived: false, deleted: true };
    }
    this.db.run("UPDATE players SET archived_at = $at WHERE id = $id", { $id: id, $at: nowIso() });
    return { archived: true, deleted: false };
  }

  restore(id: string): Player {
    const p = this.get(id);
    if (!p.isGuest) this.assertNameFree(p.name, id);
    this.db.run("UPDATE players SET archived_at = NULL WHERE id = $id", { $id: id });
    return this.get(id);
  }

  private assertNameFree(name: string, exceptId?: string): void {
    const row = this.db.get<{ id: string }>(
      "SELECT id FROM players WHERE name = $name COLLATE NOCASE AND archived_at IS NULL AND is_guest = 0",
      { $name: name },
    );
    if (row && row.id !== exceptId) throw badRequest(`Le pseudo « ${name} » est déjà utilisé.`);
  }
}

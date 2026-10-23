import { randomUUID } from "node:crypto";
import { BOT_AVERAGES, botLevelLabel } from "@darts-evolution/game-engine";
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
  /** Bot : moyenne visée sur 3 fléchettes (null pour un joueur humain). */
  botAverage: number | null;
  /** Adresse de la photo de profil (null : avatar emoji). */
  photo: string | null;
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
  bot_average: number | null;
  created_at: string;
  archived_at: string | null;
  photo_at: string | null;
}

/** Adresse versionnée de la photo d'un joueur (le cache du navigateur suit les changements). */
export function photoUrl(playerId: string, updatedAt: string | null | undefined): string | null {
  return updatedAt ? `/api/players/${playerId}/photo?v=${Date.parse(updatedAt).toString(36)}` : null;
}

const SELECT_PLAYERS = "SELECT players.*, ph.updated_at AS photo_at FROM players LEFT JOIN player_photos ph ON ph.player_id = players.id";

/** Formats d'image acceptés, reconnus à leur signature (jamais SVG ni autre format actif). */
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
function photoMime(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

const toPlayer = (r: PlayerRow): Player => ({
  id: r.id,
  name: r.name,
  avatar: r.avatar,
  color: r.color,
  level: r.level,
  isGuest: r.is_guest === 1,
  favoriteDouble: r.favorite_double,
  botAverage: r.bot_average ?? null,
  photo: photoUrl(r.id, r.photo_at),
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
      // Les bots du mode carrière n'apparaissent que dans leur carrière.
      "career_id IS NULL",
    ].filter(Boolean);
    const sql = `${SELECT_PLAYERS} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY is_guest, name COLLATE NOCASE`;
    return this.db.all<PlayerRow>(sql).map(toPlayer);
  }

  get(id: string): Player {
    const row = this.db.get<PlayerRow>(`${SELECT_PLAYERS} WHERE players.id = $id`, { $id: id });
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

  /** Bot d'un niveau donné (créé à la première utilisation, comme un invité : hors classements). */
  bot(average: number): Player {
    if (!(BOT_AVERAGES as readonly number[]).includes(average)) throw badRequest("Niveau de bot inconnu.");
    const existing = this.db.get<{ id: string }>("SELECT id FROM players WHERE bot_average = $a AND archived_at IS NULL AND career_id IS NULL ORDER BY created_at LIMIT 1", { $a: average });
    if (existing) return this.get(existing.id);
    const id = randomUUID();
    const hue = Math.round(200 - (average - 20) * (200 / 150)); // bleu (facile) → rouge (expert)
    this.db.run(
      `INSERT INTO players (id, name, avatar, color, level, is_guest, bot_average, created_at)
       VALUES ($id, $name, '🤖', $color, 'expert', 1, $a, $at)`,
      { $id: id, $name: `Bot ${average}`, $color: hslHex(hue, 70, 55), $a: average, $at: nowIso() },
    );
    return this.get(id);
  }

  /**
   * Bot d'une carrière (adversaire du circuit) : invité masqué des listes, nom et niveau tenus à
   * jour depuis la carrière à chaque match.
   */
  careerBot(careerId: string, existingId: string | undefined, info: { name: string; average: number; avatar: string }): Player {
    const average = Math.round(Math.min(170, Math.max(20, info.average)));
    const name = info.name.slice(0, 32);
    if (existingId && this.db.get("SELECT 1 FROM players WHERE id = $id AND career_id = $c", { $id: existingId, $c: careerId })) {
      this.db.run("UPDATE players SET name = $name, bot_average = $a, avatar = $avatar WHERE id = $id", { $id: existingId, $name: name, $a: average, $avatar: info.avatar });
      return this.get(existingId);
    }
    const id = randomUUID();
    const hue = Math.round(200 - (Math.min(120, Math.max(20, average)) - 20) * 2);
    this.db.run(
      `INSERT INTO players (id, name, avatar, color, level, is_guest, bot_average, career_id, created_at)
       VALUES ($id, $name, $avatar, $color, 'expert', 1, $a, $career, $at)`,
      { $id: id, $name: name, $avatar: info.avatar, $color: hslHex(hue, 70, 55), $a: average, $career: careerId, $at: nowIso() },
    );
    return this.get(id);
  }

  /** Enregistre la photo de profil (image déjà recadrée et réduite par l'application). */
  setPhoto(id: string, data: Buffer): Player {
    const player = this.get(id);
    if (player.botAverage !== null) throw badRequest("Un bot n'a pas de photo de profil.");
    if (data.length === 0) throw badRequest("Image vide.");
    if (data.length > PHOTO_MAX_BYTES) throw badRequest("Image trop lourde (2 Mo au maximum).");
    const mime = photoMime(data);
    if (!mime) throw badRequest("Format d'image non pris en charge : JPEG, PNG ou WebP.");
    this.db.run(
      `INSERT INTO player_photos (player_id, mime, data, updated_at) VALUES ($id, $mime, $data, $at)
       ON CONFLICT(player_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
      { $id: id, $mime: mime, $data: data, $at: nowIso() },
    );
    return this.get(id);
  }

  removePhoto(id: string): Player {
    this.get(id);
    this.db.run("DELETE FROM player_photos WHERE player_id = $id", { $id: id });
    return this.get(id);
  }

  photo(id: string): { mime: string; data: Uint8Array } {
    const row = this.db.get<{ mime: string; data: Uint8Array }>("SELECT mime, data FROM player_photos WHERE player_id = $id", { $id: id });
    if (!row) throw notFound("Photo");
    return row;
  }

  /** Niveaux de bots proposés. */
  botLevels(): { average: number; label: string; name: string }[] {
    return BOT_AVERAGES.map((average) => ({ average, label: botLevelLabel(average), name: `Bot ${average}` }));
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

function hslHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

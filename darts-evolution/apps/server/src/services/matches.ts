import { randomInt, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  applyEvent,
  createGame,
  describeGame,
  getModeDefinition,
  GameRuleError,
  isGameModeId,
  ModeConfigError,
  prepareConfig,
  type DartCoords,
  type GameEvent,
  type GameModeId,
  type GameState,
  type GameView,
  type PlayerRef,
} from "@darts-evolution/game-engine";
import { outRuleOf } from "@darts-evolution/statistics";
import { isValidDart, type Dart } from "@darts-evolution/shared";
import { z } from "zod";
import { nowIso, parseJson, type Database } from "../db/database.js";
import { AppError, badRequest, conflict, notFound } from "../errors.js";
import type { PlayerService } from "./players.js";

export type MatchStatus = "active" | "finished" | "abandoned";
export type InputMode = "manual" | "autodarts";
export type EventSource = "manual" | "autodarts" | "simulation";

interface MatchRow {
  id: string;
  mode: GameModeId;
  category: string;
  options: string;
  config: string;
  seed: number;
  status: MatchStatus;
  input_mode: InputMode;
  is_simulation: number;
  room_code: string;
  fixture_id: string | null;
  winner_ids: string;
  version: number;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface EventRow {
  id: string;
  match_id: string;
  seq: number;
  type: "dart" | "next";
  segment: number | null;
  multiplier: number | null;
  source: EventSource;
  external_id: string | null;
  x: number | null;
  y: number | null;
  status: "active" | "undone" | "replaced";
  replaces: string | null;
  created_at: string;
}

export interface MatchPlayer {
  id: string;
  name: string;
  avatar: string;
  color: string;
  position: number;
  isGuest: boolean;
}

export interface MatchMeta {
  id: string;
  mode: GameModeId;
  modeName: string;
  category: string;
  status: MatchStatus;
  inputMode: InputMode;
  isSimulation: boolean;
  roomCode: string;
  fixtureId: string | null;
  winnerIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  options: unknown;
  config: unknown;
  players: MatchPlayer[];
}

export interface MatchSnapshot {
  match: MatchMeta;
  view: GameView;
}

interface Cached {
  row: MatchRow;
  players: MatchPlayer[];
  state: GameState;
  events: EventRow[];
}

export const CreateMatchInput = z.object({
  mode: z.string().refine(isGameModeId, "Mode de jeu inconnu."),
  options: z.record(z.unknown()).default({}),
  playerIds: z.array(z.string().uuid()).min(1, "Choisissez au moins un joueur.").max(8),
  inputMode: z.enum(["manual", "autodarts"]).default("manual"),
});

const DartSchema = z.object({ segment: z.number().int(), multiplier: z.number().int() }).refine(isValidDart, "Fléchette invalide.");

export const CommandInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("dart"),
    dart: DartSchema,
    /** Point touché sur la cible affichée (saisie en cliquant sur la cible). */
    coords: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
    commandId: z.string().max(80).optional(),
    baseVersion: z.number().int().optional(),
  }),
  z.object({ kind: z.literal("next"), commandId: z.string().max(80).optional(), baseVersion: z.number().int().optional() }),
  z.object({ kind: z.literal("undo"), commandId: z.string().max(80).optional(), baseVersion: z.number().int().optional() }),
  z.object({
    kind: z.literal("correct"),
    eventId: z.string().max(80),
    dart: DartSchema,
    commandId: z.string().max(80).optional(),
    baseVersion: z.number().int().optional(),
  }),
  z.object({ kind: z.literal("abandon"), commandId: z.string().max(80).optional() }),
]);

/** `source` et `externalId` ne sont renseignés que par le serveur (intégration Autodarts). */
export type Command = z.infer<typeof CommandInput> & { source?: EventSource; externalId?: string; coords?: DartCoords };

export interface CommandResult {
  snapshot: MatchSnapshot;
  applied: boolean;
  duplicate: boolean;
  notice?: string;
}

export interface MatchHooks {
  /** Appelé dans la transaction quand une partie se termine. */
  onFinished?: (snapshot: MatchSnapshot, state: GameState) => void;
  /** Appelé dans la transaction quand une partie terminée redevient active (correction). Peut refuser. */
  onReopened?: (matchId: string) => void;
}

/** Coordonnées plausibles uniquement (nombres finis, à moins de 2 rayons du centre). */
function validCoords(coords: DartCoords | undefined): DartCoords | undefined {
  if (!coords || !Number.isFinite(coords.x) || !Number.isFinite(coords.y)) return undefined;
  if (Math.hypot(coords.x, coords.y) > 2) return undefined;
  return { x: coords.x, y: coords.y };
}

const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function toGameEvent(e: EventRow): GameEvent {
  if (e.type === "dart") {
    const event: GameEvent = { type: "dart", dart: { segment: e.segment ?? 0, multiplier: (e.multiplier ?? 0) as Dart["multiplier"] }, id: e.id, source: e.source };
    if (e.x !== null && e.y !== null) event.coords = { x: e.x, y: e.y };
    return event;
  }
  return { type: "next", id: e.id, source: e.source };
}

/** Score final propre au mode, pour l'historique et les records. */
function finalScoreOf(state: GameState, index: number): number | null {
  const m = state.m as Record<string, unknown>;
  const pick = (key: string) => (Array.isArray(m[key]) ? ((m[key] as number[])[index] ?? null) : null);
  switch (state.mode) {
    case "x01":
      return pick("totalLegsWon");
    case "bobs_27":
      return pick("scores");
    case "count_up":
    case "high_score":
      return pick("totals");
    case "cricket":
    case "around_the_world":
    case "shanghai":
      return pick("points");
    case "killer":
      return pick("lives");
    case "around_the_clock":
      return pick("position");
    case "checkout_training":
      return pick("successes");
    default:
      return pick("hits");
  }
}

export class MatchService extends EventEmitter {
  private readonly cache = new Map<string, Cached>();
  hooks: MatchHooks = {};

  constructor(
    private readonly db: Database,
    private readonly players: PlayerService,
  ) {
    super();
  }

  clearCache(): void {
    this.cache.clear();
  }

  private newRoomCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = Array.from({ length: 6 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join("");
      if (!this.db.get("SELECT 1 FROM matches WHERE room_code = $c", { $c: code })) return code;
    }
    throw new AppError(500, "room_code", "Impossible de générer un code de salle.");
  }

  create(input: unknown, extra: { isSimulation?: boolean; fixtureId?: string | null } = {}): MatchSnapshot {
    const data = CreateMatchInput.parse(input);
    const mode = data.mode as GameModeId;
    if (new Set(data.playerIds).size !== data.playerIds.length) throw badRequest("Un joueur ne peut pas être sélectionné deux fois.");
    const players = this.players.getMany(data.playerIds);
    if (players.some((p) => p.archivedAt)) throw badRequest("Un joueur archivé ne peut pas jouer.");
    const refs: PlayerRef[] = players.map((p) => ({ id: p.id, name: p.name }));
    const seed = randomInt(2 ** 31);
    let config: unknown;
    try {
      config = prepareConfig(mode, data.options, refs, seed);
    } catch (error) {
      if (error instanceof ModeConfigError) throw badRequest(error.message);
      throw error;
    }
    // Vérifie que la partie peut démarrer avant d'écrire quoi que ce soit.
    createGame(mode, config, refs);
    const id = randomUUID();
    const at = nowIso();
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO matches (id, mode, category, options, config, seed, status, input_mode, is_simulation, room_code, fixture_id, created_at, updated_at)
         VALUES ($id, $mode, $cat, $opt, $cfg, $seed, 'active', $input, $sim, $room, $fixture, $at, $at)`,
        {
          $id: id,
          $mode: mode,
          $cat: getModeDefinition(mode).category,
          $opt: JSON.stringify(data.options),
          $cfg: JSON.stringify(config),
          $seed: seed,
          $input: data.inputMode,
          $sim: extra.isSimulation ? 1 : 0,
          $room: this.newRoomCode(),
          $fixture: extra.fixtureId ?? null,
          $at: at,
        },
      );
      players.forEach((p, position) => {
        this.db.run("INSERT INTO match_players (match_id, player_id, position, name) VALUES ($m, $p, $pos, $name)", {
          $m: id,
          $p: p.id,
          $pos: position,
          $name: p.name,
        });
      });
      this.persistDerived(this.load(id));
    });
    const snapshot = this.snapshot(this.load(id));
    this.emit("updated", snapshot);
    return snapshot;
  }

  private load(id: string): Cached {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const row = this.db.get<MatchRow>("SELECT * FROM matches WHERE id = $id", { $id: id });
    if (!row) throw notFound("Partie");
    const players = this.db
      .all<{ player_id: string; name: string; position: number; avatar: string | null; color: string | null; is_guest: number | null; current_name: string | null }>(
        `SELECT mp.player_id, mp.name, mp.position, p.avatar, p.color, p.is_guest, p.name AS current_name
         FROM match_players mp LEFT JOIN players p ON p.id = mp.player_id WHERE mp.match_id = $id ORDER BY mp.position`,
        { $id: id },
      )
      .map((r) => ({
        id: r.player_id,
        name: r.current_name ?? r.name,
        avatar: r.avatar ?? "🎯",
        color: r.color ?? "#ff6a00",
        position: r.position,
        isGuest: r.is_guest === 1,
      }));
    const events = this.db.all<EventRow>("SELECT * FROM match_events WHERE match_id = $id AND status = 'active' ORDER BY seq, created_at", { $id: id });
    const refs = players.map((p) => ({ id: p.id, name: p.name }));
    const config = parseJson(row.config, {});
    let state = createGame(row.mode, config, refs);
    for (const e of events) state = applyEvent(state, toGameEvent(e));
    const entry: Cached = { row, players, state, events };
    this.cache.set(id, entry);
    return entry;
  }

  private meta(c: Cached): MatchMeta {
    return {
      id: c.row.id,
      mode: c.row.mode,
      modeName: getModeDefinition(c.row.mode).name,
      category: c.row.category,
      status: c.row.status,
      inputMode: c.row.input_mode,
      isSimulation: c.row.is_simulation === 1,
      roomCode: c.row.room_code,
      fixtureId: c.row.fixture_id,
      winnerIds: parseJson<string[]>(c.row.winner_ids, []),
      version: c.row.version,
      createdAt: c.row.created_at,
      updatedAt: c.row.updated_at,
      finishedAt: c.row.finished_at,
      options: parseJson(c.row.options, {}),
      config: parseJson(c.row.config, {}),
      players: c.players,
    };
  }

  private snapshot(c: Cached): MatchSnapshot {
    return { match: this.meta(c), view: describeGame(c.state) };
  }

  get(id: string): MatchSnapshot {
    return this.snapshot(this.load(id));
  }

  getState(id: string): GameState {
    return this.load(id).state;
  }

  getByRoomCode(code: string): MatchSnapshot {
    const row = this.db.get<{ id: string }>("SELECT id FROM matches WHERE room_code = $c", { $c: code.trim().toUpperCase() });
    if (!row) throw notFound("Salle");
    return this.get(row.id);
  }

  /**
   * Événement actif correspondant à un impact Autodarts, y compris s'il a déjà été corrigé
   * (les corrections portent l'identifiant d'origine suivi de « -rN »).
   */
  findByExternalId(matchId: string, externalId: string): { id: string } | null {
    return (
      this.db.get<{ id: string }>(
        "SELECT id FROM match_events WHERE match_id = $m AND status = 'active' AND (external_id = $e OR external_id LIKE $prefix) ORDER BY created_at DESC",
        { $m: matchId, $e: externalId, $prefix: `${externalId}-r%` },
      ) ?? null
    );
  }

  hasExternalId(matchId: string, externalId: string): boolean {
    return !!this.db.get("SELECT 1 FROM match_events WHERE match_id = $m AND external_id = $e", { $m: matchId, $e: externalId });
  }

  private insertEvent(
    c: Cached,
    event: Omit<EventRow, "match_id" | "status" | "created_at" | "replaces" | "x" | "y"> & { replaces?: string | null; coords?: DartCoords },
  ): EventRow {
    const { coords, ...fields } = event;
    const row: EventRow = {
      ...fields,
      x: coords?.x ?? null,
      y: coords?.y ?? null,
      match_id: c.row.id,
      status: "active",
      replaces: event.replaces ?? null,
      created_at: nowIso(),
    };
    this.db.run(
      `INSERT INTO match_events (id, match_id, seq, type, segment, multiplier, source, external_id, x, y, status, replaces, created_at)
       VALUES ($id, $m, $seq, $type, $seg, $mul, $src, $ext, $x, $y, 'active', $rep, $at)`,
      {
        $id: row.id,
        $m: row.match_id,
        $seq: row.seq,
        $type: row.type,
        $seg: row.segment,
        $mul: row.multiplier,
        $src: row.source,
        $ext: row.external_id,
        $x: row.x,
        $y: row.y,
        $rep: row.replaces,
        $at: row.created_at,
      },
    );
    return row;
  }

  private nextSeq(c: Cached): number {
    const row = this.db.get<{ s: number | null }>("SELECT MAX(seq) AS s FROM match_events WHERE match_id = $m", { $m: c.row.id });
    return (row?.s ?? 0) + 1;
  }

  /** Rejoue le journal ; les événements devenus impossibles (partie finie plus tôt) sont annulés. */
  private rebuild(c: Cached): number {
    const refs = c.players.map((p) => ({ id: p.id, name: p.name }));
    let state = createGame(c.row.mode, parseJson(c.row.config, {}), refs);
    const kept: EventRow[] = [];
    const dropped: EventRow[] = [];
    for (const e of c.events) {
      if (dropped.length) {
        dropped.push(e);
        continue;
      }
      try {
        state = applyEvent(state, toGameEvent(e));
        kept.push(e);
      } catch (error) {
        if (error instanceof GameRuleError) dropped.push(e);
        else throw error;
      }
    }
    for (const e of dropped) this.db.run("UPDATE match_events SET status = 'undone' WHERE id = $id", { $id: e.id });
    c.events = kept;
    c.state = state;
    return dropped.length;
  }

  command(matchId: string, raw: Command): CommandResult {
    let finishedNow: { snapshot: MatchSnapshot; state: GameState } | null = null;
    const result = this.db.transaction((): CommandResult => {
      const c = this.load(matchId);
      try {
        if (raw.commandId && this.db.get("SELECT 1 FROM match_commands WHERE match_id = $m AND command_id = $c", { $m: matchId, $c: raw.commandId })) {
          return { snapshot: this.snapshot(c), applied: false, duplicate: true };
        }
        if ("baseVersion" in raw && raw.baseVersion !== undefined && raw.baseVersion !== c.row.version) {
          throw conflict("La partie a été modifiée depuis un autre appareil. L'affichage a été actualisé : vérifiez puis recommencez.", "version_conflict");
        }
        const wasFinished = c.row.status === "finished";
        let notice: string | undefined;
        const source: EventSource = raw.source ?? "manual";
        switch (raw.kind) {
          case "dart":
          case "next": {
            if (c.row.status !== "active") throw badRequest(c.row.status === "finished" ? "La partie est terminée." : "La partie a été abandonnée.");
            if (raw.kind === "dart" && raw.externalId && this.hasExternalId(matchId, raw.externalId)) {
              return { snapshot: this.snapshot(c), applied: false, duplicate: true };
            }
            const id = randomUUID();
            const coords = raw.kind === "dart" ? validCoords(raw.coords) : undefined;
            const event: GameEvent =
              raw.kind === "dart" ? { type: "dart", dart: raw.dart as Dart, id, source, ...(coords ? { coords } : {}) } : { type: "next", id, source };
            const next = applyEvent(c.state, event);
            const row = this.insertEvent(c, {
              id,
              seq: this.nextSeq(c),
              type: raw.kind,
              segment: raw.kind === "dart" ? raw.dart.segment : null,
              multiplier: raw.kind === "dart" ? raw.dart.multiplier : null,
              source,
              external_id: raw.kind === "dart" ? (raw.externalId ?? null) : null,
              coords,
            });
            c.events.push(row);
            c.state = next;
            break;
          }
          case "undo": {
            if (c.row.status === "abandoned") throw badRequest("La partie a été abandonnée.");
            const last = c.events[c.events.length - 1];
            if (!last) throw badRequest("Rien à annuler.");
            if (wasFinished) this.hooks.onReopened?.(matchId);
            this.db.run("UPDATE match_events SET status = 'undone' WHERE id = $id", { $id: last.id });
            c.events.pop();
            this.rebuild(c);
            break;
          }
          case "correct": {
            if (c.row.status === "abandoned") throw badRequest("La partie a été abandonnée.");
            const index = c.events.findIndex((e) => e.id === raw.eventId && e.type === "dart");
            if (index < 0) throw notFound("Fléchette");
            const target = c.events[index]!;
            if (target.segment === raw.dart.segment && target.multiplier === raw.dart.multiplier) {
              return { snapshot: this.snapshot(c), applied: false, duplicate: false, notice: "Aucune modification." };
            }
            if (wasFinished) this.hooks.onReopened?.(matchId);
            this.db.run("UPDATE match_events SET status = 'replaced' WHERE id = $id", { $id: target.id });
            const row = this.insertEvent(c, {
              id: randomUUID(),
              seq: target.seq,
              type: "dart",
              segment: raw.dart.segment,
              multiplier: raw.dart.multiplier,
              source,
              external_id: raw.externalId ?? null,
              coords: validCoords(raw.coords),
              replaces: target.id,
            });
            c.events[index] = row;
            const dropped = this.rebuild(c);
            if (dropped > 0) notice = `${dropped} action(s) postérieure(s) annulée(s) : la partie se termine désormais plus tôt.`;
            break;
          }
          case "abandon": {
            if (c.row.status !== "active") throw badRequest("Seule une partie en cours peut être abandonnée.");
            c.row.status = "abandoned";
            break;
          }
        }
        if (raw.commandId) {
          this.db.run("INSERT INTO match_commands (match_id, command_id, kind, created_at) VALUES ($m, $c, $k, $at)", {
            $m: matchId,
            $c: raw.commandId,
            $k: raw.kind,
            $at: nowIso(),
          });
        }
        if (raw.kind !== "abandon") c.row.status = c.state.finished ? "finished" : "active";
        if (c.row.status === "active" && wasFinished) c.row.finished_at = null;
        if (c.row.status === "finished" && !wasFinished) c.row.finished_at = nowIso();
        c.row.winner_ids = JSON.stringify(c.row.status === "finished" ? c.state.winners : []);
        c.row.version += 1;
        c.row.updated_at = nowIso();
        this.db.run(
          "UPDATE matches SET status = $s, winner_ids = $w, version = $v, updated_at = $u, finished_at = $f WHERE id = $id",
          { $s: c.row.status, $w: c.row.winner_ids, $v: c.row.version, $u: c.row.updated_at, $f: c.row.finished_at, $id: matchId },
        );
        this.persistDerived(c);
        const snapshot = this.snapshot(c);
        if (c.row.status === "finished" && !wasFinished) finishedNow = { snapshot, state: c.state };
        if (finishedNow) this.hooks.onFinished?.(finishedNow.snapshot, finishedNow.state);
        return { snapshot, applied: true, duplicate: false, notice };
      } catch (error) {
        // Toute erreur annule la transaction : le cache doit être relu depuis la base.
        this.cache.delete(matchId);
        if (error instanceof GameRuleError) throw badRequest(error.message);
        throw error;
      }
    });
    if (result.applied) this.emit("updated", result.snapshot);
    return result;
  }

  setInputMode(matchId: string, mode: InputMode): MatchSnapshot {
    const c = this.load(matchId);
    this.db.run("UPDATE matches SET input_mode = $m, version = version + 1, updated_at = $u WHERE id = $id", { $m: mode, $u: nowIso(), $id: matchId });
    c.row.input_mode = mode;
    c.row.version += 1;
    const snapshot = this.snapshot(c);
    this.emit("updated", snapshot);
    return snapshot;
  }

  delete(matchId: string): void {
    this.load(matchId);
    this.db.run("DELETE FROM matches WHERE id = $id", { $id: matchId });
    this.cache.delete(matchId);
    this.emit("deleted", matchId);
  }

  /** Écrit les tables dérivées (visites, résultats) à partir de l'état rejoué. */
  private persistDerived(c: Cached): void {
    const id = c.row.id;
    const timestamps = new Map(c.events.map((e) => [e.id, e.created_at]));
    const outRule = outRuleOf(parseJson(c.row.config, {}));
    this.db.run("DELETE FROM match_visits WHERE match_id = $id", { $id: id });
    let lastTime = c.row.created_at;
    for (const v of c.state.visits) {
      const times = v.darts.map((d) => (d.eventId ? timestamps.get(d.eventId) : undefined)).filter((t): t is string => !!t);
      const playedAt = times.length ? times.sort()[times.length - 1]! : lastTime;
      lastTime = playedAt;
      this.db.run(
        `INSERT INTO match_visits (match_id, visit_index, player_id, mode, category, leg, set_no, round, points, raw_points, darts, darts_count,
           bust, checkout, checkout_chance, first_of_leg, remaining_before, remaining_after, hits, attempts, marks, end_reason, out_rule, is_simulation, played_at)
         VALUES ($m, $i, $p, $mode, $cat, $leg, $set, $round, $pts, $raw, $darts, $n, $bust, $co, $chance, $first, $rb, $ra, $hits, $att, $marks, $end, $out, $sim, $at)`,
        {
          $m: id,
          $i: v.index,
          $p: v.playerId,
          $mode: c.row.mode,
          $cat: c.row.category,
          $leg: v.leg,
          $set: v.set,
          $round: v.round,
          $pts: v.points,
          $raw: v.rawPoints,
          $darts: JSON.stringify(
            v.darts.map((d) => ({
              segment: d.segment,
              multiplier: d.multiplier,
              points: d.points,
              ...(d.hit !== undefined ? { hit: d.hit } : {}),
              ...(d.checkoutAttempt ? { checkoutAttempt: true } : {}),
              ...(d.padded ? { padded: true } : {}),
              ...(d.eventId ? { eventId: d.eventId } : {}),
            })),
          ),
          $n: v.darts.length,
          $bust: v.bust ? 1 : 0,
          $co: v.checkout ? 1 : 0,
          $chance: v.checkoutChance ? 1 : 0,
          $first: v.firstOfLeg ? 1 : 0,
          $rb: v.remainingBefore ?? null,
          $ra: v.remainingAfter ?? null,
          $hits: v.hits ?? null,
          $att: v.attempts ?? null,
          $marks: v.marks ?? null,
          $end: v.endReason,
          $out: outRule,
          $sim: c.row.is_simulation,
          $at: playedAt,
        },
      );
    }
    this.db.run("DELETE FROM match_results WHERE match_id = $id", { $id: id });
    const finished = c.row.status === "finished";
    c.players.forEach((p, i) => {
      const own = c.state.visits.filter((v) => v.playerId === p.id);
      const darts = own.reduce((s, v) => s + v.darts.length, 0);
      const points = own.reduce((s, v) => s + v.points, 0);
      const m = c.state.m as { totalLegsWon?: number[]; setsWon?: number[] };
      this.db.run(
        `INSERT INTO match_results (match_id, player_id, position, won, final_score, darts, points, legs_won, sets_won, average3)
         VALUES ($m, $p, $pos, $won, $score, $darts, $pts, $legs, $sets, $avg)`,
        {
          $m: id,
          $p: p.id,
          $pos: i,
          $won: finished && c.state.winners.includes(p.id) ? 1 : 0,
          $score: finalScoreOf(c.state, i),
          $darts: darts,
          $pts: points,
          $legs: m.totalLegsWon?.[i] ?? null,
          $sets: m.setsWon?.[i] ?? null,
          $avg: c.row.mode === "x01" && darts > 0 ? Math.round((points / darts) * 300) / 100 : null,
        },
      );
    });
  }

  list(filters: { status?: MatchStatus; playerId?: string; mode?: string; category?: string; from?: string; to?: string; includeSimulation?: boolean; limit?: number; offset?: number } = {}) {
    const where: string[] = [];
    const params: Record<string, string | number> = {};
    if (filters.status) {
      where.push("m.status = $status");
      params.$status = filters.status;
    }
    if (filters.mode) {
      where.push("m.mode = $mode");
      params.$mode = filters.mode;
    }
    if (filters.category) {
      where.push("m.category = $cat");
      params.$cat = filters.category;
    }
    if (filters.playerId) {
      where.push("EXISTS (SELECT 1 FROM match_players mp WHERE mp.match_id = m.id AND mp.player_id = $pid)");
      params.$pid = filters.playerId;
    }
    if (filters.from) {
      where.push("m.created_at >= $from");
      params.$from = filters.from;
    }
    if (filters.to) {
      where.push("m.created_at <= $to");
      params.$to = filters.to;
    }
    if (!filters.includeSimulation) where.push("m.is_simulation = 0");
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
    const offset = Math.max(filters.offset ?? 0, 0);
    const rows = this.db.all<MatchRow>(
      `SELECT m.* FROM matches m ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY m.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const total = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM matches m ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`, params)?.n ?? 0;
    return {
      total,
      items: rows.map((row) => {
        const results = this.db.all<{ player_id: string; name: string; avatar: string | null; color: string | null; position: number; won: number; final_score: number | null; darts: number; points: number; average3: number | null; legs_won: number | null }>(
          `SELECT r.player_id, mp.name, p.avatar, p.color, r.position, r.won, r.final_score, r.darts, r.points, r.average3, r.legs_won
           FROM match_results r JOIN match_players mp ON mp.match_id = r.match_id AND mp.player_id = r.player_id
           LEFT JOIN players p ON p.id = r.player_id WHERE r.match_id = $id ORDER BY r.position`,
          { $id: row.id },
        );
        return {
          id: row.id,
          mode: row.mode,
          modeName: getModeDefinition(row.mode).name,
          category: row.category,
          status: row.status,
          isSimulation: row.is_simulation === 1,
          inputMode: row.input_mode,
          roomCode: row.room_code,
          createdAt: row.created_at,
          finishedAt: row.finished_at,
          winnerIds: parseJson<string[]>(row.winner_ids, []),
          options: parseJson(row.options, {}),
          players: results.map((r) => ({
            id: r.player_id,
            name: r.name,
            avatar: r.avatar ?? "🎯",
            color: r.color ?? "#ff6a00",
            won: r.won === 1,
            finalScore: r.final_score,
            darts: r.darts,
            points: r.points,
            average3: r.average3,
            legsWon: r.legs_won,
          })),
        };
      }),
    };
  }

  visits(matchId: string) {
    this.load(matchId);
    return this.db
      .all<Record<string, unknown> & { darts: string }>("SELECT * FROM match_visits WHERE match_id = $id ORDER BY visit_index", { $id: matchId })
      .map((r) => ({ ...r, darts: parseJson(r.darts, []) }));
  }
}

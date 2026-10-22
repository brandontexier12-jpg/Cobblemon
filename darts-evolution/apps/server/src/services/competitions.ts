import { randomInt, randomUUID } from "node:crypto";
import { OPTION_SCHEMAS } from "@darts-evolution/game-engine";
import { z } from "zod";
import { nowIso, parseJson, type Database } from "../db/database.js";
import { badRequest, conflict, notFound } from "../errors.js";
import type { MatchService, MatchSnapshot } from "./matches.js";
import type { PlayerService } from "./players.js";

export const CompetitionInput = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire.").max(60),
  format: z.enum(["knockout", "round_robin"]),
  playerIds: z.array(z.string().uuid()).min(2, "Au moins 2 joueurs.").max(32),
  matchOptions: OPTION_SCHEMAS.x01.default({}),
  pointsWin: z.number().int().min(0).max(10).default(2),
  pointsDraw: z.number().int().min(0).max(10).default(1),
  doubleRound: z.boolean().default(false),
  seeding: z.enum(["order", "random"]).default("order"),
});

export const ManualResult = z.object({
  winnerId: z.string().uuid().nullable(),
  score1: z.number().int().min(0).max(99),
  score2: z.number().int().min(0).max(99),
});

interface CompetitionRow {
  id: string;
  name: string;
  format: "knockout" | "round_robin";
  match_options: string;
  points_win: number;
  points_draw: number;
  double_round: number;
  status: "active" | "finished";
  winner_id: string | null;
  created_at: string;
  finished_at: string | null;
}

interface FixtureRow {
  id: string;
  competition_id: string;
  round: number;
  slot: number;
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  score1: number | null;
  score2: number | null;
  match_id: string | null;
  status: "pending" | "playing" | "done" | "bye";
  scheduled_at: string | null;
}

export interface StandingRow {
  playerId: string;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  legsFor: number;
  legsAgainst: number;
  legDiff: number;
  points: number;
}

/** Tableau à élimination directe : taille puissance de 2, exemptions (byes) pour les meilleures têtes de série. */
export function knockoutFirstRound(seeded: string[]): [string | null, string | null][] {
  let size = 2;
  while (size < seeded.length) size *= 2;
  // Ordre classique des têtes de série (1 contre N, 2 contre N-1…), placées pour ne se croiser qu'en finale.
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  const pairs: [string | null, string | null][] = [];
  for (let i = 0; i < size; i += 2) {
    pairs.push([seeded[order[i]! - 1] ?? null, seeded[order[i + 1]! - 1] ?? null]);
  }
  return pairs;
}

/** Calendrier toutes rondes (méthode du cercle). */
export function roundRobinSchedule(players: string[], doubleRound: boolean): [string, string][][] {
  const list: (string | null)[] = [...players];
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const rounds: [string, string][][] = [];
  const rotating = list.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const current = [list[0]!, ...rotating];
    const games: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = current[i];
      const b = current[n - 1 - i];
      if (a && b) games.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(games);
    rotating.unshift(rotating.pop()!);
  }
  if (doubleRound) return [...rounds, ...rounds.map((games) => games.map(([a, b]) => [b, a] as [string, string]))];
  return rounds;
}

export class CompetitionService {
  constructor(
    private readonly db: Database,
    private readonly players: PlayerService,
    private readonly matches: MatchService,
  ) {}

  create(input: unknown) {
    const data = CompetitionInput.parse(input);
    if (new Set(data.playerIds).size !== data.playerIds.length) throw badRequest("Un joueur figure deux fois.");
    this.players.getMany(data.playerIds);
    const seeded = [...data.playerIds];
    if (data.seeding === "random") {
      for (let i = seeded.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [seeded[i], seeded[j]] = [seeded[j]!, seeded[i]!];
      }
    }
    const id = randomUUID();
    const at = nowIso();
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO competitions (id, name, format, match_options, points_win, points_draw, double_round, status, created_at)
         VALUES ($id, $name, $format, $opt, $pw, $pd, $dr, 'active', $at)`,
        {
          $id: id,
          $name: data.name,
          $format: data.format,
          $opt: JSON.stringify(data.matchOptions),
          $pw: data.pointsWin,
          $pd: data.pointsDraw,
          $dr: data.doubleRound ? 1 : 0,
          $at: at,
        },
      );
      seeded.forEach((pid, i) =>
        this.db.run("INSERT INTO competition_players (competition_id, player_id, seed) VALUES ($c, $p, $s)", { $c: id, $p: pid, $s: i + 1 }),
      );
      if (data.format === "knockout") {
        const first = knockoutFirstRound(seeded);
        const totalRounds = Math.log2(first.length * 2);
        for (let round = 1; round <= totalRounds; round++) {
          const count = first.length / 2 ** (round - 1);
          for (let slot = 0; slot < count; slot++) {
            const pair = round === 1 ? first[slot]! : [null, null];
            this.insertFixture(id, round, slot, pair[0], pair[1]);
          }
        }
        // Les exemptions passent directement au tour suivant.
        for (const f of this.fixtures(id).filter((f) => f.round === 1)) {
          if ((f.player1_id === null) !== (f.player2_id === null)) {
            this.complete(f, (f.player1_id ?? f.player2_id)!, null, null, "bye");
          }
        }
      } else {
        roundRobinSchedule(seeded, data.doubleRound).forEach((games, r) =>
          games.forEach(([a, b], slot) => this.insertFixture(id, r + 1, slot, a, b)),
        );
      }
    });
    return this.get(id);
  }

  private insertFixture(competitionId: string, round: number, slot: number, p1: string | null, p2: string | null) {
    const at = nowIso();
    this.db.run(
      `INSERT INTO competition_fixtures (id, competition_id, round, slot, player1_id, player2_id, status, created_at, updated_at)
       VALUES ($id, $c, $r, $s, $p1, $p2, 'pending', $at, $at)`,
      { $id: randomUUID(), $c: competitionId, $r: round, $s: slot, $p1: p1, $p2: p2, $at: at },
    );
  }

  private row(id: string): CompetitionRow {
    const row = this.db.get<CompetitionRow>("SELECT * FROM competitions WHERE id = $id", { $id: id });
    if (!row) throw notFound("Compétition");
    return row;
  }

  private fixtures(id: string): FixtureRow[] {
    return this.db.all<FixtureRow>("SELECT * FROM competition_fixtures WHERE competition_id = $id ORDER BY round, slot", { $id: id });
  }

  list() {
    return this.db.all<CompetitionRow>("SELECT * FROM competitions ORDER BY created_at DESC").map((r) => ({
      id: r.id,
      name: r.name,
      format: r.format,
      status: r.status,
      winnerId: r.winner_id,
      createdAt: r.created_at,
      players: this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM competition_players WHERE competition_id = $id", { $id: r.id })?.n ?? 0,
    }));
  }

  get(id: string) {
    const row = this.row(id);
    const players = this.db
      .all<{ player_id: string; seed: number; name: string; avatar: string; color: string }>(
        `SELECT cp.player_id, cp.seed, p.name, p.avatar, p.color FROM competition_players cp JOIN players p ON p.id = cp.player_id
         WHERE cp.competition_id = $id ORDER BY cp.seed`,
        { $id: id },
      )
      .map((p) => ({ id: p.player_id, seed: p.seed, name: p.name, avatar: p.avatar, color: p.color }));
    const fixtures = this.fixtures(id).map((f) => ({
      id: f.id,
      round: f.round,
      slot: f.slot,
      player1Id: f.player1_id,
      player2Id: f.player2_id,
      winnerId: f.winner_id,
      score1: f.score1,
      score2: f.score2,
      matchId: f.match_id,
      status: f.status,
      scheduledAt: f.scheduled_at,
    }));
    return {
      id: row.id,
      name: row.name,
      format: row.format,
      status: row.status,
      winnerId: row.winner_id,
      matchOptions: parseJson(row.match_options, {}),
      pointsWin: row.points_win,
      pointsDraw: row.points_draw,
      doubleRound: row.double_round === 1,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      players,
      fixtures,
      standings: row.format === "round_robin" ? this.standings(id) : null,
    };
  }

  standings(id: string): StandingRow[] {
    const row = this.row(id);
    const names = new Map(
      this.db
        .all<{ player_id: string; name: string }>(
          "SELECT cp.player_id, p.name FROM competition_players cp JOIN players p ON p.id = cp.player_id WHERE cp.competition_id = $id",
          { $id: id },
        )
        .map((r) => [r.player_id, r.name]),
    );
    const table = new Map<string, StandingRow>();
    for (const [pid, name] of names) {
      table.set(pid, { playerId: pid, name, played: 0, won: 0, drawn: 0, lost: 0, legsFor: 0, legsAgainst: 0, legDiff: 0, points: 0 });
    }
    for (const f of this.fixtures(id).filter((x) => x.status === "done" && x.player1_id && x.player2_id)) {
      const a = table.get(f.player1_id!)!;
      const b = table.get(f.player2_id!)!;
      a.played++;
      b.played++;
      a.legsFor += f.score1 ?? 0;
      a.legsAgainst += f.score2 ?? 0;
      b.legsFor += f.score2 ?? 0;
      b.legsAgainst += f.score1 ?? 0;
      if (f.winner_id === null) {
        a.drawn++;
        b.drawn++;
        a.points += row.points_draw;
        b.points += row.points_draw;
      } else {
        const [w, l] = f.winner_id === a.playerId ? [a, b] : [b, a];
        w.won++;
        l.lost++;
        w.points += row.points_win;
      }
    }
    return [...table.values()]
      .map((s) => ({ ...s, legDiff: s.legsFor - s.legsAgainst }))
      .sort((x, y) => y.points - x.points || y.legDiff - x.legDiff || y.legsFor - x.legsFor || x.name.localeCompare(y.name));
  }

  /** Lance le match d'une rencontre : une partie X01 liée à la compétition. */
  startFixture(competitionId: string, fixtureId: string, inputMode: "manual" | "autodarts", isSimulation: boolean): MatchSnapshot {
    const comp = this.row(competitionId);
    if (comp.status !== "active") throw badRequest("La compétition est terminée.");
    const f = this.fixtures(competitionId).find((x) => x.id === fixtureId);
    if (!f) throw notFound("Rencontre");
    if (!f.player1_id || !f.player2_id) throw badRequest("Les deux adversaires ne sont pas encore connus.");
    if (f.status === "done" || f.status === "bye") throw badRequest("Cette rencontre est déjà jouée.");
    if (f.match_id && f.status === "playing") {
      const existing = this.matches.get(f.match_id);
      if (existing.match.status === "active") return existing;
    }
    const snapshot = this.matches.create(
      { mode: "x01", options: parseJson(comp.match_options, {}), playerIds: [f.player1_id, f.player2_id], inputMode },
      { fixtureId, isSimulation },
    );
    this.db.run("UPDATE competition_fixtures SET match_id = $m, status = 'playing', updated_at = $at WHERE id = $id", {
      $m: snapshot.match.id,
      $at: nowIso(),
      $id: fixtureId,
    });
    return snapshot;
  }

  /** Résultat saisi à la main (match joué hors application). */
  setManualResult(competitionId: string, fixtureId: string, input: unknown) {
    const data = ManualResult.parse(input);
    const comp = this.row(competitionId);
    const f = this.fixtures(competitionId).find((x) => x.id === fixtureId);
    if (!f) throw notFound("Rencontre");
    if (!f.player1_id || !f.player2_id) throw badRequest("Les deux adversaires ne sont pas encore connus.");
    if (data.winnerId && data.winnerId !== f.player1_id && data.winnerId !== f.player2_id) throw badRequest("Vainqueur invalide.");
    if (!data.winnerId && comp.format === "knockout") throw badRequest("Un match à élimination directe doit avoir un vainqueur.");
    this.db.transaction(() => {
      if (f.status === "done") this.reopen(f);
      this.complete({ ...f, status: "pending" }, data.winnerId, data.score1, data.score2, "done");
    });
    return this.get(competitionId);
  }

  private complete(f: FixtureRow, winnerId: string | null, score1: number | null, score2: number | null, status: "done" | "bye") {
    this.db.run(
      "UPDATE competition_fixtures SET winner_id = $w, score1 = $s1, score2 = $s2, status = $st, updated_at = $at WHERE id = $id",
      { $w: winnerId, $s1: score1, $s2: score2, $st: status, $at: nowIso(), $id: f.id },
    );
    const comp = this.row(f.competition_id);
    if (comp.format === "knockout" && winnerId) {
      const next = this.fixtures(f.competition_id).find((x) => x.round === f.round + 1 && x.slot === Math.floor(f.slot / 2));
      if (next) {
        const column = f.slot % 2 === 0 ? "player1_id" : "player2_id";
        this.db.run(`UPDATE competition_fixtures SET ${column} = $p, updated_at = $at WHERE id = $id`, { $p: winnerId, $at: nowIso(), $id: next.id });
      } else {
        this.finish(comp.id, winnerId);
      }
    }
    if (comp.format === "round_robin" && this.fixtures(comp.id).every((x) => x.status === "done" || x.status === "bye")) {
      this.finish(comp.id, this.standings(comp.id)[0]?.playerId ?? null);
    }
  }

  private finish(id: string, winnerId: string | null) {
    this.db.run("UPDATE competitions SET status = 'finished', winner_id = $w, finished_at = $at WHERE id = $id", { $w: winnerId, $at: nowIso(), $id: id });
  }

  /** Annule le résultat d'une rencontre (correction) si la suite du tableau ne l'a pas encore utilisé. */
  private reopen(f: FixtureRow) {
    const comp = this.row(f.competition_id);
    if (comp.format === "knockout") {
      const next = this.fixtures(f.competition_id).find((x) => x.round === f.round + 1 && x.slot === Math.floor(f.slot / 2));
      if (next && (next.status === "done" || next.status === "playing")) {
        throw conflict("Le tour suivant de ce tableau a déjà commencé : ce résultat ne peut plus être modifié.");
      }
      if (next) {
        const column = f.slot % 2 === 0 ? "player1_id" : "player2_id";
        this.db.run(`UPDATE competition_fixtures SET ${column} = NULL WHERE id = $id`, { $id: next.id });
      }
    }
    this.db.run("UPDATE competition_fixtures SET winner_id = NULL, score1 = NULL, score2 = NULL, status = 'playing', updated_at = $at WHERE id = $id", {
      $at: nowIso(),
      $id: f.id,
    });
    this.db.run("UPDATE competitions SET status = 'active', winner_id = NULL, finished_at = NULL WHERE id = $id", { $id: comp.id });
  }

  /** Branché sur la fin d'une partie liée à une rencontre. */
  onMatchFinished(snapshot: MatchSnapshot, legs: number[] | undefined) {
    if (!snapshot.match.fixtureId) return;
    const f = this.db.get<FixtureRow>("SELECT * FROM competition_fixtures WHERE id = $id", { $id: snapshot.match.fixtureId });
    if (!f || f.match_id !== snapshot.match.id) return;
    const idx1 = snapshot.match.players.findIndex((p) => p.id === f.player1_id);
    const idx2 = snapshot.match.players.findIndex((p) => p.id === f.player2_id);
    const winner = snapshot.match.winnerIds.length === 1 ? snapshot.match.winnerIds[0]! : null;
    this.complete(f, winner, legs?.[idx1] ?? null, legs?.[idx2] ?? null, "done");
  }

  onMatchReopened(matchId: string) {
    const f = this.db.get<FixtureRow>("SELECT * FROM competition_fixtures WHERE match_id = $id AND status = 'done'", { $id: matchId });
    if (f) this.reopen(f);
  }

  delete(id: string) {
    this.row(id);
    this.db.run("DELETE FROM competitions WHERE id = $id", { $id: id });
  }

  exportCsv(id: string): string {
    const comp = this.get(id);
    const esc = (v: unknown) => csvCell(v);
    if (comp.standings) {
      const header = ["Rang", "Joueur", "Joués", "Gagnés", "Nuls", "Perdus", "Legs pour", "Legs contre", "Différence", "Points"];
      const lines = comp.standings.map((s, i) => [i + 1, s.name, s.played, s.won, s.drawn, s.lost, s.legsFor, s.legsAgainst, s.legDiff, s.points]);
      return [header, ...lines].map((l) => l.map(esc).join(";")).join("\r\n");
    }
    const name = new Map(comp.players.map((p) => [p.id, p.name]));
    const header = ["Tour", "Match", "Joueur 1", "Joueur 2", "Score 1", "Score 2", "Vainqueur", "Statut"];
    const lines = comp.fixtures.map((f) => [
      f.round,
      f.slot + 1,
      f.player1Id ? name.get(f.player1Id) : "",
      f.player2Id ? name.get(f.player2Id) : "",
      f.score1 ?? "",
      f.score2 ?? "",
      f.winnerId ? name.get(f.winnerId) : "",
      f.status,
    ]);
    return [header, ...lines].map((l) => l.map(esc).join(";")).join("\r\n");
  }
}

/** Cellule CSV (séparateur « ; », guillemets échappés, protection contre l'injection de formules). */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

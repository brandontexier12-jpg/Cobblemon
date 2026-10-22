import {
  activityCalendar,
  averageByMatch,
  comparePeriods,
  computeProgress,
  personalRecords,
  playerSummary,
  progressionSeries,
  resultsSummary,
  x01Summary,
  type Granularity,
  type StatMatch,
  type StatVisit,
} from "@darts-evolution/statistics";
import type { GameModeId } from "@darts-evolution/game-engine";
import { z } from "zod";
import { parseJson, type Database } from "../db/database.js";
import type { PlayerService } from "./players.js";

const isoDate = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), "Date invalide.")
  .transform((v) => new Date(v).toISOString());

export const StatsFilter = z.object({
  playerId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  mode: z.string().max(40).optional(),
  opponentId: z.string().uuid().optional(),
});

export type StatsFilter = z.infer<typeof StatsFilter>;

interface VisitRow {
  match_id: string;
  player_id: string;
  mode: GameModeId;
  category: "game" | "training";
  leg: number;
  set_no: number;
  round: number;
  points: number;
  darts: string;
  bust: number;
  checkout: number;
  checkout_chance: number;
  first_of_leg: number;
  remaining_before: number | null;
  hits: number | null;
  attempts: number | null;
  marks: number | null;
  out_rule: StatVisit["outRule"];
  played_at: string;
}

/** Chargement des données statistiques réelles (les parties simulées sont toujours exclues). */
export class StatsService {
  constructor(
    private readonly db: Database,
    private readonly players: PlayerService,
  ) {}

  private where(filter: StatsFilter, alias: string, dateColumn: string) {
    const clauses = ["m.is_simulation = 0"];
    const params: Record<string, string> = {};
    if (filter.playerId) {
      clauses.push(`${alias}.player_id = $player`);
      params.$player = filter.playerId;
    }
    if (filter.from) {
      clauses.push(`${dateColumn} >= $from`);
      params.$from = filter.from;
    }
    if (filter.to) {
      clauses.push(`${dateColumn} <= $to`);
      params.$to = filter.to;
    }
    if (filter.mode) {
      clauses.push("m.mode = $mode");
      params.$mode = filter.mode;
    }
    if (filter.opponentId) {
      clauses.push("EXISTS (SELECT 1 FROM match_players o WHERE o.match_id = m.id AND o.player_id = $opp)");
      params.$opp = filter.opponentId;
    }
    return { sql: clauses.join(" AND "), params };
  }

  visits(filter: StatsFilter): StatVisit[] {
    const { sql, params } = this.where(filter, "v", "v.played_at");
    return this.db
      .all<VisitRow>(`SELECT v.* FROM match_visits v JOIN matches m ON m.id = v.match_id WHERE ${sql} ORDER BY v.played_at`, params)
      .map((r) => ({
        matchId: r.match_id,
        mode: r.mode,
        category: r.category,
        playedAt: r.played_at,
        playerId: r.player_id,
        leg: r.leg,
        set: r.set_no,
        round: r.round,
        points: r.points,
        bust: r.bust === 1,
        checkout: r.checkout === 1,
        checkoutChance: r.checkout_chance === 1,
        firstOfLeg: r.first_of_leg === 1,
        remainingBefore: r.remaining_before,
        darts: parseJson(r.darts, []),
        hits: r.hits,
        attempts: r.attempts,
        marks: r.marks,
        outRule: r.out_rule,
      }));
  }

  matches(filter: StatsFilter): StatMatch[] {
    const { sql, params } = this.where(filter, "mp", "m.created_at");
    const rows = this.db.all<{
      id: string;
      mode: GameModeId;
      category: "game" | "training";
      status: StatMatch["status"];
      created_at: string;
      finished_at: string | null;
      player_id: string;
      winner_ids: string;
      final_score: number | null;
    }>(
      `SELECT m.id, m.mode, m.category, m.status, m.created_at, m.finished_at, mp.player_id, m.winner_ids, r.final_score
       FROM matches m JOIN match_players mp ON mp.match_id = m.id
       LEFT JOIN match_results r ON r.match_id = m.id AND r.player_id = mp.player_id
       WHERE ${sql} ORDER BY m.created_at`,
      params,
    );
    const allPlayers = new Map<string, string[]>();
    for (const r of this.db.all<{ match_id: string; player_id: string }>("SELECT match_id, player_id FROM match_players ORDER BY position")) {
      const list = allPlayers.get(r.match_id) ?? [];
      list.push(r.player_id);
      allPlayers.set(r.match_id, list);
    }
    return rows.map((r) => ({
      matchId: r.id,
      mode: r.mode,
      category: r.category,
      status: r.status,
      playedAt: r.created_at,
      finishedAt: r.finished_at,
      playerId: r.player_id,
      playerIds: allPlayers.get(r.id) ?? [r.player_id],
      winnerIds: parseJson<string[]>(r.winner_ids, []),
      finalScore: r.final_score,
    }));
  }

  summary(filter: StatsFilter) {
    const visits = this.visits(filter);
    const matches = this.matches(filter);
    return {
      summary: playerSummary(visits, matches),
      records: personalRecords(visits, matches),
      progress: computeProgress(visits, matches),
    };
  }

  series(filter: StatsFilter, granularity: Granularity) {
    const visits = this.visits(filter);
    return { series: progressionSeries(visits, granularity), byMatch: averageByMatch(visits) };
  }

  calendar(filter: StatsFilter) {
    return activityCalendar(this.visits(filter));
  }

  compare(filter: StatsFilter, a: { from?: string; to?: string }, b: { from?: string; to?: string }) {
    return comparePeriods(this.visits({ ...filter, from: undefined, to: undefined }), a, b);
  }

  /** Classement local : joueurs non invités, non archivés. */
  leaderboard(filter: Omit<StatsFilter, "playerId">) {
    return this.players
      .list()
      .map((p) => {
        const visits = this.visits({ ...filter, playerId: p.id });
        const matches = this.matches({ ...filter, playerId: p.id });
        const x01 = x01Summary(visits);
        const results = resultsSummary(matches);
        return {
          player: p,
          average3: x01.average3,
          bestVisit: x01.bestVisit,
          count180: x01.count180,
          checkoutRate: x01.checkoutRate,
          doubleRate: x01.doubleRate,
          matches: results.matches,
          wins: results.wins,
          winRate: results.winRate,
          darts: visits.reduce((s, v) => s + v.darts.length, 0),
          level: computeProgress(visits, matches).level,
        };
      })
      .sort((a, b) => b.wins - a.wins || (b.average3 ?? 0) - (a.average3 ?? 0));
  }

  /** Face-à-face : parties communes et statistiques de chacun dans ces parties. */
  headToHead(a: string, b: string) {
    const pa = this.players.get(a);
    const pb = this.players.get(b);
    const common = this.matches({ playerId: a, opponentId: b }).filter((m) => m.playerIds.length === 2);
    const ids = new Set(common.map((m) => m.matchId));
    const side = (id: string) => {
      const visits = this.visits({ playerId: id, opponentId: id === a ? b : a }).filter((v) => ids.has(v.matchId));
      const matches = this.matches({ playerId: id, opponentId: id === a ? b : a }).filter((m) => ids.has(m.matchId));
      return { x01: x01Summary(visits), results: resultsSummary(matches) };
    };
    return { a: pa, b: pb, matches: common.length, statsA: side(a), statsB: side(b) };
  }
}

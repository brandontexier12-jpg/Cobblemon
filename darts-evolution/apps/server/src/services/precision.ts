import type { GameModeId, PlayerRef } from "@darts-evolution/game-engine";
import { parseJson, type Database } from "../db/database.js";
import { badRequest } from "../errors.js";
import { extractImpacts, summarize, type Impact, type ReplayEvent } from "../precision/analyze.js";
import type { StatsFilter } from "./stats.js";

interface MatchRow {
  id: string;
  mode: GameModeId;
  config: string;
  version: number;
}

/**
 * Carte de précision d'un joueur, sur les parties réelles (simulations et parties abandonnées
 * exclues, comme les autres statistiques) jouées avec Autodarts. Le rejeu d'une partie est mis en
 * cache tant que la partie n'a pas changé (version).
 */
export class PrecisionService {
  private readonly cache = new Map<string, { version: number; impacts: Impact[]; incoherent: number }>();

  constructor(private readonly db: Database) {}

  private matchImpacts(row: MatchRow, playerId: string) {
    const key = `${row.id}:${playerId}`;
    const cached = this.cache.get(key);
    if (cached && cached.version === row.version) return cached;
    const players = this.db
      .all<{ player_id: string; name: string }>("SELECT player_id, name FROM match_players WHERE match_id = $m ORDER BY position", { $m: row.id })
      .map((p): PlayerRef => ({ id: p.player_id, name: p.name }));
    const events = this.db
      .all<{ type: "dart" | "next"; segment: number | null; multiplier: number | null; source: string; x: number | null; y: number | null; created_at: string }>(
        "SELECT type, segment, multiplier, source, x, y, created_at FROM match_events WHERE match_id = $m AND status = 'active' ORDER BY seq, created_at",
        { $m: row.id },
      )
      .map((e): ReplayEvent => ({ type: e.type, segment: e.segment, multiplier: e.multiplier, source: e.source, x: e.x, y: e.y, at: e.created_at }));
    let result: { impacts: Impact[]; incoherent: number };
    try {
      result = extractImpacts(row.mode, parseJson(row.config, {}), players, events, playerId);
    } catch {
      result = { impacts: [], incoherent: 0 };
    }
    const entry = { version: row.version, ...result };
    this.cache.set(key, entry);
    return entry;
  }

  analyze(filter: StatsFilter) {
    if (!filter.playerId) throw badRequest("Choisissez un joueur.");
    const where = [
      "m.is_simulation = 0",
      "m.status <> 'abandoned'",
      "EXISTS (SELECT 1 FROM match_events e WHERE e.match_id = m.id AND e.status = 'active' AND e.source = 'autodarts' AND e.x IS NOT NULL)",
    ];
    const params: Record<string, string> = { $p: filter.playerId };
    if (filter.mode) {
      where.push("m.mode = $mode");
      params.$mode = filter.mode;
    }
    if (filter.opponentId) {
      where.push("EXISTS (SELECT 1 FROM match_players o WHERE o.match_id = m.id AND o.player_id = $opp)");
      params.$opp = filter.opponentId;
    }
    // La période filtre les fléchettes ; on écarte d'emblée les parties terminées avant son début.
    if (filter.from) {
      where.push("(m.finished_at IS NULL OR m.finished_at >= $from)");
      params.$from = filter.from;
    }
    if (filter.to) {
      where.push("m.created_at <= $to");
      params.$to = filter.to;
    }
    const rows = this.db.all<MatchRow>(
      `SELECT m.id, m.mode, m.config, m.version FROM matches m JOIN match_players mp ON mp.match_id = m.id AND mp.player_id = $p WHERE ${where.join(" AND ")}`,
      params,
    );
    const impacts: Impact[] = [];
    let ignored = 0;
    let matches = 0;
    for (const row of rows) {
      const r = this.matchImpacts(row, filter.playerId);
      const kept = r.impacts.filter((i) => (!filter.from || i.at >= filter.from) && (!filter.to || i.at <= filter.to));
      if (kept.length || r.incoherent) matches++;
      impacts.push(...kept);
      ignored += r.incoherent;
    }
    impacts.sort((a, b) => a.at.localeCompare(b.at));
    return summarize(impacts, ignored, matches);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

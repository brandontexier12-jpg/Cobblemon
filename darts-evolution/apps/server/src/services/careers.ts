import { randomInt, randomUUID } from "node:crypto";
import type { GameState, X01State } from "@darts-evolution/game-engine";
import { z } from "zod";
import { eventDef, MONTHS, TIER_LABEL, type Category, type EventDef, type StageFormat } from "../career/catalogue.js";
import {
  advance,
  createCareer,
  customRanges,
  DIFFICULTIES,
  rangesOf,
  rescaleCircuit,
  groupTable,
  HUMAN,
  humanRank,
  moneyOf,
  pendingMatchFormat,
  pendingRoundLabel,
  playerById,
  ranking,
  roundName,
  type CareerState,
  type CircuitPlayer,
  type Fixture,
  type Run,
} from "../career/engine.js";
import { COUNTRIES, countryOf } from "../career/names.js";
import { nowIso, parseJson, type Database } from "../db/database.js";
import { badRequest, conflict, notFound } from "../errors.js";
import type { InputMode, MatchService, MatchSnapshot } from "./matches.js";
import type { PlayerService } from "./players.js";

interface CareerRow {
  id: string;
  player_id: string;
  name: string;
  state: string;
  created_at: string;
  updated_at: string;
}

export const CreateCareerInput = z.object({
  playerId: z.string().uuid(),
  name: z.string().trim().max(60).optional(),
  difficulty: z.enum(["sur_mesure", "debutant", "amateur", "semi_pro", "pro", "legende"]).default("pro"),
  outRule: z.enum(["single", "double"]).default("double"),
  matchLength: z.enum(["reelle", "raccourcie", "courte"]).default("raccourcie"),
  light: z.boolean().default(false),
  start: z.enum(["qschool", "tourcard"]).default("qschool"),
  country: z.string().length(3).default("FRA"),
});

export const SettingsInput = z.object({
  difficulty: z.enum(["sur_mesure", "debutant", "amateur", "semi_pro", "pro", "legende"]).optional(),
  outRule: z.enum(["single", "double"]).optional(),
  matchLength: z.enum(["reelle", "raccourcie", "courte"]).optional(),
});

export const RenameInput = z.object({
  name: z.string().trim().min(2).max(32).optional(),
  nickname: z.string().trim().max(32).optional(),
});

/** Saison de départ : la prochaine (le championnat du monde se joue en décembre). */
function startSeason(): number {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

function flag(code: string): string {
  return countryOf(code)?.flag ?? "🎯";
}

const CATEGORY_LABEL: Record<Category, string> = {
  pdc: "Order of Merit PDC (2 saisons)",
  protour: "Pro Tour (saison)",
  eurotour: "European Tour (saison)",
  pc: "Players Championship (saison)",
  ws: "World Series (saison)",
  challenge: "Challenge Tour (saison)",
  wdf: "Classement WDF (saison)",
};

export class CareerService {
  constructor(
    private readonly db: Database,
    private readonly players: PlayerService,
    private readonly matches: MatchService,
    /** Moyenne X01 actuelle d'un profil (niveau du joueur dans le circuit). */
    private readonly averageOf: (playerId: string) => number | null,
  ) {
    matches.on("updated", (snapshot: MatchSnapshot) => {
      if (snapshot.match.careerId && snapshot.match.status === "abandoned") this.onMatchAbandoned(snapshot);
    });
  }

  private row(id: string): CareerRow {
    const row = this.db.get<CareerRow>("SELECT * FROM careers WHERE id = $id", { $id: id });
    if (!row) throw notFound("Carrière");
    return row;
  }

  private load(id: string): { row: CareerRow; state: CareerState } {
    const row = this.row(id);
    return { row, state: parseJson<CareerState>(row.state, null as never) };
  }

  private save(id: string, state: CareerState): void {
    this.db.run("UPDATE careers SET state = $s, updated_at = $u WHERE id = $id", { $id: id, $s: JSON.stringify(state), $u: nowIso() });
  }

  private refreshHuman(row: CareerRow, state: CareerState): void {
    const me = state.players.find((p) => p.id === HUMAN)!;
    try {
      me.name = this.players.get(row.player_id).name;
    } catch {
      // Profil supprimé : le nom enregistré reste affiché.
    }
    const avg = this.averageOf(row.player_id);
    if (avg) me.rating = Math.round(avg * 10) / 10;
  }

  // ---------- Création, liste ----------

  options() {
    return {
      difficulties: Object.entries(DIFFICULTIES).map(([id, d]) => ({ id, label: d.label, hint: d.hint })),
      countries: COUNTRIES.map((c) => ({ code: c.code, name: c.name, flag: c.flag })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  list() {
    return this.db.all<CareerRow>("SELECT * FROM careers ORDER BY updated_at DESC").map((row) => {
      const state = parseJson<CareerState>(row.state, null as never);
      const me = state.players.find((p) => p.id === HUMAN)!;
      return {
        id: row.id,
        name: row.name,
        playerId: row.player_id,
        playerName: me.name,
        season: state.season,
        difficulty: DIFFICULTIES[state.settings.difficulty].label,
        outRule: state.settings.outRule,
        rank: humanRank(state),
        titles: me.titles,
        card: me.card,
        updatedAt: row.updated_at,
      };
    });
  }

  create(input: unknown) {
    const data = CreateCareerInput.parse(input);
    const player = this.players.get(data.playerId);
    if (player.isGuest || player.archivedAt) throw badRequest("Choisissez un profil de joueur (pas un invité ni un bot).");
    const season = startSeason();
    const average = this.averageOf(player.id);
    const state = createCareer(
      randomInt(2 ** 31),
      {
        difficulty: data.difficulty,
        outRule: data.outRule,
        matchLength: data.matchLength,
        light: data.light,
        start: data.start,
        ...(data.difficulty === "sur_mesure" ? { ranges: customRanges(average ?? 30) } : {}),
      },
      { name: player.name, country: data.country, rating: average ?? 50 },
      season,
    );
    advance(state);
    const id = randomUUID();
    const at = nowIso();
    this.db.run("INSERT INTO careers (id, player_id, name, state, created_at, updated_at) VALUES ($id, $p, $n, $s, $at, $at)", {
      $id: id,
      $p: player.id,
      $n: data.name || `Carrière de ${player.name}`,
      $s: JSON.stringify(state),
      $at: at,
    });
    return this.get(id);
  }

  /**
   * Supprime une carrière. Les matchs terminés restent dans l'historique et les statistiques du
   * joueur ; un match encore en cours est abandonné, pour ne pas rester dans « Parties en cours ».
   */
  /**
   * Réglages d'une carrière en cours. Une nouvelle difficulté recalcule le niveau de tout le
   * circuit (chacun garde son rang relatif) ; tout s'applique aux prochains matchs.
   */
  updateSettings(id: string, input: unknown) {
    const data = SettingsInput.parse(input);
    this.db.transaction(() => {
      const { row, state } = this.load(id);
      if (data.difficulty) {
        const from = rangesOf(state.settings);
        state.settings.difficulty = data.difficulty;
        if (data.difficulty === "sur_mesure") state.settings.ranges = customRanges(this.averageOf(row.player_id) ?? 30);
        else delete state.settings.ranges;
        rescaleCircuit(state, from, rangesOf(state.settings));
      }
      if (data.outRule) state.settings.outRule = data.outRule;
      if (data.matchLength) state.settings.matchLength = data.matchLength;
      this.save(id, state);
    });
    return this.get(id);
  }

  delete(id: string): { abandoned: number } {
    this.row(id);
    const active = this.db.all<{ id: string }>("SELECT id FROM matches WHERE career_id = $c AND status = 'active'", { $c: id });
    for (const m of active) this.matches.command(m.id, { kind: "abandon" });
    this.db.run("DELETE FROM careers WHERE id = $id", { $id: id });
    return { abandoned: active.length };
  }

  // ---------- Déroulement ----------

  /** Crée (ou retrouve) la partie du match à jouer. */
  play(id: string, inputMode: InputMode): { matchId: string } {
    return this.db.transaction(() => {
      const { row, state } = this.load(id);
      const pending = state.pending;
      if (pending?.kind !== "match") throw badRequest("Aucun match à jouer pour l'instant.");
      if (pending.matchId) {
        const status = this.matchStatus(pending.matchId);
        if (status && status !== "abandoned") return { matchId: pending.matchId };
      }
      const level = playerById(state);
      const opp = level.get(pending.opponent)!;
      const bots = (state.bots ??= {});
      const bot = this.players.careerBot(id, bots[opp.id], { name: opp.name, average: opp.rating, avatar: flag(opp.country) });
      bots[opp.id] = bot.id;
      const { format, doubleIn } = pendingMatchFormat(state)!;
      const def = eventDef(state.run!.eventId);
      const snapshot = this.matches.create(
        {
          mode: "x01",
          options: { startScore: 501, inRule: doubleIn ? "double" : "single", outRule: state.settings.outRule, legs: format.legs, sets: format.sets ?? 1 },
          playerIds: pending.humanFirst ? [row.player_id, bot.id] : [bot.id, row.player_id],
          inputMode,
        },
        { careerId: id, label: `${def.name} · ${pendingRoundLabel(state)}` },
      );
      pending.matchId = snapshot.match.id;
      pending.result = null;
      this.save(id, state);
      return { matchId: snapshot.match.id };
    });
  }

  /** Valide le résultat du match (s'il y en a un) et avance jusqu'au prochain arrêt. */
  continue(id: string) {
    this.db.transaction(() => {
      const { row, state } = this.load(id);
      if (state.pending?.kind === "match" && !state.pending.result) {
        throw conflict("Jouez d'abord votre match : le tournoi reprend une fois le résultat connu.", "match_pending");
      }
      this.refreshHuman(row, state);
      advance(state);
      this.save(id, state);
    });
    return this.get(id);
  }

  private matchStatus(matchId: string): string | null {
    return this.db.get<{ status: string }>("SELECT status FROM matches WHERE id = $id", { $id: matchId })?.status ?? null;
  }

  private careerOfMatch(matchId: string): { row: CareerRow; state: CareerState } | null {
    const m = this.db.get<{ career_id: string | null }>("SELECT career_id FROM matches WHERE id = $id", { $id: matchId });
    if (!m?.career_id) return null;
    const row = this.db.get<CareerRow>("SELECT * FROM careers WHERE id = $id", { $id: m.career_id });
    return row ? { row, state: parseJson<CareerState>(row.state, null as never) } : null;
  }

  /** Fin d'un match réel : le résultat est noté, puis validé quand le joueur continue sa carrière. */
  onMatchFinished(snapshot: MatchSnapshot, game: GameState): void {
    if (!snapshot.match.careerId) return;
    const found = this.careerOfMatch(snapshot.match.id);
    if (!found) return;
    const { row, state } = found;
    const pending = state.pending;
    if (pending?.kind !== "match" || pending.matchId !== snapshot.match.id) return;
    const me = snapshot.match.players.findIndex((p) => p.id === row.player_id);
    const opp = me === 0 ? 1 : 0;
    const m = game.m as X01State;
    const format = pendingMatchFormat(state)!.format;
    const score = format.sets && format.sets > 1 ? m.setsWon : m.totalLegsWon;
    pending.result = { won: snapshot.match.winnerIds[0] === row.player_id, me: score[me] ?? 0, opp: score[opp] ?? 0 };
    this.save(row.id, state);
  }

  /** Correction d'un match terminé : possible tant que le résultat n'a pas été validé. */
  onMatchReopened(matchId: string): void {
    const found = this.careerOfMatch(matchId);
    if (!found) return;
    const { row, state } = found;
    const pending = state.pending;
    if (pending?.kind === "match" && pending.matchId === matchId) {
      pending.result = null;
      this.save(row.id, state);
      return;
    }
    throw badRequest("Ce match de carrière est déjà validé : le tournoi a continué, il ne peut plus être modifié.");
  }

  /** Match abandonné : il est simplement à rejouer. */
  private onMatchAbandoned(snapshot: MatchSnapshot): void {
    const found = this.careerOfMatch(snapshot.match.id);
    if (!found) return;
    const pending = found.state.pending;
    if (pending?.kind === "match" && pending.matchId === snapshot.match.id) {
      pending.matchId = null;
      pending.result = null;
      this.save(found.row.id, found.state);
    }
  }

  // ---------- Vues ----------

  private playerInfo(p: CircuitPlayer, ranks?: Map<string, number>) {
    return {
      id: p.id,
      name: p.name,
      nickname: p.nickname,
      country: p.country,
      flag: flag(p.country),
      rating: p.rating,
      card: p.card,
      titles: p.titles,
      human: !!p.human,
      rank: ranks?.get(p.id) ?? null,
    };
  }

  private eventInfo(def: EventDef) {
    return {
      id: def.id,
      name: def.name,
      venue: def.venue,
      city: def.city,
      month: def.month,
      when: def.period ?? MONTHS[def.month - 1],
      tier: def.tier,
      tierLabel: TIER_LABEL[def.tier],
      field: def.field,
      winnerPrize: def.prize[0] ?? 0,
      doubleIn: !!def.doubleIn,
      ranking: def.counts.includes("pdc"),
    };
  }

  private fixtureView(f: Fixture, names: Map<string, CircuitPlayer>) {
    const side = (id: string | null) => (id ? { id, name: names.get(id)?.name ?? "?", flag: flag(names.get(id)?.country ?? ""), human: id === HUMAN } : null);
    return { a: side(f.a), b: side(f.b), sa: f.sa ?? null, sb: f.sb ?? null, avgA: f.avgA ?? null, avgB: f.avgB ?? null, winner: f.winner ?? null, bye: !!f.bye, format: f.format };
  }

  private runView(state: CareerState, run: Run) {
    const def = eventDef(run.eventId);
    const names = playerById(state);
    return {
      key: run.key,
      event: this.eventInfo(def),
      phase: run.phase,
      groups: run.groups.map((g) => ({
        name: g.name,
        table: groupTable(state, g).map((r) => ({ ...r, name: names.get(r.id)?.name ?? "?", flag: flag(names.get(r.id)?.country ?? ""), human: r.id === HUMAN })),
        rounds: g.rounds.map((fixtures) => fixtures.map((f) => this.fixtureView(f, names))),
      })),
      advance: def.structure.kind === "knockout" ? 0 : def.structure.advance,
      rounds: run.rounds.map((fixtures, i) => ({
        name: roundName(2 ** (run.koRounds - i)),
        fixtures: fixtures.filter((f) => !f.bye).map((f) => this.fixtureView(f, names)),
      })),
    };
  }

  private formatLabel(format: StageFormat, doubleIn: boolean, outRule: "single" | "double"): string {
    const legs = format.sets && format.sets > 1 ? `premier à ${format.sets} sets (sets en ${format.legs} legs gagnants)` : `premier à ${format.legs} leg${format.legs > 1 ? "s" : ""}`;
    return `501 · ${legs} · ${doubleIn ? "départ double · " : ""}sortie ${outRule === "double" ? "double" : "simple"}`;
  }

  get(id: string) {
    const { row, state } = this.load(id);
    const names = playerById(state);
    const me = names.get(HUMAN)!;
    const pdc = ranking(state, "pdc");
    const ranks = new Map(pdc.filter((r) => r.money > 0).map((r, i) => [r.id, i + 1]));
    const pending = state.pending;
    let pendingView: unknown = null;
    if (pending?.kind === "match" && state.run) {
      const { format, doubleIn } = pendingMatchFormat(state)!;
      const opp = names.get(pending.opponent)!;
      const status = pending.matchId ? this.matchStatus(pending.matchId) : null;
      pendingView = {
        kind: "match",
        event: this.eventInfo(eventDef(state.run.eventId)),
        round: pendingRoundLabel(state),
        opponent: this.playerInfo(opp, ranks),
        format,
        formatLabel: this.formatLabel(format, doubleIn, state.settings.outRule),
        humanFirst: pending.humanFirst,
        matchId: pending.matchId,
        matchStatus: status,
        result: pending.result,
      };
    } else if (pending?.kind === "event") {
      const result = state.history.find((h) => h.key === pending.key)!;
      pendingView = {
        kind: "event",
        event: this.eventInfo(eventDef(result.eventId)),
        result: { ...result, winnerName: names.get(result.winner)?.name, runnerUpName: names.get(result.runnerUp)?.name },
      };
    } else if (pending?.kind === "season") {
      pendingView = {
        kind: "season",
        season: pending.season,
        rank: humanRank(state),
        money: moneyOf(state, HUMAN, "pdc"),
        seasonMoney: this.seasonMoney(state),
        titles: state.history.filter((h) => h.season === state.season && h.winner === HUMAN).map((h) => eventDef(h.eventId).name),
        cardUntil: me.cardUntil,
        card: me.card,
      };
    }
    // Tournoi affiché : celui en cours, sinon le dernier où le joueur était engagé.
    const lastRunKey = pending?.kind === "event" ? pending.key : null;
    const calendar = state.calendar.map((eid, i) => {
      const def = eventDef(eid);
      const h = state.history.find((x) => x.key === `${state.season}-${eid}`);
      return {
        ...this.eventInfo(def),
        status: h ? "done" : state.run?.eventId === eid ? "current" : i < state.eventIndex ? "done" : "upcoming",
        winner: h ? { name: names.get(h.winner)?.name ?? "?", flag: flag(names.get(h.winner)?.country ?? ""), human: h.winner === HUMAN } : null,
        final: h?.final ?? null,
        human: h?.human ?? null,
      };
    });
    return {
      id: row.id,
      name: row.name,
      playerId: row.player_id,
      createdAt: row.created_at,
      season: state.season,
      settings: { ...state.settings, difficultyLabel: DIFFICULTIES[state.settings.difficulty].label, ranges: rangesOf(state.settings) },
      me: {
        ...this.playerInfo(me, ranks),
        cardUntil: me.cardUntil,
        money: moneyOf(state, HUMAN, "pdc"),
        seasonMoney: this.seasonMoney(state),
        proTourRank: humanRank(state, "protour"),
        challengeRank: humanRank(state, "challenge"),
        profile: this.profileLook(row.player_id),
      },
      pending: pendingView,
      run: state.run ? this.runView(state, state.run) : null,
      lastEvent: lastRunKey ? this.lastEventSummary(state, lastRunKey) : null,
      feed: state.history.slice(state.feedFrom).map((h) => ({
        event: eventDef(h.eventId).name,
        winner: names.get(h.winner)?.name ?? "?",
        flag: flag(names.get(h.winner)?.country ?? ""),
        final: h.final,
        runnerUp: names.get(h.runnerUp)?.name ?? "?",
      })),
      calendar,
    };
  }

  /** Gains de la saison, tous tournois confondus (y compris ceux qui ne comptent pour aucun classement). */
  /** Avatar du profil (photo, emoji, couleur), affiché dans la carte du prochain match. */
  private profileLook(playerId: string): { avatar: string; color: string; photo: string | null } | null {
    try {
      const p = this.players.get(playerId);
      return { avatar: p.avatar, color: p.color, photo: p.photo };
    } catch {
      return null;
    }
  }

  private seasonMoney(state: CareerState): number {
    return state.history.filter((h) => h.season === state.season && h.human).reduce((s, h) => s + h.human!.prize, 0);
  }

  private lastEventSummary(state: CareerState, key: string) {
    const h = state.history.find((x) => x.key === key);
    if (!h) return null;
    const names = playerById(state);
    return { ...h, event: this.eventInfo(eventDef(h.eventId)), winnerName: names.get(h.winner)?.name ?? "?", runnerUpName: names.get(h.runnerUp)?.name ?? "?" };
  }

  rankings(id: string, cat: Category, limit = 100) {
    const { state } = this.load(id);
    const names = playerById(state);
    const list = ranking(state, cat).filter((r) => r.money > 0);
    const rows = list.map((r, i) => ({ ...this.playerInfo(names.get(r.id)!), rank: i + 1, money: r.money }));
    const mine = rows.find((r) => r.id === HUMAN) ?? null;
    return { category: cat, label: CATEGORY_LABEL[cat], rows: rows.slice(0, limit), me: mine, total: rows.length };
  }

  circuit(id: string) {
    const { state } = this.load(id);
    const ranks = new Map(ranking(state, "pdc").filter((r) => r.money > 0).map((r, i) => [r.id, i + 1]));
    return state.players
      .filter((p) => !p.retired)
      .map((p) => ({ ...this.playerInfo(p, ranks), age: p.age, money: moneyOf(state, p.id, "pdc") }))
      .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || b.rating - a.rating);
  }

  history(id: string) {
    const { state } = this.load(id);
    const names = playerById(state);
    const mine = state.history.filter((h) => h.human);
    const best = new Map<string, { eventId: string; name: string; best: string; stage: number; wins: number }>();
    for (const h of mine) {
      const def = eventDef(h.eventId);
      const groupKey = def.tier === "players" ? "players" : def.tier === "challenge" ? "challenge" : def.id;
      const cur = best.get(groupKey);
      const stage = h.human!.stage;
      const label = def.tier === "players" ? "Players Championships" : def.tier === "challenge" ? "Challenge Tour" : def.name;
      if (!cur) best.set(groupKey, { eventId: def.id, name: label, best: h.human!.label, stage, wins: stage === 0 ? 1 : 0 });
      else {
        if (stage < cur.stage) Object.assign(cur, { best: h.human!.label, stage });
        if (stage === 0) cur.wins++;
      }
    }
    return {
      titles: mine.filter((h) => h.winner === HUMAN).map((h) => ({ season: h.season, event: eventDef(h.eventId).name, final: h.final, runnerUp: names.get(h.runnerUp)?.name ?? "?" })),
      bestResults: [...best.values()].sort((a, b) => a.stage - b.stage),
      seasons: state.seasons.map((s) => ({ ...s, top: s.top.slice(0, 5).map((t) => ({ name: names.get(t.id)?.name ?? "?", flag: flag(names.get(t.id)?.country ?? ""), money: t.money, human: t.id === HUMAN })) })),
      events: [...mine].reverse().map((h) => ({ season: h.season, event: eventDef(h.eventId).name, label: h.human!.label, prize: h.human!.prize, card: h.human!.card ?? null })),
    };
  }

  /** Renomme un joueur du circuit (par exemple pour lui donner le nom d'un vrai joueur). */
  renamePlayer(id: string, playerId: string, input: unknown) {
    const data = RenameInput.parse(input);
    this.db.transaction(() => {
      const { state } = this.load(id);
      const p = state.players.find((x) => x.id === playerId && !x.human);
      if (!p) throw notFound("Joueur du circuit");
      if (data.name && state.players.some((x) => x.id !== p.id && x.name.toLowerCase() === data.name!.toLowerCase())) throw badRequest("Un autre joueur du circuit porte déjà ce nom.");
      if (data.name) p.name = data.name;
      if (data.nickname !== undefined) p.nickname = data.nickname;
      this.save(id, state);
    });
    return this.circuit(id).find((p) => p.id === playerId);
  }
}

import { dartScore } from "@darts-evolution/shared";
import type { ModeRules } from "../types.js";
import { average3, bestPlayers, nextIndex } from "./helpers.js";

/* ------------------------------------------------------------------ */
/* Count-up : premier joueur à atteindre (ou dépasser) le total visé.  */
/* ------------------------------------------------------------------ */

export interface CountUpConfig {
  target: number;
}

export interface TotalsState {
  totals: number[];
}

export const countUp: ModeRules<CountUpConfig, TotalsState> = {
  id: "count_up",
  init(_config, players) {
    return { playerIndex: 0, m: { totals: Array(players.length).fill(0) } };
  },
  onDart(ctx, dart) {
    const m = structuredClone(ctx.m);
    const points = dartScore(dart);
    m.totals[ctx.playerIndex] = (m.totals[ctx.playerIndex] as number) + points;
    if ((m.totals[ctx.playerIndex] as number) >= ctx.config.target) {
      return { m, points, endVisit: "win", finished: { winners: [ctx.players[ctx.playerIndex]!.id] } };
    }
    return { m, points };
  },
  onVisitComplete(ctx) {
    return { m: ctx.m, record: {} };
  },
  advance(ctx) {
    const next = nextIndex(ctx.playerIndex, ctx.players.length);
    return { m: ctx.m, playerIndex: next, round: next === 0 ? ctx.round + 1 : ctx.round };
  },
  view(state) {
    return {
      headline: `Count-up · objectif ${state.config.target} · Manche ${state.turn.round}`,
      players: state.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        main: String(state.m.totals[i]),
        mainLabel: "Total",
        details: [
          { label: "Reste", value: String(Math.max(0, state.config.target - (state.m.totals[i] as number))) },
          { label: "Moy. 3 fl.", value: average3(state.visits.filter((v) => v.playerId === p.id)) },
        ],
        winner: state.winners.includes(p.id),
      })),
    };
  },
};

/* ------------------------------------------------------------------ */
/* High Score : nombre de manches fixe, le plus haut total gagne.      */
/* ------------------------------------------------------------------ */

export interface HighScoreConfig {
  rounds: number;
}

export const highScore: ModeRules<HighScoreConfig, TotalsState> = {
  id: "high_score",
  init(_config, players) {
    return { playerIndex: 0, m: { totals: Array(players.length).fill(0) } };
  },
  onDart(ctx, dart) {
    const m = structuredClone(ctx.m);
    const points = dartScore(dart);
    m.totals[ctx.playerIndex] = (m.totals[ctx.playerIndex] as number) + points;
    return { m, points };
  },
  onVisitComplete(ctx) {
    const last = ctx.playerIndex === ctx.players.length - 1 && ctx.round >= ctx.config.rounds;
    if (last) {
      const winners = ctx.players.length > 1 ? bestPlayers(ctx.m.totals, ctx.players.map((p) => p.id)) : [];
      return { m: ctx.m, record: {}, finished: { winners } };
    }
    return { m: ctx.m, record: {} };
  },
  advance(ctx) {
    const next = nextIndex(ctx.playerIndex, ctx.players.length);
    return { m: ctx.m, playerIndex: next, round: next === 0 ? ctx.round + 1 : ctx.round };
  },
  view(state) {
    return {
      headline: `High Score · Manche ${Math.min(state.turn.round, state.config.rounds)}/${state.config.rounds}`,
      players: state.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        main: String(state.m.totals[i]),
        mainLabel: "Total",
        details: [{ label: "Moy. 3 fl.", value: average3(state.visits.filter((v) => v.playerId === p.id)) }],
        winner: state.winners.includes(p.id),
      })),
    };
  },
};

/* ------------------------------------------------------------------ */
/* Échauffement : lancer librement un nombre de fléchettes fixé.       */
/* ------------------------------------------------------------------ */

export interface WarmupConfig {
  /** Nombre de fléchettes de la séance (100, 200, 300…). */
  darts: number;
}

export interface WarmupState {
  totals: number[];
  darts: number[];
  bestVisit: number[];
  /** Visites à 100 et plus, 140 et plus, et 180. */
  tons: number[];
  ton40: number[];
  max: number[];
}

function warmupDone(config: WarmupConfig, m: WarmupState, i: number): boolean {
  return (m.darts[i] as number) >= config.darts;
}

export const warmup: ModeRules<WarmupConfig, WarmupState> = {
  id: "warmup",
  init(_config, players) {
    const zeros = () => Array(players.length).fill(0);
    return { playerIndex: 0, m: { totals: zeros(), darts: zeros(), bestVisit: zeros(), tons: zeros(), ton40: zeros(), max: zeros() } };
  },
  onDart(ctx, dart) {
    const m = structuredClone(ctx.m);
    const i = ctx.playerIndex;
    const points = dartScore(dart);
    m.totals[i] = (m.totals[i] as number) + points;
    m.darts[i] = (m.darts[i] as number) + 1;
    if (!warmupDone(ctx.config, m, i)) return { m, points };
    // Dernière fléchette du joueur : sa visite s'arrête là (même avant la 3e fléchette).
    const all = ctx.players.every((_, j) => warmupDone(ctx.config, m, j));
    if (!all) return { m, points, endVisit: "done" };
    const winners = ctx.players.length > 1 ? bestPlayers(m.totals, ctx.players.map((p) => p.id)) : [];
    return { m, points, endVisit: "done", finished: { winners } };
  },
  onVisitComplete(ctx) {
    const m = structuredClone(ctx.m);
    const i = ctx.playerIndex;
    const visit = ctx.visitDarts.reduce((s, d) => s + d.points, 0);
    m.bestVisit[i] = Math.max(m.bestVisit[i] as number, visit);
    if (visit >= 100) m.tons[i] = (m.tons[i] as number) + 1;
    if (visit >= 140) m.ton40[i] = (m.ton40[i] as number) + 1;
    if (visit === 180) m.max[i] = (m.max[i] as number) + 1;
    return { m, record: {} };
  },
  advance(ctx) {
    // Les joueurs qui ont lancé toutes leurs fléchettes ne jouent plus.
    let next = ctx.playerIndex;
    let round = ctx.round;
    for (let k = 0; k < ctx.players.length; k++) {
      next = nextIndex(next, ctx.players.length);
      if (next === 0) round++;
      if (!warmupDone(ctx.config, ctx.m, next)) break;
    }
    return { m: ctx.m, playerIndex: next, round };
  },
  view(state) {
    const i = state.turn.playerIndex;
    const left = Math.max(0, state.config.darts - (state.m.darts[i] as number));
    return {
      headline: `Échauffement · ${state.config.darts} fléchettes`,
      instruction: state.finished ? undefined : left <= 3 ? `Dernière volée : ${left} fléchette${left > 1 ? "s" : ""}` : `Lancez librement : encore ${left} fléchettes`,
      players: state.players.map((p, j) => ({
        id: p.id,
        name: p.name,
        main: String(state.m.darts[j]),
        mainLabel: `fléchettes sur ${state.config.darts}`,
        details: [
          { label: "Score", value: String(state.m.totals[j]) },
          { label: "Moy. 3 fl.", value: average3(state.visits.filter((v) => v.playerId === p.id)) },
          { label: "Meilleure visite", value: String(state.m.bestVisit[j]) },
          { label: "100+ / 140+ / 180", value: `${state.m.tons[j]} / ${state.m.ton40[j]} / ${state.m.max[j]}` },
        ],
        winner: state.winners.includes(p.id),
      })),
    };
  },
};

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

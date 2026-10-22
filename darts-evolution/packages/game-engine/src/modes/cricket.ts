import { BULL } from "@darts-evolution/shared";
import type { ModeRules } from "../types.js";
import { bestPlayers, nextIndex } from "./helpers.js";

export interface CricketConfig {
  variant: "standard" | "cut_throat";
  /** Nombre maximal de manches (0 = illimité). */
  maxRounds: number;
}

export interface CricketState {
  /** marks[joueur][numéro] plafonné à 3 (numéro fermé). */
  marks: number[][];
  points: number[];
  /** Marques comptées (y compris marques de score), pour la moyenne de marques par manche. */
  totalMarks: number[];
  visitPointsStart: number[] | null;
}

export const CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15, BULL] as const;

function closedAll(m: CricketState, idx: number): boolean {
  return m.marks.every((row) => (row[idx] as number) >= 3);
}

function allClosed(m: CricketState, player: number): boolean {
  return (m.marks[player] as number[]).every((v) => v >= 3);
}

function isWinner(m: CricketState, player: number, variant: CricketConfig["variant"]): boolean {
  if (!allClosed(m, player)) return false;
  const own = m.points[player] as number;
  return m.points.every((p, j) => j === player || (variant === "standard" ? own >= p : own <= p));
}

const MARK_SYMBOL = ["", "/", "X", "Ⓧ"];

export const cricket: ModeRules<CricketConfig, CricketState> = {
  id: "cricket",

  init(_config, players) {
    const n = players.length;
    return {
      playerIndex: 0,
      m: {
        marks: Array.from({ length: n }, () => Array(CRICKET_NUMBERS.length).fill(0)),
        points: Array(n).fill(0),
        totalMarks: Array(n).fill(0),
        visitPointsStart: null,
      },
    };
  },

  onDart(ctx, dart) {
    const m = structuredClone(ctx.m);
    const i = ctx.playerIndex;
    if (ctx.visitDarts.length === 0) m.visitPointsStart = [...m.points];
    const idx = (CRICKET_NUMBERS as readonly number[]).indexOf(dart.segment);
    if (idx < 0 || dart.multiplier === 0) return { m, points: 0, hit: false, marks: 0 };
    if (closedAll(m, idx)) return { m, points: 0, hit: true, marks: 0 };
    const hits = dart.multiplier; // bull extérieur = 1 marque, bull intérieur = 2 marques
    const row = m.marks[i] as number[];
    const applied = Math.min(3 - (row[idx] as number), hits);
    const extra = hits - applied;
    row[idx] = (row[idx] as number) + applied;
    const value = CRICKET_NUMBERS[idx] as number;
    let points = 0;
    if (extra > 0) {
      if (ctx.config.variant === "standard") {
        const someOpen = m.marks.some((r, j) => j !== i && (r[idx] as number) < 3);
        if (someOpen) {
          points = extra * value;
          m.points[i] = (m.points[i] as number) + points;
        }
      } else {
        m.marks.forEach((r, j) => {
          if (j !== i && (r[idx] as number) < 3) {
            m.points[j] = (m.points[j] as number) + extra * value;
            points += extra * value;
          }
        });
      }
    }
    const counted = applied + (points > 0 ? extra : 0);
    m.totalMarks[i] = (m.totalMarks[i] as number) + counted;
    if (isWinner(m, i, ctx.config.variant)) {
      return { m, points, hit: true, marks: counted, endVisit: "win", finished: { winners: [ctx.players[i]!.id] } };
    }
    return { m, points, hit: true, marks: counted };
  },

  onVisitComplete(ctx) {
    const m = structuredClone(ctx.m);
    const marks = ctx.visitDarts.reduce((sum, d) => sum + (d.marks ?? 0), 0);
    const points = ctx.visitDarts.reduce((sum, d) => sum + d.points, 0);
    m.visitPointsStart = null;
    const n = ctx.players.length;
    const lastOfRound = ctx.playerIndex === n - 1;
    if (ctx.config.maxRounds > 0 && ctx.round >= ctx.config.maxRounds && lastOfRound) {
      const ids = ctx.players.map((p) => p.id);
      let winners = bestPlayers(m.points, ids, ctx.config.variant === "standard");
      if (winners.length > 1) {
        // Égalité de points : départage au nombre de numéros fermés puis de marques.
        const eligible = ids.map((id) => winners.includes(id));
        winners = bestPlayers(m.totalMarks, ids, true, eligible);
      }
      return { m, record: { points, marks, hits: marks }, finished: { winners } };
    }
    return { m, record: { points, marks, hits: marks } };
  },

  advance(ctx) {
    const n = ctx.players.length;
    const next = nextIndex(ctx.playerIndex, n);
    return { m: ctx.m, playerIndex: next, round: next === 0 ? ctx.round + 1 : ctx.round };
  },

  view(state) {
    const { m, players, config, turn } = state;
    const columns = players.map((p) => p.name);
    const rows = CRICKET_NUMBERS.map((num, idx) => ({
      key: String(num),
      label: num === BULL ? "Bull" : String(num),
      cells: players.map((_, i) => MARK_SYMBOL[Math.min(3, m.marks[i]![idx] as number)] ?? ""),
      closedByAll: closedAll(m, idx),
    }));
    const roundsDone = Math.max(1, turn.round);
    const view = players.map((p, i) => {
      const own = state.visits.filter((v) => v.playerId === p.id);
      const mpr = own.length ? (m.totalMarks[i]! / own.length).toFixed(2) : "–";
      return {
        id: p.id,
        name: p.name,
        main: String(m.points[i]),
        mainLabel: config.variant === "cut_throat" ? "Points (le moins gagne)" : "Points",
        details: [
          { label: "Fermés", value: `${m.marks[i]!.filter((v) => v >= 3).length}/7` },
          { label: "Marques/manche", value: mpr },
        ],
        winner: state.winners.includes(p.id),
      };
    });
    const limit = config.maxRounds > 0 ? `/${config.maxRounds}` : "";
    return {
      headline: `Cricket ${config.variant === "cut_throat" ? "Cut-throat" : "classique"} · Manche ${roundsDone}${limit}`,
      players: view,
      board: { columns, rows },
    };
  },
};

import { BULL, type Dart } from "@darts-evolution/shared";
import type { DartContext, DartOutcome, ModeRules } from "../types.js";
import {
  bestPlayers,
  hitsTarget,
  isLastActiveInRound,
  nextActive,
  nextIndex,
  percent,
  targetLabel,
  type Ring,
} from "./helpers.js";

function roundRobin(playerIndex: number, round: number, count: number) {
  const next = nextIndex(playerIndex, count);
  return { playerIndex: next, round: next === 0 ? round + 1 : round };
}

/* ------------------------------------------------------------------ */
/* Around the Clock : 1 → 20 (puis bull) dans l'ordre.                 */
/* ------------------------------------------------------------------ */

export interface AroundTheClockConfig {
  ring: Exclude<Ring, "outer_bull" | "inner_bull">;
  includeBull: boolean;
  /** Avec « any » : un double avance de 2 cases, un triple de 3. */
  skipOnMultiplier: boolean;
}

export interface ProgressState {
  position: number[];
  darts: number[];
  hits: number[];
}

function atcTargets(config: AroundTheClockConfig): number[] {
  const list = Array.from({ length: 20 }, (_, i) => i + 1);
  if (config.includeBull) list.push(BULL);
  return list;
}

export const aroundTheClock: ModeRules<AroundTheClockConfig, ProgressState> = {
  id: "around_the_clock",
  init(_config, players) {
    const n = players.length;
    return { playerIndex: 0, m: { position: Array(n).fill(0), darts: Array(n).fill(0), hits: Array(n).fill(0) } };
  },
  onDart(ctx, dart) {
    const m = structuredClone(ctx.m);
    const i = ctx.playerIndex;
    const targets = atcTargets(ctx.config);
    const segment = targets[m.position[i] as number] as number;
    const spec = { segment, ring: ctx.config.ring };
    const target = targetLabel(spec);
    m.darts[i] = (m.darts[i] as number) + 1;
    const hit = hitsTarget(dart, spec);
    if (!hit) return { m, points: 0, hit: false, target };
    m.hits[i] = (m.hits[i] as number) + 1;
    const last = targets.length - 1;
    const pos = m.position[i] as number;
    if (pos >= last) {
      m.position[i] = targets.length;
      return { m, points: 1, hit: true, target, endVisit: "win", finished: { winners: [ctx.players[i]!.id] } };
    }
    const step = ctx.config.ring === "any" && ctx.config.skipOnMultiplier && segment !== BULL ? dart.multiplier : 1;
    m.position[i] = Math.min(pos + step, last);
    return { m, points: 1, hit: true, target };
  },
  onVisitComplete(ctx) {
    const hits = ctx.visitDarts.filter((d) => d.hit).length;
    return { m: ctx.m, record: { hits, attempts: ctx.visitDarts.length } };
  },
  advance(ctx) {
    return { m: ctx.m, ...roundRobin(ctx.playerIndex, ctx.round, ctx.players.length) };
  },
  view(state) {
    const targets = atcTargets(state.config);
    const current = state.m.position[state.turn.playerIndex] as number;
    const currentTarget =
      current < targets.length ? targetLabel({ segment: targets[current] as number, ring: state.config.ring }) : undefined;
    return {
      headline: `Around the Clock · Manche ${state.turn.round}`,
      target: currentTarget,
      instruction: currentTarget ? `Visez ${currentTarget}` : undefined,
      players: state.players.map((p, i) => {
        const pos = state.m.position[i] as number;
        const label = pos >= targets.length ? "Terminé" : targetLabel({ segment: targets[pos] as number, ring: state.config.ring });
        return {
          id: p.id,
          name: p.name,
          main: label,
          mainLabel: "Cible",
          details: [
            { label: "Progression", value: `${Math.min(pos, targets.length)}/${targets.length}` },
            { label: "Fléchettes", value: String(state.m.darts[i]) },
            { label: "Réussite", value: percent(state.m.hits[i] as number, state.m.darts[i] as number) },
          ],
          winner: state.winners.includes(p.id),
        };
      }),
    };
  },
};

/* ------------------------------------------------------------------ */
/* Around the World : une manche par numéro (1 à 20 puis bull).        */
/* Chaque touche du numéro de la manche rapporte son multiplicateur.   */
/* ------------------------------------------------------------------ */

export interface AroundTheWorldConfig {
  includeBull: boolean;
}

export interface PointsState {
  points: number[];
  hits: number[];
  darts: number[];
}

function atwRounds(config: AroundTheWorldConfig) {
  return config.includeBull ? 21 : 20;
}

function atwTarget(round: number): number {
  return round <= 20 ? round : BULL;
}

export const aroundTheWorld: ModeRules<AroundTheWorldConfig, PointsState> = {
  id: "around_the_world",
  init(_config, players) {
    const n = players.length;
    return { playerIndex: 0, m: { points: Array(n).fill(0), hits: Array(n).fill(0), darts: Array(n).fill(0) } };
  },
  onDart(ctx, dart) {
    const m = structuredClone(ctx.m);
    const i = ctx.playerIndex;
    const segment = atwTarget(ctx.round);
    const target = segment === BULL ? "Bull" : String(segment);
    m.darts[i] = (m.darts[i] as number) + 1;
    const hit = dart.segment === segment && dart.multiplier > 0;
    if (!hit) return { m, points: 0, hit: false, target };
    m.hits[i] = (m.hits[i] as number) + 1;
    m.points[i] = (m.points[i] as number) + dart.multiplier;
    return { m, points: dart.multiplier, hit: true, target };
  },
  onVisitComplete(ctx) {
    const hits = ctx.visitDarts.filter((d) => d.hit).length;
    const record = { hits, attempts: ctx.visitDarts.length };
    if (ctx.round >= atwRounds(ctx.config) && ctx.playerIndex === ctx.players.length - 1) {
      const winners = ctx.players.length > 1 ? bestPlayers(ctx.m.points, ctx.players.map((p) => p.id)) : [];
      return { m: ctx.m, record, finished: { winners } };
    }
    return { m: ctx.m, record };
  },
  advance(ctx) {
    return { m: ctx.m, ...roundRobin(ctx.playerIndex, ctx.round, ctx.players.length) };
  },
  view(state) {
    const total = atwRounds(state.config);
    const segment = atwTarget(Math.min(state.turn.round, total));
    const target = segment === BULL ? "Bull" : String(segment);
    return {
      headline: `Around the World · Manche ${Math.min(state.turn.round, total)}/${total}`,
      target,
      instruction: `Visez le ${target} (simple = 1, double = 2, triple = 3 points)`,
      players: state.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        main: String(state.m.points[i]),
        mainLabel: "Points",
        details: [
          { label: "Touches", value: String(state.m.hits[i]) },
          { label: "Réussite", value: percent(state.m.hits[i] as number, state.m.darts[i] as number) },
        ],
        winner: state.winners.includes(p.id),
      })),
    };
  },
};

/* ------------------------------------------------------------------ */
/* Shanghai : manche N = numéro N ; simple + double + triple = victoire. */
/* ------------------------------------------------------------------ */

export interface ShanghaiConfig {
  rounds: number;
  instantWin: boolean;
}

export const shanghai: ModeRules<ShanghaiConfig, PointsState> = {
  id: "shanghai",
  init(_config, players) {
    const n = players.length;
    return { playerIndex: 0, m: { points: Array(n).fill(0), hits: Array(n).fill(0), darts: Array(n).fill(0) } };
  },
  onDart(ctx, dart) {
    const m = structuredClone(ctx.m);
    const i = ctx.playerIndex;
    const segment = ctx.round;
    const target = String(segment);
    m.darts[i] = (m.darts[i] as number) + 1;
    const hit = dart.segment === segment && dart.multiplier > 0;
    if (!hit) return { m, points: 0, hit: false, target };
    const points = segment * dart.multiplier;
    m.hits[i] = (m.hits[i] as number) + 1;
    m.points[i] = (m.points[i] as number) + points;
    if (ctx.config.instantWin) {
      const multipliers = new Set([...ctx.visitDarts.filter((d) => d.hit).map((d) => d.multiplier), dart.multiplier]);
      if (multipliers.has(1) && multipliers.has(2) && multipliers.has(3)) {
        return { m, points, hit: true, target, endVisit: "win", finished: { winners: [ctx.players[i]!.id] } };
      }
    }
    return { m, points, hit: true, target };
  },
  onVisitComplete(ctx) {
    const hits = ctx.visitDarts.filter((d) => d.hit).length;
    const record = { hits, attempts: ctx.visitDarts.length };
    if (ctx.round >= ctx.config.rounds && ctx.playerIndex === ctx.players.length - 1) {
      const winners = ctx.players.length > 1 ? bestPlayers(ctx.m.points, ctx.players.map((p) => p.id)) : [];
      return { m: ctx.m, record, finished: { winners } };
    }
    return { m: ctx.m, record };
  },
  advance(ctx) {
    return { m: ctx.m, ...roundRobin(ctx.playerIndex, ctx.round, ctx.players.length) };
  },
  view(state) {
    const round = Math.min(state.turn.round, state.config.rounds);
    return {
      headline: `Shanghai · Manche ${round}/${state.config.rounds}`,
      target: String(round),
      instruction: `Visez le ${round}${state.config.instantWin ? " — simple, double et triple dans la même visite = Shanghai !" : ""}`,
      players: state.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        main: String(state.m.points[i]),
        mainLabel: "Points",
        details: [{ label: "Réussite", value: percent(state.m.hits[i] as number, state.m.darts[i] as number) }],
        winner: state.winners.includes(p.id),
      })),
    };
  },
};

/* ------------------------------------------------------------------ */
/* Bob's 27 : doubles 1 à 20 (option bull), départ à 27 points.        */
/* ------------------------------------------------------------------ */

export interface Bobs27Config {
  includeBull: boolean;
}

export interface Bobs27State {
  scores: number[];
  eliminated: boolean[];
  /** Manche de fin pour chaque joueur (éliminé ou terminé), 0 si en cours. */
  endedRound: number[];
  hits: number[];
  darts: number[];
}

function bobsRounds(config: Bobs27Config) {
  return config.includeBull ? 21 : 20;
}

function bobsTarget(round: number): number {
  return round <= 20 ? round : BULL;
}

export const bobs27: ModeRules<Bobs27Config, Bobs27State> = {
  id: "bobs_27",
  init(_config, players) {
    const n = players.length;
    return {
      playerIndex: 0,
      m: {
        scores: Array(n).fill(27),
        eliminated: Array(n).fill(false),
        endedRound: Array(n).fill(0),
        hits: Array(n).fill(0),
        darts: Array(n).fill(0),
      },
    };
  },
  onDart(ctx, dart) {
    const m = structuredClone(ctx.m);
    const i = ctx.playerIndex;
    const segment = bobsTarget(ctx.round);
    const target = segment === BULL ? "Bull" : `D${segment}`;
    m.darts[i] = (m.darts[i] as number) + 1;
    const hit = dart.segment === segment && dart.multiplier === 2;
    if (!hit) return { m, points: 0, hit: false, target };
    m.hits[i] = (m.hits[i] as number) + 1;
    const value = segment * 2;
    m.scores[i] = (m.scores[i] as number) + value;
    return { m, points: value, hit: true, target };
  },
  onVisitComplete(ctx) {
    const m = structuredClone(ctx.m);
    const i = ctx.playerIndex;
    const hits = ctx.visitDarts.filter((d) => d.hit).length;
    const value = bobsTarget(ctx.round) * 2;
    let points = ctx.visitDarts.reduce((s, d) => s + d.points, 0);
    if (hits === 0) {
      m.scores[i] = (m.scores[i] as number) - value;
      points = -value;
      if ((m.scores[i] as number) < 0) {
        m.eliminated[i] = true;
        m.endedRound[i] = ctx.round;
      }
    }
    const lastRound = ctx.round >= bobsRounds(ctx.config);
    if (lastRound && !m.eliminated[i]) m.endedRound[i] = ctx.round;
    const active = m.eliminated.map((e) => !e);
    const noneLeft = active.every((a) => !a);
    const roundOver = lastRound && isLastActiveInRound(i, active);
    const record = { hits, attempts: ctx.visitDarts.length, points, remainingAfter: m.scores[i] as number };
    if (noneLeft || roundOver) {
      const ids = ctx.players.map((p) => p.id);
      const survivors = m.eliminated.map((e) => !e);
      const winners = ctx.players.length > 1 && survivors.some(Boolean) ? bestPlayers(m.scores, ids, true, survivors) : [];
      return { m, record, finished: { winners } };
    }
    return { m, record };
  },
  advance(ctx) {
    const active = ctx.m.eliminated.map((e) => !e);
    const { index, wrapped } = nextActive(ctx.playerIndex, active);
    return { m: ctx.m, playerIndex: index, round: wrapped ? ctx.round + 1 : ctx.round };
  },
  view(state) {
    const total = bobsRounds(state.config);
    const segment = bobsTarget(Math.min(state.turn.round, total));
    const target = segment === BULL ? "Bull" : `D${segment}`;
    return {
      headline: `Bob's 27 · Manche ${Math.min(state.turn.round, total)}/${total}`,
      target,
      instruction: `Visez ${target} : +${segment * 2} par touche, −${segment * 2} si aucune touche`,
      players: state.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        main: String(state.m.scores[i]),
        mainLabel: "Score",
        details: [
          { label: "Doubles touchés", value: String(state.m.hits[i]) },
          { label: "Réussite", value: percent(state.m.hits[i] as number, state.m.darts[i] as number) },
        ],
        eliminated: state.m.eliminated[i],
        winner: state.winners.includes(p.id),
      })),
    };
  },
};

/* ------------------------------------------------------------------ */
/* Killer : chaque joueur a un numéro. Règle courante (« remplissage ») : */
/* on remplit son numéro jusqu'à N vies pour devenir Killer, puis on    */
/* retire des vies aux adversaires ; le dernier en jeu gagne.          */
/* ------------------------------------------------------------------ */

export interface KillerConfig {
  /**
   * « remplissage » (règle courante, par défaut) : on part de 0, chaque touche de son numéro ajoute des
   * vies (simple 1, double 2, triple 3) jusqu'à `lives` : on est alors Killer. Un Killer touché qui
   * repasse sous `lives` perd son statut ; un joueur touché sans vie restante est éliminé.
   * « classique » : on part avec `lives` vies et un seul double de son numéro fait Killer.
   * Absent : partie créée avant l'ajout du remplissage (règle classique).
   */
  variant?: "remplissage" | "classique";
  lives: number;
  zone: "double" | "any";
  selfPenalty: boolean;
  /** Numéro attribué à chaque joueur (même ordre que les joueurs). */
  numbers: number[];
  /** Remplissage : personne ne peut être éliminé pendant le premier tour. */
  firstRoundProtection?: boolean;
}

export interface KillerState {
  lives: number[];
  killer: boolean[];
  /** Remplissage : joueurs éliminés (0 vie ne suffit pas à être éliminé). */
  out?: boolean[];
}

/** Données d'affichage du Killer (cible colorée, roue du tirage). */
export interface KillerView {
  variant: "remplissage" | "classique";
  /** Vies pour être Killer (remplissage) ou vies de départ (classique). */
  max: number;
  players: { id: string; number: number; lives: number; killer: boolean; eliminated: boolean }[];
}

const isRefill = (config: KillerConfig) => config.variant === "remplissage";
const outOf = (config: KillerConfig, m: KillerState, j: number) => (isRefill(config) ? !!m.out?.[j] : (m.lives[j] as number) === 0);

function killerOnDartClassic(ctx: DartContext<KillerConfig, KillerState>, dart: Dart): DartOutcome<KillerState> {
  const m = structuredClone(ctx.m);
  const i = ctx.playerIndex;
  const { numbers, zone, selfPenalty } = ctx.config;
  const own = numbers[i] as number;
  const inZone = zone === "double" ? dart.multiplier === 2 : dart.multiplier >= 1;
  const damage = zone === "double" ? 1 : dart.multiplier;
  const target = m.killer[i] ? "Adversaires" : `D${own}`;
  if (!inZone || dart.segment < 1 || dart.segment > 20) return { m, points: 0, hit: false, target };
  let hit = false;
  if (dart.segment === own) {
    hit = true;
    if (!m.killer[i]) {
      m.killer[i] = true;
    } else if (selfPenalty) {
      m.lives[i] = Math.max(0, (m.lives[i] as number) - damage);
    }
  } else if (m.killer[i]) {
    const victim = numbers.findIndex((n, j) => n === dart.segment && j !== i && (m.lives[j] as number) > 0);
    if (victim >= 0) {
      hit = true;
      m.lives[victim] = Math.max(0, (m.lives[victim] as number) - damage);
    }
  }
  const alive = m.lives.map((l) => l > 0);
  if (alive.filter(Boolean).length <= 1) {
    const winnerIndex = alive.indexOf(true);
    const winners = winnerIndex >= 0 ? [ctx.players[winnerIndex]!.id] : [];
    return { m, points: hit ? 1 : 0, hit, target, endVisit: "win", finished: { winners } };
  }
  if ((m.lives[i] as number) === 0) return { m, points: 0, hit, target, endVisit: "eliminated" };
  return { m, points: hit ? 1 : 0, hit, target };
}

function killerOnDartRefill(ctx: DartContext<KillerConfig, KillerState>, dart: Dart): DartOutcome<KillerState> {
  const m = structuredClone(ctx.m);
  const out = m.out ?? Array(m.lives.length).fill(false);
  m.out = out;
  const i = ctx.playerIndex;
  const { numbers, zone, selfPenalty, lives: max } = ctx.config;
  const own = numbers[i] as number;
  const amount = zone === "double" ? 1 : dart.multiplier;
  const valid = dart.segment >= 1 && dart.segment <= 20 && (zone === "double" ? dart.multiplier === 2 : dart.multiplier >= 1);
  const target = m.killer[i] ? "Numéros adverses" : zone === "double" ? `D${own}` : String(own);
  if (!valid) return { m, points: 0, hit: false, target };
  let hit = false;
  if (dart.segment === own) {
    if (!m.killer[i]) {
      hit = true;
      m.lives[i] = Math.min(max, (m.lives[i] as number) + amount);
      if ((m.lives[i] as number) >= max) m.killer[i] = true;
    } else if (selfPenalty) {
      hit = true;
      const left = (m.lives[i] as number) - amount;
      m.lives[i] = Math.max(0, left);
      m.killer[i] = false;
      if (left < 0) out[i] = true;
    }
  } else if (m.killer[i]) {
    const victim = numbers.findIndex((n, j) => n === dart.segment && j !== i && !out[j]);
    if (victim >= 0) {
      hit = true;
      const left = (m.lives[victim] as number) - amount;
      const protectedRound = ctx.config.firstRoundProtection !== false && ctx.round === 1;
      if (left < 0 && !protectedRound) {
        out[victim] = true;
        m.lives[victim] = 0;
      } else {
        m.lives[victim] = Math.max(0, left);
      }
      if ((m.lives[victim] as number) < max) m.killer[victim] = false;
    }
  }
  const alive = out.map((o) => !o);
  if (alive.filter(Boolean).length <= 1) {
    const winnerIndex = alive.indexOf(true);
    return { m, points: hit ? amount : 0, hit, target, endVisit: "win", finished: { winners: winnerIndex >= 0 ? [ctx.players[winnerIndex]!.id] : [] } };
  }
  if (out[i]) return { m, points: 0, hit, target, endVisit: "eliminated" };
  return { m, points: hit ? amount : 0, hit, target };
}

export const killer: ModeRules<KillerConfig, KillerState> = {
  id: "killer",
  init(config, players) {
    const n = players.length;
    if (isRefill(config)) return { playerIndex: 0, m: { lives: Array(n).fill(0), killer: Array(n).fill(false), out: Array(n).fill(false) } };
    return { playerIndex: 0, m: { lives: Array(n).fill(config.lives), killer: Array(n).fill(false) } };
  },
  onDart(ctx, dart) {
    return isRefill(ctx.config) ? killerOnDartRefill(ctx, dart) : killerOnDartClassic(ctx, dart);
  },
  onVisitComplete(ctx) {
    const hits = ctx.visitDarts.filter((d) => d.hit).length;
    return { m: ctx.m, record: { hits, attempts: ctx.visitDarts.length } };
  },
  advance(ctx) {
    const active = ctx.m.lives.map((_, j) => !outOf(ctx.config, ctx.m, j));
    const { index, wrapped } = nextActive(ctx.playerIndex, active);
    return { m: ctx.m, playerIndex: index, round: wrapped ? ctx.round + 1 : ctx.round };
  },
  view(state) {
    const { config, m } = state;
    const i = state.turn.playerIndex;
    const own = config.numbers[i] as number;
    const refill = isRefill(config);
    const killerView: KillerView = {
      variant: refill ? "remplissage" : "classique",
      max: config.lives,
      players: state.players.map((p, j) => ({
        id: p.id,
        number: config.numbers[j] as number,
        lives: m.lives[j] as number,
        killer: m.killer[j] as boolean,
        eliminated: outOf(config, m, j),
      })),
    };
    const zoneText = config.zone === "double" ? "doubles" : "simple 1 · double 2 · triple 3";
    if (!refill) {
      return {
        headline: `Killer · ${config.lives} vies · zone ${config.zone === "double" ? "double" : "tout le numéro"}`,
        target: m.killer[i] ? "Numéros adverses" : `D${own}`,
        instruction: m.killer[i]
          ? "Vous êtes Killer : touchez les numéros adverses pour leur retirer des vies"
          : `Touchez ${config.zone === "double" ? "le double" : "le secteur"} ${own} pour devenir Killer`,
        killer: killerView,
        players: state.players.map((p, j) => ({
          id: p.id,
          name: p.name,
          main: String(config.numbers[j]),
          mainLabel: "Numéro",
          details: [
            { label: "Vies", value: "♥".repeat(m.lives[j] as number) || "0" },
            { label: "Statut", value: m.killer[j] ? "Killer" : "En attente" },
          ],
          flag: m.killer[j] && (m.lives[j] as number) > 0 ? "KILLER" : undefined,
          eliminated: (m.lives[j] as number) === 0,
          winner: state.winners.includes(p.id),
        })),
      };
    }
    const lives = m.lives[i] as number;
    return {
      headline: `Killer · ${config.lives} vies pour devenir Killer · ${zoneText}`,
      target: m.killer[i] ? "Numéros adverses" : config.zone === "double" ? `D${own}` : String(own),
      instruction: m.killer[i]
        ? `KILLER : touchez les numéros adverses pour leur retirer des vies (${zoneText})`
        : `Remplissez votre ${own} : ${lives}/${config.lives} vies (${config.zone === "double" ? "doubles seulement" : "simple +1, double +2, triple +3"})`,
      killer: killerView,
      players: state.players.map((p, j) => {
        const l = m.lives[j] as number;
        const isOut = !!m.out?.[j];
        return {
          id: p.id,
          name: p.name,
          main: String(config.numbers[j]),
          mainLabel: "Numéro",
          details: [
            { label: "Vies", value: `${"♥".repeat(l)}${"♡".repeat(Math.max(0, config.lives - l))}` },
            { label: "Statut", value: isOut ? "Éliminé" : m.killer[j] ? "KILLER" : `${l}/${config.lives}` },
          ],
          flag: m.killer[j] && !isOut ? "KILLER" : undefined,
          eliminated: isOut,
          winner: state.winners.includes(p.id),
        };
      }),
    };
  },
};

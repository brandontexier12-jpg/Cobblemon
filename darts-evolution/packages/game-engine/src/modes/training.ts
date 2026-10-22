import { BULL, dartScore } from "@darts-evolution/shared";
import { evaluateOut, isOneDartFinish, suggestCheckouts, type InOutRule } from "../checkout.js";
import type { GameModeId, ModeRules } from "../types.js";
import { bestPlayers, hitsTarget, nextActive, percent, targetLabel, type TargetSpec } from "./helpers.js";

/* ------------------------------------------------------------------ */
/* Entraînement à cible : doubles, triples, bull, exercices perso.     */
/* ------------------------------------------------------------------ */

export interface TargetPracticeConfig {
  /** Nom de l'exercice (exercices personnalisés). */
  name?: string;
  /** Liste ordonnée des cibles (ordre définitif, déjà mélangé si demandé). */
  targets: TargetSpec[];
  /** « fixed » : N fléchettes par cible. « until_hit » : on reste sur la cible jusqu'à la toucher. */
  progression: "fixed" | "until_hit";
  dartsPerTarget: number;
  /** Plafond de fléchettes par cible en mode « until_hit » (0 = illimité). */
  maxDartsPerTarget: number;
  /** Objectif chiffré de réussite en % (optionnel, affiché et comparé en fin de séance). */
  goalPercent?: number;
}

export interface TargetPracticeState {
  position: number[];
  dartsOnTarget: number[];
  hits: number[];
  darts: number[];
  points: number[];
  done: boolean[];
  /** Touches et fléchettes par cible (pour la comparaison de séances). */
  perTarget: { hits: number; darts: number }[][];
}

function makeTargetPractice(id: GameModeId, title: string): ModeRules<TargetPracticeConfig, TargetPracticeState> {
  return {
    id,
    init(config, players) {
      const n = players.length;
      return {
        playerIndex: 0,
        m: {
          position: Array(n).fill(0),
          dartsOnTarget: Array(n).fill(0),
          hits: Array(n).fill(0),
          darts: Array(n).fill(0),
          points: Array(n).fill(0),
          done: Array(n).fill(false),
          perTarget: Array.from({ length: n }, () => config.targets.map(() => ({ hits: 0, darts: 0 }))),
        },
      };
    },
    onDart(ctx, dart) {
      const m = structuredClone(ctx.m);
      const i = ctx.playerIndex;
      const { config } = ctx;
      const pos = m.position[i] as number;
      const spec = config.targets[pos] as TargetSpec;
      const target = targetLabel(spec);
      const hit = hitsTarget(dart, spec);
      const stats = m.perTarget[i]![pos]!;
      stats.darts += 1;
      m.darts[i] = (m.darts[i] as number) + 1;
      m.dartsOnTarget[i] = (m.dartsOnTarget[i] as number) + 1;
      // Au bull, on compte les points (25 / 50) ; ailleurs, une touche vaut 1.
      const points = hit ? (spec.segment === BULL ? dartScore(dart) : 1) : 0;
      if (hit) {
        stats.hits += 1;
        m.hits[i] = (m.hits[i] as number) + 1;
        m.points[i] = (m.points[i] as number) + points;
      }
      const reachedLimit =
        config.progression === "fixed"
          ? (m.dartsOnTarget[i] as number) >= config.dartsPerTarget
          : hit || (config.maxDartsPerTarget > 0 && (m.dartsOnTarget[i] as number) >= config.maxDartsPerTarget);
      if (reachedLimit) {
        m.position[i] = pos + 1;
        m.dartsOnTarget[i] = 0;
        if (pos + 1 >= config.targets.length) {
          m.done[i] = true;
          return { m, points, hit, target, endVisit: "done" };
        }
      }
      return { m, points, hit, target };
    },
    onVisitComplete(ctx) {
      const hits = ctx.visitDarts.filter((d) => d.hit).length;
      const record = { hits, attempts: ctx.visitDarts.length };
      if (ctx.m.done.every(Boolean)) {
        const ids = ctx.players.map((p) => p.id);
        let winners: string[] = [];
        if (ctx.players.length > 1) {
          winners =
            ctx.config.progression === "fixed"
              ? bestPlayers(ctx.m.points, ids, true)
              : bestPlayers(ctx.m.darts, ids, false);
        }
        return { m: ctx.m, record, finished: { winners } };
      }
      return { m: ctx.m, record };
    },
    advance(ctx) {
      const active = ctx.m.done.map((d) => !d);
      const { index, wrapped } = nextActive(ctx.playerIndex, active);
      return { m: ctx.m, playerIndex: index, round: wrapped ? ctx.round + 1 : ctx.round };
    },
    view(state) {
      const { config, m, turn } = state;
      const i = turn.playerIndex;
      const pos = m.position[i] as number;
      const spec = config.targets[Math.min(pos, config.targets.length - 1)] as TargetSpec;
      const target = m.done[i] ? undefined : targetLabel(spec);
      const remainingDarts =
        config.progression === "fixed" ? config.dartsPerTarget - (m.dartsOnTarget[i] as number) : null;
      const isBull = config.targets.every((t) => t.segment === BULL);
      return {
        headline: `${config.name ?? title} · Cible ${Math.min(pos + 1, config.targets.length)}/${config.targets.length}`,
        target,
        instruction: target
          ? remainingDarts !== null
            ? `Visez ${target} — encore ${remainingDarts} fléchette${remainingDarts > 1 ? "s" : ""} sur cette cible`
            : `Visez ${target} jusqu'à le toucher`
          : "Exercice terminé",
        players: state.players.map((p, j) => ({
          id: p.id,
          name: p.name,
          main: percent(m.hits[j] as number, m.darts[j] as number),
          mainLabel: "Réussite",
          details: [
            { label: "Touches", value: `${m.hits[j]}/${m.darts[j]}` },
            ...(isBull ? [{ label: "Points", value: String(m.points[j]) }] : []),
            { label: "Progression", value: `${Math.min(m.position[j] as number, config.targets.length)}/${config.targets.length}` },
            ...(config.goalPercent ? [{ label: "Objectif", value: `${config.goalPercent} %` }] : []),
          ],
          eliminated: false,
          winner: state.winners.includes(p.id),
        })),
      };
    },
  };
}

export const doublesTraining = makeTargetPractice("doubles_training", "Entraînement doubles");
export const triplesTraining = makeTargetPractice("triples_training", "Entraînement triples");
export const bullTraining = makeTargetPractice("bull_training", "Entraînement bull");
export const customTraining = makeTargetPractice("custom_training", "Exercice personnalisé");

/* ------------------------------------------------------------------ */
/* Entraînement checkout : terminer des scores donnés.                 */
/* ------------------------------------------------------------------ */

export interface CheckoutTrainingConfig {
  /** Scores à terminer, dans l'ordre. */
  targets: number[];
  /** Nombre de visites (3 fléchettes) autorisées par score. */
  visitsPerTarget: number;
  outRule: InOutRule;
}

export interface CheckoutTrainingState {
  position: number[];
  remaining: number[];
  visitsOnTarget: number[];
  successes: number[];
  attempts: number[];
  darts: number[];
  done: boolean[];
  visitStart: number | null;
  results: { target: number; success: boolean; darts: number }[][];
  dartsOnTarget: number[];
}

export const checkoutTraining: ModeRules<CheckoutTrainingConfig, CheckoutTrainingState> = {
  id: "checkout_training",
  init(config, players) {
    const n = players.length;
    return {
      playerIndex: 0,
      m: {
        position: Array(n).fill(0),
        remaining: Array(n).fill(config.targets[0]),
        visitsOnTarget: Array(n).fill(0),
        successes: Array(n).fill(0),
        attempts: Array(n).fill(0),
        darts: Array(n).fill(0),
        done: Array(n).fill(false),
        visitStart: null,
        results: Array.from({ length: n }, () => []),
        dartsOnTarget: Array(n).fill(0),
      },
    };
  },
  onDart(ctx, dart) {
    const m = structuredClone(ctx.m);
    const i = ctx.playerIndex;
    const before = m.remaining[i] as number;
    if (ctx.visitDarts.length === 0) m.visitStart = before;
    m.darts[i] = (m.darts[i] as number) + 1;
    m.dartsOnTarget[i] = (m.dartsOnTarget[i] as number) + 1;
    const checkoutAttempt = ctx.config.outRule !== "single" && isOneDartFinish(before, ctx.config.outRule);
    const points = dartScore(dart);
    const result = evaluateOut(before - points, dart, ctx.config.outRule);
    const target = String(ctx.config.targets[m.position[i] as number]);
    if (result === "bust") {
      m.remaining[i] = m.visitStart ?? before;
      return { m, points, checkoutAttempt, target, hit: false, endVisit: "bust" };
    }
    m.remaining[i] = before - points;
    if (result === "checkout") return { m, points, checkoutAttempt, target, hit: true, endVisit: "checkout" };
    return { m, points, checkoutAttempt, target, hit: false };
  },
  onVisitComplete(ctx) {
    const m = structuredClone(ctx.m);
    const i = ctx.playerIndex;
    const start = m.visitStart ?? (m.remaining[i] as number);
    const success = ctx.endReason === "checkout";
    const bust = ctx.endReason === "bust";
    m.visitsOnTarget[i] = (m.visitsOnTarget[i] as number) + 1;
    const record = {
      bust,
      checkout: success,
      remainingBefore: start,
      remainingAfter: m.remaining[i] as number,
      points: bust ? 0 : start - (m.remaining[i] as number),
      hits: success ? 1 : 0,
      attempts: 0,
    };
    if (success || (m.visitsOnTarget[i] as number) >= ctx.config.visitsPerTarget) {
      const pos = m.position[i] as number;
      m.attempts[i] = (m.attempts[i] as number) + 1;
      record.attempts = 1;
      if (success) m.successes[i] = (m.successes[i] as number) + 1;
      m.results[i]!.push({ target: ctx.config.targets[pos] as number, success, darts: m.dartsOnTarget[i] as number });
      m.dartsOnTarget[i] = 0;
      m.visitsOnTarget[i] = 0;
      m.position[i] = pos + 1;
      if (pos + 1 >= ctx.config.targets.length) {
        m.done[i] = true;
      } else {
        m.remaining[i] = ctx.config.targets[pos + 1] as number;
      }
    }
    m.visitStart = null;
    if (m.done.every(Boolean)) {
      const ids = ctx.players.map((p) => p.id);
      const winners = ctx.players.length > 1 ? bestPlayers(m.successes, ids, true) : [];
      return { m, record, finished: { winners } };
    }
    return { m, record };
  },
  advance(ctx) {
    const active = ctx.m.done.map((d) => !d);
    const { index, wrapped } = nextActive(ctx.playerIndex, active);
    return { m: ctx.m, playerIndex: index, round: wrapped ? ctx.round + 1 : ctx.round };
  },
  view(state) {
    const { m, config, turn } = state;
    const i = turn.playerIndex;
    const pos = Math.min(m.position[i] as number, config.targets.length - 1);
    let checkout = null;
    if (!state.finished && !turn.complete && !m.done[i]) {
      const dartsLeft = 3 - turn.darts.length;
      const remaining = m.remaining[i] as number;
      const routes = suggestCheckouts(remaining, { outRule: config.outRule, dartsLeft, limit: 3 });
      checkout = { remaining, dartsLeft, routes: routes.map((r) => r.display) };
    }
    return {
      headline: `Entraînement checkout · Score ${pos + 1}/${config.targets.length} · ${config.visitsPerTarget} visite${config.visitsPerTarget > 1 ? "s" : ""} par score`,
      target: m.done[i] ? undefined : String(config.targets[pos]),
      instruction: m.done[i] ? "Exercice terminé" : `Terminez ${m.remaining[i]}`,
      checkout,
      players: state.players.map((p, j) => ({
        id: p.id,
        name: p.name,
        main: String(m.done[j] ? "✓" : m.remaining[j]),
        mainLabel: "Restant",
        details: [
          { label: "Réussis", value: `${m.successes[j]}/${m.attempts[j]}` },
          { label: "Taux", value: percent(m.successes[j] as number, m.attempts[j] as number) },
        ],
        winner: state.winners.includes(p.id),
      })),
    };
  },
};

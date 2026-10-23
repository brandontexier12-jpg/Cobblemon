import { BOARD_RADII, classifyPoint, segmentAngle, type BoardPoint, type Dart } from "@darts-evolution/shared";
import { suggestCheckouts, type InOutRule } from "./checkout.js";
import { CRICKET_NUMBERS, type CricketState } from "./modes/cricket.js";
import type { KillerConfig, KillerState } from "./modes/target-games.js";
import type { CheckoutTrainingConfig, CheckoutTrainingState } from "./modes/training.js";
import type { X01Config, X01State } from "./modes/x01.js";
import type { GameState } from "./types.js";
import { describeGame } from "./view.js";

/**
 * Adversaires virtuels (bots). Un bot vise une case selon la situation de jeu (comme un joueur) et
 * sa fléchette s'écarte du point visé selon une dispersion gaussienne propre à son niveau.
 */

/** Niveaux proposés : moyenne visée sur 3 fléchettes. */
export const BOT_AVERAGES = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 110, 120, 135, 150, 170] as const;

export function botLevelLabel(average: number): string {
  if (average < 20) return "Initiation";
  if (average < 35) return "Débutant";
  if (average < 50) return "Loisir";
  if (average < 65) return "Club";
  if (average < 80) return "Confirmé";
  if (average < 95) return "Régional";
  if (average < 110) return "National";
  if (average < 135) return "Pro";
  return "Légende";
}

export type AimRing = "triple" | "double" | "single" | "bull" | "outerBull";

export interface Aim {
  segment: number;
  ring: AimRing;
}

const R = BOARD_RADII;

/** Point visé (repère de la cible : centre 0, double extérieur = 1, y vers le 20). */
export function aimPoint(aim: Aim): BoardPoint {
  if (aim.segment === 25) {
    if (aim.ring === "outerBull") return { x: 0, y: (R.bull + R.outerBull) / 2 };
    return { x: 0, y: 0 };
  }
  const radius =
    aim.ring === "triple" ? (R.tripleInner + R.tripleOuter) / 2 : aim.ring === "double" ? (R.doubleInner + R.doubleOuter) / 2 : (R.tripleOuter + R.doubleInner) / 2;
  const a = (segmentAngle(aim.segment) * Math.PI) / 180;
  return { x: Math.sin(a) * radius, y: Math.cos(a) * radius };
}

/** Tirage gaussien (Box-Muller). */
function gaussianPair(rng: () => number): [number, number] {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  const r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
}

export interface BotDart {
  dart: Dart;
  coords: BoardPoint;
}

/** Une fléchette lancée vers `target` avec la dispersion `sigma`. */
export function throwAt(target: BoardPoint, sigma: number, rng: () => number): BotDart {
  const [gx, gy] = gaussianPair(rng);
  const coords = { x: Number((target.x + gx * sigma).toFixed(4)), y: Number((target.y + gy * sigma).toFixed(4)) };
  const { ring: _ring, ...dart } = classifyPoint(coords);
  return { dart, coords };
}

// ---------- Calibration ----------

/**
 * Dispersion (écart type du point d'impact, en rayons de cible) de chaque niveau. Calibrée hors ligne
 * par simulation de legs de 501 en double sortie, fléchettes de sortie et busts compris : la moyenne
 * réelle d'un bot sur un leg correspond à son niveau (à ±2 % près). En 501, la moyenne maximale
 * possible est de 167 (leg en 9 fléchettes) : le niveau 170 joue au maximum.
 */
const SIGMAS: Record<number, number> = {
  10: 0.43479, 15: 0.33154, 20: 0.26139, 25: 0.20192, 30: 0.17042, 35: 0.14411, 40: 0.12188, 45: 0.10931, 50: 0.09575, 55: 0.08666,
  60: 0.07949, 65: 0.07254, 70: 0.06549, 75: 0.06015, 80: 0.05522, 85: 0.05072, 90: 0.04614, 95: 0.04139,
  100: 0.03859, 110: 0.03137, 120: 0.02648, 135: 0.02021, 150: 0.01461, 170: 0.003,
};

/**
 * Même calibration en sortie simple : sans double à trouver, un bot finit bien plus vite, sa
 * dispersion doit donc être plus grande pour que sa moyenne réelle reste celle de son niveau.
 */
const SIGMAS_SINGLE: Record<number, number> = {
  10: 0.94043, 15: 0.69263, 20: 0.50753, 25: 0.38643, 30: 0.29016, 35: 0.20642, 40: 0.1583, 45: 0.12974, 50: 0.1127,
  55: 0.09968, 60: 0.09019, 65: 0.08193, 70: 0.07539, 75: 0.06874, 80: 0.06207, 85: 0.05633, 90: 0.05172, 95: 0.04671,
  100: 0.0419, 110: 0.03464, 120: 0.02803, 135: 0.02073, 150: 0.0149, 170: 0.002,
};

/** Dispersion d'un bot pour une moyenne visée sur 3 fléchettes (interpolée entre les niveaux). */
export function botSigma(average: number, outRule: InOutRule = "double"): number {
  const table = outRule === "single" ? SIGMAS_SINGLE : SIGMAS;
  const levels = Object.keys(table).map(Number).sort((x, y) => x - y);
  const avg = Math.min(levels[levels.length - 1]!, Math.max(levels[0]!, average));
  for (let i = 1; i < levels.length; i++) {
    const lo = levels[i - 1]!;
    const hi = levels[i]!;
    if (avg <= hi) {
      const t = (avg - lo) / (hi - lo);
      return Math.exp(Math.log(table[lo]!) + t * (Math.log(table[hi]!) - Math.log(table[lo]!)));
    }
  }
  return table[levels[levels.length - 1]!]!;
}

/** Règle de sortie de la partie (la calibration en dépend). */
function outRuleOf(state: GameState): InOutRule {
  if (state.mode === "x01") return (state.config as X01Config).outRule;
  if (state.mode === "checkout_training") return (state.config as CheckoutTrainingConfig).outRule;
  return "double";
}

// ---------- Choix de la cible ----------

const LEAVES = [40, 32, 36, 24, 16, 20, 8, 12, 4, 2];

/** Fléchette de placement : laisse un double confortable sans risquer le bust. */
function setupAim(remaining: number, outRule: InOutRule): Aim {
  if (outRule === "single") return remaining > 60 ? { segment: 20, ring: "triple" } : remaining > 20 ? { segment: 20, ring: "single" } : { segment: remaining, ring: "single" };
  if (remaining >= 62) {
    // Triple qui laisse un double (de préférence un double « rond »).
    const good = (left: number) => LEAVES.includes(left) || (left >= 2 && left <= 40 && left % 2 === 0);
    for (const segment of [20, 19, 18, 17, 16, 15]) if (good(remaining - segment * 3)) return { segment, ring: "triple" };
    return remaining - 60 >= 2 ? { segment: 20, ring: "triple" } : { segment: 19, ring: "triple" };
  }
  for (const leave of LEAVES) {
    const single = remaining - leave;
    if (single >= 1 && single <= 20) return { segment: single, ring: "single" };
    if (single === 25) return { segment: 25, ring: "outerBull" };
  }
  return { segment: 1, ring: "single" };
}

function aimFromDart(d: Dart): Aim {
  if (d.segment === 25) return { segment: 25, ring: d.multiplier === 2 ? "bull" : "outerBull" };
  return { segment: d.segment, ring: d.multiplier === 3 ? "triple" : d.multiplier === 2 ? "double" : "single" };
}

export function checkoutAim(remaining: number, outRule: InOutRule, dartsLeft: number, extra: { strategy?: X01Config["checkoutStrategy"]; favoriteDouble?: number } = {}): Aim {
  if (remaining > 170 || remaining < 2) return remaining > 170 ? { segment: 20, ring: "triple" } : setupAim(remaining, outRule);
  const routes = suggestCheckouts(remaining, { outRule, dartsLeft, strategy: extra.strategy, favoriteDouble: extra.favoriteDouble, limit: 1 });
  const first = routes[0]?.darts[0];
  return first ? aimFromDart(first) : setupAim(remaining, outRule);
}

/** Libellé de cible d'un mode (« T20 », « D16 », « S5 », « 5 », « Bull », « 25 ») → case visée. */
export function aimFromLabel(label: string | undefined, preferTriple: boolean): Aim | null {
  if (!label) return null;
  if (label === "Bull") return { segment: 25, ring: "bull" };
  if (label === "25") return { segment: 25, ring: "outerBull" };
  if (label.startsWith("Bull")) return { segment: 25, ring: "bull" };
  const m = /^([SDT])?(\d{1,2})$/.exec(label);
  if (!m) return null;
  const segment = Number(m[2]);
  if (segment < 1 || segment > 20) return null;
  const ring: AimRing = m[1] === "D" ? "double" : m[1] === "T" ? "triple" : m[1] === "S" ? "single" : preferTriple ? "triple" : "single";
  return { segment, ring };
}

/** Case que vise le joueur dont c'est le tour. */
export function chooseAim(state: GameState): Aim {
  const i = state.turn.playerIndex;
  const dartsLeft = Math.max(1, 3 - state.turn.darts.length);
  switch (state.mode) {
    case "x01": {
      const config = state.config as X01Config;
      const m = state.m as X01State;
      if (!m.opened[i]) return config.inRule === "master" ? { segment: 20, ring: "triple" } : { segment: 20, ring: "double" };
      return checkoutAim(m.remaining[i] as number, config.outRule, dartsLeft, { strategy: config.checkoutStrategy, favoriteDouble: config.favoriteDouble });
    }
    case "checkout_training": {
      const config = state.config as CheckoutTrainingConfig;
      const m = state.m as CheckoutTrainingState;
      return checkoutAim(m.remaining[i] as number, config.outRule, dartsLeft);
    }
    case "cricket": {
      const m = state.m as CricketState;
      const mine = m.marks[i] as number[];
      const open = CRICKET_NUMBERS.findIndex((_, k) => (mine[k] as number) < 3 && !m.marks.every((row) => (row[k] as number) >= 3));
      const scoring = CRICKET_NUMBERS.findIndex((_, k) => (mine[k] as number) >= 3 && m.marks.some((row) => (row[k] as number) < 3));
      const k = open >= 0 ? open : scoring;
      const segment = k >= 0 ? (CRICKET_NUMBERS[k] as number) : 20;
      return segment === 25 ? { segment: 25, ring: "bull" } : { segment, ring: "triple" };
    }
    case "count_up":
    case "high_score":
    case "warmup":
      return { segment: 20, ring: "triple" };
    case "killer": {
      const config = state.config as KillerConfig;
      const m = state.m as KillerState;
      const ring: AimRing = config.zone === "double" ? "double" : "triple";
      const isOut = (j: number) => (config.variant === "remplissage" ? !!m.out?.[j] : (m.lives[j] as number) === 0);
      if (!m.killer[i]) return { segment: config.numbers[i] as number, ring: config.variant === "remplissage" ? ring : "double" };
      // Killer : d'abord les autres Killers (les plus dangereux), puis l'adversaire le plus faible.
      const victims = config.numbers
        .map((n, j) => ({ n, j }))
        .filter(({ j }) => j !== i && !isOut(j))
        .sort((a, b) => Number(m.killer[b.j]) - Number(m.killer[a.j]) || (m.lives[a.j] as number) - (m.lives[b.j] as number));
      return victims[0] ? { segment: victims[0].n, ring } : { segment: 20, ring: "triple" };
    }
    default: {
      // Modes à cible : la cible affichée au joueur.
      const target = describeGame(state).current.target;
      return aimFromLabel(target, state.mode === "shanghai" || state.mode === "around_the_world") ?? { segment: 20, ring: "triple" };
    }
  }
}

/** Prochaine fléchette d'un bot de moyenne `average` dans la partie `state`. */
export function botThrow(state: GameState, average: number, rng: () => number = Math.random): BotDart & { aim: Aim } {
  const aim = chooseAim(state);
  return { ...throwAt(aimPoint(aim), botSigma(average, outRuleOf(state)), rng), aim };
}

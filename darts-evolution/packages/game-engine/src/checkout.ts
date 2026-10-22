import { BULL, dartDisplay, dartLabel, dartScore, SCORING_DARTS, type Dart } from "@darts-evolution/shared";

export type InOutRule = "single" | "double" | "master";
export type CheckoutStrategy = "classique" | "bull" | "double_favori";

export interface CheckoutOptions {
  outRule: InOutRule;
  /** Fléchettes restantes dans la visite (1 à 3). */
  dartsLeft?: number;
  strategy?: CheckoutStrategy;
  /** Double préféré (1 à 20, ou 25 pour le bull) pour la stratégie « double_favori ». */
  favoriteDouble?: number;
  /** Nombre maximal de propositions. */
  limit?: number;
}

export interface CheckoutRoute {
  darts: Dart[];
  /** Libellés techniques (T20, D16, BULL…). */
  labels: string[];
  /** Libellés affichés (T20, D16, Bull…). */
  display: string[];
}

/** La fléchette peut-elle terminer un leg selon la règle de sortie ? */
export function isFinishingDart(d: Dart, outRule: InOutRule): boolean {
  if (d.multiplier === 0) return false;
  if (outRule === "single") return true;
  if (outRule === "double") return d.multiplier === 2;
  return d.multiplier === 2 || d.multiplier === 3;
}

/** La fléchette ouvre-t-elle le score selon la règle de départ ? */
export function isOpeningDart(d: Dart, inRule: InOutRule): boolean {
  if (d.multiplier === 0) return false;
  if (inRule === "single") return true;
  if (inRule === "double") return d.multiplier === 2;
  return d.multiplier === 2 || d.multiplier === 3;
}

export type OutResult = "continue" | "bust" | "checkout";

/**
 * Résultat d'une fléchette qui laisse `after` points, selon la règle de sortie.
 * - Simple sortie : bust si le score passe sous zéro.
 * - Double sortie : bust si négatif, s'il reste 1, ou si zéro est atteint sans double.
 * - Master sortie : idem avec double ou triple autorisé pour terminer.
 */
export function evaluateOut(after: number, dart: Dart, outRule: InOutRule): OutResult {
  if (after < 0) return "bust";
  if (after === 0) return isFinishingDart(dart, outRule) ? "checkout" : "bust";
  if (after === 1 && outRule !== "single") return "bust";
  return "continue";
}

/** Une sortie en une seule fléchette existe-t-elle pour ce score ? */
export function isOneDartFinish(remaining: number, outRule: InOutRule): boolean {
  return SCORING_DARTS.some((d) => dartScore(d) === remaining && isFinishingDart(d, outRule));
}

// Coût d'une fléchette de sortie (plus petit = préféré). Ordre classique des doubles.
const DOUBLE_PREFERENCE = [20, 16, 8, 10, 18, 12, 4, 6, 14, 2, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1];

function finishCost(d: Dart, options: CheckoutOptions): number {
  const strategy = options.strategy ?? "classique";
  if (strategy === "double_favori" && options.favoriteDouble !== undefined) {
    if (d.multiplier === 2 && d.segment === options.favoriteDouble) return -5;
  }
  if (d.segment === BULL) {
    if (strategy === "bull" && d.multiplier === 2) return -5;
    return d.multiplier === 2 ? 14 : 16;
  }
  if (d.multiplier === 2) return DOUBLE_PREFERENCE.indexOf(d.segment) * 0.5;
  if (d.multiplier === 3) return 12 + (20 - d.segment) * 0.2;
  // Simple sortie : un simple est la cible la plus large.
  return 1 + (20 - d.segment) * 0.05;
}

function setupCost(d: Dart): number {
  if (d.segment === BULL) return d.multiplier === 2 ? 9 : 8;
  if (d.multiplier === 3) {
    if (d.segment === 20) return 0;
    if (d.segment === 19) return 0.6;
    if (d.segment === 18) return 1.2;
    if (d.segment === 17) return 1.8;
    return 3 + (20 - d.segment) * 0.15;
  }
  if (d.multiplier === 1) return 1 + (20 - d.segment) * 0.1;
  return 10 + (20 - d.segment) * 0.1; // un double en préparation est risqué
}

const memo = new Map<string, CheckoutRoute[]>();

function routeKey(darts: Dart[]): string {
  const setup = darts.slice(0, -1).map(dartLabel).sort().join("+");
  return `${setup}>${dartLabel(darts[darts.length - 1] as Dart)}`;
}

/**
 * Propose des chemins de sortie valides, du meilleur au moins bon.
 * Retourne une liste vide si le score est impossible à terminer avec les fléchettes restantes.
 */
export function suggestCheckouts(remaining: number, options: CheckoutOptions): CheckoutRoute[] {
  const dartsLeft = Math.max(1, Math.min(3, options.dartsLeft ?? 3));
  const limit = options.limit ?? 3;
  if (!Number.isInteger(remaining) || remaining < 1 || remaining > 180) return [];
  if (options.outRule !== "single" && remaining === 1) return [];
  const key = `${remaining}|${options.outRule}|${dartsLeft}|${options.strategy ?? "classique"}|${options.favoriteDouble ?? ""}`;
  const cached = memo.get(key);
  if (cached) return cached.slice(0, limit);

  const finishers = SCORING_DARTS.filter((d) => isFinishingDart(d, options.outRule));
  const candidates: { darts: Dart[]; cost: number }[] = [];
  const seen = new Set<string>();
  const push = (darts: Dart[], cost: number) => {
    const k = routeKey(darts);
    if (seen.has(k)) return;
    seen.add(k);
    candidates.push({ darts, cost });
  };

  for (const last of finishers) {
    if (dartScore(last) === remaining) push([last], 100 + finishCost(last, options));
  }
  if (dartsLeft >= 2) {
    for (const a of SCORING_DARTS) {
      const rest = remaining - dartScore(a);
      if (rest <= 0) continue;
      for (const last of finishers) {
        if (dartScore(last) === rest) push([a, last], 200 + setupCost(a) + finishCost(last, options));
      }
    }
  }
  if (dartsLeft >= 3) {
    for (const a of SCORING_DARTS) {
      const restA = remaining - dartScore(a);
      if (restA <= 1) continue;
      for (const b of SCORING_DARTS) {
        const rest = restA - dartScore(b);
        if (rest <= 0) continue;
        for (const last of finishers) {
          if (dartScore(last) !== rest) continue;
          // Fléchettes de préparation jouées de la plus forte à la plus faible.
          const [first, second] = dartScore(a) >= dartScore(b) ? [a, b] : [b, a];
          push([first, second, last], 300 + setupCost(a) + setupCost(b) + finishCost(last, options));
        }
      }
    }
  }
  candidates.sort((x, y) => x.cost - y.cost);
  const routes = candidates.slice(0, 10).map(({ darts }) => ({
    darts,
    labels: darts.map(dartLabel),
    display: darts.map(dartDisplay),
  }));
  memo.set(key, routes);
  return routes.slice(0, limit);
}

export function bestCheckout(remaining: number, options: CheckoutOptions): CheckoutRoute | null {
  return suggestCheckouts(remaining, { ...options, limit: 1 })[0] ?? null;
}

export function canCheckout(remaining: number, outRule: InOutRule, dartsLeft = 3): boolean {
  return suggestCheckouts(remaining, { outRule, dartsLeft, limit: 1 }).length > 0;
}

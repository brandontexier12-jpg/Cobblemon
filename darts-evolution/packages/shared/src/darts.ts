/**
 * Modèle commun d'une fléchette.
 *
 * - `segment` : 0 pour un raté, 1 à 20 pour les secteurs, 25 pour le bull.
 * - `multiplier` : 0 pour un raté, 1 simple, 2 double, 3 triple.
 *   Le bull extérieur vaut 25 (segment 25, multiplicateur 1) et le bull intérieur 50
 *   (segment 25, multiplicateur 2, compté comme un double). Il n'existe pas de triple bull.
 */
export type Multiplier = 0 | 1 | 2 | 3;

export interface Dart {
  segment: number;
  multiplier: Multiplier;
}

export const BULL = 25;
export const MISS: Dart = Object.freeze({ segment: 0, multiplier: 0 }) as Dart;

export function isValidDart(value: unknown): value is Dart {
  if (!value || typeof value !== "object") return false;
  const { segment, multiplier } = value as Record<string, unknown>;
  if (!Number.isInteger(segment) || !Number.isInteger(multiplier)) return false;
  const s = segment as number;
  const m = multiplier as number;
  if (s === 0) return m === 0;
  if (m === 0) return false; // un raté s'écrit toujours {0, 0}
  if (s === BULL) return m === 1 || m === 2;
  return s >= 1 && s <= 20 && m >= 1 && m <= 3;
}

/** Nombre de points marqués par une fléchette. */
export function dartScore(d: Dart): number {
  return d.segment * d.multiplier;
}

export function isMiss(d: Dart): boolean {
  return d.multiplier === 0 || d.segment === 0;
}

export function isDouble(d: Dart): boolean {
  return d.multiplier === 2;
}

export function isTriple(d: Dart): boolean {
  return d.multiplier === 3;
}

export function isBull(d: Dart): boolean {
  return d.segment === BULL && d.multiplier >= 1;
}

export function isInnerBull(d: Dart): boolean {
  return d.segment === BULL && d.multiplier === 2;
}

/**
 * Libellé court et stable : S20, D16, T19, 25 (bull extérieur), BULL (bull intérieur), MISS.
 */
export function dartLabel(d: Dart): string {
  if (isMiss(d)) return "MISS";
  if (d.segment === BULL) return d.multiplier === 2 ? "BULL" : "25";
  return `${"SDT"[d.multiplier - 1]}${d.segment}`;
}

/** Libellé lisible en français pour l'interface. */
export function dartDisplay(d: Dart): string {
  if (isMiss(d)) return "Raté";
  if (d.segment === BULL) return d.multiplier === 2 ? "Bull" : "25";
  return dartLabel(d);
}

/**
 * Lit un libellé saisi (T20, D16, S5, 20, 25, SB, BULL, DB, 50, M, MISS, 0…).
 * Retourne `null` si le libellé n'est pas reconnu.
 */
export function parseDart(input: string): Dart | null {
  const text = input.trim().toUpperCase().replace(/\s+/g, "");
  if (text === "") return null;
  if (["M", "MISS", "0", "RATE", "RATÉ", "X"].includes(text)) return { segment: 0, multiplier: 0 };
  if (["BULL", "DB", "50", "BE", "IB", "DBULL"].includes(text)) return { segment: BULL, multiplier: 2 };
  if (["25", "SB", "OB", "SBULL"].includes(text)) return { segment: BULL, multiplier: 1 };
  const match = /^([SDT]?)(\d{1,2})$/.exec(text);
  if (!match) return null;
  const segment = Number(match[2]);
  const prefix = match[1] || "S";
  const multiplier = (prefix === "S" ? 1 : prefix === "D" ? 2 : 3) as Multiplier;
  const dart = { segment, multiplier };
  return isValidDart(dart) ? dart : null;
}

/** Toutes les fléchettes « utiles » (hors raté) : 20×3 + bull 25 + bull 50. */
export const SCORING_DARTS: readonly Dart[] = Object.freeze([
  ...Array.from({ length: 20 }, (_, i) => ({ segment: i + 1, multiplier: 1 as Multiplier })),
  ...Array.from({ length: 20 }, (_, i) => ({ segment: i + 1, multiplier: 2 as Multiplier })),
  ...Array.from({ length: 20 }, (_, i) => ({ segment: i + 1, multiplier: 3 as Multiplier })),
  { segment: BULL, multiplier: 1 as Multiplier },
  { segment: BULL, multiplier: 2 as Multiplier },
]);

export function sameDart(a: Dart, b: Dart): boolean {
  return a.segment === b.segment && a.multiplier === b.multiplier;
}

/** Ordre des secteurs sur une cible, dans le sens horaire depuis le 20. */
export const BOARD_ORDER: readonly number[] = Object.freeze([
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
]);

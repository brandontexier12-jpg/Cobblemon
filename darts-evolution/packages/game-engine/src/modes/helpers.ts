import { BULL, type Dart } from "@darts-evolution/shared";
import type { VisitRecord } from "../types.js";

export function nextIndex(current: number, count: number): number {
  return (current + 1) % count;
}

/**
 * Prochain joueur actif après `current` (les joueurs inactifs sont sautés).
 * `wrapped` indique qu'on est revenu en début de tour (nouvelle manche).
 */
export function nextActive(current: number, active: boolean[]): { index: number; wrapped: boolean } {
  const n = active.length;
  for (let step = 1; step <= n; step++) {
    const index = (current + step) % n;
    if (active[index]) return { index, wrapped: index <= current };
  }
  return { index: current, wrapped: true };
}

/** Le joueur `current` est-il le dernier joueur actif de la manche (ordre des indices) ? */
export function isLastActiveInRound(current: number, active: boolean[]): boolean {
  for (let i = current + 1; i < active.length; i++) if (active[i]) return false;
  return true;
}

/** Moyenne sur 3 fléchettes d'une liste de visites (points retenus / fléchettes × 3). */
export function average3(visits: VisitRecord[]): string {
  const darts = visits.reduce((sum, v) => sum + v.darts.length, 0);
  if (darts === 0) return "–";
  const points = visits.reduce((sum, v) => sum + v.points, 0);
  return ((points / darts) * 3).toFixed(1);
}

export function percent(hits: number, attempts: number): string {
  if (attempts === 0) return "–";
  return `${Math.round((hits / attempts) * 100)} %`;
}

/** Gagnants : tous les joueurs ayant la meilleure valeur (égalité = plusieurs gagnants). */
export function bestPlayers(values: number[], ids: string[], higherIsBetter = true, eligible?: boolean[]): string[] {
  let best: number | null = null;
  values.forEach((v, i) => {
    if (eligible && !eligible[i]) return;
    if (best === null || (higherIsBetter ? v > best : v < best)) best = v;
  });
  if (best === null) return [];
  return ids.filter((_, i) => (!eligible || eligible[i]) && values[i] === best);
}

export type Ring = "any" | "single" | "double" | "triple" | "outer_bull" | "inner_bull";

export interface TargetSpec {
  segment: number;
  ring: Ring;
}

export function targetLabel(t: TargetSpec): string {
  if (t.segment === BULL) {
    if (t.ring === "inner_bull" || t.ring === "double") return "Bull";
    if (t.ring === "outer_bull" || t.ring === "single") return "25";
    return "Bull (25/50)";
  }
  switch (t.ring) {
    case "single":
      return `S${t.segment}`;
    case "double":
      return `D${t.segment}`;
    case "triple":
      return `T${t.segment}`;
    default:
      return String(t.segment);
  }
}

export function hitsTarget(d: Dart, t: TargetSpec): boolean {
  if (d.multiplier === 0 || d.segment !== t.segment) return false;
  switch (t.ring) {
    case "any":
      return true;
    case "single":
    case "outer_bull":
      return d.multiplier === 1;
    case "double":
    case "inner_bull":
      return d.multiplier === 2;
    case "triple":
      // Il n'existe pas de triple bull : le bull intérieur fait office de cible la plus difficile.
      return t.segment === BULL ? d.multiplier === 2 : d.multiplier === 3;
  }
}

import type { StageFormat } from "./catalogue.js";
import type { Rng } from "./rng.js";

/**
 * Simulation rapide des matchs entre joueurs virtuels. Le nombre de fléchettes pour finir un leg
 * de 501 suit une loi log-normale dont la moyenne et l'écart-type ont été mesurés sur les bots du
 * moteur de jeu (300 legs par niveau, mêmes bots que ceux affrontés en match) : un résultat simulé
 * est donc cohérent avec ce que donnerait le bot face à la cible.
 */

type Table = [average: number, mean: number, sd: number][];

const DOUBLE_OUT: Table = [
  [20, 75.15, 32.49], [30, 51.39, 16.18], [40, 37.02, 8.65], [50, 29.35, 6.78], [60, 25.32, 5.59], [70, 21.32, 4.26],
  [80, 18.97, 3.5], [90, 16.92, 3.36], [100, 15.05, 2.49], [110, 13.29, 1.99], [120, 12.56, 1.78],
];
const SINGLE_OUT: Table = [
  [20, 48.13, 8.39], [30, 39.81, 6.96], [40, 32.19, 5.56], [50, 26.56, 4.5], [60, 22.67, 3.74], [70, 19.57, 3.16],
  [80, 17.65, 2.8], [90, 15.79, 2.39], [100, 14.81, 2.24], [110, 13.24, 1.84], [120, 12.29, 1.54],
];

function lookup(table: Table, average: number): { mean: number; sd: number } {
  const avg = Math.min(table[table.length - 1]![0], Math.max(table[0]![0], average));
  for (let i = 1; i < table.length; i++) {
    const [a0, m0, s0] = table[i - 1]!;
    const [a1, m1, s1] = table[i]!;
    if (avg <= a1) {
      const t = (avg - a0) / (a1 - a0);
      return { mean: m0 + t * (m1 - m0), sd: s0 + t * (s1 - s0) };
    }
  }
  const last = table[table.length - 1]!;
  return { mean: last[1], sd: last[2] };
}

/** Fléchettes nécessaires pour finir un leg de 501 (au moins 9). */
export function dartsForLeg(rng: Rng, average: number, outRule: "single" | "double", doubleIn = false): number {
  const { mean, sd } = lookup(outRule === "single" ? SINGLE_OUT : DOUBLE_OUT, average);
  const sigma = Math.sqrt(Math.log(1 + (sd / mean) ** 2));
  const mu = Math.log(mean) - (sigma * sigma) / 2;
  // Départ double : quelques fléchettes pour trouver un double d'entrée.
  const opening = doubleIn ? Math.max(1, rng.normal(1.6 + 120 / Math.max(average, 20), 1)) : 0;
  return Math.max(9, Math.round(Math.exp(rng.normal(mu, sigma)) + opening));
}

export interface SimResult {
  /** Score du match : sets si le format en comporte, legs sinon. */
  scoreA: number;
  scoreB: number;
  legsA: number;
  legsB: number;
  winner: "a" | "b";
  /** Moyennes (3 fléchettes) affichées. */
  avgA: number;
  avgB: number;
}

/** Forme du jour : la moyenne réelle varie autour du niveau du joueur. */
export function dayForm(rng: Rng, rating: number): number {
  return Math.max(15, rating + rng.normal(0, Math.max(2, rating * 0.035)));
}

/**
 * Simule un match (premier à N legs, ou premier à N sets de premier à M legs). Le joueur A commence
 * le premier leg ; l'engagement alterne à chaque leg, et à chaque set entre les sets.
 */
export function simulateMatch(rng: Rng, ratingA: number, ratingB: number, format: StageFormat, outRule: "single" | "double", doubleIn = false): SimResult {
  const formA = dayForm(rng, ratingA);
  const formB = dayForm(rng, ratingB);
  const sets = format.sets ?? 1;
  let setsA = 0;
  let setsB = 0;
  let legsA = 0;
  let legsB = 0;
  let setStarter: "a" | "b" = "a";
  while (setsA < sets && setsB < sets) {
    let inSetA = 0;
    let inSetB = 0;
    let starter = setStarter;
    while (inSetA < format.legs && inSetB < format.legs) {
      const visitsA = Math.ceil(dartsForLeg(rng, formA, outRule, doubleIn) / 3);
      const visitsB = Math.ceil(dartsForLeg(rng, formB, outRule, doubleIn) / 3);
      const aWins = starter === "a" ? visitsA <= visitsB : visitsA < visitsB;
      if (aWins) {
        inSetA++;
        legsA++;
      } else {
        inSetB++;
        legsB++;
      }
      starter = starter === "a" ? "b" : "a";
    }
    if (inSetA > inSetB) setsA++;
    else setsB++;
    setStarter = setStarter === "a" ? "b" : "a";
  }
  const winner = sets > 1 ? (setsA > setsB ? "a" : "b") : legsA > legsB ? "a" : "b";
  const round1 = (v: number) => Math.round(v * 10) / 10;
  return {
    scoreA: sets > 1 ? setsA : legsA,
    scoreB: sets > 1 ? setsB : legsB,
    legsA,
    legsB,
    winner,
    avgA: round1(formA + rng.normal(0, 1.5)),
    avgB: round1(formB + rng.normal(0, 1.5)),
  };
}

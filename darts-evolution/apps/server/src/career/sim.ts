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
  [10, 145.35, 70.25], [15, 101.99, 47.12], [20, 77.74, 33.48], [30, 51.88, 18.16], [40, 37.24, 9.06], [50, 29.58, 6.88],
  [60, 25.2, 5.36], [70, 21.71, 4.23], [80, 19.1, 3.67], [90, 16.52, 2.86], [100, 15.17, 2.52], [110, 13.84, 2.08], [120, 12.55, 1.67],
];
const SINGLE_OUT: Table = [
  [10, 146.02, 40.9], [15, 100.18, 27.44], [20, 74.79, 16.82], [30, 50.75, 8.73], [40, 37.8, 6.32], [50, 29.85, 4.94],
  [60, 25.61, 4.25], [70, 21.67, 3.63], [80, 18.92, 2.98], [90, 16.86, 2.73], [100, 14.9, 2.21], [110, 13.76, 2.11], [120, 12.4, 1.59],
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
  return Math.max(10, rating + rng.normal(0, Math.max(2, rating * 0.035)));
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

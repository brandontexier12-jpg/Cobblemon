import { BULL } from "@darts-evolution/shared";
import type { StatMatch, StatVisit } from "./types.js";

/**
 * Formules (voir docs/statistiques.md) :
 * - Moyenne par fléchette = points retenus / fléchettes lancées (bust = 0 point, fléchettes comptées).
 * - Moyenne sur 3 fléchettes = moyenne par fléchette × 3.
 * - Moyenne par visite = points retenus / nombre de visites (diffère de la moyenne 3 fléchettes
 *   quand une visite compte moins de 3 fléchettes, typiquement au checkout).
 * - Moyenne de première visite = moyenne des points de la première visite de chaque leg.
 * - Moyenne des 9 premières fléchettes = points des 3 premières visites de chaque leg / fléchettes × 3.
 * - 180 = visite de 3 fléchettes à 180 ; 140+ = de 140 à 179 ; 100+ = de 100 à 139 (classes disjointes).
 * - Réussite aux doubles = checkouts réussis / fléchettes lancées alors qu'une sortie en une fléchette
 *   était possible (X01 en double sortie uniquement).
 * - Taux de checkout = legs terminés / visites commencées sur un score terminable en 3 fléchettes.
 */

export function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

const legKey = (v: StatVisit) => `${v.matchId}|${v.set}|${v.leg}`;

export interface X01Summary {
  visits: number;
  darts: number;
  points: number;
  pointsPerDart: number | null;
  average3: number | null;
  visitAverage: number | null;
  firstVisitAverage: number | null;
  first9Average: number | null;
  bestVisit: number | null;
  count180: number;
  count140: number;
  count100: number;
  busts: number;
  doubleAttempts: number;
  doubleHits: number;
  doubleRate: number | null;
  checkoutChances: number;
  checkouts: number;
  checkoutRate: number | null;
  bestCheckout: number | null;
  legsWon: number;
  averageDartsPerLegWon: number | null;
  bestLegDarts: number | null;
}

export function x01Summary(allVisits: StatVisit[]): X01Summary {
  const visits = allVisits.filter((v) => v.mode === "x01");
  const darts = visits.reduce((s, v) => s + v.darts.length, 0);
  const points = visits.reduce((s, v) => s + v.points, 0);
  const firstVisits = visits.filter((v) => v.firstOfLeg);

  // 9 premières fléchettes : les 3 premières visites de chaque leg.
  const byLeg = new Map<string, StatVisit[]>();
  for (const v of visits) {
    const key = `${legKey(v)}|${v.playerId}`;
    const list = byLeg.get(key) ?? [];
    list.push(v);
    byLeg.set(key, list);
  }
  let first9Points = 0;
  let first9Darts = 0;
  const legsWonDarts: number[] = [];
  for (const list of byLeg.values()) {
    list.sort((a, b) => a.round - b.round);
    for (const v of list.slice(0, 3)) {
      first9Points += v.points;
      first9Darts += v.darts.length;
    }
    if (list.some((v) => v.checkout)) legsWonDarts.push(list.reduce((s, v) => s + v.darts.length, 0));
  }

  const scored = visits.filter((v) => !v.bust);
  const doubleOut = visits.filter((v) => (v.outRule ?? "double") === "double");
  const doubleAttempts = doubleOut.reduce((s, v) => s + v.darts.filter((d) => d.checkoutAttempt).length, 0);
  const doubleHits = doubleOut.filter((v) => v.checkout).length;
  const chances = visits.filter((v) => v.checkoutChance);
  const checkouts = visits.filter((v) => v.checkout);

  return {
    visits: visits.length,
    darts,
    points,
    pointsPerDart: round(ratio(points, darts)),
    average3: round(darts ? (points / darts) * 3 : null),
    visitAverage: round(ratio(points, visits.length)),
    firstVisitAverage: round(ratio(firstVisits.reduce((s, v) => s + v.points, 0), firstVisits.length)),
    first9Average: round(first9Darts ? (first9Points / first9Darts) * 3 : null),
    bestVisit: scored.length ? Math.max(...scored.map((v) => v.points)) : null,
    count180: scored.filter((v) => v.points === 180 && v.darts.length === 3).length,
    count140: scored.filter((v) => v.points >= 140 && v.points < 180).length,
    count100: scored.filter((v) => v.points >= 100 && v.points < 140).length,
    busts: visits.filter((v) => v.bust).length,
    doubleAttempts,
    doubleHits,
    doubleRate: round(ratio(doubleHits, doubleAttempts), 4),
    checkoutChances: chances.length,
    checkouts: checkouts.length,
    checkoutRate: round(ratio(chances.filter((v) => v.checkout).length, chances.length), 4),
    bestCheckout: checkouts.length ? Math.max(...checkouts.map((v) => v.remainingBefore ?? 0)) : null,
    legsWon: legsWonDarts.length,
    averageDartsPerLegWon: round(legsWonDarts.length ? legsWonDarts.reduce((a, b) => a + b, 0) / legsWonDarts.length : null, 1),
    bestLegDarts: legsWonDarts.length ? Math.min(...legsWonDarts) : null,
  };
}

export interface ResultsSummary {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  currentStreak: number;
  bestStreak: number;
}

/**
 * Victoires / défaites : uniquement les parties terminées à au moins deux joueurs.
 * Une partie avec plusieurs gagnants dont le joueur fait partie compte comme égalité.
 */
export function resultsSummary(matches: StatMatch[]): ResultsSummary {
  const played = matches
    .filter((m) => m.status === "finished" && m.playerIds.length >= 2)
    .sort((a, b) => (a.finishedAt ?? a.playedAt).localeCompare(b.finishedAt ?? b.playedAt));
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let streak = 0;
  let best = 0;
  for (const m of played) {
    const won = m.winnerIds.includes(m.playerId);
    if (won && m.winnerIds.length === 1) {
      wins++;
      streak++;
      best = Math.max(best, streak);
    } else if (won) {
      draws++;
      streak = 0;
    } else {
      losses++;
      streak = 0;
    }
  }
  return {
    matches: played.length,
    wins,
    losses,
    draws,
    winRate: round(ratio(wins, played.length), 4),
    currentStreak: streak,
    bestStreak: best,
  };
}

export interface TrainingSummary {
  sessions: number;
  darts: number;
  doubles: { darts: number; hits: number; rate: number | null };
  triples: { darts: number; hits: number; rate: number | null };
  bull: { darts: number; hits: number; inner: number; rate: number | null; innerRate: number | null };
  checkout: { attempts: number; successes: number; rate: number | null };
  cricket: { visits: number; marks: number; marksPerRound: number | null };
  byMode: Record<string, { sessions: number; darts: number; hits: number; rate: number | null }>;
}

function hitDarts(visits: StatVisit[]) {
  // Les fléchettes ajoutées comme ratées en fin de visite comptent : elles ont été lancées (ou perdues).
  const darts = visits.flatMap((v) => v.darts);
  return { darts: darts.length, hits: darts.filter((d) => d.hit).length };
}

export function trainingSummary(visits: StatVisit[]): TrainingSummary {
  const sessions = new Set(visits.filter((v) => v.category === "training").map((v) => v.matchId));
  const doublesVisits = visits.filter((v) => v.mode === "doubles_training" || v.mode === "bobs_27");
  const triplesVisits = visits.filter((v) => v.mode === "triples_training");
  const bullVisits = visits.filter((v) => v.mode === "bull_training");
  const checkoutVisits = visits.filter((v) => v.mode === "checkout_training");
  const cricketVisits = visits.filter((v) => v.mode === "cricket");
  const doubles = hitDarts(doublesVisits);
  const triples = hitDarts(triplesVisits);
  const bullDarts = bullVisits.flatMap((v) => v.darts);
  const bullHits = bullDarts.filter((d) => d.hit).length;
  const bullInner = bullDarts.filter((d) => d.segment === BULL && d.multiplier === 2).length;
  const coAttempts = checkoutVisits.reduce((s, v) => s + (v.attempts ?? 0), 0);
  const coSuccess = checkoutVisits.filter((v) => v.checkout).length;
  const cricketMarks = cricketVisits.reduce((s, v) => s + (v.marks ?? 0), 0);

  const byMode: TrainingSummary["byMode"] = {};
  for (const v of visits) {
    const entry = (byMode[v.mode] ??= { sessions: 0, darts: 0, hits: 0, rate: null });
    entry.darts += v.darts.length;
    entry.hits += v.darts.filter((d) => d.hit).length;
  }
  for (const mode of Object.keys(byMode)) {
    const entry = byMode[mode]!;
    entry.sessions = new Set(visits.filter((v) => v.mode === mode).map((v) => v.matchId)).size;
    entry.rate = round(ratio(entry.hits, entry.darts), 4);
  }

  return {
    sessions: sessions.size,
    darts: visits.filter((v) => v.category === "training").reduce((s, v) => s + v.darts.length, 0),
    doubles: { ...doubles, rate: round(ratio(doubles.hits, doubles.darts), 4) },
    triples: { ...triples, rate: round(ratio(triples.hits, triples.darts), 4) },
    bull: {
      darts: bullDarts.length,
      hits: bullHits,
      inner: bullInner,
      rate: round(ratio(bullHits, bullDarts.length), 4),
      innerRate: round(ratio(bullInner, bullDarts.length), 4),
    },
    checkout: { attempts: coAttempts, successes: coSuccess, rate: round(ratio(coSuccess, coAttempts), 4) },
    cricket: { visits: cricketVisits.length, marks: cricketMarks, marksPerRound: round(ratio(cricketMarks, cricketVisits.length)) },
    byMode,
  };
}

export interface PlayerSummary {
  x01: X01Summary;
  results: ResultsSummary;
  training: TrainingSummary;
  totalDarts: number;
  totalMatches: number;
  lastPlayedAt: string | null;
}

export function playerSummary(visits: StatVisit[], matches: StatMatch[]): PlayerSummary {
  const dates = matches.map((m) => m.playedAt).sort();
  return {
    x01: x01Summary(visits),
    results: resultsSummary(matches),
    training: trainingSummary(visits),
    totalDarts: visits.reduce((s, v) => s + v.darts.length, 0),
    totalMatches: new Set(matches.map((m) => m.matchId)).size,
    lastPlayedAt: dates[dates.length - 1] ?? null,
  };
}

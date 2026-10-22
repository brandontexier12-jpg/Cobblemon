import { ratio, round, trainingSummary, x01Summary } from "./summary.js";
import { localDay } from "./series.js";
import type { StatMatch, StatVisit } from "./types.js";

export interface RecordEntry {
  id: string;
  label: string;
  value: number;
  display: string;
  matchId: string | null;
  at: string | null;
}

function byMatch(visits: StatVisit[]): Map<string, StatVisit[]> {
  const map = new Map<string, StatVisit[]>();
  for (const v of visits) {
    const list = map.get(v.matchId) ?? [];
    list.push(v);
    map.set(v.matchId, list);
  }
  return map;
}

/** Records personnels calculés à partir des visites et résultats réels. */
export function personalRecords(visits: StatVisit[], matches: StatMatch[]): RecordEntry[] {
  const records: RecordEntry[] = [];
  const x01 = visits.filter((v) => v.mode === "x01");
  const scored = x01.filter((v) => !v.bust);
  const best = scored.reduce<StatVisit | null>((b, v) => (!b || v.points > b.points ? v : b), null);
  if (best) records.push({ id: "best_visit", label: "Meilleure visite", value: best.points, display: String(best.points), matchId: best.matchId, at: best.playedAt });

  const checkouts = x01.filter((v) => v.checkout);
  const bestCo = checkouts.reduce<StatVisit | null>((b, v) => (!b || (v.remainingBefore ?? 0) > (b.remainingBefore ?? 0) ? v : b), null);
  if (bestCo) records.push({ id: "best_checkout", label: "Meilleur checkout", value: bestCo.remainingBefore ?? 0, display: String(bestCo.remainingBefore), matchId: bestCo.matchId, at: bestCo.playedAt });

  let bestAvg: RecordEntry | null = null;
  for (const [matchId, list] of byMatch(x01)) {
    const s = x01Summary(list);
    if (s.darts < 9 || s.average3 === null) continue;
    if (!bestAvg || s.average3 > bestAvg.value) {
      bestAvg = { id: "best_match_average", label: "Meilleure moyenne sur une partie", value: s.average3, display: s.average3.toFixed(2), matchId, at: list[0]!.playedAt };
    }
  }
  if (bestAvg) records.push(bestAvg);

  // Leg le plus court : fléchettes du joueur dans un leg qu'il a terminé.
  const legs = new Map<string, StatVisit[]>();
  for (const v of x01) {
    const key = `${v.matchId}|${v.set}|${v.leg}`;
    const list = legs.get(key) ?? [];
    list.push(v);
    legs.set(key, list);
  }
  let shortest: RecordEntry | null = null;
  for (const list of legs.values()) {
    const won = list.find((v) => v.checkout);
    if (!won) continue;
    const darts = list.reduce((s, v) => s + v.darts.length, 0);
    if (!shortest || darts < shortest.value) {
      shortest = { id: "shortest_leg", label: "Leg le plus court", value: darts, display: `${darts} fléchettes`, matchId: won.matchId, at: won.playedAt };
    }
  }
  if (shortest) records.push(shortest);

  const count180 = scored.filter((v) => v.points === 180).length;
  if (count180 > 0) records.push({ id: "total_180", label: "Nombre de 180", value: count180, display: String(count180), matchId: null, at: null });

  const bobs = matches.filter((m) => m.mode === "bobs_27" && m.status === "finished" && typeof m.finalScore === "number");
  const bestBobs = bobs.reduce<StatMatch | null>((b, m) => (!b || (m.finalScore ?? 0) > (b.finalScore ?? 0) ? m : b), null);
  if (bestBobs) records.push({ id: "bobs_27", label: "Meilleur Bob's 27", value: bestBobs.finalScore ?? 0, display: String(bestBobs.finalScore), matchId: bestBobs.matchId, at: bestBobs.finishedAt });

  let bestAtc: RecordEntry | null = null;
  for (const [matchId, list] of byMatch(visits.filter((v) => v.mode === "around_the_clock"))) {
    const match = matches.find((m) => m.matchId === matchId);
    if (!match || match.status !== "finished" || !match.winnerIds.includes(match.playerId)) continue;
    const darts = list.reduce((s, v) => s + v.darts.length, 0);
    if (!bestAtc || darts < bestAtc.value) bestAtc = { id: "atc", label: "Around the Clock le plus rapide", value: darts, display: `${darts} fléchettes`, matchId, at: match.finishedAt };
  }
  if (bestAtc) records.push(bestAtc);

  let bestDoubles: RecordEntry | null = null;
  for (const [matchId, list] of byMatch(visits.filter((v) => v.mode === "doubles_training"))) {
    const darts = list.flatMap((v) => v.darts);
    if (darts.length < 30) continue;
    const rate = darts.filter((d) => d.hit).length / darts.length;
    if (!bestDoubles || rate > bestDoubles.value) {
      bestDoubles = { id: "doubles_session", label: "Meilleure séance de doubles (30 fl. min.)", value: round(rate, 4) ?? 0, display: `${Math.round(rate * 100)} %`, matchId, at: list[0]!.playedAt };
    }
  }
  if (bestDoubles) records.push(bestDoubles);

  return records;
}

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
}

export const BADGES: BadgeDefinition[] = [
  { id: "first_match", name: "Premier pas", description: "Terminer sa première partie ou séance." },
  { id: "ton", name: "Ton !", description: "Réussir une visite de 100 points ou plus en X01." },
  { id: "ton40", name: "Ton 40", description: "Réussir une visite de 140 points ou plus en X01." },
  { id: "max", name: "180 !", description: "Réussir le maximum : 180 en une visite." },
  { id: "checkout100", name: "Finisseur", description: "Réussir un checkout de 100 ou plus." },
  { id: "big_fish", name: "Big Fish", description: "Réussir le checkout de 170." },
  { id: "leg15", name: "Leg éclair", description: "Gagner un leg de 501 en 15 fléchettes ou moins." },
  { id: "nine_darter", name: "Neuf fléchettes", description: "Gagner un leg de 501 en 9 fléchettes." },
  { id: "darts1000", name: "Assidu", description: "Lancer 1 000 fléchettes." },
  { id: "darts10000", name: "Marathonien", description: "Lancer 10 000 fléchettes." },
  { id: "streak3", name: "En série", description: "Gagner 3 parties d'affilée." },
  { id: "days7", name: "Régulier", description: "S'entraîner 7 jours différents." },
  { id: "bobs100", name: "Disciple de Bob", description: "Terminer un Bob's 27 avec 100 points ou plus." },
  { id: "doubles50", name: "Œil de lynx", description: "50 % de réussite sur une séance de doubles (30 fléchettes min.)." },
];

export interface EarnedBadge extends BadgeDefinition {
  earnedAt: string;
  matchId: string | null;
}

export interface ProgressInfo {
  xp: number;
  level: number;
  levelName: string;
  xpForNext: number;
  xpIntoLevel: number;
  badges: EarnedBadge[];
}

function levelName(level: number): string {
  if (level >= 20) return "Pro";
  if (level >= 15) return "Expert";
  if (level >= 10) return "Confirmé";
  if (level >= 5) return "Amateur";
  return "Débutant";
}

/** Seuil d'XP pour atteindre le niveau n : 100 × (n − 1)². */
export function xpForLevel(level: number): number {
  return 100 * (level - 1) ** 2;
}

/**
 * Niveau, XP et badges, recalculés à chaque fois à partir des actions réelles :
 * 1 XP par fléchette, 25 XP par leg gagné, 50 XP par partie gagnée, 20 XP par partie ou séance terminée,
 * 100 XP par badge. Une correction de partie met donc automatiquement à jour les récompenses.
 */
export function computeProgress(visits: StatVisit[], matches: StatMatch[]): ProgressInfo {
  const sortedVisits = [...visits].sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  const sortedMatches = [...matches].sort((a, b) => (a.finishedAt ?? a.playedAt).localeCompare(b.finishedAt ?? b.playedAt));
  const earned = new Map<string, EarnedBadge>();
  const award = (id: string, at: string, matchId: string | null) => {
    if (earned.has(id)) return;
    const def = BADGES.find((b) => b.id === id);
    if (def) earned.set(id, { ...def, earnedAt: at, matchId });
  };

  let darts = 0;
  const days = new Set<string>();
  for (const v of sortedVisits) {
    darts += v.darts.length;
    if (darts >= 1000) award("darts1000", v.playedAt, v.matchId);
    if (darts >= 10000) award("darts10000", v.playedAt, v.matchId);
    if (v.category === "training") {
      days.add(localDay(v.playedAt));
      if (days.size >= 7) award("days7", v.playedAt, v.matchId);
    }
    if (v.mode === "x01" && !v.bust) {
      if (v.points >= 100) award("ton", v.playedAt, v.matchId);
      if (v.points >= 140) award("ton40", v.playedAt, v.matchId);
      if (v.points === 180) award("max", v.playedAt, v.matchId);
      if (v.checkout && (v.remainingBefore ?? 0) >= 100) award("checkout100", v.playedAt, v.matchId);
      if (v.checkout && v.remainingBefore === 170) award("big_fish", v.playedAt, v.matchId);
    }
  }

  // Legs de 501 gagnés.
  const legs = new Map<string, StatVisit[]>();
  for (const v of sortedVisits.filter((x) => x.mode === "x01")) {
    const key = `${v.matchId}|${v.set}|${v.leg}`;
    const list = legs.get(key) ?? [];
    list.push(v);
    legs.set(key, list);
  }
  let legsWon = 0;
  for (const list of legs.values()) {
    const won = list.find((v) => v.checkout);
    if (!won) continue;
    legsWon++;
    const first = [...list].sort((a, b) => a.round - b.round)[0]!;
    const legDarts = list.reduce((s, v) => s + v.darts.length, 0);
    if (first.remainingBefore === 501) {
      if (legDarts <= 15) award("leg15", won.playedAt, won.matchId);
      if (legDarts <= 9) award("nine_darter", won.playedAt, won.matchId);
    }
  }

  let streak = 0;
  let matchesWon = 0;
  let finished = 0;
  for (const m of sortedMatches) {
    if (m.status !== "finished") continue;
    finished++;
    const at = m.finishedAt ?? m.playedAt;
    award("first_match", at, m.matchId);
    if (m.playerIds.length >= 2) {
      if (m.winnerIds.length === 1 && m.winnerIds[0] === m.playerId) {
        matchesWon++;
        streak++;
        if (streak >= 3) award("streak3", at, m.matchId);
      } else {
        streak = 0;
      }
    }
    if (m.mode === "bobs_27" && (m.finalScore ?? 0) >= 100) award("bobs100", at, m.matchId);
  }

  for (const [matchId, list] of byMatch(sortedVisits.filter((v) => v.mode === "doubles_training"))) {
    const all = list.flatMap((v) => v.darts);
    if (all.length >= 30 && all.filter((d) => d.hit).length / all.length >= 0.5) {
      award("doubles50", list[list.length - 1]!.playedAt, matchId);
    }
  }

  const badges = [...earned.values()].sort((a, b) => a.earnedAt.localeCompare(b.earnedAt));
  const xp = darts + legsWon * 25 + matchesWon * 50 + finished * 20 + badges.length * 100;
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return {
    xp,
    level,
    levelName: levelName(level),
    xpForNext: xpForLevel(level + 1) - xpForLevel(level),
    xpIntoLevel: xp - xpForLevel(level),
    badges,
  };
}

export type GoalMetric = "darts" | "sessions" | "matches" | "average3" | "doubles_rate" | "checkout_rate";

export const GOAL_METRICS: { id: GoalMetric; label: string; unit: string }[] = [
  { id: "darts", label: "Fléchettes lancées", unit: "fléchettes" },
  { id: "sessions", label: "Séances d'entraînement", unit: "séances" },
  { id: "matches", label: "Parties jouées", unit: "parties" },
  { id: "average3", label: "Moyenne 3 fléchettes (X01)", unit: "points" },
  { id: "doubles_rate", label: "Réussite aux doubles (entraînement)", unit: "%" },
  { id: "checkout_rate", label: "Taux de checkout (X01)", unit: "%" },
];

export interface GoalProgress {
  metric: GoalMetric;
  target: number;
  value: number | null;
  achieved: boolean;
  completion: number;
}

/** Progression d'un objectif hebdomadaire sur les données de la semaine. */
export function goalProgress(metric: GoalMetric, target: number, weekVisits: StatVisit[], weekMatches: StatMatch[]): GoalProgress {
  let value: number | null;
  switch (metric) {
    case "darts":
      value = weekVisits.reduce((s, v) => s + v.darts.length, 0);
      break;
    case "sessions":
      value = new Set(weekVisits.filter((v) => v.category === "training").map((v) => v.matchId)).size;
      break;
    case "matches":
      value = new Set(weekMatches.filter((m) => m.status === "finished").map((m) => m.matchId)).size;
      break;
    case "average3":
      value = x01Summary(weekVisits).average3;
      break;
    case "doubles_rate": {
      const rate = trainingSummary(weekVisits).doubles.rate;
      value = rate === null ? null : round(rate * 100, 1);
      break;
    }
    case "checkout_rate": {
      const rate = x01Summary(weekVisits).checkoutRate;
      value = rate === null ? null : round(rate * 100, 1);
      break;
    }
  }
  const completion = value === null ? 0 : Math.min(1, ratio(value, target) ?? 0);
  return { metric, target, value, achieved: value !== null && value >= target, completion: round(completion, 3) ?? 0 };
}

import { ratio, round, x01Summary } from "./summary.js";
import type { Period, StatMatch, StatVisit } from "./types.js";

export type Granularity = "day" | "week" | "month";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date locale (fuseau du serveur, variable TZ) au format AAAA-MM-JJ. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Lundi de la semaine (ISO 8601) de la date, au format AAAA-MM-JJ. */
export function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getDay() + 6) % 7; // lundi = 0
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

export function bucketKey(iso: string, granularity: Granularity): string {
  if (granularity === "day") return localDay(iso);
  if (granularity === "week") return weekStart(iso);
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function inPeriod(iso: string, period: Period): boolean {
  if (period.from && iso < period.from) return false;
  if (period.to && iso > period.to) return false;
  return true;
}

export interface SeriesPoint {
  key: string;
  darts: number;
  visits: number;
  /** Moyenne 3 fléchettes X01 de la période. */
  average3: number | null;
  /** Réussite aux doubles en X01 (double sortie). */
  doubleRate: number | null;
  /** Précision des entraînements à cible : touches / fléchettes. */
  accuracy: number | null;
  checkoutRate: number | null;
  sessions: number;
}

/** Progression par jour, semaine ou mois, calculée uniquement à partir des visites enregistrées. */
export function progressionSeries(visits: StatVisit[], granularity: Granularity): SeriesPoint[] {
  const buckets = new Map<string, StatVisit[]>();
  for (const v of visits) {
    const key = bucketKey(v.playedAt, granularity);
    const list = buckets.get(key) ?? [];
    list.push(v);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => {
      const x01 = x01Summary(list);
      const targetDarts = list.filter((v) => v.category === "training" && v.mode !== "checkout_training").flatMap((v) => v.darts);
      return {
        key,
        darts: list.reduce((s, v) => s + v.darts.length, 0),
        visits: list.length,
        average3: x01.average3,
        doubleRate: x01.doubleRate,
        accuracy: round(ratio(targetDarts.filter((d) => d.hit).length, targetDarts.length), 4),
        checkoutRate: x01.checkoutRate,
        sessions: new Set(list.map((v) => v.matchId)).size,
      };
    });
}

/** Évolution de la moyenne partie par partie (X01). */
export function averageByMatch(visits: StatVisit[]): { matchId: string; playedAt: string; average3: number | null }[] {
  const byMatch = new Map<string, StatVisit[]>();
  for (const v of visits.filter((x) => x.mode === "x01")) {
    const list = byMatch.get(v.matchId) ?? [];
    list.push(v);
    byMatch.set(v.matchId, list);
  }
  return [...byMatch.entries()]
    .map(([matchId, list]) => ({
      matchId,
      playedAt: list.reduce((min, v) => (v.playedAt < min ? v.playedAt : min), list[0]!.playedAt),
      average3: x01Summary(list).average3,
    }))
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt));
}

export interface CalendarDay {
  day: string;
  darts: number;
  sessions: number;
}

/** Calendrier d'activité : fléchettes lancées et séances par jour. */
export function activityCalendar(visits: StatVisit[]): CalendarDay[] {
  const days = new Map<string, { darts: number; matches: Set<string> }>();
  for (const v of visits) {
    const key = localDay(v.playedAt);
    const entry = days.get(key) ?? { darts: 0, matches: new Set<string>() };
    entry.darts += v.darts.length;
    entry.matches.add(v.matchId);
    days.set(key, entry);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, e]) => ({ day, darts: e.darts, sessions: e.matches.size }));
}

export interface PeriodComparison {
  a: ReturnType<typeof x01Summary> & { accuracy: number | null; darts: number };
  b: ReturnType<typeof x01Summary> & { accuracy: number | null; darts: number };
  delta: { average3: number | null; doubleRate: number | null; checkoutRate: number | null; accuracy: number | null };
}

function periodSummary(visits: StatVisit[]) {
  const x01 = x01Summary(visits);
  const targetDarts = visits.filter((v) => v.category === "training" && v.mode !== "checkout_training").flatMap((v) => v.darts);
  return {
    ...x01,
    accuracy: round(ratio(targetDarts.filter((d) => d.hit).length, targetDarts.length), 4),
    darts: visits.reduce((s, v) => s + v.darts.length, 0),
  };
}

function diff(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : round(b - a, 4);
}

/** Compare deux périodes (b par rapport à a). */
export function comparePeriods(visits: StatVisit[], a: Period, b: Period): PeriodComparison {
  const sa = periodSummary(visits.filter((v) => inPeriod(v.playedAt, a)));
  const sb = periodSummary(visits.filter((v) => inPeriod(v.playedAt, b)));
  return {
    a: sa,
    b: sb,
    delta: {
      average3: diff(sa.average3, sb.average3),
      doubleRate: diff(sa.doubleRate, sb.doubleRate),
      checkoutRate: diff(sa.checkoutRate, sb.checkoutRate),
      accuracy: diff(sa.accuracy, sb.accuracy),
    },
  };
}

export function filterMatches(matches: StatMatch[], period: Period): StatMatch[] {
  return matches.filter((m) => inPeriod(m.playedAt, period));
}

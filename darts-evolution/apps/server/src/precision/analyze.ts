import { aimPoint, applyEvent, chooseAim, createGame, describeGame, type Aim, type GameEvent, type GameModeId, type GameState, type PlayerRef, type X01State } from "@darts-evolution/game-engine";
import { BOARD_RADII, pointMatchesDart, segmentAngle, segmentAt, type BoardPoint, type Dart } from "@darts-evolution/shared";

/**
 * Carte de précision : où tombent réellement les fléchettes par rapport à la case visée.
 *
 * Seules les fléchettes détectées par Autodarts portent une position mesurée. La partie est rejouée
 * pour connaître l'état du jeu avant chaque fléchette et en déduire la cible visée, avec la même
 * logique que les bots : T20 au scoring (ou T19 si la fléchette est tombée de ce côté), double de
 * la sortie, cible affichée dans les entraînements. Les fléchettes dont l'intention est incertaine
 * (préparation d'une sortie, Cricket, Killer…) ne sont pas utilisées. Une position qui ne tombe pas
 * dans la case comptée (repère différent, fléchette corrigée) est écartée et comptée à part.
 */

/** Rayon du bord extérieur du double, en millimètres (cible réglementaire). */
export const BOARD_MM = 170;

export type TargetKind = "triple" | "double" | "bull" | "single";

export interface ReplayEvent {
  type: "dart" | "next";
  segment: number | null;
  multiplier: number | null;
  source: string;
  x: number | null;
  y: number | null;
  at: string;
}

export interface Impact {
  /** Position de l'impact (repère normalisé, double extérieur = 1, y vers le 20). */
  x: number;
  y: number;
  aimX: number;
  aimY: number;
  target: string;
  kind: TargetKind;
  segment: number;
  hit: boolean;
  at: string;
}

/** Modes où le joueur marque des points (scoring au T20, sorties). */
const SCORING_MODES = new Set<GameModeId>(["x01", "count_up", "high_score", "warmup", "checkout_training"]);
/** Modes à cible imposée. */
const TARGET_MODES = new Set<GameModeId>(["doubles_training", "triples_training", "bull_training", "bobs_27", "around_the_clock"]);

export function aimLabel(aim: Aim): string {
  if (aim.segment === 25) return aim.ring === "outerBull" ? "25" : "Bull";
  return `${aim.ring === "triple" ? "T" : aim.ring === "double" ? "D" : "S"}${aim.segment}`;
}

function aimKind(aim: Aim): TargetKind {
  if (aim.segment === 25) return "bull";
  return aim.ring === "triple" ? "triple" : aim.ring === "double" ? "double" : "single";
}

function aimHit(aim: Aim, dart: Dart): boolean {
  if (aim.segment === 25) return dart.segment === 25 && dart.multiplier === (aim.ring === "outerBull" ? 1 : 2);
  const mult = aim.ring === "triple" ? 3 : aim.ring === "double" ? 2 : 1;
  return dart.segment === aim.segment && dart.multiplier === mult;
}

/** Position retenue : celle reçue si elle tombe dans la case comptée (ou avec l'axe vertical inversé), sinon null. */
export function coherentPoint(dart: Dart, x: number, y: number): BoardPoint | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const p of [
    { x, y },
    { x, y: -y },
  ]) {
    if (dart.multiplier === 0) {
      if (Math.hypot(p.x, p.y) > BOARD_RADII.doubleOuter - 0.006) return p;
      continue;
    }
    if (pointMatchesDart(p, dart)) return p;
  }
  return null;
}

function angleOf(p: BoardPoint): number {
  return ((Math.atan2(p.x, p.y) * 180) / Math.PI + 360) % 360;
}

function angularGap(p: BoardPoint, segment: number): number {
  const d = Math.abs(angleOf(p) - segmentAngle(segment));
  return Math.min(d, 360 - d);
}

/** Cible visée avant la fléchette, ou null si l'intention du joueur est trop incertaine. */
export function intendedAim(state: GameState, point: BoardPoint): Aim | null {
  if (SCORING_MODES.has(state.mode)) {
    if (state.mode === "x01" && !(state.m as X01State).opened[state.turn.playerIndex]) return null; // départ double : double au choix
    const aim = chooseAim(state);
    if (aim.ring === "double" || (aim.segment === 25 && aim.ring === "bull")) return aim;
    if (aim.ring === "triple" && (aim.segment === 20 || aim.segment === 19)) {
      // Scoring : beaucoup de joueurs passent au T19 quand le T20 est bouché.
      return { segment: angularGap(point, 20) <= angularGap(point, 19) ? 20 : 19, ring: "triple" };
    }
    return null;
  }
  if (TARGET_MODES.has(state.mode)) {
    if (state.mode === "around_the_clock" && (state.config as { ring?: string }).ring === "any") return null;
    if (!describeGame(state).current.target) return null;
    return chooseAim(state);
  }
  return null;
}

/** Fléchettes d'un joueur, avec cible visée et position cohérente, sur une partie rejouée. */
export function extractImpacts(
  mode: GameModeId,
  config: unknown,
  players: PlayerRef[],
  events: ReplayEvent[],
  playerId: string,
): { impacts: Impact[]; incoherent: number } {
  const impacts: Impact[] = [];
  let incoherent = 0;
  let state = createGame(mode, config, players);
  for (const e of events) {
    if (state.finished) break;
    const event: GameEvent =
      e.type === "dart" ? { type: "dart", dart: { segment: e.segment ?? 0, multiplier: (e.multiplier ?? 0) as Dart["multiplier"] }, source: e.source } : { type: "next", source: e.source };
    try {
      if (event.type === "dart" && e.source === "autodarts" && e.x !== null && e.y !== null) {
        // État au moment de lancer (la visite précédente est close par la fléchette elle-même).
        const before = state.turn.complete ? applyEvent(state, { type: "next" }) : state;
        if (players[before.turn.playerIndex]?.id === playerId) {
          const point = coherentPoint(event.dart, e.x, e.y);
          if (!point) incoherent++;
          else {
            const aim = intendedAim(before, point);
            if (aim) {
              const p = aimPoint(aim);
              impacts.push({
                x: point.x,
                y: point.y,
                aimX: p.x,
                aimY: p.y,
                target: aimLabel(aim),
                kind: aimKind(aim),
                segment: aim.segment,
                hit: aimHit(aim, event.dart),
                at: e.at,
              });
            }
          }
        }
      }
      state = applyEvent(state, event);
    } catch {
      break; // journal incohérent : la suite de la partie n'est pas analysée
    }
  }
  return { impacts, incoherent };
}

// ---------- Mesures ----------

export interface TargetStats {
  target: string;
  kind: TargetKind;
  count: number;
  hits: number;
  hitRate: number;
  /** Distance moyenne au point visé (mm). */
  meanError: number;
  /** Rayon contenant la moitié des fléchettes autour du point moyen d'impact (mm) : le groupement. */
  r50: number;
  /** Décalage moyen du point d'impact (mm) : x vers la droite, y vers le haut (repère de la cible affichée). */
  biasX: number;
  biasY: number;
  /** Décalage moyen vers l'extérieur de la cible (+) ou vers le centre (−), mm. */
  radial: number;
  /** Doubles ratés : hors cible, dans le simple (dedans), dans un secteur voisin (à côté). */
  misses?: { outside: number; inside: number; side: number };
  /** Écarts au point visé (mm), les plus récents. */
  points: { dx: number; dy: number; hit: boolean }[];
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Mesures d'un groupe de fléchettes. `frame` : « screen » garde l'orientation de la cible ;
 * « target » fait pivoter chaque écart pour que le haut soit « vers l'extérieur » et la droite
 * « sens horaire » (permet de regrouper des doubles situés partout sur la cible).
 */
export function targetStats(list: Impact[], target: string, frame: "screen" | "target" = "screen", maxPoints = 400): TargetStats {
  const offsets = list.map((i) => {
    const dx = (i.x - i.aimX) * BOARD_MM;
    const dy = (i.y - i.aimY) * BOARD_MM;
    const aimR = Math.hypot(i.aimX, i.aimY);
    const ur = aimR > 1e-6 ? { x: i.aimX / aimR, y: i.aimY / aimR } : null;
    const radial = ur ? dx * ur.x + dy * ur.y : 0;
    const tangential = ur ? dx * ur.y - dy * ur.x : dx;
    return frame === "target" && ur ? { dx: tangential, dy: radial, radial, hit: i.hit } : { dx, dy, radial, hit: i.hit };
  });
  const n = offsets.length || 1;
  const biasX = offsets.reduce((s, o) => s + o.dx, 0) / n;
  const biasY = offsets.reduce((s, o) => s + o.dy, 0) / n;
  const hits = list.filter((i) => i.hit).length;
  const stats: TargetStats = {
    target,
    kind: list[0]?.kind ?? "single",
    count: list.length,
    hits,
    hitRate: list.length ? hits / list.length : 0,
    meanError: round1(offsets.reduce((s, o) => s + Math.hypot(o.dx, o.dy), 0) / n),
    r50: round1(median(offsets.map((o) => Math.hypot(o.dx - biasX, o.dy - biasY)))),
    biasX: round1(biasX),
    biasY: round1(biasY),
    radial: round1(offsets.reduce((s, o) => s + o.radial, 0) / n),
    points: offsets.slice(-maxPoints).map((o) => ({ dx: round1(o.dx), dy: round1(o.dy), hit: o.hit })),
  };
  if (list.length && list.every((i) => i.kind === "double")) {
    const misses = { outside: 0, inside: 0, side: 0 };
    for (const i of list) {
      if (i.hit) continue;
      const r = Math.hypot(i.x, i.y);
      if (r > BOARD_RADII.doubleOuter) misses.outside++;
      else if (segmentAt(i) === i.segment) misses.inside++;
      else misses.side++;
    }
    stats.misses = misses;
  }
  return stats;
}

export interface PrecisionSummary {
  impacts: number;
  ignored: number;
  matches: number;
  /** Positions des impacts (repère normalisé), les plus récentes. */
  heat: { x: number; y: number }[];
  targets: TargetStats[];
  /** Scoring (T20 et T19 réunis) et doubles réunis, dans le repère de la cible (haut = extérieur). */
  scoring: TargetStats | null;
  doubles: TargetStats | null;
  trend: { week: string; scoringCount: number; scoringError: number | null; doubleCount: number; doubleRate: number | null }[];
  tips: string[];
}

function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function directions(x: number, y: number, words: { left: string; right: string; up: string; down: string }): string {
  const parts: string[] = [];
  if (Math.abs(x) >= 3) parts.push(`${Math.round(Math.abs(x))} mm ${x < 0 ? words.left : words.right}`);
  if (Math.abs(y) >= 3) parts.push(`${Math.round(Math.abs(y))} mm ${y > 0 ? words.up : words.down}`);
  return parts.join(" et ");
}

/** Synthèse : cibles, regroupements, évolution par semaine et constats chiffrés. */
export function summarize(impacts: Impact[], ignored: number, matches: number): PrecisionSummary {
  const byTarget = new Map<string, Impact[]>();
  for (const i of impacts) byTarget.set(i.target, [...(byTarget.get(i.target) ?? []), i]);
  const targets = [...byTarget.entries()].map(([t, list]) => targetStats(list, t)).sort((a, b) => b.count - a.count);
  const scoringList = impacts.filter((i) => i.target === "T20" || i.target === "T19");
  const doubleList = impacts.filter((i) => i.kind === "double");
  const scoring = scoringList.length ? targetStats(scoringList, "Scoring (T20 / T19)", "target") : null;
  const doubles = doubleList.length ? targetStats(doubleList, "Doubles", "target") : null;

  const weeks = new Map<string, { s: Impact[]; d: Impact[] }>();
  for (const i of impacts) {
    const w = weekStart(i.at);
    const entry = weeks.get(w) ?? { s: [], d: [] };
    if (i.target === "T20" || i.target === "T19") entry.s.push(i);
    if (i.kind === "double") entry.d.push(i);
    weeks.set(w, entry);
  }
  const trend = [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-26)
    .map(([week, { s, d }]) => ({
      week,
      scoringCount: s.length,
      scoringError: s.length ? targetStats(s, "", "target", 0).meanError : null,
      doubleCount: d.length,
      doubleRate: d.length ? d.filter((i) => i.hit).length / d.length : null,
    }));

  // Constats chiffrés, seulement sur un nombre suffisant de fléchettes.
  const tips: string[] = [];
  const t20 = targets.find((t) => t.target === "T20");
  if (t20 && t20.count >= 30) {
    const dir = directions(t20.biasX, t20.biasY, { left: "à gauche", right: "à droite", up: "vers le haut", down: "vers le bas" });
    tips.push(
      dir
        ? `Au T20, votre point moyen d'impact est décalé de ${dir} : un léger ajustement de visée ou de placement au pas de tir peut le recentrer.`
        : "Au T20, votre point moyen d'impact est bien centré : le travail porte sur le groupement.",
    );
    tips.push(`Groupement au T20 : la moitié de vos fléchettes tombe à moins de ${Math.round(t20.r50)} mm de votre point moyen (la case du triple fait 8 mm de haut).`);
  }
  if (doubles && doubles.count >= 20 && doubles.misses) {
    const missed = doubles.misses.outside + doubles.misses.inside + doubles.misses.side;
    if (missed >= 10) {
      const out = doubles.misses.outside / missed;
      const inside = doubles.misses.inside / missed;
      if (out >= 0.5) tips.push(`${Math.round(out * 100)} % de vos doubles ratés sortent de la cible (fléchette perdue) : visez un peu plus vers l'intérieur du double.`);
      else if (inside >= 0.5) tips.push(`${Math.round(inside * 100)} % de vos doubles ratés tombent dans le simple : vous pouvez viser un peu plus vers l'extérieur.`);
      else tips.push(`Vos doubles ratés se répartissent : ${Math.round(out * 100)} % dehors, ${Math.round(inside * 100)} % dans le simple, ${Math.round((doubles.misses.side / missed) * 100)} % à côté.`);
    }
    const ranked = targets.filter((t) => t.kind === "double" && t.count >= 8).sort((a, b) => b.hitRate - a.hitRate);
    if (ranked.length >= 2) {
      const best = ranked[0]!;
      const worst = ranked[ranked.length - 1]!;
      if (best.hitRate > worst.hitRate) tips.push(`Votre meilleur double : ${best.target} (${Math.round(best.hitRate * 100)} %) ; le plus difficile : ${worst.target} (${Math.round(worst.hitRate * 100)} %).`);
    }
  }
  const recent = trend.slice(-4);
  const before = trend.slice(-8, -4);
  const avgErr = (rows: typeof trend) => {
    const n = rows.reduce((s, r) => s + r.scoringCount, 0);
    return n >= 30 ? rows.reduce((s, r) => s + (r.scoringError ?? 0) * r.scoringCount, 0) / n : null;
  };
  const a = avgErr(before);
  const b = avgErr(recent);
  if (a !== null && b !== null && Math.abs(a - b) >= 1) {
    tips.push(`Écart moyen au scoring sur les 4 dernières semaines : ${Math.round(b)} mm, contre ${Math.round(a)} mm les 4 semaines d'avant (${b < a ? "en progrès" : "en recul"}).`);
  }

  return {
    impacts: impacts.length,
    ignored,
    matches,
    heat: impacts.slice(-6000).map((i) => ({ x: Math.round(i.x * 1000) / 1000, y: Math.round(i.y * 1000) / 1000 })),
    targets,
    scoring,
    doubles,
    trend,
    tips,
  };
}

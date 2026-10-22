import { BOARD_ORDER, type Dart } from "./darts.js";

/**
 * Géométrie d'une cible réglementaire, en coordonnées normalisées :
 * centre (0, 0), bord extérieur de l'anneau double = rayon 1 (170 mm), y positif vers le 20.
 * C'est le repère des coordonnées transmises par le Board Manager Autodarts.
 */
export const BOARD_RADII = {
  bull: 6.35 / 170,
  outerBull: 15.9 / 170,
  tripleInner: 99 / 170,
  tripleOuter: 107 / 170,
  doubleInner: 162 / 170,
  doubleOuter: 1,
} as const;

export type BoardRing = "bull" | "outerBull" | "innerSingle" | "triple" | "outerSingle" | "double" | "outside";

export interface BoardPoint {
  x: number;
  y: number;
}

const SEGMENT_ANGLE = 18;

/** Angle (degrés, sens horaire depuis le 20) du centre d'un secteur. */
export function segmentAngle(segment: number): number {
  const index = BOARD_ORDER.indexOf(segment);
  return index < 0 ? 0 : index * SEGMENT_ANGLE;
}

/** Secteur (1 à 20) sous un point, d'après son angle. */
export function segmentAt(point: BoardPoint): number {
  const angle = ((Math.atan2(point.x, point.y) * 180) / Math.PI + 360) % 360;
  const index = Math.floor((angle + SEGMENT_ANGLE / 2) / SEGMENT_ANGLE) % BOARD_ORDER.length;
  return BOARD_ORDER[index] as number;
}

export function ringAt(radius: number): BoardRing {
  const r = BOARD_RADII;
  if (radius <= r.bull) return "bull";
  if (radius <= r.outerBull) return "outerBull";
  if (radius < r.tripleInner) return "innerSingle";
  if (radius <= r.tripleOuter) return "triple";
  if (radius < r.doubleInner) return "outerSingle";
  if (radius <= r.doubleOuter) return "double";
  return "outside";
}

/** Fléchette correspondant à un point de la cible (hors cible : raté). */
export function classifyPoint(point: BoardPoint): Dart & { ring: BoardRing } {
  const ring = ringAt(Math.hypot(point.x, point.y));
  switch (ring) {
    case "bull":
      return { segment: 25, multiplier: 2, ring };
    case "outerBull":
      return { segment: 25, multiplier: 1, ring };
    case "outside":
      return { segment: 0, multiplier: 0, ring };
    default:
      return { segment: segmentAt(point), multiplier: ring === "triple" ? 3 : ring === "double" ? 2 : 1, ring };
  }
}

function sameDart(a: Dart, b: Dart): boolean {
  if (a.multiplier === 0 || b.multiplier === 0) return a.multiplier === b.multiplier;
  return a.segment === b.segment && a.multiplier === b.multiplier;
}

/** Le point tombe dans la case de la fléchette (avec une petite tolérance pour les fléchettes sur un fil). */
export function pointMatchesDart(point: BoardPoint, dart: Dart, tolerance = 0.012): boolean {
  const probes: BoardPoint[] = [
    point,
    { x: point.x + tolerance, y: point.y },
    { x: point.x - tolerance, y: point.y },
    { x: point.x, y: point.y + tolerance },
    { x: point.x, y: point.y - tolerance },
  ];
  return probes.some((p) => sameDart(classifyPoint(p), dart));
}

function polar(radius: number, angleDeg: number): BoardPoint {
  const a = (angleDeg * Math.PI) / 180;
  return { x: Number((Math.sin(a) * radius).toFixed(4)), y: Number((Math.cos(a) * radius).toFixed(4)) };
}

/**
 * Position représentative d'une fléchette dont on ne connaît pas l'impact réel (saisie manuelle) :
 * centre de sa case, légèrement décalé selon le rang de la fléchette pour éviter les superpositions.
 * `null` pour un raté (aucune case).
 */
export function bedCenter(dart: Dart, slot = 0): BoardPoint | null {
  const r = BOARD_RADII;
  const shift = [0, 1, -1][slot % 3] as number;
  if (dart.multiplier === 0) return null;
  if (dart.segment === 25) {
    if (dart.multiplier === 2) return polar(r.bull * 0.45 * Math.abs(shift), 120 * slot);
    return polar((r.bull + r.outerBull) / 2, 90 + 120 * slot);
  }
  const angle = segmentAngle(dart.segment) + shift * 4.5;
  if (dart.multiplier === 3) return polar((r.tripleInner + r.tripleOuter) / 2, angle);
  if (dart.multiplier === 2) return polar((r.doubleInner + r.doubleOuter) / 2, angle);
  return polar((r.tripleOuter + r.doubleInner) / 2 + shift * 0.045, angle);
}

export interface PlacedDart {
  point: BoardPoint;
  /** true : position réelle de l'impact ; false : position représentative (saisie manuelle). */
  exact: boolean;
  ring: BoardRing;
}

/**
 * Où dessiner une fléchette sur la cible. Les coordonnées reçues ne sont utilisées que si elles
 * tombent bien dans la case de la fléchette comptée (une correction peut avoir changé la valeur) ;
 * un repère dont l'axe vertical serait inversé est aussi accepté.
 */
export function placeDart(dart: Dart, coords: BoardPoint | null | undefined, slot = 0): PlacedDart | null {
  if (coords && Number.isFinite(coords.x) && Number.isFinite(coords.y)) {
    const candidates: BoardPoint[] = [coords, { x: coords.x, y: -coords.y }];
    for (const point of candidates) {
      if (dart.multiplier === 0) {
        const radius = Math.hypot(point.x, point.y);
        if (radius > BOARD_RADII.doubleOuter) {
          const k = Math.min(1, 1.26 / radius);
          return { point: { x: point.x * k, y: point.y * k }, exact: true, ring: "outside" };
        }
        continue;
      }
      if (pointMatchesDart(point, dart)) return { point, exact: true, ring: classifyPoint(point).ring };
    }
  }
  const point = bedCenter(dart, slot);
  if (!point) return null;
  return { point, exact: false, ring: classifyPoint(point).ring };
}

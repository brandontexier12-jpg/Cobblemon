import { describe, expect, it } from "vitest";
import { bedCenter, BOARD_RADII, classifyPoint, placeDart, pointMatchesDart, segmentAt } from "../src/board.js";
import { BOARD_ORDER, SCORING_DARTS, type Dart } from "../src/darts.js";

const dart = (segment: number, multiplier: Dart["multiplier"]): Dart => ({ segment, multiplier });

describe("géométrie de la cible", () => {
  it("retrouve les secteurs dans l'ordre réglementaire, sens horaire depuis le 20", () => {
    expect(segmentAt({ x: 0, y: 0.8 })).toBe(20);
    expect(segmentAt({ x: 0.8, y: 0 })).toBe(6);
    expect(segmentAt({ x: 0, y: -0.8 })).toBe(3);
    expect(segmentAt({ x: -0.8, y: 0 })).toBe(11);
    // Juste de part et d'autre de la frontière 20 | 1 (9°).
    const a = (8.5 * Math.PI) / 180;
    const b = (9.5 * Math.PI) / 180;
    expect(segmentAt({ x: Math.sin(a), y: Math.cos(a) })).toBe(20);
    expect(segmentAt({ x: Math.sin(b), y: Math.cos(b) })).toBe(1);
  });

  it("classe les anneaux selon les dimensions réglementaires", () => {
    expect(classifyPoint({ x: 0, y: 0.01 })).toMatchObject({ segment: 25, multiplier: 2 });
    expect(classifyPoint({ x: 0, y: 0.07 })).toMatchObject({ segment: 25, multiplier: 1 });
    expect(classifyPoint({ x: 0, y: 0.3 })).toMatchObject({ segment: 20, multiplier: 1, ring: "innerSingle" });
    expect(classifyPoint({ x: 0, y: 0.6 })).toMatchObject({ segment: 20, multiplier: 3 });
    expect(classifyPoint({ x: 0, y: 0.8 })).toMatchObject({ segment: 20, multiplier: 1, ring: "outerSingle" });
    expect(classifyPoint({ x: 0, y: 0.97 })).toMatchObject({ segment: 20, multiplier: 2 });
    expect(classifyPoint({ x: 0, y: 1.1 })).toMatchObject({ segment: 0, multiplier: 0, ring: "outside" });
  });

  it("place chaque fléchette marquante au centre de sa propre case", () => {
    for (const d of SCORING_DARTS) {
      for (const slot of [0, 1, 2]) {
        const p = bedCenter(d, slot);
        expect(p, `${d.segment}×${d.multiplier}`).not.toBeNull();
        expect(classifyPoint(p!), `${d.segment}×${d.multiplier} rang ${slot}`).toMatchObject({ segment: d.segment, multiplier: d.multiplier });
      }
    }
    expect(bedCenter(dart(0, 0))).toBeNull();
  });

  it("utilise les coordonnées Autodarts quand elles correspondent à la fléchette comptée", () => {
    // Coordonnées des enregistrements de référence (fixtures du Board Manager).
    expect(placeDart(dart(20, 3), { x: 0.0021, y: 0.6012 })).toMatchObject({ exact: true, point: { x: 0.0021, y: 0.6012 } });
    expect(placeDart(dart(20, 2), { x: 0.01, y: 0.97 })).toMatchObject({ exact: true });
    // Impact sur un fil : tolérance.
    expect(pointMatchesDart({ x: 0, y: BOARD_RADII.tripleOuter + 0.005 }, dart(20, 3))).toBe(true);
    // Axe vertical inversé : accepté.
    expect(placeDart(dart(3, 1), { x: 0, y: 0.8 })).toMatchObject({ exact: true, point: { x: 0, y: -0.8 } });
    // Fléchette corrigée (T20 → S5) : la position d'origine n'est plus pertinente.
    const corrected = placeDart(dart(5, 1), { x: 0.0021, y: 0.6012 });
    expect(corrected?.exact).toBe(false);
    expect(classifyPoint(corrected!.point)).toMatchObject({ segment: 5, multiplier: 1 });
  });

  it("dessine un raté hors cible seulement si sa position est connue", () => {
    const miss = placeDart(dart(0, 0), { x: -0.42, y: -1.08 });
    expect(miss).toMatchObject({ exact: true, ring: "outside" });
    expect(Math.hypot(miss!.point.x, miss!.point.y)).toBeLessThanOrEqual(1.2601);
    expect(placeDart(dart(0, 0), null)).toBeNull();
  });

  it("couvre les 20 secteurs", () => {
    expect(new Set(BOARD_ORDER.map((s) => segmentAt(bedCenter(dart(s, 1))!))).size).toBe(20);
  });
});

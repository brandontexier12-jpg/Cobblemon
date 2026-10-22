import { prepareConfig, aimPoint, type Aim } from "@darts-evolution/game-engine";
import { classifyPoint } from "@darts-evolution/shared";
import { describe, expect, it } from "vitest";
import { BOARD_MM, coherentPoint, extractImpacts, summarize, targetStats, type ReplayEvent } from "../src/precision/analyze.js";

const ALICE = { id: "a", name: "Alice" };
const BOB = { id: "b", name: "Bob" };
let clock = Date.parse("2026-09-01T10:00:00Z");

/** Fléchette Autodarts tombée à (dx, dy) mm du centre de la case visée ; sa valeur découle de la position. */
function at(aim: Aim, dxMm = 0, dyMm = 0, source = "autodarts"): ReplayEvent {
  const p = aimPoint(aim);
  const point = { x: p.x + dxMm / BOARD_MM, y: p.y + dyMm / BOARD_MM };
  const { segment, multiplier } = classifyPoint(point);
  clock += 5000;
  return { type: "dart", segment, multiplier, source, x: point.x, y: point.y, at: new Date(clock).toISOString() };
}
const T20: Aim = { segment: 20, ring: "triple" };
const T19: Aim = { segment: 19, ring: "triple" };
const D8: Aim = { segment: 8, ring: "double" };

function x01(players = [ALICE]) {
  return { config: prepareConfig("x01", { startScore: 501, outRule: "double", legs: 1, sets: 1 }, players, 1), players };
}

describe("carte de précision : positions et cibles visées", () => {
  it("garde une position cohérente avec la case comptée (ou à l'axe vertical inversé), écarte les autres", () => {
    const p = aimPoint(T20);
    expect(coherentPoint({ segment: 20, multiplier: 3 }, p.x, p.y)).toEqual(p);
    expect(coherentPoint({ segment: 20, multiplier: 3 }, p.x, -p.y)).toEqual(p);
    expect(coherentPoint({ segment: 5, multiplier: 1 }, p.x, p.y)).toBeNull();
    expect(coherentPoint({ segment: 0, multiplier: 0 }, 0, 1.1)).toEqual({ x: 0, y: 1.1 });
    expect(coherentPoint({ segment: 0, multiplier: 0 }, 0, 0.5)).toBeNull();
  });

  it("rejoue la partie : T20 au scoring, T19 si la fléchette est tombée de ce côté, double de la sortie", () => {
    const { config, players } = x01();
    const events: ReplayEvent[] = [
      // 501 → 321 → 141 : scoring au T20, décalé de 5 mm vers la gauche.
      at(T20, -5), at(T20, -5), at(T20, -5),
      at(T20, -5), at(T20, -5), at(T20, -5),
      // 141 : T20, puis T19 (route de sortie) ; à 24 avec une fléchette, le joueur vise D12 : le S5 est un double raté.
      at(T20, -5), at(T19, 2), at({ segment: 5, ring: "single" }),
      // 19 : S3 (préparation de la sortie, intention incertaine : ignorée), puis 16 : double 8.
      at({ segment: 3, ring: "single" }),
      // 16 : un raté dehors, un simple 8 (dedans) ; reste 8 : le D4 termine.
      at(D8, 0, -12), at(D8, 0, 0), at({ segment: 4, ring: "double" }),
    ];
    // Ajuste les deux fléchettes « D8 » ratées : dehors (vers l'extérieur) et dedans (vers le centre).
    const p = aimPoint(D8);
    const ur = { x: p.x / Math.hypot(p.x, p.y), y: p.y / Math.hypot(p.x, p.y) };
    const shift = (e: ReplayEvent, mm: number) => {
      const point = { x: p.x + (ur.x * mm) / BOARD_MM, y: p.y + (ur.y * mm) / BOARD_MM };
      const d = classifyPoint(point);
      Object.assign(e, { x: point.x, y: point.y, segment: d.segment, multiplier: d.multiplier });
    };
    shift(events[10]!, 9); // hors cible
    shift(events[11]!, -20); // dans le simple 8
    const { impacts, incoherent } = extractImpacts("x01", config, players, events, "a");
    expect(incoherent).toBe(0);
    expect(impacts.map((i) => i.target)).toEqual(["T20", "T20", "T20", "T20", "T20", "T20", "T20", "T19", "D12", "D8", "D8", "D4"]);
    expect(impacts[11]).toMatchObject({ target: "D4", hit: true });
    expect(impacts[8]).toMatchObject({ target: "D12", hit: false });
    expect(impacts.slice(0, 7).every((i) => i.hit)).toBe(true);
    const t20 = targetStats(impacts.filter((i) => i.target === "T20"), "T20");
    expect(t20.biasX).toBeCloseTo(-5, 1);
    expect(t20.biasY).toBeCloseTo(0, 1);
    expect(t20.meanError).toBeCloseTo(5, 1);
    expect(t20.r50).toBeCloseTo(0, 1);
    const d8 = targetStats(impacts.filter((i) => i.target === "D8"), "D8");
    expect(d8).toMatchObject({ count: 2, hits: 0, misses: { outside: 1, inside: 1, side: 0 } });
  });

  it("ne garde que les fléchettes Autodarts du joueur choisi, et compte les positions incohérentes", () => {
    const { config, players } = x01([ALICE, BOB]);
    const corrected = at(T20);
    corrected.segment = 1; // valeur corrigée à la main : la position ne correspond plus
    corrected.multiplier = 1;
    const events: ReplayEvent[] = [at(T20), at(T20, 0, 0, "manual"), corrected, at(T20), at(T20), at(T20)];
    const { impacts, incoherent } = extractImpacts("x01", config, players, events, "a");
    expect(impacts).toHaveLength(1);
    expect(incoherent).toBe(1);
    expect(extractImpacts("x01", config, players, events, "b").impacts).toHaveLength(3);
  });

  it("doubles réunis dans le repère de la cible : le haut est toujours « vers l'extérieur »", () => {
    // Deux doubles opposés (D20 en haut, D3 en bas), chacun raté de 6 mm vers l'extérieur.
    const outward = (segment: number, mm: number) => {
      const aim = aimPoint({ segment, ring: "double" });
      const r = Math.hypot(aim.x, aim.y);
      return { x: aim.x * (1 + mm / BOARD_MM / r), y: aim.y * (1 + mm / BOARD_MM / r), aimX: aim.x, aimY: aim.y, target: `D${segment}`, kind: "double" as const, segment, hit: false, at: "" };
    };
    const list = [outward(20, 6), outward(3, 6)];
    const grouped = targetStats(list, "Doubles", "target");
    expect(grouped.biasY).toBeCloseTo(6, 1);
    expect(grouped.radial).toBeCloseTo(6, 1);
    expect(grouped.misses).toEqual({ outside: 2, inside: 0, side: 0 });
    // Dans le repère de la cible affichée, les deux décalages (haut et bas) s'annulent.
    expect(targetStats(list, "Doubles").biasY).toBeCloseTo(0, 1);
  });

  it("synthèse : constats chiffrés à partir de 30 fléchettes au T20", () => {
    const { config, players } = x01();
    const events: ReplayEvent[] = [];
    for (let i = 0; i < 40; i++) events.push(at(T20, 6, -4));
    // Partie sans fin : on rejoue par tranches de legs de 501 (8 visites de T20 = 480, puis rien).
    const impacts = [];
    for (let leg = 0; leg < 5; leg++) impacts.push(...extractImpacts("x01", config, players, events.slice(leg * 8, leg * 8 + 8), "a").impacts);
    const s = summarize(impacts, 2, 5);
    expect(s).toMatchObject({ impacts: 40, ignored: 2, matches: 5 });
    expect(s.targets[0]).toMatchObject({ target: "T20", count: 40 });
    expect(s.tips[0]).toBe("Au T20, votre point moyen d'impact est décalé de 6 mm à droite et 4 mm vers le bas : un léger ajustement de visée ou de placement au pas de tir peut le recentrer.");
    expect(s.tips[1]).toContain("la moitié de vos fléchettes tombe à moins de 0 mm");
    expect(s.heat).toHaveLength(40);
    expect(s.trend).toHaveLength(1);
    expect(s.trend[0]!.scoringCount).toBe(40);
  });
});

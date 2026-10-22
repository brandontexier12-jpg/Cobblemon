import { createRng } from "@darts-evolution/shared";
import { describe, expect, it } from "vitest";
import { aimFromLabel, BOT_AVERAGES, botSigma, botThrow, chooseAim } from "../src/bots.js";
import { applyEvent } from "../src/core.js";
import type { GameState } from "../src/types.js";
import { describeGame } from "../src/view.js";
import { ALICE, BOB, newGame, play } from "./helpers.js";

/** Joue une partie complète entre bots ; renvoie l'état final et le nombre de fléchettes. */
function botMatch(state: GameState, averages: number[], seed: number, maxDarts = 4000) {
  const rng = createRng(seed);
  let s = state;
  let darts = 0;
  while (!s.finished && darts < maxDarts) {
    if (s.turn.complete) {
      s = applyEvent(s, { type: "next" });
      continue;
    }
    const { dart, coords } = botThrow(s, averages[s.turn.playerIndex]!, rng);
    s = applyEvent(s, { type: "dart", dart, coords, source: "bot" });
    darts++;
  }
  return { state: s, darts };
}

describe("bots", () => {
  it("propose une vingtaine de niveaux de 20 à 170 de moyenne", () => {
    expect(BOT_AVERAGES[0]).toBe(20);
    expect(BOT_AVERAGES[BOT_AVERAGES.length - 1]).toBe(170);
    expect(BOT_AVERAGES.length).toBeGreaterThanOrEqual(20);
    // Plus le niveau est élevé, plus la dispersion est faible.
    const sigmas = BOT_AVERAGES.map(botSigma);
    for (let i = 1; i < sigmas.length; i++) expect(sigmas[i]).toBeLessThan(sigmas[i - 1]!);
  });

  it("atteint en partie la moyenne de son niveau (501, double sortie, sorties comprises)", () => {
    for (const average of [40, 60, 100, 150]) {
      let points = 0;
      let darts = 0;
      for (let g = 0; g < 25; g++) {
        const { state } = botMatch(newGame("x01", { startScore: 501 }, [ALICE]), [average], average * 100 + g);
        for (const v of state.visits) {
          points += v.points;
          darts += v.darts.length;
        }
      }
      const measured = (points / darts) * 3;
      expect(Math.abs(measured - average), `niveau ${average} : ${measured.toFixed(1)}`).toBeLessThan(average * 0.08);
    }
  });

  it("vise la sortie conseillée, le double d'ouverture et les placements sans bust", () => {
    const one = (start: number, ...labels: string[]) => play(newGame("x01", { startScore: start }, [ALICE]), ...labels);
    expect(chooseAim(one(101, "T20", "S1"))).toEqual({ segment: 20, ring: "double" }); // reste 40, 1 fléchette
    expect(chooseAim(one(101, "S1"))).toEqual({ segment: 20, ring: "triple" }); // reste 100 en 2 : T20 puis D20
    expect(chooseAim(one(101, "S20", "S1"))).toEqual({ segment: 20, ring: "triple" }); // reste 80 en 1 : T20 laisse D10
    expect(chooseAim(one(101, "S20", "T6"))).toEqual({ segment: 19, ring: "triple" }); // reste 63 en 1 : T19 laisse D3
    expect(chooseAim(one(101, "T20", "S3"))).toEqual({ segment: 19, ring: "double" }); // reste 38 en 1 : D19
    expect(chooseAim(one(101, "T20", "S2"))).toEqual({ segment: 7, ring: "single" }); // reste 39 en 1 : S7 laisse D16

    expect(chooseAim(newGame("x01", { startScore: 501 }, [ALICE]))).toEqual({ segment: 20, ring: "triple" });
    expect(chooseAim(newGame("x01", { startScore: 301, inRule: "double" }, [ALICE]))).toEqual({ segment: 20, ring: "double" });
  });

  it("termine des parties X01 complètes à tous les niveaux", () => {
    for (const [average, seed] of [
      [20, 1],
      [60, 2],
      [100, 3],
      [170, 4],
    ] as const) {
      const { state, darts } = botMatch(newGame("x01", { startScore: 501 }, [ALICE, BOB]), [average, average], seed);
      expect(state.finished, `niveau ${average}`).toBe(true);
      expect(darts).toBeLessThan(average >= 100 ? 120 : 4000);
    }
  });

  it("joue les autres modes : cricket, tour de l'horloge, Bob's 27", () => {
    for (const mode of ["cricket", "around_the_clock", "bobs_27", "shanghai", "count_up"] as const) {
      const { state } = botMatch(newGame(mode, {}, mode === "bobs_27" ? [ALICE] : [ALICE, BOB]), [90, 90], 9);
      expect(state.finished, mode).toBe(true);
    }
  });

  it("lit les cibles des modes", () => {
    expect(aimFromLabel("D16", false)).toEqual({ segment: 16, ring: "double" });
    expect(aimFromLabel("7", false)).toEqual({ segment: 7, ring: "single" });
    expect(aimFromLabel("7", true)).toEqual({ segment: 7, ring: "triple" });
    expect(aimFromLabel("Bull (25/50)", false)).toEqual({ segment: 25, ring: "bull" });
    expect(aimFromLabel("78", false)).toBeNull();
    const atc = newGame("around_the_clock", {}, [ALICE]);
    expect(chooseAim(atc)).toEqual(aimFromLabel(describeGame(atc).current.target, false));
  });
});

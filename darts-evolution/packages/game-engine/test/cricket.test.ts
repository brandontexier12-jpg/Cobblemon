import { describe, expect, it } from "vitest";
import type { CricketState } from "../src/modes/cricket.js";
import { describeGame } from "../src/view.js";
import { ALICE, BOB, CAROL, newGame, play } from "./helpers.js";

const m = (s: { m: unknown }) => s.m as CricketState;

describe("Cricket", () => {
  it("compte les marques et ferme les numéros", () => {
    let s = newGame("cricket", {}, [ALICE, BOB]);
    s = play(s, "S20", "D20", "S5");
    expect(m(s).marks[0]).toEqual([3, 0, 0, 0, 0, 0, 0]);
    expect(s.visits[0]?.marks).toBe(3);
    expect(m(s).points).toEqual([0, 0]);
  });

  it("classique : les marques en trop rapportent des points tant qu'un adversaire est ouvert", () => {
    let s = newGame("cricket", {}, [ALICE, BOB]);
    s = play(s, "T20", "T20", "S20"); // ferme puis marque 60 + 20
    expect(m(s).points).toEqual([80, 0]);
    s = play(s, "T20", "S1", "S1"); // Bob ferme le 20
    s = play(s, "T20"); // le 20 est fermé par tous : plus de points
    expect(m(s).points).toEqual([80, 0]);
  });

  it("bull : extérieur 1 marque, intérieur 2 marques, 25 points par marque en trop", () => {
    let s = newGame("cricket", {}, [ALICE, BOB]);
    s = play(s, "25", "BULL", "BULL");
    expect(m(s).marks[0]?.[6]).toBe(3);
    expect(m(s).points[0]).toBe(50);
  });

  it("cut-throat : les points sont infligés aux adversaires ouverts", () => {
    let s = newGame("cricket", { variant: "cut_throat" }, [ALICE, BOB, CAROL]);
    s = play(s, "T19", "T19");
    expect(m(s).points).toEqual([0, 57, 57]);
    s = play(s, "next", "T19", "S19");
    // Bob a fermé le 19 : le S19 en trop n'est infligé qu'à Carol.
    expect(m(s).points).toEqual([0, 57, 76]);
  });

  it("déclare le vainqueur quand tout est fermé avec assez de points", () => {
    let s = newGame("cricket", {}, [ALICE, BOB]);
    // Alice ferme tout pendant que Bob rate.
    s = play(s, "T20", "T19", "T18", "MISS", "MISS", "MISS", "T17", "T16", "T15", "MISS", "MISS", "MISS", "BULL", "25");
    expect(s.finished).toBe(true);
    expect(s.winners).toEqual(["alice"]);
    expect(s.visits[s.visits.length - 1]?.endReason).toBe("win");
  });

  it("n'accorde pas la victoire avec moins de points (classique)", () => {
    let s = newGame("cricket", {}, [ALICE, BOB]);
    s = play(s, "MISS", "MISS", "MISS", "T20", "T20", "MISS"); // Bob : 60 points
    expect(m(s).points).toEqual([0, 60]);
    s = play(s, "T20", "T19", "T18", "MISS", "MISS", "MISS", "T17", "T16", "T15", "MISS", "MISS", "MISS", "BULL", "25");
    expect(m(s).marks[0]?.every((v) => v === 3)).toBe(true);
    expect(s.finished).toBe(false); // tout fermé mais 0 < 60
    s = play(s, "T19"); // 57 points : toujours derrière
    expect(s.finished).toBe(false);
    s = play(s, "MISS", "MISS", "MISS", "T19");
    expect(m(s).points[0]).toBe(114);
    expect(s.finished).toBe(true);
    expect(s.winners).toEqual(["alice"]);
  });

  it("termine à la limite de manches au meilleur total", () => {
    let s = newGame("cricket", { maxRounds: 1 }, [ALICE, BOB]);
    s = play(s, "T20", "S20", "MISS", "T19", "MISS", "MISS");
    expect(s.finished).toBe(true);
    expect(s.winners).toEqual(["alice"]);
    const view = describeGame(s);
    expect(view.board?.rows[0]?.cells[0]).toBe("Ⓧ");
  });
});

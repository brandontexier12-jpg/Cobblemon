import { describe, expect, it } from "vitest";
import { applyEvent, replay } from "../src/core.js";
import type { X01State } from "../src/modes/x01.js";
import type { GameEvent } from "../src/types.js";
import { describeGame } from "../src/view.js";
import { ALICE, BOB, dart, NEXT, newGame, play } from "./helpers.js";

const m = (s: { m: unknown }) => s.m as X01State;

describe("X01", () => {
  it("décompte les points d'une visite", () => {
    let s = newGame("x01", { startScore: 501 }, [ALICE, BOB]);
    s = play(s, "T20", "T20", "T20");
    expect(m(s).remaining).toEqual([321, 501]);
    expect(s.visits[0]).toMatchObject({ points: 180, bust: false, playerId: "alice", firstOfLeg: true, remainingBefore: 501 });
    expect(s.turn.complete).toBe(true);
    // La fléchette suivante passe automatiquement au joueur suivant.
    s = play(s, "S1");
    expect(s.turn.playerIndex).toBe(1);
    expect(m(s).remaining).toEqual([321, 500]);
  });

  it("gère le bust : score négatif", () => {
    let s = newGame("x01", { startScore: 101 }, [ALICE]);
    s = play(s, "T20", "S9", "next"); // 101 - 69 = 32
    expect(m(s).remaining[0]).toBe(32);
    s = play(s, "S10", "T20"); // 22 puis -38 → bust
    expect(s.turn.complete).toBe(true);
    expect(s.turn.endReason).toBe("bust");
    expect(m(s).remaining[0]).toBe(32);
    const last = s.visits[s.visits.length - 1]!;
    expect(last).toMatchObject({ bust: true, points: 0, remainingBefore: 32, remainingAfter: 32 });
    expect(last.darts).toHaveLength(2);
  });

  it("double sortie : terminer sur un simple est un bust, reste 1 est un bust", () => {
    let s = newGame("x01", { startScore: 101, outRule: "double" }, [ALICE]);
    s = play(s, "T20", "S1"); // 40
    s = play(s, "S20", "next"); // 20 restant après visite
    expect(m(s).remaining[0]).toBe(40 - 20);
    s = play(s, "S20"); // 0 sans double → bust
    expect(s.turn.endReason).toBe("bust");
    expect(m(s).remaining[0]).toBe(20);
    s = play(s, "S19"); // reste 1 → bust
    expect(s.turn.endReason).toBe("bust");
    expect(m(s).remaining[0]).toBe(20);
    s = play(s, "D10");
    expect(s.finished).toBe(true);
    expect(s.winners).toEqual(["alice"]);
    expect(s.visits[s.visits.length - 1]).toMatchObject({ checkout: true, remainingBefore: 20, points: 20 });
  });

  it("simple sortie : 301 sans obligation de double", () => {
    let s = newGame("x01", { startScore: 301, outRule: "single" }, [ALICE]);
    s = play(s, "T20", "T20", "T20", "T20", "T20", "S20"); // 301 - 320 → bust sur S20
    expect(m(s).remaining[0]).toBe(121);
    s = play(s, "T20", "T20", "S1");
    expect(s.finished).toBe(true);
    expect(s.visits[s.visits.length - 1]?.checkout).toBe(true);
  });

  it("master sortie : terminer sur un triple", () => {
    let s = newGame("x01", { startScore: 101, outRule: "master" }, [ALICE]);
    s = play(s, "T20", "S20", "T7");
    expect(s.finished).toBe(true);
  });

  it("double départ : rien ne compte avant un double", () => {
    let s = newGame("x01", { startScore: 301, inRule: "double" }, [ALICE]);
    s = play(s, "T20", "S20", "D10");
    expect(m(s).remaining[0]).toBe(281);
    expect(s.visits[0]?.points).toBe(20);
    expect(s.visits[0]?.darts.map((d) => d.points)).toEqual([0, 0, 20]);
    s = play(s, "T20");
    expect(m(s).remaining[0]).toBe(221);
  });

  it("master départ : un triple ouvre le score", () => {
    let s = newGame("x01", { startScore: 301, inRule: "master" }, [ALICE]);
    s = play(s, "S20", "T20");
    expect(m(s).remaining[0]).toBe(241);
  });

  it("gère legs et sets avec alternance du joueur qui commence", () => {
    let s = newGame("x01", { startScore: 101, legs: 2, sets: 2, outRule: "single" }, [ALICE, BOB]);
    const winLeg = ["T20", "T13", "S2"]; // 60 + 39 + 2 = 101
    // Leg 1 : Alice commence ; sa première visite est un bust.
    s = play(s, "T20", "T20");
    expect(s.turn.endReason).toBe("bust");
    expect(m(s).remaining[0]).toBe(101);
    s = play(s, "next", "S1", "next", ...winLeg);
    expect(m(s).legsWon).toEqual([1, 0]);
    s = play(s, "next");
    // Leg 2 : Bob commence et gagne.
    expect(s.turn.playerIndex).toBe(1);
    expect(m(s).remaining).toEqual([101, 101]);
    s = play(s, ...winLeg);
    expect(m(s).legsWon).toEqual([1, 1]);
    s = play(s, "next");
    // Leg 3 : Alice commence et gagne le set 1.
    expect(s.turn.playerIndex).toBe(0);
    s = play(s, ...winLeg);
    expect(m(s).setsWon).toEqual([1, 0]);
    s = play(s, "next");
    // Set 2 : Bob commence le premier leg du set.
    expect(m(s).set).toBe(2);
    expect(m(s).legsWon).toEqual([0, 0]);
    expect(s.turn.playerIndex).toBe(1);
    s = play(s, "S1", "next", ...winLeg);
    s = play(s, "next");
    // Leg 2 du set 2 : Alice commence.
    expect(s.turn.playerIndex).toBe(0);
    s = play(s, ...winLeg);
    expect(s.finished).toBe(true);
    expect(s.winners).toEqual(["alice"]);
    expect(m(s).totalLegsWon).toEqual([4, 1]);
  });

  it("« suivant » termine la visite avec des ratés", () => {
    let s = newGame("x01", { startScore: 501 }, [ALICE, BOB]);
    s = play(s, "T20", "next");
    expect(s.visits[0]?.darts).toHaveLength(3);
    expect(s.visits[0]?.darts.filter((d) => d.padded)).toHaveLength(2);
    expect(s.visits[0]?.endReason).toBe("early");
    expect(s.turn.playerIndex).toBe(1);
  });

  it("rejoue un journal à l'identique, annule et corrige", () => {
    const events: GameEvent[] = ["T20", "T19", "T18", "S20", "S20", "S20"].map(dart);
    const base = newGame("x01", { startScore: 501 }, [ALICE, BOB]);
    const full = replay(base.mode, base.config, base.players, events);
    expect(m(full).remaining).toEqual([330, 441]);
    // Annuler = rejouer sans le dernier événement.
    const undone = replay(base.mode, base.config, base.players, events.slice(0, -1));
    expect(m(undone).remaining).toEqual([330, 461]);
    // Corriger la 1re fléchette (T20 → S20) recalcule tout.
    const corrected = replay(base.mode, base.config, base.players, [dart("S20"), ...events.slice(1)]);
    expect(m(corrected).remaining).toEqual([370, 441]);
    expect(corrected.visits[0]?.points).toBe(131);
  });

  it("refuse les fléchettes après la fin de partie", () => {
    let s = newGame("x01", { startScore: 101, outRule: "single" }, [ALICE]);
    s = play(s, "T20", "S20", "S20", "S1");
    expect(s.finished).toBe(true);
    expect(() => applyEvent(s, dart("S1"))).toThrow(/terminée/);
    expect(() => applyEvent(s, NEXT)).toThrow(/terminée/);
  });

  it("calcule les indicateurs de sortie et la vue", () => {
    let s = newGame("x01", { startScore: 301 }, [ALICE, BOB]);
    s = play(s, "T20", "T20", "T20"); // Alice 121
    s = play(s, "S1", "next"); // Bob 300
    s = play(s, "S1", "next"); // Alice 120
    s = play(s, "S1", "next"); // Bob 299, au tour d'Alice
    let view = describeGame(s);
    expect(view.players[0]?.main).toBe("120");
    expect(view.current.playerIndex).toBe(0);
    expect(view.checkout?.routes[0]).toEqual(["T20", "S20", "D20"]);
    s = play(s, "T20", "S20"); // Alice 40, une fléchette restante
    view = describeGame(s);
    expect(view.checkout?.routes[0]).toEqual(["D20"]);
    expect(view.checkout?.dartsLeft).toBe(1);
    s = play(s, "S10"); // 30
    s = play(s, "S1", "next"); // Bob
    s = play(s, "D15"); // Alice termine
    const visit = s.visits[s.visits.length - 1]!;
    expect(visit.checkoutChance).toBe(true);
    expect(visit.darts[0]?.checkoutAttempt).toBe(true);
    expect(visit.checkout).toBe(true);
    expect(s.finished).toBe(true);
    expect(describeGame(s).players[0]?.winner).toBe(true);
  });

  it("refuse une fléchette invalide", () => {
    const s = newGame("x01", {}, [ALICE]);
    expect(() => applyEvent(s, { type: "dart", dart: { segment: 25, multiplier: 3 } })).toThrow(/invalide/);
    expect(() => applyEvent(s, { type: "dart", dart: { segment: 21, multiplier: 1 } })).toThrow(/invalide/);
  });
});

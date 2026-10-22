import { describe, expect, it } from "vitest";
import { prepareConfig } from "../src/registry.js";
import { describeGame } from "../src/view.js";
import { ALICE, BOB, CAROL, newGame, play } from "./helpers.js";

const m = (s: { m: unknown }) => s.m as any;

describe("Count-up", () => {
  it("le premier à atteindre l'objectif gagne immédiatement", () => {
    let s = newGame("count_up", { target: 100 }, [ALICE, BOB]);
    s = play(s, "T20", "S20", "S10", "T20", "S20", "MISS", "S10");
    expect(m(s).totals).toEqual([100, 80]);
    expect(s.finished).toBe(true);
    expect(s.winners).toEqual(["alice"]);
  });
});

describe("High Score", () => {
  it("se termine après la dernière manche du dernier joueur", () => {
    let s = newGame("high_score", { rounds: 2 }, [ALICE, BOB]);
    s = play(s, "T20", "T20", "T20", "S1", "S1", "S1", "S5", "S5", "S5");
    expect(s.finished).toBe(false);
    s = play(s, "S1", "S1", "S1");
    expect(s.finished).toBe(true);
    expect(m(s).totals).toEqual([195, 6]);
    expect(s.winners).toEqual(["alice"]);
  });
});

describe("Around the Clock", () => {
  it("avance dans l'ordre et gagne sur le bull", () => {
    let s = newGame("around_the_clock", { includeBull: true }, [ALICE]);
    const darts = Array.from({ length: 20 }, (_, i) => `S${i + 1}`);
    s = play(s, "S2", ...darts);
    expect(m(s).position[0]).toBe(20);
    expect(describeGame(s).current.target ?? describeGame(s).players[0]?.main).toBeDefined();
    s = play(s, "25");
    expect(s.finished).toBe(true);
    expect(m(s).hits[0]).toBe(21);
    expect(m(s).darts[0]).toBe(22);
  });

  it("option saut : un triple avance de 3 sans sauter la dernière cible", () => {
    let s = newGame("around_the_clock", { skipOnMultiplier: true, includeBull: false }, [ALICE]);
    s = play(s, "T1");
    expect(m(s).position[0]).toBe(3); // prochaine cible : 4
    s = play(s, "T4", "T7", "next", "T10", "T13", "T16", "T19");
    expect(m(s).position[0]).toBe(19); // le 20 reste à toucher
    expect(s.finished).toBe(false);
    s = play(s, "S20");
    expect(s.finished).toBe(true);
  });

  it("variante doubles uniquement", () => {
    let s = newGame("around_the_clock", { ring: "double" }, [ALICE]);
    s = play(s, "S1", "T1", "D1");
    expect(m(s).position[0]).toBe(1);
  });
});

describe("Around the World", () => {
  it("compte le multiplicateur des touches sur le numéro de la manche", () => {
    let s = newGame("around_the_world", { includeBull: false }, [ALICE]);
    s = play(s, "S1", "T1", "S20");
    expect(m(s).points[0]).toBe(4);
    for (let r = 2; r <= 20; r++) s = play(s, `D${r}`, "MISS", "MISS");
    expect(s.finished).toBe(true);
    expect(m(s).points[0]).toBe(4 + 19 * 2);
    expect(s.winners).toEqual([]);
  });
});

describe("Bob's 27", () => {
  it("ajoute les doubles touchés et retire la valeur sans touche", () => {
    let s = newGame("bobs_27", {}, [ALICE]);
    s = play(s, "D1", "D1", "S1"); // 27 + 4
    expect(m(s).scores[0]).toBe(31);
    s = play(s, "MISS", "MISS", "MISS"); // D2 manqué : -4
    expect(m(s).scores[0]).toBe(27);
    expect(s.visits[1]?.points).toBe(-4);
  });

  it("élimine le joueur dont le score devient négatif", () => {
    let s = newGame("bobs_27", {}, [ALICE, BOB]);
    // Manches 1 à 4 ratées par Alice : 27 - 2 - 4 - 6 - 8 = 7, puis D5 raté : -3 → éliminée.
    for (let r = 1; r <= 5; r++) s = play(s, "MISS", "MISS", "MISS", `D${r}`, "MISS", "MISS");
    expect(m(s).eliminated).toEqual([true, false]);
    // Bob continue seul.
    expect(s.turn.complete).toBe(true);
    s = play(s, "D6");
    expect(s.turn.playerIndex).toBe(1);
  });
});

describe("Killer", () => {
  it("devenir Killer puis éliminer les adversaires", () => {
    let s = newGame("killer", { lives: 1, numbers: [5, 10, 15] }, [ALICE, BOB, CAROL]);
    s = play(s, "S10", "D5", "D10"); // Alice devient Killer puis retire la vie de Bob
    expect(m(s).killer).toEqual([true, false, false]);
    expect(m(s).lives).toEqual([1, 0, 1]);
    // Bob est éliminé : Carol joue.
    s = play(s, "MISS");
    expect(s.turn.playerIndex).toBe(2);
    s = play(s, "MISS", "D15");
    expect(m(s).killer[2]).toBe(true);
    s = play(s, "D15"); // Alice touche le numéro de Carol
    expect(s.finished).toBe(true);
    expect(s.winners).toEqual(["alice"]);
  });

  it("pénalité sur son propre numéro", () => {
    let s = newGame("killer", { lives: 2, numbers: [5, 10] }, [ALICE, BOB]);
    s = play(s, "D5", "D5");
    expect(m(s).lives[0]).toBe(1);
  });

  it("tire des numéros distincts au hasard", () => {
    const config = prepareConfig("killer", {}, [ALICE, BOB, CAROL], 7) as { numbers: number[] };
    expect(new Set(config.numbers).size).toBe(3);
    expect(() => prepareConfig("killer", { numbers: [3, 3] }, [ALICE, BOB], 1)).toThrow(/différent/);
    expect(() => prepareConfig("killer", {}, [ALICE], 1)).toThrow(/au moins 2/);
  });
});

describe("Shanghai", () => {
  it("compte numéro × multiplicateur et gagne sur un Shanghai", () => {
    let s = newGame("shanghai", {}, [ALICE, BOB]);
    s = play(s, "S1", "D1", "S7"); // 3 points
    expect(m(s).points[0]).toBe(3);
    s = play(s, "MISS", "MISS", "MISS", "S2", "MISS", "MISS", "S2", "T2", "D2");
    expect(s.finished).toBe(true);
    expect(s.winners).toEqual(["bob"]);
  });

  it("sans Shanghai, le meilleur total gagne après la dernière manche", () => {
    let s = newGame("shanghai", { rounds: 1 }, [ALICE, BOB]);
    s = play(s, "T1", "MISS", "MISS", "S1", "MISS", "MISS");
    expect(s.finished).toBe(true);
    expect(s.winners).toEqual(["alice"]);
  });
});

describe("Entraînements à cible", () => {
  it("doubles, progression fixe : N fléchettes par cible", () => {
    let s = newGame("doubles_training", { segments: [20, 16], dartsPerTarget: 3 }, [ALICE]);
    s = play(s, "D20", "S20", "D20", "D16", "MISS", "MISS");
    expect(s.finished).toBe(true);
    expect(m(s).hits[0]).toBe(3);
    expect(m(s).darts[0]).toBe(6);
    expect(describeGame(s).players[0]?.main).toBe("50 %");
  });

  it("doubles, jusqu'à la touche avec plafond", () => {
    let s = newGame("doubles_training", { segments: [1, 2], progression: "until_hit", maxDartsPerTarget: 4 }, [ALICE]);
    s = play(s, "MISS", "D1", "MISS", "MISS", "MISS", "MISS");
    expect(s.finished).toBe(true);
    expect(m(s).perTarget[0]).toEqual([
      { hits: 1, darts: 2 },
      { hits: 0, darts: 4 },
    ]);
  });

  it("triples : seul le triple compte", () => {
    let s = newGame("triples_training", { segments: [20], dartsPerTarget: 3 }, [ALICE]);
    s = play(s, "T20", "D20", "S20");
    expect(m(s).hits[0]).toBe(1);
    expect(s.finished).toBe(true);
  });

  it("bull : points 25 / 50 et taux de réussite", () => {
    let s = newGame("bull_training", { rounds: 1 }, [ALICE]);
    s = play(s, "25", "BULL", "S20");
    expect(m(s).points[0]).toBe(75);
    expect(m(s).hits[0]).toBe(2);
    expect(s.finished).toBe(true);
  });

  it("exercice personnalisé répété", () => {
    let s = newGame(
      "custom_training",
      { name: "Haut de cible", targets: [{ segment: 20, ring: "triple" }, { segment: 25, ring: "inner_bull" }], dartsPerTarget: 1, rounds: 2 },
      [ALICE],
    );
    expect(s.config.targets).toHaveLength(4);
    s = play(s, "T20", "25", "T20", "BULL");
    expect(m(s).hits[0]).toBe(3);
    expect(s.finished).toBe(true);
  });

  it("ordre aléatoire reproductible", () => {
    const a = prepareConfig("doubles_training", { order: "random" }, [ALICE], 99) as { targets: unknown[] };
    const b = prepareConfig("doubles_training", { order: "random" }, [ALICE], 99) as { targets: unknown[] };
    expect(a.targets).toEqual(b.targets);
    expect(a.targets).toHaveLength(20);
  });
});

describe("Entraînement checkout", () => {
  it("réussite, échec et bust", () => {
    let s = newGame("checkout_training", { selection: "list", values: [40, 81, 50], visitsPerTarget: 1 }, [ALICE]);
    s = play(s, "S20", "D10"); // 40 réussi en 2 fléchettes
    expect(m(s).successes[0]).toBe(1);
    expect(m(s).remaining[0]).toBe(81);
    s = play(s, "T20", "S20"); // 81 → reste 1 en double sortie : bust → échec
    expect(s.visits[1]?.bust).toBe(true);
    expect(m(s).attempts[0]).toBe(2);
    s = play(s, "BULL");
    expect(s.finished).toBe(true);
    expect(m(s).successes[0]).toBe(2);
    expect(m(s).results[0].map((r: { success: boolean }) => r.success)).toEqual([true, false, true]);
  });

  it("refuse les scores impossibles et tire des scores terminables", () => {
    expect(() => prepareConfig("checkout_training", { selection: "list", values: [169] }, [ALICE], 1)).toThrow(/impossible/);
    const config = prepareConfig("checkout_training", { count: 20, min: 150, max: 170 }, [ALICE], 3) as { targets: number[] };
    expect(config.targets).toHaveLength(20);
    for (const t of config.targets) expect([159, 162, 163, 165, 166, 168, 169]).not.toContain(t);
  });
});

describe("Validation des options", () => {
  it("rejette les options invalides avec un message en français", () => {
    expect(() => prepareConfig("x01", { startScore: 999 }, [ALICE], 1)).toThrow(/Score de départ/);
    expect(() => prepareConfig("x01", { legs: 0 }, [ALICE], 1)).toThrow(/Option invalide/);
    expect(prepareConfig("x01", {}, [ALICE], 1)).toMatchObject({ startScore: 501, inRule: "single", outRule: "double", legs: 1, sets: 1 });
  });
});

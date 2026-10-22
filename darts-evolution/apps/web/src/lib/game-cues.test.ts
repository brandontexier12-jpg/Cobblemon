import { applyEvent, createGame, describeGame, prepareConfig, type GameEvent, type GameState } from "@darts-evolution/game-engine";
import { parseDart } from "@darts-evolution/shared";
import { describe, expect, it } from "vitest";
import { dartSpeech, gameCues } from "./game-cues";
import type { MatchSnapshot } from "./types";

const PLAYERS = [
  { id: "a", name: "Alice" },
  { id: "b", name: "Bob" },
];

let counter = 0;
function event(label: string): GameEvent {
  if (label === "next") return { type: "next", id: `e${++counter}` };
  return { type: "dart", dart: parseDart(label)!, id: `e${++counter}` };
}

function snap(state: GameState): MatchSnapshot {
  return {
    match: {
      id: "m1",
      version: state.version,
      players: PLAYERS.map((p, i) => ({ ...p, avatar: "🎯", color: "#ff6a00", position: i, isGuest: false })),
    },
    view: describeGame(state),
  } as unknown as MatchSnapshot;
}

/** Joue une suite d'actions et renvoie les sons déclenchés par chacune. */
function run(start: number, ...labels: string[]) {
  const players = PLAYERS;
  let state = createGame("x01", prepareConfig("x01", { startScore: start }, players, 1), players);
  const cues = [];
  for (const label of labels) {
    const next = applyEvent(state, event(label));
    cues.push(gameCues(snap(state), snap(next)));
    state = next;
  }
  return { cues, state };
}

describe("sons de partie", () => {
  it("un son par fléchette, puis le score de la visite, puis le joueur suivant", () => {
    const { cues } = run(501, "T20", "S5", "D1", "next");
    expect(cues[0]).toEqual([{ kind: "hit", segment: 20, multiplier: 3 }]);
    expect(cues[1]).toEqual([{ kind: "hit", segment: 5, multiplier: 1 }]);
    expect(cues[2]).toEqual([
      { kind: "hit", segment: 1, multiplier: 2 },
      { kind: "visit", points: 67, bust: false, playerName: "Alice", announce: true },
    ]);
    expect(cues[3]).toEqual([{ kind: "turn", newLeg: false }]);
  });

  it("au changement de joueur, seulement le carillon (le reste n'est jamais annoncé)", () => {
    // Alice revient sur 40, score terminable : aucune annonce du reste.
    const { cues } = run(101, "T20", "S1", "M", "next", "S1", "S1", "S1", "next");
    expect(cues[7]).toEqual([{ kind: "turn", newLeg: false }]);
  });

  it("bust, sortie et victoire", () => {
    const bust = run(101, "T20", "T20").cues;
    expect(bust[1]).toContainEqual({ kind: "visit", points: 0, bust: true, playerName: "Alice", announce: true });
    const win = run(101, "T20", "S1", "D20").cues;
    expect(win[2]).toEqual([
      { kind: "hit", segment: 20, multiplier: 2 },
      { kind: "win", points: 101, winnerNames: ["Alice"] },
    ]);
  });

  it("leg gagné puis nouveau leg (pour le « Game on » du pack de voix)", () => {
    const players = PLAYERS;
    let state = createGame("x01", prepareConfig("x01", { startScore: 101, legs: 2 }, players, 1), players);
    const cues = [];
    for (const label of ["T20", "S1", "D20", "next"]) {
      const next = applyEvent(state, event(label));
      cues.push(gameCues(snap(state), snap(next)));
      state = next;
    }
    expect(cues[2]).toContainEqual({ kind: "leg", points: 101, playerName: "Alice" });
    expect(cues[3]).toEqual([expect.objectContaining({ kind: "turn", newLeg: true })]);
  });

  it("Killer : statut gagné et élimination", () => {
    const players = [...PLAYERS, { id: "c", name: "Carol" }];
    let state = createGame("killer", prepareConfig("killer", { numbers: [5, 10, 15] }, players, 1), players);
    const all = (s: GameState) => ({ ...snap(s), match: { ...snap(s).match, players: players.map((p, i) => ({ ...p, avatar: "🎯", color: "#fff", position: i, isGuest: false })) } }) as MatchSnapshot;
    const cues = [];
    for (const label of ["T5", "S10", "S15", "next", "MISS", "MISS", "MISS", "next", "S15", "MISS", "MISS", "next", "S10"]) {
      const next = applyEvent(state, event(label));
      cues.push(gameCues(all(state), all(next)));
      state = next;
    }
    expect(cues[0]).toContainEqual({ kind: "killer", playerName: "Alice" });
    expect(cues[12]).toContainEqual({ kind: "eliminated", playerName: "Bob" });
  });

  it("« Joueur suivant » en cours de visite : pas de son de raté pour les fléchettes ajoutées", () => {
    const { cues } = run(501, "T20", "next");
    expect(cues[1]).toEqual([
      { kind: "visit", points: 60, bust: false, playerName: "Alice", announce: true },
      { kind: "turn", newLeg: false },
    ]);
  });

  it("aucun son pour une annulation, une correction ou un état déjà affiché", () => {
    const players = PLAYERS;
    const s0 = createGame("x01", prepareConfig("x01", { startScore: 501 }, players, 1), players);
    const s1 = applyEvent(s0, event("T20"));
    const s2 = applyEvent(s1, event("T20"));
    // Annulation : retour à s1 avec une version plus récente.
    const undone = { ...s1, version: s2.version + 1 };
    expect(gameCues(snap(s2), snap(undone))).toEqual([]);
    // Même version reçue deux fois (réponse HTTP + diffusion temps réel).
    expect(gameCues(snap(s2), snap(s2))).toEqual([]);
    // Correction : même nombre de fléchettes, fléchette remplacée.
    const corrected = applyEvent(s1, event("S5"));
    expect(gameCues(snap(s2), snap({ ...corrected, version: s2.version + 1 }))).toEqual([]);
    // Premier affichage : rien.
    expect(gameCues(null, snap(s2))).toEqual([]);
  });

  it("textes de l'annonceur", () => {
    expect(dartSpeech({ segment: 20, multiplier: 3 })).toBe("Triple 20");
    expect(dartSpeech({ segment: 25, multiplier: 2 })).toBe("Bull");
    expect(dartSpeech({ segment: 0, multiplier: 0 })).toBe("Raté");
  });
});

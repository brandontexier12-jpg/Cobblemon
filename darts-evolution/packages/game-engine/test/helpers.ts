import { parseDart } from "@darts-evolution/shared";
import { applyEvent, createGame } from "../src/core.js";
import { prepareConfig } from "../src/registry.js";
import type { GameEvent, GameModeId, GameState, PlayerRef } from "../src/types.js";

export const ALICE: PlayerRef = { id: "alice", name: "Alice" };
export const BOB: PlayerRef = { id: "bob", name: "Bob" };
export const CAROL: PlayerRef = { id: "carol", name: "Carol" };

export function dart(label: string): GameEvent {
  const d = parseDart(label);
  if (!d) throw new Error(`Libellé invalide dans le test : ${label}`);
  return { type: "dart", dart: d };
}

export const NEXT: GameEvent = { type: "next" };

/** Lance une suite de fléchettes (« T20 », « D16 »…) ou « next ». */
export function play<C>(state: GameState<C>, ...labels: string[]): GameState<C> {
  let s = state;
  for (const label of labels) s = applyEvent(s, label === "next" ? NEXT : dart(label));
  return s;
}

export function newGame(mode: GameModeId, options: unknown, players: PlayerRef[], seed = 42): GameState<any> {
  return createGame(mode, prepareConfig(mode, options, players, seed), players);
}

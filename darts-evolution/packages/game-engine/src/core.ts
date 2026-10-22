import { dartLabel, dartScore, isValidDart, MISS, type Dart } from "@darts-evolution/shared";
import { getRules } from "./rules.js";
import {
  GameRuleError,
  type GameEvent,
  type GameModeId,
  type GameState,
  type ModeRules,
  type PlayerRef,
  type ThrownDart,
  type VisitEndReason,
  type VisitRecord,
} from "./types.js";

export const DARTS_PER_VISIT = 3;

// L'état est immuable vu de l'extérieur : chaque événement produit un nouvel état.
function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createGame<C>(mode: GameModeId, config: C, players: PlayerRef[]): GameState<C> {
  if (players.length === 0) throw new GameRuleError("invalid_config", "Au moins un joueur est requis.");
  const ids = new Set(players.map((p) => p.id));
  if (ids.size !== players.length) throw new GameRuleError("invalid_config", "Un joueur ne peut pas figurer deux fois.");
  const rules = getRules(mode) as ModeRules<C, unknown>;
  const { m, playerIndex } = rules.init(config, players);
  return {
    mode,
    config,
    players: players.map((p) => ({ id: p.id, name: p.name })),
    turn: { playerIndex, round: 1, darts: [], complete: false },
    visits: [],
    finished: false,
    winners: [],
    m,
    version: 0,
  };
}

function rulesOf<C>(state: GameState<C>): ModeRules<C, unknown> {
  return getRules(state.mode) as ModeRules<C, unknown>;
}

function completeVisit<C>(state: GameState<C>, reason: VisitEndReason): void {
  const rules = rulesOf(state);
  const { turn } = state;
  const endReason: VisitEndReason =
    reason === "three_darts" && turn.darts.some((d) => d.padded) ? "early" : reason;
  const outcome = rules.onVisitComplete({
    config: state.config,
    players: state.players,
    m: state.m,
    playerIndex: turn.playerIndex,
    round: turn.round,
    visitDarts: turn.darts,
    endReason,
  });
  state.m = outcome.m;
  const legInfo = rules.legInfo?.(state.m) ?? { leg: 1, set: 1 };
  const player = state.players[turn.playerIndex] as PlayerRef;
  const record: VisitRecord = {
    index: state.visits.length,
    playerId: player.id,
    playerIndex: turn.playerIndex,
    round: turn.round,
    leg: legInfo.leg,
    set: legInfo.set,
    darts: turn.darts.map((d) => ({ ...d })),
    points: turn.darts.reduce((sum, d) => sum + d.points, 0),
    rawPoints: turn.darts.reduce((sum, d) => sum + d.score, 0),
    endReason,
    bust: false,
    checkout: false,
    ...outcome.record,
  };
  state.visits.push(record);
  turn.complete = true;
  turn.endReason = endReason;
  if (outcome.finished && !state.finished) {
    state.finished = true;
    state.winners = outcome.finished.winners;
  }
}

function throwDart<C>(state: GameState<C>, dart: Dart, meta: { id?: string; source?: string; padded?: boolean }): void {
  const rules = rulesOf(state);
  const { turn } = state;
  const outcome = rules.onDart(
    {
      config: state.config,
      players: state.players,
      m: state.m,
      playerIndex: turn.playerIndex,
      round: turn.round,
      visitDarts: turn.darts,
    },
    dart,
  );
  state.m = outcome.m;
  const thrown: ThrownDart = {
    segment: dart.segment,
    multiplier: dart.multiplier,
    label: dartLabel(dart),
    score: dartScore(dart),
    points: outcome.points,
  };
  if (outcome.hit !== undefined) thrown.hit = outcome.hit;
  if (outcome.target !== undefined) thrown.target = outcome.target;
  if (outcome.checkoutAttempt) thrown.checkoutAttempt = true;
  if (outcome.marks !== undefined) thrown.marks = outcome.marks;
  if (meta.padded) thrown.padded = true;
  if (meta.id) thrown.eventId = meta.id;
  if (meta.source) thrown.source = meta.source;
  turn.darts.push(thrown);

  if (outcome.finished) {
    // Le mode signale la fin de partie pendant la visite (sortie gagnante, Shanghai…).
    completeVisit(state, outcome.endVisit ?? "win");
    if (!state.finished) {
      state.finished = true;
      state.winners = outcome.finished.winners;
    }
    return;
  }
  if (outcome.endVisit) {
    completeVisit(state, outcome.endVisit);
  } else if (turn.darts.length >= DARTS_PER_VISIT) {
    completeVisit(state, "three_darts");
  }
}

function advance<C>(state: GameState<C>): void {
  const rules = rulesOf(state);
  const out = rules.advance({
    config: state.config,
    players: state.players,
    m: state.m,
    playerIndex: state.turn.playerIndex,
    round: state.turn.round,
  });
  state.m = out.m;
  state.turn = { playerIndex: out.playerIndex, round: out.round, darts: [], complete: false };
}

/**
 * Applique un événement et retourne le nouvel état (l'état d'origine n'est pas modifié).
 *
 * - `dart` : si la visite précédente est terminée, on passe d'abord au joueur suivant.
 * - `next` : termine la visite en cours (les fléchettes manquantes sont comptées comme ratées)
 *   puis passe au joueur suivant.
 */
export function applyEvent<C>(current: GameState<C>, event: GameEvent): GameState<C> {
  if (current.finished) throw new GameRuleError("game_finished", "La partie est terminée.");
  const state = clone(current);
  if (event.type === "dart") {
    if (!isValidDart(event.dart)) throw new GameRuleError("invalid_dart", "Fléchette invalide.");
    if (state.turn.complete) advance(state);
    throwDart(state, event.dart, { id: event.id, source: event.source });
  } else if (event.type === "next") {
    if (!state.turn.complete) {
      while (!state.turn.complete) throwDart(state, MISS, { padded: true, source: event.source });
    }
    if (!state.finished) advance(state);
  } else {
    throw new GameRuleError("invalid_event", "Événement inconnu.");
  }
  state.version = current.version + 1;
  return state;
}

/** Reconstruit une partie à partir de sa configuration et de son journal d'événements. */
export function replay<C>(mode: GameModeId, config: C, players: PlayerRef[], events: GameEvent[]): GameState<C> {
  let state = createGame(mode, config, players);
  for (const event of events) state = applyEvent(state, event);
  return state;
}

/** Joueur qui jouera après la visite terminée (sans modifier l'état). */
export function peekNextPlayerIndex<C>(state: GameState<C>): number | null {
  if (state.finished || !state.turn.complete) return null;
  const copy = clone(state);
  advance(copy);
  return copy.turn.playerIndex;
}

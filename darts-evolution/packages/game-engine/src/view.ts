import { peekNextPlayerIndex } from "./core.js";
import { getModeDefinition } from "./registry.js";
import { getRules } from "./rules.js";
import type { GameCategory, GameModeId, GameState, ModeView, PlayerView, ThrownDart, VisitEndReason, VisitRecord } from "./types.js";

export interface GameView {
  mode: GameModeId;
  modeName: string;
  category: GameCategory;
  finished: boolean;
  winners: string[];
  version: number;
  headline?: string;
  players: PlayerView[];
  current: {
    playerId: string;
    playerIndex: number;
    round: number;
    darts: ThrownDart[];
    complete: boolean;
    endReason?: VisitEndReason;
    visitPoints: number;
    awaitingNext: boolean;
    nextPlayerId: string | null;
    target?: string;
    instruction?: string;
  };
  checkout: ModeView["checkout"] | null;
  board?: ModeView["board"];
  killer?: ModeView["killer"];
  recentVisits: VisitRecord[];
}

const END_LABEL: Record<VisitEndReason, string> = {
  three_darts: "Visite terminée",
  bust: "Bust !",
  checkout: "Checkout !",
  win: "Victoire !",
  early: "Visite terminée (fléchettes manquantes comptées ratées)",
  eliminated: "Éliminé",
  done: "Série terminée",
};

export function endReasonLabel(reason: VisitEndReason): string {
  return END_LABEL[reason];
}

/** Vue complète d'une partie pour l'interface (calculée par le serveur, autorité du score). */
export function describeGame(state: GameState): GameView {
  const rules = getRules(state.mode);
  const def = getModeDefinition(state.mode);
  const modeView = rules.view(state);
  const nextIndex = peekNextPlayerIndex(state);
  const current = state.players[state.turn.playerIndex];
  return {
    mode: state.mode,
    modeName: def.name,
    category: def.category,
    finished: state.finished,
    winners: state.winners,
    version: state.version,
    headline: modeView.headline,
    players: modeView.players.map((p, i) => ({
      ...p,
      active: !state.finished && i === state.turn.playerIndex,
    })),
    current: {
      playerId: current?.id ?? "",
      playerIndex: state.turn.playerIndex,
      round: state.turn.round,
      darts: state.turn.darts,
      complete: state.turn.complete,
      endReason: state.turn.endReason,
      visitPoints: state.turn.complete
        ? (state.visits[state.visits.length - 1]?.points ?? 0)
        : state.turn.darts.reduce((s, d) => s + d.points, 0),
      awaitingNext: state.turn.complete && !state.finished,
      nextPlayerId: nextIndex === null ? null : (state.players[nextIndex]?.id ?? null),
      target: modeView.target,
      instruction: modeView.instruction,
    },
    checkout: modeView.checkout ?? null,
    board: modeView.board,
    killer: modeView.killer,
    recentVisits: state.visits.slice(-12),
  };
}

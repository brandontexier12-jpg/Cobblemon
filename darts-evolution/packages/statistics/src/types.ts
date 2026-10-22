import type { GameCategory, GameModeId, InOutRule } from "@darts-evolution/game-engine";

/** Fléchette telle qu'enregistrée dans une visite. */
export interface StatDart {
  segment: number;
  multiplier: number;
  points: number;
  hit?: boolean;
  checkoutAttempt?: boolean;
  padded?: boolean;
}

/** Visite enregistrée (données réelles uniquement : les simulations sont exclues en amont). */
export interface StatVisit {
  matchId: string;
  mode: GameModeId;
  category: GameCategory;
  /** Date de la visite (ISO 8601). */
  playedAt: string;
  playerId: string;
  leg: number;
  set: number;
  round: number;
  points: number;
  bust: boolean;
  checkout: boolean;
  checkoutChance: boolean;
  firstOfLeg: boolean;
  remainingBefore: number | null;
  darts: StatDart[];
  hits?: number | null;
  attempts?: number | null;
  marks?: number | null;
  /** Règle de sortie de la partie (X01 et entraînement checkout). */
  outRule?: InOutRule | null;
}

/** Résultat d'un joueur dans une partie. */
export interface StatMatch {
  matchId: string;
  mode: GameModeId;
  category: GameCategory;
  status: "active" | "finished" | "abandoned";
  playedAt: string;
  finishedAt: string | null;
  playerId: string;
  playerIds: string[];
  winnerIds: string[];
  /** Score final propre au mode (Bob's 27, High Score…), si pertinent. */
  finalScore?: number | null;
}

export interface Period {
  from?: string;
  to?: string;
}

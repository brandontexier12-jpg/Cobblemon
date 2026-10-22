import type { Dart } from "@darts-evolution/shared";

export type GameModeId =
  | "x01"
  | "cricket"
  | "count_up"
  | "high_score"
  | "around_the_clock"
  | "around_the_world"
  | "bobs_27"
  | "killer"
  | "shanghai"
  | "doubles_training"
  | "triples_training"
  | "bull_training"
  | "checkout_training"
  | "custom_training";

export type GameCategory = "game" | "training";

export interface PlayerRef {
  id: string;
  name: string;
}

export interface ThrownDart extends Dart {
  label: string;
  /** Points bruts de la fléchette (secteur × multiplicateur). */
  score: number;
  /** Points retenus par les règles du mode (ex. 0 avant l'ouverture en double départ). */
  points: number;
  /** Mode à cible : la fléchette a touché la cible demandée. */
  hit?: boolean;
  /** Cible visée au moment du lancer (libellé), pour les modes à cible. */
  target?: string;
  /** X01 : une sortie en une fléchette était possible avant ce lancer (fléchette « à la sortie »). */
  checkoutAttempt?: boolean;
  /** Cricket : marques réellement comptées. */
  marks?: number;
  /** Fléchette ajoutée automatiquement (raté) quand une visite est terminée avant 3 fléchettes. */
  padded?: boolean;
  eventId?: string;
  source?: string;
  /** Position réelle de l'impact (Autodarts), repère normalisé : centre (0,0), anneau double ≈ rayon 1, y vers le 20. */
  coords?: DartCoords;
}

export interface DartCoords {
  x: number;
  y: number;
}

export type VisitEndReason =
  | "three_darts"
  | "bust"
  | "checkout"
  | "win"
  | "early"
  | "eliminated"
  | "done";

export interface VisitRecord {
  index: number;
  playerId: string;
  playerIndex: number;
  round: number;
  leg: number;
  set: number;
  darts: ThrownDart[];
  /** Points retenus pour la visite (0 en cas de bust). */
  points: number;
  /** Somme brute des fléchettes. */
  rawPoints: number;
  endReason: VisitEndReason;
  bust: boolean;
  checkout: boolean;
  remainingBefore?: number;
  remainingAfter?: number;
  /** X01 : la visite commençait sur un score terminable en 3 fléchettes. */
  checkoutChance?: boolean;
  /** X01 : première visite du joueur dans le leg. */
  firstOfLeg?: boolean;
  /** Modes à cible : touches et tentatives de la visite. */
  hits?: number;
  attempts?: number;
  marks?: number;
}

export interface TurnState {
  playerIndex: number;
  round: number;
  darts: ThrownDart[];
  complete: boolean;
  endReason?: VisitEndReason;
}

export interface GameState<C = unknown, M = unknown> {
  mode: GameModeId;
  config: C;
  players: PlayerRef[];
  turn: TurnState;
  visits: VisitRecord[];
  finished: boolean;
  winners: string[];
  m: M;
  /** Nombre d'événements appliqués. */
  version: number;
}

export type GameEvent =
  | { type: "dart"; dart: Dart; id?: string; source?: string; coords?: DartCoords }
  | { type: "next"; id?: string; source?: string };

export interface Finish {
  winners: string[];
}

export interface DartContext<C, M> {
  config: C;
  players: PlayerRef[];
  m: M;
  playerIndex: number;
  round: number;
  /** Fléchettes déjà lancées dans la visite (avant celle-ci). */
  visitDarts: ThrownDart[];
}

export interface DartOutcome<M> {
  m: M;
  points: number;
  hit?: boolean;
  target?: string;
  checkoutAttempt?: boolean;
  marks?: number;
  /** Termine la visite immédiatement. */
  endVisit?: VisitEndReason;
  finished?: Finish;
}

export interface VisitContext<C, M> extends DartContext<C, M> {
  endReason: VisitEndReason;
}

export interface VisitOutcome<M> {
  m: M;
  record: Partial<Omit<VisitRecord, "index" | "playerId" | "playerIndex" | "round" | "darts" | "rawPoints" | "endReason">>;
  finished?: Finish;
}

export interface AdvanceContext<C, M> {
  config: C;
  players: PlayerRef[];
  m: M;
  playerIndex: number;
  round: number;
}

export interface AdvanceOutcome<M> {
  m: M;
  playerIndex: number;
  round: number;
}

export interface PlayerView {
  id: string;
  name: string;
  /** Valeur principale affichée en grand (score restant, total, cible…). */
  main: string;
  mainLabel: string;
  details: { label: string; value: string }[];
  active: boolean;
  eliminated?: boolean;
  winner?: boolean;
  /** Statut affiché en grand (ex. « KILLER »). */
  flag?: string;
}

export interface BoardTable {
  columns: string[];
  rows: { key: string; label: string; cells: string[]; closedByAll?: boolean }[];
}

export interface ModeView {
  headline?: string;
  players: Omit<PlayerView, "active">[];
  target?: string;
  instruction?: string;
  checkout?: { remaining: number; dartsLeft: number; routes: string[][] } | null;
  board?: BoardTable;
  /** Killer : numéros, vies et statuts (cible colorée, roue du tirage). */
  killer?: import("./modes/target-games.js").KillerView;
}

export interface ModeRules<C, M> {
  id: GameModeId;
  init(config: C, players: PlayerRef[]): { m: M; playerIndex: number };
  onDart(ctx: DartContext<C, M>, dart: Dart): DartOutcome<M>;
  onVisitComplete(ctx: VisitContext<C, M>): VisitOutcome<M>;
  advance(ctx: AdvanceContext<C, M>): AdvanceOutcome<M>;
  view(state: GameState<C, M>): ModeView;
  /** Leg et set courants (X01) ; 1/1 pour les autres modes. */
  legInfo?(m: M): { leg: number; set: number };
}

export class GameRuleError extends Error {
  constructor(
    public readonly code: "game_finished" | "invalid_dart" | "invalid_event" | "invalid_config",
    message: string,
  ) {
    super(message);
    this.name = "GameRuleError";
  }
}

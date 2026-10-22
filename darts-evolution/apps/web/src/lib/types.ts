import type { GameModeId, GameView, ThrownDart, VisitRecord } from "@darts-evolution/game-engine";
import type { ConnectionStatus } from "@darts-evolution/shared";

export type { GameModeId, GameView, ThrownDart, VisitRecord, ConnectionStatus };

export interface Player {
  id: string;
  name: string;
  avatar: string;
  color: string;
  level: "debutant" | "intermediaire" | "confirme" | "expert";
  isGuest: boolean;
  favoriteDouble: number | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface MatchPlayer {
  id: string;
  name: string;
  avatar: string;
  color: string;
  position: number;
  isGuest: boolean;
}

export interface MatchMeta {
  id: string;
  mode: GameModeId;
  modeName: string;
  category: "game" | "training";
  status: "active" | "finished" | "abandoned";
  inputMode: "manual" | "autodarts";
  isSimulation: boolean;
  roomCode: string;
  fixtureId: string | null;
  winnerIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  options: Record<string, unknown>;
  config: Record<string, unknown>;
  players: MatchPlayer[];
}

export interface MatchSnapshot {
  match: MatchMeta;
  view: GameView;
}

export interface CommandResult {
  snapshot: MatchSnapshot;
  applied: boolean;
  duplicate: boolean;
  notice?: string;
}

export interface MatchListItem {
  id: string;
  mode: GameModeId;
  modeName: string;
  category: "game" | "training";
  status: MatchMeta["status"];
  isSimulation: boolean;
  inputMode: MatchMeta["inputMode"];
  roomCode: string;
  createdAt: string;
  finishedAt: string | null;
  winnerIds: string[];
  options: Record<string, unknown>;
  players: {
    id: string;
    name: string;
    avatar: string;
    color: string;
    won: boolean;
    finalScore: number | null;
    darts: number;
    points: number;
    average3: number | null;
    legsWon: number | null;
  }[];
}

export interface ModeInfo {
  id: GameModeId;
  name: string;
  category: "game" | "training";
  summary: string;
  rules: string[];
  minPlayers: number;
  maxPlayers: number;
  defaults: Record<string, unknown> | null;
}

export interface AutodartsOverview {
  status: ConnectionStatus;
  enabled: boolean;
  config: { host: string; port: number; protocol: "http" | "https" };
  boundMatchId: string | null;
  simulation: boolean;
  compatibility: string;
}

export interface X01Summary {
  visits: number;
  darts: number;
  points: number;
  pointsPerDart: number | null;
  average3: number | null;
  visitAverage: number | null;
  firstVisitAverage: number | null;
  first9Average: number | null;
  bestVisit: number | null;
  count180: number;
  count140: number;
  count100: number;
  busts: number;
  doubleAttempts: number;
  doubleHits: number;
  doubleRate: number | null;
  checkoutChances: number;
  checkouts: number;
  checkoutRate: number | null;
  bestCheckout: number | null;
  legsWon: number;
  averageDartsPerLegWon: number | null;
  bestLegDarts: number | null;
}

export interface StatsSummary {
  summary: {
    x01: X01Summary;
    results: { matches: number; wins: number; losses: number; draws: number; winRate: number | null; currentStreak: number; bestStreak: number };
    training: {
      sessions: number;
      darts: number;
      doubles: { darts: number; hits: number; rate: number | null };
      triples: { darts: number; hits: number; rate: number | null };
      bull: { darts: number; hits: number; inner: number; rate: number | null; innerRate: number | null };
      checkout: { attempts: number; successes: number; rate: number | null };
      cricket: { visits: number; marks: number; marksPerRound: number | null };
      byMode: Record<string, { sessions: number; darts: number; hits: number; rate: number | null }>;
    };
    totalDarts: number;
    totalMatches: number;
    lastPlayedAt: string | null;
  };
  records: { id: string; label: string; value: number; display: string; matchId: string | null; at: string | null }[];
  progress: {
    xp: number;
    level: number;
    levelName: string;
    xpForNext: number;
    xpIntoLevel: number;
    badges: { id: string; name: string; description: string; earnedAt: string; matchId: string | null }[];
  };
}

export interface SeriesPoint {
  key: string;
  darts: number;
  visits: number;
  average3: number | null;
  doubleRate: number | null;
  accuracy: number | null;
  checkoutRate: number | null;
  sessions: number;
}

export interface Competition {
  id: string;
  name: string;
  format: "knockout" | "round_robin";
  status: "active" | "finished";
  winnerId: string | null;
  matchOptions: Record<string, unknown>;
  pointsWin: number;
  pointsDraw: number;
  doubleRound: boolean;
  createdAt: string;
  finishedAt: string | null;
  players: { id: string; seed: number; name: string; avatar: string; color: string }[];
  fixtures: {
    id: string;
    round: number;
    slot: number;
    player1Id: string | null;
    player2Id: string | null;
    winnerId: string | null;
    score1: number | null;
    score2: number | null;
    matchId: string | null;
    status: "pending" | "playing" | "done" | "bye";
    scheduledAt: string | null;
  }[];
  standings:
    | { playerId: string; name: string; played: number; won: number; drawn: number; lost: number; legsFor: number; legsAgainst: number; legDiff: number; points: number }[]
    | null;
}

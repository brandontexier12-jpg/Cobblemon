import type { Dart } from "./darts.js";

/**
 * Contrat commun des fournisseurs de scoring (saisie manuelle, Autodarts, simulation).
 * Le moteur de jeu ne dépend jamais d'un fournisseur particulier.
 */
export type ThrowSource = "manual" | "autodarts" | "simulation";

export interface BoardCoords {
  x: number;
  y: number;
}

/** Impact normalisé, quel que soit le fournisseur. */
export interface DetectedThrow {
  /** Identifiant unique de l'impact (clé de déduplication). */
  eventId: string;
  /** Date de réception côté DARTS EVOLUTION (ISO 8601). */
  receivedAt: string;
  dart: Dart;
  score: number;
  /** Nom du segment tel que fourni par la source (ex. « T20 », « M17 », « Miss »). */
  segmentName: string;
  /** Zone fournie par la source (ex. « Triple », « SingleInner », « Outside »). */
  bed?: string;
  coords?: BoardCoords;
  /** Fléchette rebondie (non plantée), si la source le signale. */
  bouncer?: boolean;
  /** Position de la fléchette dans la visite en cours sur la cible (0, 1, 2…). */
  slot: number;
  /** Compteur de visites observées sur la cible depuis la connexion. */
  boardVisit: number;
  source: ThrowSource;
  /** Vrai pour tout impact synthétique : jamais compté dans les statistiques réelles. */
  simulated: boolean;
  /** Niveau de confiance, uniquement si la source le fournit (l'API locale Autodarts ne le fournit pas). */
  confidence?: number;
  /** Impact absent des messages en direct, récupéré en relisant l'état de la cible par HTTP. */
  recovered?: boolean;
}

export type ProviderKind = "manual" | "autodarts" | "simulation";

export type ConnectionState =
  | "disabled"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type DiagnosticCode =
  | "invalid_address"
  | "dns"
  | "refused"
  | "timeout"
  | "unreachable"
  | "not_board_manager"
  | "auth_required"
  | "incompatible"
  | "detection_stopped"
  | "no_throw_data"
  | "unknown";

export interface Diagnostic {
  code: DiagnosticCode;
  /** Message en français destiné à l'utilisateur. */
  message: string;
  /** Piste de résolution en français. */
  hint: string;
  at: string;
}

export interface ConnectionStatus {
  provider: ProviderKind;
  state: ConnectionState;
  /** Adresse ciblée (sans secret), ex. http://192.168.1.50:3180 */
  target?: string;
  /** Statut brut du Board Manager (« Throw », « Takeout », « Stopped »…). */
  boardStatus?: string | null;
  /** Dernier événement brut du Board Manager (« Throw detected », « Takeout finished »…). */
  boardEvent?: string | null;
  /** Détection démarrée sur le Board Manager. */
  running?: boolean | null;
  version?: string | null;
  /** Génération du Board Manager : 1 (classique) ou 2 (Board Manager 2 / headless). */
  generation?: 1 | 2 | null;
  connectedSince?: string | null;
  lastMessageAt?: string | null;
  lastThrowAt?: string | null;
  lastThrow?: string | null;
  reconnectAttempts: number;
  lastError?: Diagnostic | null;
  warnings: string[];
  simulated: boolean;
}

export type ScoringEvent =
  | { kind: "throw"; throw: DetectedThrow }
  /** La cible a corrigé elle-même une fléchette déjà signalée (même position). */
  | { kind: "throw-corrected"; throw: DetectedThrow; previous: Dart }
  | { kind: "takeout-started"; at: string; boardVisit: number }
  | {
      kind: "takeout-finished";
      at: string;
      boardVisit: number;
      dartsOnBoard: number;
      /** Plus grand nombre de fléchettes annoncé par la cible (numThrows) pendant la visite. */
      announced?: number;
    }
  /** Réinitialisation (« Manual reset ») ; `own` si demandée par DARTS EVOLUTION. */
  | { kind: "reset"; at: string; own: boolean; boardVisit: number }
  | { kind: "detection-started"; at: string }
  | { kind: "detection-stopped"; at: string }
  | { kind: "status"; status: ConnectionStatus }
  /** Après une reconnexion, des fléchettes ont pu être perdues : jamais inventées, seulement signalées. */
  | { kind: "gap"; at: string; message: string }
  | { kind: "invalid"; at: string; reason: string };

export interface ScoringProvider {
  readonly kind: ProviderKind;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): Promise<ConnectionStatus>;
  onThrow(callback: (event: DetectedThrow) => void): () => void;
  onEvent(callback: (event: ScoringEvent) => void): () => void;
}

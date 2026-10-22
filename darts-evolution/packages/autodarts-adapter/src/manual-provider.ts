import { randomUUID } from "node:crypto";
import {
  dartLabel,
  dartScore,
  isValidDart,
  type ConnectionStatus,
  type Dart,
  type DetectedThrow,
  type ScoringEvent,
  type ScoringProvider,
} from "@darts-evolution/shared";

/**
 * Saisie manuelle : toujours disponible, indépendante d'Autodarts.
 * Chaque saisie produit un impact normalisé identique à ceux des autres fournisseurs.
 */
export class ManualScoringProvider implements ScoringProvider {
  readonly kind = "manual" as const;
  private readonly throwListeners = new Set<(t: DetectedThrow) => void>();
  private readonly eventListeners = new Set<(e: ScoringEvent) => void>();
  private slot = 0;
  private visit = 0;
  private lastThrow: DetectedThrow | null = null;
  private readonly since = new Date().toISOString();

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async getStatus(): Promise<ConnectionStatus> {
    return {
      provider: "manual",
      state: "connected",
      connectedSince: this.since,
      lastThrowAt: this.lastThrow?.receivedAt ?? null,
      lastThrow: this.lastThrow?.segmentName ?? null,
      reconnectAttempts: 0,
      warnings: [],
      simulated: false,
    };
  }

  onThrow(callback: (event: DetectedThrow) => void): () => void {
    this.throwListeners.add(callback);
    return () => this.throwListeners.delete(callback);
  }

  onEvent(callback: (event: ScoringEvent) => void): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  /** Enregistre une fléchette saisie à la main. */
  submit(dart: Dart, eventId: string = randomUUID()): DetectedThrow {
    if (!isValidDart(dart)) throw new Error("Fléchette invalide");
    const t: DetectedThrow = {
      eventId,
      receivedAt: new Date().toISOString(),
      dart,
      score: dartScore(dart),
      segmentName: dartLabel(dart),
      slot: this.slot++,
      boardVisit: this.visit,
      source: "manual",
      simulated: false,
    };
    this.lastThrow = t;
    for (const cb of this.throwListeners) cb(t);
    for (const cb of this.eventListeners) cb({ kind: "throw", throw: t });
    return t;
  }

  /** Fin de visite saisie à la main (équivalent du retrait des fléchettes). */
  endVisit(): void {
    const at = new Date().toISOString();
    const dartsOnBoard = this.slot;
    this.slot = 0;
    for (const cb of this.eventListeners) cb({ kind: "takeout-finished", at, boardVisit: this.visit, dartsOnBoard });
    this.visit++;
  }
}

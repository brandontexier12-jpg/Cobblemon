import { dartLabel, dartScore, sameDart, type DetectedThrow, type ScoringEvent, type ThrowSource } from "@darts-evolution/shared";
import { throwToDart, type BoardSnapshot, type BoardThrow } from "./protocol.js";

/**
 * Transforme la suite d'instantanés du Board Manager en événements de jeu.
 *
 * Principes :
 * - un instantané identique au précédent (message répété) ne produit aucun événement ;
 * - une fléchette n'est signalée qu'une fois, à sa première apparition dans `throws` ;
 * - une fléchette qui change de segment à la même position est une correction de la cible ;
 * - « Takeout started / finished » délimitent le retrait : un retrait n'est jamais un impact ;
 * - après une reconnexion, l'état relu est comparé au dernier connu : seules les fléchettes
 *   nouvelles sont signalées ; si la cible a été vidée entre-temps, une alerte « gap » est émise
 *   (des fléchettes ont pu être perdues — elles ne sont jamais inventées).
 */
export interface TrackerOptions {
  source: ThrowSource;
  simulated: boolean;
  sessionId: string;
  now?: () => Date;
}

interface TrackedDart {
  eventId: string;
  revision: number;
  board: BoardThrow;
}

function sameSegment(a: BoardThrow, b: BoardThrow): boolean {
  return sameDart(throwToDart(a), throwToDart(b)) && (a.bouncer ?? false) === (b.bouncer ?? false);
}

function sameCoords(a: BoardThrow, b: BoardThrow): boolean {
  const ax = a.coords?.x;
  const ay = a.coords?.y;
  return ax !== undefined && ay !== undefined && ax === b.coords?.x && ay === b.coords?.y;
}

function snapshotKey(s: BoardSnapshot): string {
  return JSON.stringify([s.running, s.status, s.event, s.numThrows, s.throws]);
}

export class BoardTracker {
  private last: BoardSnapshot | null = null;
  private darts: (TrackedDart | null)[] = [];
  private visit = 0;
  private ownResets = 0;
  /** Fléchettes présentes sur la cible au moment de la première connexion (non comptées). */
  baselineDarts = 0;

  constructor(private readonly options: TrackerOptions) {}

  get boardVisit(): number {
    return this.visit;
  }

  get lastSnapshot(): BoardSnapshot | null {
    return this.last;
  }

  /** À appeler juste avant d'envoyer POST /api/reset, pour ne pas confondre avec un reset manuel. */
  expectOwnReset(): void {
    this.ownResets++;
  }

  private at(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }

  private makeThrow(slot: number, board: BoardThrow, eventId: string): DetectedThrow {
    const dart = throwToDart(board);
    const t: DetectedThrow = {
      eventId,
      receivedAt: this.at(),
      dart,
      score: dartScore(dart),
      segmentName: board.segment.name ?? dartLabel(dart),
      slot,
      boardVisit: this.visit,
      source: this.options.source,
      simulated: this.options.simulated,
    };
    if (board.segment.bed) t.bed = board.segment.bed;
    if (board.coords && typeof board.coords.x === "number" && typeof board.coords.y === "number") {
      t.coords = { x: board.coords.x, y: board.coords.y };
    }
    if (board.bouncer !== undefined) t.bouncer = board.bouncer;
    return t;
  }

  private newDart(slot: number, board: BoardThrow | null, events: ScoringEvent[]): void {
    if (!board) {
      this.darts[slot] = null;
      return;
    }
    const eventId = `${this.options.sessionId}-v${this.visit}-d${slot}`;
    this.darts[slot] = { eventId, revision: 0, board };
    events.push({ kind: "throw", throw: this.makeThrow(slot, board, eventId) });
  }

  private clearBoard(events: ScoringEvent[], kind: "takeout" | "reset", dartsOnBoard: number): void {
    const at = this.at();
    if (kind === "reset") {
      const own = this.ownResets > 0;
      if (own) this.ownResets--;
      events.push({ kind: "reset", at, own, boardVisit: this.visit });
    } else {
      events.push({ kind: "takeout-finished", at, boardVisit: this.visit, dartsOnBoard });
    }
    this.darts = [];
    this.visit++;
  }

  /** Premier instantané après une connexion « à froid » : sert de référence. */
  baseline(snapshot: BoardSnapshot): ScoringEvent[] {
    this.last = snapshot;
    this.darts = snapshot.throws.map((board, slot) =>
      board ? { eventId: `${this.options.sessionId}-base-d${slot}`, revision: 0, board } : null,
    );
    this.baselineDarts = snapshot.throws.length;
    return [];
  }

  /** Message en direct (WebSocket) : comparé au précédent. */
  live(next: BoardSnapshot): ScoringEvent[] {
    if (!this.last) return this.baseline(next);
    const prev = this.last;
    if (snapshotKey(prev) === snapshotKey(next)) return []; // message répété : rien de nouveau
    const events: ScoringEvent[] = [];
    const at = this.at();
    if (prev.running !== next.running) {
      events.push({ kind: next.running ? "detection-started" : "detection-stopped", at });
    }
    const takeoutStarted =
      (next.status === "Takeout in progress" && prev.status !== "Takeout in progress") ||
      (next.event === "Takeout started" && prev.event !== "Takeout started");
    if (takeoutStarted) events.push({ kind: "takeout-started", at, boardVisit: this.visit });

    const current = next.throws;
    const known = this.darts.length;
    const manualReset = next.event === "Manual reset" && (prev.event !== "Manual reset" || known > 0);
    if (manualReset) {
      this.clearBoard(events, "reset", known);
    } else if (current.length < known) {
      // Fléchettes disparues : retrait terminé (ou cible vidée sans événement explicite).
      this.clearBoard(events, "takeout", known);
    } else if (next.event === "Takeout finished" && prev.event !== "Takeout finished" && known === 0) {
      // Retrait sans fléchette détectée (ex. trois fléchettes hors cible non détectées).
      events.push({ kind: "takeout-finished", at, boardVisit: this.visit, dartsOnBoard: 0 });
      this.visit++;
    }

    // Corrections en place (la cible révise une fléchette déjà signalée).
    for (let slot = 0; slot < Math.min(this.darts.length, current.length); slot++) {
      const tracked = this.darts[slot];
      const now = current[slot];
      if (!now) continue;
      if (!tracked) {
        // Fléchette illisible devenue lisible : c'est sa première apparition valide.
        this.newDart(slot, now, events);
        continue;
      }
      if (!sameSegment(tracked.board, now)) {
        const previous = throwToDart(tracked.board);
        tracked.revision++;
        tracked.board = now;
        events.push({
          kind: "throw-corrected",
          previous,
          throw: this.makeThrow(slot, now, `${tracked.eventId}-r${tracked.revision}`),
        });
      } else {
        tracked.board = now; // mise à jour silencieuse des coordonnées
      }
    }
    for (let slot = this.darts.length; slot < current.length; slot++) this.newDart(slot, current[slot] ?? null, events);
    this.last = next;
    return events;
  }

  /**
   * Instantané relu par HTTP après une reconnexion : tout a pu se passer pendant la coupure.
   * Si les fléchettes connues sont toujours là (même segment et même position), seules les
   * nouvelles sont signalées ; sinon la visite est considérée comme retirée.
   */
  resync(next: BoardSnapshot): ScoringEvent[] {
    if (!this.last) return this.baseline(next);
    const events: ScoringEvent[] = [];
    const at = this.at();
    const current = next.throws;
    const stillThere = this.darts.every((tracked, slot) => {
      const now = current[slot];
      if (!tracked) return slot < current.length;
      return !!now && sameSegment(tracked.board, now) && (sameCoords(tracked.board, now) || !tracked.board.coords);
    });
    if (this.darts.length > 0 && (!stillThere || current.length < this.darts.length)) {
      const lost = this.darts.length;
      this.clearBoard(events, "takeout", lost);
      events.push({
        kind: "gap",
        at,
        message:
          "La cible a été vidée pendant la coupure : une visite a pu être jouée sans être reçue. Vérifiez le score et saisissez les fléchettes manquantes à la main si nécessaire.",
      });
    }
    if (this.last.running !== next.running) {
      events.push({ kind: next.running ? "detection-started" : "detection-stopped", at });
    }
    for (let slot = this.darts.length; slot < current.length; slot++) this.newDart(slot, current[slot] ?? null, events);
    this.last = next;
    return events;
  }

  /**
   * Réconciliation périodique par HTTP pendant une connexion active : n'ajoute que des fléchettes
   * manquantes, ne vide jamais la cible (une réponse HTTP peut être plus ancienne qu'un message reçu).
   */
  reconcile(next: BoardSnapshot): ScoringEvent[] {
    if (!this.last) return [];
    const current = next.throws;
    if (current.length <= this.darts.length) return [];
    const prefixMatches = this.darts.every((tracked, slot) => {
      const now = current[slot];
      return tracked === null ? true : !!now && sameSegment(tracked.board, now);
    });
    if (!prefixMatches) return [];
    const events: ScoringEvent[] = [];
    for (let slot = this.darts.length; slot < current.length; slot++) this.newDart(slot, current[slot] ?? null, events);
    this.last = next;
    return events;
  }
}

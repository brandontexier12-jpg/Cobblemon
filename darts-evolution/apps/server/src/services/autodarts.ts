import { EventEmitter } from "node:events";
import {
  AutodartsScoringProvider,
  BoardError,
  BoardManagerSimulator,
  classifyError,
  validateHost,
  type AdapterLogger,
  type ConnectionTestResult,
} from "@darts-evolution/autodarts-adapter";
import { dartDisplay, type ConnectionStatus, type DetectedThrow, type ScoringEvent } from "@darts-evolution/shared";
import { nowIso, parseJson, type Database } from "../db/database.js";
import { AppError, badRequest, conflict } from "../errors.js";
import type { MatchService, MatchSnapshot } from "./matches.js";
import type { SettingsService } from "./settings.js";

export interface AutodartsNotice {
  matchId: string | null;
  level: "info" | "warning";
  message: string;
  at: string;
}

export interface AutodartsOverview {
  status: ConnectionStatus;
  enabled: boolean;
  config: { host: string; port: number; protocol: "http" | "https" };
  boundMatchId: string | null;
  simulation: boolean;
  compatibility: string;
  /** Calibration automatique des caméras en cours (lancée depuis l'application). */
  calibrating: boolean;
}

const JOURNAL_LIMIT = 5000;

const DISABLED_STATUS = (simulated = false): ConnectionStatus => ({
  provider: "autodarts",
  state: "disabled",
  reconnectAttempts: 0,
  warnings: [],
  simulated,
});

/**
 * Pont entre le fournisseur Autodarts et les parties :
 * - un impact valide est transmis au moteur de la partie liée (source « autodarts ») ;
 * - le retrait des fléchettes (ou un reset manuel) termine la visite, jamais un impact ;
 * - chaque événement est journalisé avec son traitement (appliqué, doublon, ignoré…).
 */
export class AutodartsService extends EventEmitter {
  private provider: AutodartsScoringProvider | null = null;
  private calibrating = false;
  private calibrationQuietUntil = 0;
  private simulator: BoardManagerSimulator | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastJournaledState: string | null = null;
  private inserts = 0;

  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly matches: MatchService,
    private readonly logger: AdapterLogger,
  ) {
    super();
    matches.on("updated", (snapshot: MatchSnapshot) => {
      if (snapshot.match.id === this.boundMatchId && snapshot.match.status !== "active") this.bind(null);
    });
    matches.on("deleted", (id: string) => {
      if (id === this.boundMatchId) this.bind(null);
    });
  }

  get simulationActive(): boolean {
    return this.simulator !== null;
  }

  get simulatorInstance(): BoardManagerSimulator | null {
    return this.simulator;
  }

  get boundMatchId(): string | null {
    return this.settings.boundMatchId();
  }

  bind(matchId: string | null): void {
    if (this.boundMatchId === matchId) return;
    this.settings.setBoundMatchId(matchId);
    this.emit("status", this.overview());
  }

  async start(): Promise<void> {
    await this.connectFromSettings();
  }

  private async attach(provider: AutodartsScoringProvider): Promise<void> {
    this.provider = provider;
    this.unsubscribe = provider.onEvent((e) => {
      try {
        this.handle(e);
      } catch (error) {
        this.logger.error("Erreur lors du traitement d'un événement Autodarts.", { error: (error as Error).message });
      }
    });
    await provider.connect();
  }

  private async detach(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const provider = this.provider;
    this.provider = null;
    if (provider) await provider.disconnect();
  }

  private async connectFromSettings(): Promise<void> {
    await this.detach();
    const s = this.settings.autodarts();
    if (s.enabled && s.host && validateHost(s.host)) {
      await this.attach(new AutodartsScoringProvider({ host: s.host, port: s.port, protocol: s.protocol, logger: this.logger }));
    }
    this.emit("status", this.overview());
  }

  async applySettings(input: unknown): Promise<AutodartsOverview> {
    const current = this.settings.autodarts();
    const next = { ...current, ...(input as object) } as typeof current;
    if (next.enabled && !next.host) throw badRequest("Indiquez l'adresse du système Autodarts avant d'activer l'intégration.");
    if (next.host && !validateHost(next.host)) throw badRequest("Adresse invalide : saisissez une IP ou un nom d'hôte, sans http:// ni chemin.");
    this.settings.setAutodarts(next);
    this.journal("config", { enabled: next.enabled, target: next.host ? `${next.protocol}://${next.host}:${next.port}` : null }, "enregistrée", null);
    if (!this.simulationActive) await this.connectFromSettings();
    return this.overview();
  }

  async test(input?: { host?: string; port?: number; protocol?: "http" | "https" }): Promise<ConnectionTestResult> {
    const s = this.settings.autodarts();
    const endpoint = { host: input?.host ?? s.host, port: input?.port ?? s.port, protocol: input?.protocol ?? s.protocol };
    const result = await AutodartsScoringProvider.testConnection(endpoint);
    this.journal("test", { target: result.url, ok: result.ok, version: result.version, code: result.diagnostic?.code ?? null }, result.ok ? "réussi" : "échec", null);
    return result;
  }

  /** Mode test : un simulateur local remplace temporairement le Board Manager réel. */
  async startSimulation(): Promise<AutodartsOverview> {
    if (this.simulator) return this.overview();
    await this.detach();
    const simulator = new BoardManagerSimulator({ host: "127.0.0.1", port: 0, generation: 2 });
    await simulator.start();
    this.simulator = simulator;
    await this.attach(
      new AutodartsScoringProvider({
        host: "127.0.0.1",
        port: simulator.port,
        protocol: "http",
        simulated: true,
        logger: this.logger,
        reconnectMinMs: 250,
        reconnectMaxMs: 2000,
      }),
    );
    this.journal("simulation", { action: "démarrage" }, "mode test actif", null);
    this.emit("status", this.overview());
    return this.overview();
  }

  async stopSimulation(): Promise<AutodartsOverview> {
    if (!this.simulator) return this.overview();
    await this.detach();
    await this.simulator.stop();
    this.simulator = null;
    this.journal("simulation", { action: "arrêt" }, "mode test terminé", null);
    const bound = this.boundMatchId;
    if (bound) {
      try {
        if (this.matches.get(bound).match.isSimulation) this.bind(null);
      } catch {
        this.bind(null);
      }
    }
    await this.connectFromSettings();
    return this.overview();
  }

  async resetBoard(): Promise<void> {
    if (!this.provider) throw badRequest("Aucune connexion Autodarts active.");
    await this.provider.resetBoard();
  }

  /**
   * Calibration automatique des caméras Autodarts (toutes, ou une seule). Pendant la calibration et
   * quelques secondes après, les impacts et retraits signalés par la cible sont ignorés : la partie ne
   * peut pas être faussée par une image de calibration.
   */
  async calibrate(camera?: number): Promise<{ message: string }> {
    if (!this.provider) throw badRequest("Aucune connexion Autodarts active.");
    if (this.calibrating) throw conflict("Une calibration est déjà en cours.", "calibration_running");
    const label = camera === undefined ? "toutes les caméras" : `caméra ${camera + 1}`;
    this.calibrating = true;
    this.calibrationQuietUntil = Number.POSITIVE_INFINITY;
    this.emit("status", this.overview());
    try {
      await this.provider.calibrate(camera);
      this.journal("calibration", { cameras: label }, "terminée", this.boundMatchId);
      return { message: `Calibration automatique terminée (${label}).` };
    } catch (error) {
      const status = error instanceof BoardError ? error.status : undefined;
      const message =
        status === 409
          ? "Autodarts a refusé la calibration : une calibration est peut-être déjà en cours, ou la détection est occupée. Réessayez dans un instant."
          : status === 404 || status === 405
            ? "Cette version d'Autodarts ne propose pas la calibration par son API locale : lancez-la depuis l'interface Autodarts."
            : `Calibration impossible : ${classifyError(error).message}`;
      this.journal("calibration", { cameras: label }, `échec : ${message}`, this.boundMatchId);
      throw new AppError(502, "calibration_failed", message);
    } finally {
      this.calibrating = false;
      this.calibrationQuietUntil = Date.now() + 5000;
      this.emit("status", this.overview());
    }
  }

  /** Nombre de caméras déclarées par Autodarts (null si inconnu). */
  async cameraCount(): Promise<number | null> {
    return this.provider ? this.provider.cameraCount() : null;
  }

  /** Calibration en cours (ou terminée depuis moins de 5 s) : la cible n'est pas écoutée. */
  private get calibrationQuiet(): boolean {
    return this.calibrating || Date.now() < this.calibrationQuietUntil;
  }

  async stop(): Promise<void> {
    await this.detach();
    if (this.simulator) await this.simulator.stop();
    this.simulator = null;
  }

  overview(): AutodartsOverview {
    const s = this.settings.autodarts();
    return {
      status: this.provider?.statusSnapshot ?? DISABLED_STATUS(),
      enabled: s.enabled,
      calibrating: this.calibrating,
      config: { host: s.host, port: s.port, protocol: s.protocol },
      boundMatchId: this.boundMatchId,
      simulation: this.simulationActive,
      compatibility:
        "API locale non officielle du Board Manager Autodarts (port 3180). Formes vérifiées : 1.x et 2.0.x (observée en 2.0.2). Test matériel réel à effectuer.",
    };
  }

  journalList(limit = 100): unknown[] {
    return this.db
      .all<{ id: number; received_at: string; kind: string; provider: string; simulated: number; summary: string; match_id: string | null; outcome: string }>(
        "SELECT * FROM autodarts_events ORDER BY id DESC LIMIT $limit",
        { $limit: Math.min(Math.max(limit, 1), 1000) },
      )
      .map((r) => ({
        id: r.id,
        receivedAt: r.received_at,
        kind: r.kind,
        provider: r.provider,
        simulated: r.simulated === 1,
        summary: parseJson(r.summary, {}),
        matchId: r.match_id,
        outcome: r.outcome,
      }));
  }

  private journal(kind: string, summary: Record<string, unknown>, outcome: string, matchId: string | null): void {
    this.db.run(
      `INSERT INTO autodarts_events (received_at, kind, provider, simulated, summary, match_id, outcome)
       VALUES ($at, $kind, $provider, $sim, $summary, $match, $outcome)`,
      {
        $at: nowIso(),
        $kind: kind,
        $provider: this.provider?.kind ?? (this.simulationActive ? "simulation" : "autodarts"),
        $sim: this.simulationActive ? 1 : 0,
        $summary: JSON.stringify(summary),
        $match: matchId,
        $outcome: outcome,
      },
    );
    // Journal technique borné (les statistiques ne sont jamais concernées par cet élagage).
    if (++this.inserts % 200 === 0) {
      this.db.run(`DELETE FROM autodarts_events WHERE id <= (SELECT MAX(id) FROM autodarts_events) - ${JOURNAL_LIMIT}`);
    }
    this.emit("journal");
  }

  private notice(matchId: string | null, level: AutodartsNotice["level"], message: string): void {
    this.emit("notice", { matchId, level, message, at: nowIso() } satisfies AutodartsNotice);
  }

  /** Partie destinataire des impacts, ou raison pour laquelle il n'y en a pas. */
  private target(): { matchId: string } | { reason: string; matchId: string | null } {
    const id = this.boundMatchId;
    if (!id) return { reason: "aucune partie liée à Autodarts", matchId: null };
    let snapshot: MatchSnapshot;
    try {
      snapshot = this.matches.get(id);
    } catch {
      this.bind(null);
      return { reason: "partie liée introuvable", matchId: null };
    }
    if (snapshot.match.status !== "active") return { reason: "partie terminée", matchId: id };
    if (snapshot.match.inputMode !== "autodarts") return { reason: "la partie est en saisie manuelle", matchId: id };
    if (snapshot.match.isSimulation !== this.simulationActive) {
      return { reason: this.simulationActive ? "impact simulé refusé pour une partie réelle" : "impact réel refusé pour une partie de test", matchId: id };
    }
    return { matchId: id };
  }

  private handle(e: ScoringEvent): void {
    switch (e.kind) {
      case "status": {
        if (e.status.state !== this.lastJournaledState) {
          this.lastJournaledState = e.status.state;
          this.journal("connexion", { state: e.status.state, version: e.status.version ?? null, error: e.status.lastError?.code ?? null }, e.status.state, null);
        }
        this.emit("status", this.overview());
        return;
      }
      case "throw":
        return this.onThrow(e.throw);
      case "throw-corrected":
        return this.onCorrection(e.throw, e.previous);
      case "takeout-finished":
        return this.onVisitBoundary("retrait", e.dartsOnBoard, `${e.at}:${e.boardVisit}`);
      case "reset":
        if (e.own) {
          this.journal("reset", { own: true }, "ignoré (reset demandé par l'application)", this.boundMatchId);
          return;
        }
        return this.onVisitBoundary("reset", 0, `${e.at}:${e.boardVisit}`);
      case "takeout-started":
        this.journal("retrait-début", {}, "information", this.boundMatchId);
        return;
      case "detection-started":
      case "detection-stopped":
        this.journal(e.kind, {}, "information", this.boundMatchId);
        this.notice(this.boundMatchId, e.kind === "detection-stopped" ? "warning" : "info", e.kind === "detection-stopped" ? "Détection Autodarts arrêtée." : "Détection Autodarts démarrée.");
        this.emit("status", this.overview());
        return;
      case "gap":
        this.journal("coupure", { message: e.message }, "alerte", this.boundMatchId);
        this.notice(this.boundMatchId, "warning", e.message);
        return;
      case "invalid":
        this.journal("invalide", { reason: e.reason }, "ignoré", this.boundMatchId);
        return;
    }
  }

  private summary(t: DetectedThrow): Record<string, unknown> {
    return { eventId: t.eventId, segment: t.segmentName, dart: dartDisplay(t.dart), score: t.score, slot: t.slot, visit: t.boardVisit, bed: t.bed ?? null };
  }

  private onThrow(t: DetectedThrow): void {
    if (this.calibrationQuiet) {
      this.journal("impact", this.summary(t), "ignoré : calibration des caméras en cours", this.boundMatchId);
      return;
    }
    const target = this.target();
    if ("reason" in target) {
      this.journal("impact", this.summary(t), `ignoré : ${target.reason}`, target.matchId);
      return;
    }
    const state = this.matches.getState(target.matchId);
    if (state.turn.complete) {
      this.journal("impact", this.summary(t), "ignoré : visite terminée, en attente du retrait des fléchettes", target.matchId);
      this.notice(target.matchId, "info", `Fléchette ${dartDisplay(t.dart)} ignorée : la visite est terminée, retirez les fléchettes.`);
      return;
    }
    const bot = this.botOnTurn(target.matchId, state.turn.playerIndex);
    if (bot) {
      this.journal("impact", this.summary(t), `ignoré : tour de ${bot}`, target.matchId);
      this.notice(target.matchId, "info", `Fléchette ${dartDisplay(t.dart)} ignorée : c'est au tour de ${bot}.`);
      return;
    }
    try {
      const result = this.matches.command(target.matchId, {
        kind: "dart",
        dart: t.dart,
        source: t.simulated ? "simulation" : "autodarts",
        externalId: t.eventId,
        commandId: `ad:${t.eventId}`,
        ...(t.coords ? { coords: t.coords } : {}),
      });
      this.journal("impact", this.summary(t), result.duplicate ? "doublon ignoré" : "appliqué", target.matchId);
    } catch (error) {
      this.journal("impact", this.summary(t), `refusé : ${(error as Error).message}`, target.matchId);
    }
  }

  private onCorrection(t: DetectedThrow, previous: DetectedThrow["dart"]): void {
    const target = this.target();
    const original = t.eventId.replace(/-r\d+$/, "");
    if ("reason" in target) {
      this.journal("correction", { ...this.summary(t), previous: dartDisplay(previous) }, `ignorée : ${target.reason}`, target.matchId);
      return;
    }
    const event = this.matches.findByExternalId(target.matchId, original);
    if (!event) {
      this.journal("correction", { ...this.summary(t), previous: dartDisplay(previous) }, "ignorée : fléchette d'origine non comptée", target.matchId);
      return;
    }
    try {
      const result = this.matches.command(target.matchId, {
        kind: "correct",
        eventId: event.id,
        dart: t.dart,
        source: t.simulated ? "simulation" : "autodarts",
        externalId: t.eventId,
        commandId: `ad:${t.eventId}`,
        ...(t.coords ? { coords: t.coords } : {}),
      });
      this.journal("correction", { ...this.summary(t), previous: dartDisplay(previous) }, result.applied ? "appliquée" : "doublon ignoré", target.matchId);
    } catch (error) {
      this.journal("correction", this.summary(t), `refusée : ${(error as Error).message}`, target.matchId);
    }
  }

  /** Nom du bot dont c'est le tour (ses fléchettes sont virtuelles : la cible réelle est ignorée). */
  private botOnTurn(matchId: string, playerIndex: number): string | null {
    const player = this.matches.get(matchId).match.players[playerIndex];
    return player?.botAverage != null ? player.name : null;
  }

  /** Fin de visite détectée sur la cible (retrait des fléchettes ou reset manuel). */
  private onVisitBoundary(kind: "retrait" | "reset", dartsOnBoard: number, key: string): void {
    if (this.calibrationQuiet) {
      this.journal(kind, { dartsOnBoard }, "ignoré : calibration des caméras en cours", this.boundMatchId);
      return;
    }
    const target = this.target();
    if ("reason" in target) {
      this.journal(kind, { dartsOnBoard }, `ignoré : ${target.reason}`, target.matchId);
      return;
    }
    const state = this.matches.getState(target.matchId);
    const bot = this.botOnTurn(target.matchId, state.turn.playerIndex);
    if (bot) {
      this.journal(kind, { dartsOnBoard }, `ignoré : tour de ${bot} (il passe la main seul)`, target.matchId);
      return;
    }
    if (!state.turn.complete && state.turn.darts.length === 0) {
      this.journal(kind, { dartsOnBoard }, "ignoré : aucune fléchette dans la visite en cours", target.matchId);
      return;
    }
    const early = !state.turn.complete;
    try {
      this.matches.command(target.matchId, { kind: "next", source: this.simulationActive ? "simulation" : "autodarts", commandId: `ad:${kind}:${key}` });
      const outcome = early
        ? `visite terminée avec ${state.turn.darts.length} fléchette(s) détectée(s), les autres comptées ratées`
        : "joueur suivant";
      this.journal(kind, { dartsOnBoard }, outcome, target.matchId);
      if (early) this.notice(target.matchId, "info", `Retrait détecté après ${state.turn.darts.length} fléchette(s) : les fléchettes manquantes sont comptées ratées (corrigeables).`);
    } catch (error) {
      this.journal(kind, { dartsOnBoard }, `refusé : ${(error as Error).message}`, target.matchId);
    }
  }
}

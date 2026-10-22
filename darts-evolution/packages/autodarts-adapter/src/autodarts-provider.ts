import { randomBytes } from "node:crypto";
import type {
  ConnectionState,
  ConnectionStatus,
  DetectedThrow,
  Diagnostic,
  ProviderKind,
  ScoringEvent,
  ScoringProvider,
} from "@darts-evolution/shared";
import type WebSocket from "ws";
import { BoardManagerClient, type BoardEndpoint } from "./client.js";
import { BoardError, classifyError, makeDiagnostic } from "./diagnostics.js";
import { EnvelopeSchema, LIFECYCLE_STATUSES, parseBoardState, type BoardSnapshot } from "./protocol.js";
import { BoardTracker } from "./tracker.js";

export interface AdapterLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const silentLogger: AdapterLogger = { debug() {}, info() {}, warn() {}, error() {} };

export interface AutodartsProviderOptions extends BoardEndpoint {
  /** Fournisseur branché sur le simulateur : tous les impacts sont marqués « simulés ». */
  simulated?: boolean;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  pingIntervalMs?: number;
  pingTimeoutMs?: number;
  reconcileIntervalMs?: number;
  logger?: AdapterLogger;
}

export interface ConnectionTestResult {
  ok: boolean;
  url: string | null;
  version: string | null;
  generation: 1 | 2 | null;
  versionSupported: boolean | null;
  running: boolean | null;
  boardStatus: string | null;
  dartsOnBoard: number | null;
  throwDataAvailable: boolean | null;
  websocket: boolean;
  diagnostic: Diagnostic | null;
  warnings: string[];
}

const STABLE_CONNECTION_MS = 30_000;

/**
 * Fournisseur de scoring Autodarts via l'API locale du Board Manager (WebSocket /api/events).
 * Toute la dépendance au protocole Autodarts est isolée dans ce paquet.
 */
export class AutodartsScoringProvider implements ScoringProvider {
  readonly kind: ProviderKind;
  private readonly client: BoardManagerClient;
  private tracker: BoardTracker;
  private readonly log: AdapterLogger;
  private ws: WebSocket | null = null;
  private stopped = true;
  private online = false;
  private hadConnection = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private readonly throwListeners = new Set<(t: DetectedThrow) => void>();
  private readonly eventListeners = new Set<(e: ScoringEvent) => void>();
  private status: ConnectionStatus;

  constructor(private readonly options: AutodartsProviderOptions) {
    this.kind = options.simulated ? "simulation" : "autodarts";
    this.client = new BoardManagerClient(options);
    this.log = options.logger ?? silentLogger;
    this.tracker = this.newTracker();
    let target: string | undefined;
    try {
      target = this.client.url;
    } catch {
      target = undefined;
    }
    this.status = {
      provider: this.kind,
      state: "disconnected",
      target,
      boardStatus: null,
      boardEvent: null,
      running: null,
      version: null,
      generation: null,
      connectedSince: null,
      lastMessageAt: null,
      lastThrowAt: null,
      lastThrow: null,
      reconnectAttempts: 0,
      lastError: null,
      warnings: [],
      simulated: !!options.simulated,
    };
  }

  private newTracker(): BoardTracker {
    return new BoardTracker({
      source: this.options.simulated ? "simulation" : "autodarts",
      simulated: !!this.options.simulated,
      sessionId: randomBytes(4).toString("hex"),
    });
  }

  onThrow(callback: (event: DetectedThrow) => void): () => void {
    this.throwListeners.add(callback);
    return () => this.throwListeners.delete(callback);
  }

  onEvent(callback: (event: ScoringEvent) => void): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  async getStatus(): Promise<ConnectionStatus> {
    return structuredClone(this.status);
  }

  get statusSnapshot(): ConnectionStatus {
    return structuredClone(this.status);
  }

  private emit(events: ScoringEvent[]): void {
    for (const event of events) {
      if (event.kind === "throw") {
        this.status.lastThrowAt = event.throw.receivedAt;
        this.status.lastThrow = event.throw.segmentName;
        for (const cb of this.throwListeners) cb(event.throw);
      }
      if (event.kind === "gap") this.log.warn(event.message);
      for (const cb of this.eventListeners) cb(event);
    }
  }

  private setState(state: ConnectionState, error?: Diagnostic | null): void {
    const changed = this.status.state !== state || error !== undefined;
    this.status.state = state;
    if (error !== undefined) this.status.lastError = error;
    if (changed) this.emit([{ kind: "status", status: structuredClone(this.status) }]);
  }

  async connect(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    await this.open();
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.online = false;
    ws?.removeAllListeners();
    ws?.on("error", () => {});
    ws?.terminate();
    this.status.connectedSince = null;
    this.setState("disconnected");
  }

  /** Demande une remise à zéro de la visite sur le Board Manager (commande explicite). */
  async resetBoard(): Promise<void> {
    this.tracker.expectOwnReset();
    await this.client.command("reset");
  }

  private clearTimers(): void {
    for (const t of [this.pingTimer, this.pongTimer, this.reconcileTimer]) if (t) clearTimeout(t);
    this.pingTimer = null;
    this.pongTimer = null;
    this.reconcileTimer = null;
  }

  private updateFromSnapshot(snapshot: BoardSnapshot): void {
    this.status.boardStatus = snapshot.status || null;
    this.status.boardEvent = snapshot.event || null;
    this.status.running = snapshot.running;
    this.status.lastMessageAt = new Date().toISOString();
    const warnings = this.status.warnings.filter((w) => !w.startsWith("[détection]") && !w.startsWith("[données]"));
    if (!snapshot.running || LIFECYCLE_STATUSES.includes(snapshot.status.toLowerCase())) {
      warnings.push(`[détection] ${makeDiagnostic("detection_stopped").message} Statut : ${snapshot.status || "inconnu"}.`);
    }
    if (snapshot.missingThrowData) {
      const diag = makeDiagnostic("no_throw_data");
      warnings.push(`[données] ${diag.message} ${diag.hint}`);
      this.status.lastError = diag;
    }
    this.status.warnings = warnings;
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    this.setState(this.hadConnection ? "reconnecting" : "connecting");
    try {
      const version = await this.client.getVersion();
      this.status.version = version?.version ?? null;
      this.status.generation = version?.generation ?? null;
      const warnings = this.status.warnings.filter((w) => !w.startsWith("[version]"));
      if (!version) warnings.push("[version] Version du Board Manager inconnue : compatibilité non vérifiée.");
      else if (!version.supported) warnings.push(`[version] Version ${version.version} non vérifiée (versions testées : 1.x et 2.0.x).`);
      this.status.warnings = warnings;
      // Vérifie qu'il s'agit bien du Board Manager avant d'ouvrir le WebSocket.
      await this.client.getState();
    } catch (error) {
      this.fail(error);
      return;
    }
    if (this.stopped) return;
    const ws = this.client.openEvents();
    this.ws = ws;
    ws.on("open", () => {
      void this.synchronize(ws);
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary || ws !== this.ws || !this.online) return;
      this.handleMessage(data.toString());
    });
    ws.on("pong", () => {
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = null;
    });
    ws.on("unexpected-response", (_req, res) => {
      const code = res.statusCode === 401 || res.statusCode === 403 ? "auth_required" : "not_board_manager";
      this.status.lastError = makeDiagnostic(code, `HTTP ${res.statusCode}`);
      ws.terminate();
    });
    ws.on("error", (error) => {
      if (!this.status.lastError || this.status.state !== "error") this.status.lastError = classifyError(error);
    });
    ws.on("close", () => {
      if (ws !== this.ws) return;
      this.goOffline();
    });
  }

  private async synchronize(ws: WebSocket): Promise<void> {
    try {
      const snapshot = await this.client.getState();
      if (ws !== this.ws) return;
      const events = this.hadConnection ? this.tracker.resync(snapshot) : this.tracker.baseline(snapshot);
      this.updateFromSnapshot(snapshot);
      this.online = true;
      this.hadConnection = true;
      this.attempt = 0;
      this.status.reconnectAttempts = 0;
      this.status.connectedSince = new Date().toISOString();
      if (this.status.lastError?.code !== "no_throw_data") this.status.lastError = null;
      if (this.tracker.baselineDarts > 0 && events.length === 0) {
        this.log.info("Fléchettes déjà présentes sur la cible à la connexion : elles ne sont pas comptées.", {
          darts: this.tracker.baselineDarts,
        });
      }
      this.setState("connected");
      this.log.info("Connecté au Board Manager Autodarts.", { target: this.status.target, version: this.status.version });
      this.emit(events);
      this.schedulePing(ws);
      this.scheduleReconcile(ws);
    } catch (error) {
      this.status.lastError = classifyError(error);
      ws.terminate();
    }
  }

  private handleMessage(text: string): void {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      this.emit([{ kind: "invalid", at: new Date().toISOString(), reason: "Message non JSON ignoré" }]);
      return;
    }
    const envelope = EnvelopeSchema.safeParse(json);
    if (!envelope.success) {
      this.emit([{ kind: "invalid", at: new Date().toISOString(), reason: "Message sans type ignoré" }]);
      return;
    }
    if (envelope.data.type !== "state") return; // motion_state, cam_state, stats… : non utilisés
    const parsed = parseBoardState(envelope.data.data);
    if (!parsed.ok) {
      this.emit([{ kind: "invalid", at: new Date().toISOString(), reason: parsed.reason }]);
      return;
    }
    const invalid = parsed.invalidThrows.map((reason) => ({ kind: "invalid" as const, at: new Date().toISOString(), reason }));
    const events = this.tracker.live(parsed.value);
    this.updateFromSnapshot(parsed.value);
    this.emit([...invalid, ...events]);
  }

  private schedulePing(ws: WebSocket): void {
    const interval = this.options.pingIntervalMs ?? 15_000;
    const timeout = this.options.pingTimeoutMs ?? 10_000;
    this.pingTimer = setTimeout(() => {
      if (ws !== this.ws || ws.readyState !== ws.OPEN) return;
      ws.ping();
      this.pongTimer = setTimeout(() => {
        this.log.warn("Le Board Manager ne répond plus (ping sans réponse) : reconnexion.");
        ws.terminate();
      }, timeout);
      this.schedulePing(ws);
    }, interval);
  }

  private scheduleReconcile(ws: WebSocket): void {
    const interval = this.options.reconcileIntervalMs ?? 20_000;
    this.reconcileTimer = setTimeout(async () => {
      if (ws !== this.ws || !this.online) return;
      try {
        const snapshot = await this.client.getState();
        if (ws !== this.ws) return;
        const events = this.tracker.reconcile(snapshot);
        if (events.length) this.log.warn("Fléchettes récupérées par réconciliation HTTP.", { count: events.length });
        this.emit(events);
      } catch (error) {
        this.log.debug("Réconciliation impossible.", { code: classifyError(error).code });
      }
      this.scheduleReconcile(ws);
    }, interval);
  }

  private goOffline(): void {
    const lastedMs = this.status.connectedSince ? Date.now() - Date.parse(this.status.connectedSince) : 0;
    this.ws = null;
    this.online = false;
    this.clearTimers();
    this.status.connectedSince = null;
    if (lastedMs >= STABLE_CONNECTION_MS) this.attempt = 0;
    if (this.stopped) return;
    this.setState("reconnecting");
    this.scheduleReconnect();
  }

  private fail(error: unknown): void {
    const diagnostic = classifyError(error);
    if (error instanceof BoardError) this.log.warn(`Autodarts : ${diagnostic.message}`);
    else this.log.debug(`Autodarts : ${diagnostic.message}`);
    this.setState(this.hadConnection ? "reconnecting" : "error", diagnostic);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const min = this.options.reconnectMinMs ?? 1000;
    const max = this.options.reconnectMaxMs ?? 30_000;
    const delay = Math.min(max, min * 2 ** this.attempt) * (1 - Math.random() * 0.2);
    this.attempt++;
    this.status.reconnectAttempts = this.attempt;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);
  }

  /** Test ponctuel de connexion, sans toucher à la connexion en cours. */
  static async testConnection(endpoint: BoardEndpoint): Promise<ConnectionTestResult> {
    const result: ConnectionTestResult = {
      ok: false,
      url: null,
      version: null,
      generation: null,
      versionSupported: null,
      running: null,
      boardStatus: null,
      dartsOnBoard: null,
      throwDataAvailable: null,
      websocket: false,
      diagnostic: null,
      warnings: [],
    };
    let client: BoardManagerClient;
    try {
      client = new BoardManagerClient(endpoint);
      result.url = client.url;
    } catch (error) {
      result.diagnostic = classifyError(error);
      return result;
    }
    try {
      const version = await client.getVersion();
      result.version = version?.version ?? null;
      result.generation = version?.generation ?? null;
      result.versionSupported = version?.supported ?? null;
      if (!version) result.warnings.push("Version non lisible (/api/version) : compatibilité non vérifiée.");
      else if (!version.supported) result.warnings.push(`Version ${version.version} non vérifiée.`);
      const state = await client.getState();
      result.running = state.running;
      result.boardStatus = state.status || null;
      result.dartsOnBoard = state.numThrows;
      result.throwDataAvailable = state.numThrows > 0 ? !state.missingThrowData : null;
      if (!state.running) result.warnings.push(makeDiagnostic("detection_stopped").message);
      if (state.missingThrowData) result.warnings.push(makeDiagnostic("no_throw_data").message);
    } catch (error) {
      result.diagnostic = classifyError(error);
      return result;
    }
    result.websocket = await new Promise<boolean>((resolve) => {
      const ws = client.openEvents();
      const done = (ok: boolean) => {
        ws.removeAllListeners();
        ws.on("error", () => {});
        ws.terminate();
        resolve(ok);
      };
      ws.once("open", () => done(true));
      ws.once("error", () => done(false));
      ws.once("unexpected-response", () => done(false));
    });
    if (!result.websocket) result.diagnostic = makeDiagnostic("incompatible", "WebSocket /api/events indisponible");
    result.ok = result.websocket;
    return result;
  }
}

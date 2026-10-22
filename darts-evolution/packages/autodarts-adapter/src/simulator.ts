import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { BOARD_ORDER, BULL, dartLabel, parseDart, type Dart } from "@darts-evolution/shared";
import { WebSocketServer, type WebSocket } from "ws";

/**
 * Simulateur du Board Manager Autodarts (protocole local observé en v2.0.2).
 *
 * SIMULATION UNIQUEMENT : il sert aux tests automatisés et au « mode test » de l'application.
 * Il ne remplace en aucun cas un test avec le matériel réel.
 */
export interface SimulatorOptions {
  port?: number;
  host?: string;
  /** 1 = Board Manager classique (1.0.7), 2 = Board Manager 2 (2.0.2). */
  generation?: 1 | 2;
  /** Reproduit les installations v2 signalées sans détail des lancers. */
  omitThrowData?: boolean;
  /** Répond 401 partout (version hypothétique exigeant une authentification). */
  requireAuth?: boolean;
  /** Calibration automatique : acceptée (défaut), refusée (409) ou route absente (404). */
  calibration?: "ok" | "refuse" | "absent";
  /** Caméras déclarées dans la configuration. */
  cameras?: number;
  /** Durée simulée d'une calibration (ms). */
  calibrationMs?: number;
}

interface SimThrow {
  bouncer: boolean;
  coords: { x: number; y: number };
  segment: { bed: string; multiplier: number; name: string; number: number };
}

interface SimState {
  connected: boolean;
  running: boolean;
  event: string;
  status: string;
  numThrows: number;
  throws?: SimThrow[];
}

const RING_RADIUS = { inner: 0.3, triple: 0.6, outer: 0.8, double: 0.97, outside: 1.15 };

function coordsFor(segment: number, ring: keyof typeof RING_RADIUS | "bull" | "outerBull"): { x: number; y: number } {
  if (ring === "bull") return { x: 0.01, y: 0.01 };
  if (ring === "outerBull") return { x: 0.05, y: 0.04 };
  const index = Math.max(0, BOARD_ORDER.indexOf(segment));
  const angle = (index * 18 * Math.PI) / 180; // 20 en haut, sens horaire
  const r = RING_RADIUS[ring];
  return { x: Number((Math.sin(angle) * r).toFixed(4)), y: Number((Math.cos(angle) * r).toFixed(4)) };
}

/** Construit un lancer au format du Board Manager. */
export function simThrow(dart: Dart, options: { bouncer?: boolean; offBoardNumber?: number } = {}): SimThrow {
  if (options.bouncer) {
    return { bouncer: true, coords: { x: 0, y: 0 }, segment: { bed: "Outside", multiplier: 0, name: "Miss", number: 0 } };
  }
  if (dart.multiplier === 0) {
    const n = options.offBoardNumber ?? 17;
    return { bouncer: false, coords: coordsFor(n, "outside"), segment: { bed: "Outside", multiplier: 0, name: `M${n}`, number: n } };
  }
  if (dart.segment === BULL) {
    return dart.multiplier === 2
      ? { bouncer: false, coords: coordsFor(BULL, "bull"), segment: { bed: "Double", multiplier: 2, name: "Bull", number: 25 } }
      : { bouncer: false, coords: coordsFor(BULL, "outerBull"), segment: { bed: "Single", multiplier: 1, name: "25", number: 25 } };
  }
  const bed = dart.multiplier === 3 ? "Triple" : dart.multiplier === 2 ? "Double" : "SingleOuter";
  const ring = dart.multiplier === 3 ? "triple" : dart.multiplier === 2 ? "double" : "outer";
  return { bouncer: false, coords: coordsFor(dart.segment, ring), segment: { bed, multiplier: dart.multiplier, name: dartLabel(dart), number: dart.segment } };
}

export class BoardManagerSimulator {
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly sockets = new Set<WebSocket>();
  private state: SimState = { connected: true, running: true, event: "Started", status: "Throw", numThrows: 0 };
  private lastMessage = "";
  private boundPort = 0;
  readonly commands: string[] = [];

  constructor(private readonly options: SimulatorOptions = {}) {}

  get port(): number {
    return this.boundPort;
  }

  get url(): string {
    return `http://127.0.0.1:${this.boundPort}`;
  }

  get version(): string {
    return (this.options.generation ?? 2) === 1 ? "1.0.7" : "2.0.2";
  }

  get snapshot(): SimState {
    return structuredClone(this.state);
  }

  set omitThrowData(value: boolean) {
    this.options.omitThrowData = value;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => this.handleHttp(req, res));
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      if (req.url !== "/api/events") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      if (this.options.requireAuth) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        this.sockets.add(ws);
        ws.on("close", () => this.sockets.delete(ws));
        ws.on("error", () => this.sockets.delete(ws));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.boundPort || this.options.port || 0, this.options.host ?? "127.0.0.1", () => resolve());
    });
    this.boundPort = (server.address() as AddressInfo).port;
    this.server = server;
    this.wss = wss;
  }

  /** Arrête le service (simule un Board Manager arrêté) ; `start()` le relance sur le même port. */
  async stop(): Promise<void> {
    for (const ws of this.sockets) ws.terminate();
    this.sockets.clear();
    this.wss?.close();
    const server = this.server;
    this.server = null;
    this.wss = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Coupe brutalement les WebSockets ouverts (simule une coupure réseau). */
  dropConnections(): void {
    for (const ws of this.sockets) ws.terminate();
    this.sockets.clear();
  }

  get clientCount(): number {
    return this.sockets.size;
  }

  private publicState(): SimState {
    const s = structuredClone(this.state);
    if (this.options.omitThrowData || !s.throws || s.throws.length === 0) delete s.throws;
    return s;
  }

  private broadcast(adjust?: (state: SimState) => void): void {
    const data = this.publicState();
    adjust?.(data);
    this.lastMessage = JSON.stringify({ type: "state", data });
    for (const ws of this.sockets) ws.send(this.lastMessage);
  }

  /** Renvoie le dernier message (message dupliqué). */
  repeatLastMessage(): void {
    for (const ws of this.sockets) ws.send(this.lastMessage);
  }

  /** Envoie un message brut (tests de messages invalides). */
  sendRaw(text: string): void {
    for (const ws of this.sockets) ws.send(text);
  }

  /**
   * Une fléchette plantée (ou ratée) sur la cible. `lateDetail` : le message WebSocket annonce la
   * fléchette (numThrows) sans son détail, que seul GET /api/state contient (cas à couvrir côté client).
   */
  throwDart(input: Dart | string, options: { bouncer?: boolean; lateDetail?: boolean } = {}): void {
    const dart = typeof input === "string" ? parseDart(input) : input;
    if (!dart) throw new Error(`Fléchette inconnue : ${String(input)}`);
    const throws = [...(this.state.throws ?? []), simThrow(dart, options)];
    this.state = {
      ...this.state,
      event: "Throw detected",
      status: throws.length >= 3 ? "Takeout" : "Throw",
      numThrows: throws.length,
      throws,
    };
    this.broadcast(
      options.lateDetail
        ? (s) => {
            s.throws = s.throws?.slice(0, -1);
            if (!s.throws?.length) delete s.throws;
          }
        : undefined,
    );
  }

  /** La cible corrige elle-même la fléchette n° `slot` (0 = première). */
  correctDart(slot: number, input: Dart | string): void {
    const dart = typeof input === "string" ? parseDart(input) : input;
    if (!dart || !this.state.throws?.[slot]) throw new Error("Correction impossible");
    const throws = [...this.state.throws];
    throws[slot] = simThrow(dart);
    this.state = { ...this.state, event: "Throw detected", throws };
    this.broadcast();
  }

  /** Retrait des fléchettes : « Takeout started » puis « Takeout finished ». */
  takeout(): void {
    this.takeoutStart();
    this.takeoutFinish();
  }

  takeoutStart(): void {
    this.state = { ...this.state, event: "Takeout started", status: "Takeout in progress" };
    this.broadcast();
  }

  takeoutFinish(): void {
    this.state = { ...this.state, event: "Takeout finished", status: "Throw", numThrows: 0, throws: [] };
    this.broadcast();
  }

  manualReset(): void {
    this.state = { ...this.state, event: "Manual reset", status: "Throw", numThrows: 0, throws: [] };
    this.broadcast();
  }

  stopDetection(): void {
    this.state = { ...this.state, running: false, event: "Stopping", status: "Stopping" };
    this.broadcast();
    this.state = { ...this.state, event: "Stopped", status: "Stopped" };
    this.broadcast();
  }

  startDetection(): void {
    this.state = { ...this.state, running: true, event: "Starting", status: "Starting" };
    this.broadcast();
    this.state = { ...this.state, event: "Started", status: "Throw" };
    this.broadcast();
  }

  /** Calibration simulée : état « Calibrating » pendant la durée choisie, réponse à la fin. */
  private calibrate(res: ServerResponse, camera: number | undefined): void {
    if (this.options.calibration === "absent") return this.send(res, 404, { error: "not found" });
    if (this.options.calibration === "refuse") return this.send(res, 409, { error: "busy" });
    this.commands.push(camera === undefined ? "calibrate" : `calibrate:${camera}`);
    const previous = { event: this.state.event, status: this.state.status };
    this.state = { ...this.state, event: "Calibration started", status: "Calibrating" };
    this.broadcast();
    setTimeout(() => {
      this.state = { ...this.state, event: "Calibration finished", status: previous.status };
      this.broadcast();
      this.send(res, 200, {});
    }, this.options.calibrationMs ?? 400);
  }

  private send(res: ServerResponse, status: number, body: unknown, type = "application/json"): void {
    const text = type === "application/json" ? JSON.stringify(body) : String(body);
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(text);
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    if (this.options.requireAuth) return this.send(res, 401, { error: "unauthorized" });
    const key = `${req.method} ${req.url}`;
    switch (key) {
      case "GET /api/state":
        return this.send(res, 200, this.publicState());
      case "GET /api/version":
        return this.send(res, 200, this.version, "text/plain");
      case "HEAD /api/ping":
        res.writeHead(200);
        return void res.end();
      case "GET /api/config":
        return this.send(res, 200, { auth: { board_id: "simulateur-darts-evolution" }, cam: { cams: Array.from({ length: this.options.cameras ?? 0 }, (_, i) => ({ id: i })) } });
      case "POST /api/reset":
        this.commands.push("reset");
        this.manualReset();
        return this.send(res, 200, {});
      case "PUT /api/start":
        this.commands.push("start");
        this.startDetection();
        return this.send(res, 200, {});
      case "PUT /api/stop":
        this.commands.push("stop");
        this.stopDetection();
        return this.send(res, 200, {});
      case "GET /":
        return this.send(res, 200, CONTROL_PAGE, "text/html; charset=utf-8");
    }
    const calibration = req.method === "POST" ? /^\/api\/config\/calibration\/auto(?:\/(\d)\?distortion=true)?$/.exec(req.url ?? "") : null;
    if (calibration) return this.calibrate(res, calibration[1] === undefined ? undefined : Number(calibration[1]));
    if (req.method === "POST" && req.url?.startsWith("/control/")) {
      this.commands.push(req.url);
      const [, , action, arg] = req.url.split("/");
      try {
        if (action === "throw" && arg) this.throwDart(decodeURIComponent(arg));
        else if (action === "takeout") this.takeout();
        else if (action === "reset") this.manualReset();
        else return this.send(res, 404, { error: "action inconnue" });
        return this.send(res, 200, this.publicState());
      } catch (error) {
        return this.send(res, 400, { error: (error as Error).message });
      }
    }
    this.send(res, 404, { error: "not found" });
  }
}

const CONTROL_PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simulateur Board Manager</title><style>
body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:16px}h1{color:#ff6a00;font-size:1.2rem}
.warn{background:#3a2a00;border:1px solid #ff6a00;padding:8px;border-radius:8px}button{margin:3px;padding:10px 12px;border-radius:8px;border:0;background:#2a2a2a;color:#fff;font-size:1rem}
button.o{background:#ff6a00;color:#000}pre{background:#000;padding:8px;border-radius:8px;overflow:auto}</style></head><body>
<h1>Simulateur du Board Manager Autodarts</h1><p class="warn">SIMULATION : aucun matériel réel. Les impacts envoyés ici sont synthétiques.</p>
<div id="b"></div><p><button class="o" onclick="act('takeout')">Retrait des fléchettes</button><button onclick="act('reset')">Reset</button></p><pre id="s"></pre>
<script>
const labels=[];for(let i=20;i>=1;i--){labels.push('T'+i,'D'+i,'S'+i)}labels.push('25','BULL','MISS');
const b=document.getElementById('b');labels.forEach(l=>{const x=document.createElement('button');x.textContent=l;x.onclick=()=>act('throw/'+l);b.appendChild(x)});
async function act(a){const r=await fetch('/control/'+a,{method:'POST'});document.getElementById('s').textContent=JSON.stringify(await r.json(),null,2)}
</script></body></html>`;

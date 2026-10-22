import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import WebSocket from "ws";
import { BoardError, validateHost, validatePort } from "./diagnostics.js";
import { parseBoardState, parseVersion, type BoardSnapshot } from "./protocol.js";

export interface BoardEndpoint {
  host: string;
  port: number;
  protocol: "http" | "https";
}

export function baseUrl(endpoint: BoardEndpoint): string {
  if (!validateHost(endpoint.host)) throw new BoardError("invalid_address", "Adresse invalide");
  if (!validatePort(endpoint.port)) throw new BoardError("invalid_address", "Port invalide");
  const host = endpoint.host.includes(":") && !endpoint.host.startsWith("[") ? `[${endpoint.host}]` : endpoint.host.trim();
  return `${endpoint.protocol}://${host}:${endpoint.port}`;
}

export function eventsUrl(endpoint: BoardEndpoint): string {
  return `${baseUrl(endpoint).replace(/^http/, "ws")}/api/events`;
}

const DEFAULT_TIMEOUT = 5000;
const MAX_BODY = 1024 * 1024;

/** Client HTTP minimal de l'API locale du Board Manager. Ne journalise jamais les réponses brutes. */
export class BoardManagerClient {
  constructor(private readonly endpoint: BoardEndpoint) {}

  get url(): string {
    return baseUrl(this.endpoint);
  }

  /**
   * Requête HTTP brute (node:http plutôt que fetch : aucune liste de ports interdits,
   * taille de réponse bornée, délai maîtrisé).
   */
  private request(method: string, path: string, timeout = DEFAULT_TIMEOUT): Promise<{ status: number; body: string }> {
    const url = new URL(`${this.url}${path}`);
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = send(url, { method, timeout, headers: { accept: "application/json, text/plain" } }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY) {
            req.destroy(new BoardError("incompatible", "Réponse trop volumineuse"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status === 401 || status === 403) return reject(new BoardError("auth_required", "Accès refusé", status));
          if (status === 404 || status === 405) return reject(new BoardError("not_board_manager", "Route absente", status));
          if (status < 200 || status >= 300) return reject(new BoardError("incompatible", "Réponse inattendue", status));
          resolve({ status, body: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", reject);
      });
      req.on("timeout", () => req.destroy(Object.assign(new Error("Délai dépassé"), { code: "ETIMEDOUT" })));
      req.on("error", reject);
      req.end();
    });
  }

  async getState(): Promise<BoardSnapshot> {
    const res = await this.request("GET", "/api/state");
    let body: unknown;
    try {
      body = JSON.parse(res.body);
    } catch {
      throw new BoardError("not_board_manager", "Réponse non JSON");
    }
    const parsed = parseBoardState(body);
    if (!parsed.ok) throw new BoardError("incompatible", parsed.reason);
    return parsed.value;
  }

  async getVersion(): Promise<ReturnType<typeof parseVersion>> {
    try {
      const res = await this.request("GET", "/api/version");
      return parseVersion(res.body.slice(0, 64));
    } catch (error) {
      if (error instanceof BoardError && error.code === "not_board_manager") return null;
      throw error;
    }
  }

  /** Commande explicite, envoyée une seule fois (jamais rejouée automatiquement). */
  async command(name: "reset" | "start" | "stop"): Promise<void> {
    const route = name === "reset" ? ["POST", "/api/reset"] : ["PUT", `/api/${name}`];
    await this.request(route[0] as string, route[1] as string, 10_000);
  }

  /**
   * Calibration automatique des caméras : toutes, ou une seule avec correction de la distorsion.
   * Routes `POST /api/config/calibration/auto[/<caméra>?distortion=true]`, celles qu'utilisent les
   * intégrations ioBroker et Home Assistant d'Autodarts. La réponse arrive à la fin (jusqu'à une minute).
   */
  async calibrate(camera?: number): Promise<void> {
    if (camera !== undefined && (!Number.isInteger(camera) || camera < 0 || camera > 7)) throw new BoardError("incompatible", "Caméra invalide");
    const path = camera === undefined ? "/api/config/calibration/auto" : `/api/config/calibration/auto/${camera}?distortion=true`;
    await this.request("POST", path, 60_000);
  }

  /** Nombre de caméras de la configuration (`cam.cams`), ou null si elle est illisible. */
  async cameraCount(): Promise<number | null> {
    try {
      const res = await this.request("GET", "/api/config");
      const cams = (JSON.parse(res.body) as { cam?: { cams?: unknown } } | null)?.cam?.cams;
      return Array.isArray(cams) ? Math.min(cams.length, 8) : null;
    } catch {
      return null;
    }
  }

  openEvents(): WebSocket {
    return new WebSocket(eventsUrl(this.endpoint), { handshakeTimeout: DEFAULT_TIMEOUT, maxPayload: 1024 * 1024 });
  }
}

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

/** Client HTTP minimal de l'API locale du Board Manager. Ne journalise jamais les réponses brutes. */
export class BoardManagerClient {
  constructor(private readonly endpoint: BoardEndpoint) {}

  get url(): string {
    return baseUrl(this.endpoint);
  }

  private async request(method: string, path: string, timeout = DEFAULT_TIMEOUT): Promise<Response> {
    const res = await fetch(`${this.url}${path}`, { method, signal: AbortSignal.timeout(timeout) });
    if (res.status === 401 || res.status === 403) throw new BoardError("auth_required", "Accès refusé", res.status);
    if (res.status === 404 || res.status === 405) throw new BoardError("not_board_manager", "Route absente", res.status);
    if (!res.ok) throw new BoardError("incompatible", "Réponse inattendue", res.status);
    return res;
  }

  async getState(): Promise<BoardSnapshot> {
    const res = await this.request("GET", "/api/state");
    let body: unknown;
    try {
      body = await res.json();
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
      return parseVersion((await res.text()).slice(0, 64));
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

  openEvents(): WebSocket {
    return new WebSocket(eventsUrl(this.endpoint), { handshakeTimeout: DEFAULT_TIMEOUT, maxPayload: 1024 * 1024 });
  }
}

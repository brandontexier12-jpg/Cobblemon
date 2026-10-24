/**
 * Recherche et vérification du serveur DARTS EVOLUTION (NAS) depuis l'application Windows.
 * Module sans dépendance à Electron : testé avec Vitest.
 */

export const DEFAULT_PORT = 8080;

export interface ServerHealth {
  status: string;
  version: string;
  schemaVersion: number;
}

export interface FoundServer {
  url: string;
  version: string;
}

type Fetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * Adresses à essayer pour une saisie libre : « 192.168.1.50 », « nas.local:8080 »,
 * « http://192.168.1.50:8080/jouer »… Sans port indiqué, le port par défaut du serveur (8080) passe
 * en premier, puis le port standard. Seules les adresses http et https sont acceptées.
 */
export function serverCandidates(input: string): string[] {
  const text = input.trim();
  if (!text) return [];
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return [];
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) return [];
  // Port tapé explicitement (URL efface « :80 » et « :443 », qui restent un choix de l'utilisateur).
  const authority = withScheme.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0]!;
  if (/:\d+$/.test(authority)) return [url.origin];
  const withDefault = new URL(url.origin);
  withDefault.port = String(DEFAULT_PORT);
  return url.protocol === "http:" ? [withDefault.origin, url.origin] : [url.origin, withDefault.origin];
}

export function isDartsHealth(value: unknown): value is ServerHealth {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.status === "string" && typeof v.version === "string" && typeof v.schemaVersion === "number";
}

/** Interroge /api/health ; null si l'adresse ne répond pas ou n'est pas un serveur DARTS EVOLUTION. */
export async function probe(origin: string, fetchImpl: Fetch, timeoutMs = 4000): Promise<ServerHealth | null> {
  try {
    const res = await fetchImpl(`${origin}/api/health`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = await res.json();
    return isDartsHealth(body) ? body : null;
  } catch {
    return null;
  }
}

/** Premier candidat qui répond comme un serveur DARTS EVOLUTION. */
export async function resolveServer(input: string, fetchImpl: Fetch, timeoutMs?: number): Promise<FoundServer | null> {
  for (const origin of serverCandidates(input)) {
    const health = await probe(origin, fetchImpl, timeoutMs);
    if (health) return { url: origin, version: health.version };
  }
  return null;
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

type Interfaces = Record<string, { address: string; family: string | number; internal: boolean }[] | undefined>;

/**
 * Adresses du réseau local à sonder : les 254 adresses du /24 de chaque carte réseau privée
 * (wifi, Ethernet), au plus trois réseaux. Les réseaux plus larges ne sont pas parcourus en entier.
 */
export function localScanHosts(interfaces: Interfaces, maxNetworks = 3): string[] {
  const prefixes: string[] = [];
  for (const list of Object.values(interfaces)) {
    for (const nic of list ?? []) {
      const v4 = nic.family === "IPv4" || nic.family === 4;
      if (!v4 || nic.internal || !isPrivateIPv4(nic.address)) continue;
      const prefix = nic.address.split(".").slice(0, 3).join(".");
      if (!prefixes.includes(prefix)) prefixes.push(prefix);
    }
  }
  return prefixes.slice(0, maxNetworks).flatMap((p) => Array.from({ length: 254 }, (_, i) => `${p}.${i + 1}`));
}

/** Sonde les adresses en parallèle (par lots) et renvoie les serveurs trouvés, triés par adresse. */
export async function scanServers(hosts: string[], fetchImpl: Fetch, options: { port?: number; concurrency?: number; timeoutMs?: number } = {}): Promise<FoundServer[]> {
  const { port = DEFAULT_PORT, concurrency = 64, timeoutMs = 800 } = options;
  const found: FoundServer[] = [];
  let next = 0;
  const worker = async () => {
    while (next < hosts.length) {
      const origin = `http://${hosts[next++]}:${port}`;
      const health = await probe(origin, fetchImpl, timeoutMs);
      if (health) found.push({ url: origin, version: health.version });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  const key = (url: string) => new URL(url).hostname.split(".").map((n) => n.padStart(3, "0")).join(".");
  return found.sort((a, b) => key(a.url).localeCompare(key(b.url)));
}

/** Même origine (protocole, hôte et port) que le serveur configuré. */
export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LightMyRequestResponse } from "fastify";
import { buildApp, type BuildOptions, type BuiltApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

export interface TestApp {
  built: BuiltApp;
  dir: string;
  env: Record<string, string>;
  request(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<LightMyRequestResponse>;
  json<T = any>(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<T>;
  close(): Promise<void>;
}

export async function startTestApp(extraEnv: Record<string, string> = {}, existingDir?: string, options: BuildOptions = {}): Promise<TestApp> {
  const dir = existingDir ?? mkdtempSync(path.join(tmpdir(), "darts-evolution-test-"));
  const env = {
    APP_PORT: "0",
    APP_HOST: "127.0.0.1",
    DATABASE_PATH: path.join(dir, "data", "test.db"),
    BACKUP_PATH: path.join(dir, "backups"),
    WEB_DIST_PATH: path.join(dir, "no-web"),
    LOG_LEVEL: "silent",
    ...extraEnv,
  };
  const built = await buildApp(loadConfig(env), { logger: false, ...options });
  const request = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
    built.app.inject({
      method: method as "GET",
      url,
      headers: body !== undefined && !Buffer.isBuffer(body) ? { "content-type": "application/json", ...headers } : headers,
      payload: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
  return {
    built,
    dir,
    env,
    request,
    async json(method, url, body, headers) {
      const res = await request(method, url, body, headers);
      if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
      return (res.body ? res.json() : undefined) as never;
    },
    async close() {
      await built.close();
    },
  };
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export async function createPlayers(app: TestApp, ...names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) ids.push((await app.json("POST", "/api/players", { name })).id);
  return ids;
}

export const dart = (label: string) => {
  const m = /^([SDT])(\d+)$/.exec(label);
  if (label === "BULL") return { segment: 25, multiplier: 2 };
  if (label === "25") return { segment: 25, multiplier: 1 };
  if (label === "MISS") return { segment: 0, multiplier: 0 };
  if (!m) throw new Error(label);
  return { segment: Number(m[2]), multiplier: { S: 1, D: 2, T: 3 }[m[1] as "S" | "D" | "T"] };
};

export async function throwDarts(app: TestApp, matchId: string, ...labels: string[]) {
  let last: any;
  for (const label of labels) {
    last = await app.json("POST", `/api/matches/${matchId}/commands`, label === "next" ? { kind: "next" } : { kind: "dart", dart: dart(label) });
  }
  return last;
}

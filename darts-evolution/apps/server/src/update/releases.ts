import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Versions installées par le bouton « Mise à jour » : partagé entre le lanceur du conteneur
 * (qui choisit quoi exécuter) et le serveur (qui installe). Les versions installées vivent dans
 * le volume de données (`data/releases/<version>/`), la version intégrée à l'image reste intacte.
 */

/** Code de sortie du serveur qui demande au lanceur de redémarrer (après installation). */
export const RESTART_EXIT_CODE = 75;
/** Version du protocole lanceur ↔ serveur ; un paquet peut exiger un lanceur plus récent. */
export const SUPERVISOR_PROTOCOL = 1;

export interface UpdateResult {
  version: string;
  from: string;
  outcome: "installed" | "rolled_back" | "reverted";
  message: string;
  at: string;
}

export interface ReleaseState {
  /** Version installée à exécuter (null : version intégrée à l'image). */
  active: string | null;
  /** Version à rétablir si la version active échoue (null : version intégrée). */
  previous: string | null;
  /** La version active vient d'être installée et n'a pas encore démarré correctement. */
  pending: boolean;
  /** Arrêts anormaux consécutifs de la version active. */
  failures: number;
  lastResult: UpdateResult | null;
}

export const EMPTY_STATE: ReleaseState = { active: null, previous: null, pending: false, failures: 0, lastResult: null };

const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-([0-9A-Za-z.-]{1,40}))?$/;

export function isVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION.test(value);
}

/** Compare deux versions « x.y.z[-pré] » (une préversion précède la version finale). */
export function compareVersions(a: string, b: string): number {
  const pa = VERSION.exec(a);
  const pb = VERSION.exec(b);
  if (!pa || !pb) return a.localeCompare(b);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return Math.sign(d);
  }
  if (pa[4] === pb[4]) return 0;
  if (!pa[4]) return 1;
  if (!pb[4]) return -1;
  return pa[4].localeCompare(pb[4], "en", { numeric: true });
}

/** Dossier des versions installées (par défaut à côté de la base de données). */
export function releasesPath(env: Record<string, string | undefined>): string {
  if (env.RELEASES_PATH) return path.resolve(env.RELEASES_PATH);
  return path.join(path.dirname(path.resolve(env.DATABASE_PATH ?? "./data/darts-evolution.db")), "releases");
}

export function releaseDir(root: string, version: string): string {
  if (!isVersion(version)) throw new Error(`Version invalide : ${version}`);
  return path.join(root, version);
}

const STATE_FILE = "state.json";

export function readState(root: string): ReleaseState {
  try {
    const raw = JSON.parse(readFileSync(path.join(root, STATE_FILE), "utf8")) as Partial<ReleaseState>;
    return {
      active: isVersion(raw.active) ? raw.active : null,
      previous: isVersion(raw.previous) ? raw.previous : null,
      pending: raw.pending === true,
      failures: Number.isInteger(raw.failures) ? (raw.failures as number) : 0,
      lastResult: raw.lastResult && typeof raw.lastResult === "object" ? (raw.lastResult as UpdateResult) : null,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

/** Écriture atomique (fichier temporaire puis renommage). */
export function writeState(root: string, state: ReleaseState): void {
  mkdirSync(root, { recursive: true });
  const tmp = path.join(root, `${STATE_FILE}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, path.join(root, STATE_FILE));
}

export type RunTarget = { kind: "builtin"; version: string } | { kind: "installed"; version: string; dir: string };

export function serverEntry(dir: string): string {
  return path.join(dir, "server", "server.mjs");
}

/**
 * Choisit la version à exécuter : la version installée seulement si elle est plus récente que
 * celle de l'image (une image reconstruite plus récente l'emporte) et si ses fichiers existent.
 */
export function chooseTarget(
  state: ReleaseState,
  builtinVersion: string,
  root: string,
  exists: (file: string) => boolean = existsSync,
): { target: RunTarget; state: ReleaseState } {
  if (state.active) {
    const dir = releaseDir(root, state.active);
    if (compareVersions(state.active, builtinVersion) > 0 && exists(serverEntry(dir))) {
      return { target: { kind: "installed", version: state.active, dir }, state };
    }
    const reason =
      compareVersions(state.active, builtinVersion) <= 0
        ? `L'image contient déjà la version ${builtinVersion} : la version ${state.active} installée n'est plus utilisée.`
        : `Fichiers de la version ${state.active} introuvables : retour à la version ${builtinVersion}.`;
    return {
      target: { kind: "builtin", version: builtinVersion },
      state: {
        ...EMPTY_STATE,
        lastResult: { version: state.active, from: builtinVersion, outcome: "reverted", message: reason, at: new Date().toISOString() },
      },
    };
  }
  return { target: { kind: "builtin", version: builtinVersion }, state };
}

/** La version active a démarré correctement. */
export function markReady(state: ReleaseState, version: string, fromLabel: string): ReleaseState {
  if (state.pending && state.active === version) {
    return {
      ...state,
      pending: false,
      failures: 0,
      lastResult: { version, from: fromLabel, outcome: "installed", message: `Version ${version} installée et démarrée.`, at: new Date().toISOString() },
    };
  }
  return state.failures === 0 ? state : { ...state, failures: 0 };
}

/** Nombre d'arrêts anormaux consécutifs avant de revenir à la version précédente. */
export const MAX_FAILURES = 3;

/**
 * La version installée active s'est arrêtée anormalement. Une version tout juste installée qui ne
 * démarre pas est abandonnée immédiatement ; une version déjà validée l'est après plusieurs échecs.
 */
export function markFailure(state: ReleaseState, version: string, reason: string, previousLabel: string): { state: ReleaseState; rolledBack: boolean } {
  if (state.active !== version) return { state, rolledBack: false };
  const failures = state.failures + 1;
  if (!state.pending && failures < MAX_FAILURES) return { state: { ...state, failures }, rolledBack: false };
  const why = state.pending ? `n'a pas démarré (${reason})` : `s'est arrêtée ${failures} fois de suite (${reason})`;
  return {
    rolledBack: true,
    state: {
      active: state.previous,
      previous: null,
      pending: false,
      failures: 0,
      lastResult: {
        version,
        from: previousLabel,
        outcome: "rolled_back",
        message: `La version ${version} ${why} : retour automatique à la version ${previousLabel}.`,
        at: new Date().toISOString(),
      },
    },
  };
}

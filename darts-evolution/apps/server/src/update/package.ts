import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ReleaseManifest } from "../services/updates.js";
import { SUPERVISOR_PROTOCOL } from "./releases.js";
import { writeZip } from "./zip.js";

export interface PackageFile {
  name: string;
  data: Buffer;
}

/** Tous les fichiers d'un dossier, chemins relatifs avec « / ». */
export function collectFiles(dir: string, base = ""): PackageFile[] {
  const out: PackageFile[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...collectFiles(full, rel));
    else out.push({ name: rel, data: readFileSync(full) });
  }
  return out;
}

export interface ReleaseInput {
  version: string;
  schemaVersion: number;
  /** Version minimale de Node.js. */
  node: string;
  /** Fichiers du serveur assemblé (server.mjs…), relatifs au dossier `server/`. */
  server: PackageFile[];
  /** Interface construite, relative au dossier `web/`. */
  web: PackageFile[];
  /** Sources du projet (pour la mise à jour manuelle avec le même fichier). */
  sources?: PackageFile[];
  /** Dossier racine dans l'archive. */
  root?: string;
}

/**
 * Paquet de mise à jour : un seul .zip qui sert aux deux procédures. Le dossier `release/`
 * (manifeste + fichiers construits) est installé par le bouton « Mise à jour » ; les sources
 * permettent la reconstruction manuelle de l'image Docker.
 */
export function buildReleaseZip(input: ReleaseInput): { zip: Buffer; manifest: ReleaseManifest } {
  const root = input.root ?? "darts-evolution/";
  const release = [...input.server.map((f) => ({ name: `server/${f.name}`, data: f.data })), ...input.web.map((f) => ({ name: `web/${f.name}`, data: f.data }))];
  const manifest: ReleaseManifest = {
    application: "DARTS EVOLUTION",
    format: 1,
    version: input.version,
    schemaVersion: input.schemaVersion,
    node: input.node,
    supervisorProtocol: SUPERVISOR_PROTOCOL,
    createdAt: new Date().toISOString(),
    files: Object.fromEntries(release.map((f) => [f.name, { sha256: createHash("sha256").update(f.data).digest("hex"), size: f.data.length }])),
  };
  const files: PackageFile[] = [
    ...(input.sources ?? []).filter((f) => !f.name.startsWith("release/")).map((f) => ({ name: root + f.name, data: f.data })),
    { name: `${root}release/manifest.json`, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
    ...release.map((f) => ({ name: `${root}release/${f.name}`, data: f.data })),
  ];
  return { zip: writeZip(files), manifest };
}

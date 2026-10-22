import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { AppError, badRequest, conflict } from "../errors.js";
import { compareVersions, isVersion, readState, releaseDir, writeState, type ReleaseState, type UpdateResult } from "../update/releases.js";
import { listZip, readEntry, ZipError, type ZipEntry } from "../update/zip.js";
import type { BackupService } from "./backups.js";

/** Taille maximale d'un paquet envoyé. */
export const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 160 * 1024 * 1024;

const FILE_PATH = /^(server|web)\/[A-Za-z0-9._@-]+(?:\/[A-Za-z0-9._@-]+)*$/;

export const ReleaseManifest = z.object({
  application: z.literal("DARTS EVOLUTION"),
  format: z.literal(1),
  version: z.string().refine(isVersion, "version invalide"),
  schemaVersion: z.number().int().min(1),
  node: z.string().refine(isVersion, "version de Node invalide"),
  supervisorProtocol: z.number().int().min(1),
  createdAt: z.string(),
  files: z.record(
    z.string().regex(FILE_PATH).refine((p) => !p.split("/").includes(".."), "chemin invalide"),
    z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(0).max(MAX_FILE_BYTES) }),
  ),
});
export type ReleaseManifest = z.infer<typeof ReleaseManifest>;

export interface UpdateStatus {
  version: string;
  builtinVersion: string;
  running: "builtin" | "installed";
  /** Mise à jour possible depuis l'application (conteneur supervisé). */
  supported: boolean;
  /** Un mot de passe administrateur est défini (obligatoire pour installer). */
  adminConfigured: boolean;
  /** Version rétablie par « Revenir à la version précédente » (null : impossible). */
  revertTo: string | null;
  lastResult: UpdateResult | null;
  maxPackageMb: number;
}

export interface InstallResult {
  version: string;
  from: string;
  backup: string;
  restarting: boolean;
}

const updateError = (message: string) => new AppError(422, "update_refused", message);

/**
 * Installation d'une nouvelle version envoyée depuis l'application (fichier .zip produit par
 * `npm run package`). Le paquet est vérifié (manifeste, empreintes SHA-256, tailles, chemins,
 * compatibilité), extrait dans le volume de données, puis le serveur demande au lanceur de
 * redémarrer sur la nouvelle version. Le lanceur revient seul à l'ancienne si elle ne démarre pas.
 */
export class UpdateService {
  private busy = false;
  private restartScheduled = false;

  constructor(
    private readonly config: AppConfig,
    private readonly backups: BackupService,
    private readonly adminConfigured: () => boolean,
    private readonly restart: () => void,
  ) {}

  private get root(): string {
    return this.config.update.releasesPath;
  }

  private state(): ReleaseState {
    return readState(this.root);
  }

  status(): UpdateStatus {
    const u = this.config.update;
    const state = this.state();
    return {
      version: this.config.version,
      builtinVersion: u.builtinVersion,
      running: u.running,
      supported: u.supervised,
      adminConfigured: this.adminConfigured(),
      revertTo: u.supervised && u.running === "installed" ? (state.previous ?? u.builtinVersion) : null,
      lastResult: state.lastResult,
      maxPackageMb: MAX_PACKAGE_BYTES / 1024 / 1024,
    };
  }

  private ensureAllowed(): void {
    if (!this.config.update.supervised) {
      throw conflict(
        "La mise à jour depuis l'application n'est disponible que dans le conteneur Docker de DARTS EVOLUTION (1.2.0 ou plus récent). Faites cette mise à jour une fois manuellement (voir la documentation).",
        "update_unsupported",
      );
    }
    if (!this.adminConfigured()) {
      throw conflict("Définissez d'abord un mot de passe administrateur (ADMIN_PASSWORD dans le fichier .env) : il protège l'installation de mises à jour.", "admin_required");
    }
    if (this.busy || this.restartScheduled) throw conflict("Une mise à jour est déjà en cours.", "update_busy");
  }

  /** Lit et valide le manifeste du paquet (`release/manifest.json`, éventuellement sous un dossier). */
  static readManifest(buf: Buffer): { manifest: ReleaseManifest; prefix: string; entries: Map<string, ZipEntry> } {
    let entries: ZipEntry[];
    try {
      entries = listZip(buf);
    } catch (error) {
      throw badRequest(error instanceof ZipError ? error.message : "Archive illisible.");
    }
    const candidates = entries.filter((e) => /^(?:[^/]+\/)?release\/manifest\.json$/.test(e.name)).sort((a, b) => a.name.length - b.name.length);
    const manifestEntry = candidates[0];
    if (!manifestEntry) {
      throw updateError("Ce fichier n'est pas un paquet de mise à jour DARTS EVOLUTION (dossier « release » introuvable). Utilisez le fichier darts-evolution-X.Y.Z.zip fourni, sans le modifier.");
    }
    const prefix = manifestEntry.name.slice(0, -"manifest.json".length);
    let manifest: ReleaseManifest;
    try {
      manifest = ReleaseManifest.parse(JSON.parse(readEntry(buf, manifestEntry, 2 * 1024 * 1024).toString("utf8")));
    } catch (error) {
      if (error instanceof ZipError) throw badRequest(error.message);
      throw updateError("Manifeste du paquet invalide : fichier modifié ou incompatible.");
    }
    return { manifest, prefix, entries: new Map(entries.map((e) => [e.name, e])) };
  }

  /** Vérifie la compatibilité du paquet avec le conteneur et la version en cours. */
  checkCompatibility(manifest: ReleaseManifest): void {
    const current = this.config.version;
    const order = compareVersions(manifest.version, current);
    if (order === 0) throw updateError(`La version ${manifest.version} est déjà installée.`);
    if (order < 0) throw updateError(`La version ${manifest.version} est plus ancienne que la version installée (${current}) : installation refusée.`);
    if (compareVersions(process.versions.node, manifest.node) < 0) {
      throw updateError(`La version ${manifest.version} nécessite Node.js ${manifest.node} (conteneur : ${process.versions.node}) : reconstruisez l'image avec la procédure manuelle.`);
    }
    if (manifest.supervisorProtocol > this.config.update.supervisorProtocol) {
      throw updateError(`La version ${manifest.version} nécessite un conteneur plus récent : faites cette mise à jour avec la procédure manuelle (reconstruction de l'image).`);
    }
    for (const required of ["server/server.mjs", "web/index.html"]) {
      if (!manifest.files[required]) throw updateError(`Paquet incomplet : ${required} absent.`);
    }
  }

  install(buf: Buffer): InstallResult {
    this.ensureAllowed();
    if (buf.length > MAX_PACKAGE_BYTES) throw new AppError(413, "too_large", "Paquet trop volumineux.");
    this.busy = true;
    let incoming: string | null = null;
    try {
      const { manifest, prefix, entries } = UpdateService.readManifest(buf);
      this.checkCompatibility(manifest);

      mkdirSync(this.root, { recursive: true });
      incoming = path.join(this.root, `.incoming-${manifest.version}-${randomBytes(4).toString("hex")}`);
      mkdirSync(incoming);
      let total = 0;
      for (const [rel, expected] of Object.entries(manifest.files)) {
        const entry = entries.get(prefix + rel);
        if (!entry) throw updateError(`Paquet incomplet : ${rel} absent.`);
        const data = readEntry(buf, entry, MAX_FILE_BYTES);
        total += data.length;
        if (total > MAX_TOTAL_BYTES) throw updateError("Paquet trop volumineux une fois décompressé.");
        if (data.length !== expected.size || createHash("sha256").update(data).digest("hex") !== expected.sha256) {
          throw updateError(`Empreinte incorrecte pour ${rel} : paquet modifié ou endommagé.`);
        }
        const dest = path.resolve(incoming, rel);
        if (!dest.startsWith(incoming + path.sep)) throw updateError(`Chemin refusé : ${rel}`);
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, data);
      }
      writeFileSync(path.join(incoming, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

      // Sauvegarde de la base avant de changer de version (jamais supprimée automatiquement).
      const backup = this.backups.create("pre-mise-a-jour");

      const target = releaseDir(this.root, manifest.version);
      rmSync(target, { recursive: true, force: true });
      renameSync(incoming, target);
      incoming = null;

      const u = this.config.update;
      const previous = u.running === "installed" ? this.config.version : null;
      writeState(this.root, { ...this.state(), active: manifest.version, previous, pending: true, failures: 0 });
      this.cleanup([manifest.version, previous]);
      this.scheduleRestart();
      return { version: manifest.version, from: this.config.version, backup: backup.name, restarting: true };
    } catch (error) {
      if (error instanceof ZipError) throw badRequest(error.message);
      throw error;
    } finally {
      if (incoming) rmSync(incoming, { recursive: true, force: true });
      this.busy = false;
    }
  }

  /** Revient à la version précédente (ou à celle de l'image). */
  revert(): { version: string } {
    this.ensureAllowed();
    const u = this.config.update;
    if (u.running !== "installed") throw badRequest("La version intégrée à l'image est déjà utilisée.");
    const state = this.state();
    const to = state.previous ?? u.builtinVersion;
    writeState(this.root, {
      active: state.previous,
      previous: null,
      pending: false,
      failures: 0,
      lastResult: { version: this.config.version, from: to, outcome: "reverted", message: `Retour manuel de la version ${this.config.version} à la version ${to}.`, at: new Date().toISOString() },
    });
    this.scheduleRestart();
    return { version: to };
  }

  /** Supprime les versions installées qui ne servent plus (seules la nouvelle et la précédente restent). */
  private cleanup(keep: (string | null)[]): void {
    for (const name of readdirSync(this.root)) {
      const stale = (isVersion(name) && !keep.includes(name)) || name.startsWith(".incoming-");
      if (stale) rmSync(path.join(this.root, name), { recursive: true, force: true });
    }
  }

  private scheduleRestart(): void {
    this.restartScheduled = true;
    // Laisse le temps à la réponse HTTP de partir.
    setTimeout(() => this.restart(), 800).unref();
  }
}

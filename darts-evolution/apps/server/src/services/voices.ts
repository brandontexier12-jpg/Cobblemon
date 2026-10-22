import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { badRequest, notFound } from "../errors.js";
import { normalizeAudio, WavError } from "../update/wav.js";
import { listZip, readEntry, ZipError } from "../update/zip.js";

/**
 * Packs de voix de l'annonceur (fichiers audio fournis par l'utilisateur, jamais intégrés au code).
 * Un fichier nommé par un score (`0.wav` … `180.wav`) annonce ce score ; les autres fichiers peuvent
 * être attribués à un rôle (début de partie, leg gagné, match gagné, bust, joueur suivant). Les packs
 * vivent dans le volume de données et survivent aux mises à jour.
 */

export const VOICE_ROLES = ["gameon", "leg", "match", "bust", "next"] as const;
export type VoiceRole = (typeof VOICE_ROLES)[number];

/** Noms de fichiers reconnus d'office pour chaque rôle (conventions des packs courants). */
const ROLE_NAMES: Record<VoiceRole, string[]> = {
  gameon: ["gameon", "game_on", "game-on", "start"],
  leg: ["gameshot", "game_shot", "game-shot", "leg", "legshot"],
  match: ["matchshot", "match_shot", "match-shot", "match"],
  bust: ["bust", "busted", "noscore", "no_score"],
  next: ["next", "nextplayer", "next_player"],
};

export interface VoicePack {
  id: string;
  name: string;
  createdAt: string;
  /** Clé (nom de fichier sans extension) → fichier stocké. */
  files: Record<string, string>;
  roles: Partial<Record<VoiceRole, string>>;
}

export interface VoicePackView extends VoicePack {
  scores: number;
  missingScores: number[];
  others: string[];
}

export interface ImportResult {
  pack: VoicePackView;
  converted: string[];
  skipped: { file: string; reason: string }[];
}

const MAX_FILES = 600;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
export const MAX_VOICE_PACK_BYTES = 120 * 1024 * 1024;
const KEY = /^[a-z0-9_-]{1,40}$/;
const ID = /^[a-z0-9-]{1,60}$/;

/** Scores possibles en une visite de 3 fléchettes (163, 166, 169, 172, 173, 175, 176, 178, 179 ne le sont pas). */
const IMPOSSIBLE = new Set([163, 166, 169, 172, 173, 175, 176, 178, 179]);

export const RolesInput = z.object(Object.fromEntries(VOICE_ROLES.map((r) => [r, z.string().regex(KEY).nullable().optional()])) as Record<VoiceRole, z.ZodOptional<z.ZodNullable<z.ZodString>>>);

export class VoiceService {
  constructor(private readonly root: string) {}

  private dir(id: string): string {
    if (!ID.test(id)) throw notFound("Pack de voix");
    return path.join(this.root, id);
  }

  private read(id: string): VoicePack {
    const file = path.join(this.dir(id), "pack.json");
    if (!existsSync(file)) throw notFound("Pack de voix");
    return JSON.parse(readFileSync(file, "utf8")) as VoicePack;
  }

  private view(pack: VoicePack): VoicePackView {
    const keys = Object.keys(pack.files);
    const numbers = new Set(keys.filter((k) => /^\d{1,3}$/.test(k)).map(Number).filter((n) => n <= 180));
    const missingScores: number[] = [];
    for (let n = 0; n <= 180; n++) if (!IMPOSSIBLE.has(n) && !numbers.has(n)) missingScores.push(n);
    return { ...pack, scores: numbers.size, missingScores, others: keys.filter((k) => !/^\d{1,3}$/.test(k)).sort() };
  }

  list(): VoicePackView[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((d) => ID.test(d) && existsSync(path.join(this.root, d, "pack.json")))
      .map((d) => this.view(this.read(d)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): VoicePackView {
    return this.view(this.read(id));
  }

  /** Fichier audio d'un pack (chemin vérifié) et son type MIME. */
  file(id: string, key: string): { path: string; type: string } {
    const pack = this.read(id);
    const name = pack.files[key];
    if (!name || !KEY.test(key)) throw notFound("Son");
    const full = path.join(this.dir(id), name);
    const ext = path.extname(name).slice(1);
    return { path: full, type: ext === "mp3" ? "audio/mpeg" : ext === "ogg" ? "audio/ogg" : "audio/wav" };
  }

  import(buf: Buffer, rawName: string): ImportResult {
    const name = rawName.trim().slice(0, 60) || "Pack de voix";
    let entries;
    try {
      entries = listZip(buf, 5000);
    } catch (error) {
      throw badRequest(error instanceof ZipError ? error.message : "Archive illisible.");
    }
    const id = `${name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pack"}-${randomBytes(3).toString("hex")}`;
    mkdirSync(this.root, { recursive: true });
    const incoming = path.join(this.root, `.import-${id}`);
    mkdirSync(incoming);
    const files: Record<string, string> = {};
    const converted: string[] = [];
    const skipped: { file: string; reason: string }[] = [];
    let total = 0;
    try {
      for (const entry of entries) {
        if (entry.directory) continue;
        const base = entry.name.split("/").pop()!;
        if (base.startsWith(".") || entry.name.startsWith("__MACOSX/")) continue;
        const match = /^(.+)\.(wav|mp3|ogg)$/i.exec(base);
        if (!match) {
          skipped.push({ file: entry.name, reason: "pas un fichier audio" });
          continue;
        }
        const key = match[1]!.toLowerCase().replace(/\s+/g, "_");
        if (!KEY.test(key)) {
          skipped.push({ file: entry.name, reason: "nom de fichier non pris en charge" });
          continue;
        }
        if (files[key]) {
          skipped.push({ file: entry.name, reason: "doublon" });
          continue;
        }
        if (Object.keys(files).length >= MAX_FILES) {
          skipped.push({ file: entry.name, reason: "trop de fichiers" });
          continue;
        }
        try {
          const raw = readEntry(buf, entry, MAX_FILE_BYTES);
          const audio = normalizeAudio(base, raw);
          total += audio.data.length;
          if (total > MAX_TOTAL_BYTES) throw badRequest("Pack trop volumineux une fois décompressé.");
          const stored = `${key}.${audio.ext}`;
          writeFileSync(path.join(incoming, stored), audio.data);
          files[key] = stored;
          if (audio.converted) converted.push(base);
        } catch (error) {
          if (error instanceof WavError || error instanceof ZipError) skipped.push({ file: entry.name, reason: error.message });
          else throw error;
        }
      }
      if (Object.keys(files).length === 0) throw badRequest("Aucun fichier audio utilisable dans cette archive (WAV, MP3 ou OGG attendus).");
      const roles: Partial<Record<VoiceRole, string>> = {};
      for (const role of VOICE_ROLES) {
        const found = ROLE_NAMES[role].find((n) => files[n]);
        if (found) roles[role] = found;
      }
      const pack: VoicePack = { id, name, createdAt: new Date().toISOString(), files, roles };
      writeFileSync(path.join(incoming, "pack.json"), `${JSON.stringify(pack, null, 2)}\n`);
      renameSync(incoming, this.dir(id));
      return { pack: this.view(pack), converted, skipped };
    } finally {
      rmSync(incoming, { recursive: true, force: true });
    }
  }

  /** Attribue des fichiers du pack aux rôles (null : aucun). */
  setRoles(id: string, input: unknown): VoicePackView {
    const pack = this.read(id);
    const roles = RolesInput.parse(input);
    for (const role of VOICE_ROLES) {
      const key = roles[role];
      if (key === undefined) continue;
      if (key === null) delete pack.roles[role];
      else if (!pack.files[key]) throw badRequest(`Le pack ne contient pas de fichier « ${key} ».`);
      else pack.roles[role] = key;
    }
    writeFileSync(path.join(this.dir(id), "pack.json"), `${JSON.stringify(pack, null, 2)}\n`);
    return this.view(pack);
  }

  delete(id: string): void {
    this.read(id);
    rmSync(this.dir(id), { recursive: true, force: true });
  }
}

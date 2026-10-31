/**
 * Protocole local du Board Manager Autodarts (port 3180 par défaut).
 *
 * ATTENTION : cette interface n'est pas documentée officiellement par Autodarts. Le contrat
 * ci-dessous reprend les observations publiques suivantes (voir docs/autodarts.md) :
 * - Board Manager v2.0.2 observé le 2026-10-18 (projet n4-darts, docs/board-manager-api.md) ;
 * - intégration Home Assistant ha-autodarts (Board Manager 1.x et 2.0.0 à 2.0.2) ;
 * - adaptateur ioBroker.autodarts (signale des installations v2 sans données de lancer).
 *
 * - GET  /api/state     : instantané complet de l'état (même forme que les messages WebSocket).
 * - GET  /api/version   : version en texte brut (ex. « 2.0.2 »).
 * - WS   /api/events    : messages {"type":"state","data":{…}} ; chaque message est un instantané
 *                         complet, pas un delta. D'autres types existent (motion_state, cam_state,
 *                         stats, cam_stats) et sont ignorés.
 * - POST /api/reset     : vide la visite en cours (« Manual reset »).
 * - PUT  /api/start, /api/stop : démarre / arrête la détection.
 * Aucune authentification n'est requise en local (clé API vide dans la configuration observée).
 *
 * Format « à plat » (cible réelle, 2026-10-29, projet DartLab/DartsApp, docs/autodarts-protokoll.md) :
 * après une mise à jour d'Autodarts, chaque lancer arrive avec des champs à plat (`segmentName`,
 * `segmentNumber`, `multiplier`, `bed`, `coordsX`, `coordsY`, plus `failed` et `method`), les
 * événements et statuts en camelCase (`throwDetected`, `takeoutStarted`, `takeoutInProgress`,
 * `takeoutFinished`, `throw`, `takeout`), sans `numThrows`, et `throws: []` quand la cible est vide.
 * Les deux formats sont acceptés : ils sont ramenés à la forme classique dès la lecture.
 */
import { BULL, dartScore, isValidDart, type Dart, type Multiplier } from "@darts-evolution/shared";
import { z } from "zod";

export const DEFAULT_BOARD_PORT = 3180;

const Coords = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .partial()
  .passthrough();

export const SegmentSchema = z
  .object({
    name: z.string().max(32).optional(),
    number: z.number().int(),
    multiplier: z.number().int(),
    bed: z.string().max(32).optional(),
  })
  .passthrough();

export const BoardThrowSchema = z
  .object({
    segment: SegmentSchema,
    coords: Coords.nullable().optional(),
    bouncer: z.boolean().optional(),
  })
  .passthrough();

export const BoardStateSchema = z
  .object({
    connected: z.boolean().optional(),
    running: z.boolean(),
    status: z.string().max(64).optional(),
    event: z.string().max(64).optional(),
    numThrows: z.number().int().min(0).max(30).optional(),
    // Chaque élément est validé individuellement : un lancer illisible n'invalide pas tout l'état.
    throws: z.array(z.unknown()).max(30).nullable().optional(),
  })
  .passthrough();

export type BoardThrow = z.infer<typeof BoardThrowSchema>;
export type RawBoardState = z.infer<typeof BoardStateSchema>;

/** État du Board Manager après validation. `throws[i]` vaut null si le lancer est illisible. */
export interface BoardSnapshot {
  connected: boolean | null;
  running: boolean;
  status: string;
  event: string;
  numThrows: number;
  throws: (BoardThrow | null)[];
  /** Le Board Manager annonce des fléchettes sans en transmettre le détail. */
  missingThrowData: boolean;
}

export const EnvelopeSchema = z.object({ type: z.string().max(64), data: z.unknown() }).passthrough();

export type ParseResult<T> = { ok: true; value: T; invalidThrows: string[] } | { ok: false; reason: string };

/**
 * Lancer au format « à plat » → forme classique `{segment, coords}`. Un lancer déjà classique, ou
 * qui n'a aucun champ de segment, est rendu tel quel (sa validation dira s'il est lisible).
 */
export function unflattenThrow(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const t = raw as Record<string, unknown>;
  if ("segment" in t || !("segmentNumber" in t || "segmentName" in t)) return raw;
  const { segmentName, segmentNumber, multiplier, bed, coordsX, coordsY, ...rest } = t;
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  return {
    ...rest,
    segment: { name: segmentName, number: segmentNumber, multiplier, bed },
    coords: finite(coordsX) && finite(coordsY) ? { x: coordsX, y: coordsY } : undefined,
  };
}

/**
 * Événement ou statut ramené à son libellé classique : « takeoutInProgress » et « takeout_finished »
 * deviennent « Takeout in progress » et « Takeout finished » ; « Throw detected » reste inchangé.
 */
export function boardLabel(raw: string): string {
  if (!raw || /\s/.test(raw)) return raw;
  const words = raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function parseBoardState(raw: unknown): ParseResult<BoardSnapshot> {
  const parsed = BoardStateSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: `État invalide (${issue?.path.join(".") || "racine"} : ${issue?.message ?? "?"})` };
  }
  const s = parsed.data;
  const invalidThrows: string[] = [];
  const throws = (s.throws ?? []).map((t, i) => {
    const r = BoardThrowSchema.safeParse(unflattenThrow(t));
    if (!r.success) {
      invalidThrows.push(`lancer ${i + 1} illisible`);
      return null;
    }
    const dart = normalizeSegment(r.data.segment);
    if (!dart.ok) {
      invalidThrows.push(`lancer ${i + 1} : ${dart.reason}`);
      return null;
    }
    return r.data;
  });
  const numThrows = s.numThrows ?? throws.length;
  return {
    ok: true,
    invalidThrows,
    value: {
      connected: s.connected ?? null,
      running: s.running,
      status: boardLabel(s.status ?? ""),
      event: boardLabel(s.event ?? ""),
      numThrows,
      throws,
      missingThrowData: numThrows > 0 && throws.length === 0,
    },
  };
}

export type NormalizeResult = { ok: true; dart: Dart } | { ok: false; reason: string };

/**
 * Convertit un segment Autodarts en fléchette interne.
 * - Raté : multiplicateur 0 (ex. « M17 » hors cible) ou zone « Outside » ; rebond : « Miss » (0, 0).
 * - Bull extérieur : numéro 25, multiplicateur 1 ; bull intérieur : numéro 25, multiplicateur 2.
 */
export function normalizeSegment(segment: z.infer<typeof SegmentSchema>): NormalizeResult {
  const { number, multiplier } = segment;
  if (!Number.isInteger(number) || !Number.isInteger(multiplier)) return { ok: false, reason: "segment non entier" };
  if (multiplier < 0 || multiplier > 3) return { ok: false, reason: `multiplicateur ${multiplier} hors limites` };
  if (multiplier === 0 || number === 0 || segment.bed === "Outside") {
    if (number < 0 || (number > 20 && number !== BULL)) return { ok: false, reason: `numéro ${number} hors limites` };
    return { ok: true, dart: { segment: 0, multiplier: 0 } };
  }
  // Prudence : certaines sources notent le bull intérieur 50 × 1.
  if (number === 50 && multiplier === 1) return { ok: true, dart: { segment: BULL, multiplier: 2 } };
  const dart = { segment: number, multiplier: multiplier as Multiplier };
  if (!isValidDart(dart)) return { ok: false, reason: `combinaison ${number} × ${multiplier} impossible` };
  return { ok: true, dart };
}

export function throwToDart(t: BoardThrow): Dart {
  const r = normalizeSegment(t.segment);
  return r.ok ? r.dart : { segment: 0, multiplier: 0 };
}

export function throwScore(t: BoardThrow): number {
  return dartScore(throwToDart(t));
}

export const VERSION_PATTERN = /^v?\d{1,4}(?:\.\d{1,6}){0,3}(?:[-+][0-9A-Za-z.-]{1,32})?$/;

export function parseVersion(text: string): { version: string; generation: 1 | 2 | null; supported: boolean } | null {
  const version = text.trim();
  if (!VERSION_PATTERN.test(version)) return null;
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  const generation = major === 1 ? 1 : major === 2 ? 2 : null;
  return { version, generation, supported: generation !== null };
}

/** Statuts du Board Manager indiquant que la détection ne tourne pas normalement. */
export const LIFECYCLE_STATUSES = ["starting", "stopping", "stopped", "calibrating", "error"];

export function isTakeoutStatus(value: string): boolean {
  return value.toLowerCase().includes("takeout");
}

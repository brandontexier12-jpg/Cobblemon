import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Lecture et écriture d'archives ZIP, sans dépendance (zlib de Node).
 * Uniquement ce dont la mise à jour a besoin : méthodes « stockée » et « deflate », pas de ZIP64,
 * pas de chiffrement. La lecture est défensive : tailles plafonnées, CRC vérifié, noms contrôlés.
 */

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

export interface ZipEntry {
  /** Chemin dans l'archive, séparateur « / ». */
  name: string;
  directory: boolean;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Nom d'entrée sûr : relatif, sans « .. », sans caractère de contrôle. */
export function safeEntryName(raw: string): string | null {
  const name = raw.replace(/\\/g, "/");
  if (!name || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  const parts = name.split("/");
  if (parts.some((p, i) => p === ".." || p === "." || (p === "" && i !== parts.length - 1))) return null;
  return name;
}

/** Liste le répertoire central d'une archive. */
export function listZip(buf: Buffer, maxEntries = 5000): ZipEntry[] {
  if (buf.length < 22) throw new ZipError("Ce fichier n'est pas une archive ZIP.");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("Ce fichier n'est pas une archive ZIP (ou elle est incomplète).");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError("Archive ZIP64 non prise en charge.");
  if (count > maxEntries) throw new ZipError(`Archive trop volumineuse (${count} fichiers).`);
  if (cdOffset + cdSize > eocd) throw new ZipError("Archive ZIP endommagée.");

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw new ZipError("Archive ZIP endommagée.");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const rawName = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) throw new ZipError("Archive chiffrée non prise en charge.");
    const name = safeEntryName(rawName);
    if (!name) throw new ZipError(`Nom de fichier refusé dans l'archive : ${rawName.slice(0, 80)}`);
    const directory = name.endsWith("/");
    if (!directory && method !== 0 && method !== 8) throw new ZipError(`Méthode de compression non prise en charge (${name}).`);
    entries.push({ name, directory, method, crc, compressedSize, size, localOffset });
  }
  return entries;
}

/** Décompresse une entrée en vérifiant sa taille et son CRC. */
export function readEntry(buf: Buffer, entry: ZipEntry, maxSize: number): Buffer {
  if (entry.size > maxSize) throw new ZipError(`Fichier trop volumineux dans l'archive : ${entry.name}`);
  const p = entry.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== LOCAL) throw new ZipError("Archive ZIP endommagée.");
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const end = start + entry.compressedSize;
  if (end > buf.length) throw new ZipError("Archive ZIP tronquée.");
  const raw = buf.subarray(start, end);
  let data: Buffer;
  if (entry.method === 0) {
    data = Buffer.from(raw);
  } else {
    try {
      // Plafond strict : une entrée qui ment sur sa taille (bombe de décompression) est refusée.
      data = inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.size) });
    } catch {
      throw new ZipError(`Fichier illisible dans l'archive : ${entry.name}`);
    }
  }
  if (data.length !== entry.size || crc32(data) >>> 0 !== entry.crc >>> 0) throw new ZipError(`Fichier corrompu dans l'archive : ${entry.name}`);
  return data;
}

function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Écrit une archive ZIP (deflate quand c'est plus petit, sinon stockée). */
export function writeZip(files: { name: string; data: Buffer }[], date = new Date()): Buffer {
  const { time, date: day } = dosDateTime(date);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = safeEntryName(file.name);
    if (!name) throw new ZipError(`Nom de fichier invalide : ${file.name}`);
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(file.data, { level: 9 });
    const stored = deflated.length >= file.data.length;
    const body = stored ? file.data : deflated;
    const crc = crc32(file.data) >>> 0;
    if (offset + 30 + nameBuf.length + body.length > 0xffffffff) throw new ZipError("Archive trop volumineuse.");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(0x031e, 4); // Unix, version 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  if (files.length >= 0xffff) throw new ZipError("Trop de fichiers pour une archive ZIP simple.");
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/**
 * Fichiers WAV des packs de voix : vérification de l'en-tête et conversion des formats que les
 * navigateurs ne lisent pas (MS ADPCM) en PCM 16 bits. Sans dépendance.
 */

export class WavError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WavError";
  }
}

interface Chunk {
  id: string;
  start: number;
  size: number;
}

function chunks(buf: Buffer): Chunk[] {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new WavError("pas un fichier WAV");
  const out: Chunk[] = [];
  let p = 12;
  while (p + 8 <= buf.length && out.length < 64) {
    const id = buf.toString("ascii", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const start = p + 8;
    out.push({ id, start, size: Math.min(size, buf.length - start) });
    p = start + size + (size % 2);
  }
  return out;
}

export interface WavInfo {
  format: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
}

export function wavInfo(buf: Buffer): WavInfo {
  const fmt = chunks(buf).find((c) => c.id === "fmt ");
  if (!fmt || fmt.size < 16) throw new WavError("en-tête WAV incomplet");
  const info = {
    format: buf.readUInt16LE(fmt.start),
    channels: buf.readUInt16LE(fmt.start + 2),
    sampleRate: buf.readUInt32LE(fmt.start + 4),
    blockAlign: buf.readUInt16LE(fmt.start + 12),
    bitsPerSample: buf.readUInt16LE(fmt.start + 14),
  };
  if (info.channels < 1 || info.channels > 8 || info.sampleRate < 4000 || info.sampleRate > 192_000) throw new WavError("paramètres audio invalides");
  return info;
}

/** WAV PCM 16 bits à partir d'échantillons entrelacés. */
export function pcm16Wav(samples: Int16Array, channels: number, sampleRate: number): Buffer {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const ADAPTATION = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];
const DEFAULT_COEFS: [number, number][] = [
  [256, 0],
  [512, -256],
  [0, 0],
  [192, 64],
  [240, 0],
  [460, -208],
  [392, -232],
];

const clamp16 = (v: number) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);

/** Décode un WAV Microsoft ADPCM (format 2) en échantillons PCM 16 bits entrelacés. */
export function decodeMsAdpcm(buf: Buffer): { samples: Int16Array; channels: number; sampleRate: number } {
  const all = chunks(buf);
  const fmt = all.find((c) => c.id === "fmt ");
  const data = all.find((c) => c.id === "data");
  if (!fmt || !data) throw new WavError("en-tête WAV incomplet");
  const info = wavInfo(buf);
  const ch = info.channels;
  if (info.format !== 2 || ch > 2 || info.blockAlign < 7 * ch) throw new WavError("ADPCM non pris en charge");
  let samplesPerBlock = ((info.blockAlign - 7 * ch) * 8) / (4 * ch) + 2;
  let coefs = DEFAULT_COEFS;
  if (fmt.size >= 22) {
    samplesPerBlock = buf.readUInt16LE(fmt.start + 18) || samplesPerBlock;
    const numCoef = buf.readUInt16LE(fmt.start + 20);
    if (numCoef >= 7 && fmt.size >= 22 + numCoef * 4) {
      coefs = Array.from({ length: numCoef }, (_, i) => [buf.readInt16LE(fmt.start + 22 + i * 4), buf.readInt16LE(fmt.start + 24 + i * 4)] as [number, number]);
    }
  }
  const fact = all.find((c) => c.id === "fact" && c.size >= 4);
  const blocks = Math.ceil(data.size / info.blockAlign);
  const out = new Int16Array(blocks * samplesPerBlock * ch);
  let o = 0;
  for (let b = 0; b < blocks; b++) {
    let p = data.start + b * info.blockAlign;
    const end = Math.min(p + info.blockAlign, data.start + data.size);
    if (end - p < 7 * ch) break;
    const pred: number[] = [];
    const delta: number[] = [];
    const s1: number[] = [];
    const s2: number[] = [];
    for (let c = 0; c < ch; c++) pred[c] = Math.min(buf[p++]!, coefs.length - 1);
    for (let c = 0; c < ch; c++, p += 2) delta[c] = buf.readInt16LE(p);
    for (let c = 0; c < ch; c++, p += 2) s1[c] = buf.readInt16LE(p);
    for (let c = 0; c < ch; c++, p += 2) s2[c] = buf.readInt16LE(p);
    for (let c = 0; c < ch; c++) out[o++] = s2[c]!;
    for (let c = 0; c < ch; c++) out[o++] = s1[c]!;
    let c = 0;
    const step = (nibble: number) => {
      const [c1, c2] = coefs[pred[c]!]!;
      const signed = nibble >= 8 ? nibble - 16 : nibble;
      const predictor = clamp16(Math.trunc((s1[c]! * c1 + s2[c]! * c2) / 256) + signed * delta[c]!);
      s2[c] = s1[c]!;
      s1[c] = predictor;
      delta[c] = Math.max(16, Math.trunc((ADAPTATION[nibble]! * delta[c]!) / 256));
      out[o++] = predictor;
      c = (c + 1) % ch;
    };
    for (let n = 2; n < samplesPerBlock && p < end; n += ch === 1 ? 2 : 1, p++) {
      step(buf[p]! >> 4);
      step(buf[p]! & 0x0f);
    }
  }
  const total = fact ? Math.min(o / ch, buf.readUInt32LE(fact.start)) * ch : o;
  return { samples: out.slice(0, total), channels: ch, sampleRate: info.sampleRate };
}

/**
 * Prépare un fichier audio de pack pour les navigateurs : WAV PCM / flottant conservé tel quel,
 * MS ADPCM converti en PCM 16 bits, autres WAV refusés. MP3 et OGG sont conservés.
 */
export function normalizeAudio(name: string, data: Buffer): { data: Buffer; ext: "wav" | "mp3" | "ogg"; converted: boolean } {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "mp3") {
    if (!(data.subarray(0, 3).toString("ascii") === "ID3" || (data[0] === 0xff && (data[1]! & 0xe0) === 0xe0))) throw new WavError("pas un fichier MP3");
    return { data, ext: "mp3", converted: false };
  }
  if (ext === "ogg") {
    if (data.subarray(0, 4).toString("ascii") !== "OggS") throw new WavError("pas un fichier OGG");
    return { data, ext: "ogg", converted: false };
  }
  const info = wavInfo(data);
  if (info.format === 1 || info.format === 3 || info.format === 0xfffe) return { data, ext: "wav", converted: false };
  if (info.format === 2) {
    const { samples, channels, sampleRate } = decodeMsAdpcm(data);
    return { data: pcm16Wav(samples, channels, sampleRate), ext: "wav", converted: true };
  }
  throw new WavError(`format audio WAV non pris en charge (${info.format})`);
}

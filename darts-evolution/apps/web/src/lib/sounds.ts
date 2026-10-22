/**
 * Sons de partie, entièrement synthétisés dans le navigateur (Web Audio) : aucun fichier audio,
 * aucun accès Internet. L'annonceur utilise la synthèse vocale de l'appareil (voix française si
 * elle est installée).
 *
 * Les navigateurs n'autorisent le son qu'après une interaction (toucher, clic, touche) : le premier
 * geste sur la page « déverrouille » l'audio.
 */

type Listener = (unlocked: boolean) => void;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let unlocked = false;
let volume = 0.8;
const listeners = new Set<Listener>();

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = volume;
  const compressor = ctx.createDynamicsCompressor();
  master.connect(compressor).connect(ctx.destination);
  // Bruit blanc réutilisé pour les impacts.
  noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

function setUnlocked(value: boolean): void {
  if (unlocked === value) return;
  unlocked = value;
  for (const l of listeners) l(value);
}

export function isAudioUnlocked(): boolean {
  return unlocked;
}

export function onAudioUnlockChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** À appeler depuis un geste de l'utilisateur. */
export function unlockAudio(): void {
  const c = audio();
  if (c && c.state !== "running") void c.resume().then(() => setUnlocked(c.state === "running"), () => {});
  else if (c) setUnlocked(true);
  // iOS : la synthèse vocale doit aussi être amorcée pendant un geste.
  if ("speechSynthesis" in window && !primed) {
    primed = true;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }
}
let primed = false;

if (typeof window !== "undefined") {
  const once = () => unlockAudio();
  window.addEventListener("pointerdown", once, { capture: true });
  window.addEventListener("keydown", once, { capture: true });
}

// --- Briques sonores -------------------------------------------------------------------------

interface ToneOptions {
  type?: OscillatorType;
  from: number;
  to?: number;
  start?: number;
  duration: number;
  volume?: number;
  attack?: number;
}

function tone(c: AudioContext, o: ToneOptions): void {
  const t0 = c.currentTime + (o.start ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.from, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.duration);
  const v = o.volume ?? 0.3;
  const attack = o.attack ?? 0.005;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(v, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.duration);
  osc.connect(gain).connect(master!);
  osc.start(t0);
  osc.stop(t0 + o.duration + 0.05);
}

function burst(c: AudioContext, o: { start?: number; duration: number; frequency: number; q?: number; volume?: number }): void {
  if (!noise) return;
  const t0 = c.currentTime + (o.start ?? 0);
  const src = c.createBufferSource();
  src.buffer = noise;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = o.frequency;
  filter.Q.value = o.q ?? 1.2;
  const gain = c.createGain();
  gain.gain.setValueAtTime(o.volume ?? 0.6, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.duration);
  src.connect(filter).connect(gain).connect(master!);
  src.start(t0);
  src.stop(t0 + o.duration + 0.02);
}

/** Le « tchac » d'une fléchette qui se plante dans le sisal. */
function thud(c: AudioContext, volume = 1): void {
  burst(c, { duration: 0.07, frequency: 2600, q: 0.9, volume: 0.55 * volume });
  tone(c, { from: 190, to: 70, duration: 0.12, volume: 0.45 * volume });
}

function ready(): AudioContext | null {
  const c = audio();
  if (!c || c.state !== "running" || !master) return null;
  return c;
}

// --- Sons de partie --------------------------------------------------------------------------

export type HitKind = "single" | "double" | "triple" | "bull" | "outerBull" | "miss";

export function hitKind(dart: { segment: number; multiplier: number }): HitKind {
  if (dart.multiplier === 0) return "miss";
  if (dart.segment === 25) return dart.multiplier === 2 ? "bull" : "outerBull";
  return dart.multiplier === 3 ? "triple" : dart.multiplier === 2 ? "double" : "single";
}

export function playHit(kind: HitKind): void {
  const c = ready();
  if (!c) return;
  switch (kind) {
    case "miss":
      // Sourd et descendant : la fléchette a manqué la cible.
      burst(c, { duration: 0.12, frequency: 500, q: 0.7, volume: 0.5 });
      tone(c, { type: "triangle", from: 260, to: 110, duration: 0.28, volume: 0.25 });
      return;
    case "single":
      thud(c);
      tone(c, { from: 880, duration: 0.09, start: 0.02, volume: 0.07 });
      return;
    case "double":
      thud(c);
      tone(c, { type: "triangle", from: 988, duration: 0.14, start: 0.03, volume: 0.18 });
      tone(c, { type: "triangle", from: 1319, duration: 0.2, start: 0.11, volume: 0.18 });
      return;
    case "triple":
      thud(c);
      [784, 1047, 1568].forEach((f, i) => tone(c, { type: "square", from: f, duration: 0.12, start: 0.03 + i * 0.065, volume: 0.07 }));
      tone(c, { from: 2093, duration: 0.3, start: 0.22, volume: 0.1 });
      return;
    case "outerBull":
      thud(c);
      tone(c, { from: 1175, duration: 0.35, start: 0.03, volume: 0.16 });
      return;
    case "bull":
      thud(c);
      [1047, 1568, 2093].forEach((f) => tone(c, { from: f, duration: 0.7, start: 0.03, volume: 0.1 }));
      tone(c, { type: "triangle", from: 523, duration: 0.6, start: 0.03, volume: 0.12 });
      return;
  }
}

/** Carillon de changement de joueur. */
export function playTurnChange(): void {
  const c = ready();
  if (!c) return;
  tone(c, { from: 659, duration: 0.22, volume: 0.2, attack: 0.01 });
  tone(c, { from: 988, duration: 0.4, start: 0.14, volume: 0.2, attack: 0.01 });
}

export function playBust(): void {
  const c = ready();
  if (!c) return;
  tone(c, { type: "sawtooth", from: 220, to: 92, duration: 0.55, volume: 0.16 });
  tone(c, { type: "square", from: 110, to: 55, duration: 0.55, volume: 0.08 });
}

/** Grand score (≥ 100) ; `max` pour 180. */
export function playBigScore(max = false): void {
  const c = ready();
  if (!c) return;
  const notes = max ? [523, 659, 784, 1047, 1319, 1568] : [523, 659, 784, 1047];
  notes.forEach((f, i) => tone(c, { type: "triangle", from: f, duration: 0.25, start: i * 0.08, volume: 0.15 }));
}

/** Leg gagné (`match` : fin de partie). */
export function playCheckout(match = false): void {
  const c = ready();
  if (!c) return;
  const melody = match ? [523, 659, 784, 1047, 784, 1047, 1319] : [659, 784, 1047, 1319];
  melody.forEach((f, i) => tone(c, { type: "square", from: f, duration: 0.2, start: i * 0.11, volume: 0.08 }));
  tone(c, { type: "triangle", from: melody[melody.length - 1]!, duration: 0.9, start: melody.length * 0.11, volume: 0.16 });
}

// --- Annonceur -------------------------------------------------------------------------------

let voice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const french = voices.filter((v) => v.lang?.toLowerCase().startsWith("fr"));
  // Voix locale (hors ligne) de préférence, français de France d'abord.
  voice =
    french.find((v) => v.localService && v.lang.toLowerCase() === "fr-fr") ??
    french.find((v) => v.localService) ??
    french.find((v) => v.lang.toLowerCase() === "fr-fr") ??
    french[0] ??
    null;
  return voice;
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  pickVoice();
  window.speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

export function speechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Annonce vocale ; `interrupt` coupe l'annonce en cours (ex. nouveau joueur). */
export function speak(text: string, options: { interrupt?: boolean; rate?: number; pitch?: number } = {}): void {
  if (!speechAvailable() || !text) return;
  const synth = window.speechSynthesis;
  if (options.interrupt) synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice?.lang ?? "fr-FR";
  if (voice ?? pickVoice()) u.voice = voice;
  u.volume = volume;
  u.rate = options.rate ?? 1.05;
  u.pitch = options.pitch ?? 1;
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (speechAvailable()) window.speechSynthesis.cancel();
}

/** Volume général des effets et de l'annonceur (0 à 1). */
export function setVolume(value: number): void {
  volume = Math.min(1, Math.max(0, value));
  if (master) master.gain.value = volume;
}

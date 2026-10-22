import { useEffect, useRef, useState } from "react";
import { dartSpeech, gameCues, type GameCue } from "./game-cues";
import {
  announce,
  hitKind,
  isAudioUnlocked,
  onAudioUnlockChange,
  playBigScore,
  playBust,
  playCheckout,
  playHit,
  playTurnChange,
  preloadVoices,
  setVolume,
  type Announcement,
} from "./sounds";
import type { MatchSnapshot } from "./types";

export interface SoundSettings {
  effects: boolean;
  /** off : muet ; scores : scores, sorties et joueur suivant ; darts : en plus, chaque fléchette. */
  announcer: "off" | "scores" | "darts";
  volume: number;
  /** Pack de voix importé utilisé par l'annonceur (null : voix de l'appareil). */
  voicePack?: string | null;
  /** Avec un pack de voix : annoncer aussi le joueur suivant avec la voix de l'appareil. */
  nameCalls?: boolean;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = { effects: true, announcer: "scores", volume: 0.8, voicePack: null, nameCalls: true };

/** Pack de voix tel que renvoyé par /api/voices. */
export interface VoicePackInfo {
  id: string;
  name: string;
  files: Record<string, string>;
  roles: Partial<Record<"gameon" | "leg" | "match" | "bust" | "next", string>>;
  scores: number;
  missingScores: number[];
  others: string[];
}

export function voiceUrl(packId: string, key: string): string {
  return `/api/voices/${encodeURIComponent(packId)}/files/${encodeURIComponent(key)}`;
}

const HIT_GAP = 120;

function scoreWords(points: number): string {
  if (points === 180) return "Cent quatre-vingts !";
  if (points === 0) return "Pas de score";
  return String(points);
}

/** Choisit pour chaque annonce le son du pack, ou la voix de l'appareil quand le pack n'en a pas. */
class Voice {
  constructor(private readonly pack: VoicePackInfo | null) {}

  private key(key: string | undefined): Announcement | null {
    return this.pack && key && this.pack.files[key] ? { url: voiceUrl(this.pack.id, key) } : null;
  }

  get usesPack(): boolean {
    return !!this.pack;
  }

  score(points: number): Announcement {
    return this.key(String(points)) ?? (points === 180 ? { text: scoreWords(points), rate: 0.85, pitch: 1.15 } : { text: scoreWords(points) });
  }

  role(role: keyof VoicePackInfo["roles"]): Announcement | null {
    return this.key(this.pack?.roles[role]);
  }
}

function playCues(cues: GameCue[], s: SoundSettings, pack: VoicePackInfo | null): void {
  const voiceOn = s.announcer !== "off";
  const v = new Voice(pack);
  const say = (a: Announcement | null) => {
    if (voiceOn && a) announce(a);
  };
  let delay = 0;
  for (const cue of cues) {
    const at = delay;
    const later = (fn: () => void) => (at === 0 ? fn() : window.setTimeout(fn, at));
    switch (cue.kind) {
      case "hit":
        later(() => {
          if (s.effects) playHit(hitKind(cue));
          if (s.announcer === "darts") say(v.usesPack ? v.score(cue.segment * cue.multiplier) : { text: dartSpeech(cue) });
        });
        delay += HIT_GAP;
        break;
      case "visit":
        delay += 250;
        window.setTimeout(() => {
          if (cue.bust) {
            if (s.effects) playBust();
            // Un annonceur dit « No score » sur un bust : rôle dédié du pack, sinon son « 0 ».
            say(v.role("bust") ?? (v.usesPack ? v.score(0) : { text: "Bust !" }));
          } else if (cue.announce) {
            if (s.effects && cue.points >= 100) playBigScore(cue.points === 180);
            say(v.score(cue.points));
          }
        }, delay);
        break;
      case "leg":
        delay += 250;
        window.setTimeout(() => {
          if (s.effects) playCheckout(false);
          if (v.usesPack) say(v.role("leg") ?? v.score(cue.points));
          else say({ text: `Checkout ${cue.points} ! Leg pour ${cue.playerName}.` });
        }, delay);
        break;
      case "win":
        delay += 250;
        window.setTimeout(() => {
          if (s.effects) playCheckout(true);
          const who = cue.winnerNames.length === 1 ? `Victoire de ${cue.winnerNames[0]} !` : cue.winnerNames.length > 1 ? "Égalité !" : "Séance terminée.";
          if (v.usesPack) {
            say(v.role("match") ?? v.role("leg") ?? (cue.points ? v.score(cue.points) : null));
            if (s.nameCalls !== false) say({ text: who });
          } else {
            say({ text: cue.points ? `Checkout ${cue.points} ! ${who}` : who });
          }
        }, delay);
        break;
      case "turn":
        window.setTimeout(() => {
          if (s.effects) playTurnChange();
          if (cue.newLeg) say(v.role("gameon"));
          say(v.role("next"));
          if (v.usesPack && s.nameCalls === false) return;
          if (cue.remaining !== null) say({ text: `${cue.playerName}, il vous reste ${cue.remaining}.` });
          else if (!cue.solo) say({ text: `À ${cue.playerName} de jouer.` }); // seul : le carillon suffit
        }, delay);
        break;
    }
  }
}

/** Joue les sons correspondant à chaque nouvel état de la partie affichée. */
export function useGameSounds(snapshot: MatchSnapshot | null, settings: SoundSettings, pack: VoicePackInfo | null = null): void {
  const prevRef = useRef<MatchSnapshot | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const packRef = useRef(pack);
  packRef.current = pack;

  useEffect(() => setVolume(settings.volume), [settings.volume]);

  // Précharge les sons les plus courants du pack choisi.
  useEffect(() => {
    if (!pack) return;
    const keys = [...Object.values(pack.roles), "0", "26", "41", "45", "60", "81", "85", "100", "140", "180"].filter((k): k is string => !!k && !!pack.files[k]);
    preloadVoices(keys.map((k) => voiceUrl(pack.id, k)));
  }, [pack]);

  useEffect(() => {
    if (!snapshot) return;
    const prev = prevRef.current;
    if (prev && prev.match.id === snapshot.match.id && snapshot.match.version <= prev.match.version) return;
    prevRef.current = snapshot;
    const s = settingsRef.current;
    if (!s.effects && s.announcer === "off") return;
    // Début de partie : « Game on ! » si le pack en contient un.
    if (!prev && snapshot.match.version === 0 && snapshot.match.status === "active" && s.announcer !== "off") {
      const p = packRef.current;
      const key = p?.roles.gameon;
      if (p && key && p.files[key]) announce({ url: voiceUrl(p.id, key) });
    }
    playCues(gameCues(prev, snapshot), s, packRef.current);
  }, [snapshot]);
}

/** Le navigateur a-t-il autorisé le son (après un premier geste) ? */
export function useAudioUnlocked(): boolean {
  const [unlocked, setUnlocked] = useState(isAudioUnlocked);
  useEffect(() => onAudioUnlockChange(setUnlocked), []);
  return unlocked;
}

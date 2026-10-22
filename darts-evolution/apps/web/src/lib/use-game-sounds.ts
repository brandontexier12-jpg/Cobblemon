import { useEffect, useRef, useState } from "react";
import { dartSpeech, gameCues, type GameCue } from "./game-cues";
import {
  hitKind,
  isAudioUnlocked,
  onAudioUnlockChange,
  playBigScore,
  playBust,
  playCheckout,
  playHit,
  playTurnChange,
  setVolume,
  speak,
} from "./sounds";
import type { MatchSnapshot } from "./types";

export interface SoundSettings {
  effects: boolean;
  /** off : muet ; scores : scores, sorties et joueur suivant ; darts : en plus, chaque fléchette. */
  announcer: "off" | "scores" | "darts";
  volume: number;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = { effects: true, announcer: "scores", volume: 0.8 };

const HIT_GAP = 120;

function scoreWords(points: number): string {
  if (points === 180) return "Cent quatre-vingts !";
  if (points === 0) return "Pas de score";
  return String(points);
}

function playCues(cues: GameCue[], s: SoundSettings): void {
  const voice = s.announcer !== "off";
  let delay = 0;
  for (const cue of cues) {
    const at = delay;
    const later = (fn: () => void) => (at === 0 ? fn() : window.setTimeout(fn, at));
    switch (cue.kind) {
      case "hit":
        later(() => {
          if (s.effects) playHit(hitKind(cue));
          if (s.announcer === "darts") speak(dartSpeech(cue));
        });
        delay += HIT_GAP;
        break;
      case "visit":
        delay += 250;
        window.setTimeout(() => {
          if (cue.bust) {
            if (s.effects) playBust();
            if (voice) speak("Bust !");
          } else if (cue.announce) {
            if (s.effects && cue.points >= 100) playBigScore(cue.points === 180);
            if (voice) speak(scoreWords(cue.points), cue.points === 180 ? { rate: 0.85, pitch: 1.15 } : {});
          }
        }, delay);
        break;
      case "leg":
        delay += 250;
        window.setTimeout(() => {
          if (s.effects) playCheckout(false);
          if (voice) speak(`Checkout ${cue.points} ! Leg pour ${cue.playerName}.`);
        }, delay);
        break;
      case "win":
        delay += 250;
        window.setTimeout(() => {
          if (s.effects) playCheckout(true);
          if (!voice) return;
          const who = cue.winnerNames.length === 1 ? `Victoire de ${cue.winnerNames[0]} !` : cue.winnerNames.length > 1 ? "Égalité !" : "Séance terminée.";
          speak(cue.points ? `Checkout ${cue.points} ! ${who}` : who);
        }, delay);
        break;
      case "turn":
        window.setTimeout(() => {
          if (s.effects) playTurnChange();
          if (!voice) return;
          if (cue.remaining !== null) speak(`${cue.playerName}, il vous reste ${cue.remaining}.`);
          else if (!cue.solo) speak(`À ${cue.playerName} de jouer.`); // seul : le carillon suffit
        }, delay);
        break;
    }
  }
}

/** Joue les sons correspondant à chaque nouvel état de la partie affichée. */
export function useGameSounds(snapshot: MatchSnapshot | null, settings: SoundSettings): void {
  const prevRef = useRef<MatchSnapshot | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => setVolume(settings.volume), [settings.volume]);

  useEffect(() => {
    if (!snapshot) return;
    const prev = prevRef.current;
    if (prev && prev.match.id === snapshot.match.id && snapshot.match.version <= prev.match.version) return;
    prevRef.current = snapshot;
    const s = settingsRef.current;
    if (!s.effects && s.announcer === "off") return;
    playCues(gameCues(prev, snapshot), s);
  }, [snapshot]);
}

/** Le navigateur a-t-il autorisé le son (après un premier geste) ? */
export function useAudioUnlocked(): boolean {
  const [unlocked, setUnlocked] = useState(isAudioUnlocked);
  useEffect(() => onAudioUnlockChange(setUnlocked), []);
  return unlocked;
}

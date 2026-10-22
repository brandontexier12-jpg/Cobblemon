import type { GameModeId, MatchSnapshot } from "./types";

/**
 * Événements sonores déduits de deux états successifs d'une partie (fonction pure, testée).
 * Une annulation ou une correction ne déclenche aucun son.
 */
export type GameCue =
  | { kind: "hit"; segment: number; multiplier: number }
  | { kind: "visit"; points: number; bust: boolean; playerName: string; announce: boolean }
  | { kind: "leg"; points: number; playerName: string }
  | { kind: "win"; points: number; winnerNames: string[] }
  | { kind: "turn"; playerName: string; remaining: number | null; solo: boolean; newLeg: boolean };

/** Modes où le score de chaque visite est annoncé. */
const SCORE_MODES: GameModeId[] = ["x01", "count_up", "high_score"];

interface Frame {
  matchId: string;
  version: number;
  turnKey: string;
  darts: { eventId?: string; segment: number; multiplier: number; padded?: boolean }[];
  complete: boolean;
  visitCount: number;
  progress: number;
  finished: boolean;
}

function frameOf(s: MatchSnapshot): Frame {
  const { view, match } = s;
  const last = view.recentVisits[view.recentVisits.length - 1];
  const visitCount = last ? last.index + 1 : 0;
  const current = view.current;
  return {
    matchId: match.id,
    version: match.version,
    turnKey: `${current.playerIndex}:${current.round}:${visitCount - (current.complete ? 1 : 0)}`,
    darts: current.darts,
    complete: current.complete,
    visitCount,
    // Mesure qui augmente à chaque fléchette et diminue à chaque annulation.
    progress: visitCount * 3 + (current.complete ? 0 : current.darts.length),
    finished: view.finished,
  };
}

export function gameCues(prevSnapshot: MatchSnapshot | null, nextSnapshot: MatchSnapshot): GameCue[] {
  if (!prevSnapshot) return [];
  const prev = frameOf(prevSnapshot);
  const next = frameOf(nextSnapshot);
  if (prev.matchId !== next.matchId || next.version <= prev.version) return [];
  if (next.progress < prev.progress) return [];

  const { view, match } = nextSnapshot;
  const nameOf = (id: string | null | undefined) => match.players.find((p) => p.id === id)?.name ?? "";
  const turnChanged = prev.turnKey !== next.turnKey;
  // Passage au joueur suivant (retrait des fléchettes, « Joueur suivant ») : nouvelle visite encore vide.
  const advanced = turnChanged && next.darts.length === 0;
  if (next.progress === prev.progress && !advanced) return [];

  const cues: GameCue[] = [];
  let fresh = next.darts;
  if (!turnChanged) {
    const prefixKept = prev.darts.every((d, i) => next.darts[i]?.eventId === d.eventId);
    if (!prefixKept || next.darts.length < prev.darts.length) return [];
    fresh = next.darts.slice(prev.darts.length);
  }
  for (const d of fresh) {
    if (!d.padded) cues.push({ kind: "hit", segment: d.segment, multiplier: d.multiplier });
  }

  // Une visite s'est terminée pendant cette mise à jour (3 fléchettes, bust, sortie, « Joueur suivant »).
  const visit = view.recentVisits[view.recentVisits.length - 1];
  if (visit && next.visitCount > prev.visitCount) {
    const playerName = nameOf(visit.playerId);
    if (next.finished && !prev.finished) {
      cues.push({ kind: "win", points: visit.checkout ? visit.points : 0, winnerNames: view.winners.map(nameOf).filter(Boolean) });
    } else if (visit.endReason === "checkout") {
      cues.push({ kind: "leg", points: visit.points, playerName });
    } else {
      cues.push({ kind: "visit", points: visit.points, bust: visit.bust, playerName, announce: SCORE_MODES.includes(view.mode) });
    }
  }

  if (advanced && !next.finished) {
    const remaining = view.checkout && view.checkout.routes.length > 0 ? view.checkout.remaining : null;
    cues.push({
      kind: "turn",
      playerName: nameOf(view.current.playerId),
      remaining,
      solo: match.players.length === 1,
      // Nouveau leg : la dernière visite enregistrée est la sortie du leg précédent.
      newLeg: visit?.endReason === "checkout",
    });
  }
  return cues;
}

/** Texte prononcé pour une fléchette. */
export function dartSpeech(d: { segment: number; multiplier: number }): string {
  if (d.multiplier === 0) return "Raté";
  if (d.segment === 25) return d.multiplier === 2 ? "Bull" : "25";
  if (d.multiplier === 3) return `Triple ${d.segment}`;
  if (d.multiplier === 2) return `Double ${d.segment}`;
  return String(d.segment);
}

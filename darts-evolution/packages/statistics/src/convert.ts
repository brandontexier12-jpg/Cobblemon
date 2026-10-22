import { getModeDefinition, type GameState, type InOutRule, type VisitRecord } from "@darts-evolution/game-engine";
import type { StatVisit } from "./types.js";

/** Règle de sortie d'une configuration X01 ou d'entraînement checkout, si elle existe. */
export function outRuleOf(config: unknown): InOutRule | null {
  if (config && typeof config === "object" && "outRule" in config) {
    const value = (config as { outRule: unknown }).outRule;
    if (value === "single" || value === "double" || value === "master") return value;
  }
  return null;
}

/** Convertit une visite du moteur en visite statistique. */
export function toStatVisit(
  visit: VisitRecord,
  meta: { matchId: string; mode: GameState["mode"]; playedAt: string; outRule: InOutRule | null },
): StatVisit {
  return {
    matchId: meta.matchId,
    mode: meta.mode,
    category: getModeDefinition(meta.mode).category,
    playedAt: meta.playedAt,
    playerId: visit.playerId,
    leg: visit.leg,
    set: visit.set,
    round: visit.round,
    points: visit.points,
    bust: visit.bust,
    checkout: visit.checkout,
    checkoutChance: visit.checkoutChance ?? false,
    firstOfLeg: visit.firstOfLeg ?? false,
    remainingBefore: visit.remainingBefore ?? null,
    darts: visit.darts.map((d) => ({
      segment: d.segment,
      multiplier: d.multiplier,
      points: d.points,
      ...(d.hit !== undefined ? { hit: d.hit } : {}),
      ...(d.checkoutAttempt ? { checkoutAttempt: true } : {}),
      ...(d.padded ? { padded: true } : {}),
    })),
    hits: visit.hits ?? null,
    attempts: visit.attempts ?? null,
    marks: visit.marks ?? null,
    outRule: meta.outRule,
  };
}

export function statVisitsFromState(state: GameState, matchId: string, playedAt: (index: number) => string): StatVisit[] {
  const outRule = outRuleOf(state.config);
  return state.visits.map((v) => toStatVisit(v, { matchId, mode: state.mode, playedAt: playedAt(v.index), outRule }));
}

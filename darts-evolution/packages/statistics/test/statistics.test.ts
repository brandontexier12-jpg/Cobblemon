import { applyEvent, createGame, prepareConfig, type GameEvent, type GameModeId, type GameState, type PlayerRef } from "@darts-evolution/game-engine";
import { parseDart } from "@darts-evolution/shared";
import { describe, expect, it } from "vitest";
import {
  activityCalendar,
  comparePeriods,
  computeProgress,
  goalProgress,
  personalRecords,
  progressionSeries,
  resultsSummary,
  statVisitsFromState,
  trainingSummary,
  x01Summary,
  type StatMatch,
} from "../src/index.js";

const A: PlayerRef = { id: "a", name: "A" };
const B: PlayerRef = { id: "b", name: "B" };

function game(mode: GameModeId, options: unknown, players: PlayerRef[], labels: string[]): GameState {
  let s = createGame(mode, prepareConfig(mode, options, players, 1), players);
  for (const l of labels) {
    const ev: GameEvent = l === "next" ? { type: "next" } : { type: "dart", dart: parseDart(l)! };
    s = applyEvent(s, ev);
  }
  return s;
}

const day = (d: number) => `2026-03-${String(d).padStart(2, "0")}T12:00:00.000Z`;

describe("statistiques X01", () => {
  // 101 double sortie : 60+20+1 = 81 (reste 20), puis S20 = bust (0 sans double), puis D10.
  const s = game("x01", { startScore: 101 }, [A], ["T20", "S20", "S1", "S20", "D10"]);
  const visits = statVisitsFromState(s, "m1", () => day(1));

  it("distingue moyenne par fléchette, moyenne 3 fléchettes et moyenne par visite", () => {
    const x = x01Summary(visits);
    // Visite 1 : 81 pts en 3 fl. ; visite 2 : bust en 1 fl. ; visite 3 : 20 pts en 1 fl.
    expect(x.visits).toBe(3);
    expect(x.points).toBe(101);
    expect(x.darts).toBe(5);
    expect(x.pointsPerDart).toBeCloseTo(101 / 5, 2);
    expect(x.average3).toBeCloseTo(60.6, 2);
    expect(x.visitAverage).toBeCloseTo(101 / 3, 2);
    expect(x.busts).toBe(1);
  });

  it("calcule checkout, doubles et première visite", () => {
    const x = x01Summary(visits);
    expect(x.firstVisitAverage).toBe(81);
    expect(x.checkouts).toBe(1);
    expect(x.bestCheckout).toBe(20);
    // Fléchettes lancées sur 20 restant (D10 possible) : S20 puis D10 → 2 tentatives, 1 réussite.
    expect(x.doubleAttempts).toBe(2);
    expect(x.doubleHits).toBe(1);
    expect(x.doubleRate).toBe(0.5);
    // Trois visites commencées sur un score terminable (101, 20, 20), une réussie.
    expect(x.checkoutChances).toBe(3);
    expect(x.checkoutRate).toBeCloseTo(1 / 3, 3);
    expect(x.legsWon).toBe(1);
    expect(x.averageDartsPerLegWon).toBe(5);
  });

  it("classe 180, 140+ et 100+ sans recouvrement", () => {
    const g = game("x01", { startScore: 1001 }, [A], ["T20", "T20", "T20", "T20", "T20", "S20", "T20", "S20", "S20", "S1", "S1", "S1"]);
    const x = x01Summary(statVisitsFromState(g, "m2", () => day(2)));
    expect(x.count180).toBe(1);
    expect(x.count140).toBe(1);
    expect(x.count100).toBe(1);
    expect(x.bestVisit).toBe(180);
  });
});

describe("résultats et séries", () => {
  const matches: StatMatch[] = [1, 2, 3, 4, 5].map((i) => ({
    matchId: `m${i}`,
    mode: "x01",
    category: "game",
    status: "finished",
    playedAt: day(i),
    finishedAt: day(i),
    playerId: "a",
    playerIds: ["a", "b"],
    winnerIds: i === 3 ? ["b"] : ["a"],
  }));

  it("compte victoires, défaites et séries", () => {
    const r = resultsSummary([...matches, { ...matches[0]!, matchId: "solo", playerIds: ["a"] }]);
    expect(r).toMatchObject({ matches: 5, wins: 4, losses: 1, currentStreak: 2, bestStreak: 2 });
    expect(r.winRate).toBe(0.8);
  });

  it("produit la progression, le calendrier et la comparaison de périodes", () => {
    const g1 = game("x01", { startScore: 501 }, [A], ["T20", "T20", "T20"]);
    const g2 = game("x01", { startScore: 501 }, [A], ["S20", "S20", "S20"]);
    const visits = [...statVisitsFromState(g1, "g1", () => day(1)), ...statVisitsFromState(g2, "g2", () => day(10))];
    const days = progressionSeries(visits, "day");
    expect(days.map((p) => p.average3)).toEqual([180, 60]);
    expect(progressionSeries(visits, "month")).toHaveLength(1);
    expect(activityCalendar(visits)).toHaveLength(2);
    const cmp = comparePeriods(visits, { from: day(1), to: day(5) }, { from: day(6), to: day(20) });
    expect(cmp.delta.average3).toBe(-120);
  });
});

describe("entraînements, records et progression", () => {
  it("calcule les taux de réussite par type d'entraînement", () => {
    const d = game("doubles_training", { segments: [20], dartsPerTarget: 4 }, [A], ["D20", "S20", "D20", "MISS"]);
    const b = game("bull_training", { rounds: 1 }, [A], ["BULL", "25", "S1"]);
    const c = game("checkout_training", { selection: "list", values: [40, 32] }, [A], ["D20", "S1", "S1", "S1"]);
    const visits = [
      ...statVisitsFromState(d, "d", () => day(1)),
      ...statVisitsFromState(b, "b", () => day(2)),
      ...statVisitsFromState(c, "c", () => day(3)),
    ];
    const t = trainingSummary(visits);
    expect(t.doubles).toEqual({ darts: 4, hits: 2, rate: 0.5 });
    expect(t.bull).toMatchObject({ darts: 3, hits: 2, inner: 1 });
    expect(t.checkout).toEqual({ attempts: 2, successes: 1, rate: 0.5 });
    expect(t.sessions).toBe(3);
  });

  it("calcule records, badges et niveau à partir des actions réelles", () => {
    const g = game("x01", { startScore: 301 }, [A, B], ["T20", "T20", "T20", "S1", "next", "T20", "T17", "D5"]);
    const visits = statVisitsFromState(g, "g", () => day(4)).filter((v) => v.playerId === "a");
    const matches: StatMatch[] = [{ matchId: "g", mode: "x01", category: "game", status: "finished", playedAt: day(4), finishedAt: day(4), playerId: "a", playerIds: ["a", "b"], winnerIds: g.winners }];
    expect(g.winners).toEqual(["a"]);
    const records = personalRecords(visits, matches);
    expect(records.find((r) => r.id === "best_visit")?.value).toBe(180);
    expect(records.find((r) => r.id === "best_checkout")?.value).toBe(121);
    const progress = computeProgress(visits, matches);
    expect(progress.badges.map((b) => b.id)).toEqual(expect.arrayContaining(["max", "ton", "ton40", "checkout100", "first_match"]));
    // 6 fléchettes + 1 leg (25) + 1 victoire (50) + 1 partie (20) + 5 badges (500)
    expect(progress.xp).toBe(6 + 25 + 50 + 20 + progress.badges.length * 100);
    expect(progress.level).toBeGreaterThan(1);
  });

  it("mesure la progression d'un objectif hebdomadaire", () => {
    const g = game("x01", { startScore: 501 }, [A], ["T20", "T20", "T20"]);
    const visits = statVisitsFromState(g, "g", () => day(1));
    expect(goalProgress("darts", 6, visits, [])).toMatchObject({ value: 3, achieved: false, completion: 0.5 });
    expect(goalProgress("average3", 100, visits, [])).toMatchObject({ value: 180, achieved: true, completion: 1 });
  });
});

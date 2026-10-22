import { describe, expect, it } from "vitest";
import { EVENTS, eventDef } from "../src/career/catalogue.js";
import {
  advance,
  bracketOrder,
  createCareer,
  HUMAN,
  humanRank,
  moneyOf,
  pendingMatchFormat,
  pendingRoundLabel,
  ranking,
  scaleFormat,
  TOUR_CARDS,
  type CareerSettings,
  type CareerState,
} from "../src/career/engine.js";
import { Rng } from "../src/career/rng.js";
import { simulateMatch } from "../src/career/sim.js";

const SETTINGS: CareerSettings = { difficulty: "pro", outRule: "double", matchLength: "raccourcie", light: false, start: "qschool" };

function newCareer(settings: Partial<CareerSettings> = {}, seed = 7): CareerState {
  return createCareer(seed, { ...SETTINGS, ...settings }, { name: "Alice", country: "FRA", rating: 60 }, 2027);
}

/** Joue le match en attente : victoire ou défaite nette. */
function play(state: CareerState, won: boolean): CareerState {
  const p = state.pending;
  if (p?.kind !== "match") throw new Error(`pas de match en attente (${p?.kind})`);
  const f = pendingMatchFormat(state)!.format;
  const target = f.sets && f.sets > 1 ? f.sets : f.legs;
  p.result = { won, me: won ? target : 0, opp: won ? 0 : target };
  return advance(state);
}

/** Avance jusqu'à la fin de saison en perdant (ou gagnant) tous les matchs. */
function playSeason(state: CareerState, win: (s: CareerState) => boolean): CareerState {
  for (let guard = 0; guard < 2000 && state.pending?.kind !== "season"; guard++) {
    if (state.pending?.kind === "match") play(state, win(state));
    else advance(state);
  }
  return state;
}

describe("mode carrière : création", () => {
  it("crée un circuit de joueurs fictifs nommés, aux niveaux de la difficulté choisie", () => {
    const s = newCareer();
    const bots = s.players.filter((p) => !p.human);
    expect(bots.filter((p) => p.card)).toHaveLength(TOUR_CARDS);
    expect(bots.filter((p) => !p.card).length).toBeGreaterThanOrEqual(128);
    expect(new Set(s.players.map((p) => p.name.toLowerCase())).size).toBe(s.players.length);
    expect(bots.every((p) => p.name.includes(" ") && p.nickname.length > 0 && p.country.length === 3)).toBe(true);
    for (const real of ["Luke Littler", "Michael van Gerwen", "Phil Taylor", "Luke Humphries"]) expect(s.players.some((p) => p.name === real)).toBe(false);
    const card = bots.filter((p) => p.card).map((p) => p.rating);
    expect(Math.max(...card)).toBeGreaterThan(102);
    expect(Math.min(...card)).toBeLessThan(88);
    const easy = newCareer({ difficulty: "debutant" }).players.filter((p) => p.card && !p.human).map((p) => p.rating);
    expect(Math.max(...easy)).toBeLessThan(84);
    // Order of Merit dès le départ (gains de la saison précédente), joueur non classé.
    expect(ranking(s, "pdc")[0]!.money).toBeGreaterThan(1_000_000);
    expect(humanRank(s)).toBeNull();
    // Avec une Tour Card d'emblée, le joueur part lui aussi de zéro.
    expect(humanRank(newCareer({ start: "tourcard" }))).toBeNull();
  });

  it("la même graine donne exactement la même carrière", () => {
    const a = playSeason(newCareer({ light: true }), () => false);
    const b = playSeason(newCareer({ light: true }), () => false);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("calendrier : tournois réels dans l'ordre de la saison, du Q-School au championnat du monde", () => {
    const s = newCareer();
    expect(s.calendar[0]).toBe("qschool");
    expect(s.calendar[s.calendar.length - 1]).toBe("worlds");
    const names = s.calendar.map((id) => eventDef(id).name);
    for (const n of ["UK Open", "World Matchplay", "World Grand Prix", "Grand Slam of Darts", "Players Championship Finals", "European Championship", "Premier League Darts", "World Masters"]) {
      expect(names).toContain(n);
    }
    const months = s.calendar.map((id) => eventDef(id).month);
    expect([...months].sort((x, y) => x - y)).toEqual(months);
    expect(newCareer({ light: true }).calendar.length).toBeLessThan(s.calendar.length);
    expect(EVENTS.every((e) => e.prize.length > 0 && e.rounds.length > 0)).toBe(true);
  });
});

describe("mode carrière : tableaux et formats", () => {
  it("les deux premières têtes de série ne peuvent se rencontrer qu'en finale", () => {
    const order = bracketOrder(64);
    expect(new Set(order).size).toBe(64);
    expect(order.indexOf(1) < 32).toBe(true);
    expect(order.indexOf(2) >= 32).toBe(true);
    // Premier tour : la tête de série n°1 affronte le n°64.
    expect([order[0], order[1]]).toEqual([1, 64]);
  });

  it("longueur des matchs : réelle, raccourcie, courte", () => {
    expect(scaleFormat({ legs: 18 }, "reelle")).toEqual({ legs: 18 });
    expect(scaleFormat({ legs: 18 }, "raccourcie")).toEqual({ legs: 9 });
    expect(scaleFormat({ legs: 6 }, "courte")).toEqual({ legs: 2 });
    expect(scaleFormat({ legs: 3, sets: 7 }, "raccourcie")).toEqual({ legs: 2, sets: 4 });
    expect(scaleFormat({ legs: 3, sets: 3 }, "courte")).toEqual({ legs: 2 });
  });

  it("simulation : le score respecte le format et le meilleur gagne plus souvent", () => {
    const rng = new Rng(1);
    let strongWins = 0;
    for (let i = 0; i < 400; i++) {
      const r = simulateMatch(rng, 100, 85, { legs: 6 }, "double");
      expect(Math.max(r.scoreA, r.scoreB)).toBe(6);
      expect(Math.min(r.scoreA, r.scoreB)).toBeLessThan(6);
      if (r.winner === "a") strongWins++;
    }
    expect(strongWins / 400).toBeGreaterThan(0.75);
    expect(strongWins / 400).toBeLessThan(0.99);
    const sets = simulateMatch(rng, 90, 90, { legs: 3, sets: 4 }, "double");
    expect(Math.max(sets.scoreA, sets.scoreB)).toBe(4);
    expect(sets.legsA + sets.legsB).toBeGreaterThanOrEqual(12);
  });
});

describe("mode carrière : déroulement", () => {
  it("commence à la Q-School : premier match à jouer, au format raccourci", () => {
    const s = advance(newCareer());
    expect(s.pending).toMatchObject({ kind: "match", matchId: null, result: null });
    expect(s.run?.eventId).toBe("qschool");
    expect(pendingMatchFormat(s)).toEqual({ format: { legs: 3 }, doubleIn: false });
    expect(pendingRoundLabel(s)).toBe("64es de finale");
    const opp = s.players.find((p) => s.pending?.kind === "match" && p.id === s.pending.opponent)!;
    expect(opp.card).toBe(false);
  });

  it("une défaite termine le tournoi pour le joueur : résultat, puis tournois simulés jusqu'au suivant", () => {
    const s = advance(newCareer());
    play(s, false);
    expect(s.pending).toEqual({ kind: "event", key: "2027-qschool" });
    const result = s.history[s.history.length - 1]!;
    expect(result.human).toMatchObject({ label: "64e de finale", prize: 0, card: false });
    expect(result.winner).not.toBe(HUMAN);
    advance(s);
    // Sans Tour Card : les World Series se jouent sans lui (simulées), le tournoi suivant est le Dutch Open (WDF).
    expect(s.history.slice(s.feedFrom).map((h) => h.eventId)).toEqual(["bahrain", "dutchmasters", "masters", "premier", "belgian", "pc1"]);
    expect(s.run?.eventId).toBe("dutchopen");
    expect(s.pending?.kind).toBe("match");
  });

  it("Q-School gagnée : Tour Card, puis accès au Pro Tour et à l'European Tour", () => {
    const s = advance(newCareer({ difficulty: "debutant" }));
    while (s.run?.eventId === "qschool" && s.pending?.kind === "match") play(s, true);
    expect(s.history[0]!.human).toMatchObject({ label: "Vainqueur", card: true });
    expect(s.players.find((p) => p.id === HUMAN)).toMatchObject({ card: true, cardUntil: 2028, titles: 1 });
    advance(s);
    // Avec la carte : Belgian Darts Open (qualifié) est le prochain tournoi joué.
    expect(s.run?.eventId).toBe("belgian");
  });

  it("une saison complète : gains, classements, Tour Cards et saison suivante", () => {
    const s = advance(newCareer({ start: "tourcard", light: true }));
    // Le joueur gagne tous ses matchs.
    playSeason(s, () => true);
    expect(s.pending).toEqual({ kind: "season", season: 2027 });
    const won = s.history.filter((h) => h.winner === HUMAN).map((h) => h.eventId);
    expect(won).toContain("worlds");
    expect(won).toContain("matchplay");
    expect(moneyOf(s, HUMAN, "pdc")).toBeGreaterThan(1_500_000);
    expect(humanRank(s)).toBe(1);
    // Invité aux tournois sur invitation une fois en tête (Grand Slam, World Series…).
    expect(s.history.some((h) => h.eventId === "grandslam" && h.human)).toBe(true);
    advance(s);
    expect(s.season).toBe(2028);
    expect(s.seasons[0]).toMatchObject({ season: 2027, humanRank: 1 });
    expect(s.seasons[0]!.humanTitles).toContain("World Darts Championship");
    const holders = s.players.filter((p) => p.card && !p.retired).length;
    expect(holders).toBeGreaterThan(90);
    expect(holders).toBeLessThanOrEqual(TOUR_CARDS + 6);
    // Saison 2028 : le Q-School recomplète le circuit (le joueur, qui a sa carte, n'y joue pas).
    expect(s.history.filter((h) => h.season === 2028).some((h) => h.eventId === "qschool")).toBe(true);
    expect(s.players.filter((p) => p.card && !p.retired).length).toBeGreaterThanOrEqual(TOUR_CARDS);
  });

  it("le joueur qui perd tout perd sa Tour Card en fin de deuxième saison", () => {
    const s = advance(newCareer({ start: "tourcard", light: true }));
    playSeason(s, () => false);
    advance(s);
    expect(s.players.find((p) => p.id === HUMAN)!.card).toBe(true); // carte valable deux saisons
    playSeason(s, () => false);
    advance(s);
    expect(s.seasons[1]!.notes.join(" ")).toContain("Tour Card perdue");
    expect(s.players.find((p) => p.id === HUMAN)!.card).toBe(false);
    // Saison 2029 : retour à la Q-School.
    expect(s.run?.eventId).toBe("qschool");
  });

  it("Grand Slam : phase de poules jouée journée par journée, puis tableau final", () => {
    const s = advance(newCareer({ start: "tourcard", light: true }));
    playSeason(s, (st) => st.run?.eventId !== "grandslam" || st.run.phase === "groups");
    const gs = s.history.find((h) => h.eventId === "grandslam")!;
    expect(gs.human?.label).toBe("Huitième de finale");
    expect(gs.human?.prize).toBe(12_500);
  });
});

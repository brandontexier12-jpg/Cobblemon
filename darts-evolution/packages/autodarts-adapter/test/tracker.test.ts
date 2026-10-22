import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ScoringEvent } from "@darts-evolution/shared";
import { describe, expect, it } from "vitest";
import { EnvelopeSchema, normalizeSegment, parseBoardState, parseVersion, type BoardSnapshot } from "../src/protocol.js";
import { simThrow } from "../src/simulator.js";
import { BoardTracker } from "../src/tracker.js";

function fixture(name: string): { messages: unknown[] } {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"));
}

function snapshot(data: unknown): BoardSnapshot {
  const r = parseBoardState(data);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

/** Rejoue un flux de messages WebSocket dans un tracker, comme le fournisseur le fait. */
function replayFixture(name: string, tracker = newTracker()): ScoringEvent[] {
  const events: ScoringEvent[] = [];
  tracker.baseline(snapshot({ connected: true, running: true, event: "Started", status: "Throw", numThrows: 0 }));
  for (const message of fixture(name).messages) {
    const env = EnvelopeSchema.parse(message);
    if (env.type !== "state") continue;
    events.push(...tracker.live(snapshot(env.data)));
  }
  return events;
}

function newTracker() {
  return new BoardTracker({ source: "autodarts", simulated: false, sessionId: "test" });
}

const throws = (events: ScoringEvent[]) => events.flatMap((e) => (e.kind === "throw" ? [e.throw] : []));
const kinds = (events: ScoringEvent[]) => events.map((e) => e.kind);

const base = { connected: true, running: true, status: "Throw" };
const state = (darts: string[], extra: Record<string, unknown> = {}) => ({
  ...base,
  event: "Throw detected",
  numThrows: darts.length,
  ...(darts.length ? { throws: darts.map((d) => simThrow(parseDartLabel(d))) } : {}),
  ...extra,
});

function parseDartLabel(label: string) {
  const map: Record<string, { segment: number; multiplier: 0 | 1 | 2 | 3 }> = {
    MISS: { segment: 0, multiplier: 0 },
    BULL: { segment: 25, multiplier: 2 },
    "25": { segment: 25, multiplier: 1 },
  };
  if (map[label]) return map[label]!;
  const m = /^([SDT])(\d+)$/.exec(label)!;
  return { segment: Number(m[2]), multiplier: ({ S: 1, D: 2, T: 3 } as const)[m[1] as "S" | "D" | "T"] };
}

describe("normalisation des segments Autodarts", () => {
  it("convertit simple, double, triple, bull et raté", () => {
    expect(normalizeSegment({ number: 20, multiplier: 1, bed: "SingleInner" })).toEqual({ ok: true, dart: { segment: 20, multiplier: 1 } });
    expect(normalizeSegment({ number: 16, multiplier: 2, bed: "Double" })).toEqual({ ok: true, dart: { segment: 16, multiplier: 2 } });
    expect(normalizeSegment({ number: 19, multiplier: 3, bed: "Triple" })).toEqual({ ok: true, dart: { segment: 19, multiplier: 3 } });
    expect(normalizeSegment({ number: 25, multiplier: 1, name: "25" })).toEqual({ ok: true, dart: { segment: 25, multiplier: 1 } });
    expect(normalizeSegment({ number: 25, multiplier: 2, name: "Bull" })).toEqual({ ok: true, dart: { segment: 25, multiplier: 2 } });
    expect(normalizeSegment({ number: 17, multiplier: 0, name: "M17", bed: "Outside" })).toEqual({ ok: true, dart: { segment: 0, multiplier: 0 } });
    expect(normalizeSegment({ number: 0, multiplier: 0, name: "Miss" })).toEqual({ ok: true, dart: { segment: 0, multiplier: 0 } });
  });

  it("rejette les combinaisons impossibles", () => {
    expect(normalizeSegment({ number: 25, multiplier: 3 }).ok).toBe(false);
    expect(normalizeSegment({ number: 21, multiplier: 1 }).ok).toBe(false);
    expect(normalizeSegment({ number: 5, multiplier: 4 }).ok).toBe(false);
  });

  it("lit les versions", () => {
    expect(parseVersion("2.0.2")).toEqual({ version: "2.0.2", generation: 2, supported: true });
    expect(parseVersion("1.0.7\n")).toMatchObject({ generation: 1, supported: true });
    expect(parseVersion("3.1.0")).toMatchObject({ generation: null, supported: false });
    expect(parseVersion("<html>")).toBeNull();
  });
});

describe("suivi des instantanés (flux de référence)", () => {
  it("visite complète Board Manager 2.0.2 : 3 impacts puis un retrait", () => {
    const events = replayFixture("bm-2.0.2-visit.json");
    expect(throws(events).map((t) => t.dart)).toEqual([
      { segment: 20, multiplier: 3 },
      { segment: 20, multiplier: 1 },
      { segment: 0, multiplier: 0 },
    ]);
    expect(throws(events).map((t) => t.segmentName)).toEqual(["T20", "S20", "M17"]);
    expect(throws(events)[1]?.bed).toBe("SingleInner");
    expect(kinds(events)).toEqual(["throw", "throw", "throw", "takeout-started", "takeout-finished"]);
    // Le retrait n'est jamais transformé en impact.
    expect(throws(events)).toHaveLength(3);
  });

  it("Board Manager 1.x : même protocole", () => {
    const events = replayFixture("bm-1.x-visit.json");
    expect(throws(events).map((t) => t.score)).toEqual([40, 57, 5]);
    expect(kinds(events).filter((k) => k === "takeout-finished")).toHaveLength(1);
  });

  it("bull, rebond et retrait anticipé", () => {
    const events = replayFixture("bm-bull-bouncer-early-takeout.json");
    const t = throws(events);
    expect(t.map((x) => x.score)).toEqual([50, 32, 0, 25]);
    expect(t[2]?.bouncer).toBe(true);
    const takeout = events.find((e) => e.kind === "takeout-finished");
    expect(takeout).toMatchObject({ dartsOnBoard: 2, boardVisit: 0 });
    // Les fléchettes de la visite suivante portent un nouveau numéro de visite et de nouveaux identifiants.
    expect(t[2]?.boardVisit).toBe(1);
    expect(new Set(t.map((x) => x.eventId)).size).toBe(4);
  });
});

describe("déduplication, corrections, resets et reconnexions", () => {
  it("ignore un message dupliqué", () => {
    const tracker = newTracker();
    tracker.baseline(snapshot(state([])));
    expect(throws(tracker.live(snapshot(state(["T20"]))))).toHaveLength(1);
    expect(tracker.live(snapshot(state(["T20"])))).toEqual([]);
    expect(throws(tracker.live(snapshot(state(["T20", "S1"]))))).toHaveLength(1);
  });

  it("ne compte pas les fléchettes déjà présentes à la connexion", () => {
    const tracker = newTracker();
    expect(tracker.baseline(snapshot(state(["T20", "T20"])))).toEqual([]);
    expect(tracker.baselineDarts).toBe(2);
    const events = tracker.live(snapshot(state(["T20", "T20", "T20"])));
    expect(throws(events)).toHaveLength(1);
    expect(throws(events)[0]?.slot).toBe(2);
  });

  it("signale une correction faite par la cible", () => {
    const tracker = newTracker();
    tracker.baseline(snapshot(state([])));
    tracker.live(snapshot(state(["S20"])));
    const events = tracker.live(snapshot(state(["T20"])));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "throw-corrected", previous: { segment: 20, multiplier: 1 }, throw: { slot: 0, score: 60 } });
  });

  it("distingue un reset demandé par l'application d'un reset manuel", () => {
    const tracker = newTracker();
    tracker.baseline(snapshot(state(["T20"])));
    tracker.expectOwnReset();
    const own = tracker.live(snapshot({ ...base, event: "Manual reset", numThrows: 0 }));
    expect(own).toEqual([expect.objectContaining({ kind: "reset", own: true })]);
    tracker.live(snapshot(state(["S5"])));
    const manual = tracker.live(snapshot({ ...base, event: "Manual reset", numThrows: 0 }));
    expect(manual).toEqual([expect.objectContaining({ kind: "reset", own: false })]);
  });

  it("après reconnexion, ne signale que les fléchettes nouvelles", () => {
    const tracker = newTracker();
    tracker.baseline(snapshot(state([])));
    tracker.live(snapshot(state(["T20"])));
    // Coupure ; pendant ce temps deux fléchettes sont lancées.
    const events = tracker.resync(snapshot(state(["T20", "T19", "S1"])));
    expect(throws(events).map((t) => t.slot)).toEqual([1, 2]);
    expect(kinds(events)).not.toContain("gap");
  });

  it("après reconnexion, signale une visite potentiellement perdue sans l'inventer", () => {
    const tracker = newTracker();
    tracker.baseline(snapshot(state([])));
    tracker.live(snapshot(state(["T20", "T20"])));
    const events = tracker.resync(snapshot(state(["S5"])));
    expect(kinds(events)).toEqual(["takeout-finished", "gap", "throw"]);
    expect(throws(events)[0]).toMatchObject({ slot: 0, score: 5, boardVisit: 1 });
  });

  it("la réconciliation HTTP n'ajoute que des fléchettes manquantes et ne vide jamais la cible", () => {
    const tracker = newTracker();
    tracker.baseline(snapshot(state([])));
    tracker.live(snapshot(state(["T20", "S20"])));
    expect(tracker.reconcile(snapshot(state(["T20"])))).toEqual([]);
    expect(tracker.reconcile(snapshot(state([])))).toEqual([]);
    expect(throws(tracker.reconcile(snapshot(state(["T20", "S20", "D10"]))))).toHaveLength(1);
    // Le message WebSocket arrivé ensuite ne recompte pas la fléchette.
    expect(tracker.live(snapshot(state(["T20", "S20", "D10"])))).toEqual([]);
  });

  it("fléchette annoncée sans détail : relue par HTTP, puis le message en retard n'est pas pris pour un retrait", () => {
    const tracker = newTracker();
    tracker.baseline(snapshot(state([])));
    tracker.live(snapshot(state(["T20", "S20"])));
    expect(tracker.missingDetails).toBe(false);
    // La cible annonce 3 fléchettes, mais le message ne contient que les deux premières.
    expect(throws(tracker.live(snapshot(state(["T20", "S20"], { numThrows: 3 }))))).toEqual([]);
    expect(tracker.missingDetails).toBe(true);
    expect(throws(tracker.reconcile(snapshot(state(["T20", "S20", "D10"])))).map((t) => t.slot)).toEqual([2]);
    expect(tracker.missingDetails).toBe(false);
    // Message WebSocket encore incomplet : pas de retrait, pas de doublon.
    expect(tracker.live(snapshot(state(["T20", "S20"], { numThrows: 3 })))).toEqual([]);
    expect(tracker.live(snapshot(state(["T20", "S20", "D10"])))).toEqual([]);
    // Le vrai retrait vide la cible : visite close avec 3 fléchettes, 3 annoncées.
    const out = tracker.live(snapshot({ ...base, event: "Takeout finished", numThrows: 0 }));
    expect(out).toEqual([expect.objectContaining({ kind: "takeout-finished", dartsOnBoard: 3, announced: 3 })]);
  });

  it("retrait après une fléchette annoncée mais jamais transmise : l'écart figure dans l'événement", () => {
    const tracker = newTracker();
    tracker.baseline(snapshot(state([])));
    tracker.live(snapshot(state(["T20", "S20"])));
    tracker.live(snapshot(state(["T20", "S20"], { numThrows: 3 })));
    const out = tracker.live(snapshot({ ...base, event: "Takeout finished", numThrows: 0 }));
    expect(out).toEqual([expect.objectContaining({ kind: "takeout-finished", dartsOnBoard: 2, announced: 3 })]);
  });

  it("retrait après deux fléchettes seulement détectées : rien d'annoncé de plus", () => {
    const tracker = newTracker();
    tracker.baseline(snapshot(state([])));
    tracker.live(snapshot(state(["T20", "S20"])));
    const out = tracker.live(snapshot({ ...base, event: "Takeout finished", numThrows: 0 }));
    expect(out).toEqual([expect.objectContaining({ kind: "takeout-finished", dartsOnBoard: 2, announced: 2 })]);
  });

  it("isole un lancer illisible sans bloquer les suivants", () => {
    const parsed = parseBoardState({ ...base, event: "Throw detected", numThrows: 2, throws: [{ segment: { number: 25, multiplier: 3 } }, simThrow({ segment: 5, multiplier: 1 })] });
    expect(parsed.ok && parsed.invalidThrows).toEqual(["lancer 1 : combinaison 25 × 3 impossible"]);
    const tracker = newTracker();
    tracker.baseline(snapshot(state([])));
    const events = tracker.live((parsed as { value: BoardSnapshot }).value);
    expect(throws(events).map((t) => t.score)).toEqual([5]);
  });

  it("rejette un état invalide", () => {
    expect(parseBoardState({ running: "oui" }).ok).toBe(false);
    expect(parseBoardState(null).ok).toBe(false);
    expect(parseBoardState({ running: true, numThrows: 999 }).ok).toBe(false);
  });

  it("détecte l'absence de données de lancer", () => {
    const r = parseBoardState({ ...base, event: "Throw detected", numThrows: 2 });
    expect(r.ok && r.value.missingThrowData).toBe(true);
  });
});

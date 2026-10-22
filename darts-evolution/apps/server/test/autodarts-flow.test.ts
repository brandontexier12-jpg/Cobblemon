import { BoardManagerSimulator } from "@darts-evolution/autodarts-adapter";
import { io as connectClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlayers, removeDir, startTestApp, type TestApp } from "./helpers.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function setup(options: Parameters<typeof startTestApp>[2] = {}) {
  const sim = new BoardManagerSimulator({ generation: 2 });
  await sim.start();
  const app = await startTestApp({}, undefined, options);
  cleanups.push(() => removeDir(app.dir));
  cleanups.push(() => sim.stop());
  cleanups.push(() => app.close());
  await app.built.listen();
  await app.json("PUT", "/api/autodarts/config", { enabled: true, host: "127.0.0.1", port: sim.port, protocol: "http" });
  await vi.waitFor(async () => expect((await app.json("GET", "/api/autodarts")).status.state).toBe("connected"), { timeout: 5000 });
  return { sim, app };
}

const view = async (app: TestApp, id: string) => (await app.json("GET", `/api/matches/${id}`)).view;

describe("intégration Autodarts de bout en bout (simulateur de Board Manager)", () => {
  it("transmet les impacts au moteur, ignore le retrait comme impact et passe au joueur suivant", async () => {
    const { sim, app } = await setup();
    const [a, b] = await createPlayers(app, "Alice", "Bob");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: { startScore: 501 }, playerIds: [a, b], inputMode: "autodarts" });
    expect((await app.json("GET", "/api/autodarts")).boundMatchId).toBe(match.id);

    sim.throwDart("T20");
    sim.throwDart("T20");
    sim.throwDart("S20");
    await vi.waitFor(async () => expect((await view(app, match.id)).players[0].main).toBe("361"));
    let v = await view(app, match.id);
    expect(v.current.darts.map((d: any) => d.source)).toEqual(["autodarts", "autodarts", "autodarts"]);
    // La position réelle de chaque impact est conservée (affichage sur la cible).
    expect(v.current.darts[0].coords).toEqual({ x: 0, y: 0.6 });
    expect(v.current.darts.every((d: any) => typeof d.coords?.x === "number")).toBe(true);
    expect(v.current.awaitingNext).toBe(true);

    // Une 4e fléchette avant le retrait est ignorée (jamais comptée au joueur suivant).
    sim.throwDart("T20");
    await vi.waitFor(async () => {
      const journal = await app.json("GET", "/api/autodarts/journal");
      expect(journal.some((j: any) => j.outcome.includes("en attente du retrait"))).toBe(true);
    });
    expect((await view(app, match.id)).players[1].main).toBe("501");

    // Retrait : aucun impact, joueur suivant.
    sim.takeout();
    await vi.waitFor(async () => expect((await view(app, match.id)).current.playerIndex).toBe(1));
    v = await view(app, match.id);
    expect(v.current.darts).toHaveLength(0);
    expect(v.players.map((p: any) => p.main)).toEqual(["361", "501"]);

    // Messages dupliqués : pas de double comptage.
    sim.throwDart("S5");
    sim.repeatLastMessage();
    sim.repeatLastMessage();
    await vi.waitFor(async () => expect((await view(app, match.id)).players[1].main).toBe("496"));
    await new Promise((r) => setTimeout(r, 150));
    expect((await view(app, match.id)).current.darts).toHaveLength(1);

    // Coupure puis reconnexion : la fléchette lancée pendant la coupure est récupérée une seule fois.
    sim.dropConnections();
    sim.throwDart("S10");
    await vi.waitFor(async () => expect((await view(app, match.id)).players[1].main).toBe("486"), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 200));
    expect((await view(app, match.id)).current.darts.map((d: any) => d.label)).toEqual(["S5", "S10"]);

    // Retrait anticipé après 2 fléchettes : la 3e est comptée ratée.
    sim.takeout();
    await vi.waitFor(async () => expect((await view(app, match.id)).current.playerIndex).toBe(0));
    const visits = await app.json("GET", `/api/matches/${match.id}/visits`);
    expect(visits[1].darts.map((d: any) => !!d.padded)).toEqual([false, false, true]);

    // Statistiques : alimentées par les impacts réels.
    const stats = await app.json("GET", `/api/stats/summary?playerId=${a}`);
    expect(stats.summary.x01.points).toBe(140);
  });

  it("visite incomplète : cause au journal, 3e fléchette relue par HTTP, saisie après coup de la fléchette manquée", async () => {
    const { sim, app } = await setup();
    const [a, b] = await createPlayers(app, "Alice", "Bob");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: { startScore: 501 }, playerIds: [a, b], inputMode: "autodarts" });

    // La cible ne détecte que deux fléchettes avant le retrait.
    sim.throwDart("T20");
    sim.throwDart("T20");
    await vi.waitFor(async () => expect((await view(app, match.id)).current.darts).toHaveLength(2));
    sim.takeout();
    await vi.waitFor(async () => expect((await view(app, match.id)).current.playerIndex).toBe(1));
    const journal = await app.json("GET", "/api/autodarts/journal");
    const entry = journal.find((j: any) => j.kind === "retrait");
    expect(entry.outcome).toBe("visite incomplète : la cible n'a détecté que 2 fléchette(s)");
    expect(entry.summary).toMatchObject({ dartsOnBoard: 2, announced: 2, counted: 2, early: true });

    // La fléchette manquante (comptée ratée) est saisie après coup : la visite et le score sont recalculés.
    let v = await view(app, match.id);
    const padded = v.recentVisits[0].darts[2];
    expect(padded).toMatchObject({ padded: true, paddedBy: expect.any(String) });
    expect(v.players[0].main).toBe("381");
    const r = await app.json("POST", `/api/matches/${match.id}/commands`, { kind: "insert", paddedBy: padded.paddedBy, dart: { segment: 20, multiplier: 1 } });
    expect(r.applied).toBe(true);
    v = r.snapshot.view;
    expect(v.players[0].main).toBe("361");
    expect(v.recentVisits[0].darts.map((d: any) => d.label)).toEqual(["T20", "T20", "S20"]);
    expect(v.recentVisits[0].darts.some((d: any) => d.padded)).toBe(false);
    expect(v.current.playerIndex).toBe(1); // toujours le tour de Bob
    // Plus rien à saisir dans cette visite.
    const again = await app.request("POST", `/api/matches/${match.id}/commands`, { kind: "insert", paddedBy: padded.paddedBy, dart: { segment: 20, multiplier: 1 } });
    expect(again.statusCode).toBe(400);

    // 3e fléchette annoncée sans détail dans le message : relue aussitôt, la visite reste complète.
    sim.throwDart("S5");
    sim.throwDart("S5");
    sim.throwDart("S5", { lateDetail: true });
    await vi.waitFor(async () => expect((await view(app, match.id)).players[1].main).toBe("486"), { timeout: 3000 });
    sim.takeout();
    await vi.waitFor(async () => expect((await view(app, match.id)).current.playerIndex).toBe(0));
    const visits = await app.json("GET", `/api/matches/${match.id}/visits`);
    expect(visits[1].darts.map((d: any) => !!d.padded)).toEqual([false, false, false]);
    const stats = await app.json("GET", `/api/stats/summary?playerId=${a}`);
    expect(stats.summary.x01.points).toBe(140);

    // Diagnostic : une visite incomplète (non détectée par la cible), une complète, une fléchette relue.
    const diag = await app.json("GET", "/api/autodarts/diagnostic");
    expect(diag).toMatchObject({ visits: 2, complete: 1, notDetected: 1, detailMissing: 0, refused: 0, recovered: 1 });
    expect(diag.verdict.map((v: any) => v.text).join(" ")).toContain("n'a pas détecté toutes les fléchettes");
    const file = await app.request("GET", "/api/autodarts/journal?limit=1000&download=1");
    expect(file.headers["content-disposition"]).toMatch(/^attachment; filename="journal-autodarts-.+\.json"$/);
    expect(file.json()).toMatchObject({ autodarts: { state: "connected" }, diagnostic: { visits: 2 } });
    expect(file.json().journal.length).toBeGreaterThan(5);
  });

  it("quitter une partie pour plus tard la détache d'Autodarts, la reprendre la relie", async () => {
    const { sim, app } = await setup();
    const [a, b] = await createPlayers(app, "Alice", "Bob");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: { startScore: 501 }, playerIds: [a, b], inputMode: "autodarts" });
    expect((await app.json("GET", "/api/autodarts")).boundMatchId).toBe(match.id);

    await app.json("POST", `/api/matches/${match.id}/leave`);
    expect((await app.json("GET", "/api/autodarts")).boundMatchId).toBeNull();
    sim.throwDart("T20");
    await vi.waitFor(async () => {
      const journal = await app.json("GET", "/api/autodarts/journal");
      expect(journal.some((j: any) => j.kind === "impact" && j.outcome === "ignoré : aucune partie liée à Autodarts")).toBe(true);
    });
    expect((await view(app, match.id)).current.darts).toHaveLength(0);
    sim.takeout();

    const resumed = await app.json("POST", `/api/matches/${match.id}/resume`);
    expect(resumed.match.status).toBe("active");
    expect((await app.json("GET", "/api/autodarts")).boundMatchId).toBe(match.id);
    sim.throwDart("S20");
    await vi.waitFor(async () => expect((await view(app, match.id)).players[0].main).toBe("481"));

    const journal = await app.json("GET", "/api/autodarts/journal");
    expect(journal.filter((j: any) => j.kind === "liaison").map((j: any) => j.outcome)).toEqual(["partie liée à Autodarts", "aucune partie liée", "partie liée à Autodarts"]);
  });

  it("carte de précision : décalage mesuré sur les positions Autodarts, positions incohérentes écartées", async () => {
    const { sim, app } = await setup();
    const [a] = await createPlayers(app, "Alice");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: { startScore: 501 }, playerIds: [a], inputMode: "autodarts" });
    // Centre du T20 : (0 ; 0,606). Chaque fléchette tombe 6 mm à gauche, toujours dans le T20.
    const t20 = { x: -6 / 170, y: 0.606 };
    for (let visit = 0; visit < 2; visit++) {
      for (let d = 0; d < 3; d++) sim.throwDart("T20", { coords: t20 });
      await vi.waitFor(async () => expect((await view(app, match.id)).current.darts).toHaveLength(3));
      sim.takeout();
      await vi.waitFor(async () => expect((await view(app, match.id)).current.darts).toHaveLength(0));
    }
    // Position incohérente : annoncée en S5, mais placée dans le T20.
    sim.throwDart("S5", { coords: t20 });
    await vi.waitFor(async () => expect((await view(app, match.id)).current.darts).toHaveLength(1));

    const p = await app.json("GET", `/api/stats/precision?playerId=${a}`);
    expect(p).toMatchObject({ impacts: 6, ignored: 1, matches: 1 });
    expect(p.targets[0]).toMatchObject({ target: "T20", count: 6, hits: 6, hitRate: 1 });
    expect(p.targets[0].biasX).toBeCloseTo(-6, 0);
    expect(p.targets[0].meanError).toBeLessThan(7);
    expect(p.heat).toHaveLength(6);
    // Un autre joueur, ou une période antérieure : rien.
    expect((await app.json("GET", `/api/stats/precision?playerId=${a}&to=2020-01-01T00:00:00.000Z`)).impacts).toBe(0);
    expect((await app.request("GET", "/api/stats/precision")).statusCode).toBe(400);
  });

  it("ignore la cible réelle pendant le tour d'un bot, qui passe la main seul", async () => {
    const { sim, app } = await setup({ botTiming: { firstDartMs: 400, dartMs: 40, nextMs: 40, handOverMs: 40, undoPauseMs: 100, killerDrawMs: 0 } });
    const [a] = await createPlayers(app, "Alice");
    const bot = await app.json("POST", "/api/bots/60");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: { startScore: 501 }, playerIds: [a, bot.id], inputMode: "autodarts" });
    for (const d of ["T20", "S5", "S1"]) sim.throwDart(d);
    await vi.waitFor(async () => expect((await view(app, match.id)).current.complete).toBe(true));
    // Avec Autodarts, c'est le retrait qui passe la main au bot (pas de passage automatique).
    await new Promise((r) => setTimeout(r, 150));
    expect((await view(app, match.id)).current.playerIndex).toBe(0);
    sim.takeout();
    await vi.waitFor(async () => expect((await view(app, match.id)).current.playerIndex).toBe(1));
    // Une fléchette réelle pendant le tour du bot est ignorée.
    sim.throwDart("T20");
    await vi.waitFor(async () => {
      const journal = await app.json("GET", "/api/autodarts/journal");
      expect(journal.some((j: any) => j.kind === "impact" && j.outcome === "ignoré : tour de Bot 60")).toBe(true);
    });
    // Le bot joue ses 3 fléchettes virtuelles puis rend la main à Alice.
    await vi.waitFor(async () => {
      const v = await view(app, match.id);
      expect(v.current.playerIndex).toBe(0);
      expect(v.recentVisits[1].darts.map((d: any) => d.source)).toEqual(["bot", "bot", "bot"]);
    }, { timeout: 5000 });
  });

  it("recalibre les caméras par l'API locale, sans compter d'impact pendant la calibration", async () => {
    const { sim, app } = await setup();
    const [a, b] = await createPlayers(app, "Alice", "Bob");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: { startScore: 501 }, playerIds: [a, b], inputMode: "autodarts" });
    expect((await app.json("GET", "/api/autodarts/cameras")).count).toBe(0);
    const pending = app.json("POST", "/api/autodarts/calibrate", {});
    // Pendant la calibration : statut « Calibrating » et une seconde demande est refusée.
    await vi.waitFor(async () => expect((await app.json("GET", "/api/autodarts")).calibrating).toBe(true));
    const twice = await app.request("POST", "/api/autodarts/calibrate", {});
    expect(twice.statusCode).toBe(409);
    sim.throwDart("T20"); // image parasite pendant la calibration
    expect(await pending).toEqual({ message: "Calibration automatique terminée (toutes les caméras)." });
    expect(sim.commands).toContain("calibrate");
    await vi.waitFor(async () => {
      const journal = await app.json("GET", "/api/autodarts/journal");
      expect(journal.some((j: any) => j.kind === "calibration" && j.outcome === "terminée")).toBe(true);
      expect(journal.some((j: any) => j.kind === "impact" && j.outcome === "ignoré : calibration des caméras en cours")).toBe(true);
    });
    expect((await view(app, match.id)).current.darts).toHaveLength(0);
    // Une seule caméra (correction de la distorsion).
    expect(await app.json("POST", "/api/autodarts/calibrate", { camera: 1 })).toEqual({ message: "Calibration automatique terminée (caméra 2)." });
    expect(sim.commands).toContain("calibrate:1");
    expect((await app.request("POST", "/api/autodarts/calibrate", { camera: 9 })).statusCode).toBe(400);
  });

  it("explique un refus d'Autodarts et une version sans calibration par l'API", async () => {
    for (const [calibration, pattern] of [
      ["refuse", /a refusé la calibration/],
      ["absent", /ne propose pas la calibration/],
    ] as const) {
      const sim = new BoardManagerSimulator({ generation: 2, calibration, cameras: 3 });
      await sim.start();
      const app = await startTestApp();
      cleanups.push(() => removeDir(app.dir), () => sim.stop(), () => app.close());
      await app.built.listen();
      await app.json("PUT", "/api/autodarts/config", { enabled: true, host: "127.0.0.1", port: sim.port, protocol: "http" });
      await vi.waitFor(async () => expect((await app.json("GET", "/api/autodarts")).status.state).toBe("connected"), { timeout: 5000 });
      expect((await app.json("GET", "/api/autodarts/cameras")).count).toBe(3);
      const res = await app.request("POST", "/api/autodarts/calibrate", {});
      expect(res.statusCode).toBe(502);
      expect(res.json().message).toMatch(pattern);
      expect((await app.json("GET", "/api/autodarts")).calibrating).toBe(false);
    }
  });

  it("correction faite par la cible et passage en saisie manuelle", async () => {
    const { sim, app } = await setup();
    const [a] = await createPlayers(app, "Alice");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: { startScore: 501 }, playerIds: [a], inputMode: "autodarts" });
    sim.throwDart("S20");
    await vi.waitFor(async () => expect((await view(app, match.id)).players[0].main).toBe("481"));
    sim.correctDart(0, "T20");
    await vi.waitFor(async () => expect((await view(app, match.id)).players[0].main).toBe("441"));

    // Saisie manuelle : les impacts Autodarts ne sont plus pris en compte pour cette partie.
    await app.json("POST", `/api/matches/${match.id}/input-mode`, { mode: "manual" });
    sim.throwDart("T19");
    await vi.waitFor(async () => {
      const journal = await app.json("GET", "/api/autodarts/journal");
      expect(journal.some((j: any) => j.kind === "impact" && j.summary.segment === "T19" && j.outcome.startsWith("ignoré"))).toBe(true);
    });
    expect((await view(app, match.id)).players[0].main).toBe("441");
    await app.json("POST", `/api/matches/${match.id}/commands`, { kind: "dart", dart: { segment: 19, multiplier: 3 } });
    expect((await view(app, match.id)).players[0].main).toBe("384");
  });

  it("l'absence d'Autodarts ne bloque jamais la saisie manuelle", async () => {
    const app = await startTestApp({ AUTODARTS_ENABLED: "true", AUTODARTS_HOST: "127.0.0.1", AUTODARTS_PORT: "9" });
    cleanups.push(() => removeDir(app.dir));
    cleanups.push(() => app.close());
    await app.built.listen();
    await vi.waitFor(async () => expect((await app.json("GET", "/api/autodarts")).status.lastError?.code).toBe("refused"));
    const [a] = await createPlayers(app, "Alice");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: {}, playerIds: [a] });
    const r = await app.json("POST", `/api/matches/${match.id}/commands`, { kind: "dart", dart: { segment: 20, multiplier: 3 } });
    expect(r.snapshot.view.players[0].main).toBe("441");
    const test = await app.json("POST", "/api/autodarts/test", {});
    expect(test.ok).toBe(false);
    expect(test.diagnostic.code).toBe("refused");
  });

  it("mode test : impacts simulés marqués et exclus des statistiques réelles", async () => {
    const app = await startTestApp();
    cleanups.push(() => removeDir(app.dir));
    cleanups.push(() => app.close());
    await app.built.listen();
    await app.json("POST", "/api/autodarts/simulation/start");
    await vi.waitFor(async () => expect((await app.json("GET", "/api/autodarts")).status).toMatchObject({ state: "connected", simulated: true }));
    const [a] = await createPlayers(app, "Alice");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: {}, playerIds: [a], inputMode: "autodarts" });
    expect(match.isSimulation).toBe(true);
    await app.json("POST", "/api/autodarts/simulation/action", { action: "throw", dart: "T20" });
    await vi.waitFor(async () => expect((await view(app, match.id)).players[0].main).toBe("441"));
    expect((await view(app, match.id)).current.darts[0].source).toBe("simulation");
    const stats = await app.json("GET", `/api/stats/summary?playerId=${a}`);
    expect(stats.summary.x01.darts).toBe(0);
    expect((await app.json("GET", "/api/matches")).total).toBe(0);
    expect((await app.json("GET", "/api/matches?simulation=true")).total).toBe(1);
    await app.json("POST", "/api/autodarts/simulation/stop");
    expect((await app.json("GET", "/api/autodarts")).boundMatchId).toBeNull();
  });
});

describe("multijoueur local (Socket.IO)", () => {
  function client(url: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const s = connectClient(url, { path: "/socket.io", transports: ["websocket"], forceNew: true });
      s.once("connect", () => resolve(s));
      s.once("connect_error", reject);
    });
  }
  const emit = (s: Socket, event: string, payload: unknown) => new Promise<any>((resolve) => s.emit(event, payload, resolve));

  it("synchronise plusieurs appareils, refuse le spectateur et dédoublonne", async () => {
    const app = await startTestApp();
    cleanups.push(() => removeDir(app.dir));
    cleanups.push(() => app.close());
    const address = await app.built.listen();
    const [a, b] = await createPlayers(app, "Alice", "Bob");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: {}, playerIds: [a, b] });

    const tablet = await client(address);
    const phone = await client(address);
    const tv = await client(address);
    cleanups.push(() => void [tablet, phone, tv].forEach((s) => s.close()));

    expect((await emit(tablet, "room:join", { code: match.roomCode, role: "player", name: "Tablette" })).ok).toBe(true);
    expect((await emit(phone, "room:join", { code: match.roomCode.toLowerCase(), role: "player", name: "Téléphone" })).ok).toBe(true);
    const spectate = await emit(tv, "room:join", { matchId: match.id, role: "spectator", name: "TV" });
    expect(spectate.devices).toHaveLength(3);

    const received = new Promise<any>((resolve) => tv.once("match:state", resolve));
    const command = { kind: "dart", dart: { segment: 20, multiplier: 3 }, commandId: "tablette-1" };
    const first = await emit(tablet, "match:command", { matchId: match.id, command });
    expect(first.ok).toBe(true);
    expect((await received).view.players[0].main).toBe("441");

    // Le même message réseau répété n'est appliqué qu'une fois.
    const repeated = await emit(phone, "match:command", { matchId: match.id, command });
    expect(repeated).toMatchObject({ ok: true, duplicate: true });

    const denied = await emit(tv, "match:command", { matchId: match.id, command: { kind: "undo" } });
    expect(denied).toMatchObject({ ok: false, error: "forbidden" });

    const stale = await emit(phone, "match:command", { matchId: match.id, command: { kind: "dart", dart: { segment: 1, multiplier: 1 }, baseVersion: 0 } });
    expect(stale).toMatchObject({ ok: false, error: "version_conflict" });

    expect((await view(app, match.id)).players[0].main).toBe("441");
  });
});

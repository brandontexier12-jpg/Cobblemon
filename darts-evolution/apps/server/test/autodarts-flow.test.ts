import { BoardManagerSimulator } from "@darts-evolution/autodarts-adapter";
import { io as connectClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlayers, removeDir, startTestApp, type TestApp } from "./helpers.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function setup() {
  const sim = new BoardManagerSimulator({ generation: 2 });
  await sim.start();
  const app = await startTestApp();
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

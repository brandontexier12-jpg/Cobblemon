import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { DetectedThrow, ScoringEvent } from "@darts-evolution/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutodartsScoringProvider } from "../src/autodarts-provider.js";
import { ManualScoringProvider } from "../src/manual-provider.js";
import { BoardManagerSimulator } from "../src/simulator.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function setup(options: ConstructorParameters<typeof BoardManagerSimulator>[0] = {}) {
  const sim = new BoardManagerSimulator(options);
  await sim.start();
  const provider = new AutodartsScoringProvider({
    host: "127.0.0.1",
    port: sim.port,
    protocol: "http",
    reconnectMinMs: 50,
    reconnectMaxMs: 200,
    reconcileIntervalMs: 60_000,
  });
  const throws: DetectedThrow[] = [];
  const events: ScoringEvent[] = [];
  provider.onThrow((t) => throws.push(t));
  provider.onEvent((e) => events.push(e));
  cleanups.push(() => sim.stop());
  cleanups.push(() => provider.disconnect());
  return { sim, provider, throws, events };
}

async function connected(provider: AutodartsScoringProvider) {
  await vi.waitFor(async () => expect((await provider.getStatus()).state).toBe("connected"), { timeout: 5000 });
}

describe("AutodartsScoringProvider (contre le simulateur)", () => {
  it("se connecte et transmet les impacts normalisés", async () => {
    const { sim, provider, throws, events } = await setup();
    await provider.connect();
    await connected(provider);
    const status = await provider.getStatus();
    expect(status).toMatchObject({ version: "2.0.2", generation: 2, running: true, provider: "autodarts", simulated: false });
    sim.throwDart("T20");
    sim.throwDart("D16");
    sim.throwDart("BULL");
    await vi.waitFor(() => expect(throws).toHaveLength(3));
    expect(throws.map((t) => t.score)).toEqual([60, 32, 50]);
    expect(throws.map((t) => t.slot)).toEqual([0, 1, 2]);
    expect(throws.every((t) => t.source === "autodarts" && !t.simulated)).toBe(true);
    sim.takeout();
    await vi.waitFor(() => expect(events.some((e) => e.kind === "takeout-finished")).toBe(true));
    expect(throws).toHaveLength(3); // le retrait n'ajoute aucun impact
    expect((await provider.getStatus()).lastThrow).toBe("Bull");
  });

  it("ignore les messages dupliqués et signale les messages invalides", async () => {
    const { sim, provider, throws, events } = await setup();
    await provider.connect();
    await connected(provider);
    sim.throwDart("S5");
    await vi.waitFor(() => expect(throws).toHaveLength(1));
    sim.repeatLastMessage();
    sim.repeatLastMessage();
    sim.sendRaw("pas du json");
    sim.sendRaw(JSON.stringify({ type: "state", data: { running: "peut-être" } }));
    await vi.waitFor(() => expect(events.filter((e) => e.kind === "invalid")).toHaveLength(2));
    sim.throwDart("S6");
    await vi.waitFor(() => expect(throws).toHaveLength(2));
    expect(throws.map((t) => t.score)).toEqual([5, 6]);
  });

  it("se reconnecte après une coupure sans recompter, et récupère les fléchettes lancées pendant la coupure", async () => {
    const { sim, provider, throws, events } = await setup();
    await provider.connect();
    await connected(provider);
    sim.throwDart("T20");
    await vi.waitFor(() => expect(throws).toHaveLength(1));
    sim.dropConnections();
    // Une fléchette est lancée pendant la coupure (aucun client connecté à cet instant).
    sim.throwDart("T19");
    // La reconnexion est rapide (50 ms) : on attend l'événement d'état plutôt que d'interroger l'état
    // courant, qui peut redevenir « connecté » entre deux vérifications.
    await vi.waitFor(() => expect(events.some((e) => e.kind === "status" && e.status.state === "reconnecting")).toBe(true));
    await connected(provider);
    await vi.waitFor(() => expect(throws).toHaveLength(2));
    expect(throws.map((t) => t.score)).toEqual([60, 57]);
    sim.throwDart("S1");
    await vi.waitFor(() => expect(throws).toHaveLength(3));
  });

  it("diagnostique un Board Manager arrêté puis se reconnecte quand il revient", async () => {
    const { sim, provider } = await setup();
    await provider.connect();
    await connected(provider);
    await sim.stop();
    await vi.waitFor(async () => expect((await provider.getStatus()).lastError?.code).toBe("refused"), { timeout: 5000 });
    await sim.start();
    await connected(provider);
    expect((await provider.getStatus()).lastError).toBeNull();
  });

  it("signale une authentification requise", async () => {
    const { provider } = await setup({ requireAuth: true });
    await provider.connect();
    await vi.waitFor(async () => expect((await provider.getStatus()).lastError?.code).toBe("auth_required"));
    expect((await provider.getStatus()).state).toBe("error");
  });

  it("signale un service qui n'est pas le Board Manager", async () => {
    const server: Server = createServer((_req, res) => {
      res.writeHead(404);
      res.end("introuvable");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
    const result = await AutodartsScoringProvider.testConnection({ host: "127.0.0.1", port: (server.address() as AddressInfo).port, protocol: "http" });
    expect(result.ok).toBe(false);
    expect(result.diagnostic?.code).toBe("not_board_manager");
  });

  it("signale une adresse invalide et un port fermé", async () => {
    expect((await AutodartsScoringProvider.testConnection({ host: "http://x/y", port: 3180, protocol: "http" })).diagnostic?.code).toBe("invalid_address");
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>((r) => server.close(() => r()));
    expect((await AutodartsScoringProvider.testConnection({ host: "127.0.0.1", port, protocol: "http" })).diagnostic?.code).toBe("refused");
  });

  it("test de connexion réussi : version, détection, WebSocket", async () => {
    const { sim } = await setup({ generation: 1 });
    sim.throwDart("S20");
    const result = await AutodartsScoringProvider.testConnection({ host: "127.0.0.1", port: sim.port, protocol: "http" });
    expect(result).toMatchObject({ ok: true, version: "1.0.7", generation: 1, running: true, dartsOnBoard: 1, throwDataAvailable: true, websocket: true });
  });

  it("relit aussitôt par HTTP une fléchette annoncée sans détail, avant le retrait", async () => {
    const { sim, provider, throws, events } = await setup();
    await provider.connect();
    await connected(provider);
    sim.throwDart("T20");
    sim.throwDart("S20");
    sim.throwDart("D10", { lateDetail: true });
    // Réconciliation périodique réglée à 60 s : seule la relecture immédiate peut la récupérer.
    await vi.waitFor(() => expect(throws).toHaveLength(3), { timeout: 2000 });
    expect(throws.map((t) => [t.slot, t.score])).toEqual([
      [0, 60],
      [1, 20],
      [2, 20],
    ]);
    sim.repeatLastMessage(); // message encore incomplet : ni retrait ni doublon
    await new Promise((r) => setTimeout(r, 100));
    expect(events.some((e) => e.kind === "takeout-finished")).toBe(false);
    sim.takeout();
    await vi.waitFor(() => expect(events.find((e) => e.kind === "takeout-finished")).toMatchObject({ dartsOnBoard: 3, announced: 3 }));
    expect(throws).toHaveLength(3);
  });

  it("avertit quand le Board Manager ne transmet pas le détail des lancers", async () => {
    const { sim, provider, throws } = await setup({ omitThrowData: true });
    await provider.connect();
    await connected(provider);
    sim.throwDart("T20");
    await vi.waitFor(async () => expect((await provider.getStatus()).lastError?.code).toBe("no_throw_data"));
    expect(throws).toHaveLength(0); // jamais d'impact inventé
  });

  it("signale l'arrêt de la détection", async () => {
    const { sim, provider, events } = await setup();
    await provider.connect();
    await connected(provider);
    sim.stopDetection();
    await vi.waitFor(() => expect(events.some((e) => e.kind === "detection-stopped")).toBe(true));
    expect((await provider.getStatus()).warnings.some((w) => w.includes("détection est arrêtée"))).toBe(true);
  });

  it("marque comme simulés les impacts du mode test", async () => {
    const sim = new BoardManagerSimulator();
    await sim.start();
    const provider = new AutodartsScoringProvider({ host: "127.0.0.1", port: sim.port, protocol: "http", simulated: true });
    cleanups.push(() => sim.stop());
    cleanups.push(() => provider.disconnect());
    const throws: DetectedThrow[] = [];
    provider.onThrow((t) => throws.push(t));
    await provider.connect();
    await connected(provider);
    sim.throwDart("S20");
    await vi.waitFor(() => expect(throws).toHaveLength(1));
    expect(throws[0]).toMatchObject({ simulated: true, source: "simulation" });
    expect(provider.kind).toBe("simulation");
  });

  it("envoie un reset sans le confondre avec un reset manuel", async () => {
    const { sim, provider, events } = await setup();
    await provider.connect();
    await connected(provider);
    sim.throwDart("S20");
    await provider.resetBoard();
    await vi.waitFor(() => expect(events.some((e) => e.kind === "reset")).toBe(true));
    expect(events.find((e) => e.kind === "reset")).toMatchObject({ own: true });
    expect(sim.commands).toContain("reset");
  });
});

describe("ManualScoringProvider", () => {
  it("produit des impacts au même format", async () => {
    const manual = new ManualScoringProvider();
    const throws: DetectedThrow[] = [];
    manual.onThrow((t) => throws.push(t));
    manual.submit({ segment: 20, multiplier: 3 });
    manual.submit({ segment: 25, multiplier: 2 });
    expect(throws.map((t) => [t.segmentName, t.score, t.slot, t.source])).toEqual([
      ["T20", 60, 0, "manual"],
      ["BULL", 50, 1, "manual"],
    ]);
    expect(() => manual.submit({ segment: 25, multiplier: 3 })).toThrow();
    expect((await manual.getStatus()).state).toBe("connected");
  });
});

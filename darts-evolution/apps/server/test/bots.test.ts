import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlayers, removeDir, startTestApp, throwDarts, type TestApp } from "./helpers.js";

const FAST = { firstDartMs: 5, dartMs: 5, nextMs: 5, handOverMs: 20, undoPauseMs: 150, killerDrawMs: 0 };
const apps: TestApp[] = [];

async function open(timing = FAST): Promise<TestApp> {
  const app = await startTestApp({}, undefined, { botTiming: timing });
  app.built.ctx.bots.start();
  apps.push(app);
  return app;
}

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
    removeDir(app.dir);
  }
});

const view = async (app: TestApp, id: string) => (await app.json("GET", `/api/matches/${id}`)).view;

describe("bots", () => {
  it("liste les niveaux et crée un bot unique par niveau, masqué des joueurs", async () => {
    const app = await open();
    const levels = await app.json("GET", "/api/bots");
    expect(levels.length).toBeGreaterThanOrEqual(20);
    expect(levels[0]).toMatchObject({ average: 10, name: "Bot 10", label: "Initiation" });
    const a = await app.json("POST", "/api/bots/60");
    const b = await app.json("POST", "/api/bots/60");
    expect(a).toMatchObject({ name: "Bot 60", avatar: "🤖", botAverage: 60, isGuest: true });
    expect(b.id).toBe(a.id);
    expect((await app.request("POST", "/api/bots/61")).statusCode).toBe(400);
    expect((await app.json("GET", "/api/players")).length).toBe(0);
  });

  it("conseille un niveau de bot d'après la moyenne X01 du joueur", async () => {
    const app = await open();
    const [alice] = await createPlayers(app, "Alice");
    expect(await app.json("GET", `/api/bots/recommended?playerId=${alice}`)).toEqual({ average: 25, playerAverage: null });
    // 33 fléchettes à 11 points de moyenne : 33 de moyenne sur 3 fléchettes → bot 30 conseillé.
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: { startScore: 501 }, playerIds: [alice] });
    await throwDarts(app, match.id, ...Array.from({ length: 33 }, () => "S11"));
    const r = await app.json("GET", `/api/bots/recommended?playerId=${alice}`);
    expect(r.playerAverage).toBeCloseTo(33, 0);
    expect(r.average).toBe(30);
  });

  it("un adversaire de carrière joue exactement à son niveau, même sous 20 de moyenne", async () => {
    const app = await open();
    const [alice] = await createPlayers(app, "Alice");
    const career = await app.json("POST", "/api/careers", { playerId: alice, difficulty: "debutant", start: "qschool" });
    const players = app.built.ctx.players;
    const bot = players.careerBot(career.id, undefined, { name: "Jo Lent", average: 14.6, avatar: "🇫🇷" });
    expect(bot.botAverage).toBe(15);
    expect(players.careerBot(career.id, bot.id, { name: "Jo Lent", average: 7, avatar: "🇫🇷" }).botAverage).toBe(10);
    expect(players.careerBot(career.id, bot.id, { name: "Jo Lent", average: 190, avatar: "🇫🇷" }).botAverage).toBe(170);
  });

  it("joue seul son tour puis rend la main ; un humain ne peut pas lancer à sa place", async () => {
    const app = await open({ firstDartMs: 5, dartMs: 250, nextMs: 5, handOverMs: 250, undoPauseMs: 150, killerDrawMs: 0 });
    const [alice] = await createPlayers(app, "Alice");
    const bot = await app.json("POST", "/api/bots/100");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: { startScore: 501 }, playerIds: [alice, bot.id] });
    const url = `/api/matches/${match.id}/commands`;
    await throwDarts(app, match.id, "T20", "T20", "T20");

    // Visite d'Alice terminée : une fléchette de plus irait au bot → refusée.
    const early = await app.request("POST", url, { kind: "dart", dart: { segment: 20, multiplier: 1 } });
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toBe("bot_turn");

    // Saisie manuelle : la main passe seule au bot ; pendant sa visite, « Joueur suivant » est refusé.
    await vi.waitFor(async () => {
      const v = await view(app, match.id);
      expect(v.current.playerIndex).toBe(1);
      expect(v.current.darts.length).toBeGreaterThanOrEqual(1);
      expect(v.current.complete).toBe(false);
    }, { timeout: 3000, interval: 10 });
    const next = await app.request("POST", url, { kind: "next" });
    expect(next.statusCode).toBe(409);
    expect(next.json().error).toBe("bot_turn");

    // Le bot termine sa visite et rend la main à Alice.
    await vi.waitFor(async () => {
      const v = await view(app, match.id);
      expect(v.recentVisits).toHaveLength(2);
      expect(v.current.playerIndex).toBe(0);
      expect(v.current.complete).toBe(false);
    }, { timeout: 4000, interval: 20 });
    const botVisit = (await view(app, match.id)).recentVisits[1];
    expect(botVisit.playerId).toBe(bot.id);
    expect(botVisit.darts.every((d: any) => d.source === "bot" && typeof d.coords?.x === "number")).toBe(true);
  });

  it("deux bots jouent une partie complète sans intervention", async () => {
    const app = await open();
    const b1 = await app.json("POST", "/api/bots/135");
    const b2 = await app.json("POST", "/api/bots/150");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: { startScore: 301 }, playerIds: [b1.id, b2.id] });
    await vi.waitFor(async () => expect((await app.json("GET", `/api/matches/${match.id}`)).match.status).toBe("finished"), { timeout: 8000, interval: 50 });
    const final = await app.json("GET", `/api/matches/${match.id}`);
    expect(final.match.winnerIds).toHaveLength(1);
  });

  it("des bots jouent un Killer complet (règle du remplissage)", async () => {
    const app = await open();
    const ids = [(await app.json("POST", "/api/bots/90")).id, (await app.json("POST", "/api/bots/100")).id, (await app.json("POST", "/api/bots/110")).id];
    const { match } = await app.json("POST", "/api/matches", { mode: "killer", options: {}, playerIds: ids });
    expect(match.config.variant).toBe("remplissage");
    await vi.waitFor(async () => expect((await app.json("GET", `/api/matches/${match.id}`)).match.status).toBe("finished"), { timeout: 15000, interval: 50 });
    const final = await app.json("GET", `/api/matches/${match.id}`);
    expect(final.view.killer.players.filter((p: any) => !p.eliminated)).toHaveLength(1);
  });

  it("se met en pause après une annulation", async () => {
    const app = await open();
    const [alice] = await createPlayers(app, "Alice");
    const bot = await app.json("POST", "/api/bots/80");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: {}, playerIds: [bot.id, alice] });
    await vi.waitFor(async () => expect((await view(app, match.id)).current.darts.length).toBeGreaterThanOrEqual(1), { timeout: 3000, interval: 10 });
    await app.json("POST", `/api/matches/${match.id}/commands`, { kind: "undo" });
    const right = await view(app, match.id);
    await new Promise((r) => setTimeout(r, 60));
    // Pas de nouvelle fléchette pendant la pause…
    expect((await view(app, match.id)).current.darts.length).toBe(right.current.darts.length);
    // …puis le bot reprend.
    await vi.waitFor(async () => expect((await view(app, match.id)).current.darts.length).toBeGreaterThan(right.current.darts.length), { timeout: 3000, interval: 20 });
  });
});

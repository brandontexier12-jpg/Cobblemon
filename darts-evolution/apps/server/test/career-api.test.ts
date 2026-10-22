import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlayers, dart, removeDir, startTestApp, type TestApp } from "./helpers.js";

const FAST = { firstDartMs: 5, dartMs: 5, nextMs: 5, handOverMs: 10, undoPauseMs: 50, killerDrawMs: 0 };
const apps: TestApp[] = [];

async function open(env: Record<string, string> = {}): Promise<TestApp> {
  const app = await startTestApp(env, undefined, { botTiming: FAST });
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

/** Joue le match de carrière : neuf fléchettes par leg (sortie simple), le bot joue seul entre-temps. */
async function playMatch(app: TestApp, matchId: string, me: string) {
  const legs = [
    ["T20", "T20", "T20"],
    ["T20", "T20", "T20"],
    ["T20", "T19", "D12"],
  ];
  for (let guard = 0; guard < 20; guard++) {
    const snap = await app.json("GET", `/api/matches/${matchId}`);
    if (snap.match.status !== "active") return snap;
    await vi.waitFor(
      async () => {
        const v = (await app.json("GET", `/api/matches/${matchId}`)).view;
        // À moi : ma visite en cours, ou visite terminée (leg gagné) dont je lance la suivante.
        expect(v.finished || (v.current.complete ? v.current.nextPlayerId === me : v.current.playerId === me)).toBe(true);
      },
      { timeout: 5000, interval: 20 },
    );
    const v = (await app.json("GET", `/api/matches/${matchId}`)).view;
    if (v.finished) break;
    const mine = v.players.find((p: any) => p.id === me).main;
    const remaining = mine === "0" ? 501 : Number(mine);
    const visit = remaining === 501 ? legs[0]! : remaining === 321 ? legs[1]! : legs[2]!;
    for (const d of visit) await app.json("POST", `/api/matches/${matchId}/commands`, { kind: "dart", dart: dart(d) });
  }
  return app.json("GET", `/api/matches/${matchId}`);
}

describe("mode carrière (API)", () => {
  it("crée une carrière, fait jouer un vrai match contre un bot nommé du circuit, puis fait avancer le tournoi", async () => {
    const app = await open();
    const [alice] = await createPlayers(app, "Alice");
    const options = await app.json("GET", "/api/careers/options");
    expect(options.difficulties.map((d: any) => d.id)).toEqual(["debutant", "amateur", "semi_pro", "pro", "legende"]);
    expect(options.countries.find((c: any) => c.code === "FRA")).toMatchObject({ name: "France", flag: "🇫🇷" });

    const career = await app.json("POST", "/api/careers", { playerId: alice, difficulty: "debutant", outRule: "single", matchLength: "courte", start: "qschool" });
    expect(career).toMatchObject({ name: "Carrière de Alice", settings: { difficulty: "debutant", outRule: "single" }, me: { name: "Alice", card: false, rank: null } });
    expect(career.pending).toMatchObject({ kind: "match", event: { name: "PDC Q-School", city: "Milton Keynes" }, round: "64es de finale", matchId: null });
    expect(career.pending.formatLabel).toBe("501 · premier à 2 legs · sortie simple");
    expect(career.pending.opponent.name).toMatch(/^\S+ .+/);
    expect(career.calendar[0]).toMatchObject({ id: "qschool", status: "current" });
    expect(career.calendar.at(-1)).toMatchObject({ id: "worlds", name: "World Darts Championship", venue: "Alexandra Palace" });
    expect((await app.json("GET", "/api/careers"))[0]).toMatchObject({ id: career.id, playerName: "Alice", difficulty: "Débutant" });

    // Tant que le match n'est pas joué, le tournoi ne peut pas avancer.
    const early = await app.request("POST", `/api/careers/${career.id}/continue`);
    expect(early.statusCode).toBe(409);

    const { matchId } = await app.json("POST", `/api/careers/${career.id}/play`, { inputMode: "manual" });
    expect((await app.json("POST", `/api/careers/${career.id}/play`, { inputMode: "manual" })).matchId).toBe(matchId);
    const snap = await app.json("GET", `/api/matches/${matchId}`);
    expect(snap.match).toMatchObject({ careerId: career.id, label: "PDC Q-School · 64es de finale", mode: "x01" });
    expect(snap.match.config).toMatchObject({ startScore: 501, outRule: "single", legs: 2, sets: 1 });
    const bot = snap.match.players.find((p: any) => p.id !== alice);
    expect(bot).toMatchObject({ name: career.pending.opponent.name });
    expect(bot.botAverage).toBe(Math.round(career.pending.opponent.rating));
    // Le bot du circuit n'apparaît pas dans les joueurs.
    expect((await app.json("GET", "/api/players?guests=true")).map((p: any) => p.id)).toEqual([alice]);

    const done = await playMatch(app, matchId, alice);
    expect(done.match.status).toBe("finished");
    expect(done.match.winnerIds).toEqual([alice]);
    let c = await app.json("GET", `/api/careers/${career.id}`);
    expect(c.pending.result).toMatchObject({ won: true, me: 2 });

    // Correction possible tant que le résultat n'est pas validé : le match rouvert efface le résultat.
    await app.json("POST", `/api/matches/${matchId}/commands`, { kind: "undo" });
    expect((await app.json("GET", `/api/careers/${career.id}`)).pending.result).toBeNull();
    await app.json("POST", `/api/matches/${matchId}/commands`, { kind: "dart", dart: dart("D12") });
    expect((await app.json("GET", `/api/careers/${career.id}`)).pending.result).toMatchObject({ won: true });

    c = await app.json("POST", `/api/careers/${career.id}/continue`);
    expect(c.pending).toMatchObject({ kind: "match", round: "32es de finale", matchId: null });
    const r1 = c.run.rounds[0];
    expect(r1.name).toBe("64es de finale");
    expect(r1.fixtures.every((f: any) => f.winner)).toBe(true);
    expect(r1.fixtures.find((f: any) => f.a?.human || f.b?.human).winner).toBe("me");
    // Une fois validé, le match ne peut plus être rouvert.
    const locked = await app.request("POST", `/api/matches/${matchId}/commands`, { kind: "undo" });
    expect(locked.statusCode).toBe(400);
    expect(locked.json().message).toContain("déjà validé");

    // Statistiques : le match de carrière compte pour Alice.
    expect((await app.json("GET", `/api/stats/summary?playerId=${alice}`)).summary.x01.darts).toBeGreaterThanOrEqual(18);
  });

  it("abandon : le match est à rejouer ; classements, circuit renommable, palmarès, suppression", async () => {
    // Mot de passe administrateur configuré : la suppression d'une carrière reste possible sans connexion.
    const app = await open({ ADMIN_PASSWORD: "secret-test" });
    const [alice] = await createPlayers(app, "Alice");
    const career = await app.json("POST", "/api/careers", { playerId: alice, difficulty: "pro", start: "tourcard", light: true });
    // Avec une Tour Card, la saison commence par les tournois du Pro Tour (le Q-School est simulé).
    expect(career.pending.event.tierLabel).toBe("European Tour");
    expect(career.feed.map((f: any) => f.event)).toContain("PDC Q-School");
    const first = await app.json("POST", `/api/careers/${career.id}/play`, { inputMode: "manual" });
    await app.json("POST", `/api/matches/${first.matchId}/commands`, { kind: "abandon" });
    expect((await app.json("GET", `/api/careers/${career.id}`)).pending).toMatchObject({ kind: "match", matchId: null });
    const second = await app.json("POST", `/api/careers/${career.id}/play`, { inputMode: "manual" });
    expect(second.matchId).not.toBe(first.matchId);

    const oom = await app.json("GET", `/api/careers/${career.id}/rankings?category=pdc`);
    expect(oom.rows).toHaveLength(100);
    expect(oom.total).toBeGreaterThan(100);
    expect(oom.rows[0]).toMatchObject({ rank: 1 });
    expect(oom.rows[0].money).toBeGreaterThan(oom.rows[1].money - 1);
    expect(oom.me).toBeNull();

    const circuit = await app.json("GET", `/api/careers/${career.id}/players`);
    const top = circuit[0];
    const renamed = await app.json("PATCH", `/api/careers/${career.id}/players/${top.id}`, { name: "Luke Littler", nickname: "The Nuke" });
    expect(renamed).toMatchObject({ name: "Luke Littler", nickname: "The Nuke" });
    expect((await app.request("PATCH", `/api/careers/${career.id}/players/${circuit[1].id}`, { name: "Luke Littler" })).statusCode).toBe(400);
    expect((await app.json("GET", `/api/careers/${career.id}/rankings?category=pdc`)).rows[0].name).toBe("Luke Littler");

    const history = await app.json("GET", `/api/careers/${career.id}/history`);
    expect(history).toMatchObject({ titles: [], seasons: [] });

    // Suppression : le match de carrière en cours est abandonné (il ne reste pas dans « Parties en cours »).
    expect(await app.json("DELETE", `/api/careers/${career.id}`)).toEqual({ abandoned: 1 });
    expect((await app.json("GET", "/api/careers")).length).toBe(0);
    expect((await app.json("GET", `/api/matches/${second.matchId}`)).match.status).toBe("abandoned");
    expect((await app.json("GET", "/api/home")).active).toEqual([]);
    expect((await app.request("GET", `/api/careers/${career.id}`)).statusCode).toBe(404);
  });
});

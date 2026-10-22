import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Database } from "../src/db/database.js";
import { MIGRATIONS } from "../src/db/migrations.js";
import { createPlayers, dart, removeDir, startTestApp, throwDarts, type TestApp } from "./helpers.js";

const apps: TestApp[] = [];
const dirs: string[] = [];
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
  while (dirs.length) removeDir(dirs.pop()!);
});

async function open(env: Record<string, string> = {}, dir?: string) {
  const app = await startTestApp(env, dir);
  apps.push(app);
  if (!dir) dirs.push(app.dir);
  return app;
}

describe("joueurs", () => {
  it("crée, modifie, refuse un doublon et archive", async () => {
    const app = await open();
    const [alice] = await createPlayers(app, "Alice");
    const dup = await app.request("POST", "/api/players", { name: "alice" });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().message).toContain("déjà utilisé");
    const updated = await app.json("PATCH", `/api/players/${alice}`, { avatar: "🦊", level: "expert" });
    expect(updated).toMatchObject({ name: "Alice", avatar: "🦊", level: "expert" });
    const guest = await app.json("POST", "/api/players/guest", {});
    expect(guest.isGuest).toBe(true);
    expect((await app.json("GET", "/api/players")).map((p: any) => p.name)).toEqual(["Alice"]);
    expect(await app.json("DELETE", `/api/players/${alice}`)).toEqual({ archived: true, deleted: false });
    expect(await app.json("GET", "/api/players")).toEqual([]);
    const invalid = await app.request("POST", "/api/players", { name: "" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().message).toMatch(/pseudo est obligatoire/);
  });
});

describe("partie X01 complète", () => {
  it("joue un 301 jusqu'à la victoire et alimente historique et statistiques", async () => {
    const app = await open();
    const [a, b] = await createPlayers(app, "Alice", "Bob");
    const created = await app.json("POST", "/api/matches", { mode: "x01", options: { startScore: 301, outRule: "double" }, playerIds: [a, b] });
    const id = created.match.id;
    expect(created.match.roomCode).toMatch(/^[A-Z0-9]{6}$/);
    await throwDarts(app, id, "T20", "T20", "T20"); // Alice 121
    await throwDarts(app, id, "S1", "S1", "S1"); // Bob 298
    await throwDarts(app, id, "T20", "S21".replace("S21", "T17"), "D2"); // Alice 121 - 60 - 51 - 4 = 6
    await throwDarts(app, id, "S1", "S1", "S1");
    const last = await throwDarts(app, id, "D3");
    expect(last.snapshot.match.status).toBe("finished");
    expect(last.snapshot.match.winnerIds).toEqual([a]);
    expect(last.snapshot.view.players[0].winner).toBe(true);

    const history = await app.json("GET", "/api/matches?status=finished");
    expect(history.total).toBe(1);
    expect(history.items[0].players[0]).toMatchObject({ name: "Alice", won: true, darts: 7, points: 301 });

    const stats = await app.json("GET", `/api/stats/summary?playerId=${a}`);
    expect(stats.summary.x01).toMatchObject({ darts: 7, points: 301, bestVisit: 180, count180: 1, checkouts: 1, bestCheckout: 6 });
    expect(stats.summary.x01.average3).toBeCloseTo((301 / 7) * 3, 1);
    expect(stats.summary.results).toMatchObject({ matches: 1, wins: 1 });
    expect(stats.records.find((r: any) => r.id === "best_visit").value).toBe(180);
    expect(stats.progress.badges.map((b: any) => b.id)).toContain("max");

    const visits = await app.json("GET", `/api/matches/${id}/visits`);
    expect(visits).toHaveLength(5);
    expect((await app.json("GET", `/api/rooms/${created.match.roomCode}`)).match.id).toBe(id);
  });

  it("annule, corrige et met à jour les statistiques", async () => {
    const app = await open();
    const [a] = await createPlayers(app, "Alice");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: { startScore: 501 }, playerIds: [a] });
    let r = await throwDarts(app, match.id, "T20", "T20");
    expect(r.snapshot.view.players[0].main).toBe("381");
    r = await app.json("POST", `/api/matches/${match.id}/commands`, { kind: "undo" });
    expect(r.snapshot.view.players[0].main).toBe("441");
    const firstDart = r.snapshot.view.current.darts[0].eventId;
    r = await app.json("POST", `/api/matches/${match.id}/commands`, { kind: "correct", eventId: firstDart, dart: { segment: 19, multiplier: 3 } });
    expect(r.snapshot.view.players[0].main).toBe("444");
    await throwDarts(app, match.id, "S1", "S1");
    const stats = await app.json("GET", `/api/stats/summary?playerId=${a}`);
    expect(stats.summary.x01.points).toBe(57 + 2);
  });

  it("saisit après coup les fléchettes comptées ratées, jusqu'à une sortie qui termine la partie", async () => {
    const first = await open();
    const [a, b] = await createPlayers(first, "Alice", "Bob");
    const { match } = await first.json("POST", "/api/matches", { mode: "x01", options: { startScore: 101 }, playerIds: [a, b] });
    const url = `/api/matches/${match.id}/commands`;
    let r = await throwDarts(first, match.id, "T20", "next", "S1", "S1", "S1", "S1");
    const paddedBy = r.snapshot.view.recentVisits[0].darts[1].paddedBy;
    expect(r.snapshot.view.recentVisits[0].darts.map((d: any) => !!d.padded)).toEqual([false, true, true]);
    // La première fléchette manquante est saisie : la visite garde une fléchette comptée ratée.
    r = await first.json("POST", url, { kind: "insert", paddedBy, dart: dart("S1") });
    expect(r.snapshot.view.recentVisits[0].darts.map((d: any) => d.label)).toEqual(["T20", "S1", "MISS"]);
    expect(r.snapshot.view.players.map((p: any) => p.main)).toEqual(["39", "98"]);
    // La seconde fléchette manquante était une sortie : la partie se termine, la suite est annulée.
    r = await first.json("POST", url, { kind: "insert", paddedBy, dart: dart("D20") });
    expect(r.notice).toBe("5 action(s) postérieure(s) annulée(s) : la partie se termine désormais plus tôt.");
    expect(r.snapshot.match).toMatchObject({ status: "finished", winnerIds: [a] });
    expect(r.snapshot.view.recentVisits).toHaveLength(1);
    // L'ordre du journal est enregistré en base : il survit au redémarrage.
    await first.close();
    apps.pop();
    const second = await open({}, first.dir);
    const reloaded = await second.json("GET", `/api/matches/${match.id}`);
    expect(reloaded.match.status).toBe("finished");
    expect(reloaded.view.recentVisits[0].darts.map((d: any) => d.label)).toEqual(["T20", "S1", "D20"]);
    const stats = await second.json("GET", `/api/stats/summary?playerId=${a}`);
    expect(stats.summary.x01).toMatchObject({ darts: 3, points: 101, checkouts: 1 });
  });

  it("une partie abandonnée reste dans l'historique mais sort des statistiques", async () => {
    const app = await open();
    const [a] = await createPlayers(app, "Alice");
    const kept = (await app.json("POST", "/api/matches", { mode: "x01", options: { startScore: 501 }, playerIds: [a] })).match;
    await throwDarts(app, kept.id, "S20", "S20", "S20");
    const dropped = (await app.json("POST", "/api/matches", { mode: "x01", options: { startScore: 501 }, playerIds: [a] })).match;
    await throwDarts(app, dropped.id, "T20", "T20", "T20");
    expect((await app.json("GET", `/api/stats/summary?playerId=${a}`)).summary.x01.points).toBe(240);
    await app.json("POST", `/api/matches/${dropped.id}/commands`, { kind: "abandon" });
    expect((await app.json("GET", `/api/stats/summary?playerId=${a}`)).summary.x01).toMatchObject({ points: 60, darts: 3 });
    expect((await app.json("GET", "/api/matches")).items.map((m: any) => m.id)).toContain(dropped.id);
    expect((await app.json("GET", "/api/matches?hideAbandoned=1")).items.map((m: any) => m.id)).toEqual([kept.id]);
    expect((await app.json("GET", "/api/matches?status=abandoned")).items.map((m: any) => m.id)).toEqual([dropped.id]);
    expect((await app.json("GET", `/api/home?playerId=${a}`)).recent.map((m: any) => m.id)).toEqual([kept.id]);
  });

  it("idempotence des commandes et conflit de version", async () => {
    const app = await open();
    const [a] = await createPlayers(app, "Alice");
    const { match } = await app.json("POST", "/api/matches", { mode: "x01", options: {}, playerIds: [a] });
    const cmd = { kind: "dart", dart: { segment: 20, multiplier: 1 }, commandId: "cmd-1", baseVersion: 0 };
    const first = await app.json("POST", `/api/matches/${match.id}/commands`, cmd);
    const again = await app.json("POST", `/api/matches/${match.id}/commands`, cmd);
    expect(first.applied).toBe(true);
    expect(again).toMatchObject({ applied: false, duplicate: true });
    expect(again.snapshot.view.players[0].main).toBe("481");
    const stale = await app.request("POST", `/api/matches/${match.id}/commands`, { ...cmd, commandId: "cmd-2", baseVersion: 0 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe("version_conflict");
  });

  it("conserve la position touchée sur la cible et ignore une position aberrante", async () => {
    const first = await open();
    const [a] = await createPlayers(first, "Alice");
    const { match } = await first.json("POST", "/api/matches", { mode: "x01", options: {}, playerIds: [a] });
    const url = `/api/matches/${match.id}/commands`;
    await first.json("POST", url, { kind: "dart", dart: { segment: 20, multiplier: 3 }, coords: { x: 0.01, y: 0.6 } });
    const r = await first.json("POST", url, { kind: "dart", dart: { segment: 5, multiplier: 1 }, coords: { x: 50, y: 0 } });
    expect(r.snapshot.view.current.darts.map((d: any) => d.coords ?? null)).toEqual([{ x: 0.01, y: 0.6 }, null]);
    const bad = await first.request("POST", url, { kind: "dart", dart: { segment: 1, multiplier: 1 }, coords: { x: "a", y: 0 } });
    expect(bad.statusCode).toBe(400);
    // La position est enregistrée en base : elle survit au redémarrage.
    await first.close();
    apps.pop();
    const second = await open({}, first.dir);
    const reloaded = await second.json("GET", `/api/matches/${match.id}`);
    expect(reloaded.view.current.darts[0].coords).toEqual({ x: 0.01, y: 0.6 });
  });

  it("refuse une configuration de mode invalide", async () => {
    const app = await open();
    const [a] = await createPlayers(app, "Alice");
    const res = await app.request("POST", "/api/matches", { mode: "killer", options: {}, playerIds: [a] });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/au moins 2 joueur/);
  });
});

describe("persistance", () => {
  it("reprend une partie interrompue après redémarrage", async () => {
    const first = await open();
    const [a, b] = await createPlayers(first, "Alice", "Bob");
    const { match } = await first.json("POST", "/api/matches", { mode: "cricket", options: {}, playerIds: [a, b] });
    await throwDarts(first, match.id, "T20", "T19", "S18");
    await first.close();
    apps.pop();
    const second = await open({}, first.dir);
    const resumed = await second.json("POST", `/api/matches/${match.id}/resume`);
    expect(resumed.match.status).toBe("active");
    expect(resumed.view.board.rows[0].cells[0]).toBe("Ⓧ");
    expect(resumed.view.current.complete).toBe(true);
    const home = await second.json("GET", "/api/home");
    expect(home.active.map((m: any) => m.id)).toContain(match.id);
    expect((await second.json("GET", "/api/players")).length).toBe(2);
  });
});

describe("sauvegardes et migrations", () => {
  it("sauvegarde, liste et restaure (avec sauvegarde de sécurité)", async () => {
    const app = await open();
    await createPlayers(app, "Alice");
    const backup = await app.json("POST", "/api/backups");
    expect(backup.reason).toBe("manuelle");
    await createPlayers(app, "Bob");
    expect((await app.json("GET", "/api/players")).length).toBe(2);
    const result = await app.json("POST", `/api/backups/${backup.name}/restore`);
    expect(result.safetyBackup.reason).toBe("pre-restauration");
    expect((await app.json("GET", "/api/players")).map((p: any) => p.name)).toEqual(["Alice"]);
    const list = await app.json("GET", "/api/backups");
    expect(list.map((b: any) => b.reason).sort()).toEqual(["manuelle", "pre-restauration"]);
    // Restauration par envoi de fichier.
    const data = readFileSync(path.join(app.dir, "backups", result.safetyBackup.name));
    await app.json("POST", "/api/backups/upload-restore", data, { "content-type": "application/octet-stream" });
    expect((await app.json("GET", "/api/players")).length).toBe(2);
    const bad = await app.request("POST", "/api/backups/upload-restore", Buffer.alloc(4096, 1), { "content-type": "application/octet-stream" });
    expect(bad.statusCode).toBe(400);
    expect((await app.json("GET", "/api/players")).length).toBe(2);
    const traversal = await app.request("GET", "/api/backups/..%2Fdata%2Ftest.db");
    expect(traversal.statusCode).toBe(400);
  });

  it("sauvegarde automatique planifiée et rétention limitée aux sauvegardes automatiques", async () => {
    const app = await open({ BACKUP_INTERVAL_HOURS: "1", BACKUP_RETENTION: "1" });
    await createPlayers(app, "Alice");
    app.built.ctx.runScheduledBackup();
    expect(app.built.ctx.backups.list().filter((b) => b.reason === "auto")).toHaveLength(1);
    app.built.ctx.runScheduledBackup(); // trop tôt : rien
    expect(app.built.ctx.backups.list()).toHaveLength(1);
    app.built.ctx.settings.setLastBackupAt(new Date(Date.now() - 2 * 3600_000).toISOString());
    await app.json("POST", "/api/backups");
    await new Promise((r) => setTimeout(r, 1100));
    app.built.ctx.runScheduledBackup();
    const list = app.built.ctx.backups.list();
    expect(list.filter((b) => b.reason === "auto")).toHaveLength(1);
    expect(list.filter((b) => b.reason === "manuelle")).toHaveLength(1);
  });

  it("crée une sauvegarde avant d'appliquer une migration sur une base existante", async () => {
    const app = await open();
    await createPlayers(app, "Alice");
    await app.close();
    apps.pop();
    const db = new Database(path.join(app.dir, "data", "test.db"));
    const backups: string[] = [];
    const applied = db.migrate(
      () => backups.push("pre-migration"),
      [...MIGRATIONS, { version: 99, name: "test", sql: "CREATE TABLE test_migration (id INTEGER)" }],
    );
    db.close();
    expect(applied).toEqual([99]);
    expect(backups).toEqual(["pre-migration"]);
    // Au démarrage de l'application, la sauvegarde pré-migration est un vrai fichier.
    expect(existsSync(path.join(app.dir, "backups"))).toBe(true);
  });
});

describe("administration et sécurité", () => {
  it("protège les actions sensibles par mot de passe", async () => {
    const app = await open({ ADMIN_PASSWORD: "secret-test" });
    expect((await app.request("GET", "/api/backups")).statusCode).toBe(401);
    expect((await app.request("PUT", "/api/autodarts/config", { enabled: false })).statusCode).toBe(401);
    expect((await app.request("POST", "/api/auth/login", { password: "faux" })).statusCode).toBe(401);
    const ok = await app.request("POST", "/api/auth/login", { password: "secret-test" });
    expect(ok.statusCode).toBe(200);
    const cookie = String(ok.headers["set-cookie"]).split(";")[0]!;
    expect(String(ok.headers["set-cookie"])).toContain("HttpOnly");
    expect((await app.request("GET", "/api/backups", undefined, { cookie })).statusCode).toBe(200);
    expect((await app.request("GET", "/api/auth/status", undefined, { cookie })).json()).toEqual({ adminConfigured: true, isAdmin: true });
    // Les joueurs restent utilisables sans connexion.
    expect((await app.request("POST", "/api/players", { name: "Alice" })).statusCode).toBe(201);
  });

  it("limite les tentatives de connexion", async () => {
    const app = await open({ ADMIN_PASSWORD: "secret-test" });
    for (let i = 0; i < 5; i++) await app.request("POST", "/api/auth/login", { password: "faux" });
    expect((await app.request("POST", "/api/auth/login", { password: "secret-test" })).statusCode).toBe(429);
  });

  it("exporte en JSON et en CSV sans injection de formule", async () => {
    const app = await open();
    await app.json("POST", "/api/players", { name: "=CMD()" });
    const json = await app.json("GET", "/api/export/json");
    expect(json.data.players).toHaveLength(1);
    const csv = await app.request("GET", "/api/export/csv/joueurs");
    expect(csv.body).toContain("'=CMD()");
    expect(csv.headers["content-type"]).toContain("text/csv");
  });

  it("renvoie des en-têtes de sécurité et une santé exploitable", async () => {
    const app = await open();
    const res = await app.request("GET", "/api/health");
    expect(res.json()).toMatchObject({ status: "ok", database: "ok", schemaVersion: 3 });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect((await app.request("GET", "/api/inexistant")).statusCode).toBe(404);
  });
});

describe("compétitions", () => {
  it("tableau à élimination directe avec exemption, match lié et tour suivant", async () => {
    const app = await open();
    const ids = await createPlayers(app, "A", "B", "C");
    const comp = await app.json("POST", "/api/competitions", { name: "Coupe", format: "knockout", playerIds: ids, matchOptions: { startScore: 101, outRule: "single" } });
    const round1 = comp.fixtures.filter((f: any) => f.round === 1);
    expect(round1).toHaveLength(2);
    const bye = round1.find((f: any) => f.status === "bye");
    expect(bye.winnerId).toBe(ids[0]);
    const final = comp.fixtures.find((f: any) => f.round === 2);
    expect(final.player1Id).toBe(ids[0]);
    const playable = round1.find((f: any) => f.status === "pending");
    const started = await app.json("POST", `/api/competitions/${comp.id}/fixtures/${playable.id}/start`, {});
    await throwDarts(app, started.match.id, "T20", "T13", "S2");
    const after = await app.json("GET", `/api/competitions/${comp.id}`);
    const done = after.fixtures.find((f: any) => f.id === playable.id);
    expect(done).toMatchObject({ status: "done", score1: 1, score2: 0 });
    expect(after.fixtures.find((f: any) => f.round === 2).player2Id).toBe(done.winnerId);
  });

  it("championnat toutes rondes : calendrier, résultats saisis et classement exportable", async () => {
    const app = await open();
    const ids = await createPlayers(app, "A", "B", "C", "D");
    const comp = await app.json("POST", "/api/competitions", { name: "Ligue", format: "round_robin", playerIds: ids });
    expect(comp.fixtures).toHaveLength(6);
    expect(new Set(comp.fixtures.map((f: any) => f.round)).size).toBe(3);
    for (const f of comp.fixtures) {
      await app.json("POST", `/api/competitions/${comp.id}/fixtures/${f.id}/result`, { winnerId: f.player1Id, score1: 3, score2: 1 });
    }
    const final = await app.json("GET", `/api/competitions/${comp.id}`);
    expect(final.status).toBe("finished");
    expect(final.standings.reduce((s: number, r: any) => s + r.points, 0)).toBe(12);
    const csv = await app.request("GET", `/api/competitions/${comp.id}/export.csv`);
    expect(csv.body).toContain("Rang;Joueur");
  });
});

describe("entraînements et objectifs", () => {
  it("enregistre un exercice personnalisé, le joue et suit un objectif hebdomadaire", async () => {
    const app = await open();
    const [a] = await createPlayers(app, "Alice");
    const ex = await app.json("POST", "/api/exercises", { name: "Haut de cible", options: { targets: [{ segment: 20, ring: "triple" }], dartsPerTarget: 3 } });
    const { match } = await app.json("POST", "/api/matches", { mode: "custom_training", options: ex.options, playerIds: [a] });
    const end = await throwDarts(app, match.id, "T20", "S20", "T20");
    expect(end.snapshot.match.status).toBe("finished");
    await app.json("POST", "/api/goals", { playerId: a, metric: "darts", target: 6 });
    const goals = await app.json("GET", `/api/goals?playerId=${a}`);
    expect(goals.goals[0]).toMatchObject({ value: 3, target: 6, achieved: false, completion: 0.5 });
    const stats = await app.json("GET", `/api/stats/summary?playerId=${a}`);
    expect(stats.summary.training.byMode.custom_training).toMatchObject({ darts: 3, hits: 2 });
  });
});

describe("fichiers de sauvegarde", () => {
  it("nomme les sauvegardes de façon reconnaissable", async () => {
    const app = await open();
    await createPlayers(app, "Alice");
    await app.json("POST", "/api/backups");
    const files = readdirSync(path.join(app.dir, "backups"));
    expect(files[0]).toMatch(/^darts-evolution-\d{8}-\d{6}-manuelle\.db$/);
  });
});

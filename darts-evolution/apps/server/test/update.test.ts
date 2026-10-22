import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReleaseZip } from "../src/update/package.js";
import { chooseTarget, compareVersions, EMPTY_STATE, markFailure, markReady, readState, writeState, type ReleaseState } from "../src/update/releases.js";
import { listZip, readEntry, writeZip, ZipError } from "../src/update/zip.js";
import { startTestApp, type TestApp } from "./helpers.js";

const FIXTURE = readFileSync(new URL("./fixtures/python.zip", import.meta.url));

function release(version: string, overrides: { node?: string; serverCode?: string } = {}) {
  return buildReleaseZip({
    version,
    schemaVersion: 2,
    node: overrides.node ?? "22.0.0",
    server: [{ name: "server.mjs", data: Buffer.from(overrides.serverCode ?? `console.log("serveur ${version}");\n`) }],
    web: [
      { name: "index.html", data: Buffer.from(`<!doctype html><title>${version}</title>`) },
      { name: "assets/app.js", data: Buffer.from("console.log(1);".repeat(200)) },
    ],
    sources: [{ name: "README.md", data: Buffer.from("# sources\n") }],
  });
}

describe("archives ZIP", () => {
  it("relit ses propres archives et celles d'un autre outil", () => {
    const zip = writeZip([
      { name: "a/texte.txt", data: Buffer.from("x".repeat(5000)) },
      { name: "a/vide.txt", data: Buffer.alloc(0) },
      { name: "a/accentué.txt", data: Buffer.from("é") },
    ]);
    const entries = listZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["a/texte.txt", "a/vide.txt", "a/accentué.txt"]);
    expect(readEntry(zip, entries[0]!, 10_000).toString()).toBe("x".repeat(5000));
    expect(readEntry(zip, entries[1]!, 10).length).toBe(0);

    const py = listZip(FIXTURE);
    expect(py.map((e) => e.name)).toEqual(["pkg/hello.txt", "pkg/stored.bin", "pkg/dossier/"]);
    expect(readEntry(FIXTURE, py[0]!, 10_000).toString()).toBe("Bonjour DARTS EVOLUTION\n".repeat(50));
    expect([...readEntry(FIXTURE, py[1]!, 1000)]).toEqual([...Array(256).keys()]);
  });

  it("refuse les fichiers qui ne sont pas des ZIP, corrompus ou trop gros", () => {
    expect(() => listZip(Buffer.from("pas une archive, mais un texte assez long pour être lu"))).toThrow(ZipError);
    const zip = writeZip([{ name: "f.txt", data: Buffer.from("y".repeat(2000)) }]);
    const entry = listZip(zip)[0]!;
    expect(() => readEntry(zip, entry, 100)).toThrow(/trop volumineux/);
    const damaged = Buffer.from(zip);
    damaged[40] = damaged[40]! ^ 0xff; // données compressées altérées
    expect(() => readEntry(damaged, entry, 10_000)).toThrow(ZipError);
    // Taille déclarée mensongère (bombe de décompression) : refusée sans tout décompresser.
    const lying = Buffer.from(zip);
    const cd = lying.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    lying.writeUInt32LE(10, cd + 24);
    expect(() => readEntry(lying, listZip(lying)[0]!, 10_000)).toThrow(ZipError);
  });

  it("refuse les chemins dangereux (zip slip)", () => {
    for (const name of ["../evil.js", "a/../../evil.js", "/etc/passwd", "C:/windows/x", "a\\..\\..\\x"]) {
      const zip = writeZip([{ name: "ok.txt", data: Buffer.from("1") }]);
      // Remplace le nom dans le répertoire central par le nom piégé (même longueur requise : on reconstruit).
      const forged = forgeName(zip, "ok.txt", name);
      expect(() => listZip(forged), name).toThrow(/refusé/);
    }
  });
});

/** Réécrit une archive à une entrée avec un autre nom (pour tester les noms interdits). */
function forgeName(zip: Buffer, from: string, to: string): Buffer {
  const entries = listZip(zip);
  const data = readEntry(zip, entries[0]!, 1000);
  const rebuilt = writeZip([{ name: "x".repeat(to.length), data }]);
  const placeholder = Buffer.from("x".repeat(to.length));
  const out = Buffer.from(rebuilt);
  let i = out.indexOf(placeholder);
  while (i >= 0) {
    Buffer.from(to).copy(out, i);
    i = out.indexOf(placeholder, i + 1);
  }
  void from;
  return out;
}

describe("versions installées", () => {
  it("compare les versions", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0-beta.1", "1.2.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });

  it("choisit la version installée seulement si elle est plus récente que l'image et présente", () => {
    const root = mkdtempSync(path.join(tmpdir(), "de-releases-"));
    const state = { ...EMPTY_STATE, active: "1.3.0" };
    const exists = (f: string) => f.includes("1.3.0");
    expect(chooseTarget(state, "1.2.0", root, exists).target).toMatchObject({ kind: "installed", version: "1.3.0" });
    // Image reconstruite plus récente : elle l'emporte.
    const newer = chooseTarget(state, "1.4.0", root, exists);
    expect(newer.target).toEqual({ kind: "builtin", version: "1.4.0" });
    expect(newer.state.active).toBeNull();
    // Fichiers absents : version de l'image.
    expect(chooseTarget(state, "1.2.0", root, () => false).target.kind).toBe("builtin");
  });

  it("valide une version qui démarre, abandonne une version qui échoue", () => {
    const pending = { ...EMPTY_STATE, active: "1.3.0", previous: null, pending: true };
    expect(markReady(pending, "1.3.0", "1.2.0")).toMatchObject({ pending: false, lastResult: { outcome: "installed", version: "1.3.0" } });
    const failed = markFailure(pending, "1.3.0", "code de sortie 1", "1.2.0");
    expect(failed.rolledBack).toBe(true);
    expect(failed.state).toMatchObject({ active: null, pending: false, lastResult: { outcome: "rolled_back" } });
    // Version déjà validée : abandonnée après 3 arrêts consécutifs seulement.
    let s: ReleaseState = { ...EMPTY_STATE, active: "1.3.0", previous: "1.2.5" };
    for (let i = 0; i < 2; i++) {
      const r = markFailure(s, "1.3.0", "code 1", "1.2.5");
      expect(r.rolledBack).toBe(false);
      s = r.state;
    }
    const third = markFailure(s, "1.3.0", "code 1", "1.2.5");
    expect(third).toMatchObject({ rolledBack: true, state: { active: "1.2.5" } });
  });

  it("lit un état absent ou illisible comme vide", () => {
    const root = mkdtempSync(path.join(tmpdir(), "de-releases-"));
    expect(readState(root)).toEqual(EMPTY_STATE);
    writeFileSync(path.join(root, "state.json"), "{pas du json");
    expect(readState(root)).toEqual(EMPTY_STATE);
    writeState(root, { ...EMPTY_STATE, active: "1.3.0" });
    expect(readState(root).active).toBe("1.3.0");
  });
});

describe("mise à jour depuis l'application", () => {
  const SUPERVISED = { DE_SUPERVISED: "1", DE_SUPERVISOR_PROTOCOL: "1", DE_BUILTIN_VERSION: "1.2.0", APP_VERSION: "1.2.0" };
  const octet = { "content-type": "application/octet-stream" };

  async function adminApp(env: Record<string, string> = {}): Promise<TestApp> {
    const app = await startTestApp({ ADMIN_PASSWORD: "secret-test", ...SUPERVISED, ...env });
    const login = await app.request("POST", "/api/auth/login", { password: "secret-test" });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const original = app.request;
    app.request = (method, url, body, headers = {}) => original(method, url, body, { cookie, ...headers });
    return app;
  }

  it("exige le conteneur supervisé et un mot de passe administrateur", async () => {
    const plain = await startTestApp({ APP_VERSION: "1.2.0" });
    const status = await plain.json("GET", "/api/update");
    expect(status).toMatchObject({ version: "1.2.0", supported: false, adminConfigured: false, revertTo: null });
    const res = await plain.request("POST", "/api/update", release("1.3.0").zip, octet);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("update_unsupported");
    await plain.close();

    const noPassword = await startTestApp(SUPERVISED);
    const refused = await noPassword.request("POST", "/api/update", release("1.3.0").zip, octet);
    expect(refused.json().error).toBe("admin_required");
    await noPassword.close();

    const locked = await startTestApp({ ADMIN_PASSWORD: "secret-test", ...SUPERVISED });
    expect((await locked.request("POST", "/api/update", release("1.3.0").zip, octet)).statusCode).toBe(401);
    await locked.close();
  });

  it("installe un paquet valide, sauvegarde la base et demande le redémarrage", async () => {
    const app = await adminApp();
    await app.json("POST", "/api/players", { name: "Alice" });
    const pkg = release("1.3.0");
    const res = await app.request("POST", "/api/update", pkg.zip, octet);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ version: "1.3.0", from: "1.2.0", restarting: true });
    expect(res.json().backup).toMatch(/pre-mise-a-jour\.db$/);

    const root = path.join(app.dir, "data", "releases");
    expect(readFileSync(path.join(root, "1.3.0", "server", "server.mjs"), "utf8")).toContain("serveur 1.3.0");
    expect(existsSync(path.join(root, "1.3.0", "web", "assets", "app.js"))).toBe(true);
    expect(readState(root)).toMatchObject({ active: "1.3.0", previous: null, pending: true });
    expect(existsSync(path.join(root, "1.3.0", "README.md"))).toBe(false); // les sources ne sont pas installées
    // Une seule installation à la fois, et plus rien tant que le redémarrage n'a pas eu lieu.
    expect((await app.request("POST", "/api/update", release("1.4.0").zip, octet)).json().error).toBe("update_busy");
    await app.close();
  });

  it("refuse les paquets plus anciens, modifiés, incomplets ou incompatibles", async () => {
    const app = await adminApp();
    const send = async (zip: Buffer) => (await app.request("POST", "/api/update", zip, octet)).json();
    expect((await send(release("1.2.0").zip)).message).toMatch(/déjà installée/);
    expect((await send(release("1.1.9").zip)).message).toMatch(/plus ancienne/);
    expect((await send(release("1.3.0", { node: "99.0.0" }).zip)).message).toMatch(/Node\.js 99\.0\.0/);
    expect((await send(writeZip([{ name: "autre/fichier.txt", data: Buffer.from("x") }]))).message).toMatch(/pas un paquet de mise à jour/);
    expect((await send(Buffer.from("ceci n'est pas un zip ".repeat(4)))).message).toMatch(/archive ZIP/);

    // Fichier remplacé après la fabrication du paquet : empreinte incorrecte.
    const pkg = release("1.3.0");
    const entries = listZip(pkg.zip).map((e) => ({ name: e.name, data: readEntry(pkg.zip, e, 1e7) }));
    const tampered = entries.map((e) => (e.name.endsWith("release/server/server.mjs") ? { ...e, data: Buffer.from("process.exit(1)") } : e));
    expect((await send(writeZip(tampered))).message).toMatch(/Empreinte incorrecte pour server\/server\.mjs/);
    const missing = entries.filter((e) => !e.name.endsWith("release/web/index.html"));
    expect((await send(writeZip(missing))).message).toMatch(/incomplet/);

    // Rien n'a été installé.
    expect(readState(path.join(app.dir, "data", "releases")).active).toBeNull();
    await app.close();
  });

  it("revient à la version précédente sur demande", async () => {
    const app = await adminApp({ APP_VERSION: "1.3.0", DE_RUNNING: "installed" });
    const root = path.join(app.dir, "data", "releases");
    mkdirSync(root, { recursive: true });
    writeState(root, { ...EMPTY_STATE, active: "1.3.0", previous: null });
    expect((await app.json("GET", "/api/update")).revertTo).toBe("1.2.0");
    const r = await app.request("POST", "/api/update/revert");
    expect(r.json()).toEqual({ version: "1.2.0" });
    expect(readState(root)).toMatchObject({ active: null, lastResult: { outcome: "reverted" } });
    await app.close();
  });
});

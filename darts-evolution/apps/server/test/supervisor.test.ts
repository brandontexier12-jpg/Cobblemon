import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_STATE, readState, writeState } from "../src/update/releases.js";
import { supervise } from "../src/update/supervisor.js";

/** Faux serveurs (vrais processus) : signalent « prêt », plantent, se bloquent ou demandent un redémarrage. */
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "de-supervisor-"));
  const journal = path.join(dir, "journal.txt");
  const root = path.join(dir, "releases");
  mkdirSync(root);
  const builtin = path.join(dir, "builtin.mjs");
  writeFileSync(
    builtin,
    `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(journal)}, "builtin " + process.env.DE_RUNNING + "\\n");
process.send({ type: "ready" });
setTimeout(() => process.exit(0), 50);`,
  );
  const release = (version: string, code: string) => {
    const serverDir = path.join(root, version, "server");
    mkdirSync(serverDir, { recursive: true });
    writeFileSync(path.join(serverDir, "server.mjs"), `import { appendFileSync, existsSync, writeFileSync } from "node:fs";\nconst log = (m) => appendFileSync(${JSON.stringify(journal)}, m + "\\n");\n${code}`);
  };
  const run = (readyTimeoutMs = 10_000) =>
    supervise({ builtinVersion: "1.2.0", builtinEntry: builtin, releasesRoot: root, readyTimeoutMs, log: () => {} });
  const lines = () => (existsSync(journal) ? readFileSync(journal, "utf8").trim().split("\n") : []);
  return { dir, root, release, run, lines };
}

describe("lanceur superviseur", () => {
  it("revient à la version de l'image quand la nouvelle version plante au démarrage", async () => {
    const t = setup();
    t.release("1.3.0", `log("release 1.3.0"); process.exit(3);`);
    writeState(t.root, { ...EMPTY_STATE, active: "1.3.0", pending: true });
    expect(await t.run()).toBe(0);
    expect(t.lines()).toEqual(["release 1.3.0", "builtin builtin"]);
    expect(readState(t.root)).toMatchObject({ active: null, pending: false, lastResult: { outcome: "rolled_back", version: "1.3.0" } });
    expect(readState(t.root).lastResult?.message).toMatch(/n'a pas démarré \(code de sortie 3 avant d'être prêt\).*1\.2\.0/);
    expect(existsSync(path.join(t.root, "1.3.0"))).toBe(false);
  });

  it("abandonne une version bloquée qui ne signale jamais son démarrage", async () => {
    const t = setup();
    t.release("1.3.0", `log("bloquée"); setInterval(() => {}, 1000);`);
    writeState(t.root, { ...EMPTY_STATE, active: "1.3.0", pending: true });
    expect(await t.run(400)).toBe(0);
    expect(t.lines()).toEqual(["bloquée", "builtin builtin"]);
    expect(readState(t.root).lastResult?.outcome).toBe("rolled_back");
  });

  it("valide une version qui démarre et la relance quand elle le demande", async () => {
    const t = setup();
    const flag = path.join(t.dir, "deja-relance");
    t.release(
      "1.3.0",
      `log("release " + process.env.DE_RUNNING + " " + process.env.WEB_DIST_PATH.endsWith("1.3.0/web"));
process.send({ type: "ready" });
setTimeout(() => {
  if (existsSync(${JSON.stringify(flag)})) process.exit(0);
  writeFileSync(${JSON.stringify(flag)}, "1");
  process.exit(75);
}, 50);`,
    );
    writeState(t.root, { ...EMPTY_STATE, active: "1.3.0", pending: true });
    expect(await t.run()).toBe(0);
    expect(t.lines()).toEqual(["release installed true", "release installed true"]);
    expect(readState(t.root)).toMatchObject({ active: "1.3.0", pending: false, failures: 0, lastResult: { outcome: "installed", from: "1.2.0" } });
  });

  it("transmet le code de sortie d'un arrêt anormal de la version de l'image", async () => {
    const t = setup();
    writeFileSync(path.join(t.dir, "builtin.mjs"), `process.exit(4);`);
    expect(await t.run()).toBe(4);
  });
});

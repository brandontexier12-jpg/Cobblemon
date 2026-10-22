/**
 * Fabrique le fichier de mise à jour `dist-release/darts-evolution-<version>.zip`
 * (à lancer après `npm run build`, depuis la racine du projet : `npm run package`).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "../db/migrations.js";
import { buildReleaseZip, collectFiles, type PackageFile } from "./package.js";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string; engines?: { node?: string } };
const serverDir = path.join(root, "apps/server/dist");
const webDir = path.join(root, "apps/web/dist");
for (const required of [path.join(serverDir, "server.mjs"), path.join(webDir, "index.html")]) {
  if (!existsSync(required)) {
    console.error(`Fichier manquant : ${required}. Lancez d'abord « npm run build ».`);
    process.exit(1);
  }
}
const built = readFileSync(path.join(serverDir, "server.mjs"), "utf8");
if (!built.includes(JSON.stringify(pkg.version))) {
  console.error(`Le serveur assemblé ne correspond pas à la version ${pkg.version} : relancez « npm run build ».`);
  process.exit(1);
}

// Sources suivies par Git (le paquet sert aussi à la reconstruction manuelle de l'image).
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const sources: PackageFile[] = tracked.filter((f) => existsSync(path.join(root, f))).map((f) => ({ name: f, data: readFileSync(path.join(root, f)) }));

const { zip, manifest } = buildReleaseZip({
  version: pkg.version,
  schemaVersion: MIGRATIONS[MIGRATIONS.length - 1]!.version,
  node: /(\d+\.\d+\.\d+)/.exec(pkg.engines?.node ?? "")?.[1] ?? "22.13.0",
  server: collectFiles(serverDir).filter((f) => f.name.startsWith("server.mjs")),
  web: collectFiles(webDir),
  sources,
});

const outDir = path.join(root, "dist-release");
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `darts-evolution-${pkg.version}.zip`);
writeFileSync(out, zip);
console.log(`Paquet ${manifest.version} : ${out}`);
console.log(`  ${Object.keys(manifest.files).length} fichiers installables, ${sources.length} fichiers sources, ${(zip.length / 1024 / 1024).toFixed(1)} Mo`);
console.log(`  SHA-256 : ${createHash("sha256").update(zip).digest("hex")}`);

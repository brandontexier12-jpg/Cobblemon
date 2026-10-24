// Assemble l'application Windows dans dist/ : processus principal et préchargement (CommonJS,
// exigé par Electron en mode bac à sable), écran de connexion et icône. La version vient du
// package.json racine, comme pour le serveur.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const common = { bundle: true, sourcemap: false, legalComments: "none", logLevel: "info", define: { __APP_VERSION__: JSON.stringify(version) } };

mkdirSync("dist", { recursive: true });
await build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.cjs", platform: "node", format: "cjs", target: "node22", external: ["electron"] });
await build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs", platform: "node", format: "cjs", target: "node22", external: ["electron"] });
await build({ ...common, entryPoints: ["src/setup.ts"], outfile: "dist/setup.js", platform: "browser", format: "iife", target: "chrome130" });
for (const f of ["setup.html", "setup.css"]) copyFileSync(`src/${f}`, `dist/${f}`);
copyFileSync("build/icon.png", "dist/icon.png");

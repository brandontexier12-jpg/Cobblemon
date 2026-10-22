// Assemble le serveur et le lanceur du conteneur, chacun en un seul fichier ESM
// (aucun node_modules nécessaire à l'exécution). La version vient du package.json racine.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  legalComments: "linked",
  // Dépendances optionnelles de « ws » (accélérations natives) : absentes, ws s'en passe.
  external: ["bufferutil", "utf-8-validate", "node:sqlite"],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  define: { __APP_VERSION__: JSON.stringify(version) },
  logLevel: "info",
};

await build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/server.mjs" });
await build({ ...common, entryPoints: ["src/launcher.ts"], outfile: "dist/launcher.mjs", sourcemap: false, legalComments: "none" });

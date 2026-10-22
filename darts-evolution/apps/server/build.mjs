// Assemble le serveur en un seul fichier ESM (aucun node_modules nécessaire à l'exécution).
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/server.mjs",
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
  logLevel: "info",
});

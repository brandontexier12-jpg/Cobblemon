import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "apps/server/src/**/*.test.ts",
      "apps/server/test/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Les tests serveur ouvrent des bases SQLite temporaires : un fichier à la fois par worker.
    pool: "forks",
  },
});

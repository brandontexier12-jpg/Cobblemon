import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startTestApp } from "./helpers.js";

const publicDir = path.resolve(import.meta.dirname, "../../web/public");

describe("application installable (téléphone)", () => {
  it("sert le service worker et le manifeste sans cache, les autres fichiers avec cache", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "darts-evolution-web-"));
    const web = path.join(dir, "web");
    mkdirSync(path.join(web, "assets"), { recursive: true });
    writeFileSync(path.join(web, "index.html"), "<!doctype html><title>test</title>");
    writeFileSync(path.join(web, "assets/app.js"), "console.log(1);");
    for (const f of ["sw.js", "manifest.webmanifest", "offline.html", "offline.js"]) writeFileSync(path.join(web, f), readFileSync(path.join(publicDir, f)));
    const app = await startTestApp({ WEB_DIST_PATH: web }, dir);
    try {
      const sw = await app.request("GET", "/sw.js");
      expect(sw.statusCode).toBe(200);
      expect(sw.headers["content-type"]).toMatch(/javascript/);
      expect(sw.headers["cache-control"]).toBe("no-cache");
      const manifest = await app.request("GET", "/manifest.webmanifest");
      expect(manifest.headers["content-type"]).toMatch(/manifest\+json/);
      expect(manifest.headers["cache-control"]).toBe("no-cache");
      expect((await app.request("GET", "/offline.html")).headers["cache-control"]).toBe("no-cache");
      expect((await app.request("GET", "/assets/app.js")).headers["cache-control"]).toBe("public, max-age=3600");
      // Les pages de l'application restent servies par index.html (navigation directe depuis l'icône).
      const page = await app.request("GET", "/carriere");
      expect(page.headers["content-type"]).toMatch(/text\/html/);
      expect(page.headers["content-security-policy"]).toContain("script-src 'self'");
    } finally {
      await app.close();
    }
  });

  it("manifeste complet : icônes PNG présentes, raccourcis vers des pages existantes", () => {
    const manifest = JSON.parse(readFileSync(path.join(publicDir, "manifest.webmanifest"), "utf8"));
    expect(manifest).toMatchObject({ start_url: "/", scope: "/", display: "standalone" });
    const sizes = manifest.icons.filter((i: { type: string }) => i.type === "image/png").map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192 any", "512x512 any", "512x512 maskable"]));
    for (const icon of manifest.icons) expect(existsSync(path.join(publicDir, icon.src))).toBe(true);
    const routes = readFileSync(path.resolve(publicDir, "../src/main.tsx"), "utf8");
    for (const s of manifest.shortcuts) expect(routes).toContain(`path="${s.url.slice(1)}"`);
    // Aucun script en ligne dans la page hors ligne : la politique de sécurité (CSP) l'interdirait.
    expect(readFileSync(path.join(publicDir, "offline.html"), "utf8")).not.toMatch(/<script>|onclick=/);
  });
});

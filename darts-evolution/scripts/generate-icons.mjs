// Génère les icônes PNG (application téléphone) et ICO (application Windows) à partir de
// apps/web/public/logo.svg. Les fichiers produits sont versionnés : ce script ne sert qu'après une
// modification du logo. Il dessine le SVG dans un canvas Chromium via Playwright :
//   PLAYWRIGHT_MODULE=/chemin/vers/playwright node scripts/generate-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const logo = readFileSync(path.join(root, "apps/web/public/logo.svg"), "utf8");
const inner = logo.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<rect[^>]*\/>/, "");
/** Logo arrondi (icône standard) ou carré plein avec le dessin réduit (zone sûre des icônes masquées). */
const variant = (fullBleed, scale) => {
  const t = (32 * (1 - scale)).toFixed(3);
  const bg = fullBleed ? '<rect width="64" height="64" fill="#0b0b0c"/>' : '<rect width="64" height="64" rx="14" fill="#0b0b0c"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${bg}<g transform="translate(${t} ${t}) scale(${scale})">${inner}</g></svg>`;
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
/** Dessine le SVG à la taille demandée : PNG (data URL) et pixels RGBA. */
const render = (svg, size) =>
  page.evaluate(
    async ({ svg, size }) => {
      const img = new Image();
      img.src = "data:image/svg+xml;base64," + btoa(svg);
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, size, size);
      return { png: canvas.toDataURL("image/png").split(",")[1], rgba: Array.from(ctx.getImageData(0, 0, size, size).data) };
    },
    { svg, size },
  );

const write = (rel, data) => {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log(rel, data.length, "octets");
};

const rounded = variant(false, 1);
for (const size of [192, 512]) write(`apps/web/public/icons/icon-${size}.png`, Buffer.from((await render(rounded, size)).png, "base64"));
write("apps/web/public/icons/maskable-512.png", Buffer.from((await render(variant(true, 0.68), 512)).png, "base64"));
write("apps/web/public/icons/apple-touch-icon.png", Buffer.from((await render(variant(true, 0.86), 180)).png, "base64"));
write("apps/desktop/build/icon.png", Buffer.from((await render(rounded, 512)).png, "base64"));

// ICO Windows : images BMP 32 bits (BGRA + masque) jusqu'à 128 px, PNG pour 256 px.
const entries = [];
for (const size of [16, 24, 32, 48, 64, 128, 256]) {
  const { png, rgba } = await render(rounded, size);
  if (size === 256) {
    entries.push({ size, data: Buffer.from(png, "base64") });
    continue;
  }
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // hauteur doublée : image + masque
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4, 20);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = ((size - 1 - y) * size + x) * 4; // lignes de bas en haut
      pixels[dst] = rgba[src + 2];
      pixels[dst + 1] = rgba[src + 1];
      pixels[dst + 2] = rgba[src];
      pixels[dst + 3] = rgba[src + 3];
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size); // tout à 0 : la transparence vient du canal alpha
  entries.push({ size, data: Buffer.concat([header, pixels, mask]) });
}
const dir = Buffer.alloc(6 + 16 * entries.length);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(entries.length, 4);
let offset = dir.length;
entries.forEach((e, i) => {
  const o = 6 + 16 * i;
  dir[o] = e.size === 256 ? 0 : e.size;
  dir[o + 1] = e.size === 256 ? 0 : e.size;
  dir.writeUInt16LE(1, o + 4);
  dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(e.data.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += e.data.length;
});
write("apps/desktop/build/icon.ico", Buffer.concat([dir, ...entries.map((e) => e.data)]));
await browser.close();

// Parcours de vérification de l'interface DARTS EVOLUTION dans Chromium (facultatif, nécessite Playwright).
// Usage : serveur démarré sur une base VIDE, puis
//   BASE=http://localhost:8080 OUT=./tests/e2e/screenshots node tests/e2e/ui-smoke.cjs
//   TOUR=1 … node tests/e2e/ui-smoke.cjs   (visite de toutes les pages, ordinateur et téléphone)
// Variables : PLAYWRIGHT_MODULE (chemin du module playwright), CHROMIUM_PATH (navigateur à utiliser).
const { mkdirSync } = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.BASE ?? "http://localhost:8080";
const OUT = process.env.OUT ?? "tests/e2e/screenshots";
const LAUNCH = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
mkdirSync(OUT, { recursive: true });
const errors = [];

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(BASE);
  await page.getByText("Créez votre premier joueur").waitFor();
  await shot(page, "01-accueil-vide-desktop");

  // Création de deux joueurs via l'interface.
  await page.goto(`${BASE}/joueurs`);
  for (const name of ["Alice", "Bob"]) {
    await page.getByRole("button", { name: "Nouveau joueur" }).first().click();
    await page.getByLabel("Pseudo").fill(name);
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await page.getByRole("link", { name }).first().waitFor();
  }
  await shot(page, "02-joueurs");

  // Partie X01 301 en saisie manuelle.
  await page.goto(`${BASE}/jouer`);
  await page.getByRole("radio", { name: "301" }).click();
  // Alice, premier profil créé, est le profil actif : déjà sélectionnée.
  await page.getByRole("button", { name: /Alice.*1/ }).waitFor();
  await page.getByRole("button", { name: /Bob/ }).click();
  await page.getByRole("radio", { name: "Manuelle" }).click();
  await page.getByRole("button", { name: "Lancer la partie" }).click();
  await page.waitForURL(/\/partie\//);
  const pad = page.getByLabel("Saisie manuelle des fléchettes");
  const tap = async (mult, n) => {
    if (mult) await pad.getByRole("button", { name: mult, exact: true }).click();
    await pad.getByRole("button", { name: `${mult || "Simple"} ${n}`, exact: true }).click();
  };
  for (let i = 0; i < 3; i++) await tap("Triple", 20); // Alice 121
  await page.getByText("121", { exact: true }).first().waitFor();
  await shot(page, "03-partie-x01-desktop");
  for (let i = 0; i < 3; i++) await tap("", 1); // Bob 298
  await tap("Triple", 20); // Alice 61
  await tap("Triple", 7); // 40
  await page.getByText("D20").first().waitFor(); // checkout suggéré
  await shot(page, "04-checkout-suggere");
  await tap("Double", 20); // victoire
  await page.getByText("Victoire de Alice").waitFor();
  await shot(page, "05-victoire");

  // Statistiques.
  await page.goto(`${BASE}/statistiques`);
  await page.getByText("Moyenne 3 fléchettes").first().waitFor();
  await page.waitForTimeout(600);
  await shot(page, "06-statistiques-desktop");

  // Mode test Autodarts + partie liée, impacts simulés reçus en direct.
  await page.goto(`${BASE}/autodarts`);
  await page.getByRole("button", { name: "Démarrer le mode test" }).click();
  await page.getByText("SIMULATION").first().waitFor();
  await page.getByText("Connecté").first().waitFor({ timeout: 10000 });
  await shot(page, "07-autodarts-simulation");
  await page.goto(`${BASE}/jouer`);
  await page.getByRole("button", { name: /Alice.*1/ }).waitFor();
  await page.getByRole("radio", { name: "Autodarts" }).click();
  await page.getByRole("button", { name: "Lancer la partie" }).click();
  await page.waitForURL(/\/partie\//);
  await page.getByText("SIMULATION · hors statistiques").waitFor();
  const sim = (body) => page.evaluate((b) => fetch("/api/autodarts/simulation/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.status), body);
  await sim({ action: "throw", dart: "T20" });
  await sim({ action: "throw", dart: "T19" });
  await page.getByText("384", { exact: true }).first().waitFor({ timeout: 5000 });
  await shot(page, "08-partie-autodarts-direct");

  // Téléphone.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mp = await phone.newPage();
  mp.on("pageerror", (e) => errors.push(`mobile pageerror: ${e.message}`));
  await mp.goto(BASE);
  await mp.getByText("Derniers résultats").waitFor();
  await shot(mp, "09-accueil-telephone");
  await mp.goto(page.url());
  await mp.getByText("384", { exact: true }).first().waitFor();
  await shot(mp, "10-partie-telephone");
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) errors.push(`défilement horizontal sur téléphone : ${overflow}px`);
  await mp.goto(`${BASE}/statistiques`);
  await mp.getByText("Moyenne 3 fléchettes").first().waitFor();
  await shot(mp, "11-statistiques-telephone");
  const overflowStats = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflowStats > 1) errors.push(`défilement horizontal (stats) : ${overflowStats}px`);

  await browser.close();
  console.log(errors.length ? `ERREURS:\n${errors.join("\n")}` : "OK : parcours complet sans erreur");
})().then(() => process.env.TOUR && tour()).catch((e) => {
  console.error("ÉCHEC", e);
  console.log(errors.join("\n"));
  process.exit(1);
});

// Deuxième passage : toutes les pages, détection d'erreurs d'exécution.
async function tour() {
  const b = await chromium.launch(LAUNCH);
  const errs = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const p = await b.newPage({ viewport });
    p.on("pageerror", (e) => errs.push(`${viewport.width} ${p.url()} pageerror: ${e.message}`));
    p.on("console", (m) => m.type() === "error" && errs.push(`${viewport.width} ${p.url()} console: ${m.text()}`));
    for (const path of ["/", "/jouer", "/jouer?categorie=entrainement", "/entrainement", "/statistiques", "/joueurs", "/competitions", "/historique", "/autodarts", "/parametres", "/salle", "/plus"]) {
      await p.goto(`${BASE}${path}`);
      await p.waitForTimeout(700);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) errs.push(`${viewport.width} ${path} : défilement horizontal ${overflow}px`);
      await p.screenshot({ path: `${OUT}/tour-${viewport.width}${path.replace(/[/?=&]/g, "_") || "_home"}.png` });
    }
    // Jouer quelques modes pour vérifier l'affichage.
    for (const mode of ["cricket", "bobs_27", "killer"]) {
      await p.goto(`${BASE}/jouer?mode=${mode}${mode === "bobs_27" ? "&categorie=entrainement" : ""}`);
      await p.waitForTimeout(400);
    }
    await p.close();
  }
  await b.close();
  console.log(errs.length ? `TOUR ERREURS:\n${errs.join("\n")}` : "TOUR OK : toutes les pages sans erreur");
}

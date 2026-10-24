// Construit l'installateur Windows (NSIS) dans apps/desktop/release/. Fonctionne aussi depuis Linux
// ou macOS : aucun outil Windows n'est nécessaire. La version est celle du package.json racine.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Arch, build, Platform } from "electron-builder";

const { version } = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));

if (process.platform !== "win32") {
  // Pour produire le désinstallateur, electron-builder lance l'installateur sous Wine sous Linux ; sous
  // macOS, il l'extrait directement du fichier avec son propre lecteur (UninstallerReader). On utilise
  // ce même lecteur ici : Wine n'est pas nécessaire. Le chemin reproduit celui de NsisTarget.
  const require = createRequire(import.meta.url);
  const { WineVmManager } = require("app-builder-lib/out/vm/WineVm.js");
  const { UninstallerReader } = require("app-builder-lib/out/targets/nsis/nsisUtil.js");
  WineVmManager.prototype.exec = (installer) =>
    UninstallerReader.exec(installer, path.join(path.dirname(installer), `${path.basename(installer, "exe")}__uninstaller.exe`));
}

await build({
  targets: Platform.WINDOWS.createTarget("nsis", Arch.x64),
  config: {
    appId: "fr.dartsevolution.desktop",
    productName: "DARTS EVOLUTION",
    copyright: "DARTS EVOLUTION",
    extraMetadata: { version },
    directories: { output: "release", buildResources: "build" },
    files: ["dist/**", "package.json"],
    asar: true,
    compression: "maximum",
    // Interface en français : seules les traductions française et anglaise de Chromium sont gardées.
    electronLanguages: ["fr", "en-US"],
    // Pas de publication automatique (ni serveur de mises à jour) : le fichier est distribué à la main.
    publish: null,
    win: {
      icon: "build/icon.ico",
      artifactName: "DARTS-EVOLUTION-Setup-${version}.${ext}",
    },
    nsis: {
      // Installation en un clic, pour l'utilisateur courant : pas de droits administrateur.
      oneClick: true,
      perMachine: false,
      runAfterFinish: true,
      createDesktopShortcut: "always",
      createStartMenuShortcut: true,
      shortcutName: "DARTS EVOLUTION",
      installerIcon: "build/icon.ico",
      uninstallerIcon: "build/icon.ico",
      installerLanguages: ["fr_FR"],
      language: "1036",
      // La désinstallation garde %APPDATA%\DARTS EVOLUTION (adresse du serveur).
      deleteAppDataOnUninstall: false,
    },
  },
});

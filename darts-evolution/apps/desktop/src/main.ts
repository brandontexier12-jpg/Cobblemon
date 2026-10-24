import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, powerSaveBlocker, screen, session, shell, type IpcMainInvokeEvent, type WebContents } from "electron";
import { loadConfig, saveConfig } from "./config";
import { localScanHosts, probe, resolveServer, sameOrigin, scanServers } from "./net";

/**
 * Application Windows DARTS EVOLUTION : une fenêtre dédiée (sans barre d'adresse) qui affiche le
 * serveur DARTS EVOLUTION du NAS. Aucune donnée n'est stockée ici, hormis l'adresse du serveur et la
 * position de la fenêtre : joueurs, parties et statistiques restent sur le serveur.
 */

declare const __APP_VERSION__: string;

// Nom de l'application (dossier des réglages : %APPDATA%\DARTS EVOLUTION), avant tout accès aux chemins.
app.setName("DARTS EVOLUTION");
app.setAppUserModelId("fr.dartsevolution.desktop");

const SETUP_PAGE = path.join(__dirname, "setup.html");
const SETUP_URL = pathToFileURL(SETUP_PAGE).href;
const configFile = path.join(app.getPath("userData"), "config.json");
const config = loadConfig(configFile);
let win: BrowserWindow | null = null;
let awakeBlocker: number | null = null;

// Permet au serveur et à l'interface de reconnaître l'application Windows.
app.userAgentFallback = `${app.userAgentFallback} DartsEvolutionDesktop/${__APP_VERSION__}`;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start);
  app.on("window-all-closed", () => app.quit());
}

function start(): void {
  hardenSessions();
  registerIpc();
  buildMenu();
  createWindow();
  if (config.server) void connect(config.server);
  else showSetup("setup");
}

// ---------- Fenêtre ----------

function createWindow(): void {
  const bounds = visibleBounds(config.bounds);
  win = new BrowserWindow({
    ...(bounds ?? { width: 1400, height: 900 }),
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: "DARTS EVOLUTION",
    backgroundColor: "#0b0b0c",
    autoHideMenuBar: true,
    icon: process.platform === "linux" ? path.join(__dirname, "icon.png") : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      // Annonces vocales et sons des scores sans clic préalable (fléchettes détectées par Autodarts).
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  win.once("ready-to-show", () => {
    if (config.maximized) win?.maximize();
    win?.show();
  });
  win.on("close", () => {
    if (!win) return;
    config.maximized = win.isMaximized();
    if (!win.isFullScreen()) config.bounds = win.getNormalBounds();
    saveConfig(configFile, config);
  });
  win.on("closed", () => {
    win = null;
  });
  win.on("show", updateKeepAwake);
  win.on("hide", updateKeepAwake);
  win.on("minimize", updateKeepAwake);
  win.on("restore", updateKeepAwake);
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    // -3 : navigation annulée (rechargement, lien suivi) ; ce n'est pas une panne.
    if (isMainFrame && code !== -3 && config.server && sameOrigin(url, config.server)) showSetup("offline");
  });
  win.webContents.on("render-process-gone", () => {
    if (config.server) void connect(config.server);
  });
  updateKeepAwake();
}

/** Remet la fenêtre à l'écran si l'écran où elle était a disparu (deuxième écran débranché…). */
function visibleBounds(bounds: Electron.Rectangle | undefined): Electron.Rectangle | undefined {
  if (!bounds) return undefined;
  const area = screen.getDisplayMatching(bounds).workArea;
  const overlapX = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const overlapY = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return overlapX > 100 && overlapY > 100 ? bounds : undefined;
}

function updateKeepAwake(): void {
  const wanted = config.keepAwake && !!win && win.isVisible() && !win.isMinimized();
  if (wanted && awakeBlocker === null) awakeBlocker = powerSaveBlocker.start("prevent-display-sleep");
  if (!wanted && awakeBlocker !== null) {
    powerSaveBlocker.stop(awakeBlocker);
    awakeBlocker = null;
  }
}

type SetupMode = "setup" | "change" | "offline";

function showSetup(mode: SetupMode): void {
  const query: Record<string, string> = { mode };
  if (config.server) query.server = config.server;
  void win?.loadFile(SETUP_PAGE, { query });
}

/** Vérifie le serveur puis l'affiche ; page « serveur injoignable » sinon. */
async function connect(server: string): Promise<boolean> {
  const health = await probe(server, fetch);
  if (!win) return false;
  if (!health) {
    showSetup("offline");
    return false;
  }
  await win.loadURL(server).catch(() => undefined);
  return true;
}

// ---------- Sécurité ----------

/** Seules les pages du serveur configuré et l'écran de connexion s'affichent dans l'application. */
function isAllowedPage(url: string): boolean {
  return url.startsWith(SETUP_URL) || (!!config.server && sameOrigin(url, config.server));
}

function openOutside(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

function hardenSessions(): void {
  const allowed = new Set(["fullscreen", "clipboard-sanitized-write", "screen-wake-lock"]);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(allowed.has(permission) && isAllowedPage(contents.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) => allowed.has(permission) && !!contents && isAllowedPage(contents.getURL()));
  app.on("web-contents-created", (_e, contents: WebContents) => {
    contents.on("will-navigate", (event, url) => {
      if (isAllowedPage(url)) return;
      event.preventDefault();
      openOutside(url);
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      // Lien « nouvel onglet » vers le serveur (ex. /api/health) : nouvelle fenêtre de l'application.
      if (config.server && sameOrigin(url, config.server)) {
        return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: "#0b0b0c", webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } } };
      }
      openOutside(url);
      return { action: "deny" };
    });
  });
}

// ---------- Écran de connexion (IPC) ----------

/** Les commandes ne sont acceptées que depuis l'écran de connexion local, jamais depuis le serveur. */
function fromSetup(event: IpcMainInvokeEvent): boolean {
  return !!event.senderFrame && event.senderFrame.url.startsWith(SETUP_URL);
}

function registerIpc(): void {
  ipcMain.handle("desktop:info", (event) => {
    if (!fromSetup(event)) return null;
    return { version: __APP_VERSION__, server: config.server };
  });
  ipcMain.handle("desktop:connect", async (event, input: unknown) => {
    if (!fromSetup(event) || typeof input !== "string" || input.length > 300) return { ok: false, error: "Adresse invalide." };
    const found = await resolveServer(input, fetch);
    if (!found) return { ok: false, error: "Aucun serveur DARTS EVOLUTION ne répond à cette adresse." };
    config.server = found.url;
    saveConfig(configFile, config);
    buildMenu();
    await connect(found.url);
    return { ok: true, url: found.url };
  });
  ipcMain.handle("desktop:scan", async (event) => {
    if (!fromSetup(event)) return [];
    return scanServers(localScanHosts(os.networkInterfaces()), fetch);
  });
  ipcMain.handle("desktop:retry", async (event) => {
    if (!fromSetup(event) || !config.server) return false;
    return connect(config.server);
  });
}

// ---------- Menu ----------

function buildMenu(): void {
  const onServer = () => !!win && !!config.server && sameOrigin(win.webContents.getURL(), config.server);
  const menu = Menu.buildFromTemplate([
    {
      label: "DARTS EVOLUTION",
      submenu: [
        { label: "Accueil", accelerator: "Alt+Home", enabled: !!config.server, click: () => config.server && void connect(config.server) },
        { label: "Changer de serveur…", click: () => showSetup(config.server ? "change" : "setup") },
        { type: "separator" },
        { label: "Quitter", role: "quit" },
      ],
    },
    {
      label: "Affichage",
      submenu: [
        { label: "Recharger", accelerator: "CmdOrCtrl+R", click: () => (onServer() ? win?.webContents.reload() : config.server && void connect(config.server)) },
        { label: "Plein écran", accelerator: "F11", click: () => win?.setFullScreen(!win.isFullScreen()) },
        { type: "separator" },
        { label: "Zoom avant", role: "zoomIn", accelerator: "CmdOrCtrl+=" },
        { label: "Zoom arrière", role: "zoomOut" },
        { label: "Taille normale", role: "resetZoom" },
        { type: "separator" },
        {
          label: "Garder l'écran allumé",
          type: "checkbox",
          checked: config.keepAwake,
          click: (item) => {
            config.keepAwake = item.checked;
            saveConfig(configFile, config);
            updateKeepAwake();
          },
        },
      ],
    },
    {
      label: "Aide",
      submenu: [
        { label: "Ouvrir dans le navigateur", enabled: !!config.server, click: () => config.server && openOutside(win && onServer() ? win.webContents.getURL() : config.server) },
        { label: "Outils de développement", role: "toggleDevTools", accelerator: "CmdOrCtrl+Shift+I" },
        { type: "separator" },
        {
          label: "À propos de DARTS EVOLUTION",
          click: () =>
            void dialog.showMessageBox(win!, {
              type: "info",
              title: "À propos",
              message: `DARTS EVOLUTION pour Windows ${__APP_VERSION__}`,
              detail: `Serveur : ${config.server ?? "non configuré"}\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}\n\nJoueurs, parties et statistiques sont enregistrés sur le serveur, pas sur ce PC.`,
            }),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

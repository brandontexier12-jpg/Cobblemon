// Écran de connexion de l'application Windows : première configuration, changement de serveur et
// page « serveur injoignable » avec nouvel essai automatique.

interface DesktopBridge {
  info(): Promise<{ version: string; server: string | null } | null>;
  connect(address: string): Promise<{ ok: boolean; error?: string; url?: string }>;
  scan(): Promise<{ url: string; version: string }[]>;
  retry(): Promise<boolean>;
}

const desktop = (window as unknown as { desktop: DesktopBridge }).desktop;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "setup";
const server = params.get("server");

for (const el of document.querySelectorAll<HTMLElement>("[data-server]")) el.textContent = server ?? "";
void desktop.info().then((info) => {
  if (info) $("version").textContent = `Version ${info.version}`;
});

function showSetup(change: boolean): void {
  $("offline").hidden = true;
  $("setup").hidden = false;
  $("setup-title").textContent = change ? "Changer de serveur" : "Connexion à votre serveur";
  $("cancel").hidden = !change;
  const input = $<HTMLInputElement>("address");
  if (server && !input.value) input.value = server;
  input.focus();
  input.select();
}

async function connect(address: string): Promise<void> {
  const button = $<HTMLButtonElement>("connect");
  button.disabled = true;
  button.textContent = "Connexion…";
  $("error").textContent = "";
  const result = await desktop.connect(address);
  // En cas de succès, la fenêtre affiche déjà le serveur.
  if (!result.ok) {
    $("error").textContent = result.error ?? "Connexion impossible.";
    button.disabled = false;
    button.textContent = "Se connecter";
  }
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  void connect($<HTMLInputElement>("address").value);
});

$("scan").addEventListener("click", async () => {
  const button = $<HTMLButtonElement>("scan");
  const list = $("found");
  button.disabled = true;
  button.textContent = "Recherche en cours…";
  list.replaceChildren();
  $("error").textContent = "";
  const servers = await desktop.scan();
  button.disabled = false;
  button.textContent = "Rechercher sur le réseau";
  if (!servers.length) {
    $("error").textContent = "Aucun serveur trouvé sur le port 8080 de ce réseau. Tapez l'adresse à la main.";
    return;
  }
  for (const s of servers) {
    const item = document.createElement("li");
    const pick = document.createElement("button");
    pick.type = "button";
    const url = document.createElement("span");
    url.className = "mono";
    url.textContent = s.url;
    const version = document.createElement("span");
    version.textContent = `DARTS EVOLUTION ${s.version}`;
    pick.append(url, version);
    pick.addEventListener("click", () => {
      $<HTMLInputElement>("address").value = s.url;
      void connect(s.url);
    });
    item.append(pick);
    list.append(item);
  }
});

$("cancel").addEventListener("click", () => void desktop.retry());
$("change").addEventListener("click", () => {
  stopRetry();
  showSetup(true);
});

// ---------- Serveur injoignable : nouvel essai toutes les 5 secondes ----------

let timer: number | undefined;
function stopRetry(): void {
  window.clearInterval(timer);
  $("countdown").textContent = "";
}

async function retryNow(): Promise<void> {
  const button = $<HTMLButtonElement>("retry");
  button.disabled = true;
  $("countdown").textContent = "Connexion…";
  if (!(await desktop.retry())) {
    button.disabled = false;
    startCountdown();
  }
}

function startCountdown(): void {
  let left = 5;
  window.clearInterval(timer);
  $("countdown").textContent = `Nouvel essai dans ${left} s.`;
  timer = window.setInterval(() => {
    left--;
    if (left > 0) {
      $("countdown").textContent = `Nouvel essai dans ${left} s.`;
      return;
    }
    window.clearInterval(timer);
    void retryNow();
  }, 1000);
}

$("retry").addEventListener("click", () => {
  window.clearInterval(timer);
  void retryNow();
});

if (mode === "offline" && server) {
  $("offline").hidden = false;
  startCountdown();
} else {
  showSetup(mode === "change");
}

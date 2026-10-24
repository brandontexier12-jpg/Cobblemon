// Service worker de l'application installée. Volontairement minimal : aucune page ni donnée n'est
// mise en cache (l'interface et les scores viennent toujours du serveur, ce qui évite d'afficher une
// ancienne version après une mise à jour). Il ne sert qu'à afficher une page claire quand le serveur
// est injoignable (téléphone hors du wifi de la maison, NAS éteint ou en cours de redémarrage).
const CACHE = "darts-evolution-hors-ligne-1";
const OFFLINE = ["/offline.html", "/offline.js", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
});

import { useSyncExternalStore } from "react";

/**
 * Application installée (téléphone, tablette, ordinateur) : enregistrement du service worker et
 * bouton « Installer » quand le navigateur le propose (Chrome, Edge, Samsung Internet sur une
 * adresse https). Safari (iPhone, iPad) n'a pas de bouton : l'installation passe par « Partager ».
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setupInstall(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
  // Les service workers n'existent que sur une adresse sécurisée (https ou localhost).
  if (import.meta.env.PROD && "serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined));
  }
}

/** Vrai quand le navigateur propose l'installation (bouton « Installer l'application »). */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => deferred !== null,
  );
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  notify();
  await event.prompt();
  return (await event.userChoice).outcome === "accepted";
}

export type Platform = "ios" | "android" | "desktop";

export function platform(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

/** Ouverte depuis l'icône de l'écran d'accueil, ou dans l'application Windows. */
export function isInstalledApp(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    isDesktopApp()
  );
}

export function isDesktopApp(): boolean {
  return navigator.userAgent.includes("DartsEvolutionDesktop/");
}

/** Adresse utilisable depuis un autre appareil du réseau (pas « localhost »). */
export function isLocalOnlyHost(hostname = location.hostname): boolean {
  return hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || hostname.startsWith("127.");
}

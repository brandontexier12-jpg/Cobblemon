import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Réglages de l'application Windows, dans %APPDATA%\DARTS EVOLUTION\config.json. */
export interface DesktopConfig {
  /** Origine du serveur DARTS EVOLUTION (ex. http://192.168.1.50:8080). */
  server: string | null;
  bounds?: { x: number; y: number; width: number; height: number };
  maximized: boolean;
  /** Empêche la mise en veille de l'écran tant que la fenêtre est affichée. */
  keepAwake: boolean;
}

const DEFAULTS: DesktopConfig = { server: null, maximized: true, keepAwake: true };

export function loadConfig(file: string): DesktopConfig {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<DesktopConfig>;
    return {
      server: typeof raw.server === "string" ? raw.server : null,
      bounds: raw.bounds && [raw.bounds.x, raw.bounds.y, raw.bounds.width, raw.bounds.height].every(Number.isFinite) ? raw.bounds : undefined,
      maximized: raw.maximized ?? DEFAULTS.maximized,
      keepAwake: raw.keepAwake ?? DEFAULTS.keepAwake,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Écriture atomique : un arrêt brutal ne laisse pas un fichier à moitié écrit. */
export function saveConfig(file: string, config: DesktopConfig): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2));
  renameSync(tmp, file);
}

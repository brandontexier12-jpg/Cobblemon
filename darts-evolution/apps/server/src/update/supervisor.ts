import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { chooseTarget, markFailure, markReady, readState, RESTART_EXIT_CODE, serverEntry, SUPERVISOR_PROTOCOL, writeState, type RunTarget } from "./releases.js";

export interface SupervisorOptions {
  /** Version du serveur intégré à l'image. */
  builtinVersion: string;
  /** Point d'entrée du serveur intégré. */
  builtinEntry: string;
  /** Dossier des versions installées. */
  releasesRoot: string;
  /** Options de Node transmises au serveur (avertissements, mémoire…). */
  nodeArgs?: string[];
  env?: NodeJS.ProcessEnv;
  /** Délai maximal pour qu'une version démarre (signal « prêt »). */
  readyTimeoutMs?: number;
  log?: (message: string) => void;
}

/**
 * Lanceur superviseur : exécute le serveur dans un processus enfant, le relance quand il le demande
 * (installation d'une mise à jour, code 75) et revient automatiquement à la version précédente si une
 * version installée ne démarre pas. Se termine avec le code du serveur dans les autres cas (la
 * politique de redémarrage de Docker prend alors le relais).
 */
export function supervise(options: SupervisorOptions): Promise<number> {
  const log = options.log ?? ((m: string) => console.log(`darts-evolution : ${m}`));
  const readyTimeout = options.readyTimeoutMs ?? 180_000;
  let child: ChildProcess | null = null;
  let stopping = false;

  return new Promise<number>((resolve) => {
    const forward = (signal: NodeJS.Signals) => {
      stopping = true;
      if (child && child.exitCode === null) child.kill(signal);
      else resolve(0);
    };
    const onTerm = () => forward("SIGTERM");
    const onInt = () => forward("SIGINT");
    process.on("SIGTERM", onTerm);
    process.on("SIGINT", onInt);
    const finish = (code: number) => {
      process.off("SIGTERM", onTerm);
      process.off("SIGINT", onInt);
      resolve(code);
    };

    const start = () => {
      const current = readState(options.releasesRoot);
      const chosen = chooseTarget(current, options.builtinVersion, options.releasesRoot);
      const state = chosen.state;
      if (state !== current) writeState(options.releasesRoot, state);
      const target: RunTarget = chosen.target;
      const entry = target.kind === "installed" ? serverEntry(target.dir) : options.builtinEntry;
      const previousLabel = state.previous ?? options.builtinVersion;
      const env: NodeJS.ProcessEnv = {
        ...(options.env ?? process.env),
        DE_SUPERVISED: "1",
        DE_SUPERVISOR_PROTOCOL: String(SUPERVISOR_PROTOCOL),
        DE_BUILTIN_VERSION: options.builtinVersion,
        DE_RUNNING: target.kind,
      };
      if (target.kind === "installed") env.WEB_DIST_PATH = `${target.dir}/web`;
      log(`démarrage de la version ${target.version}${target.kind === "installed" ? " (installée par mise à jour)" : ""}${state.pending ? " — première exécution" : ""}`);

      let ready = false;
      const proc = spawn(process.execPath, [...(options.nodeArgs ?? []), entry], { env, stdio: ["inherit", "inherit", "inherit", "ipc"] });
      child = proc;
      // Seule une version installée est surveillée : un serveur bloqué au démarrage est abandonné.
      const timer = setTimeout(() => {
        if (!ready && target.kind === "installed") {
          log(`la version ${target.version} n'a pas signalé son démarrage en ${Math.round(readyTimeout / 1000)} s : arrêt.`);
          proc.kill("SIGKILL");
        }
      }, readyTimeout);
      timer.unref();

      proc.on("message", (message: unknown) => {
        if (ready || (message as { type?: string })?.type !== "ready") return;
        ready = true;
        clearTimeout(timer);
        if (target.kind === "installed") {
          const before = readState(options.releasesRoot);
          const after = markReady(before, target.version, previousLabel);
          if (after !== before) writeState(options.releasesRoot, after);
        }
      });

      proc.on("exit", (code, signal) => {
        clearTimeout(timer);
        child = null;
        if (stopping) return finish(code ?? 0);
        if (code === RESTART_EXIT_CODE) {
          log("redémarrage demandé par l'application.");
          return start();
        }
        const reason = signal ? `signal ${signal}` : `code de sortie ${code}`;
        // Un arrêt propre (code 0) après démarrage n'est pas un échec de la version.
        if (target.kind === "installed" && (code !== 0 || !ready)) {
          const failure = markFailure(readState(options.releasesRoot), target.version, ready ? reason : `${reason} avant d'être prêt`, previousLabel);
          writeState(options.releasesRoot, failure.state);
          if (failure.rolledBack) {
            log(failure.state.lastResult?.message ?? "retour à la version précédente.");
            try {
              rmSync(target.dir, { recursive: true, force: true });
            } catch {
              // Le dossier sera de toute façon ignoré.
            }
            return start();
          }
        }
        log(`le serveur s'est arrêté (${reason}).`);
        finish(code ?? 1);
      });
    };

    start();
  });
}

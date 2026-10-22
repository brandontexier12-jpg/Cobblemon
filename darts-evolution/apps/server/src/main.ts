import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { RESTART_EXIT_CODE } from "./update/releases.js";

const config = loadConfig();
const built = await buildApp(config, { onRestartRequested: () => void shutdown("mise à jour", RESTART_EXIT_CODE) });
const address = await built.listen();
built.app.log.info(`DARTS EVOLUTION ${config.version} prêt sur ${address} (port ${config.port}).`);
// Signale au lanceur du conteneur que cette version a démarré correctement.
process.send?.({ type: "ready", version: config.version });

let stopping = false;
async function shutdown(reason: string, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  built.app.log.info(`Arrêt demandé (${reason})…`);
  const force = setTimeout(() => process.exit(exitCode || 1), 10_000);
  force.unref();
  try {
    await built.close();
  } finally {
    process.exit(exitCode);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

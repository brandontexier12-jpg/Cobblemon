import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const built = await buildApp(config);
const address = await built.listen();
built.app.log.info(`DARTS EVOLUTION ${config.version} prêt sur ${address} (port ${config.port}).`);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  built.app.log.info(`Arrêt demandé (${signal})…`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    await built.close();
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

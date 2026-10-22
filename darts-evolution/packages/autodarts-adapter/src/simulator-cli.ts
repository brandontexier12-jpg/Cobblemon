/**
 * Lance un simulateur de Board Manager pour essayer l'intégration sans matériel.
 * Usage : npm run simulator -- --port 3180 --generation 2 [--host 0.0.0.0] [--no-throw-data]
 */
import { BoardManagerSimulator } from "./simulator.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

const sim = new BoardManagerSimulator({
  port: Number(arg("port", "3180")),
  host: arg("host", "127.0.0.1"),
  generation: arg("generation", "2") === "1" ? 1 : 2,
  omitThrowData: process.argv.includes("--no-throw-data"),
});

await sim.start();
console.log(`Simulateur Board Manager (SIMULATION) v${sim.version} sur ${sim.url} — page de contrôle : ${sim.url}/`);
process.on("SIGINT", () => void sim.stop().then(() => process.exit(0)));
process.on("SIGTERM", () => void sim.stop().then(() => process.exit(0)));

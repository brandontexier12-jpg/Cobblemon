/**
 * Enregistre le flux réel du Board Manager Autodarts dans un fichier JSON (format des jeux d'essai),
 * et affiche en direct les événements normalisés que DARTS EVOLUTION en déduit.
 *
 * Usage : npm run capture -w @darts-evolution/autodarts-adapter -- --host 192.168.1.50 [--port 3180] [--out capture.json]
 * Arrêt : Ctrl+C (le fichier est écrit à l'arrêt).
 *
 * L'état du Board Manager ne contient pas de secret ; seuls les messages de type « state » sont enregistrés.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { BoardManagerClient } from "./client.js";
import { EnvelopeSchema, parseBoardState } from "./protocol.js";
import { BoardTracker } from "./tracker.js";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const host = arg("host");
if (!host) {
  console.error("Indiquez l'adresse du Board Manager : --host 192.168.1.50");
  process.exit(1);
}
const port = Number(arg("port", "3180"));
const out = arg("out", `capture-autodarts-${new Date().toISOString().replace(/[:.]/g, "-")}.json`) as string;
const client = new BoardManagerClient({ host, port, protocol: "http" });
const tracker = new BoardTracker({ source: "autodarts", simulated: false, sessionId: randomBytes(3).toString("hex") });
const messages: { receivedAt: string; message: unknown }[] = [];

const version = await client.getVersion();
const initial = await client.getState();
console.log(`Board Manager ${version?.version ?? "(version inconnue)"} — détection ${initial.running ? "active" : "arrêtée"}, ${initial.numThrows} fléchette(s) sur la cible.`);
tracker.baseline(initial);

const ws = client.openEvents();
ws.on("open", () => console.log(`Écoute de ${client.url}/api/events … lancez des fléchettes, retirez-les, puis Ctrl+C.`));
ws.on("message", (data) => {
  let json: unknown;
  try {
    json = JSON.parse(data.toString());
  } catch {
    console.log("! message non JSON");
    return;
  }
  const env = EnvelopeSchema.safeParse(json);
  if (!env.success || env.data.type !== "state") return;
  messages.push({ receivedAt: new Date().toISOString(), message: json });
  const parsed = parseBoardState(env.data.data);
  if (!parsed.ok) {
    console.log(`! état invalide : ${parsed.reason}`);
    return;
  }
  for (const reason of parsed.invalidThrows) console.log(`! ${reason}`);
  for (const e of tracker.live(parsed.value)) {
    if (e.kind === "throw") console.log(`→ impact ${e.throw.segmentName} (${e.throw.score} pts, position ${e.throw.slot + 1})`);
    else if (e.kind === "throw-corrected") console.log(`→ correction position ${e.throw.slot + 1} : ${e.throw.segmentName}`);
    else console.log(`→ ${e.kind}`);
  }
});
ws.on("error", (err) => console.error(`Erreur WebSocket : ${err.message}`));

function save() {
  writeFileSync(out, JSON.stringify({ description: "Capture réelle", version: version?.version ?? null, capturedAt: new Date().toISOString(), messages: messages.map((m) => m.message), timeline: messages.map((m) => m.receivedAt) }, null, 2));
  console.log(`\n${messages.length} message(s) enregistrés dans ${out}`);
  process.exit(0);
}
process.on("SIGINT", save);
process.on("SIGTERM", save);

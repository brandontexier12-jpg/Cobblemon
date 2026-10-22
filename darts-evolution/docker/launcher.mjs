// Lanceur du conteneur : prépare les dossiers persistants, abandonne les droits root (PUID/PGID)
// puis démarre le serveur dans le même processus. Aucune dépendance système supplémentaire.
import { chownSync, lstatSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const puid = Number(process.env.PUID ?? 1000);
const pgid = Number(process.env.PGID ?? 1000);
const dataDir = path.dirname(process.env.DATABASE_PATH ?? "/app/data/darts-evolution.db");
const backupDir = process.env.BACKUP_PATH ?? "/app/backups";

function chownTree(dir) {
  chownSync(dir, puid, pgid);
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) chownTree(full);
    else chownSync(full, puid, pgid);
  }
}

if (typeof process.getuid === "function" && process.getuid() === 0) {
  if (!Number.isInteger(puid) || !Number.isInteger(pgid) || puid < 0 || pgid < 0) {
    console.error("PUID / PGID invalides.");
    process.exit(1);
  }
  for (const dir of [dataDir, backupDir]) {
    mkdirSync(dir, { recursive: true });
    const st = statSync(dir);
    // Ne parcourt le dossier que si son propriétaire ne correspond pas.
    if (st.uid !== puid || st.gid !== pgid) {
      console.log(`darts-evolution : attribution de ${dir} à ${puid}:${pgid}`);
      chownTree(dir);
    }
  }
  process.setgroups([pgid]);
  process.setgid(pgid);
  process.setuid(puid);
}

await import("/app/server/server.mjs");

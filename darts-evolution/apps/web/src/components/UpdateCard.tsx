import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { Icon } from "./Icon";
import { Badge, Button, Card, useUi } from "./ui";

interface UpdateResult {
  version: string;
  from: string;
  outcome: "installed" | "rolled_back" | "reverted";
  message: string;
  at: string;
}

interface UpdateStatus {
  version: string;
  builtinVersion: string;
  running: "builtin" | "installed";
  supported: boolean;
  adminConfigured: boolean;
  revertTo: string | null;
  lastResult: UpdateResult | null;
  maxPackageMb: number;
}

type Step =
  | { kind: "idle" }
  | { kind: "sending"; file: string }
  | { kind: "restarting"; target: string; since: number }
  | { kind: "done"; version: string; reverted: boolean }
  | { kind: "failed"; message: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attend que le serveur redémarre, puis renvoie la version qui répond. */
async function waitForRestart(previous: string, timeoutMs: number): Promise<string | null> {
  const start = Date.now();
  let sawDown = false;
  while (Date.now() - start < timeoutMs) {
    await sleep(1500);
    try {
      const health = await api.get<{ status: string; version: string; uptimeSeconds: number }>("/api/health");
      // Redémarré : coupure observée, autre version, ou serveur lancé après la demande.
      const restarted = sawDown || health.version !== previous || health.uptimeSeconds < (Date.now() - start) / 1000;
      if (health.status === "ok" && restarted) return health.version;
    } catch {
      sawDown = true;
    }
  }
  return null;
}

/** Mise à jour de l'application en envoyant le fichier .zip fourni. */
export function UpdateCard({ isAdmin }: { isAdmin: boolean }) {
  const { confirm } = useUi();
  const status = useAsync(() => api.get<UpdateStatus>("/api/update"), []);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (step.kind !== "restarting") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - step.since) / 1000)), 1000);
    return () => clearInterval(t);
  }, [step]);

  const s = status.data;
  const busy = step.kind === "sending" || step.kind === "restarting";

  const afterRestart = async (target: string, current: string, reverted = false) => {
    setStep({ kind: "restarting", target, since: Date.now() });
    const version = await waitForRestart(current, 4 * 60_000);
    if (version === target) {
      setStep({ kind: "done", version, reverted });
      setTimeout(() => window.location.reload(), 2500);
      return;
    }
    let message = version
      ? `Le serveur a redémarré en version ${version} au lieu de ${target}.`
      : "Le serveur ne répond pas encore. Patientez puis rechargez la page ; consultez les journaux du conteneur si le problème persiste.";
    try {
      const fresh = await api.get<UpdateStatus>("/api/update");
      if (fresh.lastResult && fresh.lastResult.outcome !== "installed") message = fresh.lastResult.message;
    } catch {
      // Message générique conservé.
    }
    setStep({ kind: "failed", message });
    status.reload();
  };

  const install = async (file: File) => {
    if (!s) return;
    if (!/\.zip$/i.test(file.name)) {
      setStep({ kind: "failed", message: "Choisissez le fichier .zip de mise à jour (par exemple darts-evolution-1.3.0.zip)." });
      return;
    }
    const ok = await confirm({
      title: "Installer cette mise à jour ?",
      message: `« ${file.name} » va être vérifié puis installé. Une sauvegarde de la base est créée, puis l'application redémarre (environ 10 secondes) : les parties en cours sont conservées. Si la nouvelle version ne démarre pas, l'ancienne est rétablie automatiquement.`,
      confirmLabel: "Installer",
    });
    if (!ok) return;
    setStep({ kind: "sending", file: file.name });
    try {
      const result = await api.upload<{ version: string; from: string }>("/api/update", file);
      await afterRestart(result.version, result.from);
    } catch (e) {
      setStep({ kind: "failed", message: (e as Error).message });
    }
  };

  const revert = async () => {
    if (!s?.revertTo) return;
    const ok = await confirm({
      title: `Revenir à la version ${s.revertTo} ?`,
      message: "L'application redémarre sur la version précédente. Les données ne sont pas modifiées (une sauvegarde « Avant mise à jour » reste disponible).",
      confirmLabel: "Revenir",
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.post<{ version: string }>("/api/update/revert");
      await afterRestart(r.version, s.version, true);
    } catch (e) {
      setStep({ kind: "failed", message: (e as Error).message });
    }
  };

  return (
    <Card title="Mise à jour de l'application">
      {!s ? (
        <p className="text-sm text-ink-400">Chargement…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              Version installée : <strong>{s.version}</strong>
            </span>
            {s.running === "installed" && <Badge tone="info">installée depuis l'application</Badge>}
          </div>

          {s.lastResult && step.kind === "idle" && (
            <p className={`rounded-xl border p-3 text-sm ${s.lastResult.outcome === "rolled_back" ? "border-critical/50 bg-critical/10 text-[#ffb4b4]" : "border-ink-700 bg-ink-900 text-ink-300"}`}>
              {s.lastResult.message} <span className="text-ink-400">({fmtDateTime(s.lastResult.at)})</span>
            </p>
          )}

          {!s.supported ? (
            <p className="text-sm text-ink-300">
              La mise à jour en un clic fonctionne dans le conteneur Docker de DARTS EVOLUTION à partir de la version 1.2.0. Ici, suivez la procédure manuelle (documentation,
              « Mise à jour sans perte de données »).
            </p>
          ) : !s.adminConfigured ? (
            <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              Définissez un mot de passe administrateur (<code>ADMIN_PASSWORD</code> dans le fichier <code>.env</code>, puis redémarrez le projet) : il protège
              l'installation des mises à jour.
            </p>
          ) : !isAdmin ? (
            <p className="text-sm text-ink-300">Connectez-vous en administrateur (carte « Administration ») pour installer une mise à jour.</p>
          ) : (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void install(file);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon="upload" disabled={busy} onClick={() => fileRef.current?.click()}>
                  Installer une mise à jour (.zip)
                </Button>
                {s.revertTo && (
                  <Button variant="ghost" icon="undo" disabled={busy} onClick={revert}>
                    Revenir à la version {s.revertTo}
                  </Button>
                )}
              </div>
              <p className="text-xs text-ink-400">
                Fichier <code>darts-evolution-X.Y.Z.zip</code> fourni avec chaque version (le même que pour la mise à jour manuelle), sans le décompresser. Taille
                maximale : {s.maxPackageMb} Mo.
              </p>
            </>
          )}

          {step.kind === "sending" && (
            <p className="flex items-center gap-2 text-sm text-ink-200" role="status">
              <Icon name="upload" size={16} /> Envoi et vérification de « {step.file} »…
            </p>
          )}
          {step.kind === "restarting" && (
            <p className="flex items-center gap-2 text-sm text-ink-200" role="status">
              <Icon name="refresh" size={16} className="animate-spin" /> Version {step.target} : redémarrage en cours… ({elapsed} s)
            </p>
          )}
          {step.kind === "done" && (
            <p className="rounded-xl border border-good/50 bg-good/10 p-3 text-sm text-[#9be09b]" role="status">
              ✓ Version {step.version} {step.reverted ? "rétablie" : "installée"}. Rechargement de la page…
            </p>
          )}
          {step.kind === "failed" && (
            <p className="rounded-xl border border-critical/50 bg-critical/10 p-3 text-sm text-[#ffb4b4]" role="alert">
              {step.message}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

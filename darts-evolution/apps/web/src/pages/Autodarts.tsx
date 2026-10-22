import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { autodartsLabel } from "../components/AutodartsStatus";
import { CalibrateButton } from "../components/CalibrateButton";
import { Icon } from "../components/Icon";
import { Badge, Button, Card, Field, inputClass, PageHeader, Segmented, Toggle, useUi } from "../components/ui";
import { api } from "../lib/api";
import { useAppState } from "../lib/app-state";
import { fmtDateTime } from "../lib/format";
import { useAsync, useSocketEvent } from "../lib/hooks";
import { getSocket } from "../lib/socket";

interface TestResult {
  ok: boolean;
  url: string | null;
  version: string | null;
  generation: 1 | 2 | null;
  versionSupported: boolean | null;
  running: boolean | null;
  boardStatus: string | null;
  dartsOnBoard: number | null;
  throwDataAvailable: boolean | null;
  websocket: boolean;
  diagnostic: { code: string; message: string; hint: string } | null;
  warnings: string[];
}

interface JournalEntry {
  id: number;
  receivedAt: string;
  kind: string;
  provider: string;
  simulated: boolean;
  summary: Record<string, unknown>;
  matchId: string | null;
  outcome: string;
}

const SIM_DARTS = ["T20", "T19", "T18", "S20", "S5", "S1", "D20", "D16", "D8", "25", "BULL", "MISS"];

export function AutodartsPage() {
  const { autodarts, refreshAutodarts, auth } = useAppState();
  const { toast } = useUi();
  const [form, setForm] = useState({ enabled: false, host: "", port: 3180, protocol: "http" as "http" | "https" });
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const journal = useAsync(() => api.get<JournalEntry[]>("/api/autodarts/journal?limit=80"), []);

  useEffect(() => {
    if (autodarts) setForm({ enabled: autodarts.enabled, host: autodarts.config.host, port: autodarts.config.port, protocol: autodarts.config.protocol });
  }, [autodarts?.enabled, autodarts?.config.host, autodarts?.config.port, autodarts?.config.protocol]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    getSocket().emit("autodarts:watch");
  }, []);
  useSocketEvent("autodarts:journal", () => journal.reload());

  const save = async () => {
    try {
      await api.put("/api/autodarts/config", form);
      await refreshAutodarts();
      toast("Configuration Autodarts enregistrée.", "good");
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const runTest = async () => {
    setTesting(true);
    try {
      setTest(await api.post<TestResult>("/api/autodarts/test", { host: form.host, port: form.port, protocol: form.protocol }));
    } catch (e) {
      toast((e as Error).message, "critical");
    } finally {
      setTesting(false);
    }
  };
  const simAction = async (body: Record<string, unknown>) => {
    try {
      await api.post("/api/autodarts/simulation/action", body);
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const toggleSimulation = async () => {
    try {
      await api.post(`/api/autodarts/simulation/${autodarts?.simulation ? "stop" : "start"}`);
      await refreshAutodarts();
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };

  const status = autodarts?.status;
  const info = autodartsLabel(autodarts);
  const locked = auth.adminConfigured && !auth.isAdmin;

  return (
    <div className="space-y-5">
      <PageHeader title="Intégration Autodarts" subtitle="Détection automatique des impacts via l'API locale du Board Manager Autodarts." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="État de la connexion">
          <div className={`flex items-center gap-2 text-2xl font-semibold ${info.tone}`}>
            <Icon name={info.icon} size={26} /> {info.label}
            {autodarts?.simulation && <Badge tone="warning">SIMULATION</Badge>}
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-400">Adresse</dt>
            <dd className="break-all">{status?.target ?? "–"}</dd>
            <dt className="text-ink-400">Version</dt>
            <dd>
              {status?.version ?? "–"}
              {status?.generation ? ` (Board Manager ${status.generation})` : ""}
            </dd>
            <dt className="text-ink-400">Détection</dt>
            <dd>{status?.running === true ? "Démarrée" : status?.running === false ? "Arrêtée" : "–"}</dd>
            <dt className="text-ink-400">Statut cible</dt>
            <dd>
              {status?.boardStatus ?? "–"}
              {status?.boardEvent ? ` · ${status.boardEvent}` : ""}
            </dd>
            <dt className="text-ink-400">Dernier événement</dt>
            <dd>{fmtDateTime(status?.lastMessageAt)}</dd>
            <dt className="text-ink-400">Dernière détection</dt>
            <dd>
              {status?.lastThrow ?? "–"} {status?.lastThrowAt ? `(${fmtDateTime(status.lastThrowAt)})` : ""}
            </dd>
            <dt className="text-ink-400">Partie liée</dt>
            <dd>{autodarts?.boundMatchId ? <Link className="text-brand-400 hover:underline" to={`/partie/${autodarts.boundMatchId}`}>Ouvrir la partie</Link> : "Aucune"}</dd>
            <dt className="text-ink-400">Tentatives</dt>
            <dd>{status?.reconnectAttempts ?? 0}</dd>
          </dl>
          {status?.lastError && (
            <div className="mt-3 rounded-xl border border-critical/40 bg-critical/10 p-3 text-sm">
              <p className="font-semibold text-[#ffb4b4]">⚠ {status.lastError.message}</p>
              <p className="mt-1 text-ink-200">{status.lastError.hint}</p>
            </div>
          )}
          {status?.warnings?.map((w) => (
            <p key={w} className="mt-2 rounded-xl border border-warning/40 bg-warning/10 p-2 text-sm text-warning">
              ⚠ {w.replace(/^\[[^\]]+\]\s*/, "")}
            </p>
          ))}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" icon="refresh" onClick={() => refreshAutodarts()}>
              Actualiser
            </Button>
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => api.post("/api/autodarts/reset-board").then(() => toast("Reset envoyé à la cible.", "good")).catch((e: Error) => toast(e.message, "critical"))}>
              Réinitialiser la cible
            </Button>
          </div>
        </Card>

        <CalibrationCard />

        <Card title="Configuration">
          {locked && (
            <p className="mb-3 flex items-center gap-2 rounded-xl bg-ink-900 p-3 text-sm text-ink-300">
              <Icon name="lock" size={16} /> Connexion administrateur requise pour modifier la configuration (Paramètres).
            </p>
          )}
          <div className="space-y-3">
            <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Activer l'intégration Autodarts" />
            <Field label="Adresse IP ou nom d'hôte de la machine Autodarts" hint="Machine qui exécute le Board Manager (pas « localhost » si elle est différente du NAS).">
              <input className={inputClass} placeholder="192.168.1.50" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value.trim() })} />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Field label="Port" hint="3180 par défaut">
                <input type="number" className={`${inputClass} w-32`} min={1} max={65535} value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
              </Field>
              <Field label="Protocole">
                <Segmented size="sm" value={form.protocol} onChange={(v) => setForm({ ...form, protocol: v })} options={[{ value: "http", label: "HTTP" }, { value: "https", label: "HTTPS" }]} />
              </Field>
            </div>
            <p className="text-xs text-ink-400">Aucune clé ni identifiant n'est demandé : l'API locale du Board Manager n'utilise pas d'authentification. Ne saisissez jamais vos identifiants de compte Autodarts.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon="check" onClick={save} disabled={locked}>
                Enregistrer
              </Button>
              <Button icon="plug" onClick={runTest} disabled={testing || !form.host || locked}>
                {testing ? "Test en cours…" : "Tester la connexion"}
              </Button>
            </div>
          </div>
          {test && (
            <div className={`mt-4 rounded-xl border p-3 text-sm ${test.ok ? "border-good/50 bg-good/10" : "border-critical/40 bg-critical/10"}`}>
              <p className="font-semibold">{test.ok ? "✓ Connexion réussie" : "✗ Connexion impossible"}</p>
              {test.diagnostic && (
                <>
                  <p className="mt-1">{test.diagnostic.message}</p>
                  <p className="text-ink-300">{test.diagnostic.hint}</p>
                </>
              )}
              <ul className="mt-2 space-y-0.5 text-ink-200">
                {test.url && <li>Adresse testée : {test.url}</li>}
                {test.version && (
                  <li>
                    Version : {test.version} {test.versionSupported ? "(forme vérifiée)" : "(non vérifiée)"}
                  </li>
                )}
                {test.running !== null && <li>Détection : {test.running ? "démarrée" : "arrêtée"}</li>}
                {test.dartsOnBoard !== null && <li>Fléchettes sur la cible : {test.dartsOnBoard}</li>}
                {test.throwDataAvailable !== null && <li>Détail des lancers : {test.throwDataAvailable ? "disponible" : "absent"}</li>}
                <li>WebSocket /api/events : {test.websocket ? "ouvert" : "indisponible"}</li>
                {test.warnings.map((w) => (
                  <li key={w} className="text-warning">
                    ⚠ {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card title="Mode test (simulation)">
        <p className="mb-3 text-sm text-ink-300">
          Remplace temporairement le Board Manager par un simulateur local qui reproduit le protocole observé (v2.0.2). Les parties lancées en saisie Autodarts pendant
          ce mode sont marquées <strong>SIMULATION</strong> et exclues des statistiques. Ce mode ne remplace pas un test avec le matériel réel.
        </p>
        <Button variant={autodarts?.simulation ? "danger" : "secondary"} icon="refresh" onClick={toggleSimulation} disabled={locked}>
          {autodarts?.simulation ? "Arrêter le mode test" : "Démarrer le mode test"}
        </Button>
        {autodarts?.simulation && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {SIM_DARTS.map((d) => (
                <Button key={d} size="sm" onClick={() => simAction({ action: "throw", dart: d })}>
                  {d === "MISS" ? "Raté" : d === "BULL" ? "Bull" : d}
                </Button>
              ))}
              <Button size="sm" onClick={() => simAction({ action: "throw", dart: "MISS", bouncer: true })}>
                Rebond
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => simAction({ action: "takeout" })}>
                Retrait des fléchettes
              </Button>
              <Button size="sm" onClick={() => simAction({ action: "correct", slot: 0, dart: "T20" })}>
                Correction (1re → T20)
              </Button>
              <Button size="sm" onClick={() => simAction({ action: "reset" })}>
                Reset manuel
              </Button>
              <Button size="sm" onClick={() => simAction({ action: "duplicate" })}>
                Message dupliqué
              </Button>
              <Button size="sm" onClick={() => simAction({ action: "invalid" })}>
                Message invalide
              </Button>
              <Button size="sm" onClick={() => simAction({ action: "disconnect" })}>
                Couper la connexion
              </Button>
              <Button size="sm" onClick={() => simAction({ action: "stop-detection" })}>
                Arrêter la détection
              </Button>
              <Button size="sm" onClick={() => simAction({ action: "start-detection" })}>
                Démarrer la détection
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Journal des événements" action={<Button size="sm" variant="ghost" icon="refresh" onClick={journal.reload}>Actualiser</Button>}>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 bg-ink-850 text-left text-ink-400">
              <tr>
                <th className="py-2">Heure</th>
                <th>Type</th>
                <th>Détail</th>
                <th>Traitement</th>
              </tr>
            </thead>
            <tbody>
              {journal.data?.map((j) => (
                <tr key={j.id} className="border-t border-ink-800 align-top">
                  <td className="whitespace-nowrap py-1.5 text-ink-400">{new Date(j.receivedAt).toLocaleTimeString("fr-FR")}</td>
                  <td>
                    {j.kind} {j.simulated && <Badge tone="warning">SIM</Badge>}
                  </td>
                  <td className="text-ink-300">
                    {Object.entries(j.summary)
                      .filter(([k, v]) => v !== null && k !== "eventId")
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(" · ")}
                  </td>
                  <td className={j.outcome.startsWith("ignoré") || j.outcome.startsWith("refusé") ? "text-warning" : "text-ink-100"}>{j.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {journal.data?.length === 0 && <p className="py-4 text-ink-400">Aucun événement pour l'instant.</p>}
        </div>
      </Card>

      <Card title="Compatibilité et limites">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-300">
          <li>{autodarts?.compatibility}</li>
          <li>L'API locale (port 3180, WebSocket /api/events) n'est pas documentée officiellement par Autodarts : une mise à jour du Board Manager peut la modifier. La dépendance est isolée dans le module « autodarts-adapter ».</li>
          <li>Certaines installations Autodarts 2.x ont été signalées sans détail des lancers en local : l'application le détecte et l'indique ; la saisie manuelle reste toujours disponible.</li>
          <li>L'API cloud d'Autodarts (compte en ligne) n'est pas utilisée : elle n'est pas publiquement documentée et exigerait vos identifiants.</li>
          <li>Une visite se termine au retrait des fléchettes (« Takeout finished ») ou par un reset manuel ; les fléchettes non détectées sont comptées ratées et restent corrigeables.</li>
        </ul>
      </Card>
    </div>
  );
}

/** Calibration automatique des caméras par l'API locale d'Autodarts. */
function CalibrationCard() {
  const { autodarts } = useAppState();
  const cameras = useAsync(() => api.get<{ count: number | null }>("/api/autodarts/cameras"), [autodarts?.status.state]);
  const running = !!autodarts?.calibrating || autodarts?.status.boardStatus === "Calibrating";
  const count = cameras.data?.count ?? 0;
  return (
    <Card title="Calibration des caméras">
      <p className="text-sm text-ink-300">
        Relance la calibration automatique d'Autodarts sans quitter l'application, par exemple si des impacts sont mal détectés ou après avoir bougé la cible ou une
        caméra. Retirez les fléchettes avant de lancer ; la calibration dure jusqu'à une minute et les impacts ne sont pas comptés pendant ce temps.
      </p>
      {running && (
        <p className="mt-3 flex items-center gap-2 rounded-xl border border-[#3987e5]/40 bg-[#3987e5]/10 p-2 text-sm text-[#9ec5f4]">
          <Icon name="refresh" size={16} className="animate-spin" /> Calibration en cours…
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <CalibrateButton size="md" label="Calibration automatique (toutes les caméras)" />
        {Array.from({ length: count }, (_, i) => (
          <CalibrateButton key={i} camera={i} />
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-400">
        Caméra par caméra : calibration avec correction de la distorsion de l'objectif. Commande envoyée à Autodarts : <code>POST /api/config/calibration/auto</code>.
      </p>
    </Card>
  );
}

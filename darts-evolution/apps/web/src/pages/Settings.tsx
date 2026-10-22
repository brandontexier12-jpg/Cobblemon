import { useRef, useState } from "react";
import { Badge, Button, Card, Field, inputClass, PageHeader, Segmented, Stepper, useUi } from "../components/ui";
import { UpdateCard } from "../components/UpdateCard";
import { api } from "../lib/api";
import { useAppState } from "../lib/app-state";
import { fmtDateTime } from "../lib/format";
import { useAsync, useLocalPreference } from "../lib/hooks";

interface SettingsResponse {
  general: { checkoutStrategy: "classique" | "bull" | "double_favori"; activePlayerId: string | null };
  backup: { intervalHours: number; retention: number; lastBackupAt: string | null; path: string };
  adminConfigured: boolean;
  version: string;
  schemaVersion: number;
}

interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
  reason: string;
}

const REASON_LABEL: Record<string, string> = {
  auto: "Automatique",
  manuelle: "Manuelle",
  "pre-migration": "Avant migration",
  "pre-restauration": "Avant restauration",
  "pre-mise-a-jour": "Avant mise à jour",
};

export function SettingsPage() {
  const { auth, refreshAuth, players, activePlayerId, setActivePlayer } = useAppState();
  const { toast, confirm } = useUi();
  const settings = useAsync(() => api.get<SettingsResponse>("/api/settings"), []);
  const backups = useAsync(() => (auth.isAdmin ? api.get<BackupFile[]>("/api/backups") : Promise.resolve([] as BackupFile[])), [auth.isAdmin]);
  const csvTables = useAsync(() => api.get<string[]>("/api/export/csv"), []);
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useLocalPreference("deviceName", "Appareil");
  const fileRef = useRef<HTMLInputElement>(null);

  const login = async () => {
    try {
      await api.post("/api/auth/login", { password });
      setPassword("");
      await refreshAuth();
      toast("Connecté en administrateur.", "good");
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const logout = async () => {
    await api.post("/api/auth/logout");
    await refreshAuth();
  };
  const saveGeneral = async (patch: Partial<SettingsResponse["general"]>) => {
    try {
      await api.put("/api/settings/general", patch);
      settings.reload();
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const saveBackup = async (patch: Partial<SettingsResponse["backup"]>) => {
    try {
      await api.put("/api/settings/backup", patch);
      settings.reload();
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const createBackup = async () => {
    try {
      await api.post("/api/backups");
      backups.reload();
      toast("Sauvegarde créée.", "good");
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const restore = async (name: string) => {
    if (!(await confirm({ title: "Restaurer cette sauvegarde ?", message: `Les données actuelles seront remplacées par « ${name} ». Une sauvegarde de sécurité de l'état actuel est créée automatiquement avant la restauration.`, confirmLabel: "Restaurer", danger: true }))) return;
    try {
      await api.post(`/api/backups/${encodeURIComponent(name)}/restore`);
      toast("Sauvegarde restaurée. Rechargement…", "good");
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const upload = async (file: File) => {
    if (!(await confirm({ title: "Restaurer depuis ce fichier ?", message: `Le fichier « ${file.name} » remplacera les données actuelles (une sauvegarde de sécurité est créée avant).`, confirmLabel: "Restaurer", danger: true }))) return;
    try {
      await api.upload("/api/backups/upload-restore", file);
      toast("Sauvegarde restaurée. Rechargement…", "good");
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const del = async (name: string) => {
    if (!(await confirm({ title: "Supprimer cette sauvegarde ?", message: name, danger: true, confirmLabel: "Supprimer" }))) return;
    await api.del(`/api/backups/${encodeURIComponent(name)}`);
    backups.reload();
  };

  const s = settings.data;
  return (
    <div className="space-y-5">
      <PageHeader title="Paramètres" subtitle="Administration, sauvegardes, exports et préférences." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Administration">
          {!auth.adminConfigured ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              ⚠ Aucun mot de passe administrateur n'est défini : sauvegardes, restauration et configuration Autodarts sont accessibles à tout appareil du réseau. Définissez la
              variable <code>ADMIN_PASSWORD</code> dans la configuration Docker.
            </div>
          ) : auth.isAdmin ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="good">Connecté en administrateur</Badge>
              <Button size="sm" onClick={logout}>
                Se déconnecter
              </Button>
            </div>
          ) : (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void login();
              }}
            >
              <Field label="Mot de passe administrateur">
                <input type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Button variant="primary" type="submit" disabled={!password}>
                Se connecter
              </Button>
            </form>
          )}
        </Card>

        <Card title="Préférences">
          <div className="space-y-4">
            <Field label="Profil actif">
              <select className={inputClass} value={activePlayerId ?? ""} onChange={(e) => void setActivePlayer(e.target.value || null)}>
                <option value="">Aucun</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            {s && (
              <Field label="Stratégie de checkout par défaut (calculateur)">
                <Segmented
                  value={s.general.checkoutStrategy}
                  onChange={(v) => saveGeneral({ checkoutStrategy: v })}
                  options={[
                    { value: "classique", label: "Classique" },
                    { value: "bull", label: "Bull" },
                    { value: "double_favori", label: "Double favori" },
                  ]}
                />
              </Field>
            )}
            <Field label="Nom de cet appareil (salles multi-appareils)">
              <input className={inputClass} value={deviceName} maxLength={32} onChange={(e) => setDeviceName(e.target.value)} />
            </Field>
          </div>
        </Card>
      </div>

      <Card title="Sauvegardes">
        {!auth.isAdmin ? (
          <p className="text-ink-300">Connectez-vous en administrateur pour gérer les sauvegardes.</p>
        ) : (
          <div className="space-y-4">
            {s && (
              <div className="flex flex-wrap items-end gap-6">
                <Field label="Sauvegarde automatique toutes les (heures)" hint="0 = désactivée">
                  <Stepper value={s.backup.intervalHours} min={0} max={168} onChange={(v) => saveBackup({ intervalHours: v })} />
                </Field>
                <Field label="Sauvegardes automatiques conservées" hint="Les sauvegardes manuelles ne sont jamais supprimées automatiquement.">
                  <Stepper value={s.backup.retention} min={1} max={365} onChange={(v) => saveBackup({ retention: v })} />
                </Field>
                <div className="text-sm text-ink-300">
                  Dernière sauvegarde automatique : {fmtDateTime(s.backup.lastBackupAt)}
                  <br />
                  Dossier : <code className="text-ink-200">{s.backup.path}</code>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon="download" onClick={createBackup}>
                Sauvegarder maintenant
              </Button>
              <Button icon="upload" onClick={() => fileRef.current?.click()}>
                Restaurer depuis un fichier…
              </Button>
              <input ref={fileRef} type="file" accept=".db,.sqlite,application/octet-stream" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-ink-400">
                  <tr>
                    <th className="py-2">Fichier</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>Taille</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {backups.data?.map((b) => (
                    <tr key={b.name} className="border-t border-ink-800">
                      <td className="py-2 font-mono text-xs">{b.name}</td>
                      <td>{REASON_LABEL[b.reason] ?? b.reason}</td>
                      <td>{fmtDateTime(b.createdAt)}</td>
                      <td>{(b.size / 1024).toFixed(0)} Ko</td>
                      <td className="flex justify-end gap-1 py-1">
                        <a href={`/api/backups/${encodeURIComponent(b.name)}`}>
                          <Button size="sm" variant="ghost" icon="download" aria-label="Télécharger" />
                        </a>
                        <Button size="sm" icon="refresh" onClick={() => restore(b.name)}>
                          Restaurer
                        </Button>
                        <Button size="sm" variant="ghost" icon="trash" aria-label="Supprimer" onClick={() => del(b.name)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {backups.data?.length === 0 && <p className="py-3 text-ink-400">Aucune sauvegarde pour l'instant.</p>}
            </div>
          </div>
        )}
      </Card>

      <UpdateCard isAdmin={auth.isAdmin} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Exports">
          <div className="flex flex-wrap gap-2">
            {auth.isAdmin && (
              <a href="/api/export/json">
                <Button icon="download">Export complet (JSON)</Button>
              </a>
            )}
            {csvTables.data?.map((t) => (
              <a key={t} href={`/api/export/csv/${t}`}>
                <Button variant="ghost" icon="download">
                  CSV — {t}
                </Button>
              </a>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-400">Fichiers CSV au séparateur « ; » (Excel / LibreOffice en français).</p>
        </Card>
        <Card title="À propos">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-400">Version</dt>
            <dd>DARTS EVOLUTION {s?.version}</dd>
            <dt className="text-ink-400">Schéma de base</dt>
            <dd>v{s?.schemaVersion}</dd>
            <dt className="text-ink-400">Santé</dt>
            <dd>
              <a className="text-brand-400 hover:underline" href="/api/health" target="_blank" rel="noreferrer">
                /api/health
              </a>
            </dd>
          </dl>
        </Card>
      </div>
    </div>
  );
}

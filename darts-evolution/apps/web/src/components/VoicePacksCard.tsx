import { useRef, useState } from "react";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { announce, unlockAudio } from "../lib/sounds";
import { voiceUrl, type VoicePackInfo } from "../lib/use-game-sounds";
import { Icon } from "./Icon";
import { Button, Card, inputClass, useUi } from "./ui";

type Role = keyof VoicePackInfo["roles"];

const ROLES: { role: Role; label: string; hint: string }[] = [
  { role: "gameon", label: "Début de partie / de leg", hint: "« Game on ! »" },
  { role: "leg", label: "Leg gagné", hint: "sinon : score de la sortie" },
  { role: "match", label: "Match gagné", hint: "sinon : son du leg gagné" },
  { role: "bust", label: "Bust", hint: "sinon : son « 0 » (No score)" },
  { role: "next", label: "Joueur suivant", hint: "joué avant le nom du joueur" },
];

/** Nom lisible tiré du nom de fichier (sans extension ni empreinte). */
function nameFromFile(file: string): string {
  return (
    file
      .replace(/\.zip$/i, "")
      .split(/[.\s_]+/)
      .filter((part) => part && !/^[0-9a-f]{20,}$/i.test(part) && !/^media$/i.test(part))
      .join(" ")
      .slice(0, 60) || "Pack de voix"
  );
}

function play(packId: string, key: string) {
  unlockAudio();
  window.setTimeout(() => announce({ url: voiceUrl(packId, key) }), 50);
}

function PlayButton({ packId, keyName, label }: { packId: string; keyName: string; label?: string }) {
  return (
    <button
      type="button"
      className="press inline-flex min-h-9 items-center gap-1 rounded-lg border border-ink-600 bg-ink-900 px-2 text-sm text-ink-200 hover:border-ink-500"
      onClick={() => play(packId, keyName)}
      title={`Écouter « ${keyName} »`}
    >
      <Icon name="volume" size={14} /> {label ?? keyName}
    </button>
  );
}

/** Packs de voix de l'annonceur : import, écoute, attribution des sons spéciaux. */
export function VoicePacksCard({ canEdit }: { canEdit: boolean }) {
  const { toast, confirm } = useUi();
  const packs = useAsync(() => api.get<VoicePackInfo[]>("/api/voices"), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState("180");

  const upload = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await api.upload<{ pack: VoicePackInfo; converted: string[]; skipped: { file: string; reason: string }[] }>(
        `/api/voices?name=${encodeURIComponent(name || nameFromFile(pending.name))}`,
        pending,
      );
      const extra = [
        r.converted.length ? `${r.converted.length} converti(s) pour le navigateur` : "",
        r.skipped.length ? `${r.skipped.length} fichier(s) ignoré(s) : ${r.skipped.map((s) => `${s.file} (${s.reason})`).join(", ")}` : "",
      ].filter(Boolean);
      toast(`Pack « ${r.pack.name} » importé : ${r.pack.scores} scores.${extra.length ? ` ${extra.join(" ; ")}.` : ""}`, "good");
      setPending(null);
      setName("");
      packs.reload();
    } catch (e) {
      toast((e as Error).message, "critical");
    } finally {
      setBusy(false);
    }
  };

  const setRole = async (pack: VoicePackInfo, role: Role, key: string) => {
    try {
      await api.put(`/api/voices/${pack.id}/roles`, { [role]: key || null });
      packs.reload();
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };

  const remove = async (pack: VoicePackInfo) => {
    if (!(await confirm({ title: `Supprimer le pack « ${pack.name} » ?`, message: "Les fichiers audio du pack sont supprimés du NAS.", confirmLabel: "Supprimer", danger: true }))) return;
    try {
      await api.del(`/api/voices/${pack.id}`);
      packs.reload();
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };

  return (
    <Card title="Packs de voix de l'annonceur">
      <p className="mb-3 text-sm text-ink-300">
        Remplacez la voix de synthèse par de vrais enregistrements : un fichier .zip contenant un son par score (<code>0.wav</code> à <code>180.wav</code>, aussi
        MP3 ou OGG) et des sons spéciaux (<code>gameon.wav</code>…). Les packs restent sur votre NAS. Choix du pack : bouton haut-parleur pendant une partie.
      </p>

      {packs.data?.map((pack) => (
        <div key={pack.id} className="mb-3 rounded-xl border border-ink-700 bg-ink-900 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Icon name="voice" className="text-brand-400" />
            <span className="font-semibold">{pack.name}</span>
            <span className="text-sm text-ink-400">
              {pack.scores} scores{pack.missingScores.length ? ` · manquants : ${pack.missingScores.slice(0, 12).join(", ")}${pack.missingScores.length > 12 ? "…" : ""}` : " · tous les scores possibles"}
            </span>
            {canEdit && (
              <Button size="sm" variant="ghost" icon="trash" className="ml-auto" onClick={() => remove(pack)}>
                Supprimer
              </Button>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-400">Écouter un score :</span>
            <input className={`${inputClass} !w-24`} inputMode="numeric" value={sample} onChange={(e) => setSample(e.target.value.replace(/\D/g, "").slice(0, 3))} aria-label="Score à écouter" />
            {pack.files[sample] ? <PlayButton packId={pack.id} keyName={sample} label="Écouter" /> : <span className="text-ink-500">pas de son pour ce score</span>}
          </div>

          {pack.others.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-400">Sons spéciaux :</span>
              {pack.others.map((k) => (
                <PlayButton key={k} packId={pack.id} keyName={k} />
              ))}
            </div>
          )}

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {ROLES.map(({ role, label, hint }) => (
              <label key={role} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-44 text-ink-300">
                  {label}
                  <span className="block text-xs text-ink-500">{hint}</span>
                </span>
                <select
                  className={`${inputClass} w-auto min-w-28 flex-1`}
                  value={pack.roles[role] ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => void setRole(pack, role, e.target.value)}
                >
                  <option value="">(aucun)</option>
                  {[...pack.others, ...(pack.files["0"] ? ["0"] : [])].map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      ))}

      {packs.data?.length === 0 && <p className="mb-3 text-sm text-ink-400">Aucun pack importé : l'annonceur utilise la voix de l'appareil.</p>}

      {canEdit ? (
        <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) {
                setPending(file);
                setName(nameFromFile(file.name));
              }
            }}
          />
          {pending ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-sm text-ink-300">Nom du pack ({pending.name})</span>
                <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              </label>
              <Button variant="primary" icon="upload" disabled={busy} onClick={upload}>
                {busy ? "Import…" : "Importer"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
                Annuler
              </Button>
            </div>
          ) : (
            <Button icon="upload" onClick={() => fileRef.current?.click()}>
              Importer un pack de voix (.zip)
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-400">Connectez-vous en administrateur pour importer ou modifier un pack.</p>
      )}
    </Card>
  );
}

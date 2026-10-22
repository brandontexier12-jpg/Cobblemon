import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { autodartsLabel } from "../components/AutodartsStatus";
import { ModeOptionsForm } from "../components/ModeOptions";
import { PlayerPicker } from "../components/PlayerPicker";
import { Button, Card, PageHeader, Segmented, useUi } from "../components/ui";
import { api } from "../lib/api";
import { useAppState } from "../lib/app-state";
import type { GameModeId, MatchSnapshot } from "../lib/types";

/** Configuration d'une partie ou d'une séance d'entraînement. */
export function PlayPage({ category: forced }: { category?: "game" | "training" }) {
  const { modes, activePlayerId, autodarts } = useAppState();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useUi();
  const [category, setCategory] = useState<"game" | "training">(forced ?? (search.get("categorie") === "entrainement" ? "training" : "game"));
  const [mode, setMode] = useState<GameModeId>((search.get("mode") as GameModeId) || (forced === "training" ? "doubles_training" : "x01"));
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [inputMode, setInputMode] = useState<"manual" | "autodarts">("manual");
  const [starting, setStarting] = useState(false);

  const def = modes.find((m) => m.id === mode);
  const list = useMemo(() => modes.filter((m) => m.category === category), [modes, category]);

  useEffect(() => {
    if (def) setOptions(structuredClone(def.defaults ?? {}));
    const preset = search.get("options");
    if (preset) {
      try {
        setOptions((o) => ({ ...o, ...JSON.parse(preset) }));
      } catch {
        /* préréglage illisible : options par défaut */
      }
    }
  }, [mode, def?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activePlayerId && playerIds.length === 0) setPlayerIds([activePlayerId]);
  }, [activePlayerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (autodarts?.status.state === "connected") setInputMode("autodarts");
  }, [autodarts?.status.state]);

  const start = async () => {
    setStarting(true);
    try {
      const created = await api.post<MatchSnapshot>("/api/matches", { mode, options, playerIds, inputMode });
      navigate(`/partie/${created.match.id}`);
    } catch (e) {
      toast((e as Error).message, "critical");
    } finally {
      setStarting(false);
    }
  };

  const adInfo = autodartsLabel(autodarts);
  const tooFew = def ? playerIds.length < def.minPlayers : true;
  return (
    <div>
      <PageHeader title={category === "training" ? "Nouvelle séance" : "Jouer"} subtitle="Choisissez le mode, les options et les joueurs." />
      {!forced && (
        <div className="mb-4">
          <Segmented
            value={category}
            onChange={(c) => {
              setCategory(c);
              setMode(c === "training" ? "doubles_training" : "x01");
            }}
            options={[
              { value: "game", label: "Jeux" },
              { value: "training", label: "Entraînements" },
            ]}
          />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card title="Mode">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  aria-pressed={m.id === mode}
                  className={`press rounded-xl border p-3 text-left ${m.id === mode ? "border-brand-500 bg-brand-500/10" : "border-ink-700 bg-ink-900 hover:border-ink-500"}`}
                >
                  <div className="font-display text-xl font-bold">{m.name}</div>
                  <div className="text-sm text-ink-300">{m.summary}</div>
                </button>
              ))}
            </div>
          </Card>
          {def && (
            <Card title={`Options — ${def.name}`}>
              <ModeOptionsForm mode={mode} options={options} onChange={setOptions} />
              <details className="mt-4 rounded-xl border border-ink-700 bg-ink-900 p-3">
                <summary className="cursor-pointer font-medium text-ink-200">Règles du mode</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-300">
                  {def.rules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </details>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card title="Joueurs">
            <PlayerPicker selected={playerIds} onChange={setPlayerIds} max={def?.maxPlayers ?? 8} />
            {def && tooFew && <p className="mt-2 text-sm text-warning">{def.name} se joue à {def.minPlayers} joueur(s) minimum.</p>}
          </Card>
          <Card title="Saisie des scores">
            <Segmented
              value={inputMode}
              onChange={setInputMode}
              options={[
                { value: "manual", label: "Manuelle" },
                { value: "autodarts", label: "Autodarts" },
              ]}
            />
            <p className="mt-2 text-sm text-ink-300">
              {inputMode === "autodarts"
                ? `Autodarts : ${adInfo.label}${autodarts?.simulation ? " (mode test : partie simulée, exclue des statistiques)" : ""}. Vous pourrez repasser en saisie manuelle à tout moment.`
                : "Saisie au pavé tactile, sur cet appareil ou tout appareil ayant rejoint la salle."}
            </p>
          </Card>
          <Button variant="primary" size="lg" className="w-full" icon="play" disabled={tooFew || starting} onClick={start}>
            {starting ? "Préparation…" : category === "training" ? "Démarrer la séance" : "Lancer la partie"}
          </Button>
        </div>
      </div>
    </div>
  );
}

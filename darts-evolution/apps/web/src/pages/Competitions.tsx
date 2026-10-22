import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ModeOptionsForm } from "../components/ModeOptions";
import { PlayerPicker } from "../components/PlayerPicker";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, inputClass, Modal, PageHeader, Segmented, Spinner, Stepper, Toggle, useUi } from "../components/ui";
import { api } from "../lib/api";
import { useAppState } from "../lib/app-state";
import { fmtDate } from "../lib/format";
import { useAsync } from "../lib/hooks";
import type { Competition, MatchSnapshot } from "../lib/types";

interface CompetitionSummary {
  id: string;
  name: string;
  format: Competition["format"];
  status: Competition["status"];
  winnerId: string | null;
  createdAt: string;
  players: number;
}

export function CompetitionsPage() {
  const { modes, players } = useAppState();
  const navigate = useNavigate();
  const { toast } = useUi();
  const list = useAsync(() => api.get<CompetitionSummary[]>("/api/competitions"), []);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("Tournoi du vendredi");
  const [format, setFormat] = useState<Competition["format"]>("knockout");
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [options, setOptions] = useState<Record<string, unknown>>(() => ({ ...(modes.find((m) => m.id === "x01")?.defaults ?? { startScore: 501, outRule: "double", legs: 2 }), legs: 2 }));
  const [seeding, setSeeding] = useState<"order" | "random">("random");
  const [doubleRound, setDoubleRound] = useState(false);
  const [pointsWin, setPointsWin] = useState(2);

  const create = async () => {
    try {
      const comp = await api.post<Competition>("/api/competitions", { name, format, playerIds, matchOptions: options, seeding, doubleRound, pointsWin });
      setCreating(false);
      navigate(`/competitions/${comp.id}`);
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const nameOf = (id: string | null) => players.find((p) => p.id === id)?.name ?? "";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Compétitions"
        subtitle="Tournois à élimination directe et championnats toutes rondes, organisés localement."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            Nouvelle compétition
          </Button>
        }
      />
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data?.length === 0 && <EmptyState title="Aucune compétition">Créez un tournoi ou un championnat entre les joueurs de la maison.</EmptyState>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.data?.map((c) => (
          <Link key={c.id} to={`/competitions/${c.id}`} className="press rounded-2xl border border-ink-700 bg-ink-850 p-4 hover:border-brand-500/60">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-2xl font-bold">{c.name}</span>
              <Badge tone={c.status === "active" ? "brand" : "neutral"}>{c.status === "active" ? "En cours" : "Terminée"}</Badge>
            </div>
            <p className="text-sm text-ink-300">
              {c.format === "knockout" ? "Élimination directe" : "Toutes rondes"} · {c.players} joueurs · {fmtDate(c.createdAt)}
            </p>
            {c.winnerId && <p className="mt-1 text-brand-300">🏆 {nameOf(c.winnerId)}</p>}
          </Link>
        ))}
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Nouvelle compétition"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Annuler
            </Button>
            <Button variant="primary" onClick={create} disabled={playerIds.length < 2 || !name.trim()}>
              Créer
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nom">
            <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Format">
            <Segmented
              value={format}
              onChange={setFormat}
              options={[
                { value: "knockout", label: "Élimination directe" },
                { value: "round_robin", label: "Toutes rondes" },
              ]}
            />
          </Field>
          <Field label="Joueurs">
            <PlayerPicker selected={playerIds} onChange={setPlayerIds} max={32} />
          </Field>
          {format === "knockout" ? (
            <Field label="Tirage" hint="Ordre de sélection = têtes de série ; les meilleures têtes de série sont exemptées si le nombre de joueurs n'est pas une puissance de 2.">
              <Segmented
                value={seeding}
                onChange={setSeeding}
                options={[
                  { value: "random", label: "Aléatoire" },
                  { value: "order", label: "Ordre de sélection" },
                ]}
              />
            </Field>
          ) : (
            <div className="flex flex-wrap items-end gap-6">
              <Field label="Points pour une victoire">
                <Stepper value={pointsWin} min={1} max={10} onChange={setPointsWin} />
              </Field>
              <Toggle checked={doubleRound} onChange={setDoubleRound} label="Matchs aller et retour" />
            </div>
          )}
          <div className="rounded-xl border border-ink-700 p-3">
            <p className="mb-3 font-medium">Format des matchs (X01)</p>
            <ModeOptionsForm mode="x01" options={options} onChange={setOptions} />
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function CompetitionDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { toast, confirm } = useUi();
  const { autodarts } = useAppState();
  const comp = useAsync(() => api.get<Competition>(`/api/competitions/${id}`), [id]);
  const [result, setResult] = useState<Competition["fixtures"][number] | null>(null);
  const [scores, setScores] = useState({ s1: 0, s2: 0, winner: "" });

  if (comp.error) return <ErrorBox message={comp.error} onRetry={comp.reload} />;
  if (!comp.data) return <Spinner />;
  const c = comp.data;
  const nameOf = (pid: string | null) => (pid ? (c.players.find((p) => p.id === pid)?.name ?? "?") : "À déterminer");
  const rounds = [...new Set(c.fixtures.map((f) => f.round))];
  const roundLabel = (r: number) => {
    if (c.format === "round_robin") return `Journée ${r}`;
    const remaining = rounds.length - r;
    return remaining === 0 ? "Finale" : remaining === 1 ? "Demi-finales" : remaining === 2 ? "Quarts de finale" : `Tour ${r}`;
  };
  const play = async (fixtureId: string) => {
    try {
      const snapshot = await api.post<MatchSnapshot>(`/api/competitions/${c.id}/fixtures/${fixtureId}/start`, { inputMode: autodarts?.status.state === "connected" ? "autodarts" : "manual" });
      navigate(`/partie/${snapshot.match.id}`);
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const saveResult = async () => {
    if (!result) return;
    try {
      comp.setData(await api.post<Competition>(`/api/competitions/${c.id}/fixtures/${result.id}/result`, { winnerId: scores.winner || null, score1: scores.s1, score2: scores.s2 }));
      setResult(null);
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={c.name}
        subtitle={`${c.format === "knockout" ? "Élimination directe" : "Toutes rondes"} · X01 ${String(c.matchOptions.startScore ?? 501)} · premier à ${String(c.matchOptions.legs ?? 1)} leg(s)`}
        actions={
          <>
            <a href={`/api/competitions/${c.id}/export.csv`}>
              <Button icon="download">Exporter (CSV)</Button>
            </a>
            <Button
              variant="ghost"
              icon="trash"
              onClick={async () => {
                if (await confirm({ title: "Supprimer la compétition ?", message: "Le tableau et les résultats de la compétition seront supprimés. Les parties jouées restent dans l'historique.", danger: true, confirmLabel: "Supprimer" })) {
                  try {
                    await api.del(`/api/competitions/${c.id}`);
                    navigate("/competitions");
                  } catch (e) {
                    toast((e as Error).message, "critical");
                  }
                }
              }}
            >
              Supprimer
            </Button>
          </>
        }
      />
      {c.winnerId && (
        <div className="rounded-2xl border border-brand-500/50 bg-brand-900 p-4 font-display text-2xl font-bold text-brand-300">🏆 Vainqueur : {nameOf(c.winnerId)}</div>
      )}

      {c.standings && (
        <Card title="Classement">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-ink-400">
                <tr>
                  <th className="py-2">#</th>
                  <th>Joueur</th>
                  <th>J</th>
                  <th>G</th>
                  <th>N</th>
                  <th>P</th>
                  <th>Legs</th>
                  <th>Diff.</th>
                  <th>Pts</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {c.standings.map((s, i) => (
                  <tr key={s.playerId} className="border-t border-ink-800">
                    <td className="font-display py-2 text-lg font-bold text-brand-400">{i + 1}</td>
                    <td>{s.name}</td>
                    <td>{s.played}</td>
                    <td>{s.won}</td>
                    <td>{s.drawn}</td>
                    <td>{s.lost}</td>
                    <td>
                      {s.legsFor}–{s.legsAgainst}
                    </td>
                    <td>{s.legDiff > 0 ? `+${s.legDiff}` : s.legDiff}</td>
                    <td className="font-bold">{s.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className={c.format === "knockout" ? "flex gap-4 overflow-x-auto pb-2" : "space-y-4"}>
        {rounds.map((r) => (
          <div key={r} className={c.format === "knockout" ? "min-w-64 flex-1 space-y-3" : ""}>
            <h2 className="font-display mb-2 text-xl font-semibold uppercase text-ink-300">{roundLabel(r)}</h2>
            <div className={c.format === "knockout" ? "flex flex-col justify-around gap-3" : "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"}>
              {c.fixtures
                .filter((f) => f.round === r)
                .map((f) => (
                  <div key={f.id} className="rounded-xl border border-ink-700 bg-ink-850 p-3">
                    {[
                      [f.player1Id, f.score1],
                      [f.player2Id, f.score2],
                    ].map(([pid, score], i) => (
                      <div key={i} className={`flex items-center justify-between py-1 ${f.winnerId && f.winnerId === pid ? "font-bold text-brand-300" : "text-ink-200"}`}>
                        <span className="truncate">{f.status === "bye" && !pid ? "Exempt" : nameOf(pid as string | null)}</span>
                        <span className="font-display tabular text-xl">{score ?? ""}</span>
                      </div>
                    ))}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {f.status === "bye" && <Badge>Exemption</Badge>}
                      {(f.status === "pending" || f.status === "playing") && f.player1Id && f.player2Id && c.status === "active" && (
                        <>
                          <Button size="sm" variant="primary" icon="play" onClick={() => play(f.id)}>
                            {f.status === "playing" ? "Reprendre" : "Jouer"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setResult(f);
                              setScores({ s1: 0, s2: 0, winner: "" });
                            }}
                          >
                            Saisir le résultat
                          </Button>
                        </>
                      )}
                      {f.matchId && f.status === "done" && (
                        <Link to={`/historique/${f.matchId}`} className="text-sm text-brand-400 hover:underline">
                          Voir le match
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        title="Résultat du match"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResult(null)}>
              Annuler
            </Button>
            <Button variant="primary" onClick={saveResult}>
              Enregistrer
            </Button>
          </>
        }
      >
        {result && (
          <div className="space-y-4">
            <p className="text-sm text-ink-300">Pour un match joué hors de l'application. Score en legs.</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label={nameOf(result.player1Id)}>
                <Stepper value={scores.s1} min={0} max={99} onChange={(v) => setScores((s) => ({ ...s, s1: v }))} />
              </Field>
              <Field label={nameOf(result.player2Id)}>
                <Stepper value={scores.s2} min={0} max={99} onChange={(v) => setScores((s) => ({ ...s, s2: v }))} />
              </Field>
            </div>
            <Field label="Vainqueur">
              <Segmented
                value={scores.winner}
                onChange={(w) => setScores((s) => ({ ...s, winner: w }))}
                options={[
                  { value: result.player1Id ?? "", label: nameOf(result.player1Id) },
                  { value: result.player2Id ?? "", label: nameOf(result.player2Id) },
                  ...(c.format === "round_robin" ? [{ value: "", label: "Match nul" }] : []),
                ]}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

import { useState } from "react";
import { ActivityCalendar, ColumnChart, TrendChart } from "../components/charts";
import { Card, EmptyState, ErrorBox, Field, inputClass, PageHeader, Segmented, Spinner, StatTile } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAppState } from "../lib/app-state";
import { fmtBucket, fmtNumber, fmtPercent, periodRange } from "../lib/format";
import { useAsync } from "../lib/hooks";
import type { SeriesPoint, StatsSummary } from "../lib/types";

type Granularity = "day" | "week" | "month";

interface Comparison {
  a: { average3: number | null; doubleRate: number | null; checkoutRate: number | null; accuracy: number | null; darts: number };
  b: { average3: number | null; doubleRate: number | null; checkoutRate: number | null; accuracy: number | null; darts: number };
  delta: { average3: number | null; doubleRate: number | null; checkoutRate: number | null; accuracy: number | null };
}

function monthBounds(offset: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1, 0, 0, 0, -1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function Delta({ value, percent = false }: { value: number | null; percent?: boolean }) {
  if (value === null) return <span className="text-ink-400">–</span>;
  const shown = percent ? `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)} pt` : `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
  // Icône + libellé : la couleur n'est jamais le seul indice.
  return <span className={value > 0 ? "text-[#6fdc6f]" : value < 0 ? "text-[#ff8f8f]" : "text-ink-300"}>{value > 0 ? "▲" : value < 0 ? "▼" : "="} {shown}</span>;
}

export function StatsPage() {
  const { players, activePlayerId, modes } = useAppState();
  const [playerId, setPlayerId] = useState<string>(activePlayerId ?? players[0]?.id ?? "");
  const [preset, setPreset] = useState("90j");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [mode, setMode] = useState("");
  const [opponentId, setOpponentId] = useState("");
  const [granularity, setGranularity] = useState<Granularity>("week");
  const effectivePlayer = playerId || activePlayerId || players[0]?.id || "";
  const range = preset === "perso" ? { from: custom.from ? new Date(`${custom.from}T00:00:00`).toISOString() : undefined, to: custom.to ? new Date(`${custom.to}T23:59:59`).toISOString() : undefined } : periodRange(preset);
  const filter = { playerId: effectivePlayer, ...range, mode: mode || undefined, opponentId: opponentId || undefined };
  const key = JSON.stringify(filter);
  const summary = useAsync(() => (effectivePlayer ? api.get<StatsSummary>(`/api/stats/summary${qs(filter)}`) : Promise.resolve(null)), [key]);
  const series = useAsync(() => (effectivePlayer ? api.get<{ series: SeriesPoint[] }>(`/api/stats/series${qs({ ...filter, granularity })}`) : Promise.resolve(null)), [key, granularity]);
  const calendar = useAsync(() => (effectivePlayer ? api.get<{ day: string; darts: number; sessions: number }[]>(`/api/stats/calendar${qs({ playerId: effectivePlayer })}`) : Promise.resolve([])), [effectivePlayer]);
  const comparison = useAsync(() => {
    if (!effectivePlayer) return Promise.resolve(null);
    const a = monthBounds(-1);
    const b = monthBounds(0);
    return api.get<Comparison>(`/api/stats/compare${qs({ playerId: effectivePlayer, mode: mode || undefined, aFrom: a.from, aTo: a.to, bFrom: b.from, bTo: b.to })}`);
  }, [effectivePlayer, mode]);

  if (players.length === 0) return <EmptyState title="Aucun joueur">Créez un profil et jouez quelques parties pour voir vos statistiques.</EmptyState>;
  const s = summary.data;
  const x = s?.summary.x01;
  const points = series.data?.series ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Statistiques" subtitle="Toutes les mesures sont calculées à partir des parties réellement enregistrées (les simulations sont exclues)." />

      <Card>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Joueur">
            <select className={inputClass} value={effectivePlayer} onChange={(e) => setPlayerId(e.target.value)}>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mode de jeu">
            <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">Tous les modes</option>
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Adversaire">
            <select className={inputClass} value={opponentId} onChange={(e) => setOpponentId(e.target.value)}>
              <option value="">Tous</option>
              {players
                .filter((p) => p.id !== effectivePlayer)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Période">
            <Segmented
              size="sm"
              value={preset}
              onChange={setPreset}
              options={[
                { value: "7j", label: "7 j" },
                { value: "30j", label: "30 j" },
                { value: "90j", label: "90 j" },
                { value: "1an", label: "1 an" },
                { value: "tout", label: "Tout" },
                { value: "perso", label: "Dates" },
              ]}
            />
          </Field>
        </div>
        {preset === "perso" && (
          <div className="mt-3 flex flex-wrap gap-3">
            <Field label="Du">
              <input type="date" className={inputClass} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </Field>
            <Field label="Au">
              <input type="date" className={inputClass} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </Field>
          </div>
        )}
      </Card>

      {summary.error && <ErrorBox message={summary.error} onRetry={summary.reload} />}
      {!s && !summary.error && <Spinner />}
      {s && x && (
        <>
          <section>
            <h2 className="font-display mb-2 text-xl font-semibold uppercase tracking-wide text-ink-300">X01 — scoring</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile label="Moyenne 3 fléchettes" value={fmtNumber(x.average3, 2)} accent hint="points / fléchettes × 3" />
              <StatTile label="Moyenne par fléchette" value={fmtNumber(x.pointsPerDart, 2)} hint="points / fléchettes" />
              <StatTile label="Moyenne par visite" value={fmtNumber(x.visitAverage, 2)} hint="points / visites" />
              <StatTile label="1re visite" value={fmtNumber(x.firstVisitAverage, 1)} hint="moyenne de la 1re visite du leg" />
              <StatTile label="9 premières fl." value={fmtNumber(x.first9Average, 2)} hint="moyenne 3 fl. sur les 9 premières" />
              <StatTile label="Meilleure visite" value={x.bestVisit ?? "–"} />
              <StatTile label="180" value={x.count180} />
              <StatTile label="140 – 179" value={x.count140} />
              <StatTile label="100 – 139" value={x.count100} />
              <StatTile label="Réussite aux doubles" value={fmtPercent(x.doubleRate, 1)} hint={`${x.doubleHits} / ${x.doubleAttempts} fléchettes à la sortie`} />
              <StatTile label="Taux de checkout" value={fmtPercent(x.checkoutRate, 1)} hint={`${x.checkouts} / ${x.checkoutChances} occasions`} />
              <StatTile label="Meilleur checkout" value={x.bestCheckout ?? "–"} />
              <StatTile label="Fléchettes / leg gagné" value={fmtNumber(x.averageDartsPerLegWon, 1)} hint={x.bestLegDarts ? `meilleur : ${x.bestLegDarts}` : undefined} />
              <StatTile label="Legs gagnés" value={x.legsWon} />
              <StatTile label="Busts" value={x.busts} />
            </div>
          </section>
          <section>
            <h2 className="font-display mb-2 text-xl font-semibold uppercase tracking-wide text-ink-300">Résultats et entraînements</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile label="Parties (2 joueurs +)" value={s.summary.results.matches} hint={`${s.summary.totalMatches} parties et séances au total`} />
              <StatTile label="Victoires" value={s.summary.results.wins} hint={`${s.summary.results.losses} défaite(s), ${s.summary.results.draws} égalité(s)`} />
              <StatTile label="Taux de victoire" value={fmtPercent(s.summary.results.winRate)} />
              <StatTile label="Série en cours" value={s.summary.results.currentStreak} hint={`record : ${s.summary.results.bestStreak}`} />
              <StatTile label="Réussite au bull" value={fmtPercent(s.summary.training.bull.rate)} hint={`${s.summary.training.bull.hits} / ${s.summary.training.bull.darts}`} />
              <StatTile label="Cricket (marques/manche)" value={fmtNumber(s.summary.training.cricket.marksPerRound, 2)} />
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Évolution de la moyenne 3 fléchettes"
              action={
                <Segmented
                  size="sm"
                  value={granularity}
                  onChange={setGranularity}
                  options={[
                    { value: "day", label: "Jour" },
                    { value: "week", label: "Semaine" },
                    { value: "month", label: "Mois" },
                  ]}
                />
              }
            >
              <TrendChart data={points.map((p) => ({ label: fmtBucket(p.key, granularity), value: p.average3 }))} format={(v) => v.toFixed(1)} />
            </Card>
            <Card title="Réussite aux doubles (X01)">
              <ColumnChart data={points.map((p) => ({ label: fmtBucket(p.key, granularity), value: p.doubleRate === null ? null : Math.round(p.doubleRate * 1000) / 10 }))} unit=" %" format={(v) => v.toFixed(0)} />
            </Card>
            <Card title="Évolution de la précision (entraînements à cible)">
              <TrendChart data={points.map((p) => ({ label: fmtBucket(p.key, granularity), value: p.accuracy === null ? null : Math.round(p.accuracy * 1000) / 10 }))} unit=" %" />
            </Card>
            <Card title="Volume : fléchettes lancées">
              <ColumnChart data={points.map((p) => ({ label: fmtBucket(p.key, granularity), value: p.darts }))} />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Ce mois-ci par rapport au mois dernier">
              {comparison.data && (
                <table className="w-full text-sm">
                  <thead className="text-left text-ink-400">
                    <tr>
                      <th className="py-1">Mesure</th>
                      <th>Mois dernier</th>
                      <th>Ce mois</th>
                      <th>Écart</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    <tr className="border-t border-ink-800">
                      <td className="py-2">Moyenne 3 fl.</td>
                      <td>{fmtNumber(comparison.data.a.average3)}</td>
                      <td>{fmtNumber(comparison.data.b.average3)}</td>
                      <td>
                        <Delta value={comparison.data.delta.average3} />
                      </td>
                    </tr>
                    <tr className="border-t border-ink-800">
                      <td className="py-2">Réussite aux doubles</td>
                      <td>{fmtPercent(comparison.data.a.doubleRate, 1)}</td>
                      <td>{fmtPercent(comparison.data.b.doubleRate, 1)}</td>
                      <td>
                        <Delta value={comparison.data.delta.doubleRate} percent />
                      </td>
                    </tr>
                    <tr className="border-t border-ink-800">
                      <td className="py-2">Taux de checkout</td>
                      <td>{fmtPercent(comparison.data.a.checkoutRate, 1)}</td>
                      <td>{fmtPercent(comparison.data.b.checkoutRate, 1)}</td>
                      <td>
                        <Delta value={comparison.data.delta.checkoutRate} percent />
                      </td>
                    </tr>
                    <tr className="border-t border-ink-800">
                      <td className="py-2">Précision (entraînements)</td>
                      <td>{fmtPercent(comparison.data.a.accuracy, 1)}</td>
                      <td>{fmtPercent(comparison.data.b.accuracy, 1)}</td>
                      <td>
                        <Delta value={comparison.data.delta.accuracy} percent />
                      </td>
                    </tr>
                    <tr className="border-t border-ink-800">
                      <td className="py-2">Fléchettes lancées</td>
                      <td>{comparison.data.a.darts}</td>
                      <td>{comparison.data.b.darts}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              )}
            </Card>
            <Card title="Calendrier des entraînements">
              <ActivityCalendar days={calendar.data ?? []} />
            </Card>
          </div>

          <Card title="Records personnels">
            {s.records.length === 0 ? (
              <p className="text-ink-400">Pas encore de record sur cette sélection.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {s.records.map((r) => (
                  <div key={r.id} className="rounded-xl bg-ink-900 px-3 py-2">
                    <div className="text-xs text-ink-400">{r.label}</div>
                    <div className="font-display tabular text-2xl font-bold">{r.display}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <details className="rounded-2xl border border-ink-700 bg-ink-850 p-4">
            <summary className="cursor-pointer font-display text-xl font-semibold">Comment sont calculées ces statistiques ?</summary>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-ink-300">
              <li>Moyenne par fléchette = points retenus ÷ fléchettes lancées. Un bust compte 0 point mais ses fléchettes comptent.</li>
              <li>Moyenne 3 fléchettes = moyenne par fléchette × 3. Moyenne par visite = points ÷ visites (elle diffère quand une visite compte moins de 3 fléchettes, au checkout).</li>
              <li>Moyenne de 1re visite = moyenne des points de la première visite de chaque leg. 9 premières fléchettes = points des 3 premières visites du leg ÷ fléchettes × 3.</li>
              <li>180 : visite de 3 fléchettes à 180 ; 140–179 et 100–139 sont des classes distinctes (une visite n'est comptée que dans une seule).</li>
              <li>Réussite aux doubles (X01 double sortie) = checkouts réussis ÷ fléchettes lancées alors qu'une sortie en une fléchette était possible (≤ 40 pair ou 50).</li>
              <li>Taux de checkout = legs terminés ÷ visites commencées sur un score terminable en 3 fléchettes.</li>
              <li>Victoires/défaites : parties terminées à 2 joueurs ou plus. Fléchettes par leg gagné : fléchettes du joueur dans les legs qu'il a terminés.</li>
              <li>Entraînements : réussite = touches ÷ fléchettes ; bull : 25 et 50 comptent comme touche, le 50 est aussi suivi à part.</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

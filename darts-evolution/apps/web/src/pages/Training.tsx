import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ActivityCalendar, TrendChart } from "../components/charts";
import { ModeOptionsForm } from "../components/ModeOptions";
import { Button, Card, EmptyState, Field, inputClass, Modal, PageHeader, ProgressBar, Segmented, StatTile, useUi } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAppState } from "../lib/app-state";
import { fmtBucket, fmtNumber, fmtPercent } from "../lib/format";
import { useAsync } from "../lib/hooks";
import type { MatchListItem, MatchSnapshot, SeriesPoint, StatsSummary } from "../lib/types";
import { MatchLine } from "./Home";

interface Exercise {
  id: string;
  name: string;
  options: Record<string, unknown>;
}

interface GoalsResponse {
  weekStart: string;
  goals: { id: string; label: string; unit: string; metric: string; target: number; value: number | null; achieved: boolean; completion: number }[];
}

const METRICS = [
  { value: "darts", label: "Fléchettes lancées" },
  { value: "sessions", label: "Séances d'entraînement" },
  { value: "matches", label: "Parties jouées" },
  { value: "average3", label: "Moyenne 3 fl. (X01)" },
  { value: "doubles_rate", label: "Réussite doubles (%)" },
  { value: "checkout_rate", label: "Taux de checkout (%)" },
];

function CheckoutCalculator() {
  const [score, setScore] = useState(121);
  const [outRule, setOutRule] = useState<"single" | "double" | "master">("double");
  const [dartsLeft, setDartsLeft] = useState(3);
  const result = useAsync(() => api.get<{ possible: boolean; routes: string[][] }>(`/api/checkout${qs({ score, outRule, dartsLeft, limit: 5 })}`), [score, outRule, dartsLeft]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Score restant">
          <input type="number" min={1} max={180} className={`${inputClass} w-28`} value={score} onChange={(e) => setScore(Math.max(1, Math.min(180, Number(e.target.value) || 1)))} />
        </Field>
        <Field label="Sortie">
          <Segmented size="sm" value={outRule} onChange={setOutRule} options={[{ value: "single", label: "Simple" }, { value: "double", label: "Double" }, { value: "master", label: "Master" }]} />
        </Field>
        <Field label="Fléchettes">
          <Segmented size="sm" value={dartsLeft} onChange={setDartsLeft} options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />
        </Field>
      </div>
      {result.data && !result.data.possible && <p className="text-warning">Score impossible à terminer avec {dartsLeft} fléchette(s) en sortie {outRule === "double" ? "double" : outRule === "master" ? "master" : "simple"}.</p>}
      <ul className="space-y-1.5">
        {result.data?.routes.map((r, i) => (
          <li key={i} className="flex gap-2">
            {r.map((l, j) => (
              <span key={j} className={`font-display rounded-lg px-2.5 py-1 text-lg font-bold ${i === 0 ? "bg-brand-500 text-ink-950" : "bg-ink-700"}`}>
                {l}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrainingPage() {
  const { modes, activePlayerId } = useAppState();
  const navigate = useNavigate();
  const { toast, confirm } = useUi();
  const exercises = useAsync(() => api.get<Exercise[]>("/api/exercises"), []);
  const goals = useAsync(() => (activePlayerId ? api.get<GoalsResponse>(`/api/goals?playerId=${activePlayerId}`) : Promise.resolve(null)), [activePlayerId]);
  const stats = useAsync(() => (activePlayerId ? api.get<StatsSummary>(`/api/stats/summary?playerId=${activePlayerId}`) : Promise.resolve(null)), [activePlayerId]);
  const series = useAsync(
    () => (activePlayerId ? api.get<{ series: SeriesPoint[] }>(`/api/stats/series${qs({ playerId: activePlayerId, granularity: "week" })}`) : Promise.resolve(null)),
    [activePlayerId],
  );
  const calendar = useAsync(() => (activePlayerId ? api.get<{ day: string; darts: number; sessions: number }[]>(`/api/stats/calendar?playerId=${activePlayerId}`) : Promise.resolve([])), [activePlayerId]);
  const sessions = useAsync(() => api.get<{ items: MatchListItem[] }>(`/api/matches${qs({ category: "training", playerId: activePlayerId, limit: 8 })}`), [activePlayerId]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({ name: "Mon exercice", targets: [], dartsPerTarget: 3, progression: "fixed", order: "sequential", rounds: 1 });
  const [goalMetric, setGoalMetric] = useState("darts");
  const [goalTarget, setGoalTarget] = useState(300);

  const trainings = modes.filter((m) => m.category === "training" && m.id !== "custom_training");
  const launchExercise = async (ex: Exercise) => {
    if (!activePlayerId) {
      navigate(`/jouer?categorie=entrainement&mode=custom_training&options=${encodeURIComponent(JSON.stringify(ex.options))}`);
      return;
    }
    try {
      const created = await api.post<MatchSnapshot>("/api/matches", { mode: "custom_training", options: ex.options, playerIds: [activePlayerId] });
      navigate(`/partie/${created.match.id}`);
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const saveExercise = async () => {
    try {
      const { name, ...options } = draft;
      await api.post("/api/exercises", { name, options });
      setCreating(false);
      exercises.reload();
      toast("Exercice enregistré.", "good");
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const addGoal = async () => {
    if (!activePlayerId) return;
    try {
      goals.setData(await api.post<GoalsResponse>("/api/goals", { playerId: activePlayerId, metric: goalMetric, target: goalTarget }));
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const t = stats.data?.summary.training;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Entraînement"
        subtitle="Séances enregistrées, objectifs, badges et progression."
        actions={
          <Link to="/jouer?categorie=entrainement">
            <Button variant="primary" icon="play">
              Nouvelle séance
            </Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {trainings.map((m) => (
          <Link key={m.id} to={`/jouer?categorie=entrainement&mode=${m.id}`} className="press rounded-2xl border border-ink-700 bg-ink-850 p-4 hover:border-brand-500/60">
            <div className="font-display text-xl font-bold">{m.name}</div>
            <p className="text-sm text-ink-300">{m.summary}</p>
            {t?.byMode[m.id] && (
              <p className="mt-2 text-sm text-brand-300">
                {t.byMode[m.id]!.sessions} séance(s) · réussite {fmtPercent(t.byMode[m.id]!.rate)}
              </p>
            )}
          </Link>
        ))}
      </div>

      {!activePlayerId && <EmptyState title="Aucun profil actif">Choisissez un profil actif sur l'accueil pour suivre objectifs, badges et progression.</EmptyState>}

      {t && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Séances" value={t.sessions} />
          <StatTile label="Fléchettes (entr.)" value={t.darts} />
          <StatTile label="Réussite doubles" value={fmtPercent(t.doubles.rate)} hint={`${t.doubles.hits}/${t.doubles.darts}`} accent />
          <StatTile label="Réussite triples" value={fmtPercent(t.triples.rate)} hint={`${t.triples.hits}/${t.triples.darts}`} />
          <StatTile label="Réussite bull" value={fmtPercent(t.bull.rate)} hint={`dont 50 : ${fmtPercent(t.bull.innerRate)}`} />
          <StatTile label="Checkouts réussis" value={fmtPercent(t.checkout.rate)} hint={`${t.checkout.successes}/${t.checkout.attempts}`} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {activePlayerId && (
          <Card title="Objectifs de la semaine">
            {goals.data?.goals.length === 0 && <p className="mb-3 text-ink-400">Aucun objectif : fixez-en un ci-dessous.</p>}
            <ul className="space-y-3">
              {goals.data?.goals.map((g) => (
                <li key={g.id}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="text-ink-200">
                      {g.label} {g.achieved && "✅"}
                    </span>
                    <span className="tabular text-ink-300">
                      {g.value === null ? "–" : fmtNumber(g.value, g.metric === "darts" || g.metric === "sessions" || g.metric === "matches" ? 0 : 1)} / {g.target}
                      <button
                        className="ml-3 text-ink-500 hover:text-[#ff8f8f]"
                        aria-label="Supprimer l'objectif"
                        onClick={async () => {
                          await api.del(`/api/goals/${g.id}`);
                          goals.reload();
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  <ProgressBar value={g.completion} label={g.label} />
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <Field label="Objectif">
                <select className={inputClass} value={goalMetric} onChange={(e) => setGoalMetric(e.target.value)}>
                  {METRICS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cible">
                <input type="number" min={1} className={`${inputClass} w-28`} value={goalTarget} onChange={(e) => setGoalTarget(Number(e.target.value))} />
              </Field>
              <Button icon="plus" onClick={addGoal}>
                Ajouter
              </Button>
            </div>
          </Card>
        )}

        {stats.data && (
          <Card title={`Niveau ${stats.data.progress.level} — ${stats.data.progress.levelName}`}>
            <ProgressBar value={stats.data.progress.xpIntoLevel / Math.max(1, stats.data.progress.xpForNext)} label="Progression du niveau" />
            <p className="mt-1 text-sm text-ink-400">
              {stats.data.progress.xp} XP — 1 XP par fléchette, 25 par leg gagné, 50 par victoire, 20 par séance terminée, 100 par badge.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {stats.data.progress.badges.length === 0 && <p className="text-ink-400">Aucun badge pour l'instant.</p>}
              {stats.data.progress.badges.map((b) => (
                <div key={b.id} className="rounded-xl border border-brand-500/40 bg-brand-500/10 p-3">
                  <div className="font-semibold text-brand-300">★ {b.name}</div>
                  <div className="text-xs text-ink-300">{b.description}</div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {activePlayerId && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Précision des entraînements (par semaine)">
            <TrendChart data={(series.data?.series ?? []).map((p) => ({ label: fmtBucket(p.key, "week"), value: p.accuracy === null ? null : Math.round(p.accuracy * 1000) / 10 }))} unit=" %" />
          </Card>
          <Card title="Calendrier des entraînements">
            <ActivityCalendar days={calendar.data ?? []} />
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Exercices personnalisés"
          action={
            <Button size="sm" icon="plus" onClick={() => setCreating(true)}>
              Créer
            </Button>
          }
        >
          {exercises.data?.length === 0 && <p className="text-ink-400">Créez vos propres séries de cibles.</p>}
          <ul className="space-y-2">
            {exercises.data?.map((ex) => (
              <li key={ex.id} className="flex items-center gap-2 rounded-xl bg-ink-900 px-3 py-2">
                <span className="flex-1 font-medium">{ex.name}</span>
                <span className="text-xs text-ink-400">{(ex.options.targets as unknown[])?.length ?? 0} cible(s)</span>
                <Button size="sm" variant="primary" icon="play" onClick={() => launchExercise(ex)}>
                  Lancer
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  aria-label="Supprimer"
                  onClick={async () => {
                    if (await confirm({ title: "Supprimer l'exercice ?", message: `« ${ex.name} » ne sera plus proposé. Les séances déjà jouées restent dans l'historique.`, danger: true, confirmLabel: "Supprimer" })) {
                      await api.del(`/api/exercises/${ex.id}`);
                      exercises.reload();
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Calculateur de checkout">
          <CheckoutCalculator />
        </Card>
      </div>

      <Card title="Dernières séances">
        {sessions.data?.items.length === 0 ? <p className="text-ink-400">Aucune séance enregistrée.</p> : <div className="space-y-2">{sessions.data?.items.map((m) => <MatchLine key={m.id} m={m} />)}</div>}
      </Card>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Nouvel exercice"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Annuler
            </Button>
            <Button variant="primary" onClick={saveExercise} disabled={!((draft.targets as unknown[]) ?? []).length}>
              Enregistrer
            </Button>
          </>
        }
      >
        <ModeOptionsForm mode="custom_training" options={draft} onChange={setDraft} />
      </Modal>
    </div>
  );
}

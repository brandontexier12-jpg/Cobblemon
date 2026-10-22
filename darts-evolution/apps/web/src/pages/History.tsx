import { dartDisplay } from "@darts-evolution/shared";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, inputClass, PageHeader, Spinner, Toggle, useUi } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAppState } from "../lib/app-state";
import { fmtDateTime, STATUS_LABEL } from "../lib/format";
import { useAsync } from "../lib/hooks";
import type { MatchListItem, MatchSnapshot } from "../lib/types";
import { MatchLine } from "./Home";

export function HistoryPage() {
  const { players, modes } = useAppState();
  const [playerId, setPlayerId] = useState("");
  const [mode, setMode] = useState("");
  const [status, setStatus] = useState("");
  const [simulation, setSimulation] = useState(false);
  const [page, setPage] = useState(0);
  const limit = 25;
  const list = useAsync(
    () => api.get<{ total: number; items: MatchListItem[] }>(`/api/matches${qs({ playerId, mode, status, simulation: simulation || undefined, limit, offset: page * limit })}`),
    [playerId, mode, status, simulation, page],
  );
  return (
    <div className="space-y-5">
      <PageHeader title="Historique" subtitle="Toutes les parties et séances, y compris interrompues." />
      <Card>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Joueur">
            <select className={inputClass} value={playerId} onChange={(e) => (setPlayerId(e.target.value), setPage(0))}>
              <option value="">Tous</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mode">
            <select className={inputClass} value={mode} onChange={(e) => (setMode(e.target.value), setPage(0))}>
              <option value="">Tous</option>
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Statut">
            <select className={inputClass} value={status} onChange={(e) => (setStatus(e.target.value), setPage(0))}>
              <option value="">Tous</option>
              <option value="active">En cours / interrompues</option>
              <option value="finished">Terminées</option>
              <option value="abandoned">Abandonnées</option>
            </select>
          </Field>
          <div className="flex items-end">
            <Toggle checked={simulation} onChange={(v) => (setSimulation(v), setPage(0))} label="Inclure les simulations" />
          </div>
        </div>
      </Card>
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data?.items.length === 0 && <EmptyState title="Aucune partie">Aucune partie ne correspond à ces filtres.</EmptyState>}
      <div className="space-y-2">{list.data?.items.map((m) => <MatchLine key={m.id} m={m} />)}</div>
      {list.data && list.data.total > limit && (
        <div className="flex items-center justify-center gap-3">
          <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Précédent
          </Button>
          <span className="text-sm text-ink-300">
            Page {page + 1} / {Math.ceil(list.data.total / limit)}
          </span>
          <Button size="sm" disabled={(page + 1) * limit >= list.data.total} onClick={() => setPage((p) => p + 1)}>
            Suivant
          </Button>
        </div>
      )}
    </div>
  );
}

interface VisitRow {
  visit_index: number;
  player_id: string;
  leg: number;
  set_no: number;
  round: number;
  points: number;
  bust: number;
  checkout: number;
  remaining_after: number | null;
  darts: { segment: number; multiplier: number; padded?: boolean }[];
  played_at: string;
}

export function MatchDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { auth } = useAppState();
  const { confirm, toast } = useUi();
  const match = useAsync(() => api.get<MatchSnapshot>(`/api/matches/${id}`), [id]);
  const visits = useAsync(() => api.get<VisitRow[]>(`/api/matches/${id}/visits`), [id]);
  if (match.error) return <ErrorBox message={match.error} />;
  if (!match.data) return <Spinner />;
  const { match: m, view } = match.data;
  const nameOf = (pid: string) => m.players.find((p) => p.id === pid)?.name ?? "?";
  const remove = async () => {
    if (!(await confirm({ title: "Supprimer cette partie ?", message: "La partie et ses statistiques seront définitivement supprimées. Une sauvegarde récente est recommandée.", danger: true, confirmLabel: "Supprimer définitivement" }))) return;
    try {
      await api.del(`/api/matches/${id}`);
      toast("Partie supprimée.", "good");
      navigate("/historique");
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title={view.modeName}
        subtitle={`${fmtDateTime(m.createdAt)} · ${STATUS_LABEL[m.status]}${m.finishedAt ? ` · terminée ${fmtDateTime(m.finishedAt)}` : ""}`}
        actions={
          <>
            <Link to={`/partie/${m.id}`}>
              <Button variant="primary" icon={m.status === "active" ? "play" : "edit"}>
                {m.status === "active" ? "Reprendre" : "Ouvrir / corriger"}
              </Button>
            </Link>
            {auth.isAdmin && (
              <Button variant="ghost" icon="trash" onClick={remove}>
                Supprimer
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap gap-2">
        {m.isSimulation && <Badge tone="warning">Simulation (exclue des statistiques)</Badge>}
        <Badge>{m.inputMode === "autodarts" ? "Saisie Autodarts" : "Saisie manuelle"}</Badge>
        <Badge>Salle {m.roomCode}</Badge>
      </div>
      <p className="text-ink-300">{view.headline}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {view.players.map((p) => (
          <Card key={p.id} className={p.winner ? "border-brand-500/60" : ""}>
            <div className="flex items-center justify-between">
              <span className="font-display text-xl font-bold">{p.name}</span>
              {p.winner && <Badge tone="brand">Vainqueur</Badge>}
            </div>
            <div className="text-xs uppercase text-ink-400">{p.mainLabel}</div>
            <div className="font-display text-4xl font-bold">{p.main}</div>
            <dl className="mt-1 space-y-0.5 text-sm">
              {p.details.map((d) => (
                <div key={d.label} className="flex justify-between gap-2">
                  <dt className="text-ink-400">{d.label}</dt>
                  <dd>{d.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
      <Card title={`Visites (${visits.data?.length ?? 0})`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-ink-400">
              <tr>
                <th className="py-2">#</th>
                <th>Joueur</th>
                {m.mode === "x01" && <th>Leg</th>}
                <th>Manche</th>
                <th>Fléchettes</th>
                <th>Points</th>
                {m.mode === "x01" && <th>Reste</th>}
              </tr>
            </thead>
            <tbody className="tabular">
              {visits.data?.map((v) => (
                <tr key={v.visit_index} className="border-t border-ink-800">
                  <td className="py-1.5 text-ink-400">{v.visit_index + 1}</td>
                  <td>{nameOf(v.player_id)}</td>
                  {m.mode === "x01" && <td>{v.set_no > 1 ? `${v.set_no}.${v.leg}` : v.leg}</td>}
                  <td>{v.round}</td>
                  <td>{v.darts.map((d) => (d.padded ? "–" : dartDisplay({ segment: d.segment, multiplier: d.multiplier as 0 | 1 | 2 | 3 }))).join("  ")}</td>
                  <td className="font-semibold">
                    {v.bust ? <span className="text-[#ff8f8f]">Bust</span> : v.points}
                    {v.checkout ? <span className="ml-1 text-brand-400">✓</span> : null}
                  </td>
                  {m.mode === "x01" && <td>{v.remaining_after ?? ""}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visits.data?.length === 0 && <p className="text-ink-400">Aucune visite.</p>}
      </Card>
    </div>
  );
}

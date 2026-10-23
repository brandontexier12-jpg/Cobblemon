import { Link } from "react-router-dom";
import { AutodartsPill } from "../components/AutodartsStatus";
import { TrendChart } from "../components/charts";
import { Icon } from "../components/Icon";
import { Badge, Button, Card, EmptyState, ErrorBox, PlayerAvatar, ProgressBar, Spinner, StatTile, useUi } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAppState } from "../lib/app-state";
import { fmtBucket, fmtDateTime, fmtInt, fmtNumber, fmtPercent } from "../lib/format";
import { useAsync } from "../lib/hooks";
import type { AutodartsOverview, MatchListItem, Player, SeriesPoint, StatsSummary } from "../lib/types";

/** Conséquences d'un abandon, rappelées à chaque confirmation. */
export const ABANDON_MESSAGE =
  "Elle quitte les parties en cours et ne compte plus dans les statistiques. Elle reste consultable dans l'historique (filtre « Abandonnées »).";

interface HomeData {
  player: Player | null;
  stats: StatsSummary | null;
  progression: SeriesPoint[];
  recent: MatchListItem[];
  active: MatchListItem[];
  autodarts: AutodartsOverview;
}

export function MatchLine({ m, onAbandon }: { m: MatchListItem; onAbandon?: () => void }) {
  const line = (
    <Link
      to={m.status === "active" ? `/partie/${m.id}?reprendre=1` : `/historique/${m.id}`}
      className="press flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-ink-900 px-3 py-2.5 hover:bg-ink-800"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{m.modeName}</span>
          {m.isSimulation && <Badge tone="warning">Simulation</Badge>}
          {m.status === "active" && <Badge tone="brand">En cours</Badge>}
          {m.status === "abandoned" && <Badge>Abandonnée</Badge>}
        </div>
        <div className="truncate text-sm text-ink-300">
          {m.players.map((p) => `${p.won ? "🏆 " : ""}${p.name}${p.average3 ? ` (${fmtNumber(p.average3)})` : ""}`).join(" · ")}
        </div>
      </div>
      <span className="shrink-0 text-xs text-ink-400">{fmtDateTime(m.createdAt)}</span>
    </Link>
  );
  if (!onAbandon) return line;
  return (
    <div className="flex items-stretch gap-2">
      {line}
      <Button variant="ghost" icon="x" onClick={onAbandon} aria-label="Abandonner cette partie" title="Abandonner cette partie" />
    </div>
  );
}

export function HomePage() {
  const { activePlayerId, players, setActivePlayer, autodarts } = useAppState();
  const { confirm, toast } = useUi();
  const home = useAsync(() => api.get<HomeData>(`/api/home${qs({ playerId: activePlayerId })}`), [activePlayerId]);

  if (home.error) return <ErrorBox message={home.error} onRetry={home.reload} />;
  if (!home.data) return <Spinner />;
  const { player, stats, progression, recent, active } = home.data;
  const x = stats?.summary.x01;

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl border border-ink-700 bg-gradient-to-br from-ink-850 via-ink-900 to-brand-900 p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-4">
          {player ? (
            <>
              <PlayerAvatar avatar={player.avatar} color={player.color} photo={player.photo} size={64} />
              <div className="min-w-0 flex-1">
                <div className="text-sm uppercase tracking-wider text-ink-300">Profil actif</div>
                <h1 className="font-display truncate text-4xl font-bold uppercase">{player.name}</h1>
                {stats && (
                  <div className="mt-1 max-w-sm">
                    <div className="mb-1 flex justify-between text-xs text-ink-300">
                      <span>
                        Niveau {stats.progress.level} · {stats.progress.levelName}
                      </span>
                      <span>
                        {fmtInt(stats.progress.xpIntoLevel)} / {fmtInt(stats.progress.xpForNext)} XP
                      </span>
                    </div>
                    <ProgressBar value={stats.progress.xpIntoLevel / Math.max(1, stats.progress.xpForNext)} label="Progression vers le niveau suivant" />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1">
              <h1 className="font-display text-4xl font-bold uppercase">Bienvenue</h1>
              <p className="text-ink-300">Choisissez un profil actif pour suivre vos statistiques.</p>
            </div>
          )}
          <select
            className="rounded-xl border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm"
            value={activePlayerId ?? ""}
            onChange={(e) => void setActivePlayer(e.target.value || null)}
            aria-label="Changer de profil actif"
          >
            <option value="">— Aucun profil —</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
          <Link to="/jouer" className="col-span-2 sm:col-span-1">
            <Button variant="primary" size="lg" icon="play" className="w-full">
              Jouer
            </Button>
          </Link>
          <Link to="/entrainement">
            <Button icon="training" className="w-full sm:min-h-14 sm:px-6 sm:text-lg">
              Entraînement
            </Button>
          </Link>
          <Link to="/statistiques">
            <Button icon="chart" className="w-full sm:min-h-14 sm:px-6 sm:text-lg">
              Statistiques
            </Button>
          </Link>
          <div className="col-span-2 sm:ml-auto sm:self-center">
            <AutodartsPill overview={autodarts ?? home.data.autodarts} />
          </div>
        </div>
      </section>

      {active.length > 0 && (
        <Card title="Parties en cours" action={<span className="text-sm text-ink-400">Reprenez là où vous vous êtes arrêté</span>}>
          <div className="space-y-2">
            {active.map((m) => (
              <MatchLine
                key={m.id}
                m={m}
                onAbandon={async () => {
                  if (!(await confirm({ title: "Abandonner cette partie ?", message: ABANDON_MESSAGE, confirmLabel: "Abandonner", danger: true }))) return;
                  try {
                    await api.post(`/api/matches/${m.id}/commands`, { kind: "abandon" });
                    home.reload();
                  } catch (e) {
                    toast((e as Error).message, "critical");
                  }
                }}
              />
            ))}
          </div>
        </Card>
      )}

      {players.length === 0 && (
        <EmptyState
          title="Créez votre premier joueur"
          action={
            <Link to="/joueurs">
              <Button variant="primary" icon="plus">
                Créer un profil
              </Button>
            </Link>
          }
        >
          Les profils conservent statistiques, records et progression.
        </EmptyState>
      )}

      {player && x && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <StatTile label="Moyenne 3 fl. (X01)" value={fmtNumber(x.average3)} accent />
            <StatTile label="Meilleure visite" value={x.bestVisit ?? "–"} />
            <StatTile label="Parties" value={fmtInt(stats.summary.totalMatches)} hint={`${stats.summary.results.wins} victoire(s)`} />
            <StatTile label="180" value={x.count180} />
            <StatTile label="Taux de checkout" value={fmtPercent(x.checkoutRate)} />
            <StatTile label="Meilleur checkout" value={x.bestCheckout ?? "–"} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Card title="Progression — moyenne 3 fléchettes (30 jours)">
              <TrendChart data={progression.map((p) => ({ label: fmtBucket(p.key, "day"), value: p.average3 }))} />
            </Card>
            <Card title="Records personnels">
              {stats.records.length === 0 ? (
                <p className="text-ink-400">Jouez quelques parties pour établir vos records.</p>
              ) : (
                <ul className="space-y-2">
                  {stats.records.slice(0, 6).map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl bg-ink-900 px-3 py-2">
                      <span className="text-sm text-ink-300">{r.label}</span>
                      <span className="font-display tabular text-xl font-bold">{r.display}</span>
                    </li>
                  ))}
                </ul>
              )}
              {stats.progress.badges.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {stats.progress.badges.map((b) => (
                    <span key={b.id} title={b.description}>
                      <Badge tone="brand">
                        <Icon name="star" size={12} /> {b.name}
                      </Badge>
                    </span>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      <Card
        title="Derniers résultats"
        action={
          <Link to="/historique" className="text-sm text-brand-400 hover:underline">
            Tout l'historique
          </Link>
        }
      >
        {recent.length === 0 ? (
          <p className="text-ink-400">Aucune partie enregistrée pour l'instant.</p>
        ) : (
          <div className="space-y-2">
            {recent.map((m) => (
              <MatchLine key={m.id} m={m} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

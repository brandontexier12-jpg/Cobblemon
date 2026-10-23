import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, inputClass, Modal, PageHeader, PlayerAvatar, Segmented, Spinner, StatTile, useUi } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAppState } from "../lib/app-state";
import { fmtDate, fmtNumber, fmtPercent, LEVEL_LABEL } from "../lib/format";
import { useAsync } from "../lib/hooks";
import type { MatchListItem, Player, StatsSummary, X01Summary } from "../lib/types";
import { MatchLine } from "./Home";
import { PhotoField, type PhotoChange } from "../components/PhotoField";

const AVATARS = ["🎯", "🦊", "🐺", "🦅", "🐯", "🦁", "🐉", "⚡", "🔥", "🚀", "👑", "🎲", "🏹", "🐻", "🦈", "⭐"];
const COLORS = ["#ff6b1a", "#3987e5", "#199e70", "#c98500", "#d55181", "#9085e9", "#e66767", "#a1a1aa"];

interface LeaderRow {
  player: Player;
  average3: number | null;
  bestVisit: number | null;
  count180: number;
  checkoutRate: number | null;
  doubleRate: number | null;
  matches: number;
  wins: number;
  winRate: number | null;
  darts: number;
  level: number;
}

function PlayerForm({ initial, onSaved, onCancel }: { initial?: Player; onSaved: () => void; onCancel: () => void }) {
  const { toast } = useUi();
  const { activePlayerId, setActivePlayer } = useAppState();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    avatar: initial?.avatar ?? "🎯",
    color: initial?.color ?? "#ff6b1a",
    level: initial?.level ?? "debutant",
    favoriteDouble: initial?.favoriteDouble ?? null,
  });
  const [photo, setPhoto] = useState<PhotoChange>(undefined);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      let id = initial?.id;
      if (initial) await api.patch(`/api/players/${initial.id}`, form);
      else {
        const created = await api.post<Player>("/api/players", form);
        id = created.id;
        if (!activePlayerId) await setActivePlayer(created.id);
      }
      if (id && photo instanceof Blob) await api.upload(`/api/players/${id}/photo`, photo);
      else if (id && photo === null) await api.del(`/api/players/${id}/photo`);
      onSaved();
    } catch (e) {
      toast((e as Error).message, "critical");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-4">
      <Field label="Pseudo">
        <input className={inputClass} value={form.name} maxLength={32} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Photo de profil">
        <PhotoField avatar={form.avatar} color={form.color} current={initial?.photo ?? null} value={photo} onChange={setPhoto} />
      </Field>
      <Field label="Avatar">
        <div className="flex flex-wrap gap-1.5">
          {AVATARS.map((a) => (
            <button key={a} type="button" onClick={() => setForm({ ...form, avatar: a })} className={`press h-11 w-11 rounded-xl text-2xl ${form.avatar === a ? "bg-brand-500/25 ring-2 ring-brand-500" : "bg-ink-900"}`}>
              {a}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Couleur">
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button key={c} type="button" aria-label={`Couleur ${c}`} onClick={() => setForm({ ...form, color: c })} className={`press h-10 w-10 rounded-full ${form.color === c ? "ring-2 ring-white ring-offset-2 ring-offset-ink-850" : ""}`} style={{ background: c }} />
          ))}
        </div>
      </Field>
      <Field label="Niveau de jeu">
        <Segmented value={form.level} onChange={(v) => setForm({ ...form, level: v })} options={Object.entries(LEVEL_LABEL).map(([value, label]) => ({ value: value as Player["level"], label }))} />
      </Field>
      <Field label="Double favori (stratégie de checkout)">
        <select className={inputClass} value={form.favoriteDouble ?? ""} onChange={(e) => setForm({ ...form, favoriteDouble: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Aucun</option>
          {[...Array.from({ length: 20 }, (_, i) => 20 - i), 25].map((n) => (
            <option key={n} value={n}>
              {n === 25 ? "Bull" : `D${n}`}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button variant="primary" onClick={save} disabled={!form.name.trim() || saving}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </div>
  );
}

function CompareRow({ label, a, b, better = "high" }: { label: string; a: number | null; b: number | null; better?: "high" | "low" }) {
  const fmt = (v: number | null) => (v === null ? "–" : Number.isInteger(v) ? String(v) : v.toFixed(2));
  const aWins = a !== null && b !== null && (better === "high" ? a > b : a < b);
  const bWins = a !== null && b !== null && (better === "high" ? b > a : b < a);
  return (
    <tr className="border-t border-ink-800">
      <td className={`tabular py-2 text-right font-semibold ${aWins ? "text-brand-400" : ""}`}>{fmt(a)}</td>
      <td className="px-3 text-center text-sm text-ink-400">{label}</td>
      <td className={`tabular py-2 font-semibold ${bWins ? "text-brand-400" : ""}`}>{fmt(b)}</td>
    </tr>
  );
}

function Comparison({ a, b }: { a: string; b: string }) {
  const h2h = useAsync(
    () => api.get<{ a: Player; b: Player; matches: number; statsA: { x01: X01Summary; results: { wins: number } }; statsB: { x01: X01Summary; results: { wins: number } } }>(`/api/stats/head-to-head${qs({ a, b })}`),
    [a, b],
  );
  const sa = useAsync(() => api.get<StatsSummary>(`/api/stats/summary?playerId=${a}`), [a]);
  const sb = useAsync(() => api.get<StatsSummary>(`/api/stats/summary?playerId=${b}`), [b]);
  if (!h2h.data || !sa.data || !sb.data) return <Spinner />;
  const xa = sa.data.summary.x01;
  const xb = sb.data.summary.x01;
  return (
    <div>
      <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
        <div className="font-display text-2xl font-bold">{h2h.data.a.name}</div>
        <div className="font-display tabular text-3xl font-bold text-brand-500">
          {h2h.data.statsA.results.wins} – {h2h.data.statsB.results.wins}
        </div>
        <div className="font-display text-2xl font-bold">{h2h.data.b.name}</div>
      </div>
      <p className="mb-3 text-center text-sm text-ink-400">{h2h.data.matches} face-à-face terminés ou en cours</p>
      <table className="mx-auto w-full max-w-lg">
        <tbody>
          <CompareRow label="Moyenne 3 fl. (générale)" a={xa.average3} b={xb.average3} />
          <CompareRow label="Moyenne 3 fl. (face-à-face)" a={h2h.data.statsA.x01.average3} b={h2h.data.statsB.x01.average3} />
          <CompareRow label="Meilleure visite" a={xa.bestVisit} b={xb.bestVisit} />
          <CompareRow label="180" a={xa.count180} b={xb.count180} />
          <CompareRow label="Réussite doubles (%)" a={xa.doubleRate === null ? null : xa.doubleRate * 100} b={xb.doubleRate === null ? null : xb.doubleRate * 100} />
          <CompareRow label="Meilleur checkout" a={xa.bestCheckout} b={xb.bestCheckout} />
          <CompareRow label="Fléchettes / leg gagné" a={xa.averageDartsPerLegWon} b={xb.averageDartsPerLegWon} better="low" />
          <CompareRow label="Victoires (toutes)" a={sa.data.summary.results.wins} b={sb.data.summary.results.wins} />
        </tbody>
      </table>
    </div>
  );
}

export function PlayersPage() {
  const { players, refreshPlayers, activePlayerId, setActivePlayer } = useAppState();
  const { confirm, toast } = useUi();
  const [tab, setTab] = useState<"profils" | "classement" | "comparer">("profils");
  const [editing, setEditing] = useState<Player | "new" | null>(null);
  const [cmp, setCmp] = useState<[string, string]>([players[0]?.id ?? "", players[1]?.id ?? ""]);
  const board = useAsync(() => api.get<LeaderRow[]>("/api/stats/leaderboard"), [players.length]);
  const archive = async (p: Player) => {
    const ok = await confirm({
      title: `Supprimer ${p.name} ?`,
      message: "Le profil sera retiré des listes. Son historique et ses statistiques sont conservés (les parties passées restent consultables). Un profil sans aucune partie est supprimé définitivement.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      const hasMatches = (await api.get<{ total: number }>(`/api/matches?playerId=${p.id}&limit=1&simulation=true`)).total > 0;
      await api.del(`/api/players/${p.id}${hasMatches ? "" : "?permanent=true"}`).catch(() => api.del(`/api/players/${p.id}`));
      if (activePlayerId === p.id) await setActivePlayer(null);
      await refreshPlayers();
      toast(`${p.name} a été supprimé${hasMatches ? " (historique conservé)" : ""}.`, "good");
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Joueurs"
        subtitle="Profils locaux, classement et comparaisons."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
            Nouveau joueur
          </Button>
        }
      />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "profils", label: "Profils" },
          { value: "classement", label: "Classement" },
          { value: "comparer", label: "Comparer" },
        ]}
      />
      {tab === "profils" &&
        (players.length === 0 ? (
          <EmptyState title="Aucun joueur" action={<Button variant="primary" icon="plus" onClick={() => setEditing("new")}>Créer un profil</Button>}>
            Créez un profil pour chaque joueur de la maison.
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {players.map((p) => {
              const row = board.data?.find((r) => r.player.id === p.id);
              return (
                <Card key={p.id}>
                  <div className="flex items-center gap-3">
                    <PlayerAvatar avatar={p.avatar} color={p.color} photo={p.photo} size={52} />
                    <div className="min-w-0 flex-1">
                      <Link to={`/joueurs/${p.id}`} className="font-display block truncate text-2xl font-bold hover:text-brand-400">
                        {p.name}
                      </Link>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge>{LEVEL_LABEL[p.level]}</Badge>
                        {row && <Badge tone="brand">Niv. {row.level}</Badge>}
                        {p.id === activePlayerId && <Badge tone="good">Profil actif</Badge>}
                      </div>
                    </div>
                  </div>
                  {row && (
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                      <div>
                        <div className="text-ink-400">Moy. 3 fl.</div>
                        <div className="font-display text-xl font-bold">{fmtNumber(row.average3)}</div>
                      </div>
                      <div>
                        <div className="text-ink-400">Parties</div>
                        <div className="font-display text-xl font-bold">{row.matches}</div>
                      </div>
                      <div>
                        <div className="text-ink-400">Victoires</div>
                        <div className="font-display text-xl font-bold">{fmtPercent(row.winRate)}</div>
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {p.id !== activePlayerId && (
                      <Button size="sm" icon="check" onClick={() => setActivePlayer(p.id)}>
                        Profil actif
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(p)}>
                      Modifier
                    </Button>
                    <Button size="sm" variant="ghost" icon="trash" onClick={() => archive(p)}>
                      Supprimer
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        ))}

      {tab === "classement" && (
        <Card title="Classement local">
          {board.error && <ErrorBox message={board.error} />}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-ink-400">
                <tr>
                  <th className="py-2">#</th>
                  <th>Joueur</th>
                  <th>Victoires</th>
                  <th>Parties</th>
                  <th>% vict.</th>
                  <th>Moy. 3 fl.</th>
                  <th>Meilleure visite</th>
                  <th>180</th>
                  <th>% doubles</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {board.data?.map((r, i) => (
                  <tr key={r.player.id} className="border-t border-ink-800">
                    <td className="font-display py-2 text-lg font-bold text-brand-400">{i + 1}</td>
                    <td>
                      <span className="flex items-center gap-2">
                        <PlayerAvatar avatar={r.player.avatar} color={r.player.color} photo={r.player.photo} size={28} />
                        {r.player.name}
                      </span>
                    </td>
                    <td>{r.wins}</td>
                    <td>{r.matches}</td>
                    <td>{fmtPercent(r.winRate)}</td>
                    <td>{fmtNumber(r.average3)}</td>
                    <td>{r.bestVisit ?? "–"}</td>
                    <td>{r.count180}</td>
                    <td>{fmtPercent(r.doubleRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-400">Classement par victoires puis moyenne. Les invités et parties simulées ne sont pas classés.</p>
        </Card>
      )}

      {tab === "comparer" && (
        <Card title="Comparer deux joueurs">
          {players.length < 2 ? (
            <p className="text-ink-400">Il faut au moins deux profils.</p>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3">
                {[0, 1].map((i) => (
                  <select key={i} className={inputClass} value={cmp[i]} onChange={(e) => setCmp((c) => (i === 0 ? [e.target.value, c[1]] : [c[0], e.target.value]))}>
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
              {cmp[0] && cmp[1] && cmp[0] !== cmp[1] ? <Comparison a={cmp[0]} b={cmp[1]} /> : <p className="text-ink-400">Choisissez deux joueurs différents.</p>}
            </>
          )}
        </Card>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Nouveau joueur" : "Modifier le joueur"}>
        {editing !== null && (
          <PlayerForm
            initial={editing === "new" ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await refreshPlayers();
              board.reload();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

export function PlayerDetailPage() {
  const { id = "" } = useParams();
  const player = useAsync(() => api.get<Player>(`/api/players/${id}`), [id]);
  const stats = useAsync(() => api.get<StatsSummary>(`/api/stats/summary?playerId=${id}`), [id]);
  const history = useAsync(() => api.get<{ items: MatchListItem[] }>(`/api/matches?playerId=${id}&limit=20`), [id]);
  if (player.error) return <ErrorBox message={player.error} />;
  if (!player.data || !stats.data) return <Spinner />;
  const p = player.data;
  const x = stats.data.summary.x01;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <PlayerAvatar avatar={p.avatar} color={p.color} photo={p.photo} size={72} />
        <div>
          <h1 className="font-display text-4xl font-bold uppercase">{p.name}</h1>
          <p className="text-ink-300">
            {LEVEL_LABEL[p.level]} · niveau {stats.data.progress.level} ({stats.data.progress.levelName}) · depuis le {fmtDate(p.createdAt)}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatTile label="Moyenne 3 fl." value={fmtNumber(x.average3)} accent />
        <StatTile label="Meilleure visite" value={x.bestVisit ?? "–"} />
        <StatTile label="180" value={x.count180} />
        <StatTile label="Réussite doubles" value={fmtPercent(x.doubleRate, 1)} />
        <StatTile label="Victoires" value={stats.data.summary.results.wins} hint={`sur ${stats.data.summary.results.matches} parties`} />
        <StatTile label="Fléchettes lancées" value={stats.data.summary.totalDarts} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Records">
          <ul className="space-y-2">
            {stats.data.records.map((r) => (
              <li key={r.id} className="flex justify-between rounded-xl bg-ink-900 px-3 py-2">
                <span className="text-ink-300">{r.label}</span>
                <span className="font-display text-xl font-bold">{r.display}</span>
              </li>
            ))}
            {stats.data.records.length === 0 && <p className="text-ink-400">Aucun record pour l'instant.</p>}
          </ul>
        </Card>
        <Card title="Badges">
          <div className="flex flex-wrap gap-2">
            {stats.data.progress.badges.map((b) => (
              <span key={b.id} title={`${b.description} — obtenu le ${fmtDate(b.earnedAt)}`}>
                <Badge tone="brand">★ {b.name}</Badge>
              </span>
            ))}
            {stats.data.progress.badges.length === 0 && <p className="text-ink-400">Aucun badge pour l'instant.</p>}
          </div>
        </Card>
      </div>
      <Card title="Historique">
        <div className="space-y-2">{history.data?.items.map((m) => <MatchLine key={m.id} m={m} />)}</div>
      </Card>
    </div>
  );
}

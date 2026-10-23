import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, inputClass, Modal, PageHeader, PlayerAvatar, Segmented, Spinner, StatTile, Toggle, useUi } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { useAppState } from "../lib/app-state";
import { fmtDateTime } from "../lib/format";
import { useAsync } from "../lib/hooks";

// ---------- Types renvoyés par /api/careers ----------

interface CareerListItem {
  id: string;
  name: string;
  playerName: string;
  season: number;
  difficulty: string;
  outRule: "single" | "double";
  rank: number | null;
  titles: number;
  card: boolean;
  updatedAt: string;
}

interface PlayerInfo {
  id: string;
  name: string;
  nickname: string;
  country: string;
  flag: string;
  rating: number;
  card: boolean;
  titles: number;
  human: boolean;
  rank: number | null;
}

interface EventInfo {
  id: string;
  name: string;
  venue: string;
  city: string;
  when: string;
  tierLabel: string;
  field: number;
  winnerPrize: number;
  doubleIn: boolean;
  ranking: boolean;
}

interface Side {
  id: string;
  name: string;
  flag: string;
  human: boolean;
}

interface FixtureView {
  a: Side | null;
  b: Side | null;
  sa: number | null;
  sb: number | null;
  avgA: number | null;
  avgB: number | null;
  winner: string | null;
}

interface RunView {
  event: EventInfo;
  phase: "groups" | "knockout";
  advance: number;
  groups: { name: string; table: { id: string; name: string; flag: string; human: boolean; played: number; won: number; legDiff: number }[]; rounds: FixtureView[][] }[];
  rounds: { name: string; fixtures: FixtureView[] }[];
}

interface HumanResult {
  label: string;
  stage: number;
  prize: number;
  card?: boolean;
}

type PendingView =
  | {
      kind: "match";
      event: EventInfo;
      round: string;
      opponent: PlayerInfo;
      formatLabel: string;
      humanFirst: boolean;
      matchId: string | null;
      matchStatus: "active" | "finished" | "abandoned" | null;
      result: { won: boolean; me: number; opp: number } | null;
    }
  | { kind: "event"; event: EventInfo; result: { winnerName: string; runnerUpName: string; final: string; human: HumanResult | null; eventId: string } }
  | { kind: "season"; season: number; rank: number | null; money: number; seasonMoney: number; titles: string[]; card: boolean; cardUntil: number | null };

interface CareerView {
  id: string;
  name: string;
  season: number;
  settings: {
    difficulty: string;
    outRule: "single" | "double";
    matchLength: "reelle" | "raccourcie" | "courte";
    light: boolean;
    difficultyLabel: string;
    ranges: { card: [number, number]; amateurs: [number, number] };
  };
  me: PlayerInfo & {
    cardUntil: number | null;
    money: number;
    seasonMoney: number;
    proTourRank: number | null;
    challengeRank: number | null;
    profile: { avatar: string; color: string; photo: string | null } | null;
  };
  pending: PendingView | null;
  run: RunView | null;
  feed: { event: string; winner: string; flag: string; final: string; runnerUp: string }[];
  calendar: (EventInfo & { status: "done" | "current" | "upcoming"; winner: { name: string; flag: string; human: boolean } | null; final: string | null; human: HumanResult | null })[];
}

interface Options {
  difficulties: { id: string; label: string; hint: string }[];
  countries: { code: string; name: string; flag: string }[];
}

// Dotations en livres sterling, comme sur le circuit : « 1 000 000 £ ».
const fmtMoney = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} £`;
const LENGTH_LABEL = { courte: "courts", raccourcie: "raccourcis", reelle: "au format réel" } as const;

function Name({ side, className = "" }: { side: { name: string; flag: string; human?: boolean }; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${side.human ? "font-semibold text-brand-300" : ""} ${className}`}>
      <span aria-hidden>{side.flag}</span>
      <span className="truncate">{side.name}</span>
    </span>
  );
}

// ---------- Liste et création ----------

export function CareersPage() {
  const list = useAsync(() => api.get<CareerListItem[]>("/api/careers"), []);
  const [creating, setCreating] = useState(false);
  const remove = useDeleteCareer(list.reload);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Mode carrière"
        subtitle="Du Q-School à l'Alexandra Palace : affrontez un circuit de joueurs virtuels sur les vrais tournois de la saison."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            Nouvelle carrière
          </Button>
        }
      />
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data?.length === 0 && !creating && (
        <EmptyState
          title="Aucune carrière"
          action={
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              Commencer une carrière
            </Button>
          }
        >
          Passez la Q-School, décrochez votre Tour Card, grimpez à l'Order of Merit et visez le titre mondial.
        </EmptyState>
      )}
      {creating && <CreateCareer onCancel={() => setCreating(false)} />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.data?.map((c) => (
          <div key={c.id} className="relative">
            <Link to={`/carriere/${c.id}`} className="press block h-full rounded-2xl border border-ink-700 bg-ink-850 p-4 pr-14 hover:border-ink-500">
              <div className="flex items-center gap-2">
                <Icon name="star" className="text-brand-500" />
                <span className="font-display text-xl font-semibold">{c.name}</span>
              </div>
              <p className="mt-1 text-sm text-ink-300">
                {c.playerName} · saison {c.season} · {c.difficulty} · sortie {c.outRule === "double" ? "double" : "simple"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone={c.rank ? "brand" : "neutral"}>{c.rank ? `#${c.rank} Order of Merit` : "Non classé"}</Badge>
                <Badge tone={c.card ? "good" : "warning"}>{c.card ? "Tour Card" : "Sans Tour Card"}</Badge>
                {c.titles > 0 && <Badge tone="brand">🏆 {c.titles} titre(s)</Badge>}
              </div>
              <p className="mt-2 text-xs text-ink-400">Dernière partie : {fmtDateTime(c.updatedAt)}</p>
            </Link>
            <Button size="sm" variant="ghost" icon="trash" className="absolute right-2 top-2" aria-label={`Supprimer ${c.name}`} title="Supprimer cette carrière" onClick={() => void remove(c)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateCareer({ onCancel }: { onCancel: () => void }) {
  const { players, activePlayerId } = useAppState();
  const navigate = useNavigate();
  const { toast } = useUi();
  const options = useAsync(() => api.get<Options>("/api/careers/options"), []);
  const humans = players.filter((p) => !p.isGuest && p.botAverage == null);
  const [playerId, setPlayerId] = useState(activePlayerId ?? humans[0]?.id ?? "");
  const [name, setName] = useState("");
  const [country, setCountry] = useState("FRA");
  const [difficulty, setDifficulty] = useState("sur_mesure");
  const [outRule, setOutRule] = useState<"double" | "single">("double");
  const [matchLength, setMatchLength] = useState<"courte" | "raccourcie" | "reelle">("raccourcie");
  const [start, setStart] = useState<"qschool" | "tourcard">("qschool");
  const [light, setLight] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const career = await api.post<CareerView>("/api/careers", { playerId, name: name || undefined, country, difficulty, outRule, matchLength, start, light });
      navigate(`/carriere/${career.id}`);
    } catch (e) {
      toast((e as Error).message, "critical");
      setBusy(false);
    }
  };

  if (humans.length === 0) {
    return (
      <EmptyState title="Créez d'abord votre profil" action={<Link to="/joueurs"><Button variant="primary" icon="plus">Créer un profil</Button></Link>}>
        La carrière se joue avec un profil de joueur : ses matchs comptent dans ses statistiques.
      </EmptyState>
    );
  }

  return (
    <Card title="Nouvelle carrière">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Joueur">
          <select className={inputClass} value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            {humans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nationalité">
          <select className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)}>
            {options.data?.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nom de la carrière (facultatif)">
          <input className={inputClass} value={name} maxLength={60} placeholder="Carrière de …" onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4">
        <span className="mb-1.5 block text-sm font-medium text-ink-200">Difficulté</span>
        <DifficultyPicker options={options.data?.difficulties ?? []} value={difficulty} onChange={setDifficulty} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Field label="Finish" hint="S'applique à tous les matchs de la carrière.">
          <Segmented
            value={outRule}
            onChange={setOutRule}
            options={[
              { value: "double", label: "Double sortie" },
              { value: "single", label: "Sortie simple" },
            ]}
          />
        </Field>
        <Field label="Longueur des matchs" hint="Finale du World Matchplay : premier à 6 (court), 9 (raccourci) ou 18 legs (réel).">
          <Segmented
            value={matchLength}
            onChange={setMatchLength}
            options={[
              { value: "courte", label: "Courte" },
              { value: "raccourcie", label: "Raccourcie" },
              { value: "reelle", label: "Réelle" },
            ]}
          />
        </Field>
        <Field label="Départ" hint={start === "qschool" ? "Décrochez votre Tour Card en atteignant le dernier carré (ou mieux) de la Q-School." : "Vous commencez avec une Tour Card valable deux saisons, sans gains."}>
          <Segmented
            value={start}
            onChange={setStart}
            options={[
              { value: "qschool", label: "Q-School" },
              { value: "tourcard", label: "Avec une Tour Card" },
            ]}
          />
        </Field>
      </div>
      <div className="mt-4">
        <Toggle checked={light} onChange={setLight} label="Calendrier allégé (moins de Players Championships et d'étapes de l'European Tour)" />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="primary" icon="play" disabled={!playerId || busy} onClick={create}>
          Commencer la carrière
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </Card>
  );
}

function DifficultyPicker({ options, value, onChange }: { options: Options["difficulties"]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Difficulté">
      {options.map((d) => (
        <button
          key={d.id}
          type="button"
          role="radio"
          aria-checked={value === d.id}
          onClick={() => onChange(d.id)}
          className={`press rounded-xl border p-3 text-left ${value === d.id ? "border-brand-500 bg-brand-500/15" : "border-ink-600 bg-ink-900 hover:border-ink-500"}`}
        >
          <span className={`block font-semibold ${value === d.id ? "text-brand-300" : "text-ink-100"}`}>{d.label}</span>
          <span className="block text-xs text-ink-400">{d.hint}</span>
        </button>
      ))}
    </div>
  );
}

/** Réglages d'une carrière en cours : difficulté (le circuit est recalculé), finish, longueur des matchs. */
function SettingsModal({ career, onClose, onSaved }: { career: CareerView; onClose: () => void; onSaved: () => void }) {
  const { toast } = useUi();
  const options = useAsync(() => api.get<Options>("/api/careers/options"), []);
  const [difficulty, setDifficulty] = useState(career.settings.difficulty);
  const [outRule, setOutRule] = useState(career.settings.outRule);
  const [matchLength, setMatchLength] = useState(career.settings.matchLength);
  const [busy, setBusy] = useState(false);
  const r = career.settings.ranges;
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/careers/${career.id}/settings`, { ...(difficulty !== career.settings.difficulty ? { difficulty } : {}), outRule, matchLength });
      toast("Réglages enregistrés : ils s'appliquent aux prochains matchs.", "good");
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, "critical");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Réglages de la carrière" wide>
      <div className="space-y-4">
        <p className="text-sm text-ink-300">
          Niveau actuel du circuit : joueurs sans carte entre {Math.round(r.amateurs[0])} et {Math.round(r.amateurs[1])} de moyenne, pros entre {Math.round(r.card[0])} et{" "}
          {Math.round(r.card[1])}. Changer la difficulté recalcule le niveau de tous les joueurs (chacun garde son rang) ; votre parcours et vos gains sont
          conservés.
        </p>
        <Field label="Difficulté">
          <DifficultyPicker options={options.data?.difficulties ?? []} value={difficulty} onChange={setDifficulty} />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Finish">
            <Segmented
              value={outRule}
              onChange={setOutRule}
              options={[
                { value: "double", label: "Double sortie" },
                { value: "single", label: "Sortie simple" },
              ]}
            />
          </Field>
          <Field label="Longueur des matchs">
            <Segmented
              value={matchLength}
              onChange={setMatchLength}
              options={[
                { value: "courte", label: "Courte" },
                { value: "raccourcie", label: "Raccourcie" },
                { value: "reelle", label: "Réelle" },
              ]}
            />
          </Field>
        </div>
        <p className="text-xs text-ink-400">Un match déjà commencé garde son format et son adversaire ; les nouveaux réglages valent pour les matchs suivants.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" icon="check" disabled={busy} onClick={save}>
            Enregistrer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Tableau de bord d'une carrière ----------

type Tab = "tournoi" | "calendrier" | "classements" | "circuit" | "palmares";

export function CareerPage() {
  const { id = "" } = useParams();
  const career = useAsync(() => api.get<CareerView>(`/api/careers/${id}`), [id]);
  const [tab, setTab] = useState<Tab>("tournoi");
  const navigate = useNavigate();
  const remove = useDeleteCareer(() => navigate("/carriere"));
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (career.error) return <ErrorBox message={career.error} onRetry={career.reload} />;
  if (!career.data) return <Spinner label="Chargement de la carrière…" />;
  const c = career.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title={c.name}
        subtitle={`Saison ${c.season} · ${c.settings.difficultyLabel} · sortie ${c.settings.outRule === "double" ? "double" : "simple"} · matchs ${LENGTH_LABEL[c.settings.matchLength]}`}
        actions={
          <>
            <Link to="/carriere">
              <Button size="sm" variant="ghost" icon="back">
                Carrières
              </Button>
            </Link>
            <Button size="sm" variant="ghost" icon="settings" onClick={() => setSettingsOpen(true)}>
              Réglages
            </Button>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => void remove(c)}>
              Supprimer
            </Button>
          </>
        }
      />
      {settingsOpen && <SettingsModal career={c} onClose={() => setSettingsOpen(false)} onSaved={career.reload} />}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <StatTile label="Order of Merit" value={c.me.rank ? `#${c.me.rank}` : "—"} hint={c.me.rank ? "classement mondial PDC" : "non classé"} accent />
        <StatTile label="Gains (2 saisons)" value={<span className="text-2xl">{fmtMoney(c.me.money)}</span>} />
        <StatTile label={`Gains ${c.season}`} value={<span className="text-2xl">{fmtMoney(c.me.seasonMoney)}</span>} />
        <StatTile label="Titres" value={c.me.titles} />
        <StatTile label="Tour Card" value={<span className="text-2xl">{c.me.card ? `→ ${c.me.cardUntil}` : "Aucune"}</span>} hint={c.me.card ? "valable jusqu'à la fin de la saison" : c.me.challengeRank ? `Challenge Tour : #${c.me.challengeRank}` : "Q-School, Challenge Tour, WDF"} />
      </div>
      <NextStep career={c} onChange={career.reload} />
      {c.feed.length > 0 && (
        <Card title="Pendant ce temps">
          <ul className="space-y-1 text-sm">
            {c.feed.map((f, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2">
                <span className="text-ink-400">{f.event} :</span>
                <Name side={{ name: f.winner, flag: f.flag }} className="font-semibold" />
                <span className="text-ink-300">
                  bat {f.runnerUp} {f.final}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "tournoi", label: "Tournoi" },
          { value: "calendrier", label: "Calendrier" },
          { value: "classements", label: "Classements" },
          { value: "circuit", label: "Circuit" },
          { value: "palmares", label: "Palmarès" },
        ]}
      />
      {tab === "tournoi" && <RunPanel run={c.run} />}
      {tab === "calendrier" && <CalendarPanel career={c} />}
      {tab === "classements" && <RankingsPanel careerId={c.id} />}
      {tab === "circuit" && <CircuitPanel careerId={c.id} />}
      {tab === "palmares" && <HistoryPanel careerId={c.id} />}
    </div>
  );
}

function EventHeading({ event, extra }: { event: EventInfo; extra?: ReactNode }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={event.ranking ? "brand" : "neutral"}>{event.tierLabel}</Badge>
        {event.doubleIn && <Badge tone="info">Départ double</Badge>}
        <h2 className="font-display text-2xl font-bold uppercase sm:text-3xl">{event.name}</h2>
        {extra}
      </div>
      <p className="text-sm text-ink-300">
        {event.venue}, {event.city} · {event.when} · {event.field} joueurs{event.winnerPrize > 0 ? ` · vainqueur : ${fmtMoney(event.winnerPrize)}` : ""}
      </p>
    </div>
  );
}

function NextStep({ career, onChange }: { career: CareerView; onChange: () => void }) {
  const { autodarts } = useAppState();
  const navigate = useNavigate();
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const [inputMode, setInputMode] = useState<"autodarts" | "manual">(autodarts?.status.state === "connected" ? "autodarts" : "manual");
  const p = career.pending;
  if (!p) return null;

  const advance = async () => {
    setBusy(true);
    try {
      await api.post(`/api/careers/${career.id}/continue`);
      onChange();
    } catch (e) {
      toast((e as Error).message, e instanceof ApiError && e.code === "match_pending" ? "warning" : "critical");
    } finally {
      setBusy(false);
    }
  };
  const play = async () => {
    setBusy(true);
    try {
      const { matchId } = await api.post<{ matchId: string }>(`/api/careers/${career.id}/play`, { inputMode });
      navigate(`/partie/${matchId}`);
    } catch (e) {
      toast((e as Error).message, "critical");
      setBusy(false);
    }
  };

  if (p.kind === "match") {
    const o = p.opponent;
    return (
      <section className="rounded-2xl border border-brand-500/50 bg-gradient-to-br from-brand-900/60 to-ink-850 p-4 sm:p-5" aria-label="Prochain match">
        <EventHeading event={p.event} extra={<span className="font-display text-xl text-brand-300">· {p.round}</span>} />
        <div className="mt-4 grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-xl bg-ink-900/70 p-3">
            <div className="flex items-center gap-3">
              {career.me.profile && <PlayerAvatar avatar={career.me.profile.avatar} color={career.me.profile.color} photo={career.me.profile.photo} size={48} />}
              <div className="min-w-0">
                <Name side={{ name: career.me.name, flag: career.me.flag, human: true }} className="font-display text-2xl" />
                <p className="text-sm text-ink-400">{career.me.rank ? `#${career.me.rank} mondial` : "non classé"}</p>
              </div>
            </div>
          </div>
          <span className="text-center font-display text-3xl font-bold text-brand-500">VS</span>
          <div className="rounded-xl bg-ink-900/70 p-3 sm:text-right">
            <Name side={o} className="font-display text-2xl" />
            <p className="text-sm text-ink-400">
              {o.nickname && <span className="italic">« {o.nickname} » · </span>}moy. {o.rating.toLocaleString("fr-FR")}
              {o.rank ? ` · #${o.rank} mondial` : ""}
              {o.titles > 0 ? ` · ${o.titles} titre(s)` : ""}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-200">
          {p.formatLabel} · bull-up : {p.humanFirst ? "vous commencez" : `${o.name} commence`}
        </p>
        {p.result ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className={`font-display text-3xl font-bold uppercase ${p.result.won ? "text-[#6fdc6f]" : "text-[#ff8f8f]"}`}>
              {p.result.won ? "Victoire" : "Défaite"} {p.result.me}-{p.result.opp}
            </span>
            <Button variant="primary" size="lg" icon="next" disabled={busy} onClick={advance}>
              Valider et continuer le tournoi
            </Button>
            {p.matchId && (
              <Link to={`/partie/${p.matchId}`} className="text-sm text-ink-300 underline-offset-2 hover:underline">
                Corriger le match
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {p.matchStatus === "active" ? (
              <Button variant="primary" size="lg" icon="play" disabled={busy} onClick={play}>
                Reprendre le match
              </Button>
            ) : (
              <>
                <Segmented
                  size="sm"
                  value={inputMode}
                  onChange={setInputMode}
                  options={[
                    { value: "autodarts", label: "Autodarts" },
                    { value: "manual", label: "Saisie manuelle" },
                  ]}
                />
                <Button variant="primary" size="lg" icon="play" disabled={busy} onClick={play}>
                  Jouer le match
                </Button>
              </>
            )}
          </div>
        )}
      </section>
    );
  }

  if (p.kind === "event") {
    const h = p.result.human;
    const won = h?.stage === 0;
    return (
      <section className={`rounded-2xl border p-4 sm:p-5 ${won ? "border-brand-500 bg-gradient-to-br from-brand-900 to-ink-850" : "border-ink-700 bg-ink-850"}`} aria-label="Tournoi terminé">
        <EventHeading event={p.event} />
        <p className={`mt-3 font-display text-3xl font-bold uppercase ${won ? "text-brand-300" : "text-ink-100"}`}>
          {won ? `🏆 Vous remportez le ${p.event.name} !` : h ? `Parcours : ${h.label}` : "Tournoi terminé"}
        </p>
        {h && h.prize > 0 && <p className="text-lg text-ink-200">Gains : {fmtMoney(h.prize)}</p>}
        {h?.card === true && <p className="mt-1 font-semibold text-[#6fdc6f]">Tour Card obtenue : vous êtes sur le circuit PDC pour deux saisons !</p>}
        {h?.card === false && <p className="mt-1 text-warning">Pas de Tour Card cette année : le Challenge Tour (les deux premiers obtiennent une carte) et les tournois WDF vous attendent.</p>}
        {!won && (
          <p className="mt-1 text-ink-300">
            Vainqueur : <strong>{p.result.winnerName}</strong> ({p.result.final} en finale contre {p.result.runnerUpName})
          </p>
        )}
        <Button className="mt-4" variant="primary" size="lg" icon="next" disabled={busy} onClick={advance}>
          Tournoi suivant
        </Button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-brand-500/50 bg-ink-850 p-4 sm:p-5" aria-label="Fin de saison">
      <h2 className="font-display text-3xl font-bold uppercase">Saison {p.season} terminée</h2>
      <p className="mt-2 text-lg text-ink-200">
        {p.rank ? `#${p.rank} à l'Order of Merit` : "Non classé à l'Order of Merit"} · gains de la saison : {fmtMoney(p.seasonMoney)}
      </p>
      {p.titles.length > 0 && <p className="text-brand-300">Titres : {p.titles.join(", ")}</p>}
      <p className="mt-1 text-sm text-ink-300">
        Les Tour Cards qui arrivent à échéance sont renouvelées dans le top 64 de l'Order of Merit ; les deux premiers du Challenge Tour obtiennent la leur.
      </p>
      <Button className="mt-4" variant="primary" size="lg" icon="next" disabled={busy} onClick={advance}>
        Passer à la saison {p.season + 1}
      </Button>
    </section>
  );
}

function FixtureRow({ f }: { f: FixtureView }) {
  const side = (s: Side | null, score: number | null, avg: number | null) =>
    s ? (
      <div className={`flex items-center justify-between gap-2 ${f.winner && f.winner === s.id ? "font-semibold text-ink-100" : f.winner ? "text-ink-400" : "text-ink-200"}`}>
        <Name side={s} />
        <span className="flex shrink-0 items-center gap-2">
          {avg !== null && <span className="text-xs text-ink-500">{avg.toLocaleString("fr-FR")}</span>}
          <span className="font-display tabular w-6 text-right text-lg">{score ?? ""}</span>
        </span>
      </div>
    ) : (
      <div className="text-ink-500">—</div>
    );
  const mine = f.a?.human || f.b?.human;
  return (
    <li className={`rounded-xl px-3 py-1.5 text-sm ${mine ? "bg-brand-500/10 ring-1 ring-brand-500/40" : "bg-ink-900"}`}>
      {side(f.a, f.sa, f.avgA)}
      {side(f.b, f.sb, f.avgB)}
    </li>
  );
}

function RunPanel({ run }: { run: RunView | null }) {
  const [round, setRound] = useState<number | null>(null);
  if (!run) return <Card><p className="text-ink-300">Aucun tournoi en cours. Le tableau du prochain tournoi où vous êtes engagé apparaîtra ici.</p></Card>;
  const shown = round !== null && round < run.rounds.length ? round : run.rounds.length - 1;
  return (
    <Card title={run.event.name}>
      {run.groups.length > 0 && (
        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {run.groups.map((g) => (
            <div key={g.name} className="rounded-xl border border-ink-700 bg-ink-900 p-3">
              <h3 className="mb-2 font-semibold">{g.name}</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-400">
                  <tr>
                    <th>Joueur</th>
                    <th className="text-right">J</th>
                    <th className="text-right">V</th>
                    <th className="text-right">+/-</th>
                  </tr>
                </thead>
                <tbody>
                  {g.table.map((r, i) => (
                    <tr key={r.id} className={i < run.advance ? "" : "text-ink-400"}>
                      <td className="max-w-0 py-0.5">
                        <Name side={r} />
                      </td>
                      <td className="text-right tabular">{r.played}</td>
                      <td className="text-right tabular">{r.won}</td>
                      <td className="text-right tabular">{r.legDiff > 0 ? `+${r.legDiff}` : r.legDiff}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {run.phase === "groups" && <p className="mt-1 text-xs text-ink-500">Les {run.advance} premiers sont qualifiés.</p>}
            </div>
          ))}
        </div>
      )}
      {run.rounds.length > 0 && (
        <>
          <Segmented size="sm" value={shown} onChange={setRound} options={run.rounds.map((r, i) => ({ value: i, label: r.name }))} />
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {run.rounds[shown]!.fixtures.map((f, i) => (
              <FixtureRow key={i} f={f} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function CalendarPanel({ career }: { career: CareerView }) {
  return (
    <Card title={`Calendrier ${career.season}`}>
      <ol className="divide-y divide-ink-800">
        {career.calendar.map((e) => (
          <li key={e.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${e.status === "upcoming" ? "opacity-80" : ""}`}>
            <span className="w-24 shrink-0 text-sm text-ink-400 first-letter:uppercase">{e.when}</span>
            <span className="min-w-0 flex-1">
              <span className={`font-semibold ${e.status === "current" ? "text-brand-300" : ""}`}>{e.name}</span>
              <span className="ml-2 text-xs text-ink-400">
                {e.tierLabel} · {e.city}
              </span>
            </span>
            {e.status === "current" && <Badge tone="brand">En cours</Badge>}
            {e.status === "done" && e.winner && (
              <span className="flex items-center gap-2 text-sm">
                <Icon name="trophy" size={14} className="text-ink-400" />
                <Name side={e.winner} />
                <span className="text-ink-400">{e.final}</span>
              </span>
            )}
            {e.status === "done" && <Badge tone={e.human?.stage === 0 ? "brand" : e.human ? "info" : "neutral"}>{e.human ? `${e.human.label}${e.human.prize ? ` · ${fmtMoney(e.human.prize)}` : ""}` : "Non engagé"}</Badge>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

const CATEGORIES = [
  { value: "pdc", label: "Order of Merit" },
  { value: "protour", label: "Pro Tour" },
  { value: "eurotour", label: "European Tour" },
  { value: "pc", label: "Players Championship" },
  { value: "ws", label: "World Series" },
  { value: "challenge", label: "Challenge Tour" },
  { value: "wdf", label: "WDF" },
];

interface RankingRow extends PlayerInfo {
  money: number;
}

function RankingsPanel({ careerId }: { careerId: string }) {
  const [category, setCategory] = useState("pdc");
  const data = useAsync(() => api.get<{ label: string; rows: RankingRow[]; me: RankingRow | null; total: number }>(`/api/careers/${careerId}/rankings?category=${category}`), [careerId, category]);
  const row = (r: RankingRow) => (
    <tr key={r.id} className={`border-t border-ink-800 ${r.human ? "bg-brand-500/10" : ""}`}>
      <td className="py-1.5 pr-2 text-right font-display tabular text-lg text-ink-300">{r.rank}</td>
      <td className="max-w-0 pr-2">
        <Name side={r} />
        {r.nickname && <span className="hidden text-xs italic text-ink-500 md:inline"> « {r.nickname} »</span>}
      </td>
      <td className="pr-2 text-right tabular text-ink-300">{r.human ? "—" : r.rating.toLocaleString("fr-FR")}</td>
      <td className="text-right tabular">{fmtMoney(r.money)}</td>
    </tr>
  );
  return (
    <Card title={data.data?.label ?? "Classements"}>
      <Segmented size="sm" value={category} onChange={setCategory} options={CATEGORIES} />
      {data.data && data.data.rows.length === 0 && <p className="mt-3 text-ink-400">Aucun gain dans ce classement pour l'instant.</p>}
      {data.data && data.data.rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink-400">
              <tr>
                <th className="w-12 pr-2 text-right">#</th>
                <th>Joueur</th>
                <th className="pr-2 text-right">Moy.</th>
                <th className="text-right">Gains</th>
              </tr>
            </thead>
            <tbody>
              {data.data.rows.map(row)}
              {data.data.me && !data.data.rows.some((r) => r.human) && row(data.data.me)}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-500">{data.data.total} joueurs classés.</p>
        </div>
      )}
    </Card>
  );
}

interface CircuitRow extends PlayerInfo {
  age: number;
  money: number;
}

function CircuitPanel({ careerId }: { careerId: string }) {
  const data = useAsync(() => api.get<CircuitRow[]>(`/api/careers/${careerId}/players`), [careerId]);
  const [search, setSearch] = useState("");
  const [onlyCard, setOnlyCard] = useState(true);
  const [editing, setEditing] = useState<CircuitRow | null>(null);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data.data ?? []).filter((p) => (!onlyCard || p.card || p.human) && (!q || p.name.toLowerCase().includes(q) || p.nickname.toLowerCase().includes(q)));
  }, [data.data, search, onlyCard]);
  return (
    <Card title="Le circuit">
      <p className="mb-3 text-sm text-ink-300">
        Joueurs fictifs, au niveau de la difficulté choisie ; ils progressent ou déclinent au fil des saisons. Vous pouvez les renommer (par exemple avec les
        noms de vrais joueurs) : leur niveau ne change pas.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input className={`${inputClass} !w-64`} placeholder="Rechercher un joueur…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher un joueur" />
        <Toggle checked={onlyCard} onChange={setOnlyCard} label="Détenteurs d'une Tour Card" />
      </div>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="sticky top-0 bg-ink-850 text-left text-xs uppercase tracking-wider text-ink-400">
            <tr>
              <th className="w-12 pr-2 text-right">#</th>
              <th>Joueur</th>
              <th className="pr-2 text-right">Âge</th>
              <th className="pr-2 text-right">Moy.</th>
              <th className="pr-2 text-right">Titres</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={`border-t border-ink-800 ${p.human ? "bg-brand-500/10" : ""}`}>
                <td className="py-1.5 pr-2 text-right tabular text-ink-400">{p.rank ?? "—"}</td>
                <td className="max-w-0 pr-2">
                  <Name side={p} />
                  {p.nickname && <span className="block truncate text-xs italic text-ink-500">« {p.nickname} »</span>}
                </td>
                <td className="pr-2 text-right tabular text-ink-300">{p.human ? "" : p.age}</td>
                <td className="pr-2 text-right tabular">{p.human ? "—" : p.rating.toLocaleString("fr-FR")}</td>
                <td className="pr-2 text-right tabular">{p.titles || ""}</td>
                <td className="text-right">{!p.human && <Button size="sm" variant="ghost" icon="edit" aria-label={`Renommer ${p.name}`} onClick={() => setEditing(p)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <RenameModal careerId={careerId} player={editing} onClose={() => setEditing(null)} onSaved={data.reload} />}
    </Card>
  );
}

function RenameModal({ careerId, player, onClose, onSaved }: { careerId: string; player: CircuitRow; onClose: () => void; onSaved: () => void }) {
  const { toast } = useUi();
  const [name, setName] = useState(player.name);
  const [nickname, setNickname] = useState(player.nickname);
  const save = async () => {
    try {
      await api.patch(`/api/careers/${careerId}/players/${player.id}`, { name, nickname });
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  return (
    <Modal open onClose={onClose} title={`Renommer ${player.name}`}>
      <div className="space-y-3">
        <Field label="Nom">
          <input className={inputClass} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Surnom">
          <input className={inputClass} value={nickname} maxLength={32} onChange={(e) => setNickname(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button variant="primary" icon="check" disabled={name.trim().length < 2} onClick={save}>
            Enregistrer
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface HistoryData {
  titles: { season: number; event: string; final: string; runnerUp: string }[];
  bestResults: { name: string; best: string; wins: number }[];
  seasons: { season: number; humanRank: number | null; humanMoney: number; humanTitles: string[]; notes: string[]; top: { name: string; flag: string; money: number; human: boolean }[] }[];
  events: { season: number; event: string; label: string; prize: number; card: boolean | null }[];
}

function HistoryPanel({ careerId }: { careerId: string }) {
  const data = useAsync(() => api.get<HistoryData>(`/api/careers/${careerId}/history`), [careerId]);
  const d = data.data;
  if (!d) return <Spinner />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Titres">
        {d.titles.length === 0 ? (
          <p className="text-ink-400">Pas encore de titre. Le premier est toujours le plus beau.</p>
        ) : (
          <ul className="space-y-1">
            {d.titles.map((t, i) => (
              <li key={i} className="flex items-center gap-2">
                <span>🏆</span>
                <span className="font-semibold">{t.event}</span>
                <span className="text-sm text-ink-400">
                  {t.season} · {t.final} contre {t.runnerUp}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Meilleurs résultats">
        {d.bestResults.length === 0 ? (
          <p className="text-ink-400">Aucun tournoi joué pour l'instant.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {d.bestResults.map((b) => (
                <tr key={b.name} className="border-t border-ink-800">
                  <td className="py-1.5">{b.name}</td>
                  <td className="text-right">
                    <Badge tone={b.wins ? "brand" : "neutral"}>{b.wins ? `${b.wins} titre(s)` : b.best}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Saisons">
        {d.seasons.length === 0 ? (
          <p className="text-ink-400">Le bilan de chaque saison apparaîtra ici après le championnat du monde.</p>
        ) : (
          <ul className="space-y-3">
            {[...d.seasons].reverse().map((s) => (
              <li key={s.season} className="rounded-xl bg-ink-900 p-3">
                <p className="font-semibold">
                  Saison {s.season} · {s.humanRank ? `#${s.humanRank}` : "non classé"} · {fmtMoney(s.humanMoney)}
                </p>
                {s.humanTitles.length > 0 && <p className="text-sm text-brand-300">Titres : {s.humanTitles.join(", ")}</p>}
                {s.notes.map((n, i) => (
                  <p key={i} className="text-sm text-ink-300">
                    {n}
                  </p>
                ))}
                <p className="mt-1 text-xs text-ink-400">
                  Top 5 : {s.top.map((t) => `${t.flag} ${t.name}`).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Tous vos tournois">
        <ul className="max-h-[420px] space-y-1 overflow-auto text-sm">
          {d.events.map((e, i) => (
            <li key={i} className="flex justify-between gap-2 border-t border-ink-800 py-1">
              <span>
                {e.event} <span className="text-ink-500">{e.season}</span>
              </span>
              <span className="text-ink-300">
                {e.label}
                {e.card ? " · Tour Card" : ""}
                {e.prize ? ` · ${fmtMoney(e.prize)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** Suppression d'une carrière, après confirmation (depuis la liste ou le tableau de bord). */
function useDeleteCareer(onDeleted: () => void) {
  const { confirm, toast } = useUi();
  return async (career: { id: string; name: string }) => {
    const ok = await confirm({
      title: `Supprimer « ${career.name} » ?`,
      message:
        "La carrière (circuit, calendrier, classements, palmarès) est définitivement supprimée. Les matchs déjà joués restent dans l'historique et les statistiques ; un match de carrière en cours est abandonné.",
      confirmLabel: "Supprimer la carrière",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/careers/${career.id}`);
      toast(`Carrière « ${career.name} » supprimée.`, "good");
      onDeleted();
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
}

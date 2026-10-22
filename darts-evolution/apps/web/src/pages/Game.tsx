import { endReasonLabel } from "@darts-evolution/game-engine";
import type { Dart } from "@darts-evolution/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AutodartsPill } from "../components/AutodartsStatus";
import { CricketTable, DartChip, DartPad, DartPickerModal, PlayerCards, VisitHistory } from "../components/game";
import { Icon } from "../components/Icon";
import { Badge, Button, Card, ErrorBox, Spinner, useUi } from "../components/ui";
import { ApiError, api, newId } from "../lib/api";
import { useAppState } from "../lib/app-state";
import { useLocalPreference, useSocketEvent } from "../lib/hooks";
import { emitAck, getSocket } from "../lib/socket";
import type { CommandResult, MatchSnapshot, ThrownDart } from "../lib/types";

interface Device {
  socketId: string;
  name: string;
  role: "player" | "spectator";
}

export function GamePage() {
  const { id = "" } = useParams();
  const [search] = useSearchParams();
  const role = search.get("role") === "spectator" ? "spectator" : "player";
  const navigate = useNavigate();
  const { autodarts } = useAppState();
  const { toast, confirm } = useUi();
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [correcting, setCorrecting] = useState<ThrownDart | null>(null);
  const [deviceName] = useLocalPreference("deviceName", `Appareil ${Math.floor(Math.random() * 90 + 10)}`);
  const versionRef = useRef(-1);

  const accept = useCallback((next: MatchSnapshot) => {
    if (next.match.version < versionRef.current) return; // réponse plus ancienne que l'état affiché
    versionRef.current = next.match.version;
    setSnapshot(next);
  }, []);

  const load = useCallback(async () => {
    try {
      accept(await api.get<MatchSnapshot>(`/api/matches/${id}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, accept]);

  // Rejoint la salle temps réel (et la rejoint à nouveau après chaque reconnexion).
  useEffect(() => {
    versionRef.current = -1;
    void load();
    const socket = getSocket();
    const join = () => {
      emitAck<{ ok: boolean; snapshot?: MatchSnapshot; devices?: Device[] }>("room:join", { matchId: id, role, name: deviceName })
        .then((r) => {
          if (r.ok && r.snapshot) accept(r.snapshot);
          if (r.devices) setDevices(r.devices);
        })
        .catch(() => {});
    };
    if (socket.connected) join();
    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
      socket.emit("room:leave", { matchId: id });
    };
  }, [id, role, deviceName, load, accept]);

  useSocketEvent<MatchSnapshot>("match:state", (s) => s.match.id === id && accept(s));
  useSocketEvent<{ matchId: string; devices: Device[] }>("room:presence", (p) => p.matchId === id && setDevices(p.devices));
  useSocketEvent<{ matchId: string | null; level: string; message: string }>("autodarts:notice", (n) => {
    if (n.matchId === id) toast(n.message, n.level === "warning" ? "warning" : "info");
  });
  useSocketEvent<{ matchId: string }>("match:deleted", (p) => {
    if (p.matchId === id) {
      toast("Cette partie a été supprimée.", "warning");
      navigate("/");
    }
  });

  const command = useCallback(
    async (body: Record<string, unknown>) => {
      if (!snapshot || role === "spectator") return;
      setBusy(true);
      try {
        const result = await api.post<CommandResult>(`/api/matches/${id}/commands`, { ...body, commandId: newId(), baseVersion: snapshot.match.version });
        accept(result.snapshot);
        if (result.notice) toast(result.notice, "info");
      } catch (e) {
        if (e instanceof ApiError && e.code === "version_conflict") {
          toast(e.message, "warning");
          await load();
        } else {
          toast((e as Error).message, "critical");
        }
      } finally {
        setBusy(false);
      }
    },
    [snapshot, role, id, accept, load, toast],
  );

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!snapshot) return <Spinner label="Chargement de la partie…" />;

  const { match, view } = snapshot;
  const finished = match.status !== "active";
  const isAutodarts = match.inputMode === "autodarts";
  const bound = autodarts?.boundMatchId === match.id;
  const current = view.current;
  const currentPlayer = match.players.find((p) => p.id === current.playerId);
  const nextPlayer = match.players.find((p) => p.id === current.nextPlayerId);
  const spectator = role === "spectator";
  const canInput = !finished && !spectator;
  const canCorrect = canInput || (match.status === "finished" && !spectator);
  const slots = [0, 1, 2].map((i) => current.darts[i] ?? null);

  const onDart = (dart: Dart) => command({ kind: "dart", dart });
  const switchInput = async (mode: "manual" | "autodarts") => {
    try {
      accept(await api.post<MatchSnapshot>(`/api/matches/${id}/input-mode`, { mode }));
      toast(mode === "manual" ? "Saisie manuelle activée pour cette partie." : "Détection Autodarts activée pour cette partie.", "good");
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const rematch = async () => {
    try {
      const order = [...match.players.map((p) => p.id).slice(1), match.players[0]!.id];
      const created = await api.post<MatchSnapshot>("/api/matches", { mode: match.mode, options: match.options, playerIds: order, inputMode: match.inputMode });
      navigate(`/partie/${created.match.id}`);
    } catch (e) {
      toast((e as Error).message, "critical");
    }
  };
  const abandon = async () => {
    if (!(await confirm({ title: "Abandonner la partie ?", message: "La partie sera marquée « abandonnée ». Les fléchettes déjà lancées restent dans les statistiques.", confirmLabel: "Abandonner", danger: true }))) return;
    await command({ kind: "abandon" });
  };
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => toast("Plein écran non disponible sur cet appareil.", "warning"));
  };

  return (
    <div className="space-y-4">
      {/* En-tête de partie */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold uppercase sm:text-3xl">{view.modeName}</h1>
            {match.isSimulation && (
              <span title="Partie de test : exclue des statistiques réelles">
                <Badge tone="warning">SIMULATION · hors statistiques</Badge>
              </span>
            )}
            {match.status === "finished" && <Badge tone="brand">Terminée</Badge>}
            {match.status === "abandoned" && <Badge>Abandonnée</Badge>}
            {spectator && <Badge tone="info">Mode spectateur</Badge>}
          </div>
          <p className="truncate text-sm text-ink-300">{view.headline}</p>
        </div>
        <span className="rounded-xl border border-ink-600 bg-ink-900 px-3 py-1.5 text-sm" title="Code de salle : à saisir sur un autre appareil (menu « Rejoindre une salle »)">
          Salle <span className="font-display tabular text-lg font-bold tracking-widest text-brand-400">{match.roomCode}</span>
          <span className="ml-2 text-ink-400">· {devices.length || 1} appareil(s)</span>
        </span>
        {isAutodarts && (
          <span className="hidden lg:inline-flex">
            <AutodartsPill overview={autodarts} compact />
          </span>
        )}
        <Button size="sm" variant="ghost" icon="fullscreen" onClick={fullscreen} aria-label="Plein écran" />
      </div>

      {finished && (
        <div className="animate-pop rounded-2xl border border-brand-500/50 bg-gradient-to-br from-brand-900 to-ink-850 p-5">
          <p className="font-display text-3xl font-bold uppercase text-brand-300">
            {match.status === "abandoned"
              ? "Partie abandonnée"
              : view.winners.length === 0
                ? "Séance terminée"
                : view.winners.length > 1
                  ? "Égalité !"
                  : `Victoire de ${match.players.find((p) => p.id === view.winners[0])?.name ?? "?"}`}
          </p>
          <p className="mt-1 text-ink-300">Résultats enregistrés — statistiques mises à jour. Une correction reste possible en touchant une fléchette ci-dessous.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" icon="refresh" onClick={rematch}>
              Rejouer
            </Button>
            <Link to="/statistiques">
              <Button icon="chart">Statistiques</Button>
            </Link>
            <Link to={`/historique/${match.id}`}>
              <Button icon="history">Détail de la partie</Button>
            </Link>
            <Link to="/">
              <Button variant="ghost" icon="home">
                Accueil
              </Button>
            </Link>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <PlayerCards view={view} players={match.players} />
          {view.board && <CricketTable view={view} />}
          <Card title="Historique de la partie" className="hidden xl:block">
            <VisitHistory visits={view.recentVisits} players={match.players} onDartClick={canCorrect ? setCorrecting : undefined} />
          </Card>
        </div>

        <div className="space-y-4">
          {/* Visite en cours */}
          <Card>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-wider text-ink-400">{finished ? "Dernière visite" : current.awaitingNext ? "Visite terminée" : "Au tour de"}</div>
                <div className="font-display text-2xl font-bold">{currentPlayer?.name}</div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-wider text-ink-400">Visite</div>
                <div className="font-display tabular text-4xl font-bold text-brand-500">{current.visitPoints}</div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              {slots.map((d, i) => (
                <DartChip key={i} dart={d} size="lg" onClick={d && canInput ? () => setCorrecting(d) : undefined} />
              ))}
            </div>
            {current.endReason && current.complete && (
              <p className={`mt-3 font-semibold ${current.endReason === "bust" ? "text-[#ff8f8f]" : "text-brand-300"}`}>{endReasonLabel(current.endReason)}</p>
            )}
            {current.awaitingNext && nextPlayer && (
              <p className="mt-1 text-sm text-ink-300">
                {isAutodarts ? "Retirez les fléchettes pour passer à " : "Prochain joueur : "}
                <strong className="text-ink-100">{nextPlayer.name}</strong>
                {!isAutodarts && " (saisir une fléchette passe automatiquement au joueur suivant)"}
              </p>
            )}
            {current.instruction && !current.awaitingNext && !finished && <p className="mt-3 text-ink-200">{current.instruction}</p>}
            {view.checkout && !finished && (
              <div className="mt-3 rounded-xl border border-ink-700 bg-ink-900 p-3">
                <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wider text-ink-400">
                  <span>Checkout {view.checkout.remaining}</span>
                  <span>{view.checkout.dartsLeft} fléchette(s)</span>
                </div>
                {view.checkout.routes.length === 0 ? (
                  <p className="text-sm text-ink-300">Pas de sortie possible avec les fléchettes restantes.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {view.checkout.routes.map((r, i) => (
                      <li key={i} className={`flex items-center gap-2 ${i === 0 ? "" : "opacity-70"}`}>
                        {r.map((label, j) => (
                          <span key={j} className={`font-display rounded-lg px-2.5 py-1 text-lg font-bold ${i === 0 ? "bg-brand-500 text-ink-950" : "bg-ink-700 text-ink-100"}`}>
                            {label}
                          </span>
                        ))}
                        {i === 0 && <span className="text-xs text-ink-400">recommandé</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>

          {/* Saisie */}
          {canInput && (
            <Card>
              {isAutodarts ? (
                <div className="mb-3 space-y-2 rounded-xl border border-ink-700 bg-ink-900 p-3">
                  <div className="flex items-center gap-2">
                    <Icon name="plug" className="text-brand-500" />
                    <span className="font-semibold">Détection automatique Autodarts</span>
                  </div>
                  {!bound && <p className="text-sm text-warning">Cette partie n'est pas la partie liée à Autodarts : les impacts ne sont pas transmis.</p>}
                  {autodarts?.status.state !== "connected" && (
                    <p className="text-sm text-warning">
                      Autodarts n'est pas connecté : la partie est conservée. Passez en saisie manuelle ou attendez la reconnexion.
                    </p>
                  )}
                  {autodarts?.status.lastThrow && <p className="text-sm text-ink-300">Dernier impact détecté : {autodarts.status.lastThrow}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" icon="edit" onClick={() => switchInput("manual")}>
                      Passer en saisie manuelle
                    </Button>
                    {!bound && (
                      <Button size="sm" icon="link" onClick={() => api.post("/api/autodarts/bind", { matchId: match.id }).then(() => toast("Partie liée à Autodarts.", "good"))}>
                        Lier à Autodarts
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" icon="refresh" onClick={() => api.post("/api/autodarts/reset-board").catch((e: Error) => toast(e.message, "critical"))}>
                      Réinitialiser la cible
                    </Button>
                  </div>
                  <details className="text-sm text-ink-300">
                    <summary className="cursor-pointer">Saisir une fléchette manquée par la détection</summary>
                    <div className="mt-2">
                      <DartPad compact onDart={onDart} disabled={busy} />
                    </div>
                  </details>
                </div>
              ) : (
                <DartPad onDart={onDart} disabled={busy} />
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button icon="undo" onClick={() => command({ kind: "undo" })} disabled={busy}>
                  Annuler
                </Button>
                <Button variant="primary" icon="next" onClick={() => command({ kind: "next" })} disabled={busy}>
                  Joueur suivant
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm">
                {!isAutodarts && autodarts?.status.state === "connected" && (
                  <button className="text-ink-300 underline-offset-2 hover:underline" onClick={() => switchInput("autodarts")}>
                    Utiliser la détection Autodarts
                  </button>
                )}
                <button className="ml-auto text-ink-400 underline-offset-2 hover:text-[#ff8f8f] hover:underline" onClick={abandon}>
                  Abandonner la partie
                </button>
              </div>
            </Card>
          )}

          {finished && !spectator && match.status === "finished" && (
            <Card>
              <Button icon="undo" onClick={() => command({ kind: "undo" })} disabled={busy}>
                Annuler la dernière fléchette (rouvre la partie)
              </Button>
            </Card>
          )}

          <Card title="Historique de la partie" className="xl:hidden">
            <VisitHistory visits={view.recentVisits} players={match.players} onDartClick={canCorrect ? setCorrecting : undefined} />
          </Card>
        </div>
      </div>

      <DartPickerModal
        open={!!correcting}
        current={correcting}
        onClose={() => setCorrecting(null)}
        onPick={(dart) => correcting?.eventId && command({ kind: "correct", eventId: correcting.eventId, dart })}
      />
    </div>
  );
}

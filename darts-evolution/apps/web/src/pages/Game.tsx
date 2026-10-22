import type { BoardPoint, Dart } from "@darts-evolution/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PlayerPanel, SoundSettingsModal, VisitBar } from "../components/arena";
import { AutodartsPill } from "../components/AutodartsStatus";
import { Dartboard, type KillerSegment } from "../components/Dartboard";
import { KillerDraw } from "../components/KillerDraw";
import { CalibrateButton } from "../components/CalibrateButton";
import { CricketTable, DartPad, DartPickerModal, VisitHistory } from "../components/game";
import { Icon } from "../components/Icon";
import { Badge, Button, Card, ErrorBox, Segmented, Spinner, useUi } from "../components/ui";
import { ApiError, api, newId } from "../lib/api";
import { useAppState } from "../lib/app-state";
import { useAsync, useLocalPreference, useSocketEvent } from "../lib/hooks";
import { emitAck, getSocket } from "../lib/socket";
import { unlockAudio } from "../lib/sounds";
import type { GameCue } from "../lib/game-cues";
import type { CommandResult, MatchSnapshot, ThrownDart } from "../lib/types";
import { DEFAULT_SOUND_SETTINGS, useAudioUnlocked, useGameSounds, type SoundSettings, type VoicePackInfo } from "../lib/use-game-sounds";

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
  const [sound, setSound] = useLocalPreference<SoundSettings>("sound", DEFAULT_SOUND_SETTINGS);
  const [soundOpen, setSoundOpen] = useState(false);
  const voicePacks = useAsync(() => api.get<VoicePackInfo[]>("/api/voices").catch(() => [] as VoicePackInfo[]), []);
  const activePack = voicePacks.data?.find((p) => p.id === sound.voicePack) ?? null;
  // Saisie manuelle : en touchant la cible (grands écrans) ou avec le pavé (téléphones).
  const [manualInput, setManualInput] = useLocalPreference<"board" | "pad">("manualInput", window.innerWidth >= 1024 ? "board" : "pad");
  const [missedPad, setMissedPad] = useState(false);
  const audioUnlocked = useAudioUnlocked();
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

  // Les commandes de cet appareil sont envoyées l'une après l'autre, chacune basée sur la dernière
  // version reçue : une saisie rapide n'est jamais bloquée, et une action concurrente d'un autre
  // appareil reste détectée (conflit de version).
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const command = useCallback(
    (body: Record<string, unknown>) => {
      if (role === "spectator") return Promise.resolve();
      pendingRef.current++;
      setBusy(true);
      const run = async () => {
        try {
          const result = await api.post<CommandResult>(`/api/matches/${id}/commands`, { ...body, commandId: newId(), baseVersion: versionRef.current });
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
          pendingRef.current--;
          if (pendingRef.current === 0) setBusy(false);
        }
      };
      queueRef.current = queueRef.current.then(run);
      return queueRef.current;
    },
    [role, id, accept, load, toast],
  );

  // Bandeau d'événement (« Bob est KILLER ! », « Alice éliminée »).
  const [banner, setBanner] = useState<{ text: string; tone: "killer" | "out"; key: number } | null>(null);
  const onCue = useCallback((cue: GameCue) => {
    if (cue.kind === "killer") setBanner({ text: `💀 ${cue.playerName} est KILLER !`, tone: "killer", key: Date.now() });
    if (cue.kind === "eliminated") setBanner({ text: `${cue.playerName} est éliminé`, tone: "out", key: Date.now() });
  }, []);
  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), 2700);
    return () => window.clearTimeout(t);
  }, [banner]);
  // Roue du tirage des numéros du Killer : une fois par appareil, au début de la partie.
  const [drawSeen, setDrawSeen] = useState(() => {
    try {
      return sessionStorage.getItem(`de:killer-draw:${id}`) === "1";
    } catch {
      return false;
    }
  });
  const closeDraw = useCallback(() => {
    setDrawSeen(true);
    try {
      sessionStorage.setItem(`de:killer-draw:${id}`, "1");
    } catch {
      // Stockage indisponible : la roue ne réapparaîtra pas pendant cette visite de toute façon.
    }
  }, [id]);
  useGameSounds(snapshot, sound, activePack, onCue);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!snapshot) return <Spinner label="Chargement de la partie…" />;

  const { match, view } = snapshot;
  const finished = match.status !== "active";
  const isAutodarts = match.inputMode === "autodarts";
  const bound = autodarts?.boundMatchId === match.id;
  const current = view.current;
  const spectator = role === "spectator";
  const canInput = !finished && !spectator;
  const canCorrect = canInput || (match.status === "finished" && !spectator);
  const soundOn = sound.effects || sound.announcer !== "off";
  const panels = view.players.map((p) => ({ player: p, meta: match.players.find((m) => m.id === p.id) }));
  const left = panels.filter((_, i) => i % 2 === 0);
  const right = panels.filter((_, i) => i % 2 === 1);
  const compact = panels.length > 2;
  // Bots : la prochaine fléchette leur revient-elle ? (pendant leur visite, ou juste avant qu'ils prennent la main)
  const currentMeta = match.players.find((p) => p.id === current.playerId);
  const nextMeta = match.players.find((p) => p.id === current.nextPlayerId);
  const botPlaying = !finished && currentMeta?.botAverage != null && !current.complete;
  const receiverBot = !finished && (current.complete ? nextMeta?.botAverage != null : currentMeta?.botAverage != null);
  const botName = (current.complete ? nextMeta : currentMeta)?.name;
  const showPad = canInput && !receiverBot && ((!isAutodarts && manualInput === "pad") || (isAutodarts && missedPad));
  const boardPick = canInput && !receiverBot && !isAutodarts && manualInput === "board";
  const killerSegments: KillerSegment[] | undefined = view.killer?.players.map((k) => ({
    segment: k.number,
    color: match.players.find((p) => p.id === k.id)?.color ?? "#ff6b1a",
    fill: view.killer!.max > 0 ? k.lives / view.killer!.max : 0,
    killer: k.killer,
    eliminated: k.eliminated,
  }));
  const showDraw = !!view.killer && match.version === 0 && match.status === "active" && !drawSeen;

  const onDart = (dart: Dart) => command({ kind: "dart", dart });
  const onBoardPick = (dart: Dart, coords: BoardPoint) => command({ kind: "dart", dart, coords });
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

  const history = (
    <Card title="Historique de la partie">
      <VisitHistory visits={view.recentVisits} players={match.players} onDartClick={canCorrect ? setCorrecting : undefined} />
    </Card>
  );

  return (
    <div className="space-y-3">
      {/* En-tête de partie */}
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/" title="Retour au menu (la partie reste en cours)">
          <Button size="sm" variant="ghost" icon="back">
            Menu
          </Button>
        </Link>
        <div className="min-w-0 flex-1 basis-48">
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
        <span className="mr-auto rounded-xl border border-ink-600 bg-ink-900 px-3 py-1.5 text-sm sm:mr-0" title="Code de salle : à saisir sur un autre appareil (menu « Rejoindre une salle »)">
          Salle <span className="font-display tabular text-lg font-bold tracking-widest text-brand-400">{match.roomCode}</span>
          <span className="ml-2 hidden text-ink-400 sm:inline">· {devices.length || 1} appareil(s)</span>
        </span>
        {isAutodarts && (
          <span className="hidden lg:inline-flex">
            <AutodartsPill overview={autodarts} compact />
          </span>
        )}
        {soundOn && !audioUnlocked ? (
          <Button size="sm" variant="primary" icon="volume" onClick={unlockAudio} className="animate-pulse">
            Activer le son
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={soundOn ? "volume" : "mute"} onClick={() => setSoundOpen(true)} aria-label="Sons et annonces" title="Sons et annonces" />
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
          <p className="mt-1 text-ink-300">Résultats enregistrés — statistiques mises à jour. Une correction reste possible en touchant une fléchette.</p>
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

      {canInput && isAutodarts && (!bound || autodarts?.status.state !== "connected") && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
          <Icon name="warning" className="text-warning" />
          <span className="flex-1">
            {!bound
              ? "Cette partie n'est pas la partie liée à Autodarts : les impacts ne sont pas transmis."
              : "Autodarts n'est pas connecté : la partie est conservée. Passez en saisie manuelle ou attendez la reconnexion."}
          </span>
          {!bound && (
            <Button size="sm" icon="link" onClick={() => api.post("/api/autodarts/bind", { matchId: match.id }).then(() => toast("Partie liée à Autodarts.", "good"))}>
              Lier à Autodarts
            </Button>
          )}
        </div>
      )}

      <VisitBar view={view} players={match.players} finished={finished} isAutodarts={isAutodarts} onDartClick={canInput ? setCorrecting : undefined} />

      {/* Joueurs (téléphone et tablette) */}
      <div className={`grid gap-2 lg:hidden ${panels.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
        {panels.map(({ player, meta }) => (
          <PlayerPanel key={player.id} player={player} meta={meta} variant="mini" />
        ))}
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="hidden flex-col gap-3 lg:flex">
          {left.map(({ player, meta }) => (
            <PlayerPanel key={player.id} player={player} meta={meta} variant={compact ? "compact" : "full"} />
          ))}
        </div>

        {/* Cible et commandes */}
        <div className="mx-auto flex w-full flex-col items-center gap-3 lg:w-[min(560px,calc(100dvh-330px))] lg:min-w-[340px]">
          {canInput && !isAutodarts && (
            <Segmented
              size="sm"
              value={manualInput}
              onChange={setManualInput}
              options={[
                { value: "board", label: <span className="flex items-center gap-1.5"><Icon name="play" size={16} /> Toucher la cible</span> },
                { value: "pad", label: <span className="flex items-center gap-1.5"><Icon name="grid" size={16} /> Pavé</span> },
              ]}
            />
          )}
          {receiverBot && (
            <div className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#3987e5]/50 bg-[#3987e5]/10 px-4 py-2.5 text-[#9ec5f4]" role="status">
              <Icon name="bot" /> {botPlaying ? `${botName} joue…` : `${botName} va jouer…`}
            </div>
          )}
          {showPad && !isAutodarts ? (
            <div className="w-full space-y-3">
              {/* Killer : la cible colorée reste visible au-dessus du pavé. */}
              {killerSegments && <Dartboard darts={current.darts} killer={killerSegments} className="mx-auto aspect-square w-full max-w-[340px]" />}
              <DartPad onDart={onDart} />
            </div>
          ) : (
            <Dartboard
              darts={current.darts}
              target={finished || view.mode === "checkout_training" || view.killer ? undefined : current.target /* entraînement checkout : la cible est un score */}
              killer={killerSegments}
              onPick={boardPick ? onBoardPick : undefined}
              className="aspect-square w-full max-w-[min(100%,calc(100dvh-330px))] min-w-[260px]"
            />
          )}
          {canInput && isAutodarts && missedPad && !receiverBot && (
            <div className="w-full rounded-2xl border border-ink-700 bg-ink-850 p-3">
              <p className="mb-2 text-sm text-ink-300">Fléchette non détectée : saisissez-la ici.</p>
              <DartPad compact onDart={onDart} />
            </div>
          )}
          {canInput && (
            <div className="grid w-full grid-cols-2 gap-2">
              <Button size="lg" icon="undo" onClick={() => command({ kind: "undo" })} disabled={busy}>
                Annuler
              </Button>
              <Button size="lg" variant="primary" icon="next" onClick={() => command({ kind: "next" })} disabled={busy || botPlaying}>
                Joueur suivant
              </Button>
            </div>
          )}
          {canInput && isAutodarts && (
            <div className="flex w-full flex-wrap justify-center gap-2">
              <Button size="sm" variant={missedPad ? "primary" : "secondary"} icon="plus" onClick={() => setMissedPad(!missedPad)}>
                Fléchette manquée
              </Button>
              <Button size="sm" icon="edit" onClick={() => switchInput("manual")}>
                Saisie manuelle
              </Button>
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => api.post("/api/autodarts/reset-board").catch((e: Error) => toast(e.message, "critical"))}>
                Réinitialiser la cible
              </Button>
              <CalibrateButton />
            </div>
          )}
          {finished && !spectator && match.status === "finished" && (
            <Button icon="undo" onClick={() => command({ kind: "undo" })} disabled={busy}>
              Annuler la dernière fléchette (rouvre la partie)
            </Button>
          )}
          {canInput && (
            <div className="flex w-full flex-wrap justify-between gap-2 text-sm">
              {!isAutodarts && autodarts?.status.state === "connected" ? (
                <button className="text-ink-300 underline-offset-2 hover:underline" onClick={() => switchInput("autodarts")}>
                  Utiliser la détection Autodarts
                </button>
              ) : (
                <span />
              )}
              <button className="text-ink-400 underline-offset-2 hover:text-[#ff8f8f] hover:underline" onClick={abandon}>
                Abandonner la partie
              </button>
            </div>
          )}
        </div>

        <div className="hidden flex-col gap-3 lg:flex">
          {right.map(({ player, meta }) => (
            <PlayerPanel key={player.id} player={player} meta={meta} variant={compact ? "compact" : "full"} />
          ))}
          {right.length === 0 && history}
        </div>
      </div>

      {view.board && <CricketTable view={view} />}
      <div className={right.length === 0 ? "lg:hidden" : ""}>{history}</div>

      {banner && (
        <div className="pointer-events-none fixed inset-x-0 top-1/3 z-40 flex justify-center px-4" role="status">
          <div
            key={banner.key}
            className={`event-banner rounded-3xl px-8 py-4 text-center font-display text-4xl font-bold uppercase tracking-wider shadow-2xl sm:text-6xl ${
              banner.tone === "killer" ? "bg-critical text-white shadow-[0_0_60px_rgba(224,82,82,0.7)]" : "bg-ink-800 text-ink-100"
            }`}
          >
            {banner.text}
          </div>
        </div>
      )}
      {showDraw && view.killer && (
        <KillerDraw
          players={view.killer.players.map((k) => match.players.find((p) => p.id === k.id)!).filter(Boolean)}
          numbers={view.killer.players.map((k) => k.number)}
          voice={sound.announcer !== "off" && !activePack}
          onDone={closeDraw}
        />
      )}
      <DartPickerModal
        open={!!correcting}
        current={correcting}
        onClose={() => setCorrecting(null)}
        onPick={(dart) => correcting?.eventId && command({ kind: "correct", eventId: correcting.eventId, dart })}
      />
      <SoundSettingsModal open={soundOpen} onClose={() => setSoundOpen(false)} settings={sound} onChange={setSound} packs={voicePacks.data ?? []} />
    </div>
  );
}

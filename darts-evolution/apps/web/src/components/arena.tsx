import { endReasonLabel } from "@darts-evolution/game-engine";
import { dartDisplay } from "@darts-evolution/shared";
import type { ReactNode } from "react";
import { playHit, speak, speechAvailable, unlockAudio } from "../lib/sounds";
import type { GameView, MatchPlayer, ThrownDart } from "../lib/types";
import type { SoundSettings } from "../lib/use-game-sounds";
import { Icon } from "./Icon";
import { Button, Modal, PlayerAvatar, Segmented, Toggle } from "./ui";

type PlayerView = GameView["players"][number];

function slotTone(dart: ThrownDart): string {
  if (dart.padded || dart.multiplier === 0) return "border-ink-600 bg-ink-900 text-ink-400";
  if (dart.segment === 25) return dart.multiplier === 2 ? "border-[#e05252]/70 bg-[#e05252]/15 text-[#ffb0b0]" : "border-[#2fa75f]/70 bg-[#2fa75f]/15 text-[#8fe0ae]";
  if (dart.multiplier === 3) return "border-brand-500/80 bg-brand-500/20 text-brand-300";
  if (dart.multiplier === 2) return "border-[#3987e5]/70 bg-[#3987e5]/15 text-[#9ec5f4]";
  return "border-ink-500 bg-ink-800 text-ink-100";
}

/** Une case de la barre de visite (fléchette 1, 2 ou 3). */
function VisitSlot({ dart, index, onClick }: { dart: ThrownDart | null; index: number; onClick?: () => void }) {
  if (!dart) {
    return (
      <div className="flex min-h-16 items-center justify-center rounded-xl border border-dashed border-ink-600 sm:min-h-20" aria-label={`Fléchette ${index + 1} : pas encore lancée`}>
        <span className="font-display text-2xl font-bold text-ink-600">{index + 1}</span>
      </div>
    );
  }
  const body = (
    <>
      <span className="font-display tabular text-3xl font-bold leading-none sm:text-4xl">{dart.padded ? "–" : dartDisplay(dart)}</span>
      <span className="mt-1 flex items-center gap-1.5 text-xs">
        <span className="tabular text-ink-300">
          {dart.padded ? "non lancée" : dart.points}
          {!dart.padded && <span className="hidden sm:inline"> pt{dart.points > 1 ? "s" : ""}</span>}
        </span>
        {dart.source === "autodarts" && (
          <span className="rounded bg-ink-950/60 px-1 font-semibold text-ink-200" title="Détecté par Autodarts">
            AD
          </span>
        )}
        {dart.source === "simulation" && (
          <span className="rounded bg-ink-950/60 px-1 font-semibold text-warning" title="Impact simulé">
            SIM
          </span>
        )}
      </span>
    </>
  );
  const cls = `animate-pop flex min-h-16 flex-col items-center justify-center rounded-xl border px-1 sm:min-h-20 ${slotTone(dart)}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`press ${cls} hover:ring-2 hover:ring-ink-400`} title="Corriger cette fléchette">
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Barre de visite : joueur au tir, 3 fléchettes, total, consignes et sortie conseillée. */
export function VisitBar({
  view,
  players,
  finished,
  isAutodarts,
  onDartClick,
}: {
  view: GameView;
  players: MatchPlayer[];
  finished: boolean;
  isAutodarts: boolean;
  onDartClick?: (dart: ThrownDart) => void;
}) {
  const current = view.current;
  const player = players.find((p) => p.id === current.playerId);
  const nextPlayer = players.find((p) => p.id === current.nextPlayerId);
  const slots = [0, 1, 2].map((i) => current.darts[i] ?? null);
  const label = finished ? "Dernière visite" : current.awaitingNext ? "Visite terminée" : "Au tour de";
  let status: ReactNode = null;
  if (current.complete && current.endReason) {
    status = (
      <span className={`font-semibold ${current.endReason === "bust" ? "text-[#ff8f8f]" : "text-brand-300"}`}>
        {endReasonLabel(current.endReason)}
        {current.awaitingNext && nextPlayer && (
          <span className="font-normal text-ink-300">
            {" — "}
            {isAutodarts ? "retirez les fléchettes pour passer à " : "au tour de "}
            <strong className="text-ink-100">{nextPlayer.name}</strong>
          </span>
        )}
      </span>
    );
  } else if (current.instruction && !finished) {
    status = <span className="text-ink-200">{current.instruction}</span>;
  }
  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850 p-3 sm:p-4" aria-label="Visite en cours">
      <div className="flex items-stretch gap-2 sm:gap-3">
        <div className="hidden w-44 min-w-0 flex-col justify-center md:flex">
          <span className="text-xs uppercase tracking-wider text-ink-400">{label}</span>
          <span className="flex min-w-0 items-center gap-2">
            {player && <PlayerAvatar avatar={player.avatar} color={player.color} size={30} />}
            <span className="truncate font-display text-2xl font-bold">{player?.name}</span>
          </span>
        </div>
        <div className="grid flex-1 grid-cols-3 gap-2">
          {slots.map((d, i) => (
            <VisitSlot key={d?.eventId ?? `${i}-${d?.label ?? "vide"}`} dart={d} index={i} onClick={d && !d.padded && onDartClick ? () => onDartClick(d) : undefined} />
          ))}
        </div>
        <div className="flex w-20 flex-col items-center justify-center rounded-xl bg-brand-500 px-2 text-ink-950 sm:w-28">
          <span className="text-[11px] font-semibold uppercase tracking-wider opacity-80">Visite</span>
          <span className="font-display tabular text-4xl font-bold leading-none sm:text-5xl">{current.visitPoints}</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="font-semibold md:hidden">
          {label} : {player?.name}
        </span>
        {status}
        {view.checkout && !finished && <CheckoutRoutes checkout={view.checkout} />}
      </div>
    </section>
  );
}

function CheckoutRoutes({ checkout }: { checkout: NonNullable<GameView["checkout"]> }) {
  if (checkout.routes.length === 0) return <span className="ml-auto text-ink-400">Pas de sortie possible ({checkout.remaining})</span>;
  const [best, ...others] = checkout.routes;
  return (
    <span className="ml-auto flex flex-wrap items-center gap-1.5" title={others.map((r) => r.join(" · ")).join("\n")}>
      <span className="text-xs uppercase tracking-wider text-ink-400">Sortie {checkout.remaining}</span>
      {best!.map((label, i) => (
        <span key={i} className="font-display rounded-lg bg-ink-100 px-2 py-0.5 text-lg font-bold text-ink-950">
          {label}
        </span>
      ))}
      {others[0] && <span className="hidden text-xs text-ink-400 lg:inline">ou {others[0].join(" · ")}</span>}
    </span>
  );
}

/** Panneau d'un joueur : score principal géant, moyennes et compteurs. `mini` : bandeau pour téléphone. */
export function PlayerPanel({ player, meta, variant = "full" }: { player: PlayerView & { active: boolean }; meta?: MatchPlayer; variant?: "full" | "compact" | "mini" }) {
  const activeCls = player.active ? "glow-active turn-flash border-brand-500 bg-ink-800" : "border-ink-700 bg-ink-850";
  const badges = (
    <>
      {player.winner && (
        <span className="flex items-center gap-1 rounded-full bg-brand-500 px-2 py-0.5 text-xs font-bold text-ink-950">
          <Icon name="trophy" size={13} /> Vainqueur
        </span>
      )}
      {player.active && !player.winner && <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-brand-500" title="Au tour de ce joueur" />}
      {player.eliminated && <span className="rounded-full bg-ink-700 px-2 py-0.5 text-xs text-ink-300">Éliminé</span>}
    </>
  );
  if (variant === "mini") {
    return (
      <article
        key={`${player.id}-${player.active}`}
        className={`rounded-2xl border px-3 py-2 ${activeCls} ${player.eliminated ? "opacity-50" : ""}`}
        aria-current={player.active ? "true" : undefined}
      >
        <header className="flex items-center gap-2">
          {meta && <PlayerAvatar avatar={meta.avatar} color={meta.color} size={24} />}
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{player.name}</h3>
          {badges}
        </header>
        <div className="flex items-end justify-between gap-2">
          <span className={`font-display tabular text-4xl font-bold leading-tight ${player.active ? "text-ink-100" : "text-ink-300"}`} aria-label={`${player.mainLabel} : ${player.main}`}>
            {player.main}
          </span>
          <span className="min-w-0 pb-1 text-right text-xs leading-tight text-ink-400">
            {player.details.slice(0, 2).map((d) => (
              <span key={d.label} className="block truncate">
                {d.label} <span className="tabular font-semibold text-ink-200">{d.value}</span>
              </span>
            ))}
          </span>
        </div>
      </article>
    );
  }
  const compact = variant === "compact";
  const details = compact ? player.details.slice(0, 3) : player.details;
  return (
    <article
      key={`${player.id}-${player.active}`}
      className={`relative rounded-2xl border p-3 transition sm:p-4 ${activeCls} ${player.eliminated ? "opacity-50" : ""}`}
      aria-current={player.active ? "true" : undefined}
    >
      <header className="flex items-center gap-2">
        {meta && <PlayerAvatar avatar={meta.avatar} color={meta.color} size={compact ? 28 : 36} />}
        <h3 className={`min-w-0 flex-1 truncate font-semibold ${compact ? "text-base" : "text-lg"} ${player.active ? "text-ink-100" : "text-ink-200"}`}>{player.name}</h3>
        {badges}
      </header>
      <div
        className={`font-display tabular mt-1 font-bold leading-none ${compact ? "text-5xl" : "text-7xl xl:text-8xl"} ${player.active ? "text-ink-100" : "text-ink-300"}`}
        aria-label={`${player.mainLabel} : ${player.main}`}
      >
        {player.main}
      </div>
      <div className="text-xs uppercase tracking-wider text-ink-400">{player.mainLabel}</div>
      {details.length > 0 && (
        <dl className="mt-2 grid gap-y-1 text-sm">
          {details.map((d) => (
            <div key={d.label} className="flex min-w-0 justify-between gap-2 border-t border-ink-700/70 pt-1">
              <dt className="truncate text-ink-400">{d.label}</dt>
              <dd className="tabular font-semibold text-ink-100">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}

/** Réglages des sons (propres à chaque appareil). */
export function SoundSettingsModal({ open, onClose, settings, onChange }: { open: boolean; onClose: () => void; settings: SoundSettings; onChange: (s: SoundSettings) => void }) {
  const test = () => {
    unlockAudio();
    window.setTimeout(() => {
      if (settings.effects) playHit("triple");
      if (settings.announcer !== "off") speak("Cent quatre-vingts !", { rate: 0.85, pitch: 1.15 });
    }, 80);
  };
  return (
    <Modal open={open} onClose={onClose} title="Sons et annonces">
      <div className="space-y-4">
        <Toggle checked={settings.effects} onChange={(effects) => onChange({ ...settings, effects })} label="Effets sonores (impacts, bust, sortie, joueur suivant)" />
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-ink-300">
            <Icon name="voice" size={16} /> Annonceur vocal
          </div>
          <Segmented
            size="sm"
            value={settings.announcer}
            onChange={(announcer) => onChange({ ...settings, announcer })}
            options={[
              { value: "off", label: "Muet" },
              { value: "scores", label: "Scores et joueurs" },
              { value: "darts", label: "Chaque fléchette" },
            ]}
          />
          {!speechAvailable() && <p className="mt-2 text-sm text-warning">La synthèse vocale n'est pas disponible dans ce navigateur.</p>}
        </div>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Volume : {Math.round(settings.volume * 100)} %</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(e) => onChange({ ...settings, volume: Number(e.target.value) })}
            className="w-full accent-[var(--color-brand-500)]"
          />
        </label>
        <p className="text-sm text-ink-400">
          Les sons sont produits par l'appareil lui-même, sans connexion Internet. L'annonceur utilise la voix française de l'appareil si elle est installée. Réglage
          propre à cet appareil : sur une tablette spectateur, activez-le une fois en touchant l'écran.
        </p>
        <Button icon="volume" onClick={test}>
          Tester le son
        </Button>
      </div>
    </Modal>
  );
}

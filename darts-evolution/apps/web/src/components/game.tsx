import { dartDisplay, parseDart, type Dart } from "@darts-evolution/shared";
import { useState, type FormEvent } from "react";
import type { GameView, MatchPlayer, ThrownDart, VisitRecord } from "../lib/types";
import { Button, Modal } from "./ui";

type Mult = 1 | 2 | 3;

/** Pavé de saisie manuelle : multiplicateur puis secteur (grandes touches). */
export function DartPad({ onDart, disabled, compact = false }: { onDart: (dart: Dart) => void; disabled?: boolean; compact?: boolean }) {
  const [mult, setMult] = useState<Mult>(1);
  const [quick, setQuick] = useState("");
  const [quickError, setQuickError] = useState(false);
  const send = (dart: Dart) => {
    onDart(dart);
    setMult(1);
  };
  const submitQuick = (e: FormEvent) => {
    e.preventDefault();
    const dart = parseDart(quick);
    if (!dart) {
      setQuickError(true);
      return;
    }
    setQuickError(false);
    setQuick("");
    onDart(dart);
  };
  const multLabel = { 1: "Simple", 2: "Double", 3: "Triple" } as const;
  const keyClass = `press touch rounded-xl border font-display tabular font-bold ${compact ? "text-xl" : "text-2xl"} disabled:opacity-40`;
  return (
    <div className="space-y-2" aria-label="Saisie manuelle des fléchettes">
      <div className="grid grid-cols-3 gap-2">
        {([1, 2, 3] as Mult[]).map((m) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => setMult(mult === m ? 1 : m)}
            aria-pressed={mult === m}
            className={`${keyClass} min-h-12 text-lg ${
              mult === m
                ? m === 1
                  ? "border-ink-300 bg-ink-600 text-ink-100"
                  : "border-brand-500 bg-brand-500 text-ink-950"
                : "border-ink-600 bg-ink-800 text-ink-200"
            }`}
          >
            {multLabel[m]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => send({ segment: n, multiplier: mult })}
            className={`${keyClass} ${compact ? "min-h-12" : "min-h-14"} border-ink-700 bg-ink-850 text-ink-100 hover:border-ink-500`}
            aria-label={`${multLabel[mult]} ${n}`}
          >
            {mult === 1 ? n : `${mult === 2 ? "D" : "T"}${n}`}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" disabled={disabled} onClick={() => send({ segment: 25, multiplier: 1 })} className={`${keyClass} min-h-14 border-ink-700 bg-ink-850 text-[#6fdc6f]`}>
          25
        </button>
        <button type="button" disabled={disabled} onClick={() => send({ segment: 25, multiplier: 2 })} className={`${keyClass} min-h-14 border-ink-700 bg-ink-850 text-[#ff8f8f]`}>
          Bull
        </button>
        <button type="button" disabled={disabled} onClick={() => send({ segment: 0, multiplier: 0 })} className={`${keyClass} min-h-14 border-ink-700 bg-ink-850 text-ink-300`}>
          Raté
        </button>
      </div>
      {!compact && (
        <form onSubmit={submitQuick} className="hidden gap-2 md:flex">
          <input
            value={quick}
            onChange={(e) => {
              setQuick(e.target.value);
              setQuickError(false);
            }}
            placeholder="Saisie rapide : T20, D16, 25, BULL, M…"
            aria-label="Saisie rapide au clavier"
            className={`flex-1 rounded-xl border bg-ink-900 px-3 py-2 text-sm ${quickError ? "border-critical" : "border-ink-600"}`}
            disabled={disabled}
          />
          <Button size="sm" type="submit" disabled={disabled}>
            Valider
          </Button>
        </form>
      )}
    </div>
  );
}

export function DartChip({ dart, onClick, size = "md" }: { dart?: ThrownDart | null; onClick?: () => void; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-9 min-w-12 text-base", md: "h-12 min-w-16 text-xl", lg: "h-16 min-w-20 text-3xl" };
  if (!dart) {
    return <span className={`inline-flex items-center justify-center rounded-xl border border-dashed border-ink-600 text-ink-500 ${sizes[size]}`}>–</span>;
  }
  const tone =
    dart.multiplier === 3
      ? "border-brand-500/60 bg-brand-500/15 text-brand-300"
      : dart.multiplier === 2
        ? "border-[#3987e5]/60 bg-[#3987e5]/15 text-[#9ec5f4]"
        : dart.multiplier === 0
          ? "border-ink-600 bg-ink-800 text-ink-400"
          : "border-ink-500 bg-ink-800 text-ink-100";
  const content = (
    <>
      <span className="font-display font-bold">{dart.padded ? "–" : dartDisplay(dart)}</span>
      {dart.source === "autodarts" && <span className="ml-1 text-[10px] font-semibold uppercase text-ink-300" title="Détecté par Autodarts">AD</span>}
      {dart.source === "simulation" && <span className="ml-1 text-[10px] font-semibold uppercase text-warning" title="Impact simulé">SIM</span>}
      {dart.source === "bot" && <span className="ml-1 text-[10px] font-semibold uppercase text-[#9ec5f4]" title="Fléchette du bot">BOT</span>}
    </>
  );
  const cls = `inline-flex items-center justify-center rounded-xl border px-2 tabular ${sizes[size]} ${tone}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`press ${cls} hover:ring-2 hover:ring-ink-400`} title={dart.padded ? "Fléchette manquante comptée ratée" : "Corriger cette fléchette"}>
      {content}
    </button>
  ) : (
    <span className={cls}>{content}</span>
  );
}

/** Tableau des marques du Cricket. */
export function CricketTable({ view }: { view: GameView }) {
  if (!view.board) return null;
  return (
    <div className="overflow-x-auto rounded-2xl border border-ink-700 bg-ink-850">
      <table className="w-full text-center">
        <thead>
          <tr className="text-sm text-ink-300">
            <th className="px-2 py-2 text-left">Numéro</th>
            {view.board.columns.map((c) => (
              <th key={c} className="px-2 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.board.rows.map((r) => (
            <tr key={r.key} className={`border-t border-ink-800 ${r.closedByAll ? "opacity-40" : ""}`}>
              <th className="font-display px-3 py-1.5 text-left text-2xl font-bold">{r.label}</th>
              {r.cells.map((c, i) => (
                <td key={i} className={`font-display text-2xl font-bold ${c === "Ⓧ" ? "text-brand-500" : "text-ink-100"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Historique partagé des dernières visites (fléchettes cliquables pour correction). */
export function VisitHistory({ visits, players, onDartClick }: { visits: VisitRecord[]; players: MatchPlayer[]; onDartClick?: (dart: ThrownDart) => void }) {
  if (visits.length === 0) return <p className="text-sm text-ink-400">Aucune visite pour l'instant.</p>;
  return (
    <ol className="space-y-1.5">
      {[...visits].reverse().map((v) => {
        const player = players.find((p) => p.id === v.playerId);
        return (
          <li key={v.index} className="flex flex-wrap items-center gap-2 rounded-xl bg-ink-900 px-3 py-2">
            <span className="w-24 truncate text-sm text-ink-300">{player?.name ?? "?"}</span>
            <span className="flex gap-1">
              {v.darts.map((d, i) => (
                <DartChip key={i} dart={d} size="sm" onClick={onDartClick ? () => onDartClick(d) : undefined} />
              ))}
            </span>
            <span className="ml-auto font-display tabular text-lg font-bold">
              {v.bust ? <span className="text-[#ff8f8f]">Bust</span> : v.points}
              {v.checkout && <span className="ml-2 text-sm text-brand-400">checkout</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Choix d'une fléchette (correction). */
export function DartPickerModal({ open, current, onClose, onPick }: { open: boolean; current?: ThrownDart | null; onClose: () => void; onPick: (dart: Dart) => void }) {
  return (
    <Modal open={open} onClose={onClose} title={current ? `Corriger ${current.padded ? "la fléchette manquante" : dartDisplay(current)}` : "Corriger"}>
      {current?.padded ? (
        <p className="text-ink-300">
          Cette fléchette a été comptée ratée automatiquement à la fin de la visite. Pour la remplacer, utilisez « Annuler » afin de revenir avant la fin de la
          visite, puis saisissez la fléchette réelle.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-300">Choisissez la valeur correcte : la partie et les statistiques sont recalculées.</p>
          <DartPad
            compact
            onDart={(d) => {
              onPick(d);
              onClose();
            }}
          />
        </>
      )}
    </Modal>
  );
}

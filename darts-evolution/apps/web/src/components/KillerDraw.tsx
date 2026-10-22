import { BOARD_ORDER, segmentAngle } from "@darts-evolution/shared";
import { useEffect, useRef, useState } from "react";
import { announce, playTick, playTurnChange } from "../lib/sounds";
import type { MatchPlayer } from "../lib/types";
import { Button, PlayerAvatar } from "./ui";

const SPIN_MS = 2600;
const PAUSE_MS = 900;

/** Délai de la roue pour tous les joueurs (le serveur fait patienter les bots d'autant). */
export function killerDrawDuration(players: number): number {
  return players * (SPIN_MS + PAUSE_MS);
}

function sector(r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => {
    const rad = (a * Math.PI) / 180;
    return `${r * Math.sin(rad)} ${-r * Math.cos(rad)}`;
  };
  return `M${p(r1, a0)}A${r1} ${r1} 0 0 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
}

/**
 * Tirage des numéros du Killer : une roue tourne pour chaque joueur et s'arrête sur son numéro
 * (tiré par le serveur à la création de la partie : la roue ne fait que le révéler).
 */
export function KillerDraw({ players, numbers, onDone, voice }: { players: MatchPlayer[]; numbers: number[]; onDone: () => void; voice: boolean }) {
  const [step, setStep] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [landed, setLanded] = useState<number[]>([]);
  const timers = useRef<number[]>([]);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const done = step >= players.length;

  useEffect(() => {
    if (done) {
      const t = window.setTimeout(onDone, 1600);
      return () => window.clearTimeout(t);
    }
    const target = numbers[step]!;
    // La roue tourne de plusieurs tours puis place le numéro sous le repère (en haut).
    setRotation((current) => {
      const base = Math.ceil(current / 360) * 360 + 360 * 4;
      return base - segmentAngle(target);
    });
    // Tic-tac de plus en plus lent pendant la rotation.
    const ticks: number[] = [];
    if (!reduced) {
      let t = 0;
      let gap = 40;
      while (t < SPIN_MS - 150) {
        ticks.push(window.setTimeout(playTick, t));
        t += gap;
        gap *= 1.09;
      }
    }
    const land = window.setTimeout(
      () => {
        playTurnChange();
        setLanded((l) => [...l, step]);
        if (voice) announce({ text: `${players[step]!.name} : le ${target}` });
      },
      reduced ? 50 : SPIN_MS,
    );
    const next = window.setTimeout(() => setStep((s) => s + 1), (reduced ? 50 : SPIN_MS) + PAUSE_MS);
    timers.current = [...ticks, land, next];
    return () => timers.current.forEach((id) => window.clearTimeout(id));
  }, [step, done]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = players[Math.min(step, players.length - 1)]!;
  const owner = (n: number) => {
    const i = numbers.indexOf(n);
    return i >= 0 && landed.includes(i) ? players[i] : undefined;
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/85 p-4 backdrop-blur-sm" role="dialog" aria-label="Tirage des numéros du Killer">
      <h2 className="font-display text-3xl font-bold uppercase tracking-wide text-ink-100 sm:text-5xl">Tirage des numéros</h2>
      <div className="relative aspect-square w-[min(80vw,58vh)]">
        {/* Repère */}
        <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1 border-x-[14px] border-t-[26px] border-x-transparent border-t-brand-500 drop-shadow" />
        <svg viewBox="-1.05 -1.05 2.1 2.1" className="h-full w-full">
          <g
            style={{
              transform: `rotate(${rotation}deg)`,
              transformOrigin: "0 0",
              transition: reduced ? "none" : `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.65, 0.12, 1)`,
            }}
          >
            {BOARD_ORDER.map((n, i) => {
              const a = i * 18;
              const p = owner(n);
              return (
                <g key={n}>
                  <path d={sector(0.18, 1, a - 9, a + 9)} fill={p ? p.color : i % 2 ? "#3d3d45" : "#18181b"} stroke="#0b0b0c" strokeWidth={0.008} />
                  <text
                    x={0.82 * Math.sin((a * Math.PI) / 180)}
                    y={-0.82 * Math.cos((a * Math.PI) / 180)}
                    fill={p ? "#0b0b0c" : "#e4e4e7"}
                    fontSize={0.13}
                    fontWeight={800}
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={`rotate(${a} ${0.82 * Math.sin((a * Math.PI) / 180)} ${-0.82 * Math.cos((a * Math.PI) / 180)})`}
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {n}
                  </text>
                </g>
              );
            })}
            <circle r={0.18} fill="#0b0b0c" stroke="#ff6b1a" strokeWidth={0.02} />
          </g>
        </svg>
      </div>
      <div className="flex min-h-16 items-center gap-3">
        {!done ? (
          <>
            <PlayerAvatar avatar={current.avatar} color={current.color} size={44} />
            <span className="font-display text-3xl font-bold sm:text-4xl">{current.name}</span>
            {landed.includes(step) && <span className="font-display animate-pop text-5xl font-bold text-brand-400">{numbers[step]}</span>}
          </>
        ) : (
          <span className="font-display animate-pop text-4xl font-bold uppercase text-brand-400">C'est parti !</span>
        )}
      </div>
      <ul className="flex flex-wrap justify-center gap-2">
        {players.map((p, i) => (
          <li key={p.id} className="flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900 py-1 pl-1 pr-3">
            <PlayerAvatar avatar={p.avatar} color={p.color} size={26} />
            <span className="text-sm">{p.name}</span>
            <span className="font-display min-w-6 text-center text-lg font-bold" style={{ color: landed.includes(i) ? p.color : "#52525b" }}>
              {landed.includes(i) ? numbers[i] : "?"}
            </span>
          </li>
        ))}
      </ul>
      <Button variant="ghost" onClick={onDone}>
        {done ? "Fermer" : "Passer"}
      </Button>
    </div>
  );
}

import { BOARD_RADII, segmentAngle } from "@darts-evolution/shared";
import { useMemo, useState } from "react";
import { api, qs } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { TrendChart } from "./charts";
import { BOARD_EDGE, BoardBackdrop } from "./Dartboard";
import { Icon } from "./Icon";
import { Card, EmptyState, ErrorBox, Segmented, Spinner, StatTile } from "./ui";

/** Rayon du bord extérieur du double en millimètres (cible réglementaire). */
const BOARD_MM = 170;
const HEAT = "#ff7a1a";

interface TargetStats {
  target: string;
  kind: "triple" | "double" | "bull" | "single";
  count: number;
  hits: number;
  hitRate: number;
  meanError: number;
  r50: number;
  biasX: number;
  biasY: number;
  radial: number;
  misses?: { outside: number; inside: number; side: number };
  points: { dx: number; dy: number; hit: boolean }[];
}

interface PrecisionData {
  impacts: number;
  ignored: number;
  matches: number;
  heat: { x: number; y: number }[];
  targets: TargetStats[];
  scoring: TargetStats | null;
  doubles: TargetStats | null;
  trend: { week: string; scoringCount: number; scoringError: number | null; doubleCount: number; doubleRate: number | null }[];
  tips: string[];
}

const pct = (v: number) => `${Math.round(v * 100)} %`;
const mm = (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} mm`;

/** Décalage moyen en mots (repère de la cible affichée, ou repère « extérieur / sens horaire »). */
function biasText(s: TargetStats, frame: "screen" | "target"): string {
  const words = frame === "screen" ? { left: "à gauche", right: "à droite", up: "vers le haut", down: "vers le bas" } : { left: "sens anti-horaire", right: "sens horaire", up: "vers l'extérieur", down: "vers le centre" };
  const parts: string[] = [];
  if (Math.abs(s.biasX) >= 1) parts.push(`${mm(Math.abs(s.biasX))} ${s.biasX < 0 ? words.left : words.right}`);
  if (Math.abs(s.biasY) >= 1) parts.push(`${mm(Math.abs(s.biasY))} ${s.biasY > 0 ? words.up : words.down}`);
  return parts.length ? parts.join(", ") : "centré";
}

// ---------- Carte de chaleur ----------

const GRID = 72;
const SPAN = 1.22;

/** Densité lissée des impacts sur une grille couvrant la cible. */
function density(points: { x: number; y: number }[]): { cells: { i: number; j: number; v: number }[]; max: number } {
  const grid = new Float32Array(GRID * GRID);
  const cell = (2 * SPAN) / GRID;
  const sigma = 1.3;
  const reach = 3;
  for (const p of points) {
    const ci = Math.floor((p.x + SPAN) / cell);
    const cj = Math.floor((SPAN - p.y) / cell);
    for (let di = -reach; di <= reach; di++) {
      for (let dj = -reach; dj <= reach; dj++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
        grid[j * GRID + i]! += Math.exp(-(di * di + dj * dj) / (2 * sigma * sigma));
      }
    }
  }
  let max = 0;
  const cells: { i: number; j: number; v: number }[] = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const v = grid[j * GRID + i]!;
      if (v > 0.02) {
        cells.push({ i, j, v });
        if (v > max) max = v;
      }
    }
  }
  return { cells, max };
}

function BoardHeatmap({ points, mode }: { points: { x: number; y: number }[]; mode: "chaleur" | "points" }) {
  const heat = useMemo(() => density(points), [points]);
  const cell = (2 * SPAN) / GRID;
  return (
    <svg viewBox={`${-BOARD_EDGE} ${-BOARD_EDGE} ${BOARD_EDGE * 2} ${BOARD_EDGE * 2}`} className="mx-auto block aspect-square w-full max-w-[520px]" role="img" aria-label={`Carte des impacts : ${points.length} fléchettes`}>
      <g opacity={0.5}>
        <BoardBackdrop />
      </g>
      <defs>
        <filter id="heat-blur" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="0.018" />
        </filter>
      </defs>
      {mode === "chaleur" ? (
        <g filter="url(#heat-blur)">
          {heat.cells.map((c) => (
            <rect
              key={`${c.i}-${c.j}`}
              x={-SPAN + c.i * cell}
              y={-SPAN + c.j * cell}
              width={cell + 0.002}
              height={cell + 0.002}
              fill={c.v / heat.max > 0.75 ? "#ffd2ad" : HEAT}
              opacity={0.1 + 0.85 * Math.pow(c.v / heat.max, 0.65)}
            />
          ))}
        </g>
      ) : (
        <g>
          {points.map((p, k) => (
            <circle key={k} cx={p.x} cy={-p.y} r={0.011} fill="#ffffff" opacity={0.55} />
          ))}
        </g>
      )}
    </svg>
  );
}

// ---------- Groupement autour de la case visée ----------

/** Contour de la case visée dans le repère du groupement (mm, centré sur le point visé, y vers le bas). */
function bedOutline(target: string, kind: TargetStats["kind"], frame: "screen" | "target"): { d: string } | { r: number } | null {
  if (kind === "bull") return { r: (target === "Bull" ? BOARD_RADII.bull : BOARD_RADII.outerBull) * BOARD_MM };
  const ring = kind === "triple" ? [BOARD_RADII.tripleInner, BOARD_RADII.tripleOuter] : kind === "double" ? [BOARD_RADII.doubleInner, BOARD_RADII.doubleOuter] : [BOARD_RADII.tripleOuter, BOARD_RADII.doubleInner];
  // Repère « cible » : la case est vue comme si elle était en haut (orientation du 20).
  const segment = frame === "target" ? 20 : Number(/\d+/.exec(target)?.[0] ?? 20);
  const center = segmentAngle(segment);
  const mid = (ring[0]! + ring[1]!) / 2;
  const aim = { x: Math.sin((center * Math.PI) / 180) * mid, y: Math.cos((center * Math.PI) / 180) * mid };
  const pts: string[] = [];
  const arc = (r: number, from: number, to: number) => {
    for (let k = 0; k <= 12; k++) {
      const a = ((from + ((to - from) * k) / 12) * Math.PI) / 180;
      pts.push(`${((Math.sin(a) * r - aim.x) * BOARD_MM).toFixed(2)} ${(-(Math.cos(a) * r - aim.y) * BOARD_MM).toFixed(2)}`);
    }
  };
  arc(ring[1]!, center - 9, center + 9);
  arc(ring[0]!, center + 9, center - 9);
  return { d: `M${pts.join("L")}Z` };
}

function GroupingChart({ stats, frame }: { stats: TargetStats; frame: "screen" | "target" }) {
  const dists = stats.points.map((p) => Math.hypot(p.dx, p.dy)).sort((a, b) => a - b);
  const p90 = dists[Math.floor(dists.length * 0.9)] ?? 20;
  const extent = Math.min(90, Math.max(30, Math.ceil((p90 + 6) / 10) * 10));
  const outline = bedOutline(stats.target, stats.kind, frame);
  const rings = [10, 20, 30, 40, 50, 60, 70, 80, 90].filter((r) => r <= extent);
  const axis = frame === "target" ? { up: "extérieur", down: "centre", left: "anti-horaire", right: "horaire" } : { up: "haut", down: "bas", left: "gauche", right: "droite" };
  return (
    <svg viewBox={`${-extent - 4} ${-extent - 4} ${2 * extent + 8} ${2 * extent + 8}`} className="mx-auto block aspect-square w-full max-w-[420px]" role="img" aria-label={`Groupement sur ${stats.target} : ${stats.count} fléchettes`}>
      <rect x={-extent - 4} y={-extent - 4} width={2 * extent + 8} height={2 * extent + 8} fill="#0f0f11" rx={6} />
      {rings.map((r) => (
        <g key={r}>
          <circle r={r} fill="none" stroke="#2c2c32" strokeWidth={0.4} />
          <text x={r * 0.71 + 1} y={-r * 0.71 - 1} fontSize={3} fill="#52525b">
            {r} mm
          </text>
        </g>
      ))}
      <line x1={-extent} x2={extent} y1={0} y2={0} stroke="#2c2c32" strokeWidth={0.4} />
      <line y1={-extent} y2={extent} x1={0} x2={0} stroke="#2c2c32" strokeWidth={0.4} />
      {outline && ("r" in outline ? <circle r={outline.r} fill="#c8352d" fillOpacity={0.25} stroke="#e4e4e7" strokeWidth={0.5} /> : <path d={outline.d} fill="#c8352d" fillOpacity={0.25} stroke="#e4e4e7" strokeWidth={0.5} />)}
      {stats.points.map((p, k) =>
        p.hit ? (
          <circle key={k} cx={p.dx} cy={-p.dy} r={1.3} fill={HEAT} fillOpacity={0.8} />
        ) : (
          <circle key={k} cx={p.dx} cy={-p.dy} r={1.2} fill="none" stroke="#d4d4d8" strokeOpacity={0.7} strokeWidth={0.5} />
        ),
      )}
      {/* Point moyen d'impact et rayon contenant la moitié des fléchettes */}
      <circle cx={stats.biasX} cy={-stats.biasY} r={Math.max(stats.r50, 0.5)} fill="none" stroke="#ffffff" strokeWidth={0.6} strokeDasharray="2 1.5" />
      <path d={`M${stats.biasX - 2.5} ${-stats.biasY}h5M${stats.biasX} ${-stats.biasY - 2.5}v5`} stroke="#ffffff" strokeWidth={0.9} />
      <text x={0} y={-extent - 0.5} fontSize={3.4} fill="#a1a1aa" textAnchor="middle">
        ↑ {axis.up}
      </text>
      <text x={0} y={extent + 3} fontSize={3.4} fill="#a1a1aa" textAnchor="middle">
        ↓ {axis.down}
      </text>
      <text x={-extent} y={extent + 3} fontSize={3.4} fill="#a1a1aa">
        ← {axis.left}
      </text>
      <text x={extent} y={extent + 3} fontSize={3.4} fill="#a1a1aa" textAnchor="end">
        {axis.right} →
      </text>
    </svg>
  );
}

function MissBreakdown({ misses }: { misses: NonNullable<TargetStats["misses"]> }) {
  const total = misses.outside + misses.inside + misses.side;
  if (!total) return null;
  const rows = [
    { label: "Dehors (perdue)", value: misses.outside },
    { label: "Dedans (simple)", value: misses.inside },
    { label: "À côté", value: misses.side },
  ];
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <p className="text-ink-400">Doubles ratés ({total})</p>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="w-32 shrink-0 text-ink-300">{r.label}</span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-ink-800">
            <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(r.value / total) * 100}%` }} />
          </span>
          <span className="w-12 text-right tabular text-ink-100">{pct(r.value / total)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Panneau ----------

export function PrecisionPanel({ filter }: { filter: Record<string, string | undefined> }) {
  const key = JSON.stringify(filter);
  const data = useAsync(() => api.get<PrecisionData>(`/api/stats/precision${qs(filter)}`), [key]);
  const [mode, setMode] = useState<"chaleur" | "points">("chaleur");
  const [selected, setSelected] = useState<string>("scoring");
  if (data.error) return <ErrorBox message={data.error} onRetry={data.reload} />;
  if (!data.data) return <Spinner label="Analyse des impacts…" />;
  const d = data.data;
  const ignoredShare = d.ignored / Math.max(1, d.impacts + d.ignored);

  if (d.impacts === 0) {
    return (
      <EmptyState title="Pas encore d'impacts à analyser">
        La carte de précision utilise les positions mesurées par Autodarts : X01 (scoring au T20 / T19 et doubles de sortie), entraînements doubles, triples,
        bull, Bob's 27 et tour de l'horloge. Jouez quelques parties avec Autodarts sur cette période.
        {d.ignored > 0 && ` (${d.ignored} position(s) reçue(s) ne correspondaient pas à la case comptée et ont été écartées.)`}
      </EmptyState>
    );
  }

  const options: { value: string; label: string; stats: TargetStats; frame: "screen" | "target" }[] = [
    ...(d.scoring ? [{ value: "scoring", label: `Scoring (${d.scoring.count})`, stats: d.scoring, frame: "target" as const }] : []),
    ...(d.doubles ? [{ value: "doubles", label: `Tous les doubles (${d.doubles.count})`, stats: d.doubles, frame: "target" as const }] : []),
    ...d.targets.filter((t) => t.count >= 3).map((t) => ({ value: t.target, label: `${t.target} (${t.count})`, stats: t, frame: "screen" as const })),
  ];
  const current = options.find((o) => o.value === selected) ?? options[0]!;
  const doubleTargets = d.targets.filter((t) => t.kind === "double");
  const t20 = d.targets.find((t) => t.target === "T20");

  return (
    <div className="space-y-4">
      {ignoredShare > 0.2 && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <Icon name="warning" className="mt-0.5 shrink-0 text-warning" />
          {d.ignored} position(s) ({pct(ignoredShare)}) ne correspondent pas à la case comptée et sont écartées : fléchettes corrigées à la main, ou repère des
          coordonnées Autodarts différent de celui attendu. La carte n'utilise que les positions cohérentes.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Fléchettes analysées" value={d.impacts.toLocaleString("fr-FR")} hint={`${d.matches} partie(s) avec Autodarts`} />
        <StatTile label="Écart moyen au scoring" value={d.scoring ? mm(d.scoring.meanError) : "—"} hint="distance moyenne au centre du T20 / T19" accent />
        <StatTile label="Groupement au T20" value={t20 ? mm(t20.r50) : "—"} hint="la moitié des fléchettes dans ce rayon" />
        <StatTile label="Doubles touchés" value={d.doubles ? pct(d.doubles.hitRate) : "—"} hint={d.doubles ? `${d.doubles.hits} sur ${d.doubles.count} visés` : "aucun double visé"} />
      </div>

      {d.tips.length > 0 && (
        <Card title="Constats">
          <ul className="space-y-2 text-sm">
            {d.tips.map((t, i) => (
              <li key={i} className="flex gap-2">
                <Icon name="info" size={16} className="mt-0.5 shrink-0 text-brand-400" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Carte des impacts"
          action={
            <Segmented
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: "chaleur", label: "Chaleur" },
                { value: "points", label: "Points" },
              ]}
            />
          }
        >
          <BoardHeatmap points={d.heat} mode={mode} />
          <div className="mt-2 flex items-center justify-center gap-2 text-xs text-ink-400">
            <span>moins dense</span>
            <span className="h-2 w-28 rounded-full" style={{ background: `linear-gradient(90deg, rgba(255,122,26,0.12), ${HEAT}, #ffd2ad)` }} />
            <span>plus dense</span>
          </div>
        </Card>

        <Card title="Groupement autour de la case visée">
          <div className="mb-3 flex flex-wrap gap-1.5">
            <Segmented size="sm" value={current.value} onChange={setSelected} options={options.map((o) => ({ value: o.value, label: o.label }))} />
          </div>
          <GroupingChart stats={current.stats} frame={current.frame} />
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <p className="text-ink-400">Dans la case</p>
              <p className="font-display text-xl font-bold">{pct(current.stats.hitRate)}</p>
            </div>
            <div>
              <p className="text-ink-400">Écart moyen</p>
              <p className="font-display text-xl font-bold">{mm(current.stats.meanError)}</p>
            </div>
            <div>
              <p className="text-ink-400">Groupement</p>
              <p className="font-display text-xl font-bold">{mm(current.stats.r50)}</p>
            </div>
            <div>
              <p className="text-ink-400">Décalage</p>
              <p className="font-semibold">{biasText(current.stats, current.frame)}</p>
            </div>
          </div>
          {current.stats.misses && <MissBreakdown misses={current.stats.misses} />}
          <p className="mt-3 text-xs text-ink-500">
            Points pleins : fléchette dans la case ; cercles : à côté. Croix et cercle pointillé : point moyen d'impact et rayon contenant la moitié des
            fléchettes.
            {current.frame === "target" && " Toutes les cases sont ramenées en haut : « extérieur » signifie vers le bord de la cible."}
          </p>
        </Card>
      </div>

      {doubleTargets.length > 0 && (
        <Card title="Doubles">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-ink-400">
                <tr>
                  <th className="py-1">Double</th>
                  <th className="text-right">Visés</th>
                  <th className="text-right">Touchés</th>
                  <th className="text-right">Dehors</th>
                  <th className="text-right">Dedans</th>
                  <th className="text-right">À côté</th>
                </tr>
              </thead>
              <tbody>
                {doubleTargets.map((t) => {
                  const missed = t.misses ? t.misses.outside + t.misses.inside + t.misses.side : 0;
                  const share = (v: number) => (missed ? pct(v / missed) : "—");
                  return (
                    <tr key={t.target} className="border-t border-ink-800">
                      <td className="py-1.5 font-semibold">{t.target}</td>
                      <td className="text-right tabular">{t.count}</td>
                      <td className="text-right tabular">{pct(t.hitRate)}</td>
                      <td className="text-right tabular text-ink-300">{share(t.misses?.outside ?? 0)}</td>
                      <td className="text-right tabular text-ink-300">{share(t.misses?.inside ?? 0)}</td>
                      <td className="text-right tabular text-ink-300">{share(t.misses?.side ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-500">Dehors / dedans / à côté : répartition des doubles ratés.</p>
        </Card>
      )}

      {d.trend.length > 1 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Écart moyen au scoring, par semaine">
            <TrendChart data={d.trend.map((w) => ({ label: new Date(w.week).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }), value: w.scoringError }))} unit=" mm" />
          </Card>
          <Card title="Doubles touchés, par semaine">
            <TrendChart
              data={d.trend.map((w) => ({ label: new Date(w.week).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }), value: w.doubleRate === null ? null : Math.round(w.doubleRate * 1000) / 10 }))}
              unit=" %"
            />
          </Card>
        </div>
      )}
      <p className="text-xs text-ink-500">
        Cible visée déduite de l'état de la partie : T20 au scoring (T19 si la fléchette est tombée de ce côté), double de la sortie, cible affichée dans les
        entraînements. Les fléchettes de préparation d'une sortie, du Cricket et du Killer ne sont pas comptées (intention incertaine). Mesures en millimètres
        sur une cible réglementaire.
      </p>
    </div>
  );
}

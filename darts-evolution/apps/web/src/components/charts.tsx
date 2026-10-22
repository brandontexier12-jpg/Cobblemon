import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Graphiques : marques fines (lignes 2 px, points ≥ 8 px cerclés de la couleur de fond, barres ≤ 24 px
 * à bout arrondi), grille discrète, info-bulle au survol, tableau consultable. Couleurs validées
 * pour le fond sombre (voir docs/statistiques.md).
 */
export const SERIES_COLOR = "#e8641a"; // orange de marque, validé pour une série unique sur fond sombre
export const CATEGORICAL = ["#3987e5", "#d95926", "#199e70", "#c98500"]; // ordre fixe, 4 séries max
const SURFACE = "#141416";
const GRID = "#26262b";
const AXIS = "#a1a1aa";

const tooltipStyle = {
  contentStyle: { background: "#1c1c20", border: "1px solid #34343a", borderRadius: 12, color: "#f5f5f4" },
  labelStyle: { color: "#a1a1aa", marginBottom: 4 },
  itemStyle: { color: "#f5f5f4" },
  cursor: { stroke: "#4a4a52", strokeWidth: 1 },
};

export interface TrendPoint {
  label: string;
  value: number | null;
}

function TableView({ rows, columns }: { rows: (string | number)[][]; columns: string[] }) {
  return (
    <div className="max-h-64 overflow-auto rounded-xl border border-ink-700">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-ink-800 text-left text-ink-300">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-ink-800">
              {r.map((cell, j) => (
                <td key={j} className="tabular px-3 py-1.5 text-ink-100">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartFrame({ children, table, height }: { children: React.ReactNode; table: React.ReactNode; height: number }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" className="text-xs text-ink-300 underline-offset-2 hover:text-ink-100 hover:underline" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Voir le graphique" : "Voir le tableau"}
        </button>
      </div>
      {showTable ? table : <div style={{ height }}>{children}</div>}
    </div>
  );
}

/** Évolution d'une mesure dans le temps (une seule série : pas de légende, le titre la nomme). */
export function TrendChart({ data, unit = "", height = 240, format = (v: number) => v.toFixed(1) }: { data: TrendPoint[]; unit?: string; height?: number; format?: (v: number) => string }) {
  const points = data.filter((d) => d.value !== null);
  if (points.length === 0) return <p className="py-10 text-center text-ink-400">Pas encore de données sur cette période.</p>;
  const last = points[points.length - 1]!;
  return (
    <ChartFrame height={height} table={<TableView columns={["Période", "Valeur"]} rows={data.map((d) => [d.label, d.value === null ? "–" : `${format(d.value)}${unit}`])} />}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 44, bottom: 4, left: -8 }}>
          <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" stroke={AXIS} tick={{ fontSize: 12, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
          <YAxis stroke={AXIS} tick={{ fontSize: 12, fill: AXIS }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => format(v)} />
          <Tooltip {...tooltipStyle} formatter={(v) => [`${format(Number(v))}${unit}`, "Valeur"]} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={SERIES_COLOR}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            connectNulls
            dot={{ r: 4, fill: SERIES_COLOR, stroke: SURFACE, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: SERIES_COLOR, stroke: SURFACE, strokeWidth: 2 }}
            isAnimationActive={false}
            label={(props: { x?: number | string; y?: number | string; index?: number }) =>
              props.index === data.lastIndexOf(last) ? (
                <text x={Number(props.x ?? 0) + 8} y={Number(props.y ?? 0) + 4} fill="#f5f5f4" fontSize={12} fontWeight={600}>
                  {format(last.value!)}
                  {unit}
                </text>
              ) : (
                <g />
              )
            }
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Comparaison de plusieurs séries (≤ 4) : légende toujours présente, couleurs en ordre fixe. */
export function MultiTrendChart({
  data,
  series,
  height = 260,
  unit = "",
}: {
  data: Record<string, string | number | null>[];
  series: { key: string; name: string }[];
  height?: number;
  unit?: string;
}) {
  const shown = series.slice(0, 4);
  return (
    <ChartFrame
      height={height}
      table={<TableView columns={["Période", ...shown.map((s) => s.name)]} rows={data.map((d) => [String(d.label), ...shown.map((s) => (d[s.key] === null || d[s.key] === undefined ? "–" : `${d[s.key]}${unit}`))])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: -8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" stroke={AXIS} tick={{ fontSize: 12, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis stroke={AXIS} tick={{ fontSize: 12, fill: AXIS }} tickLine={false} axisLine={false} width={44} />
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={{ color: "#d4d4d8", fontSize: 13 }} />
          {shown.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={CATEGORICAL[i]}
              strokeWidth={2}
              connectNulls
              dot={{ r: 4, fill: CATEGORICAL[i], stroke: SURFACE, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Colonnes (une série) : barres fines à bout arrondi, valeur au survol et dans le tableau. */
export function ColumnChart({ data, unit = "", height = 220, format = (v: number) => String(v) }: { data: TrendPoint[]; unit?: string; height?: number; format?: (v: number) => string }) {
  if (data.every((d) => d.value === null)) return <p className="py-10 text-center text-ink-400">Pas encore de données sur cette période.</p>;
  return (
    <ChartFrame height={height} table={<TableView columns={["Période", "Valeur"]} rows={data.map((d) => [d.label, d.value === null ? "–" : `${format(d.value)}${unit}`])} />}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: -8 }} barCategoryGap="30%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" stroke={AXIS} tick={{ fontSize: 12, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={8} />
          <YAxis stroke={AXIS} tick={{ fontSize: 12, fill: AXIS }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => format(v)} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "#ffffff0d" }} formatter={(v) => [`${format(Number(v))}${unit}`, "Valeur"]} />
          <Bar dataKey="value" fill={SERIES_COLOR} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// Rampe séquentielle orange (une teinte, de faible à fort), validée sur le fond sombre.
const HEAT = ["#7d3a14", "#b84d12", "#e8641a", "#ff8a33", "#ffb37a"];

/** Calendrier d'activité (12 dernières semaines par défaut) : intensité = fléchettes lancées. */
export function ActivityCalendar({ days, weeks = 18 }: { days: { day: string; darts: number; sessions: number }[]; weeks?: number }) {
  const [hover, setHover] = useState<{ day: string; darts: number; sessions: number } | null>(null);
  const { grid, max } = useMemo(() => {
    const byDay = new Map(days.map((d) => [d.day, d]));
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOffset = (end.getDay() + 6) % 7; // lundi = 0
    const start = new Date(end.getTime() - ((weeks - 1) * 7 + startOffset) * 86400_000);
    const cols: { day: string; darts: number; sessions: number; future: boolean }[][] = [];
    for (let w = 0; w < weeks; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const entry = byDay.get(key);
        col.push({ day: key, darts: entry?.darts ?? 0, sessions: entry?.sessions ?? 0, future: date > end });
      }
      cols.push(col);
    }
    return { grid: cols, max: Math.max(1, ...days.map((d) => d.darts)) };
  }, [days, weeks]);
  const color = (darts: number) => (darts === 0 ? "#26262b" : HEAT[Math.min(HEAT.length - 1, Math.floor((darts / max) * HEAT.length))]!);
  const cell = 14;
  const gap = 3;
  return (
    <div>
      <div className="overflow-x-auto">
        <svg width={grid.length * (cell + gap) + 24} height={7 * (cell + gap) + 4} role="img" aria-label="Calendrier des entraînements">
          {["L", "", "M", "", "V", "", "D"].map((l, i) => (
            <text key={i} x={0} y={i * (cell + gap) + cell - 2} fontSize={10} fill={AXIS}>
              {l}
            </text>
          ))}
          {grid.map((col, w) =>
            col.map((d, i) =>
              d.future ? null : (
                <rect
                  key={d.day}
                  x={20 + w * (cell + gap)}
                  y={i * (cell + gap)}
                  width={cell}
                  height={cell}
                  rx={3}
                  fill={color(d.darts)}
                  stroke={hover?.day === d.day ? "#f5f5f4" : "none"}
                  strokeWidth={1.5}
                  onMouseEnter={() => setHover(d)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setHover(d)}
                >
                  <title>{`${new Date(`${d.day}T12:00:00`).toLocaleDateString("fr-FR")} : ${d.darts} fléchettes, ${d.sessions} séance(s)`}</title>
                </rect>
              ),
            ),
          )}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-300">
        <span className="min-h-4">
          {hover ? `${new Date(`${hover.day}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} — ${hover.darts} fléchettes, ${hover.sessions} séance(s)` : "Survolez ou touchez un jour"}
        </span>
        <span className="flex items-center gap-1">
          Moins
          {["#26262b", ...HEAT].map((c) => (
            <span key={c} className="inline-block h-3 w-3 rounded-[3px]" style={{ background: c }} />
          ))}
          Plus
        </span>
      </div>
    </div>
  );
}

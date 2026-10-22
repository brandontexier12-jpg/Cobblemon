import {
  BOARD_ORDER,
  BOARD_RADII,
  classifyPoint,
  dartDisplay,
  placeDart,
  segmentAngle,
  type BoardPoint,
  type BoardRing,
  type Dart,
} from "@darts-evolution/shared";
import { useRef, useState } from "react";
import type { ThrownDart } from "../lib/types";

/** Bord du dessin : la zone des numéros entoure l'anneau double (rayon 1). */
const EDGE = 1.32;
const R = BOARD_RADII;

const COLORS = {
  surround: "#0b0b0c",
  singleDark: "#151518",
  singleLight: "#3d3d45",
  red: "#c8352d",
  green: "#1e8e4c",
  wire: "#8a8a93",
  number: "#d4d4d8",
  hit: "#ff6b1a",
};

const RINGS: Record<Exclude<BoardRing, "bull" | "outerBull" | "outside">, [number, number]> = {
  innerSingle: [R.outerBull, R.tripleInner],
  triple: [R.tripleInner, R.tripleOuter],
  outerSingle: [R.tripleOuter, R.doubleInner],
  double: [R.doubleInner, R.doubleOuter],
};

/** Point SVG (y vers le bas) depuis un rayon et un angle horaire depuis le 20. */
function svgPoint(radius: number, angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [radius * Math.sin(a), -radius * Math.cos(a)];
}

function sectorPath(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = svgPoint(r1, a0);
  const [x1, y1] = svgPoint(r1, a1);
  const [x2, y2] = svgPoint(r0, a1);
  const [x3, y3] = svgPoint(r0, a0);
  return `M${x0} ${y0}A${r1} ${r1} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 0 0 ${x3} ${y3}Z`;
}

/** Contour d'une case (pour la mise en évidence). */
function bedShape(segment: number, ring: BoardRing): { kind: "circle"; r0: number; r1: number } | { kind: "path"; d: string } | null {
  if (ring === "bull") return { kind: "circle", r0: 0, r1: R.bull };
  if (ring === "outerBull") return { kind: "circle", r0: R.bull, r1: R.outerBull };
  if (ring === "outside") return null;
  const [r0, r1] = RINGS[ring];
  const center = segmentAngle(segment);
  return { kind: "path", d: sectorPath(r0, r1, center - 9, center + 9) };
}

function BedHighlight({ segment, ring, fill, opacity, outline }: { segment: number; ring: BoardRing; fill: string; opacity: number; outline?: string }) {
  const shape = bedShape(segment, ring);
  if (!shape) return null;
  const edge = outline ? { stroke: outline, strokeWidth: 0.008 } : {};
  if (shape.kind === "path") return <path d={shape.d} fill={fill} opacity={opacity} {...edge} strokeLinejoin="round" />;
  if (shape.r0 === 0) return <circle r={shape.r1} fill={fill} opacity={opacity} {...edge} />;
  return (
    <g opacity={opacity}>
      <circle r={(shape.r0 + shape.r1) / 2} fill="none" stroke={fill} strokeWidth={shape.r1 - shape.r0} />
      {outline && <circle r={shape.r1} fill="none" stroke={outline} strokeWidth={0.008} />}
    </g>
  );
}

/** Cases à éclairer pour une fléchette : l'anneau réel si connu, sinon les deux simples du secteur. */
function hitRings(dart: Dart, ring: BoardRing, exact: boolean): BoardRing[] {
  if (dart.multiplier === 1 && dart.segment !== 25 && !exact) return ["innerSingle", "outerSingle"];
  return [ring];
}

/** Cases d'une cible demandée par le mode (« T20 », « D16 », « S5 », « 20 », « Bull », « 25 »…). */
export function targetBeds(label: string | undefined): { segment: number; ring: BoardRing }[] {
  if (!label) return [];
  if (label === "Bull") return [{ segment: 25, ring: "bull" }];
  if (label === "25") return [{ segment: 25, ring: "outerBull" }];
  if (label.startsWith("Bull")) return [{ segment: 25, ring: "bull" }, { segment: 25, ring: "outerBull" }];
  const m = /^([SDT])?(\d{1,2})$/.exec(label);
  if (!m) return [];
  const segment = Number(m[2]);
  if (!BOARD_ORDER.includes(segment)) return [];
  const rings: BoardRing[] =
    m[1] === "D" ? ["double"] : m[1] === "T" ? ["triple"] : m[1] === "S" ? ["innerSingle", "outerSingle"] : ["innerSingle", "triple", "outerSingle", "double"];
  return rings.map((ring) => ({ segment, ring }));
}

// Le dessin de la cible ne change jamais : calculé une seule fois.
const STATIC_BOARD = (
  <g>
    <circle r={EDGE} fill={COLORS.surround} />
    <circle r={R.doubleOuter + 0.005} fill="none" stroke="#26262b" strokeWidth={0.012} />
    {BOARD_ORDER.map((segment, index) => {
      const center = index * 18;
      const even = index % 2 === 0;
      const single = even ? COLORS.singleDark : COLORS.singleLight;
      const ring = even ? COLORS.red : COLORS.green;
      return (
        <g key={segment}>
          <path d={sectorPath(R.outerBull, R.tripleInner, center - 9, center + 9)} fill={single} />
          <path d={sectorPath(R.tripleInner, R.tripleOuter, center - 9, center + 9)} fill={ring} />
          <path d={sectorPath(R.tripleOuter, R.doubleInner, center - 9, center + 9)} fill={single} />
          <path d={sectorPath(R.doubleInner, R.doubleOuter, center - 9, center + 9)} fill={ring} />
        </g>
      );
    })}
    <circle r={R.outerBull} fill={COLORS.green} />
    <circle r={R.bull} fill={COLORS.red} />
    {/* Fils */}
    <g stroke={COLORS.wire} strokeWidth={0.0045} fill="none" opacity={0.55}>
      {BOARD_ORDER.map((_, index) => {
        const [x0, y0] = svgPoint(R.outerBull, index * 18 - 9);
        const [x1, y1] = svgPoint(R.doubleOuter, index * 18 - 9);
        return <line key={index} x1={x0} y1={y0} x2={x1} y2={y1} />;
      })}
      {[R.bull, R.outerBull, R.tripleInner, R.tripleOuter, R.doubleInner, R.doubleOuter].map((r) => (
        <circle key={r} r={r} />
      ))}
    </g>
    {BOARD_ORDER.map((segment, index) => {
      const [x, y] = svgPoint(1.155, index * 18);
      return (
        <text
          key={segment}
          x={x}
          y={y}
          fill={COLORS.number}
          fontSize={0.13}
          fontWeight={700}
          textAnchor="middle"
          dominantBaseline="central"
          className="font-display"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {segment}
        </text>
      );
    })}
  </g>
);

/** Killer : numéro d'un joueur, coloré à sa couleur et rempli selon ses vies. */
export interface KillerSegment {
  segment: number;
  color: string;
  /** Remplissage de 0 (aucune vie) à 1 (Killer). */
  fill: number;
  killer: boolean;
  eliminated: boolean;
}

function KillerOverlay({ segments }: { segments: KillerSegment[] }) {
  return (
    <g className="pointer-events-none">
      {segments.map((k) => {
        const center = segmentAngle(k.segment);
        const r0 = R.outerBull;
        const r1 = R.doubleOuter;
        const rFill = r0 + Math.max(0, Math.min(1, k.fill)) * (r1 - r0);
        const [nx, ny] = svgPoint(1.155, center);
        const color = k.eliminated ? "#52525b" : k.color;
        const [ax, ay] = svgPoint(0.45, center - 6);
        const [bx, by] = svgPoint(0.85, center + 6);
        const [cx, cy] = svgPoint(0.45, center + 6);
        const [dx, dy] = svgPoint(0.85, center - 6);
        return (
          <g key={k.segment}>
            {/* Secteur du joueur : teinte légère, puis remplissage depuis le centre selon ses vies. */}
            <path d={sectorPath(r0, r1, center - 9, center + 9)} fill={color} opacity={k.eliminated ? 0.35 : 0.22} />
            {k.fill > 0 && !k.eliminated && <path d={sectorPath(r0, rFill, center - 9, center + 9)} fill={color} opacity={0.85} />}
            <path
              d={sectorPath(r0, r1, center - 9, center + 9)}
              fill="none"
              stroke={color}
              strokeWidth={k.killer ? 0.022 : 0.01}
              strokeLinejoin="round"
              className={k.killer ? "killer-glow" : undefined}
            />
            {k.eliminated && (
              <g stroke="#e4e4e7" strokeWidth={0.02} strokeLinecap="round" opacity={0.8}>
                <line x1={ax} y1={ay} x2={bx} y2={by} />
                <line x1={cx} y1={cy} x2={dx} y2={dy} />
              </g>
            )}
            {/* Numéro du joueur sur fond de sa couleur. */}
            <circle cx={nx} cy={ny} r={0.095} fill={color} stroke={k.killer ? "#fff" : "none"} strokeWidth={0.012} />
            <text x={nx} y={ny} fill="#0b0b0c" fontSize={0.12} fontWeight={800} textAnchor="middle" dominantBaseline="central" style={{ fontFamily: "var(--font-display)" }}>
              {k.segment}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export interface DartboardProps {
  /** Fléchettes de la visite affichée (les fléchettes ajoutées automatiquement sont ignorées). */
  darts: ThrownDart[];
  /** Cible demandée par le mode de jeu (mise en évidence). */
  target?: string;
  /** Killer : numéros des joueurs colorés et remplis selon leurs vies. */
  killer?: KillerSegment[];
  /** Saisie en touchant la cible. */
  onPick?: (dart: Dart, coords: BoardPoint) => void;
  disabled?: boolean;
  className?: string;
}

/** Cible vectorielle : impacts de la visite en cours, et saisie au toucher si `onPick` est fourni. */
export function Dartboard({ darts, target, killer, onPick, disabled = false, className = "" }: DartboardProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<(Dart & { ring: BoardRing }) | null>(null);
  const interactive = !!onPick && !disabled;

  const toBoard = (e: { clientX: number; clientY: number }): BoardPoint | null => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    if (Math.hypot(p.x, p.y) > EDGE) return null;
    return { x: Number(p.x.toFixed(4)), y: Number((-p.y).toFixed(4)) };
  };

  const placed = darts
    .filter((d) => !d.padded)
    .map((d, slot) => ({ dart: d, slot, place: placeDart(d, d.coords, slot) }))
    .filter((p) => p.place !== null);

  const lastIndex = placed.length - 1;

  return (
    <div className={`relative ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`${-EDGE} ${-EDGE} ${EDGE * 2} ${EDGE * 2}`}
        className={`block h-full w-full select-none ${interactive ? "cursor-crosshair" : ""}`}
        role={interactive ? "group" : "img"}
        aria-label={
          placed.length
            ? `Cible : ${placed.map((p) => dartDisplay(p.dart)).join(", ")}`
            : interactive
              ? "Cible : touchez une case pour saisir une fléchette"
              : "Cible"
        }
        onPointerMove={interactive ? (e) => setHover(((p) => (p ? classifyPoint(p) : null))(toBoard(e))) : undefined}
        onPointerLeave={interactive ? () => setHover(null) : undefined}
        onClick={
          interactive
            ? (e) => {
                const point = toBoard(e);
                if (!point) return;
                const { ring: _ring, ...dart } = classifyPoint(point);
                onPick?.(dart, point);
              }
            : undefined
        }
      >
        <defs>
          <filter id="hit-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="0.02" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {STATIC_BOARD}
        {killer && <KillerOverlay segments={killer} />}
        {targetBeds(target).map((b) => (
          <BedHighlight key={`cible-${b.ring}`} segment={b.segment} ring={b.ring} fill="#ffffff" opacity={0.3} outline="#ffffff" />
        ))}
        {/* Cases touchées pendant la visite */}
        <g filter="url(#hit-glow)">
          {placed.flatMap(({ dart, slot, place }) =>
            hitRings(dart, place!.ring, place!.exact).map((ring) => (
              <BedHighlight key={`${slot}-${ring}`} segment={dart.segment} ring={ring} fill={COLORS.hit} opacity={0.95} outline="#fff3e6" />
            )),
          )}
        </g>
        {interactive && hover && hover.ring !== "outside" && <BedHighlight segment={hover.segment} ring={hover.ring} fill="#ffffff" opacity={0.28} />}
        {/* Impacts */}
        {placed.map(({ dart, slot, place }, i) => {
          const x = place!.point.x;
          const y = -place!.point.y;
          return (
            <g key={dart.eventId ?? slot} transform={`translate(${x} ${y})`} className="pointer-events-none">
              {i === lastIndex && <circle r={0.05} fill="none" stroke={COLORS.hit} strokeWidth={0.012} className="dart-ping" />}
              <circle r={0.042} fill="#ffffff" stroke={COLORS.surround} strokeWidth={0.012} strokeDasharray={place!.exact ? undefined : "0.02 0.012"} />
              <text fontSize={0.052} fontWeight={800} textAnchor="middle" dominantBaseline="central" fill={COLORS.surround} style={{ fontFamily: "var(--font-display)" }}>
                {slot + 1}
              </text>
            </g>
          );
        })}
      </svg>
      {interactive && hover && (
        <span className="pointer-events-none absolute left-2 top-2 rounded-lg bg-ink-950/85 px-2 py-1 font-display text-lg font-bold text-ink-100">
          {hover.multiplier === 0 ? "Raté" : dartDisplay(hover)}
        </span>
      )}
    </div>
  );
}

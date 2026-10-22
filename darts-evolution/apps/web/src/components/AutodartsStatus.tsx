import { Link } from "react-router-dom";
import type { AutodartsOverview } from "../lib/types";
import { Icon } from "./Icon";

const LABELS: Record<string, { label: string; tone: string; dot: string; icon: string }> = {
  connected: { label: "Connecté", tone: "text-[#6fdc6f]", dot: "bg-good", icon: "check" },
  connecting: { label: "Connexion…", tone: "text-warning", dot: "bg-warning", icon: "refresh" },
  reconnecting: { label: "Reconnexion…", tone: "text-warning", dot: "bg-warning", icon: "refresh" },
  disconnected: { label: "Déconnecté", tone: "text-ink-300", dot: "bg-ink-400", icon: "x" },
  error: { label: "Erreur", tone: "text-[#ff8f8f]", dot: "bg-critical", icon: "warning" },
  disabled: { label: "Désactivé", tone: "text-ink-400", dot: "bg-ink-500", icon: "plug" },
};

export function autodartsLabel(overview: AutodartsOverview | null) {
  const state = overview?.status.state ?? "disabled";
  return LABELS[state] ?? LABELS.disabled!;
}

/** Indicateur d'état Autodarts : icône + libellé (jamais la couleur seule). */
export function AutodartsPill({ overview, compact = false }: { overview: AutodartsOverview | null; compact?: boolean }) {
  const info = autodartsLabel(overview);
  const simulated = overview?.simulation;
  return (
    <Link
      to="/autodarts"
      className={`inline-flex items-center gap-2 rounded-full border border-ink-600 bg-ink-900 px-3 py-1.5 text-sm hover:border-ink-500 ${info.tone}`}
      title="État de l'intégration Autodarts"
    >
      <span className={`h-2.5 w-2.5 rounded-full ${info.dot}`} aria-hidden="true" />
      <Icon name={info.icon} size={15} />
      {!compact && <span className="text-ink-200">Autodarts</span>}
      <span>{info.label}</span>
      {simulated && <span className="rounded bg-warning/20 px-1.5 text-xs font-bold text-warning">SIMULATION</span>}
    </Link>
  );
}

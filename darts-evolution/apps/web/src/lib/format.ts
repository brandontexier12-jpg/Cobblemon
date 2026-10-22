const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const shortDay = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" });

export function fmtDate(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : "–";
}

export function fmtDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : "–";
}

export function fmtNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return value.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return value.toLocaleString("fr-FR");
}

export function fmtPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "–";
  return `${(ratio * 100).toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;
}

/** Libellé d'une clé de série (AAAA-MM-JJ, AAAA-MM). */
export function fmtBucket(key: string, granularity: "day" | "week" | "month"): string {
  if (granularity === "month") {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
  }
  const d = new Date(`${key}T12:00:00`);
  return granularity === "week" ? `sem. ${shortDay.format(d)}` : shortDay.format(d);
}

export const LEVEL_LABEL: Record<string, string> = {
  debutant: "Débutant",
  intermediaire: "Intermédiaire",
  confirme: "Confirmé",
  expert: "Expert",
};

export const STATUS_LABEL: Record<string, string> = {
  active: "En cours",
  finished: "Terminée",
  abandoned: "Abandonnée",
};

/** Période prédéfinie → bornes ISO. */
export function periodRange(preset: string): { from?: string; to?: string } {
  const now = new Date();
  const days: Record<string, number> = { "7j": 7, "30j": 30, "90j": 90, "1an": 365 };
  if (preset in days) return { from: new Date(now.getTime() - days[preset]! * 86400_000).toISOString() };
  return {};
}

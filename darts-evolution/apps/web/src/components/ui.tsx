import { createContext, isValidElement, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-500 text-ink-950 hover:bg-brand-400 font-semibold",
  secondary: "bg-ink-800 text-ink-100 border border-ink-600 hover:border-ink-500 hover:bg-ink-700",
  ghost: "text-ink-200 hover:bg-ink-800",
  danger: "bg-critical/15 text-[#ff8f8f] border border-critical/40 hover:bg-critical/25",
};

export function Button({
  variant = "secondary",
  icon,
  children,
  className = "",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "px-3 py-1.5 text-sm min-h-9", md: "px-4 py-2.5 min-h-11", lg: "px-6 py-3.5 text-lg min-h-14" };
  return (
    <button
      type="button"
      className={`press inline-flex items-center justify-center gap-2 rounded-xl transition disabled:cursor-not-allowed disabled:opacity-40 ${sizes[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
      {children}
    </button>
  );
}

export function Card({ children, className = "", title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-ink-700 bg-ink-850 p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="font-display text-xl font-semibold tracking-wide text-ink-100">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-ink-100 sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-300">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Tuile de statistique : libellé, valeur en grand, précision éventuelle. */
export function StatTile({ label, value, hint, accent = false }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wider text-ink-300">{label}</div>
      <div className={`font-display tabular text-3xl font-bold leading-tight ${accent ? "text-brand-500" : "text-ink-100"}`}>{value}</div>
      {hint && <div className="text-xs text-ink-400">{hint}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" | "good" | "warning" | "critical" | "info" }) {
  const tones = {
    neutral: "bg-ink-700 text-ink-200",
    brand: "bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/40",
    good: "bg-good/15 text-[#6fdc6f] ring-1 ring-good/40",
    warning: "bg-warning/15 text-warning ring-1 ring-warning/40",
    critical: "bg-critical/15 text-[#ff8f8f] ring-1 ring-critical/40",
    info: "bg-[#3987e5]/15 text-[#9ec5f4] ring-1 ring-[#3987e5]/40",
  };
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Spinner({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-ink-300" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink-600 border-t-brand-500" />
      {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-critical/40 bg-critical/10 p-4 text-[#ffb4b4]" role="alert">
      <Icon name="warning" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry} icon="refresh">
          Réessayer
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-600 p-8 text-center">
      <p className="font-display text-xl font-semibold text-ink-100">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-ink-300">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`animate-pop max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-ink-600 bg-ink-850 p-5 sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold">{title}</h2>
          <button className="press rounded-lg p-2 text-ink-300 hover:bg-ink-700" onClick={onClose} aria-label="Fermer">
            <Icon name="x" />
          </button>
        </div>
        {children}
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

interface ConfirmRequest {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface Toast {
  id: number;
  message: string;
  tone: "info" | "good" | "warning" | "critical";
}

const UiContext = createContext<{
  confirm: (opts: Omit<ConfirmRequest, "resolve">) => Promise<boolean>;
  toast: (message: string, tone?: Toast["tone"]) => void;
} | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const confirm = useCallback((opts: Omit<ConfirmRequest, "resolve">) => new Promise<boolean>((resolve) => setRequest({ ...opts, resolve })), []);
  const toast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === "critical" || tone === "warning" ? 7000 : 3500);
  }, []);
  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };
  const toneClass = { info: "border-ink-500", good: "border-good", warning: "border-warning", critical: "border-critical" };
  const toneIcon = { info: "info", good: "check", warning: "warning", critical: "warning" };
  return (
    <UiContext.Provider value={{ confirm, toast }}>
      {children}
      <Modal
        open={!!request}
        onClose={() => close(false)}
        title={request?.title ?? ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              Annuler
            </Button>
            <Button variant={request?.danger ? "danger" : "primary"} onClick={() => close(true)}>
              {request?.confirmLabel ?? "Confirmer"}
            </Button>
          </>
        }
      >
        <div className="text-ink-200">{request?.message}</div>
      </Modal>
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`animate-pop pointer-events-auto flex max-w-lg items-start gap-2 rounded-xl border-l-4 bg-ink-800 px-4 py-3 text-sm shadow-xl ${toneClass[t.tone]}`}>
            <Icon name={toneIcon[t.tone]} size={18} className="mt-0.5 shrink-0" />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </UiContext.Provider>
  );
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("UiProvider manquant");
  return ctx;
}

/**
 * Champ de formulaire. Un contrôle natif (input, select, textarea) est associé à son libellé ;
 * un groupe de boutons (choix, compteur) devient un groupe nommé, pour ne pas donner le libellé
 * du champ à son premier bouton.
 */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  const native = isValidElement(children) && typeof children.type === "string" && ["input", "select", "textarea"].includes(children.type);
  const content = (
    <>
      <span className="mb-1.5 block text-sm font-medium text-ink-200">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
    </>
  );
  return native ? (
    <label className="block">{content}</label>
  ) : (
    <div className="block" role="group" aria-label={label}>
      {content}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-ink-600 bg-ink-900 px-3 py-2.5 text-ink-100 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none min-h-11";

/** Choix exclusif sous forme de boutons (grandes zones tactiles). */
export function Segmented<T extends string | number>({ value, options, onChange, size = "md" }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`press rounded-xl border px-3 ${size === "sm" ? "min-h-9 text-sm" : "min-h-11"} ${
            o.value === value ? "border-brand-500 bg-brand-500/15 font-semibold text-brand-300" : "border-ink-600 bg-ink-900 text-ink-200 hover:border-ink-500"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, min, max, onChange, step = 1 }: { value: number; min: number; max: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-ink-600 bg-ink-900">
      <button type="button" className="press touch px-4 text-xl text-ink-200" onClick={() => onChange(Math.max(min, value - step))} aria-label="Diminuer">
        −
      </button>
      <span className="font-display tabular min-w-12 text-center text-xl font-semibold">{value}</span>
      <button type="button" className="press touch px-4 text-xl text-ink-200" onClick={() => onChange(Math.min(max, value + step))} aria-label="Augmenter">
        +
      </button>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="press flex min-h-11 items-center gap-3 text-left">
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-brand-500" : "bg-ink-600"}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${checked ? "left-6" : "left-1"}`} />
      </span>
      <span className="text-ink-200">{label}</span>
    </button>
  );
}

export function PlayerAvatar({ avatar, color, size = 40 }: { avatar: string; color: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: `${color}26`, boxShadow: `inset 0 0 0 2px ${color}`, fontSize: size * 0.5 }}
      aria-hidden="true"
    >
      {avatar}
    </span>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

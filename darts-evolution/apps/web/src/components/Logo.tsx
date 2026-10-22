/** Logo original DARTS EVOLUTION : cible stylisée traversée par une fléchette ascendante. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0b0b0c" />
      <circle cx="32" cy="32" r="22" fill="none" stroke="#2a2a30" strokeWidth="6" />
      <circle cx="32" cy="32" r="13" fill="none" stroke="#ff6b1a" strokeWidth="4" />
      <circle cx="32" cy="32" r="4.5" fill="#ff6b1a" />
      <path d="M50 10 L36.5 27.5" stroke="#f5f5f4" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M47 9.5 L53.5 7 L52 13.6 Z" fill="#ff6b1a" />
      <path d="M49.2 6.6 L54.6 4.2 M51.5 9.6 L57.2 8.3" stroke="#f5f5f4" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5" aria-label="DARTS EVOLUTION">
      <LogoMark size={compact ? 32 : 38} />
      {!compact && (
        <span className="font-display leading-none">
          <span className="block text-[1.35rem] font-bold tracking-wide text-ink-100">DARTS</span>
          <span className="block text-[0.82rem] font-semibold tracking-[0.32em] text-brand-500">EVOLUTION</span>
        </span>
      )}
    </span>
  );
}

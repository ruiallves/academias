export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/**
 * O símbolo da Academias: o A com o ponto, dentro de um círculo.
 *
 * É o desenho do logótipo verdadeiro (`public/academias-logo.png`), refeito em
 * vetor para acompanhar a cor do sítio onde está: o círculo leva a cor do
 * texto, o A a do fundo e o ponto a cor viva.
 */
export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <circle cx="16" cy="16" r="16" fill="currentColor" />
      <path d="M16 7.2 24.6 24h-4.5L16 15.6 11.9 24H7.4Z" fill="var(--fundo, #f5f4f0)" />
      <circle cx="16" cy="22.2" r="2.5" fill="var(--acento)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <Mark size={28} />
      <span className="text-[1.32rem] leading-none font-extrabold tracking-[-0.04em]" style={{ fontStretch: "90%" }}>
        academias
      </span>
    </span>
  );
}

export function Seta() {
  return (
    <span aria-hidden className="seta">
      →
    </span>
  );
}

export function InstagramIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect x="3" y="3" width="18" height="18" rx="5.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17.1" cy="6.9" r="1.1" fill="currentColor" />
    </svg>
  );
}

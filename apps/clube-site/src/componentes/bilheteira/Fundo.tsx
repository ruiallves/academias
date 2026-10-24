/**
 * O fundo dos cabeçalhos escuros da bilheteira: um brilho da cor do clube no
 * canto e as linhas de um campo, finas, a sair pela direita. Fica por trás do
 * conteúdo (o pai é `relative overflow-hidden`) e não se lê.
 */
export function FundoDaBilheteira() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 90% at 92% 0%, color-mix(in srgb, var(--color-signal-strong) 70%, transparent), transparent 70%), radial-gradient(40% 60% at 0% 100%, color-mix(in srgb, var(--color-signal-strong) 22%, transparent), transparent 70%)",
        }}
      />
      <svg
        aria-hidden
        className="pointer-events-none absolute -right-24 top-1/2 hidden h-[140%] -translate-y-1/2 text-night-ink opacity-[0.07] md:block"
        viewBox="0 0 400 260"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="2" y="2" width="396" height="256" rx="4" />
        <line x1="200" y1="2" x2="200" y2="258" />
        <circle cx="200" cy="130" r="38" />
        <circle cx="200" cy="130" r="2.5" fill="currentColor" />
        <rect x="2" y="66" width="62" height="128" />
        <rect x="2" y="100" width="22" height="60" />
        <rect x="336" y="66" width="62" height="128" />
        <rect x="376" y="100" width="22" height="60" />
        <path d="M64 104a30 30 0 0 1 0 52M336 104a30 30 0 0 0 0 52" />
      </svg>
    </>
  );
}

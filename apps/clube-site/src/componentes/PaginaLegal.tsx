import Link from "next/link";

/**
 * As peças das páginas legais (privacidade, condições de venda, termos do
 * sócio): o corpo de leitura, as secções com o traço, e as ligações. Os
 * textos são escritos a partir dos dados do clube, em linguagem simples:
 * é para a família ler, não para o advogado.
 */
export function CorpoLegal({ children }: { children: React.ReactNode }) {
  return <div className="container-site mt-10 max-w-3xl space-y-12 text-[1.0625rem] leading-relaxed text-ink-2">{children}</div>;
}

export function Seccao({ id, titulo, children }: { id?: string; titulo: string; children: React.ReactNode }) {
  return (
    <section id={id} data-reveal className="scroll-mt-28">
      <h2 className="display text-2xl">{titulo}</h2>
      <span className="traco mt-3" aria-hidden />
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

const LIGACAO = "font-semibold text-ink underline-offset-2 hover:underline";

/** Uma ligação no meio do texto. `href` de fora abre noutro separador. */
export function Ligacao({ href, children }: { href: string; children: React.ReactNode }) {
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={LIGACAO}>
        {children}
      </a>
    );
  }
  if (href.startsWith("mailto:") || href.startsWith("tel:")) {
    return (
      <a href={href} className={LIGACAO}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={LIGACAO}>
      {children}
    </Link>
  );
}

/** O que o clube acrescentou, na voz dele, no fim de uma página. */
export function NotaDoClube({ titulo, paragrafos }: { titulo: string; paragrafos: string[] }) {
  if (paragrafos.length === 0) return null;
  return (
    <Seccao titulo={titulo}>
      {paragrafos.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </Seccao>
  );
}

/** "Para isto, escreve para x@y.pt" ou, sem email, "fala com o clube pelos contactos". */
export function ComoFalar({ email }: { email?: string }) {
  return email ? (
    <>
      escreve para <Ligacao href={`mailto:${email}`}>{email}</Ligacao>
    </>
  ) : (
    <>
      fala com o clube pelos <Ligacao href="/contactos">contactos</Ligacao>
    </>
  );
}

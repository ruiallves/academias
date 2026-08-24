import { useEffect, useRef, type ReactNode } from "react";

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/**
 * A marca.
 *
 * Um canto de campo: o arco do pontapé de canto mais as duas linhas que o formam.
 * Geométrico, desenhável a 16px, e inequivocamente desportivo sem ser uma bola —
 * que é o que todas as outras marcas deste mercado usam.
 */
export function Mark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
      <path d="M3 12.5A8.5 8.5 0 0 0 11.5 21" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
      <circle cx="3" cy="3" r="2" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <Mark size={22} className="text-field" />
      <span
        className="text-[17px] font-bold tracking-[-0.03em]"
        style={{ fontFamily: "var(--font-display)", fontVariationSettings: '"wdth" 90' }}
      >
        academias
      </span>
    </span>
  );
}

/**
 * O marcador de secção.
 *
 * `01 — Gestão do clube`. É o que dá à página o ar de documento numerado, e é
 * também o que deixa uma pessoa dizer ao telefone "olha a secção 7" — coisa que
 * uma landing page normal não permite.
 */
export function SectionMark({ n, children }: { n: string; children: ReactNode }) {
  return (
    <p className="eyebrow flex items-center gap-3">
      <span className="tabular">{n}</span>
      <span aria-hidden className="h-px w-6 bg-current opacity-40" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Entrada ao entrar no ecrã.
 *
 * `IntersectionObserver` e uma classe — sem biblioteca de animação. Uma página de
 * marketing que carrega 40 KB de JavaScript para deslizar títulos é uma página que
 * demora mais a abrir do que o produto que está a vender.
 *
 * Observa uma vez e desliga: elementos que reanimam ao voltar a subir são um
 * efeito, não uma entrada.
 */
export function Reveal({
  children,
  i = 0,
  as: Tag = "div",
  className,
}: {
  children: ReactNode;
  i?: number;
  as?: "div" | "section" | "li" | "article" | "header";
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.setAttribute("data-shown", "");
        io.disconnect();
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      data-reveal=""
      style={{ ["--i" as string]: i }}
      className={className}
    >
      {children}
    </Tag>
  );
}

/**
 * Moldura de produto.
 *
 * `shot` aponta para um ficheiro em `public/` — uma captura verdadeira do produto.
 * Quando ele não existe (ou falha), fica o que está dentro: uma reconstrução da
 * interface em HTML, feita com os mesmos tokens da consola.
 *
 * Não é um substituto por preguiça. É a ordem certa: uma captura envelhece com a
 * primeira mudança de interface e fica desfocada em ecrãs Retina; uma reconstrução
 * é nítida em qualquer resolução e mostra-se com o texto certo. Quem tiver a
 * captura, larga-a na pasta e ela ganha.
 */
export function ProductFrame({
  label,
  shot,
  alt,
  children,
  className,
}: {
  label: string;
  shot?: string;
  alt?: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLImageElement>(null);

  return (
    <div className={cx("frame", className)}>
      <div className="frame-bar">
        <span className="frame-dot" />
        <span className="frame-dot" />
        <span className="frame-dot" />
        <span className="ml-2 truncate">{label}</span>
      </div>

      {shot && (
        <img
          ref={ref}
          src={shot}
          alt={alt ?? label}
          loading="lazy"
          className="block w-full"
          onError={(e) => {
            // Sem captura, mostra-se a reconstrução. Silenciosamente: um cartaz a
            // dizer "imagem em falta" não interessa a ninguém que esteja a ler.
            e.currentTarget.style.display = "none";
            e.currentTarget.nextElementSibling?.removeAttribute("hidden");
          }}
        />
      )}

      <div hidden={Boolean(shot)}>{children}</div>
    </div>
  );
}

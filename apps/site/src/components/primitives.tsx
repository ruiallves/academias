import { useEffect, useRef, type ReactNode } from "react";

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/**
 * A marca — a bandeirola de canto.
 *
 * ## Porque é esta e não um ícone
 *
 * O símbolo anterior era um arco e duas linhas: abstracto, todo em traço fino, e
 * indistinguível de qualquer ícone de biblioteca — que é precisamente o que faz
 * uma marca parecer escolhida de um catálogo em vez de desenhada.
 *
 * Uma bandeirola de canto resolve as três coisas ao mesmo tempo. É
 * **inequivocamente desportiva** sem ser uma bola (que é o que todo este mercado
 * usa). Tem **massa sólida** — o triângulo é uma forma cheia, e uma forma cheia
 * lê-se a 20px na barra de navegação, coisa que um traço de 1.6px não faz. E é a
 * origem do **canto**, o raio assimétrico que atravessa as superfícies do site:
 * o símbolo e o sistema passam a explicar-se um ao outro.
 *
 * O arco é o do pontapé de canto, a meia opacidade — está lá para quem olhar
 * duas vezes, e não estorva quem só olha uma.
 */
export function Mark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      {/* O pano — cheio, e a única coisa que se vê ao tamanho de um favicon. */}
      <path d="M6.9 2.6 19.6 7 6.9 11.4Z" fill="currentColor" />
      {/* O mastro. */}
      <path d="M6.9 2.6v18.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* O arco do canto. */}
      <path d="M6.9 15.6a5.6 5.6 0 0 0 5.6 5.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

/**
 * O nome, em serifa.
 *
 * Minúsculas e apertado — como se assina, não como se grita. A serifa faz aqui o
 * trabalho de identidade que noutras marcas faz um símbolo caro: ninguém mais
 * neste mercado escreve o nome assim.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <Mark size={21} className="text-field" />
      <span
        className="text-[19px] leading-none font-[560] tracking-[-0.02em]"
        style={{ fontFamily: "var(--font-display)", fontVariationSettings: '"SOFT" 0, "WONK" 0' }}
      >
        academias
      </span>
    </span>
  );
}

/**
 * O marcador de secção.
 *
 * Versaletes na cor do campo, com um traço curto à frente. O número é herança
 * das páginas antigas — quando vier "—", não se mostra; quando vier um número,
 * fica discreto, para quem ainda aponta secções ao telefone.
 */
export function SectionMark({ n, children }: { n?: string; children: ReactNode }) {
  const showN = n && /\d/.test(n);
  return (
    <p className="eyebrow flex items-center gap-3">
      <span aria-hidden className="h-px w-7 bg-current opacity-50" />
      <span>{children}</span>
      {showN && <span className="tabular opacity-45">{n}</span>}
    </p>
  );
}

/**
 * Entrada ao entrar no ecrã.
 *
 * `IntersectionObserver` e uma classe — sem biblioteca de animação. Observa uma
 * vez e desliga: elementos que reanimam ao voltar a subir são um efeito, não uma
 * entrada.
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
 * O canto da marca, um filete, e uma barra mínima: um ponto verde e o endereço.
 * Sem os três círculos de janela — são o cliché de todos os mockups.
 *
 * `shot` aponta para uma captura verdadeira em `public/`. Quando não existe (ou
 * falha), fica a reconstrução em HTML que vem como `children` — tratada como
 * imagem: `aria-hidden`, não-selecionável, sem eventos. Ver `.shot` no CSS.
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
        <span className="truncate">{label}</span>
      </div>

      {shot && (
        <img
          ref={ref}
          src={shot}
          alt={alt ?? label}
          loading="lazy"
          draggable={false}
          className="block w-full select-none"
          onError={(e) => {
            // Sem captura, mostra-se a reconstrução. Silenciosamente: um cartaz a
            // dizer "imagem em falta" não interessa a ninguém que esteja a ler.
            e.currentTarget.style.display = "none";
            e.currentTarget.nextElementSibling?.removeAttribute("hidden");
          }}
        />
      )}

      <div hidden={Boolean(shot)} className="shot" aria-hidden>
        {children}
      </div>
    </div>
  );
}

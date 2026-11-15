"use client";

import { useLayoutEffect, useRef } from "react";
import { Emblema } from "@/componentes/Emblema";

/**
 * O cartão de sócio, a preencher-se enquanto a pessoa escreve. É o mesmo da
 * página `/ser-socio` da API (`landing/membership.template.ts`, classe `.card`),
 * medida a medida: o emblema, a categoria, o nome e o número que só existe
 * depois de a direção aprovar.
 *
 * Limpo de propósito (15/11, pedido do Rui): a cor do clube com um brilho no
 * canto e um só estilhaço, sem inclinação 3D nem moldura à volta. O "O teu
 * nome" por escrever vai em letra normal e esbatida; o nome escrito vai em
 * maiúsculas e cabe sempre numa linha, porque a letra encolhe para ele.
 */
export function CartaoDeSocio({
  nome,
  categoria,
  clube,
  className = "",
}: {
  nome: string;
  categoria: string;
  clube: { shortName: string; logoUrl?: string };
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const vazio = !nome.trim();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ajustar = () => {
      let tamanho = 19;
      el.style.fontSize = `${tamanho}px`;
      while (el.scrollWidth > el.clientWidth && tamanho > 12) {
        tamanho -= 0.5;
        el.style.fontSize = `${tamanho}px`;
      }
    };
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, [nome]);

  return (
    <div
      className={`relative flex aspect-[1.586] w-full flex-col overflow-hidden rounded-[10px] p-6 text-signal-on ${className}`}
      style={{
        background:
          "radial-gradient(130% 130% at 88% -10%, var(--signal-lift) 0%, transparent 58%), linear-gradient(152deg, var(--color-signal-strong) 0%, var(--signal-deep) 100%)",
        boxShadow: "0 24px 50px -26px color-mix(in oklab, var(--color-signal) 55%, black)",
      }}
      aria-hidden
    >
      {/* O estilhaço da página de adesão, um só, no canto de baixo. */}
      <span
        className="absolute -bottom-5 -right-[30px] h-[150px] w-[190px]"
        style={{ background: "rgb(var(--signal-on-rgb) / 0.08)", clipPath: "polygon(0 40%, 100% 0, 70% 100%)" }}
      />

      <div className="relative flex items-center justify-between gap-2.5">
        <Emblema logoUrl={clube.logoUrl} shortName={clube.shortName} size={32} />
        <span className="min-w-0 max-w-[22ch] truncate text-right text-[10px] uppercase tracking-[0.16em]" style={{ color: "rgb(var(--signal-on-rgb) / 0.85)" }}>
          {categoria}
        </span>
      </div>

      <p
        ref={ref}
        className={`relative mt-auto min-h-[1.2em] overflow-hidden text-ellipsis whitespace-nowrap ${vazio ? "font-normal" : "font-semibold uppercase tracking-[0.01em]"}`}
        style={vazio ? { color: "rgb(var(--signal-on-rgb) / 0.4)" } : undefined}
      >
        {vazio ? "O teu nome" : nome}
      </p>

      <div className="relative mt-2 flex items-end justify-between gap-3">
        <div>
          <p className="text-[9px] uppercase tracking-[0.18em]" style={{ color: "rgb(var(--signal-on-rgb) / 0.6)" }}>
            Sócio n.º
          </p>
          <p className="mt-1 text-[14px] font-semibold tracking-[0.16em] tabular">— — — —</p>
        </div>
        <p className="truncate text-[10.5px]" style={{ color: "rgb(var(--signal-on-rgb) / 0.72)" }}>
          {clube.shortName}
        </p>
      </div>
    </div>
  );
}

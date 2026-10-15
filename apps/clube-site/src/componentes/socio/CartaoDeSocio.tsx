"use client";

import { useLayoutEffect, useRef } from "react";
import { Emblema } from "@/componentes/Emblema";

/**
 * O cartão de sócio, a preencher-se enquanto a pessoa escreve. É o mesmo da
 * página `/ser-socio` da API: o emblema, a categoria, o nome e o número que só
 * existe depois de a direção aprovar.
 *
 * O nome cabe sempre numa linha: a letra encolhe para ele, meio pixel de cada
 * vez, até ao mínimo. Os triângulos são os estilhaços da página de adesão, na
 * tinta do clube.
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
      let tamanho = 22;
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
      className={`relative aspect-[1.586] w-full overflow-hidden rounded-[18px] bg-signal-strong text-signal-on shadow-[0_24px_48px_-20px_rgb(20_19_17/0.55),0_2px_6px_rgb(20_19_17/0.12)] ${className}`}
      aria-hidden
    >
      {/* Brilho e estilhaços: a cor do clube com relevo, sem depender de imagem nenhuma. */}
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgb(255_255_255/0.22)_0%,transparent_45%,rgb(0_0_0/0.12)_100%)]" />
      <svg className="absolute inset-0 size-full" viewBox="0 0 320 202" preserveAspectRatio="none">
        <polygon points="320,60 320,202 170,202" fill="currentColor" opacity="0.08" />
        <polygon points="230,202 320,120 320,202" fill="currentColor" opacity="0.08" />
      </svg>

      <div className="relative flex h-full flex-col justify-between p-[7%]">
        <div className="flex items-start justify-between gap-3">
          <span className="grid size-11 place-items-center">
            <Emblema logoUrl={clube.logoUrl} shortName={clube.shortName} size={40} />
          </span>
          <span className="max-w-[60%] truncate text-right text-[0.625rem] font-bold uppercase tracking-[0.18em] opacity-80">{categoria}</span>
        </div>

        <div className="min-w-0">
          <p
            ref={ref}
            className={`overflow-hidden whitespace-nowrap font-bold uppercase leading-tight tracking-wide ${vazio ? "opacity-55" : ""}`}
            style={{ fontVariationSettings: '"wdth" 88' }}
          >
            {vazio ? "O teu nome" : nome}
          </p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[0.5625rem] font-bold uppercase tracking-[0.18em] opacity-70">Sócio n.º</p>
              <p className="mt-1 font-bold tracking-[0.3em] opacity-90">— — — —</p>
            </div>
            <p className="truncate text-[0.6875rem] font-semibold opacity-80">{clube.shortName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

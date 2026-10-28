"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Foto } from "@/componentes/Foto";

/**
 * As fotografias de um produto, ao jeito das lojas de equipamento.
 *
 * Uma fila que se arrasta com o dedo (no telemóvel ocupa a largura toda do
 * ecrã); no computador, as miniaturas ao lado e as setas por cima. A fila é
 * a mesma nos dois: as miniaturas e as setas só a fazem andar. Com uma
 * fotografia só (ou nenhuma), é só a grande.
 */
export function Galeria({ imagens, nome }: { imagens: string[]; nome: string }) {
  const fila = useRef<HTMLUListElement>(null);
  const [atual, setAtual] = useState(0);
  const n = imagens.length;
  const fotos: (string | undefined)[] = n > 0 ? imagens : [undefined];

  const ir = (k: number) => {
    const el = fila.current;
    if (!el || n < 2) return;
    const alvo = (k + n) % n;
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: alvo * el.clientWidth, behavior: suave ? "smooth" : "auto" });
  };

  return (
    <div className="min-w-0 lg:flex lg:gap-4">
      {n > 1 && (
        <ul className="hidden w-20 shrink-0 flex-col gap-2 lg:flex" aria-label="Fotografias">
          {imagens.map((src, k) => (
            <li key={src + k}>
              <button
                type="button"
                onClick={() => ir(k)}
                aria-label={`Fotografia ${k + 1} de ${n}`}
                aria-current={k === atual ? "true" : undefined}
                className={`relative block aspect-[4/5] w-20 overflow-hidden bg-sunken transition-opacity after:absolute after:inset-0 after:border-2 after:transition-colors ${
                  k === atual ? "after:border-ink" : "opacity-70 after:border-transparent hover:opacity-100"
                }`}
              >
                <Foto src={src} alt="" sizes="80px" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative -mx-4 min-w-0 flex-1 sm:mx-0">
        <ul
          ref={fila}
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtual(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
          }}
          className="flex aspect-[4/5] snap-x snap-mandatory overflow-x-auto bg-sunken [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label={n > 1 ? `${nome}: ${n} fotografias` : undefined}
        >
          {fotos.map((src, k) => (
            <li key={(src ?? "sem") + k} className="relative h-full w-full shrink-0 snap-center">
              <Foto src={src} alt={k === 0 ? nome : `${nome}, fotografia ${k + 1}`} priority={k === 0} sizes="(min-width: 1024px) 640px, 100vw" />
            </li>
          ))}
        </ul>

        {n > 1 && (
          <>
            <div className="absolute bottom-5 right-5 hidden gap-2 lg:flex">
              {[
                { d: -1, l: "Fotografia anterior", I: ChevronLeft },
                { d: 1, l: "Fotografia seguinte", I: ChevronRight },
              ].map(({ d, l, I }) => (
                <button key={d} type="button" onClick={() => ir(atual + d)} aria-label={l} className="grid size-11 place-items-center rounded-full bg-canvas text-ink shadow-card transition hover:bg-ink hover:text-canvas">
                  <I size={20} aria-hidden />
                </button>
              ))}
            </div>
            {/* No telemóvel: uma barra por fotografia, a atual cheia. */}
            <div className="absolute inset-x-4 bottom-4 flex gap-1.5 lg:hidden" aria-hidden>
              {imagens.map((src, k) => (
                <span key={src + k} className={`h-[3px] flex-1 rounded-full transition-colors ${k === atual ? "bg-ink" : "bg-ink/20"}`} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

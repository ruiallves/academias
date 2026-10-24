"use client";

import { useState } from "react";
import { Foto } from "@/componentes/Foto";

/**
 * As fotografias de um produto: a grande, e por baixo as pequenas para
 * trocar. Com uma só (ou nenhuma), é só a grande, como antes.
 */
export function Galeria({ imagens, nome }: { imagens: string[]; nome: string }) {
  const [i, setI] = useState(0);
  const atual = imagens[Math.min(i, Math.max(0, imagens.length - 1))];
  return (
    <div>
      <div className="relative aspect-[9/11] overflow-hidden rounded-card bg-sunken">
        <Foto key={atual ?? "sem"} src={atual} alt={nome} priority sizes="(min-width: 1024px) 50vw, 100vw" className="" />
      </div>
      {imagens.length > 1 && (
        <ul className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none]" aria-label="Mais fotografias">
          {imagens.map((src, k) => (
            <li key={src + k} className="shrink-0">
              <button
                type="button"
                onClick={() => setI(k)}
                aria-label={`Fotografia ${k + 1} de ${imagens.length}`}
                aria-pressed={k === i}
                className={`relative block size-20 overflow-hidden rounded-control border-2 transition ${k === i ? "border-ink" : "border-transparent hover:border-line-strong"}`}
              >
                <Foto src={src} alt="" sizes="80px" className="" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

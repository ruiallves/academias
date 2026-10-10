"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Liga a entrada ao rolar: tudo o que tenha `data-reveal` ganha `="in"` ao
 * entrar no ecrã. Um observador por página, montado no layout, e voltado a
 * correr a cada navegação porque o App Router troca o conteúdo sem recarregar.
 *
 * Sem JavaScript o CSS deixa tudo invisível; por isso o `[data-reveal]` em
 * `globals.css` só esconde o que o observador vai mostrar, e em
 * `prefers-reduced-motion` nem esconde.
 */
export function Revelar() {
  const pathname = usePathname();

  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-reveal='in'])");
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.reveal = "in";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);

  return null;
}

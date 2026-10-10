"use client";

import { useRouter } from "next/navigation";
import { LayoutTemplate } from "lucide-react";
import { LAYOUTS, type Layout } from "@/dados/tipos";

const NOMES: Record<Layout, string> = { classico: "Clássico", porto: "Porto" };

/**
 * O interruptor de layout da pré-visualização. Grava o cookie e pede a
 * página outra vez: o proxy lê o cookie e reescreve para o outro layout.
 *
 * É uma ferramenta nossa e do clube durante a montagem do site. Em
 * produção, quando o clube tiver escolhido, sai daqui e fica só na consola.
 *
 * `sobre` diz em que fundo está: a faixa escura do clássico ou a barra
 * branca do porto.
 */
export function TrocarLayout({ atual, sobre = "escuro" }: { atual: Layout; sobre?: "escuro" | "claro" }) {
  const router = useRouter();

  const trocar = (l: Layout) => {
    document.cookie = `site-layout=${l}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    router.refresh();
  };

  const claro = sobre === "claro";

  return (
    <div
      role="group"
      aria-label="Layout do site"
      className={`inline-flex h-8 items-center gap-0.5 rounded-full border p-0.5 text-xs font-semibold ${
        claro ? "border-line-strong text-ink-2" : "border-night-line text-night-ink-2"
      }`}
    >
      <LayoutTemplate size={14} className="ml-1.5 mr-0.5 opacity-70" aria-hidden />
      {LAYOUTS.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={atual === l}
          onClick={() => trocar(l)}
          className={`h-7 rounded-full px-2.5 transition ${
            atual === l
              ? claro
                ? "bg-ink text-white"
                : "bg-white text-[#1a1917]"
              : claro
                ? "hover:text-ink"
                : "hover:text-white"
          }`}
        >
          {NOMES[l]}
        </button>
      ))}
    </div>
  );
}

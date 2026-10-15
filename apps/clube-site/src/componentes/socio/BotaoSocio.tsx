"use client";

import type { ComponentProps } from "react";
import { useAdesao } from "./Adesao";

/**
 * Um botão de "Ser sócio" / "Sócios". É um link para `/ser-socio` (a adesão
 * numa página do site), e com JavaScript abre a janela por cima da página
 * (`AdesaoNoSite`). Abrir noutro separador (Ctrl, Cmd, Shift, botão do meio)
 * continua a ir para a página.
 *
 * `onAbrir` corre antes de a janela abrir: o menu do telemóvel usa-o para se
 * fechar primeiro.
 */
export function BotaoSocio({ onAbrir, onClick, children, ...props }: ComponentProps<"a"> & { onAbrir?: () => void }) {
  const adesao = useAdesao();
  return (
    <a
      href="/ser-socio"
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (!adesao || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onAbrir?.();
        adesao.abrir(e.currentTarget);
      }}
    >
      {children}
    </a>
  );
}

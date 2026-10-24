"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Um botão de "Ser sócio" / "Sócios": um link para a página da adesão,
 * `/ser-socio`. A adesão vive sempre numa página do site (pedido do Rui a
 * 24/10/2026), nunca numa janela por cima.
 *
 * `onAbrir` corre ao carregar: o menu do telemóvel usa-o para se fechar.
 */
export function BotaoSocio({ onAbrir, onClick, children, href: _href, ...props }: ComponentProps<"a"> & { onAbrir?: () => void }) {
  return (
    <Link
      href="/ser-socio"
      {...props}
      onClick={(e) => {
        onClick?.(e);
        onAbrir?.();
      }}
    >
      {children}
    </Link>
  );
}

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variante = "clube" | "escuro" | "claro" | "contorno" | "contorno-claro";

const base =
  "inline-flex h-11 items-center justify-center gap-2 rounded-control px-5 text-[0.9375rem] font-semibold whitespace-nowrap transition-[background-color,color,border-color,transform] duration-200 ease-out active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50";

const variantes: Record<Variante, string> = {
  clube: "bg-signal-strong text-signal-on hover:brightness-110",
  escuro: "bg-ink text-canvas hover:opacity-90",
  claro: "bg-white text-ink hover:bg-sunken",
  contorno: "border border-line-strong text-ink hover:border-ink hover:bg-surface",
  "contorno-claro": "border border-white/30 text-white hover:border-white hover:bg-white/10",
};

export function BotaoLink({
  variante = "clube",
  className = "",
  children,
  ...props
}: ComponentProps<typeof Link> & { variante?: Variante; children: ReactNode }) {
  return (
    <Link className={`${base} ${variantes[variante]} ${className}`} {...props}>
      {children}
    </Link>
  );
}

export function Botao({
  variante = "clube",
  className = "",
  children,
  ...props
}: ComponentProps<"button"> & { variante?: Variante; children: ReactNode }) {
  return (
    <button type="button" className={`${base} ${variantes[variante]} ${className}`} {...props}>
      {children}
    </button>
  );
}

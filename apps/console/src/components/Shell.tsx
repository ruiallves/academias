import { useState, type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function Shell() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <main className="flex-1 overflow-y-auto">
        {/* Largura total. A sidebar já dá o enquadramento à esquerda; uma segunda
            moldura de margem no meio do ecrã só afastava as colunas de dados umas
            das outras. O ar vem do padding, não de um limite de largura. */}
        <div className="w-full px-6 py-6 xl:px-8 2xl:px-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/**
 * Cabeçalho de página. Título à esquerda, uma acção primária à direita — o padrão
 * das referências. `eyebrow` dá contexto sem gastar uma linha de título.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-group text-ink-4 uppercase">{eyebrow}</div>}
        <h1 className="text-page text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-body text-ink-3">{subtitle}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  );
}

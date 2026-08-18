import { NavLink, Outlet } from "react-router-dom";
import { Building2, FileClock, LayoutGrid, LogOut, TrendingUp } from "lucide-react";
import { signOut } from "@/lib/session";
import { cx } from "./primitives";
import type { Me } from "@/lib/types";

/**
 * A casca do painel.
 *
 * Navegação curta de propósito: quatro destinos. Um painel de dono não é um
 * produto de uso diário com dezanove ecrãs — é um sítio onde se entra para saber
 * como vai o negócio e resolver o que está mal.
 */
const NAV = [
  { to: "/", label: "Visão geral", icon: LayoutGrid, end: true },
  { to: "/academias", label: "Academias", icon: Building2 },
  { to: "/crescimento", label: "Crescimento", icon: TrendingUp },
  { to: "/registo", label: "Registo", icon: FileClock },
];

export function Shell({ me }: { me: Me }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <aside className="flex w-[212px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex h-14 items-center gap-2.5 border-b border-line px-3">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-[11px] font-bold text-white"
            style={{ background: "var(--color-signal)" }}
            aria-hidden
          >
            A
          </span>
          <div className="min-w-0">
            <div className="truncate text-body font-semibold text-ink">Academias</div>
            {/* Dizer "Plataforma" em todos os ecrãs é o que evita confundir este
                painel com a consola de um cliente. */}
            <div className="truncate text-[11px] text-ink-3">Plataforma</div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-2.5">
          <ul className="space-y-px">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cx(
                      "group flex h-8 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-body font-medium transition-colors duration-[120ms]",
                      isActive ? "bg-signal-soft text-signal-ink" : "text-ink-2 hover:bg-sunken hover:text-ink",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className={cx("size-4 shrink-0", isActive ? "text-signal" : "text-ink-3")} strokeWidth={1.75} />
                      {item.label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-line p-2">
          <div className="flex items-center gap-2.5 px-1.5 py-1">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold text-ink-2">
              {me.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-body font-medium text-ink">{me.name}</div>
              <div className="truncate text-[11px] text-ink-3">{me.role}</div>
            </div>
            <button type="button" onClick={signOut} className="ctl-ghost size-7 justify-center px-0" aria-label="Sair">
              <LogOut className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>

          {/*
            Sem MFA não há "ver como academia". Dito aqui e não escondido nas
            definições: é uma capacidade que falta, e quem entra deve sabê-lo.
          */}
          {!me.mfaEnabled && (
            <p className="mt-1.5 rounded-[var(--radius-control)] bg-[#fdf1dd] px-2.5 py-1.5 text-[11px] leading-relaxed text-[#8a5a12]">
              Sem autenticação de dois factores. O acesso de suporte a academias fica bloqueado.
            </p>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="w-full px-7 py-6 2xl:px-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-page text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-body text-ink-3">{subtitle}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  );
}

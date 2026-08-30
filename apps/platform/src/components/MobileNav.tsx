import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LogOut, Menu, X, type LucideIcon } from "lucide-react";
import { signOut } from "@/lib/session";
import { cx } from "./primitives";
import type { Me } from "@/lib/types";

export type MobileNavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: number };

/**
 * A navegação do painel no telemóvel.
 *
 * Abaixo de 768px a barra lateral esconde-se e entram uma barra de cima (a
 * marca) e uma de baixo (os quatro destinos principais e um "Menu" que abre a
 * lista completa numa folha). Cada peça tem `md:hidden`: acima disso é como se
 * este ficheiro não existisse, e o `Shell` é exactamente o que era.
 *
 * O contador dos tickets acompanha — é a razão de a plataforma estar no
 * telemóvel: saber, de onde se estiver, se chegou alguma coisa.
 */
export function MobileTopBar() {
  return (
    <header className="mobile-top flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line bg-surface px-3 md:hidden">
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-[11px] font-bold text-white"
        style={{ background: "var(--color-signal)" }}
        aria-hidden
      >
        A
      </span>
      <div className="min-w-0">
        <div className="truncate text-body font-semibold text-ink">Academias</div>
        <div className="truncate text-[11px] text-ink-3">Plataforma</div>
      </div>
    </header>
  );
}

export function MobileTabBar({ items, me }: { items: MobileNavItem[]; me: Me }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const principais = items.slice(0, 4);

  useEffect(() => setMenuOpen(false), [pathname]);

  const naBarra = principais.some((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)));

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className="mobile-tabs fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="grid h-16 grid-cols-5">
          {principais.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    "flex h-full w-full flex-col items-center justify-center gap-1 text-[10.5px] font-medium",
                    isActive ? "text-signal-ink" : "text-ink-3",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cx("relative flex h-7 w-12 items-center justify-center rounded-full", isActive && "bg-signal-soft")}>
                      <item.icon className="size-[20px]" strokeWidth={1.75} />
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="absolute -top-0.5 right-1 min-w-4 rounded-full bg-signal-strong px-1 text-center text-[9.5px] leading-4 font-semibold text-signal-on tabular">
                          {item.badge}
                        </span>
                      )}
                    </span>
                    <span className="max-w-full truncate px-1">{item.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              className={cx(
                "flex h-full w-full flex-col items-center justify-center gap-1 text-[10.5px] font-medium",
                !naBarra || menuOpen ? "text-signal-ink" : "text-ink-3",
              )}
            >
              <span className={cx("flex h-7 w-12 items-center justify-center rounded-full", (!naBarra || menuOpen) && "bg-signal-soft")}>
                <Menu className="size-[20px]" strokeWidth={1.75} />
              </span>
              Menu
            </button>
          </li>
        </ul>
      </nav>

      {menuOpen && <MenuSheet items={items} me={me} onClose={() => setMenuOpen(false)} />}
    </>
  );
}

function MenuSheet({ items, me, onClose }: { items: MobileNavItem[]; me: Me; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = antes;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-ink/30 md:hidden" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="mobile-sheet flex max-h-[88dvh] w-full flex-col rounded-t-[20px] bg-surface shadow-[var(--shadow-pop)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="px-4 pt-3 pb-2">
          <span className="mx-auto block h-1 w-10 rounded-full bg-line-strong" aria-hidden />
        </div>
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="text-panel text-ink">Menu</span>
          <button type="button" onClick={onClose} className="ctl-ghost size-9 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <ul className="overflow-hidden rounded-[14px] border border-line">
            {items.map((item) => (
              <li key={item.to} className="border-b border-line last:border-0">
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cx("flex min-h-12 items-center gap-3 px-3 text-body font-medium", isActive ? "bg-signal-soft text-signal-ink" : "text-ink")
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className={cx("size-[18px] shrink-0", isActive ? "text-signal-ink" : "text-signal")} strokeWidth={1.75} />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="shrink-0 rounded-full bg-signal-strong px-1.5 py-px text-[11px] font-semibold text-signal-on tabular">
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center gap-3 rounded-[14px] border border-line px-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold text-ink-2">
              {me.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-body font-medium text-ink">{me.name}</div>
              <div className="truncate text-[11px] text-ink-3">{me.role}</div>
            </div>
            <button type="button" onClick={signOut} className="ctl-outline h-9">
              <LogOut className="size-3.5" strokeWidth={1.75} />
              Sair
            </button>
          </div>

          {!me.mfaEnabled && (
            <p className="mt-3 rounded-[var(--radius-control)] bg-[#fdf1dd] px-3 py-2 text-[11px] leading-relaxed text-[#8a5a12]">
              Sem autenticação de dois factores. O acesso de suporte a academias fica bloqueado.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

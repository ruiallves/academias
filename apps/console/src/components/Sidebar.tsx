import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { Bell, ChevronsUpDown, LogOut, PanelLeft, Search, Check } from "@/lib/icons";
import { navFor, SETTINGS_ITEM, type NavItem } from "@/lib/nav";
import { permissionsOf } from "@/lib/permissions";
import { academy, navCounts } from "@/lib/api";
import { signOut } from "@/lib/session";
import { PROFILES, ROLE_LABEL, useSession, type ProfileKey } from "@/session";
import { cx, Monogram } from "./primitives";

export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { session } = useSession();
  const groups = navFor(session);
  const counts = navCounts(session);

  // Um item precisa de correspondência exacta quando existe outro item do menu
  // aninhado por baixo dele — senão os dois acendem-se ao mesmo tempo. Derivado
  // do próprio menu, para não haver uma bandeira manual a esquecer-se.
  const all = groups.flatMap((g) => g.items.map((i) => i.to));
  const nested = new Set(all.filter((to) => all.some((other) => other !== to && other.startsWith(`${to}/`))));
  const showSettings = permissionsOf(session).has(SETTINGS_ITEM.requires);

  return (
    <aside
      className={cx(
        "flex h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200",
        collapsed ? "w-[60px]" : "w-[236px]",
      )}
      style={{ transitionTimingFunction: "var(--ease-out)" }}
    >
      <AcademyHeader collapsed={collapsed} onToggle={onToggle} />

      {!collapsed && <SearchField />}

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {groups.map((group, i) => (
          <div key={group.label ?? `g${i}`} className={i === 0 ? "" : "mt-5"}>
            {group.label && !collapsed && (
              <div className="px-2.5 pb-1.5 text-group text-ink-4 uppercase">{group.label}</div>
            )}
            {group.label && collapsed && <div className="mx-2.5 mb-2 border-t border-line" />}
            <ul className="space-y-px">
              {group.items.map((item) => (
                <li key={item.to}>
                  <Item item={item} collapsed={collapsed} badge={item.badge?.(counts)} exact={nested.has(item.to)} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {showSettings && (
        <div className="px-2 pb-2">
          <Item item={SETTINGS_ITEM} collapsed={collapsed} />
        </div>
      )}

      <UserCard collapsed={collapsed} />
    </aside>
  );
}

/* -------------------------------------------------------------------------- */

function AcademyHeader({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  // Recolhida, a própria marca é o botão de expandir — evita dois alvos de 32px
  // empilhados numa coluna de 60px.
  if (collapsed) {
    return (
      <div className="flex h-14 items-center justify-center border-b border-line">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expandir navegação"
          className="group relative flex size-7 items-center justify-center overflow-hidden rounded-[7px] text-[11px] font-bold text-white"
          style={{ background: "var(--color-signal)" }}
        >
          <span className="transition-opacity duration-[120ms] group-hover:opacity-0">LC</span>
          <PanelLeft
            className="absolute size-4 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100"
            strokeWidth={1.75}
          />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-14 items-center gap-2 border-b border-line pr-2 pl-3">
      {/* A marca é da academia, não nossa. Somos a tecnologia por trás. */}
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-[11px] font-bold text-white"
        style={{ background: "var(--color-signal)" }}
        aria-hidden
      >
        LC
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-semibold text-ink">{academy.shortName}</div>
        <div className="truncate text-[11px] text-ink-3">Época 2026/27</div>
      </div>

      <button type="button" className="ctl-ghost relative size-8 justify-center px-0" aria-label="Notificações">
        <Bell className="size-4" strokeWidth={1.75} />
        <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-risk ring-2 ring-surface" />
      </button>

      <button
        type="button"
        onClick={onToggle}
        className="ctl-ghost size-8 justify-center px-0"
        aria-label="Recolher navegação"
      >
        <PanelLeft className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}

function SearchField() {
  const ref = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K. Numa academia com 120 atletas, procurar é mais rápido que navegar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="px-2 py-2.5">
      <div className="group relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
        <input
          ref={ref}
          type="search"
          placeholder="Procurar atleta, equipa…"
          className="h-8 w-full rounded-[var(--radius-control)] bg-sunken pr-11 pl-8 text-meta text-ink placeholder:text-ink-4 focus:bg-surface focus:ring-1 focus:ring-line-strong focus:outline-none"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 font-mono text-[10px] text-ink-4">⌘K</kbd>
      </div>
    </div>
  );
}

function Item({
  item,
  collapsed,
  badge,
  exact,
}: {
  item: NavItem;
  collapsed: boolean;
  badge?: number;
  exact?: boolean;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      // `end` só onde é preciso: "/atletas" deve continuar aceso na ficha de um
      // atleta, mas "/clinico" não pode acender-se em "/clinico/consultas", que é
      // um irmão e não um filho. O cálculo está em `nested`.
      end={exact || item.to === "/"}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cx(
          "group relative flex h-[34px] items-center rounded-[var(--radius-control)] text-body font-medium transition-colors duration-[120ms]",
          collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
          isActive ? "bg-signal-soft text-signal-ink" : "text-ink-2 hover:bg-sunken hover:text-ink",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cx("size-4 shrink-0", isActive ? "text-signal" : "text-ink-3 group-hover:text-ink-2")}
            strokeWidth={1.75}
          />
          {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
          {badge !== undefined && badge > 0 && (
            <span
              className={cx(
                "tabular",
                collapsed
                  ? "absolute top-1 right-1 size-1.5 rounded-full bg-risk"
                  : "rounded-full bg-risk-soft px-1.5 py-px text-[11px] font-semibold text-risk",
              )}
            >
              {!collapsed && badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Cartão do utilizador com selector de perfil.
 *
 * O selector é uma peça de demonstração: trocar de Direção para Equipa técnica
 * reconstrói a navegação, o âmbito dos dados e os ecrãs a partir das permissões.
 * Em produção este menu é conta / academia / terminar sessão.
 */
function UserCard({ collapsed }: { collapsed: boolean }) {
  const { session, profile, setProfile } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative border-t border-line p-2">
      {open && (
        <div
          className="absolute bottom-[calc(100%-4px)] left-2 z-20 w-[228px] rounded-[var(--radius-panel)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
          role="menu"
        >
          <div className="px-2.5 py-1.5 text-group text-ink-4 uppercase">Ver a consola como</div>
          {(Object.keys(PROFILES) as ProfileKey[]).map((key) => {
            const p = PROFILES[key];
            return (
              <button
                key={key}
                type="button"
                role="menuitemradio"
                aria-checked={profile === key}
                onClick={() => {
                  setProfile(key);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left transition-colors duration-[120ms] hover:bg-sunken"
              >
                <Monogram name={p.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-[11px] text-ink-3">{ROLE_LABEL[p.role]}</span>
                </span>
                {profile === key && <Check className="size-3.5 shrink-0 text-signal" strokeWidth={2} />}
              </button>
            );
          })}

          {/* Sair leva de volta à página do clube — não a um ecrã de login
              genérico. Cada academia tem o seu endereço, e é lá que se volta a
              entrar. */}
          <div className="mt-1 border-t border-line pt-1">
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left transition-colors duration-[120ms] hover:bg-sunken"
            >
              <span className="flex size-6 shrink-0 items-center justify-center text-ink-3">
                <LogOut className="size-3.5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">Terminar sessão</span>
                <span className="block truncate text-[11px] text-ink-3">Voltar a {academy.shortName}</span>
              </span>
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx(
          "flex w-full items-center rounded-[var(--radius-control)] transition-colors duration-[120ms] hover:bg-sunken",
          collapsed ? "justify-center p-1" : "gap-2.5 p-1.5",
        )}
      >
        <Monogram name={session.name} self />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-body font-medium text-ink">{session.name}</span>
              <span className="block truncate text-[11px] text-ink-3">{ROLE_LABEL[session.role]}</span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
          </>
        )}
      </button>
    </div>
  );
}

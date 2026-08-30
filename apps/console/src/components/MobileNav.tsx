import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Menu } from "lucide-react";
import { Bell, LogOut, Search, X } from "@/lib/icons";
import { navFor, SETTINGS_ITEM, type NavItem } from "@/lib/nav";
import { permissionsOf } from "@/lib/permissions";
import { academy, listAthletes, listTeams, navCounts, teamById } from "@/lib/api";
import { teamAgeLabel } from "@/lib/team-age";
import { useUnreadCount } from "@/lib/notifications";
import { signOut } from "@/lib/session";
import { ROLE_LABEL, useSession } from "@/session";
import { cx, Monogram } from "./primitives";
import { ClubMark } from "./ClubMark";
import { NotificationsPanel } from "./NotificationsPanel";
import { TrialBadge } from "./TrialBadge";

/**
 * A navegação no telemóvel.
 *
 * ## O que isto é, e o que não é
 *
 * A consola foi desenhada para um portátil: uma barra lateral de 236px com vinte
 * destinos. Num telemóvel isso não cabe, e encolhê-la era ficar com uma coluna
 * de ícones sem nome. Em vez disso, abaixo de 768px a barra lateral esconde-se
 * (`max-md:hidden` no `Sidebar`) e entram três peças:
 *
 *  - **a barra de cima** — a marca do clube, o sino e a pesquisa;
 *  - **a barra de baixo** — os quatro destinos mais usados, sempre ao alcance
 *    do polegar, e um botão "Menu";
 *  - **a folha do menu** — a navegação completa, com os mesmos grupos, os mesmos
 *    contadores e a mesma conta de utilizador da barra lateral.
 *
 * Tudo o que existe no computador existe aqui. O que muda é o sítio.
 *
 * ## Nada disto toca no desktop
 *
 * Cada peça tem `md:hidden`. Acima de 768px é como se este ficheiro não
 * existisse — a barra lateral e o `Shell` são exactamente os que eram.
 *
 * ## Os quatro da barra de baixo
 *
 * Não são fixos: são os primeiros quatro de uma lista de preferência que a
 * pessoa **tem** (a permissão e os menus do papel já filtraram). Um treinador
 * fica com Visão geral, Atletas, Calendário e Presenças; a direcção com
 * Mensalidades no lugar das Presenças se não as tiver. O resto está a um toque,
 * no "Menu".
 */

/** Por esta ordem, os primeiros quatro que a pessoa tiver. */
const PREFERIDOS = ["overview", "athletes", "calendar", "attendance", "matches", "fees", "teams", "training"];

const BAR_H = "64px";

/* -------------------------------------------------------------------------- */

export function MobileTopBar() {
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const unread = useUnreadCount();

  return (
    <>
      <header className="mobile-top flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-surface pr-1.5 pl-3 md:hidden">
        <ClubMark size={28} radius={7} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-semibold text-ink">{academy.shortName}</div>
          <div className="truncate text-[11px] text-ink-3">Época 2026/27</div>
        </div>

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label="Procurar"
          className="ctl-ghost size-10 justify-center px-0"
        >
          <Search className="size-[18px]" strokeWidth={1.75} />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setNotifOpen((v) => !v)}
            aria-label="Notificações"
            aria-expanded={notifOpen}
            className="ctl-ghost relative size-10 justify-center px-0"
          >
            <Bell className="size-[18px]" strokeWidth={1.75} />
            {unread > 0 && (
              <span className="absolute top-2 right-2 size-1.5 rounded-full bg-signal-strong ring-2 ring-surface" />
            )}
          </button>
          {/*
            O painel abre para a esquerda: o sino está no canto direito, e o
            `left-0` com que ele nasce (desenhado para a barra lateral) o
            atirava para fora do ecrã. `mobile-notif` reposiciona-o em CSS.
          */}
          {notifOpen && (
            <div className="mobile-notif">
              <NotificationsPanel onClose={() => setNotifOpen(false)} />
            </div>
          )}
        </div>
      </header>

      {searchOpen && <MobileSearch onClose={() => setSearchOpen(false)} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */

export function MobileTabBar() {
  const { session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  const groups = navFor(session);
  const counts = navCounts(session);
  const items = groups.flatMap((g) => g.items);

  const principais = useMemo(() => {
    const porChave = new Map(items.map((i) => [i.key, i]));
    return PREFERIDOS.map((k) => porChave.get(k)).filter((i): i is NavItem => Boolean(i)).slice(0, 4);
  }, [items]);

  // Fecha a folha ao navegar — o destino já está no ecrã por baixo dela.
  useEffect(() => setMenuOpen(false), [pathname]);

  /*
   * Um destino que não está na barra acende o "Menu": a pessoa está em Sócios,
   * a barra não tem Sócios, e ficar com as cinco casas apagadas dizia que ela
   * não estava em lado nenhum.
   */
  const naBarra = principais.some((i) => (i.to === "/" ? pathname === "/" : pathname.startsWith(i.to)));

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className="mobile-tabs fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="grid grid-cols-5" style={{ height: BAR_H }}>
          {principais.map((item) => (
            <li key={item.key}>
              <Tab item={item} badge={item.badge?.(counts)} />
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
              <span
                className={cx(
                  "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                  !naBarra || menuOpen ? "bg-signal-soft" : "",
                )}
              >
                <Menu className="size-[20px]" strokeWidth={1.75} />
              </span>
              Menu
            </button>
          </li>
        </ul>
      </nav>

      {menuOpen && <MobileMenuSheet onClose={() => setMenuOpen(false)} />}
    </>
  );
}

function Tab({ item, badge }: { item: NavItem; badge?: number }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        cx(
          "flex h-full w-full flex-col items-center justify-center gap-1 text-[10.5px] font-medium",
          isActive ? "text-signal-ink" : "text-ink-3",
        )
      }
    >
      {({ isActive }) => (
        <>
          {/*
            A pílula por trás do ícone é o "onde estou" — a mesma linguagem do
            item activo da barra lateral (fundo suave + tinta do clube), só que
            em forma de polegar.
          */}
          <span
            className={cx(
              "relative flex h-7 w-12 items-center justify-center rounded-full transition-colors",
              isActive && "bg-signal-soft",
            )}
          >
            <Icon className="size-[20px]" strokeWidth={1.75} />
            {badge !== undefined && badge > 0 && (
              <span className="absolute -top-0.5 right-1 min-w-4 rounded-full bg-signal-strong px-1 text-center text-[9.5px] leading-4 font-semibold text-signal-on tabular">
                {badge}
              </span>
            )}
          </span>
          <span className="max-w-full truncate px-1">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A folha com a navegação completa.
 *
 * Sobe do fundo, como as folhas nativas do telemóvel — é o gesto que a mão já
 * conhece. Lá dentro está a mesma coisa que a barra lateral: os grupos, os
 * contadores, o "beta", as definições, a conta e o período de teste.
 */
function MobileMenuSheet({ onClose }: { onClose: () => void }) {
  const { session } = useSession();
  const groups = navFor(session);
  const counts = navCounts(session);
  const showSettings = permissionsOf(session).has(SETTINGS_ITEM.requires);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    // O fundo não rola por baixo da folha.
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
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
          <span className="mx-auto h-1 w-10 rounded-full bg-line-strong" aria-hidden />
        </div>
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="text-panel text-ink">Menu</span>
          <button type="button" onClick={onClose} className="ctl-ghost size-9 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {groups.map((group, i) => (
            <section key={group.label ?? `g${i}`} className={cx(i > 0 && "mt-4")}>
              {group.label && (
                <h3 className="px-2 pb-1.5 text-group font-semibold text-ink uppercase">{group.label}</h3>
              )}
              <ul className="overflow-hidden rounded-[14px] border border-line">
                {group.items.map((item) => (
                  <li key={item.key} className="border-b border-line last:border-0">
                    <SheetItem item={item} badge={item.badge?.(counts)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {showSettings && (
            <section className="mt-4">
              <ul className="overflow-hidden rounded-[14px] border border-line">
                <li>
                  <SheetItem item={SETTINGS_ITEM} />
                </li>
              </ul>
            </section>
          )}

          <section className="mt-4">
            <div className="flex items-center gap-3 rounded-[14px] border border-line px-3 py-2.5">
              <Monogram name={session.name} self />
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium text-ink">{session.name}</div>
                <div className="truncate text-[11px] text-ink-3">{ROLE_LABEL[session.role]}</div>
              </div>
              <button type="button" onClick={signOut} className="ctl-outline h-9" aria-label="Terminar sessão">
                <LogOut className="size-3.5" strokeWidth={1.75} />
                Sair
              </button>
            </div>
            <TrialBadge
              status={academy.status}
              trialEndsAt={academy.trialEndsAt}
              createdAt={academy.createdAt}
              collapsed={false}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

function SheetItem({ item, badge }: { item: NavItem; badge?: number }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        cx(
          "flex min-h-12 items-center gap-3 px-3 text-body font-medium",
          isActive ? "bg-signal-soft text-signal-ink" : "text-ink",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={cx("size-[18px] shrink-0", isActive ? "text-signal-ink" : "nav-icon")} strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.beta && (
            <span className="shrink-0 rounded-[4px] bg-sunken px-1 py-px text-[9px] leading-[14px] font-semibold tracking-wide text-ink-3 uppercase">
              beta
            </span>
          )}
          {badge !== undefined && badge > 0 && (
            <span className="shrink-0 rounded-full bg-signal-strong px-1.5 py-px text-[11px] font-semibold text-signal-on tabular">
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

/* -------------------------------------------------------------------------- */

type Resultado = { kind: "athlete" | "team"; id: string; name: string; sub: string };

/**
 * A pesquisa, em ecrã inteiro.
 *
 * A mesma lista da barra lateral — atletas e equipas no âmbito de quem procura —
 * mas com o campo a ocupar o ecrã e o teclado a abrir logo. Num telemóvel
 * escrever três letras é mais rápido do que qualquer menu.
 */
function MobileSearch({ onClose }: { onClose: () => void }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const results = useMemo<Resultado[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const atletas = listAthletes(session)
      .filter((a) => a.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((a): Resultado => ({ kind: "athlete", id: a.id, name: a.name, sub: teamById(a.teamId)?.name ?? "Sem equipa" }));
    const equipas = listTeams(session)
      .filter((t) => t.name.toLowerCase().includes(q))
      .slice(0, 4)
      .map((t): Resultado => ({ kind: "team", id: t.id, name: t.name, sub: teamAgeLabel(t.maxAge) }));
    return [...equipas, ...atletas];
  }, [query, session]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface md:hidden">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Search className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Atleta ou equipa…"
          className="h-11 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-4"
        />
        <button type="button" onClick={onClose} className="ctl-ghost h-9">
          Cancelar
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {results.map((r) => (
          <li key={`${r.kind}-${r.id}`} className="border-b border-line">
            <button
              type="button"
              onClick={() => {
                navigate(r.kind === "athlete" ? `/atletas/${r.id}` : `/equipas/${r.id}`);
                onClose();
              }}
              className="flex min-h-12 w-full items-center gap-3 px-4 text-left"
            >
              <Monogram name={r.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">{r.name}</span>
                <span className="block truncate text-[11px] text-ink-3">{r.sub}</span>
              </span>
            </button>
          </li>
        ))}
        {query.trim() && results.length === 0 && (
          <li className="px-4 py-8 text-center text-meta text-ink-3">Nada com esse nome.</li>
        )}
      </ul>
    </div>
  );
}

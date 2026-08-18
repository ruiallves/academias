import { createContext, useContext, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Bell, CalendarDays, Home, User, Wallet } from "lucide-react";
import { academy, children, guardian, payments, notices, type Child } from "@/data";
import { Avatar, cx } from "@/ui";
import Today from "@/screens/Today";
import Agenda from "@/screens/Agenda";
import Payments from "@/screens/Payments";
import Athlete from "@/screens/Athlete";
import Notifications from "@/screens/Notifications";

/* -------------------------------------------------------------------------- */
/* Educando activo                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Uma família com dois filhos na academia é o caso normal, não a excepção. O
 * seletor está no topo, sempre visível, e todo o ecrã responde a ele — em vez de
 * duplicar listas com o nome do filho repetido em cada linha.
 */
const ChildContext = createContext<{ child: Child; setChild: (id: string) => void } | null>(null);

export function useChild() {
  const ctx = useContext(ChildContext);
  if (!ctx) throw new Error("useChild fora do provider");
  return ctx;
}

export default function App() {
  const [childId, setChild] = useState(children[0].id);
  const value = useMemo(
    () => ({ child: children.find((c) => c.id === childId)!, setChild }),
    [childId],
  );

  return (
    <ChildContext.Provider value={value}>
      <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col">
        <Header />

        <main className="flex-1 px-4 pb-[calc(104px+env(safe-area-inset-bottom))]">
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/pagamentos" element={<Payments />} />
            <Route path="/atleta" element={<Athlete />} />
            <Route path="/notificacoes" element={<Notifications />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        <TabBar />
      </div>
    </ChildContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */

function Header() {
  const { child, setChild } = useChild();
  const navigate = useNavigate();
  const unread = notices.length + payments.filter((p) => p.status === "overdue" || p.status === "pending").length;

  return (
    <header className="sticky top-0 z-30 bg-canvas/85 px-4 pt-[calc(10px+env(safe-area-inset-top))] pb-2 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <span
          className="flex size-9 items-center justify-center rounded-[11px] text-[13px] font-bold text-white shadow-[var(--shadow-soft)]"
          style={{ background: "var(--color-signal)" }}
          aria-hidden
        >
          {academy.mark}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[15px] font-semibold text-ink">{academy.shortName}</span>
          <span className="block truncate text-[12px] text-ink-3">{guardian.name}</span>
        </span>
        <button type="button" onClick={() => navigate("/notificacoes")} className="icon-btn" aria-label="Notificações">
          <Bell className="size-[22px]" strokeWidth={1.75} />
          {unread > 0 && (
            <span className="absolute top-2 right-2.5 flex min-w-[16px] items-center justify-center rounded-full bg-risk px-1 text-[10px] font-bold text-white ring-2 ring-canvas">
              {unread}
            </span>
          )}
        </button>
      </div>

      {/* Seletor de educando — avatares, não texto. Dois filhos cabem sem menus. */}
      {children.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5">
          {children.map((c) => {
            const active = c.id === child.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setChild(c.id)}
                aria-pressed={active}
                className={cx(
                  "inline-flex shrink-0 items-center gap-2 rounded-full py-1 pr-4 pl-1 transition-all duration-200",
                  active ? "bg-ink text-white" : "bg-surface text-ink-2 shadow-[var(--shadow-soft)]",
                )}
              >
                <Avatar name={c.name} size={28} />
                <span className="text-[13px] font-semibold">{c.firstName}</span>
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
}

/* -------------------------------------------------------------------------- */

const TABS = [
  { to: "/", label: "Hoje", icon: Home },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/pagamentos", label: "Pagar", icon: Wallet },
  { to: "/atleta", label: "Atleta", icon: User },
];

/**
 * Nav flutuante em pílula.
 *
 * Escura, arredondada, a pairar acima do conteúdo — não uma barra colada ao vidro.
 * O separador activo abre-se num comprimido claro com o nome ao lado; os outros
 * ficam só ícone. É a gramática das melhores apps de consumo: sabes onde estás
 * sem ler, e o toque tem um alvo confortável.
 */
function TabBar() {
  const owing = payments.some((p) => p.status === "overdue" || p.status === "pending");

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[calc(14px+env(safe-area-inset-bottom))]">
      <ul
        className="pointer-events-auto flex items-center gap-1 rounded-full bg-ink/95 p-1.5 backdrop-blur-xl"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cx(
                  "relative flex h-11 items-center rounded-full transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                  isActive ? "gap-2 bg-white px-4 text-ink" : "px-3 text-white/55 active:text-white",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <Icon className="size-[22px]" strokeWidth={isActive ? 2 : 1.75} />
                    {to === "/pagamentos" && owing && !isActive && (
                      <span className="absolute -top-1 -right-1.5 size-2.5 rounded-full bg-risk ring-2 ring-ink" />
                    )}
                  </span>
                  {isActive && <span className="text-[14px] font-semibold whitespace-nowrap">{label}</span>}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

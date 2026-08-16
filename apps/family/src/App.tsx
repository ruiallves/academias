import { createContext, useContext, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Bell, CalendarDays, Home, User, Wallet } from "lucide-react";
import { academy, children, guardian, payments, type Child } from "@/data";
import { Avatar, cx } from "@/ui";
import Today from "@/screens/Today";
import Agenda from "@/screens/Agenda";
import Payments from "@/screens/Payments";
import Athlete from "@/screens/Athlete";

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
      <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col bg-canvas">
        <Header />

        <main className="flex-1 px-4 pt-1 pb-[calc(76px+env(safe-area-inset-bottom))]">
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/pagamentos" element={<Payments />} />
            <Route path="/atleta" element={<Athlete />} />
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
  const unpaid = payments.filter((p) => p.status === "overdue" || p.status === "pending").length;

  return (
    <header className="sticky top-0 z-10 bg-canvas/90 px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-2 backdrop-blur-md">
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="flex size-8 items-center justify-center rounded-[9px] text-[12px] font-bold text-white"
          style={{ background: "var(--color-signal)" }}
          aria-hidden
        >
          {academy.mark}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ink">{academy.shortName}</span>
          <span className="block truncate text-meta text-ink-3">{guardian.name}</span>
        </span>
        <button type="button" className="relative flex size-10 items-center justify-center rounded-full text-ink-2 active:bg-sunken" aria-label="Notificações">
          <Bell className="size-5" strokeWidth={1.75} />
          {unpaid > 0 && <span className="absolute top-2 right-2.5 size-2 rounded-full bg-risk ring-2 ring-canvas" />}
        </button>
      </div>

      {/* Seletor de educando. Dois filhos cabem em dois botões — sem menus. */}
      {children.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {children.map((c) => {
            const active = c.id === child.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setChild(c.id)}
                aria-pressed={active}
                className={cx(
                  "inline-flex shrink-0 items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-1.5 transition-colors duration-[120ms]",
                  active ? "border-transparent bg-ink text-surface" : "border-line bg-surface text-ink-2",
                )}
              >
                <Avatar name={c.name} size={26} />
                <span className="text-meta font-semibold">{c.firstName}</span>
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
 * Barra de separadores fixa. Quatro destinos, sempre os mesmos, sempre no mesmo
 * sítio — é o contrato de uma app de consumo. O ponto vermelho em "Pagar" só
 * aparece quando há mesmo algo por pagar.
 */
function TabBar() {
  const owing = payments.some((p) => p.status === "overdue" || p.status === "pending");

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[480px] border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
      <ul className="flex">
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cx(
                  "relative flex h-[62px] flex-col items-center justify-center gap-1 transition-colors duration-[120ms]",
                  isActive ? "text-signal" : "text-ink-3",
                )
              }
            >
              <span className="relative">
                <Icon className="size-[22px]" strokeWidth={1.75} />
                {to === "/pagamentos" && owing && (
                  <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-risk ring-2 ring-surface" />
                )}
              </span>
              <span className="text-[11px] font-semibold">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

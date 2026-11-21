import { NavLink, Outlet } from "react-router-dom";
import { cx } from "@/components/primitives";
import type { Me } from "@/lib/types";

/**
 * A área comercial: Hoje, Clubes, Reuniões e o mês.
 *
 * Para o comercial, as quatro secções estão no menu lateral (é só isso que ele
 * vê no painel), e esta moldura não acrescenta nada. Para o dono e os
 * administradores há uma entrada "Comercial" no menu e as secções aparecem aqui
 * em abas.
 */
export const SECCOES = [
  { to: "/comercial", label: "Hoje", end: true },
  { to: "/comercial/clubes", label: "Clubes" },
  { to: "/comercial/reunioes", label: "Reuniões" },
  { to: "/comercial/mes", label: "Mês" },
];

export default function Comercial({ me }: { me: Me }) {
  return (
    <>
      {me.role !== "COMERCIAL" && (
        <nav aria-label="Secções comerciais" className="mb-5 flex gap-5 overflow-x-auto border-b border-line">
          {SECCOES.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              end={s.end}
              className={({ isActive }) =>
                cx(
                  "-mb-px flex h-10 shrink-0 items-center border-b-2 text-body font-medium transition-colors duration-150",
                  isActive ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink",
                )
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
      )}
      <Outlet />
    </>
  );
}

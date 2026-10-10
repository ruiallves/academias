"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import type { Clube } from "@/dados/tipos";
import { ATALHOS, NAV } from "./nav";
import { Redes } from "./Redes";

/**
 * O menu do telemóvel. Abre por baixo do cabeçalho, fecha ao navegar e com
 * Escape, e enquanto está aberto a página por trás não rola.
 */
export function MenuMovel({ clube, topo = "top-[calc(2.5rem+4.25rem)]" }: { clube: Clube; topo?: string }) {
  const [aberto, setAberto] = useState(false);
  const pathname = usePathname();

  useEffect(() => setAberto(false), [pathname]);

  useEffect(() => {
    if (!aberto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = anterior;
      window.removeEventListener("keydown", onKey);
    };
  }, [aberto]);

  return (
    <div className="ml-auto lg:hidden">
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls="menu-movel"
        aria-label={aberto ? "Fechar menu" : "Abrir menu"}
        onClick={() => setAberto((v) => !v)}
        className="grid size-11 place-items-center rounded-control text-ink transition hover:bg-sunken"
      >
        {aberto ? <X size={22} /> : <Menu size={22} />}
      </button>

      {aberto && (
        <div
          id="menu-movel"
          className={`fixed inset-x-0 ${topo} bottom-0 z-40 overflow-y-auto bg-surface`}
        >
          <nav aria-label="Principal" className="container-site py-4">
            <ul className="divide-y divide-line">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className="display block py-4 text-2xl text-ink">
                    {n.label}
                  </Link>
                </li>
              ))}
              {ATALHOS.map((a) => (
                <li key={a.href}>
                  <Link href={a.href} className="display block py-4 text-2xl text-ink">
                    {a.label}
                  </Link>
                </li>
              ))}
            </ul>
            <a
              href={clube.membershipUrl}
              className="mt-6 flex h-12 items-center justify-center rounded-control bg-signal-strong font-semibold text-signal-on"
            >
              Ser sócio
            </a>
            <div className="mt-6 rounded-card bg-night p-2 text-night-ink">
              <Redes social={clube.social} shortName={clube.shortName} />
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}

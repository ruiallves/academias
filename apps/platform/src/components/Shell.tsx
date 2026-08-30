import { useEffect } from "react";
import { useApi } from "@/lib/query";
import type { CSSProperties } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Building2, FileClock, Inbox, LayoutGrid, LogOut, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { signOut } from "@/lib/session";
import { cx } from "./primitives";
import { BusyProvider, BusyScreen } from "./Busy";
import type { Me } from "@/lib/types";

/**
 * A casca do painel.
 *
 * Navegação curta de propósito: cinco destinos. Um painel de dono não é um
 * produto de uso diário com dezanove ecrãs — é um sítio onde se entra para saber
 * como vai o negócio e resolver o que está mal.
 *
 * A ordem da barra é a ordem do negócio, e lê-se da esquerda para a direita:
 * quem já paga, quem escreveu a perguntar, quem talvez venha a pagar, como está
 * a correr, e o que se fez.
 *
 * "Tickets" fica antes de "Contactos" porque é a etapa anterior — o que chega
 * pelo formulário do site, ainda por triar. Só o que alguém decidir que é mesmo
 * um negócio passa a contacto, e é por isso que são duas listas e não uma: a
 * maior parte de quem escreve nunca vai ser cliente, e a lista de trabalho não
 * pode encher-se de curiosos. Ver `TicketsService`, do lado do servidor.
 */
type NavItem = { to: string; label: string; icon: typeof LayoutGrid; end?: boolean };

const NAV: NavItem[] = [
  { to: "/", label: "Visão geral", icon: LayoutGrid, end: true },
  { to: "/academias", label: "Academias", icon: Building2 },
  { to: "/tickets", label: "Tickets", icon: Inbox },
  { to: "/contactos", label: "Contactos", icon: Users },
  { to: "/crescimento", label: "Crescimento", icon: TrendingUp },
  { to: "/registo", label: "Registo", icon: FileClock },
];

/**
 * "Administradores" só aparece a quem pode lá fazer alguma coisa.
 *
 * O servidor já recusa um `ADMIN` ou `SUPPORT` que tente entrar por esta porta
 * (`@PlatformRoles("OWNER")`) — escondê-la também no menu não é a fronteira de
 * segurança, é só poupar a quem não é dono um destino que abre para lhe dizer
 * que não pode estar lá.
 */
const OWNER_NAV: NavItem = { to: "/administradores", label: "Administradores", icon: ShieldCheck };

export function Shell({ me }: { me: Me }) {
  const nav = me.role === "OWNER" ? [...NAV, OWNER_NAV] : NAV;

  /*
   * Os pedidos por tratar, ao lado de "Tickets".
   *
   * ## Porque é que o menu tem de o dizer
   *
   * Um pedido do site chega sem ninguém estar à espera dele. O email avisa quem
   * o recebe — mas quem já está dentro da plataforma não tem o email à frente, e
   * a única forma de saber que chegou alguma coisa era abrir a página e ver.
   * Um contador no menu responde a isso de relance, de qualquer ecrã.
   *
   * ## Volta a perguntar
   *
   * De minuto a minuto, e só com o separador à vista: a plataforma fica aberta
   * o dia todo num monitor ao lado, e um número que só é verdade à hora do
   * arranque é pior do que não estar lá. Uma leitura por minuto de um `count()`
   * não custa nada; o que custava era abrir a página para saber.
   */
  const tickets = useApi<{ n: number }>("/tickets/por-tratar");
  const { reload: relerTickets } = tickets;
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") relerTickets();
    }, 60_000);
    return () => clearInterval(t);
  }, [relerTickets]);
  const porTratar = tickets.data?.n ?? 0;

  return (
    /*
     * `--nav-w` é a largura do menu, publicada para a camada de carregamento a
     * poder medir: o disco centra-se no conteúdo, e não na janela. Aqui é fixa
     * (o menu do painel não encolhe), mas fica na mesma como variável para o
     * ficheiro `Busy.tsx` ser o mesmo nas duas aplicações.
     */
    <div className="flex h-dvh overflow-hidden bg-canvas" style={{ "--nav-w": "212px" } as CSSProperties}>
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
            {nav.map((item) => (
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
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>

                      {/*
                        Cheio, e não uma pastilha suave: por cima da linha activa
                        o fundo já é `signal-soft`, e um contador suave
                        desaparecia lá — precisamente quando se está na página.
                        Zero não se mostra: um "0" permanente ensina a ignorar a
                        coluna onde o número aparece.
                      */}
                      {item.to === "/tickets" && porTratar > 0 && (
                        <span className="shrink-0 rounded-full bg-signal-strong px-1.5 py-px text-[11px] font-semibold text-signal-on tabular">
                          {porTratar}
                        </span>
                      )}
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

      {/* `relative` para a camada de carregamento. Ver `BusyScreen`. */}
      <main className="relative flex-1 overflow-y-auto">
        <BusyProvider>
          <BusyScreen>
            <Outlet />
          </BusyScreen>
        </BusyProvider>
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

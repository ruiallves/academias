import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Session } from "@/lib/permissions";
import { useStore } from "@/lib/store";

/**
 * Quem está a usar a consola.
 *
 * Vem do servidor — papel, âmbito e concessões saem de `/api/bootstrap`, que os
 * deriva da `Membership` e do `TeamStaff`. Não há aqui nenhuma decisão sobre
 * permissões: isto só transporta o que o servidor já decidiu.
 *
 * Antes havia três perfis fixos e um selector na barra lateral para se poder ver a
 * consola pelos olhos de cada papel. Saíram com os dados de demonstração: com
 * autenticação a sério, trocar de papel sem trocar de conta era uma mentira — e
 * das perigosas, porque dava a sensação de estar a testar permissões quando o
 * servidor continuava a responder como a mesma pessoa. Para ver a consola como um
 * treinador, entra-se como o treinador.
 */

type Ctx = { session: Session };

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const store = useStore();

  const value = useMemo(() => {
    const me = store.me;

    /*
     * Sem identidade não há sessão.
     *
     * Antes havia aqui um `?? "STAFF"` como valor por omissão, e era um erro sério:
     * uma falha a carregar o perfil passava a consola a funcionar com um papel que
     * ninguém atribuiu — sem aviso, e parecendo normal. Um papel por omissão numa
     * camada de permissões é sempre a decisão errada; se não se sabe quem é a
     * pessoa, tem de rebentar aqui e não seguir em frente.
     */
    if (!me) throw new Error("Sessão sem perfil — a academia não chegou a carregar.");

    const base: Session = {
      userId: me.userId,
      name: me.name,
      role: me.role,
      // A ficha desta pessoa no quadro de staff — é o que liga a sessão às
      // excepções de acesso definidas na ficha dela.
      staffId: me.membershipId,
      grants: me.grants as Session["grants"],
      // As retiradas vêm do servidor, no `me` do bootstrap — é a fonte da verdade
      // do que o próprio utilizador pode. As excepções locais (o painel "Acesso")
      // são para configurar **outra** pessoa; a minha própria sessão não depende
      // delas.
      revokes: me.revokes as Session["revokes"],
      /*
       * O papel da academia. Substitui o mapa em código quando existe — é o que
       * faz um papel criado ontem valer hoje sem um deploy pelo meio.
       */
      roleId: me.roleId,
      roleName: me.roleName,
      rolePermissions: me.permissions?.length ? (me.permissions as Session["rolePermissions"]) : undefined,
      navKeys: me.navKeys ?? [],
      // Sem âmbito para quem vê a academia toda; com equipas para quem não vê.
      scope: me.scope,
    };

    return { session: base };
  }, [store.me]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession fora de <SessionProvider>");
  return ctx;
}

/**
 * Nomes de papel, não de pessoa — por isso são neutros. "Direção" serve a Helena e
 * serve o próximo diretor; "Diretora" obrigaria a gerir género no modelo de papéis,
 * que é o sítio errado para essa informação.
 */
export const ROLE_LABEL: Record<string, string> = {
  OWNER: "Presidência",
  DIRECTOR: "Direção",
  COORDINATOR: "Coordenação",
  COACH: "Equipa técnica",
  MEDICAL: "Departamento clínico",
  SCOUT: "Departamento de scouting",
  STAFF: "Staff",
  GUARDIAN: "Encarregado de educação",
  ATHLETE: "Atleta",
};

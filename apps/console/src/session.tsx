import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@/lib/permissions";
import { teams } from "@/data/demo";

/**
 * Sessão do utilizador.
 *
 * Em produção vem do Supabase Auth + membership. Aqui é estado local, e o selector
 * de papel na sidebar existe para que se possa ver, lado a lado, como a mesma
 * aplicação muda de forma consoante as permissões — a navegação, os ecrãs e os
 * números são todos derivados daqui.
 */

const DIRECTOR: Session = {
  userId: "u_dir",
  name: "Helena Sá Pereira",
  role: "DIRECTOR",
};

const COACH: Session = {
  userId: "u_coach",
  name: "Rui Machado",
  role: "COACH",
  // O âmbito é o que o distingue de um diretor com os mesmos verbos.
  scope: { teamIds: teams.filter((t) => t.coachIds.includes("c1")).map((t) => t.id) },
};

/**
 * Departamento clínico. Sem `scope`: vê a academia toda, porque uma lesão não
 * conhece escalões (ver `isAcademyWide`).
 */
const MEDICAL: Session = {
  userId: "u_med",
  name: "Inês Carvalho Dias",
  role: "MEDICAL",
};

export const PROFILES = { DIRECTOR, COACH, MEDICAL } as const;
export type ProfileKey = keyof typeof PROFILES;

type Ctx = {
  session: Session;
  profile: ProfileKey;
  setProfile: (p: ProfileKey) => void;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<ProfileKey>("DIRECTOR");
  const value = useMemo(() => ({ session: PROFILES[profile], profile, setProfile }), [profile]);
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
  STAFF: "Staff",
  GUARDIAN: "Encarregado de educação",
  ATHLETE: "Atleta",
};

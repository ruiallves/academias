import { createContext, useContext } from "react";
import type { Sport } from "@/data/types";
import type { ModuleKey, SportProfile } from "@/lib/sports";

/**
 * A modalidade em que a página está.
 *
 * As páginas da Área técnica (biblioteca, sistemas, situações) não sabem de que
 * modalidade são — perguntam aqui. É o que permite à mesma página ser
 * "Modelos de jogo" no futebol e "Sistemas de jogo" no basquetebol sem um `if`
 * por modalidade: o perfil traz os rótulos, o vocabulário e os caminhos.
 *
 * Vive num ficheiro só seu, sem componentes, para as páginas o importarem sem
 * puxarem a rota que as monta (`SportArea`), que por sua vez as importa a elas.
 */
export type SportAreaContextValue = {
  sport: Sport;
  profile: SportProfile;
  /** A página de entrada da modalidade. */
  home: string;
  /** O caminho de um módulo — ou de um item dele. */
  path: (module: ModuleKey, id?: string) => string;
};

export const SportAreaContext = createContext<SportAreaContextValue | null>(null);

export function useSportArea(): SportAreaContextValue {
  const ctx = useContext(SportAreaContext);
  if (!ctx) throw new Error("useSportArea só funciona dentro de /modalidades/:sportId");
  return ctx;
}

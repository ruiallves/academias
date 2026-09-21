import { apiDelete, apiGet } from "@/lib/http";
import { subirFotografia } from "@/lib/socio";

/**
 * A área de atleta — o que só o próprio faz.
 *
 * O resto da área é a da família com outro chapéu (ver `x-app: athlete` em
 * `lib/area.ts`): os treinos, os jogos, as avaliações e os relatórios chegam
 * pelos mesmos endpoints, estreitados pelo servidor ao próprio. Aqui fica o
 * que não existe na família: a fotografia da própria ficha e o plano de
 * treino que o treinador partilhou.
 */

/** A fotografia do próprio. Mesmo caminho da do sócio — ver `subirFotografia`. */
export const uploadFotoAtleta = (file: File) => subirFotografia("/api/atleta/foto", file);

export const removerFotoAtleta = () => apiDelete<{ ok: true }>("/api/atleta/foto");

/** O plano de um treino, como o treinador o abriu aos atletas. */
export type PlanoPartilhado = {
  sessionId: string;
  teamName: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  coachName: string | null;
  sharedAt: string;
  objective: string | null;
  objectives: string[];
  sessionType: string | null;
  intensity: number | null;
  material: string | null;
  planNotes: string | null;
  blocks: {
    id: string;
    order: number;
    name: string;
    durationMin: number;
    category: string | null;
    objective: string | null;
    intensity: number | null;
    players: number | null;
    space: string | null;
    material: string | null;
    notes: string | null;
    exerciseName: string | null;
  }[];
};

export const planoPartilhado = (sessionId: string) =>
  apiGet<PlanoPartilhado>(`/api/training/sessions/${encodeURIComponent(sessionId)}/plano-partilhado`);

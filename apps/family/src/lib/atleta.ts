import { apiDelete, apiGet, apiPost } from "@/lib/http";
import { checkFoto, FotoError } from "@/lib/socio";

/**
 * A área de atleta — o que só o próprio faz.
 *
 * O resto da área é a da família com outro chapéu (ver `x-app: athlete` em
 * `lib/area.ts`): os treinos, os jogos, as avaliações e os relatórios chegam
 * pelos mesmos endpoints, estreitados pelo servidor ao próprio. Aqui fica o
 * que não existe na família: a fotografia da própria ficha e o plano de
 * treino que o treinador partilhou.
 */

/** A fotografia do próprio — o mesmo caminho em duas fases da do sócio. */
export async function uploadFotoAtleta(file: File): Promise<string | null> {
  const problema = checkFoto(file);
  if (problema) throw new FotoError(problema);

  const signed = await apiPost<{ url: string; token: string; key: string }>("/api/atleta/foto/upload", {
    contentType: file.type,
  });
  const res = await fetch(signed.url, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
      ...(signed.token ? { Authorization: `Bearer ${signed.token}` } : {}),
    },
    body: file,
  });
  if (!res.ok) throw new FotoError("Não foi possível carregar a fotografia.");

  const { photoUrl } = await apiPost<{ photoUrl: string | null }>("/api/atleta/foto", { key: signed.key });
  return photoUrl;
}

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

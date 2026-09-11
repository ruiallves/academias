import { apiDelete, apiPost } from "@/lib/http";

/**
 * A família avisa que o atleta não vai a um treino.
 *
 * ## O gesto
 *
 * É o irmão do que já existia para os jogos (`convocatoria.ts`), e faltava na
 * metade que acontece mais vezes: um jogo é ao sábado, um treino é três vezes
 * por semana. O pai que sabe na segunda que o filho tem consulta na quarta não
 * tinha por onde o dizer, e o treinador contava cabeças no relvado.
 *
 * ## Só a ausência é um acto
 *
 * Não há nada para confirmar: num treino vai o plantel todo, e o silêncio é
 * presença. Por isso não existe o par "vai/não vai" da convocatória — existe um
 * aviso, que se dá e se retira. Avisar exige motivo, pela mesma razão de sempre:
 * "não vai" sem mais nada deixa o treinador a saber menos do que sabia.
 *
 * ## Onde o aviso vai parar
 *
 * Ao registo de presenças do treinador: quem avisou aparece-lhe já marcado como
 * falta justificada, com o motivo escrito. Não é um recado que morre numa caixa
 * — é o que poupa o gesto a quem fecha a folha.
 *
 * O atleta vai no corpo e não no endereço porque a autorização é "este atleta é
 * meu": um pai com dois filhos no mesmo escalão avisa por cada um, e o treino é
 * o mesmo. Ver `AcademyService.avisarAusencia`.
 */
export const avisarAusencia = (sessionId: string, athleteId: string, reason: string) =>
  apiPost<{ sessionId: string; athleteId: string; reason: string; noticedAt: string }>(
    `/api/sessions/${sessionId}/ausencia`,
    { athleteId, reason },
  );

/** Afinal vai — o aviso desaparece. */
export const retirarAviso = (sessionId: string, athleteId: string) =>
  apiDelete<{ sessionId: string; athleteId: string; removed: boolean }>(
    `/api/sessions/${sessionId}/ausencia/${athleteId}`,
  );

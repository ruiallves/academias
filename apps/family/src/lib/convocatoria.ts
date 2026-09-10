import { apiPost } from "@/lib/http";

/**
 * A resposta da família a uma convocatória.
 *
 * ## O gesto
 *
 * O pai vê que o filho está convocado para sábado e sabe que ele não vai — tem
 * uma prova, está doente, está fora. Até aqui a única forma de o dizer era o
 * WhatsApp do treinador, que é exactamente o que este produto existe para
 * acabar; o treinador descobria no sábado de manhã, com um lugar a menos e sem
 * tempo de chamar outro.
 *
 * ## Assume-se que vai
 *
 * Não responder **não é recusar**. O silêncio conta como presença, porque é o
 * que acontece em quase todos os casos. Só a recusa é um acto — e por isso leva
 * motivo obrigatório: "não vai" sem mais nada deixa quem monta a equipa sem
 * saber se procura substituto ou se telefona a perguntar se está tudo bem.
 *
 * O servidor impõe a mesma regra, e a base também (ver a migração
 * `20260912120000_convocatoria_com_logistica_e_resposta`).
 *
 * ## O atleta vai no corpo, não no endereço
 *
 * Porque a autorização é "este atleta é meu" e não "este jogo é meu": um pai
 * com dois filhos no mesmo escalão responde por cada um deles, e o jogo é o
 * mesmo. Ver `MatchesService.responderConvocatoria`.
 */
export const responderConvocatoria = (
  matchId: string,
  athleteId: string,
  resposta: { going: boolean; reason?: string },
) =>
  apiPost<{ matchId: string; athleteId: string; status: string; declineReason: string | null }>(
    `/api/matches/${matchId}/convocatoria/resposta`,
    { athleteId, going: resposta.going, ...(resposta.reason ? { reason: resposta.reason } : {}) },
  );

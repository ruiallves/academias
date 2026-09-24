import { apiPost } from "@/lib/http";

/**
 * A resposta a uma consulta que o clube pediu para confirmar.
 *
 * O irmão de `responderConvocatoria`: "vai" ou "não vai", e a recusa leva
 * motivo, para o departamento clínico saber se remarca. Quem responde é quem a
 * consulta diz (o encarregado ou o atleta); o servidor recusa os outros. Ver
 * `ClinicalService.responder`.
 */
export const responderConsulta = (id: string, resposta: { going: boolean; reason?: string }) =>
  apiPost<{ id: string; reply: string; declineReason: string | null }>(`/api/clinical/${id}/resposta`, {
    going: resposta.going,
    ...(resposta.reason ? { reason: resposta.reason } : {}),
  });

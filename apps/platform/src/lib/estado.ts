import type { AcademyStatus } from "@/lib/types";

/**
 * Em que pé está a relação comercial com um clube.
 *
 * ## Porque é que não basta o `status` da academia
 *
 * Porque `Academy.status` não responde a esta pergunta. Uma academia nasce em
 * `SETUP` e nunca sai de lá sozinha: a única coisa que escreve nessa coluna é o
 * botão de desactivar e reactivar. O painel mostrava "Em montagem" a clubes que
 * trabalham há meses, e o cartão do topo dizia "0 em avaliação" com toda a
 * gente a experimentar.
 *
 * O estado comercial vive em dois sítios, e são precisos os dois:
 *
 *  - a **subscrição**, que diz se o clube paga. É o que o MRR usa;
 *  - o **fim do trial**, que diz se a avaliação ainda corre. É preciso porque a
 *    maioria dos clubes não tem subscrição nenhuma ("sem plano" é a opção por
 *    omissão ao criar), e contar só subscrições deixava-os invisíveis.
 *
 * As regras aqui são as mesmas da função `app.platform_overview()`, à letra.
 * Se uma mudar, muda a outra: a lista e o cartão do topo a contradizerem-se é
 * pior do que os dois estarem errados da mesma maneira.
 */
export type EstadoComercial = "A_PAGAR" | "EM_FALTA" | "AVALIACAO" | "POR_DECIDIR" | "FECHADA";

export function estadoComercial(clube: {
  status: AcademyStatus;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
}): EstadoComercial {
  /* Fechado ganha a tudo: um clube desactivado não é um cliente em avaliação. */
  if (clube.status === "CANCELLED") return "FECHADA";
  if (clube.subscriptionStatus === "PAST_DUE") return "EM_FALTA";
  if (clube.subscriptionStatus === "ACTIVE") return "A_PAGAR";
  if (clube.trialEndsAt && new Date(clube.trialEndsAt) > new Date()) return "AVALIACAO";
  return "POR_DECIDIR";
}

export const ESTADO_LABEL: Record<EstadoComercial, string> = {
  A_PAGAR: "A pagar",
  EM_FALTA: "Pagamento falhado",
  AVALIACAO: "Avaliação",
  POR_DECIDIR: "Por decidir",
  FECHADA: "Cancelada",
};

/**
 * "Por decidir" fica em `signal` e não em `neutral`: é a única linha desta
 * tabela que pede uma acção. O trial acabou e ninguém decidiu nada, e é a esse
 * que se liga hoje.
 */
export const ESTADO_TOM: Record<EstadoComercial, "neutral" | "ok" | "warn" | "risk" | "signal"> = {
  A_PAGAR: "ok",
  EM_FALTA: "risk",
  AVALIACAO: "warn",
  POR_DECIDIR: "signal",
  FECHADA: "neutral",
};

/** Paga (ou devia estar a pagar). É o que distingue receita de experiência. */
export const temReceita = (e: EstadoComercial) => e === "A_PAGAR" || e === "EM_FALTA";

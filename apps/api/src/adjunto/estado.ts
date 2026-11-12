/**
 * Se o Assistente IA aparece neste clube: a regra num sítio só.
 *
 * Usada por `GET /api/adjunto/estado` e pelo arranque da consola
 * (`AcademyService.bootstrap`). O arranque leva-a para a consola desenhar a
 * barra de baixo já certa: antes só se perguntava depois de a barra estar no
 * ecrã, e no telemóvel aparecia o Calendário na casa do meio e só depois o
 * robô por cima.
 *
 * Em desenvolvimento aparece mesmo sem `OPENAI_API_KEY`, para se ver a
 * interface; o primeiro pedido responde com o erro que explica o que falta.
 * Em produção, sem chave não há botão: um robô que não responde é pior do que
 * nenhum.
 */
export type EstadoDoAssistente = { ligado: boolean; voz: boolean; semChave: boolean };

export function estadoDoAssistente(adjuntoEnabled: boolean, comChave: boolean): EstadoDoAssistente {
  const emDesenvolvimento = process.env.NODE_ENV !== "production";
  return { ligado: (comChave || emDesenvolvimento) && adjuntoEnabled, voz: comChave, semChave: !comChave };
}

/** A chave existe? A mesma leitura que o `OpenAiClient` faz ao arrancar. */
export function temChaveDoModelo(chave: string | undefined): boolean {
  return !!chave?.trim();
}

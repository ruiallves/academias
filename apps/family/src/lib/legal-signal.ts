/**
 * O aviso de que o servidor recusou um pedido por haver termos por aceitar.
 *
 * ## Porque é que isto existe
 *
 * O gate corre à entrada, mas os documentos podem ser publicados com a app já
 * aberta — e a partir daí **todos** os pedidos levam 403 com o código
 * `LEGAL_ACCEPTANCE_REQUIRED`. Sem este aviso acontecia o pior dos dois mundos:
 * o cliente HTTP recarregava a página às cegas (e uma recarga que volte a cair
 * no mesmo erro é um ciclo), e o arranque tratava o 403 como "esta conta não é
 * de encarregado" — a mensagem errada, no ecrã errado, sem saída.
 *
 * Agora o cliente HTTP avisa, o gate ouve e volta a perguntar ao servidor o que
 * falta. Quem tem de aceitar vê os documentos; mais nada se mexe.
 *
 * Vive num módulo próprio para não fechar um ciclo de importações: `lib/http.ts`
 * avisa, `screens/LegalGate.tsx` ouve, e `lib/legal.ts` — que importa o `http` —
 * fica de fora disto.
 */
export const LEGAL_REQUIRED_CODE = "LEGAL_ACCEPTANCE_REQUIRED";

const EVENTO = "academia:legal-required";

/** O cliente HTTP viu o código na resposta. */
export function legalRequired(): void {
  window.dispatchEvent(new CustomEvent(EVENTO));
}

/** O gate quer ser avisado. Devolve a função que cancela a subscrição. */
export function onLegalRequired(fn: () => void): () => void {
  window.addEventListener(EVENTO, fn);
  return () => window.removeEventListener(EVENTO, fn);
}

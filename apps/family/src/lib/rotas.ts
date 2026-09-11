/**
 * Para onde é que uma notificação leva.
 *
 * ## O problema
 *
 * A rota vem do servidor, guardada no `payload` da notificação, e foi escrita ao
 * longo de meses por quem estava a criar cada tipo de aviso. Nem todas
 * correspondem a uma página desta app:
 *
 *   `/avisos`        nunca existiu aqui — o router mandava-a para a inicial, e
 *                    tocar num aviso da academia levava a lado nenhum
 *   `/socio/quotas`  é da área de sócio, que não é uma rota: é outra vista da
 *                    mesma app, escolhida no arranque (ver `lib/contexts`)
 *   `/ai/analises/…` é da consola, e chega aqui se um treinador tiver a app
 *
 * E as rotas antigas **ficam gravadas**: uma notificação de Março continua a
 * dizer `/avisos` depois de o servidor passar a escrever outra coisa. Corrigir
 * só o servidor deixava o histórico partido para sempre.
 *
 * ## A decisão
 *
 * O que se reconhece, navega. O que não se reconhece **não fica clicável** — e
 * é melhor assim: um cartão que não reage diz "não há para onde ir", enquanto um
 * cartão que leva à página inicial diz "enganaste-te no sítio", que é mentira e
 * gasta a paciência de quem tentou.
 */

/** As páginas que esta app tem. `/evento/…` trata-se à parte, por ser variável. */
const PAGINAS = new Set(["/", "/agenda", "/pagamentos", "/atleta", "/notificacoes", "/perfil"]);

/** O que o servidor escreveu, e o que isso quer dizer hoje. */
const ANTIGAS: Record<string, string> = {
  /* Os avisos da academia leem-se por inteiro na lista de notificações. */
  "/avisos": "/notificacoes",
};

export function rotaDaNotificacao(payload: unknown): string | null {
  const bruta = (payload as { route?: unknown } | null)?.route;
  if (typeof bruta !== "string" || bruta.trim() === "") return null;

  const rota = ANTIGAS[bruta] ?? bruta;
  if (PAGINAS.has(rota)) return rota;
  // `/evento/treino/:id` e `/evento/jogo/:id` — ver `screens/Evento`.
  if (/^\/evento\/(treino|jogo)\/[\w-]+$/.test(rota)) return rota;

  return null;
}

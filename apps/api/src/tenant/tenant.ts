/**
 * De que clube é este pedido.
 *
 * Uma origem por clube: `fafe.academias.pt` é o Fafe, `cdloureiro.academias.pt` é
 * o CD Loureiro, e as duas são o **mesmo** processo Node no Railway. O domínio não
 * escolhe a aplicação — só diz ao DNS para onde mandar o pedido. Quem escolhe o
 * que responde é o caminho, dentro do Nest.
 *
 * ## Porque é que o domínio tem de ser dito, e não adivinhado
 *
 * A primeira versão disto tratava **qualquer** host com três ou mais rótulos como
 * um clube: `api.academias.pt` resolvia para a academia "api", e
 * `academias-api.up.railway.app` para "academias-api". Todos os pedidos morriam em
 * `Academia "api" não encontrada` no instante em que a API ganhou um subdomínio
 * próprio — que é exactamente o que acontece ao pô-la no Railway.
 *
 * `TENANT_DOMAIN` resolve-o: só um subdomínio **desse** domínio é um clube.
 * Qualquer outro host — o da API, o do Railway, um túnel de desenvolvimento,
 * `localhost` — não é tenant nenhum e segue outro caminho. Sem a variável
 * definida, nada é tratado como tenant: falha para o lado seguro, porque adivinhar
 * aqui é adivinhar de quem são os dados.
 */

/**
 * Subdomínios que **nunca** são um clube.
 *
 * A mesma lista que o `PlatformService` recusa ao registar uma academia — se um
 * slug não pode ser criado com este nome, um host com este nome também não pode
 * ser lido como tenant.
 */
export const RESERVED_HOSTS = new Set([
  "www",
  "api",
  "admin",
  "app",
  "platform",
  "static",
  "assets",
  "cdn",
  "mail",
]);

/** O slug do clube contido num `Host`, ou `null` se aquele host não for de um clube. */
export function tenantFromHost(rawHost: string | undefined): string | null {
  const host = (rawHost ?? "").split(":")[0].trim().toLowerCase();
  const domain = (process.env.TENANT_DOMAIN ?? "").trim().toLowerCase();
  if (!host || !domain) return null;
  if (!host.endsWith(`.${domain}`)) return null;

  const sub = host.slice(0, -(domain.length + 1));
  // Só o primeiro nível: `fafe.academias.pt` é um clube, `x.y.academias.pt` não.
  if (!sub || sub.includes(".")) return null;
  if (RESERVED_HOSTS.has(sub)) return null;

  return sub;
}

/** Onde o middleware deixa o slug, para quem vier a seguir não ter de o recalcular. */
export type TenantRequest = { tenantSlug?: string | null };

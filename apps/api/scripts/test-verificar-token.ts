/**
 * "Não presta" e "não consegui ver" são respostas diferentes.
 *
 * ## O que aconteceu
 *
 * As pessoas perdiam a sessão do nada, na consola e na app, sem padrão que se
 * visse. Uma das causas estava aqui: qualquer falha a verificar um token virava
 * 401, incluindo a de não se conseguir ir buscar as chaves públicas ao Supabase
 * — que o servidor volta a pedir de dez em dez minutos. Um segundo de rede má
 * nesse instante e todos os pedidos levavam 401, as apps renovavam, voltavam a
 * levar 401, e punham a pessoa na rua com a sessão boa.
 *
 * ## O que este teste prova
 *
 * Com um servidor de chaves de mentira que se liga e desliga:
 *
 *  - um token mau é sempre 401, com as chaves à mão ou sem elas;
 *  - um token bom continua a passar quando as chaves deixam de se conseguir ir
 *    buscar, verificado com as últimas que vieram;
 *  - sem chave nenhuma em reserva, a resposta é 503 e nunca 401;
 *  - e em caso nenhum passa um token que não se verificou.
 *
 * Uso: npm run test:verificar-token --workspace @academia/api
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from "jose";
import { SupabaseJwtService } from "../src/auth/supabase-jwt.service";

let ok = 0;
let bad = 0;
const check = (label: string, cond: unknown, detalhe = "") => {
  if (cond) {
    ok++;
    console.log("  OK    " + label);
  } else {
    bad++;
    console.log("  FALHA " + label + (detalhe ? " — " + detalhe : ""));
  }
};

/* -------------------------------------------------------------------------- */
/* Um Supabase de mentira: só o endereço das chaves, com interruptor           */
/* -------------------------------------------------------------------------- */

type Chave = { kid: string; privada: KeyLike; publica: Record<string, unknown> };
async function novaChave(kid: string): Promise<Chave> {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  return { kid, privada: privateKey, publica: { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" } };
}

const k1 = await novaChave("k1");
const k2 = await novaChave("k2");
const intrusa = await novaChave("k1"); // o mesmo `kid`, outra chave: assinatura falsa

let publicadas: Chave[] = [k1];
let modo: "ok" | "erro" = "ok";
let pedidos = 0;

const servidor = createServer((req, res) => {
  pedidos++;
  if (modo === "erro" || req.url !== "/auth/v1/.well-known/jwks.json") {
    res.writeHead(503).end("em baixo");
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ keys: publicadas.map((k) => k.publica) }));
});
await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
const config = { getOrThrow: () => base } as unknown as ConfigService;

const token = (chave: Chave, opts: { exp?: string | number; aud?: string } = {}) =>
  new SignJWT({ email: "direcao@lifeclub.pt" })
    .setProtectedHeader({ alg: "ES256", kid: chave.kid })
    .setSubject("utilizador-1")
    .setIssuer(`${base}/auth/v1`)
    .setAudience(opts.aud ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(chave.privada);

/** O que `verify` fez: o utilizador, ou o estado HTTP com que recusou. */
async function tentar(servico: SupabaseJwtService, t: string): Promise<string> {
  try {
    return (await servico.verify(t)).authId;
  } catch (e) {
    if (e instanceof UnauthorizedException) return "401";
    if (e instanceof ServiceUnavailableException) return "503";
    return "erro inesperado: " + (e as Error).message;
  }
}

/**
 * Faz passar o tempo para o `jose`, e só para ele.
 *
 * A cache das chaves mede a idade com `Date.now()`; a validade dos tokens é
 * conferida com `new Date()`, que não passa por aqui. Adiantar um sem o outro é
 * o que deixa pôr as chaves "velhas" com tokens ainda dentro da validade.
 */
const agoraReal = Date.now;
let avanco = 0;
Date.now = () => agoraReal() + avanco;
const passam = (minutos: number) => (avanco += minutos * 60_000);

/* -------------------------------------------------------------------------- */

console.log("=== O servidor arranca com o Supabase em baixo ===");
{
  const s = new SupabaseJwtService(config);
  modo = "erro";
  check("sem chaves nenhumas, um token bom leva 503 e não 401", (await tentar(s, await token(k1))) === "503");
  modo = "ok";
  check("quando as chaves voltam, o mesmo serviço passa a aceitar", (await tentar(s, await token(k1))) === "utilizador-1");
}

console.log("\n=== Com as chaves à mão ===");
const servico = new SupabaseJwtService(config);
check("um token bom passa", (await tentar(servico, await token(k1))) === "utilizador-1");
check("um token expirado é 401", (await tentar(servico, await token(k1, { exp: Math.floor(agoraReal() / 1000) - 60 }))) === "401");
check("uma assinatura falsa é 401", (await tentar(servico, await token(intrusa))) === "401");
check("um token de outra audiência é 401", (await tentar(servico, await token(k1, { aud: "anon" }))) === "401");
check("lixo é 401", (await tentar(servico, "isto.nao.e-um-token")) === "401");

console.log("\n=== As chaves fazem dez minutos e o Supabase não responde ===");
passam(11);
modo = "erro";
const antes = pedidos;
check("um token bom continua a passar, com as últimas chaves", (await tentar(servico, await token(k1))) === "utilizador-1");
check("e tentou-se mesmo ir buscá-las (a reserva não é um atalho)", pedidos > antes, `${pedidos - antes} pedidos`);
const depoisDaFalha = pedidos;
check("um token expirado continua a ser 401", (await tentar(servico, await token(k1, { exp: Math.floor(agoraReal() / 1000) - 60 }))) === "401");
check("uma assinatura falsa continua a ser 401", (await tentar(servico, await token(intrusa))) === "401");
check("uma chave que a reserva não conhece é 503: não se sabe, e não passa", (await tentar(servico, await token(k2))) === "503");
check("e não se volta a pedir as chaves a cada pedido logo a seguir a uma falha", pedidos === depoisDaFalha, `${pedidos - depoisDaFalha} pedidos a mais`);

console.log("\n=== O Supabase volta, com uma chave nova publicada ===");
modo = "ok";
publicadas = [k1, k2];
passam(1);
check("a chave nova é aceite sem reiniciar nada", (await tentar(servico, await token(k2))) === "utilizador-1");
check("e a antiga continua a valer", (await tentar(servico, await token(k1))) === "utilizador-1");

console.log("\n=== Uma chave que nunca foi publicada ===");
passam(1);
const desconhecida = await novaChave("k9");
check("com as chaves à mão, é 401", (await tentar(servico, await token(desconhecida))) === "401");

Date.now = agoraReal;
servidor.close();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

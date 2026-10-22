/**
 * O Turnstile do lado do servidor, contra a Cloudflare a sério, com as chaves
 * de teste que a própria Cloudflare publica (uma passa sempre, outra falha
 * sempre). Não usa chave nenhuma do Rui.
 *
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 *
 * Uso: npm run test:turnstile
 */
import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { TurnstileService } from "../src/common/turnstile.service";

const PASSA = "1x0000000000000000000000000000000AA";
const FALHA = "2x0000000000000000000000000000000AA";
const TOKEN_DE_TESTE = "XXXX.DUMMY.TOKEN.XXXX";

let ok = 0;
let falhas = 0;
const check = (rotulo: string, cond: boolean, detalhe = "") => {
  if (cond) {
    ok++;
    console.log(`  OK   ${rotulo}`);
  } else {
    falhas++;
    console.log(`  FALHA ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
};

const com = (segredo: string) => new TurnstileService({ get: (k: string) => (k === "TURNSTILE_SECRET_KEY" ? segredo : undefined) } as unknown as ConfigService);

async function resultado(p: Promise<void>): Promise<"passou" | "recusou" | string> {
  try {
    await p;
    return "passou";
  } catch (e) {
    return e instanceof BadRequestException ? "recusou" : String(e);
  }
}

async function main() {
  console.log("=== Turnstile ===");
  check("sem chave secreta: não pede nada", (await resultado(com("").exigir(undefined, "teste"))) === "passou");
  check("com chave: sem token, recusa", (await resultado(com(PASSA).exigir(undefined, "teste"))) === "recusou");
  check("com chave: token vazio, recusa", (await resultado(com(PASSA).exigir("", "teste"))) === "recusou");
  check("token aceite pela Cloudflare: passa", (await resultado(com(PASSA).exigir(TOKEN_DE_TESTE, "teste"))) === "passou");
  check("token recusado pela Cloudflare: recusa", (await resultado(com(FALHA).exigir(TOKEN_DE_TESTE, "teste"))) === "recusou");
  check("token enorme: recusa sem perguntar", (await resultado(com(PASSA).exigir("x".repeat(5000), "teste"))) === "recusou");
  console.log(`\n${falhas === 0 ? "TUDO OK" : "FALHOU"} — ${ok} ok, ${falhas} falhas`);
  // `exitCode` e não `exit()`: sair à força com a ligação à Cloudflare a fechar rebenta o Node no Windows.
  process.exitCode = falhas === 0 ? 0 : 1;
}

void main();

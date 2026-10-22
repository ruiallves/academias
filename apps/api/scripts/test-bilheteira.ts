/**
 * As regras da bilheteira, sem servidor nem base (`src/bilheteira/regras.ts`).
 *
 * Prova o que o Rui decidiu a 21/10/2026: as fases da venda (só sócios,
 * sócios primeiro), a lotação por bancada com os lugares anuais descontados,
 * o preço de sócio só com a quota a cobrir o mês do jogo e um por sócio, os
 * 10 minutos (pago depois, reembolso), o QR que não se forja, a porta que só
 * aceita as bancadas dela, e o PIN do segurança que bloqueia.
 *
 * Uso: npm run test:bilheteira
 */
import {
  MAXIMO_POR_COMPRA,
  PIN_TENTATIVAS,
  TODAS_AS_PORTAS,
  codigoDoBilhete,
  decidirEntrada,
  depoisDaTentativa,
  destinoDoPagamento,
  estadoDaVenda,
  guardarPin,
  lerCodigo,
  lugaresLivres,
  mesmaData,
  novoPin,
  novoToken,
  pinCerto,
  quotaCobre,
  resumoDoToken,
  tiposPara,
  verificarPedido,
  type Comprador,
  type TipoParaVenda,
} from "../src/bilheteira/regras";

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

const h = (s: string) => new Date(s);
const jogo = { startsAt: h("2026-11-15T15:00:00Z"), status: "SCHEDULED" };
const aberta = { open: true, membersFrom: null, publicFrom: null, membersOnly: false, closesAt: null };

console.log("=== As fases da venda ===");
{
  const e = estadoDaVenda(aberta, jogo, h("2026-11-10T10:00:00Z"));
  check("aberta a todos", e.socios && e.publico && !e.fechada);
  check("fecha à hora do jogo", estadoDaVenda(aberta, jogo, h("2026-11-15T15:00:00Z")).fechada);
  check("fecha antes, se o clube quiser", estadoDaVenda({ ...aberta, closesAt: h("2026-11-14T20:00:00Z") }, jogo, h("2026-11-15T10:00:00Z")).fechada);
  check("um fecho depois do jogo não o prolonga", estadoDaVenda({ ...aberta, closesAt: h("2026-11-20T00:00:00Z") }, jogo, h("2026-11-15T16:00:00Z")).fechada);
  check("jogo cancelado não vende", estadoDaVenda(aberta, { ...jogo, status: "CANCELLED" }, h("2026-11-10T10:00:00Z")).fechada);
  check("venda desligada não vende", estadoDaVenda({ ...aberta, open: false }, jogo, h("2026-11-10T10:00:00Z")).fechada);

  const soSocios = estadoDaVenda({ ...aberta, membersOnly: true }, jogo, h("2026-11-10T10:00:00Z"));
  check("só sócios: sócios sim, público não, e nunca abre", soSocios.socios && !soSocios.publico && soSocios.abrePublicoEm === null);

  const fases = { ...aberta, membersFrom: h("2026-11-01T09:00:00Z"), publicFrom: h("2026-11-08T09:00:00Z") };
  const antes = estadoDaVenda(fases, jogo, h("2026-10-30T10:00:00Z"));
  check("antes de tudo: ninguém, com as datas de abertura", !antes.socios && !antes.publico && !!antes.abreSociosEm && !!antes.abrePublicoEm);
  const soc = estadoDaVenda(fases, jogo, h("2026-11-03T10:00:00Z"));
  check("sócios primeiro", soc.socios && !soc.publico && soc.abrePublicoEm?.toISOString() === "2026-11-08T09:00:00.000Z");
  const todos = estadoDaVenda(fases, jogo, h("2026-11-09T10:00:00Z"));
  check("depois, todos", todos.socios && todos.publico);
}

console.log("\n=== Lotação ===");
{
  check("500 lugares, 10 anuais, nada vendido: 490", lugaresLivres(500, 10, 0) === 490);
  check("500 lugares, 10 anuais, 485 vendidos: 5", lugaresLivres(500, 10, 485) === 5);
  check("nunca negativo", lugaresLivres(100, 60, 60) === 0);
  check("sem lotação escrita: sem limite próprio", lugaresLivres(null, 3, 1000) === null);
}

console.log("\n=== O pedido ===");
{
  const tipos: TipoParaVenda[] = [
    { id: "norte-pub", nome: "Norte · Público", precoCents: 1000, bancadaId: "norte", para: "publico", tierId: null },
    { id: "norte-soc", nome: "Norte · Sócio", precoCents: 500, bancadaId: "norte", para: "socios", tierId: null },
    { id: "norte-jov", nome: "Norte · Sócio Jovem", precoCents: 200, bancadaId: "norte", para: "socios", tierId: "jovem" },
    { id: "sul-pub", nome: "Sul · Público", precoCents: 800, bancadaId: "sul", para: "publico", tierId: null },
  ];
  const publico: Comprador = { kind: "publico" };
  const socio: Comprador = { kind: "socio", memberId: "m1", tierId: "efetivo", jaTemBilheteDeSocio: false };
  const jovem: Comprador = { kind: "socio", memberId: "m2", tierId: "jovem", jaTemBilheteDeSocio: false };
  const todos = estadoDaVenda(aberta, jogo, h("2026-11-10T10:00:00Z"));
  const base = { tipos, venda: todos, livres: { norte: 100, sul: 100 }, livresNoJogo: null };

  check("o público não vê preços de sócio", tiposPara(tipos, publico).every((t) => t.para === "publico"));
  check("um sócio vê o preço geral de sócio, não o de outra categoria", tiposPara(tipos, socio).map((t) => t.id).join(",") === "norte-pub,norte-soc,sul-pub");
  check("um sócio jovem vê o da categoria dele", tiposPara(tipos, jovem).some((t) => t.id === "norte-jov"));

  const p1 = verificarPedido({ ...base, linhas: [{ typeId: "norte-pub", quantidade: 2 }, { typeId: "sul-pub", quantidade: 1 }], quem: publico });
  check("público compra 3", p1.ok && p1.totalCents === 2800 && p1.bilhetes.length === 3);

  const p2 = verificarPedido({ ...base, linhas: [{ typeId: "norte-soc", quantidade: 1 }], quem: publico });
  check("o público não compra a preço de sócio", !p2.ok && /sócios/.test(p2.erro));

  const p3 = verificarPedido({ ...base, linhas: [{ typeId: "norte-soc", quantidade: 1 }, { typeId: "norte-pub", quantidade: 2 }], quem: socio });
  check("sócio + dois acompanhantes", p3.ok && p3.totalCents === 2500 && p3.bilhetes.filter((b) => b.deSocio).length === 1);

  const p4 = verificarPedido({ ...base, linhas: [{ typeId: "norte-soc", quantidade: 2 }], quem: socio });
  check("dois bilhetes de sócio na mesma compra: não", !p4.ok && /um bilhete de sócio/.test(p4.erro));

  const p5 = verificarPedido({ ...base, linhas: [{ typeId: "norte-soc", quantidade: 1 }], quem: { ...socio, jaTemBilheteDeSocio: true } });
  check("um sócio que já tem o dele não leva outro", !p5.ok);

  const p6 = verificarPedido({ ...base, linhas: [{ typeId: "norte-jov", quantidade: 1 }], quem: socio });
  check("o preço de outra categoria: não", !p6.ok);

  const p7 = verificarPedido({ ...base, linhas: [{ typeId: "norte-pub", quantidade: MAXIMO_POR_COMPRA + 1 }], quem: publico });
  check(`no máximo ${MAXIMO_POR_COMPRA} por compra`, !p7.ok);

  const p8 = verificarPedido({ ...base, livres: { norte: 2, sul: 100 }, linhas: [{ typeId: "norte-pub", quantidade: 3 }], quem: publico });
  check("acima do que resta na bancada: não, e diz quantos há", !p8.ok && /Só há 2 lugares/.test(p8.erro));

  const p9 = verificarPedido({ ...base, livres: { norte: 0, sul: 100 }, linhas: [{ typeId: "norte-pub", quantidade: 1 }], quem: publico });
  check("bancada esgotada", !p9.ok && /esgotou/.test(p9.erro));

  const p10 = verificarPedido({ ...base, livresNoJogo: 1, linhas: [{ typeId: "norte-pub", quantidade: 1 }, { typeId: "sul-pub", quantidade: 1 }], quem: publico });
  check("acima da lotação do jogo: não", !p10.ok);

  const p11 = verificarPedido({ ...base, livres: { sul: 5 }, linhas: [{ typeId: "norte-pub", quantidade: 4 }], quem: publico });
  check("bancada sem lotação escrita só conta a do jogo", p11.ok);

  const soSocios = estadoDaVenda({ ...aberta, membersOnly: true }, jogo, h("2026-11-10T10:00:00Z"));
  const p12 = verificarPedido({ ...base, venda: soSocios, linhas: [{ typeId: "norte-pub", quantidade: 1 }], quem: publico });
  check("jogo só para sócios: o público não compra", !p12.ok && /só para sócios/.test(p12.erro));
  const p13 = verificarPedido({ ...base, venda: soSocios, linhas: [{ typeId: "norte-soc", quantidade: 1 }, { typeId: "norte-pub", quantidade: 1 }], quem: socio });
  check("jogo só para sócios: nem os acompanhantes do sócio", !p13.ok);

  const fasesSocios = estadoDaVenda({ ...aberta, publicFrom: h("2026-11-12T09:00:00Z") }, jogo, h("2026-11-10T10:00:00Z"));
  const p14 = verificarPedido({ ...base, venda: fasesSocios, linhas: [{ typeId: "norte-soc", quantidade: 1 }], quem: socio });
  check("sócios primeiro: o sócio compra o dele", p14.ok);
  const p15 = verificarPedido({ ...base, venda: fasesSocios, linhas: [{ typeId: "norte-pub", quantidade: 1 }], quem: publico });
  check("sócios primeiro: o público espera", !p15.ok && /ainda não abriu/.test(p15.erro));

  const p16 = verificarPedido({ ...base, linhas: [{ typeId: "inventado", quantidade: 1 }], quem: publico });
  check("um tipo que não existe", !p16.ok);
  const p17 = verificarPedido({ ...base, linhas: [{ typeId: "norte-pub", quantidade: 0 }], quem: publico });
  check("um pedido vazio", !p17.ok);
  const p18 = verificarPedido({ ...base, linhas: [{ typeId: "norte-pub", quantidade: 1.5 }], quem: publico });
  check("meia quantidade", !p18.ok);
}

console.log("\n=== O sócio e a quota ===");
{
  check("a data de nascimento certa", mesmaData(h("1990-05-04T00:00:00Z"), "1990-05-04"));
  check("a errada", !mesmaData(h("1990-05-04T00:00:00Z"), "1990-04-05"));
  check("sem data na ficha não se confirma", !mesmaData(null, "1990-05-04"));
  check("um formato estranho não passa", !mesmaData(h("1990-05-04T00:00:00Z"), "04/05/1990"));

  const dia = h("2026-09-14T15:00:00Z");
  const agosto = { period: "2026-08", status: "SETTLED", coversFrom: h("2026-08-01"), coversTo: h("2026-08-31") };
  const setembro = { period: "2026-09", status: "SETTLED", coversFrom: h("2026-09-01"), coversTo: h("2026-09-30") };
  check("jogo em setembro com quotas até agosto: não", !quotaCobre({ quotas: [agosto], dispensados: [], periodoDoJogo: "2026-09", dia, semQuota: false }));
  check("com setembro pago: sim", quotaCobre({ quotas: [agosto, setembro], dispensados: [], periodoDoJogo: "2026-09", dia, semQuota: false }));
  check("setembro lançado mas por pagar: não", !quotaCobre({ quotas: [{ ...setembro, status: "OPEN" }], dispensados: [], periodoDoJogo: "2026-09", dia, semQuota: false }));
  const anual = { period: "2026", status: "SETTLED", coversFrom: h("2026-08-01"), coversTo: h("2027-07-31") };
  check("anual paga que cobre o dia: sim", quotaCobre({ quotas: [anual], dispensados: [], periodoDoJogo: "2026", dia, semQuota: false }));
  check("quota antiga sem cobertura escrita, do período do jogo: sim", quotaCobre({ quotas: [{ period: "2026-09", status: "SETTLED", coversFrom: null, coversTo: null }], dispensados: [], periodoDoJogo: "2026-09", dia, semQuota: false }));
  check("período dispensado pelo clube: sim", quotaCobre({ quotas: [], dispensados: ["2026-09"], periodoDoJogo: "2026-09", dia, semQuota: false }));
  check("categoria sem quota: sim", quotaCobre({ quotas: [], dispensados: [], periodoDoJogo: "2026-09", dia, semQuota: true }));
}

console.log("\n=== O pagamento e os 10 minutos ===");
{
  const ate = h("2026-11-10T10:10:00Z");
  check("pago dentro do prazo: bilhetes", destinoDoPagamento({ status: "RESERVED", reservedUntil: ate, pagoEm: h("2026-11-10T10:09:59Z"), aindaHaLugar: true }) === "emitir");
  check("pago depois do prazo: reembolso, mesmo havendo lugar", destinoDoPagamento({ status: "RESERVED", reservedUntil: ate, pagoEm: h("2026-11-10T10:10:01Z"), aindaHaLugar: true }) === "reembolso");
  check("dentro do prazo mas o aviso chegou tarde e ainda há lugar: bilhetes", destinoDoPagamento({ status: "EXPIRED", reservedUntil: ate, pagoEm: h("2026-11-10T10:08:00Z"), aindaHaLugar: true }) === "emitir");
  check("dentro do prazo, aviso tarde, lugares já vendidos: reembolso", destinoDoPagamento({ status: "EXPIRED", reservedUntil: ate, pagoEm: h("2026-11-10T10:08:00Z"), aindaHaLugar: false }) === "reembolso");
  check("o mesmo aviso duas vezes não emite duas vezes", destinoDoPagamento({ status: "PAID", reservedUntil: ate, pagoEm: h("2026-11-10T10:05:00Z"), aindaHaLugar: true }) === "ja-tratado");
}

console.log("\n=== O QR ===");
{
  const segredo = "segredo-de-teste";
  const c = codigoDoBilhete(segredo, "T", "cm1abcdefghijklmnop");
  check("o código lê-se", lerCodigo(segredo, c)?.id === "cm1abcdefghijklmnop");
  check("com outro segredo não", lerCodigo("outro", c) === null);
  check("trocar o id não serve", lerCodigo(segredo, c.replace("cm1abcdefghijklmnop", "cm1abcdefghijklmnoq")) === null);
  check("trocar o tipo não serve (um bilhete não vira lugar anual)", lerCodigo(segredo, "S" + c.slice(1)) === null);
  check("lixo não passa", lerCodigo(segredo, "https://exemplo.pt") === null && lerCodigo(segredo, "") === null);
  check("dois bilhetes, dois códigos", codigoDoBilhete(segredo, "T", "cm1aaaaaaaaaaaaaaaa") !== codigoDoBilhete(segredo, "T", "cm1aaaaaaaaaaaaaaab"));
}

console.log("\n=== A porta ===");
{
  const portaNorte = { id: "pa", bancadaIds: ["norte"] };
  const bilhete = (x: Partial<{ matchId: string; status: string; bancadaId: string }> = {}) => ({ matchId: "j1", status: "VALID", bancadaId: "norte", ...x });
  check("bilhete certo na porta certa", decidirEntrada({ tipo: "T", bilhete: bilhete(), jogoId: "j1", porta: portaNorte }) === "OK");
  check("bancada de outra porta", decidirEntrada({ tipo: "T", bilhete: bilhete({ bancadaId: "sul" }), jogoId: "j1", porta: portaNorte }) === "WRONG_GATE");
  check("porta única aceita todas", decidirEntrada({ tipo: "T", bilhete: bilhete({ bancadaId: "sul" }), jogoId: "j1", porta: TODAS_AS_PORTAS }) === "OK");
  check("já usado", decidirEntrada({ tipo: "T", bilhete: bilhete({ status: "USED" }), jogoId: "j1", porta: portaNorte }) === "ALREADY_USED");
  check("anulado", decidirEntrada({ tipo: "T", bilhete: bilhete({ status: "VOID" }), jogoId: "j1", porta: portaNorte }) === "VOID");
  check("de outro jogo", decidirEntrada({ tipo: "T", bilhete: bilhete({ matchId: "j2" }), jogoId: "j1", porta: portaNorte }) === "WRONG_MATCH");
  check("bilhete que não existe", decidirEntrada({ tipo: "T", bilhete: null, jogoId: "j1", porta: portaNorte }) === "INVALID");

  const lugar = { seasonId: "e26", venueId: "estadio", bancadaId: "norte" };
  const j = { seasonId: "e26", venueId: "estadio" };
  check("lugar anual com a quota em dia", decidirEntrada({ tipo: "S", lugar, jogo: j, jaEntrouNesteJogo: false, quotaEmDia: true, porta: portaNorte }) === "OK");
  check("lugar anual com a quota em atraso: não entra", decidirEntrada({ tipo: "S", lugar, jogo: j, jaEntrouNesteJogo: false, quotaEmDia: false, porta: portaNorte }) === "QUOTA_EM_ATRASO");
  check("lugar anual que já entrou neste jogo", decidirEntrada({ tipo: "S", lugar, jogo: j, jaEntrouNesteJogo: true, quotaEmDia: true, porta: portaNorte }) === "ALREADY_USED");
  check("lugar anual de outra época", decidirEntrada({ tipo: "S", lugar: { ...lugar, seasonId: "e25" }, jogo: j, jaEntrouNesteJogo: false, quotaEmDia: true, porta: portaNorte }) === "WRONG_MATCH");
  check("lugar anual noutro recinto", decidirEntrada({ tipo: "S", lugar, jogo: { ...j, venueId: "pavilhao" }, jaEntrouNesteJogo: false, quotaEmDia: true, porta: portaNorte }) === "WRONG_MATCH");
  check("lugar anual na porta errada", decidirEntrada({ tipo: "S", lugar: { ...lugar, bancadaId: "sul" }, jogo: j, jaEntrouNesteJogo: false, quotaEmDia: true, porta: portaNorte }) === "WRONG_GATE");
}

console.log("\n=== O link e o PIN do segurança ===");
{
  const t = novoToken();
  check("token longo e aleatório", t.length >= 43 && t !== novoToken());
  check("guarda-se só o resumo", resumoDoToken(t) !== t && resumoDoToken(t) === resumoDoToken(t));
  const pin = novoPin();
  check("PIN de seis algarismos", /^\d{6}$/.test(pin));
  const g = guardarPin(pin);
  check("o PIN não se guarda em claro", !g.includes(pin));
  check("o PIN certo passa", pinCerto(pin, g));
  check("o errado não", !pinCerto(pin === "000000" ? "000001" : "000000", g));
  check("lixo não", !pinCerto("12ab56", g) && !pinCerto("", g));
  let estado = { erradas: 0, bloqueadoAte: null as Date | null };
  for (let i = 0; i < PIN_TENTATIVAS - 1; i++) estado = depoisDaTentativa(false, estado.erradas);
  check(`${PIN_TENTATIVAS - 1} erradas ainda não bloqueiam`, estado.bloqueadoAte === null);
  estado = depoisDaTentativa(false, estado.erradas);
  check(`à ${PIN_TENTATIVAS}.ª bloqueia`, estado.bloqueadoAte !== null);
  check("uma certa limpa a contagem", depoisDaTentativa(true, 3).erradas === 0);
}

console.log(`\n${falhas === 0 ? "TUDO OK" : "FALHOU"} — ${ok} ok, ${falhas} falhas`);
process.exit(falhas === 0 ? 0 : 1);

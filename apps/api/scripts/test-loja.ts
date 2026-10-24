/**
 * As regras da loja do site, sem servidor nem base (`src/loja/regras.ts` e
 * as formas em `src/site/site.tipos.ts`).
 *
 * Prova o que ficou decidido a 24/10/2026: o carrinho contra o stock (por
 * tamanho, com o guardado descontado), os máximos por linha e por encomenda,
 * a entrega (levantamento ou envio, com o preço e o grátis a partir de), a
 * loja que só vende com pagamentos e uma forma de entrega, e o que acontece
 * ao dinheiro que chega dentro e fora dos 10 minutos.
 *
 * Uso: npm run test:loja
 */
import {
  MAXIMO_DE_LINHAS,
  MAXIMO_POR_ENCOMENDA,
  MAXIMO_POR_LINHA,
  custoDeEnvio,
  destinoDoPagamento,
  entregaPossivel,
  estaGuardada,
  juntarLinhas,
  lojaVende,
  moradaValida,
  proximoNumero,
  verificarCarrinho,
  type ProdutoParaVenda,
} from "../src/loja/regras";
import { produtoParaVenda } from "../src/loja/contexto";
import { LOJA_POR_OMISSAO, lojaParaConsola, lojaValida, stockValido, tamanhosDoProduto } from "../src/site/site.tipos";

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

const camisola: ProdutoParaVenda = {
  id: "cam",
  nome: "Camisola principal",
  precoCents: 4500,
  imageUrl: null,
  visivel: true,
  tamanhos: ["S", "M", "L"],
  disponivel: { S: 2, M: 0, L: null },
  variantId: { S: "v-s", M: "v-m", L: "v-l" },
};
const cachecol: ProdutoParaVenda = { id: "cac", nome: "Cachecol", precoCents: 1200, imageUrl: null, visivel: true, tamanhos: [], disponivel: { "": 5 }, variantId: {} };
const escondido: ProdutoParaVenda = { ...cachecol, id: "esc", nome: "Boné antigo", visivel: false };
const produtos = [camisola, cachecol, escondido];

console.log("\nO carrinho");
{
  const r = verificarCarrinho({ linhas: [{ productId: "cam", tamanho: "S", quantidade: 2 }, { productId: "cac", tamanho: "", quantidade: 1 }], produtos });
  check("duas camisolas S e um cachecol passam", r.ok);
  if (r.ok) {
    check("o total soma as linhas ao preço de agora", r.itemsCents === 2 * 4500 + 1200, String(r.itemsCents));
    check("a linha leva a variante do inventário do tamanho", r.linhas[0].variantId === "v-s" && r.linhas[1].variantId === null);
    check("o nome e o preço ficam fotografados", r.linhas[0].productName === "Camisola principal" && r.linhas[0].unitPriceCents === 4500);
  }
  const vazio = verificarCarrinho({ linhas: [], produtos });
  check("um carrinho vazio é recusado", !vazio.ok);
  const semTamanho = verificarCarrinho({ linhas: [{ productId: "cam", tamanho: "", quantidade: 1 }], produtos });
  check("uma camisola sem tamanho pede o tamanho", !semTamanho.ok && /tamanho/i.test(semTamanho.ok ? "" : semTamanho.erro));
  const tamanhoErrado = verificarCarrinho({ linhas: [{ productId: "cam", tamanho: "XXL", quantidade: 1 }], produtos });
  check("um tamanho que não existe é recusado", !tamanhoErrado.ok);
  const esgotado = verificarCarrinho({ linhas: [{ productId: "cam", tamanho: "M", quantidade: 1 }], produtos });
  check("um tamanho a zero diz que esgotou", !esgotado.ok && /esgotou/.test(esgotado.ok ? "" : esgotado.erro));
  const aMais = verificarCarrinho({ linhas: [{ productId: "cam", tamanho: "S", quantidade: 3 }], produtos });
  check("três camisolas S quando só há 2 dizem quantas há", !aMais.ok && /Só há 2/.test(aMais.ok ? "" : aMais.erro));
  const semContagem = verificarCarrinho({ linhas: [{ productId: "cam", tamanho: "L", quantidade: 10 }], produtos });
  check("um tamanho sem contagem vende até ao máximo por linha", semContagem.ok);
  const demais = verificarCarrinho({ linhas: [{ productId: "cam", tamanho: "L", quantidade: MAXIMO_POR_LINHA + 1 }], produtos });
  check(`mais de ${MAXIMO_POR_LINHA} da mesma linha é recusado`, !demais.ok);
  const total = verificarCarrinho({ linhas: [{ productId: "cam", tamanho: "L", quantidade: 10 }, { productId: "cac", tamanho: "", quantidade: 5 }, { productId: "cam", tamanho: "S", quantidade: 2 }, { productId: "cam", tamanho: "L", quantidade: 4 }], produtos });
  check(`mais de ${MAXIMO_POR_ENCOMENDA} unidades na encomenda é recusado`, !total.ok);
  const invisivel = verificarCarrinho({ linhas: [{ productId: "esc", tamanho: "", quantidade: 1 }], produtos });
  check("um produto escondido já não está à venda", !invisivel.ok && /já não está à venda/.test(invisivel.ok ? "" : invisivel.erro));
  const desconhecido = verificarCarrinho({ linhas: [{ productId: "nada", tamanho: "", quantidade: 1 }], produtos });
  check("um produto que não existe é recusado", !desconhecido.ok);
  const cachecolComTamanho = verificarCarrinho({ linhas: [{ productId: "cac", tamanho: "M", quantidade: 1 }], produtos });
  check("um produto sem tamanhos com tamanho é recusado", !cachecolComTamanho.ok);
  const muitas = verificarCarrinho({ linhas: Array.from({ length: MAXIMO_DE_LINHAS + 1 }, (_, i) => ({ productId: `p${i}`, tamanho: "", quantidade: 1 })), produtos });
  check(`mais de ${MAXIMO_DE_LINHAS} linhas é recusado`, !muitas.ok);
}

console.log("\nJuntar linhas");
{
  const j = juntarLinhas([{ productId: "cam", tamanho: "S", quantidade: 1 }, { productId: "cam", tamanho: " S ", quantidade: 1 }, { productId: "cam", tamanho: "M", quantidade: 0 }, { productId: "cac", tamanho: "", quantidade: 2 }]);
  check("o mesmo produto e tamanho junta-se numa linha", j.length === 2 && j[0].quantidade === 2, JSON.stringify(j));
  check("as linhas a zero caem", !j.some((l) => l.quantidade === 0));
}

console.log("\nO stock de um produto como a venda o vê");
{
  const reservados = new Map([["p\u0000M", 2], ["p\u0000", 1]]);
  const doInventario = produtoParaVenda(
    { id: "p", name: "Camisola", priceCents: 4500, imageUrl: null, visible: true, sizes: "", soldOut: false, stock: {}, inventoryItem: { archivedAt: null, variants: [{ id: "a", label: "S", totalQuantity: 5, assignedQuantity: 2 }, { id: "b", label: "M", totalQuantity: 3, assignedQuantity: 0 }] } },
    reservados,
  );
  check("com artigo, os tamanhos são as variantes", doInventario.tamanhos.join(",") === "S,M");
  check("o disponível é total menos entregue menos guardado", doInventario.disponivel.S === 3 && doInventario.disponivel.M === 1, JSON.stringify(doInventario.disponivel));
  check("cada tamanho leva a variante", doInventario.variantId.M === "b");
  const umaVariante = produtoParaVenda(
    { id: "p", name: "Bola", priceCents: 2000, imageUrl: null, visible: true, sizes: "", soldOut: false, stock: {}, inventoryItem: { archivedAt: null, variants: [{ id: "u", label: "Único", totalQuantity: 4, assignedQuantity: 0 }] } },
    reservados,
  );
  check("uma variante só não mostra tamanhos e conta em «»", umaVariante.tamanhos.length === 0 && umaVariante.disponivel[""] === 3 && umaVariante.variantId[""] === "u");
  const arquivado = produtoParaVenda(
    { id: "p", name: "Bola", priceCents: 2000, imageUrl: null, visible: true, sizes: "", soldOut: false, stock: {}, inventoryItem: { archivedAt: new Date(), variants: [{ id: "u", label: "Único", totalQuantity: 4, assignedQuantity: 0 }] } },
    new Map(),
  );
  check("um artigo arquivado sai da venda", !arquivado.visivel && arquivado.disponivel[""] === 0);
  const manual = produtoParaVenda({ id: "p", name: "Cachecol", priceCents: 1200, imageUrl: null, visible: true, sizes: "S, M, L, S", soldOut: false, stock: { S: 4, M: 0 }, inventoryItem: null }, reservados);
  check("sem artigo, os tamanhos vêm do texto, sem repetidos", manual.tamanhos.join(",") === "S,M,L");
  check("o stock gravado conta por tamanho e o ausente é sem contagem", manual.disponivel.S === 4 && manual.disponivel.M === 0 && manual.disponivel.L === null, JSON.stringify(manual.disponivel));
  const guardadoManual = produtoParaVenda({ id: "p", name: "Cachecol", priceCents: 1200, imageUrl: null, visible: true, sizes: "", soldOut: false, stock: { "": 5 }, inventoryItem: null }, reservados);
  check("o guardado desconta também no stock manual", guardadoManual.disponivel[""] === 4);
  const esgotadoManual = produtoParaVenda({ id: "p", name: "Cachecol", priceCents: 1200, imageUrl: null, visible: true, sizes: "", soldOut: true, stock: {}, inventoryItem: null }, new Map());
  check("o interruptor «esgotado» põe tudo a zero", esgotadoManual.disponivel[""] === 0);
}

console.log("\nA configuração da loja");
{
  const omissao = lojaValida(undefined);
  check("sem nada gravado, levantamento ligado e envio desligado", omissao.levantamento.ativo && !omissao.envio.ativo);
  check("a omissão é a de `LOJA_POR_OMISSAO`", JSON.stringify(omissao) === JSON.stringify(LOJA_POR_OMISSAO));
  const daConsola = lojaValida({ levantamento: { ativo: false }, envio: { ativo: true, preco: 4.5, gratisAPartirDe: 50, nota: "Portugal continental" }, aviso: "  Até 20 de dezembro  " });
  check("os euros da consola gravam-se em cêntimos", daConsola.envio.precoCents === 450 && daConsola.envio.gratisAPartirDeCents === 5000);
  check("o aviso vem limpo", daConsola.aviso === "Até 20 de dezembro");
  check("o levantamento pode desligar-se", !daConsola.levantamento.ativo);
  const emCents = lojaValida({ envio: { ativo: true, precoCents: 390, gratisAPartirDeCents: 0 } });
  check("em cêntimos também entra, e grátis a 0 é «nunca»", emCents.envio.precoCents === 390 && emCents.envio.gratisAPartirDeCents === null);
  const c = lojaParaConsola(daConsola);
  check("para a consola volta em euros", c.envio.preco === 4.5 && c.envio.gratisAPartirDe === 50);
  check("o stock limpa-se: inteiros, sem negativos, chaves aparadas", JSON.stringify(stockValido({ " M ": 2.6, L: -1, X: "3", Y: null })) === JSON.stringify({ M: 3, L: 0 }));
  check("os tamanhos do texto não se repetem", tamanhosDoProduto("S, M , S, L").join(",") === "S,M,L");
}

console.log("\nA entrega");
{
  const loja = lojaValida({ levantamento: { ativo: true, local: "Sede" }, envio: { ativo: true, precoCents: 500, gratisAPartirDeCents: 6000 } });
  check("o levantamento não custa nada", custoDeEnvio(loja, "PICKUP", 1000) === 0);
  check("o envio custa o preço do clube", custoDeEnvio(loja, "SHIPPING", 1000) === 500);
  check("a partir do valor é grátis", custoDeEnvio(loja, "SHIPPING", 6000) === 0);
  const soLevantamento = lojaValida({ envio: { ativo: false } });
  check("pedir envio sem envio ligado é recusado", entregaPossivel(soLevantamento, "SHIPPING") !== null);
  check("pedir levantamento com ele ligado passa", entregaPossivel(soLevantamento, "PICKUP") === null);
  const soEnvio = lojaValida({ levantamento: { ativo: false }, envio: { ativo: true, precoCents: 300 } });
  check("pedir levantamento sem ele é recusado", entregaPossivel(soEnvio, "PICKUP") !== null);
  check("a loja vende com pagamentos e uma entrega", lojaVende(loja, true));
  check("sem pagamentos ligados não vende", !lojaVende(loja, false));
  check("sem nenhuma entrega não vende", !lojaVende(lojaValida({ levantamento: { ativo: false }, envio: { ativo: false } }), true));
  const m = moradaValida({ nome: " Ana ", linha1: "Rua A, 1", linha2: "", codigoPostal: "4800-000", localidade: "Guimarães" });
  check("uma morada completa passa, aparada", !!m && m.nome === "Ana" && m.localidade === "Guimarães");
  check("sem código postal não há morada", moradaValida({ linha1: "Rua A", localidade: "Fafe" }) === null);
}

console.log("\nO pagamento");
{
  const ate = new Date("2026-10-24T10:10:00Z");
  check("pago dentro do prazo confirma", destinoDoPagamento({ status: "RESERVED", reservedUntil: ate, pagoEm: new Date("2026-10-24T10:05:00Z"), aindaHaStock: true }) === "confirmar");
  check("pago depois do prazo com stock confirma na mesma", destinoDoPagamento({ status: "EXPIRED", reservedUntil: ate, pagoEm: new Date("2026-10-24T10:20:00Z"), aindaHaStock: true }) === "confirmar");
  check("pago depois do prazo sem stock é reembolso", destinoDoPagamento({ status: "EXPIRED", reservedUntil: ate, pagoEm: new Date("2026-10-24T10:20:00Z"), aindaHaStock: false }) === "reembolso");
  for (const s of ["PAID", "READY", "SHIPPED", "DELIVERED", "LATE_PAYMENT", "CANCELLED"]) {
    check(`uma encomenda ${s} não se trata duas vezes`, destinoDoPagamento({ status: s, reservedUntil: ate, pagoEm: new Date(), aindaHaStock: true }) === "ja-tratado");
  }
  const agora = new Date("2026-10-24T10:00:00Z");
  check("uma reserva dentro do prazo está guardada", estaGuardada({ status: "RESERVED", reservedUntil: ate }, agora));
  check("uma reserva passada já não está", !estaGuardada({ status: "RESERVED", reservedUntil: new Date("2026-10-24T09:00:00Z") }, agora));
  check("uma encomenda paga não está guardada (o stock já desceu)", !estaGuardada({ status: "PAID", reservedUntil: ate }, agora));
  check("a primeira encomenda é a n.º 1, e segue", proximoNumero(null) === 1 && proximoNumero(41) === 42);
}

console.log(`\n${ok} OK, ${falhas} falhas`);
process.exit(falhas ? 1 : 0);

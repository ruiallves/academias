import type { LojaDoClube } from "@/dados/tipos";
import { euro } from "@/lib/formatar";

export type Servico = { titulo: string; texto: string };

/**
 * Como se recebe e como se paga, em frases curtas: a faixa no fim da montra
 * e as secções que abrem na página do artigo dizem o mesmo, daqui.
 */
export function servicosDaLoja(loja: LojaDoClube | null | undefined): { entrega: Servico[]; pagamento: Servico | null } {
  const entrega: Servico[] = [];
  if (loja?.levantamento) {
    entrega.push({
      titulo: loja.levantamento.local ? `Levantamento em ${loja.levantamento.local}` : "Levantamento no clube",
      texto: ["Sem custos.", loja.levantamento.nota].filter(Boolean).join(" "),
    });
  }
  if (loja?.envio) {
    const { preco, gratisAPartirDe, nota } = loja.envio;
    entrega.push({
      titulo: "Envio pelo correio",
      texto: [
        preco === 0 ? "Grátis." : `${euro(preco)}${gratisAPartirDe !== null ? `, grátis a partir de ${euro(gratisAPartirDe)}` : ""}.`,
        nota,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  if (entrega.length === 0) entrega.push({ titulo: "Levantamento no clube", texto: "Na sede, combinado com o clube." });

  const pagamento = loja?.compraOnline
    ? { titulo: "MB WAY ou Multibanco", texto: "Pagas no fim da encomenda e o dinheiro vai direto para o clube." }
    : null;
  return { entrega, pagamento };
}

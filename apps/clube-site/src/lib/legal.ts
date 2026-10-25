import type { Clube, LegalDoClube } from "@/dados/tipos";

/**
 * A informação legal do clube, com o que falta preenchido. Um servidor de
 * antes da informação legal não a manda: o site mostra na mesma as páginas,
 * com o nome do clube e o centro nacional de arbitragem (o que serve em todo
 * o país onde não há centro regional).
 */
export function legalDe(clube: Clube): LegalDoClube & { nome: string } {
  const l = clube.legal;
  return {
    nome: l?.nome || clube.name,
    nipc: l?.nipc,
    ral: l?.ral ?? { nome: "Centro Nacional de Informação e Arbitragem de Conflitos de Consumo", sigla: "CNIACC", url: "https://www.cniacc.pt" },
    termosSocio: l?.termosSocio ?? [],
    estatutosUrl: l?.estatutosUrl,
    notaVenda: l?.notaVenda ?? [],
    notaPrivacidade: l?.notaPrivacidade ?? [],
    vendeOnline: l?.vendeOnline ?? clube.loja?.compraOnline === true,
  };
}

/** O Livro de Reclamações Eletrónico. A ligação tem de estar visível em quem vende online (DL 74/2017). */
export const LIVRO_DE_RECLAMACOES = "https://www.livroreclamacoes.pt/Inicio/";

/** A lista oficial das entidades de resolução alternativa de litígios de consumo, na Direção-Geral do Consumidor. */
export const LISTA_RAL = "https://www.consumidor.gov.pt";

/** As ligações legais do rodapé, pela ordem em que aparecem. Condições de venda só com a venda ligada. */
export function ligacoesLegais(clube: Clube): { href: string; label: string; externo?: boolean }[] {
  const l = legalDe(clube);
  return [
    { href: "/privacidade", label: "Privacidade" },
    { href: "/privacidade#cookies", label: "Cookies" },
    ...(l.vendeOnline ? [{ href: "/condicoes-de-venda", label: "Condições de venda" }] : []),
    { href: "/termos-do-socio", label: "Termos do sócio" },
    { href: LIVRO_DE_RECLAMACOES, label: "Livro de Reclamações", externo: true },
  ];
}

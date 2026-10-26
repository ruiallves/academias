/**
 * A faturação por API: o que é comum a todos os programas.
 *
 * ## O desenho
 *
 * Cada pagamento a um clube vira um **documento a faturar** (`DocumentoAFaturar`):
 * a quem, as linhas, o total, a regra fiscal de cada linha. Esse documento é
 * o mesmo seja qual for o programa; o que muda é o **conector** (`Conector`),
 * um por programa, que o transforma nas chamadas desse programa e devolve o
 * que ficou emitido. Acrescentar um programa é escrever um conector novo e
 * mais nada: a fila, os emails, a consola e a regra "vende com a faturação
 * ligada" não sabem com que programa estão a falar.
 *
 * Os preços aqui são **o que a pessoa pagou**, com IVA incluído quando há IVA:
 * uma mensalidade de 25 € fatura-se a 25 €. Cada conector converte para o
 * preço sem IVA se o programa o exigir (`liquidoDeBruto`).
 */
import type { InvoicingProvider } from "@prisma/client";

/** O tipo de cada linha, que decide a regra fiscal. */
export type TipoDeVenda = "MENSALIDADE" | "EXTRA" | "QUOTA" | "BILHETE" | "LOJA" | "ENVIO" | "TAXA";

export const TIPOS_DE_VENDA: { tipo: TipoDeVenda; label: string; explicacao: string }[] = [
  { tipo: "MENSALIDADE", label: "Mensalidades", explicacao: "A mensalidade de cada atleta." },
  { tipo: "EXTRA", label: "Cobranças avulsas", explicacao: "Equipamento, torneios, viagens: o que o clube cobra à parte da mensalidade." },
  { tipo: "QUOTA", label: "Quotas de sócio", explicacao: "As quotas dos sócios do clube." },
  { tipo: "BILHETE", label: "Bilhetes", explicacao: "Os bilhetes vendidos no site e na app." },
  { tipo: "LOJA", label: "Loja", explicacao: "Os artigos vendidos na loja do site." },
  { tipo: "ENVIO", label: "Portes de envio", explicacao: "O envio das encomendas da loja, quando o clube o cobra." },
  { tipo: "TAXA", label: "Comissão do pagamento", explicacao: "A comissão da euPago, nos clubes que a põem por conta de quem paga." },
];

/** As taxas de IVA em Portugal continental. Os Açores e a Madeira escolhem a taxa no programa. */
export const TAXAS_DE_IVA = [0, 6, 13, 23] as const;
export type TaxaDeIva = (typeof TAXAS_DE_IVA)[number];

/** Os motivos de isenção que os clubes usam. O contabilista do clube escolhe. */
export const MOTIVOS_DE_ISENCAO: { codigo: string; label: string }[] = [
  { codigo: "M07", label: "M07 · Isento, artigo 9.º do CIVA (associações sem fins lucrativos, desporto)" },
  { codigo: "M10", label: "M10 · IVA, regime de isenção (artigo 53.º)" },
  { codigo: "M01", label: "M01 · Artigo 16.º n.º 6 do CIVA" },
  { codigo: "M04", label: "M04 · Isento, artigo 13.º do CIVA" },
  { codigo: "M05", label: "M05 · Isento, artigo 14.º do CIVA" },
  { codigo: "M06", label: "M06 · Isento, artigo 15.º do CIVA" },
  { codigo: "M09", label: "M09 · IVA, não confere direito a dedução" },
  { codigo: "M16", label: "M16 · Isento, artigo 14.º do RITI" },
  { codigo: "M99", label: "M99 · Não sujeito, não tributado" },
];

/** A regra fiscal de um tipo de venda: ou tem IVA, ou é isento com motivo. */
export type RegraFiscal = { iva: TaxaDeIva; isencao?: string };

/**
 * As regras fiscais do clube, por tipo de venda, e se o clube as confirmou.
 *
 * Sem confirmação não se emite nada: o IVA de uma quota ou de um bilhete é
 * uma decisão do contabilista do clube, e emitir com uma regra que ninguém
 * confirmou é passar faturas erradas em nome dele.
 */
export type RegrasFiscais = { confirmadas: boolean; porTipo: Partial<Record<TipoDeVenda, RegraFiscal>> };

/** O ponto de partida que a consola mostra: isento (M07) em tudo menos na loja, nos portes e na comissão. */
export const REGRAS_SUGERIDAS: Record<TipoDeVenda, RegraFiscal> = {
  MENSALIDADE: { iva: 0, isencao: "M07" },
  EXTRA: { iva: 0, isencao: "M07" },
  QUOTA: { iva: 0, isencao: "M07" },
  BILHETE: { iva: 0, isencao: "M07" },
  LOJA: { iva: 23 },
  ENVIO: { iva: 23 },
  TAXA: { iva: 23 },
};

/** A quem se passa a fatura. Só o nome é obrigatório; sem NIF é consumidor final. */
export type ClienteAFaturar = {
  nome: string;
  email: string | null;
  nif: string | null;
  morada: string | null;
  codigoPostal: string | null;
  localidade: string | null;
};

export type LinhaAFaturar = {
  tipo: TipoDeVenda;
  /** O que se vendeu, como aparece na fatura: "Mensalidade de Outubro de 2026 · João Silva". */
  descricao: string;
  quantidade: number;
  /** O preço unitário **pago** (com IVA, se houver), em cêntimos. */
  unitarioCents: number;
  /** A regra aplicada, copiada das do clube no momento da emissão. */
  regra: RegraFiscal;
};

/** O que se fatura. Fica fotografado em `Invoice.document`. */
export type DocumentoAFaturar = {
  cliente: ClienteAFaturar;
  linhas: LinhaAFaturar[];
  /** O total pago, em cêntimos; é igual à soma das linhas. */
  totalCents: number;
  /** A nossa referência, única por pagamento: o identificador da euPago ou o id do pagamento. */
  referencia: string;
  /** Quando foi pago, e como ("MB WAY", "Multibanco", …). Vai nas observações e no recibo. */
  pagoEm: string;
  metodo: string;
  /** O que o pagamento é, para o email: "a mensalidade de Outubro", "2 bilhetes", … */
  resumo: string;
};

/* -------------------------------------------------------------------------- */
/* O que cada programa guarda                                                  */
/* -------------------------------------------------------------------------- */

/** As credenciais, por programa. Vivem cifradas em `InvoicingAccount.credentials`. */
export type Credenciais =
  | { provider: "INVOICEXPRESS"; accountName: string; apiKey: string }
  | { provider: "MOLONI"; accessToken: string; refreshToken: string; expiresAt: string }
  | { provider: "SAGE_ONE"; accessToken: string; refreshToken: string; expiresAt: string }
  /** O PHC GO: a instalação do clube, um utilizador dela, e o token que se pede uma vez ("Never"). */
  | { provider: "PHC_GO"; backendUrl: string; userCode: string; password: string; company: string; token?: string }
  | { provider: "VENDUS"; apiKey: string };

/**
 * O que o clube escolheu no programa. Em claro.
 *
 * Nem tudo se aplica a todos: a Moloni pede a empresa e o método de pagamento,
 * a Sage pede a conta bancária. O conector diz o que lhe falta (`porDefinir`).
 */
export type DefinicoesDaConta = {
  /**
   * A série em que se emite. InvoiceXpress: `sequence_id`; Moloni:
   * `document_set_id`; PHC GO: o `ndoc` da série; Vendus: a caixa
   * (`register_id`). Nula = a do programa por omissão, onde há uma.
   */
  serieId?: string;
  serieNome?: string;
  /** Moloni: a empresa da conta a usar. */
  companyId?: string;
  companyNome?: string;
  /** Moloni: o método de pagamento com que se marca a fatura-recibo como paga. */
  paymentMethodId?: string;
  /** Sage One: a conta bancária e o tipo de pagamento do recibo. */
  bankAccountId?: string;
  paymentTypeId?: string;
  /**
   * O que o conector resolveu sozinho em `preparar` e precisa de voltar a
   * encontrar: os nomes das taxas na InvoiceXpress, os ids dos produtos
   * genéricos e das taxas na Moloni. Chaves à escolha de cada conector.
   */
  interno?: Record<string, string>;
};

/** Uma opção que o programa oferece (uma série, uma empresa, uma conta bancária), para a consola listar. */
export type Opcao = { id: string; label: string; detalhe?: string; porOmissao?: boolean; aviso?: string };

/** As escolhas que o conector precisa que o clube faça, com as opções que o programa dá. */
export type Opcoes = {
  series?: Opcao[];
  empresas?: Opcao[];
  metodosDePagamento?: Opcao[];
  contasBancarias?: Opcao[];
  tiposDePagamento?: Opcao[];
};

/** O que ficou emitido. */
export type Emitido = {
  externalId: string;
  number: string | null;
  atcud: string | null;
  permalink: string | null;
  /** O recibo, quando a fatura e o recibo são dois documentos (Sage One). */
  receiptExternalId?: string | null;
};

/** O que um conector sabe fazer. Um por programa, sem estado: tudo o que precisa vem por argumento. */
export interface Conector {
  readonly provider: InvoicingProvider;
  /**
   * As credenciais funcionam? Devolve o que se soube da conta (o nome, a
   * empresa), para a consola; e as credenciais completadas, quando a
   * verificação as enriquece (o PHC GO devolve um token para guardar).
   */
  verificar(cred: Credenciais): Promise<{ nome: string; cred?: Credenciais }>;
  /** O que o clube ainda tem de escolher, e as opções para cada escolha. */
  opcoes(cred: Credenciais, def: DefinicoesDaConta): Promise<Opcoes>;
  /** O que falta nas definições para se poder emitir. Vazio = pronto. */
  porDefinir(def: DefinicoesDaConta): string[];
  /**
   * Prepara o que a conta precisa antes da primeira emissão (produtos
   * genéricos, por exemplo) e devolve as definições completas. Idempotente.
   */
  preparar?(cred: Credenciais, def: DefinicoesDaConta): Promise<DefinicoesDaConta>;
  /** Há um documento nosso com esta referência? Para não emitir duas vezes depois de uma falha a meio. */
  procurar(cred: Credenciais, def: DefinicoesDaConta, referencia: string): Promise<Emitido | null>;
  /** Emite, no estado final e paga. */
  emitir(cred: Credenciais, def: DefinicoesDaConta, doc: DocumentoAFaturar): Promise<Emitido>;
  /** O PDF do documento emitido. */
  pdf(cred: Credenciais, def: DefinicoesDaConta, emitido: Emitido): Promise<Buffer>;
  /** Anula o documento, depois de um reembolso. Nos programas sem anulação, passa uma nota de crédito a partir de `doc`. */
  anular(cred: Credenciais, def: DefinicoesDaConta, emitido: Emitido, motivo: string, doc: DocumentoAFaturar): Promise<void>;
  /** Renova credenciais que caducam (OAuth). Devolve as novas, ou nulo se não há nada a renovar. */
  renovar?(cred: Credenciais): Promise<Credenciais | null>;
  /** OAuth: para onde mandar o clube autorizar. Só nos programas que autorizam assim. */
  urlDeAutorizacao?(redirectUri: string, state: string): string;
  /** OAuth: o código que voltou do programa, trocado pelas credenciais. */
  trocarCodigo?(code: string, redirectUri: string): Promise<Credenciais>;
  /** O programa está configurado no servidor (as chaves da nossa aplicação)? Nos que não precisam, sempre sim. */
  readonly disponivel: boolean;
}

/**
 * Um erro ao falar com o programa.
 *
 * `definitivo` distingue o que repetir não cura (dados recusados, série sem
 * ATCUD, ligação revogada) do que cura (programa em baixo, limite de pedidos).
 * A fila trata-os de forma diferente: o primeiro pára e chama alguém; o
 * segundo volta a tentar mais tarde.
 */
export class ErroDeFaturacao extends Error {
  constructor(
    message: string,
    readonly definitivo: boolean,
    /** O que o programa respondeu, para o registo. Nunca vai ao utilizador. */
    readonly detalhe?: string,
  ) {
    super(message);
    this.name = "ErroDeFaturacao";
  }
}

/** "InvoiceXpress", "Moloni", "Sage One": como se escreve a quem lê. */
export const NOME_DO_PROGRAMA: Record<InvoicingProvider, string> = {
  INVOICEXPRESS: "InvoiceXpress",
  MOLONI: "Moloni",
  SAGE_ONE: "Sage One",
  PHC_GO: "PHC GO",
  VENDUS: "Vendus (Cegid)",
};

/**
 * O preço sem IVA, a partir do pago, para os programas que faturam a partir
 * do líquido. Quatro casas decimais: com duas, 25 € a 23 % dava 20,33 €, que
 * vezes 1,23 são 25,0059 → 25,01 € numa fatura de 25 €. Com quatro, 20,3252
 * vezes 1,23 = 25,000, e o programa arredonda para os 25 € pagos.
 */
export function liquidoDeBruto(brutoCents: number, iva: number): number {
  if (iva === 0) return brutoCents / 100;
  return Math.round((brutoCents / 100 / (1 + iva / 100)) * 10_000) / 10_000;
}

/** "25,00 €" */
export function euros(cents: number): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);
}

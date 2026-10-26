/**
 * De um pagamento a um documento a faturar. Puro: sem base, sem rede.
 *
 * O serviço lê o pagamento e o que ele liquida, e traz para aqui os pedaços
 * (quem pagou, o que pagou, as regras do clube). Daqui sai o documento que
 * qualquer conector sabe emitir. Tem teste (`test:faturacao`).
 */
import {
  REGRAS_SUGERIDAS,
  type ClienteAFaturar,
  type DocumentoAFaturar,
  type LinhaAFaturar,
  type RegraFiscal,
  type RegrasFiscais,
  type TipoDeVenda,
} from "./tipos";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** "2026-10" → "Outubro de 2026". */
export function nomeDoPeriodo(period: string): string {
  const [ano, mes] = period.split("-").map(Number);
  const nome = MESES[(mes ?? 1) - 1];
  return nome && ano ? `${nome} de ${ano}` : period;
}

/** O NIF português é válido? Nove algarismos e o dígito de controlo (mod 11). */
export function nifValido(nif: string | null | undefined): boolean {
  const s = (nif ?? "").replace(/\s/g, "");
  if (!/^\d{9}$/.test(s)) return false;
  if (!/^[1235689]/.test(s)) return false;
  const soma = s
    .slice(0, 8)
    .split("")
    .reduce((acc, d, i) => acc + Number(d) * (9 - i), 0);
  const resto = soma % 11;
  const controlo = resto < 2 ? 0 : 11 - resto;
  return controlo === Number(s[8]);
}

/** O NIF limpo, ou nulo se não presta. Um NIF inválido vale menos do que nenhum: a fatura sai como consumidor final. */
export function nifOuNada(nif: string | null | undefined): string | null {
  const s = (nif ?? "").replace(/\s/g, "");
  return nifValido(s) ? s : null;
}

/** Os dados de faturação que a pessoa guardou na app, lidos de um JSON que pode vir de qualquer lado. */
export function dadosDeFaturacao(json: unknown): Partial<ClienteAFaturar> {
  if (!json || typeof json !== "object") return {};
  const o = json as Record<string, unknown>;
  const texto = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  return {
    nome: texto(o.nome, 100) ?? undefined,
    nif: nifOuNada(texto(o.nif, 20)),
    morada: texto(o.morada, 200),
    codigoPostal: texto(o.codigoPostal, 12),
    localidade: texto(o.localidade, 80),
  };
}

/**
 * O cliente da fatura, a partir do que se sabe de quem pagou.
 *
 * O que a pessoa guardou para faturas (`dados`) ganha ao que a conta diz
 * (`conta`): um pai pode querer a fatura no nome da empresa, ou da avó que
 * paga. Sem nada guardado, vai em nome de quem pagou, sem NIF.
 */
export function clienteDe(conta: { nome: string | null; email: string | null }, dados?: Partial<ClienteAFaturar> | null): ClienteAFaturar {
  return {
    nome: (dados?.nome || conta.nome || "Consumidor final").trim(),
    email: conta.email?.trim() || null,
    nif: dados?.nif ?? null,
    morada: dados?.morada ?? null,
    codigoPostal: dados?.codigoPostal ?? null,
    localidade: dados?.localidade ?? null,
  };
}

/** A regra de um tipo: a do clube, ou a sugerida quando o clube não a mexeu. */
export function regraDe(regras: RegrasFiscais, tipo: TipoDeVenda): RegraFiscal {
  const r = regras.porTipo[tipo];
  return r ? { iva: r.iva, ...(r.iva === 0 && r.isencao ? { isencao: r.isencao } : {}) } : REGRAS_SUGERIDAS[tipo];
}

/** As regras lidas de um JSON que pode vir de qualquer lado. */
export function regrasFiscais(json: unknown): RegrasFiscais {
  if (!json || typeof json !== "object") return { confirmadas: false, porTipo: {} };
  const o = json as Record<string, unknown>;
  const porTipo: RegrasFiscais["porTipo"] = {};
  const fonte = o.porTipo && typeof o.porTipo === "object" ? (o.porTipo as Record<string, unknown>) : {};
  for (const tipo of Object.keys(REGRAS_SUGERIDAS) as TipoDeVenda[]) {
    const r = fonte[tipo];
    if (!r || typeof r !== "object") continue;
    const iva = Number((r as { iva?: unknown }).iva);
    if (![0, 6, 13, 23].includes(iva)) continue;
    const isencao = (r as { isencao?: unknown }).isencao;
    porTipo[tipo] = { iva: iva as RegraFiscal["iva"], ...(iva === 0 && typeof isencao === "string" && /^M\d{2}$/.test(isencao) ? { isencao } : {}) };
  }
  return { confirmadas: o.confirmadas === true, porTipo };
}

/** As regras estão completas? Uma linha a 0 % sem motivo de isenção é recusada por todos os programas. */
export function regrasCompletas(regras: RegrasFiscais): boolean {
  return (Object.keys(REGRAS_SUGERIDAS) as TipoDeVenda[]).every((t) => {
    const r = regraDe(regras, t);
    return r.iva > 0 || Boolean(r.isencao);
  });
}

export type ItemPago = { tipo: TipoDeVenda; descricao: string; quantidade: number; unitarioCents: number };

/**
 * Monta o documento: aplica a regra do clube a cada item, junta a comissão
 * (quando quem paga a suportou) e confere que a soma bate com o pago.
 *
 * A conferência não é paranoia: o programa recebe linhas e calcula o total
 * sozinho, e uma fatura cujo total não é o que a pessoa pagou é um erro
 * fiscal que ninguém apanha a tempo. Se as linhas não somam o pago, não se
 * emite, e o erro diz porquê.
 */
export function montarDocumento(input: {
  cliente: ClienteAFaturar;
  itens: ItemPago[];
  /** A comissão da euPago posta por cima, quando o clube a põe por conta de quem paga. */
  surchargeCents: number;
  totalCents: number;
  regras: RegrasFiscais;
  referencia: string;
  pagoEm: Date;
  metodo: string;
  resumo: string;
}): DocumentoAFaturar {
  const linhas: LinhaAFaturar[] = input.itens
    .filter((i) => i.quantidade > 0)
    .map((i) => ({
      tipo: i.tipo,
      descricao: i.descricao.trim().slice(0, 200),
      quantidade: i.quantidade,
      unitarioCents: i.unitarioCents,
      regra: regraDe(input.regras, i.tipo),
    }));

  if (input.surchargeCents > 0) {
    linhas.push({
      tipo: "TAXA",
      descricao: "Comissão do pagamento online",
      quantidade: 1,
      unitarioCents: input.surchargeCents,
      regra: regraDe(input.regras, "TAXA"),
    });
  }

  const soma = linhas.reduce((n, l) => n + l.quantidade * l.unitarioCents, 0);
  if (soma !== input.totalCents) {
    throw new Error(`As linhas somam ${soma} cêntimos e o pagamento foi de ${input.totalCents}`);
  }
  if (linhas.length === 0) throw new Error("Não há nada a faturar");

  return {
    cliente: input.cliente,
    linhas,
    totalCents: input.totalCents,
    referencia: input.referencia,
    pagoEm: input.pagoEm.toISOString(),
    metodo: input.metodo,
    resumo: input.resumo,
  };
}

/** "MBWAY" → "MB WAY", como se escreve nas observações. */
export function nomeDoMetodo(method: string): string {
  const nomes: Record<string, string> = {
    MBWAY: "MB WAY",
    MULTIBANCO: "Multibanco",
    CARD: "Cartão",
    GOOGLE_PAY: "Google Pay",
    APPLE_PAY: "Apple Pay",
    PAYSAFECARD: "Paysafecard",
    DIRECT_DEBIT: "Débito direto",
    TRANSFER: "Transferência",
    CASH: "Numerário",
  };
  return nomes[method] ?? method;
}

/** "25/10/2026", a data como os programas portugueses a mostram. */
export function diaPt(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** "2026-10-25". */
export function diaIso(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** A frase das observações: de onde veio o dinheiro. */
export function observacoes(doc: DocumentoAFaturar): string {
  return `Pago por ${doc.metodo} a ${diaPt(doc.pagoEm)} (euPago). Ref. ${doc.referencia}.`;
}

/** O motivo de isenção do documento: o da primeira linha isenta. Os programas aceitam um por documento. */
export function isencaoDoDocumento(doc: DocumentoAFaturar): string | null {
  return doc.linhas.find((l) => l.regra.iva === 0)?.regra.isencao ?? null;
}

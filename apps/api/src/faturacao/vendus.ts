/**
 * Vendus (Cegid) — o conector.
 *
 * A Vendus é o programa de faturação na nuvem da Cegid, a casa do Primavera:
 * é para onde a Cegid manda hoje quem procura "Primavera" para uma empresa
 * pequena (o Jasmin deixou de se vender em 2025 e o Primavera V10 vive no
 * servidor do cliente, sem API a que se chegue daqui).
 *
 * Liga-se com uma chave da API, que o clube gera num utilizador dele
 * (Configuração › Utilizadores › API); só nos planos Flex e Pro. Os
 * documentos saem por uma **caixa** (`register_id`), que o clube cria na
 * Vendus e escolhe nas Definições.
 *
 * `POST /documents/` com `type: "FR"` emite a fatura-recibo já final, com
 * número e ATCUD, e devolve o link do PDF. `tx_id` é a nossa referência: a
 * Vendus só emite um documento por `tx_id`, o que é a idempotência que a
 * fila precisa. As taxas vão por código (`NOR`, `INT`, `RED`, `ISE`) e o
 * preço é o pago (`gross_price`). Uma fatura-recibo não se anula: passa-se
 * uma nota de crédito a apontar para ela.
 *
 * Documentação: https://www.vendus.pt/ws/ (v1.1).
 */
import type { InvoicingProvider } from "@prisma/client";
import { descarregar, erroDaResposta, mensagemDoPrograma, pedir, type Resposta } from "./http";
import { diaIso, observacoes } from "./documento";
import {
  ErroDeFaturacao,
  type Conector,
  type Credenciais,
  type DefinicoesDaConta,
  type DocumentoAFaturar,
  type Emitido,
  type Opcoes,
  type TipoDeVenda,
} from "./tipos";

const PROGRAMA = "A Vendus";
const BASE = "https://www.vendus.pt/ws/v1.1";

const REFERENCIA: Record<TipoDeVenda, string> = {
  MENSALIDADE: "AC-MENS",
  EXTRA: "AC-EXTRA",
  QUOTA: "AC-QUOTA",
  BILHETE: "AC-BILH",
  LOJA: "AC-LOJA",
  ENVIO: "AC-ENVIO",
  TAXA: "AC-TAXA",
};

const TAXA: Record<number, string> = { 0: "ISE", 6: "RED", 13: "INT", 23: "NOR" };

type Cred = Extract<Credenciais, { provider: "VENDUS" }>;

export class Vendus implements Conector {
  readonly provider: InvoicingProvider = "VENDUS";
  readonly disponivel = true;

  private cred(c: Credenciais): Cred {
    if (c.provider !== "VENDUS") throw new ErroDeFaturacao("Credenciais de outro programa", true);
    return c;
  }

  private async chamar(c: Cred, metodo: "GET" | "POST" | "PATCH", caminho: string, corpo?: unknown): Promise<Resposta> {
    return pedir(
      `${BASE}${caminho}`,
      {
        method: metodo,
        headers: { Authorization: `Bearer ${c.apiKey.trim()}`, Accept: "application/json", ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}) },
        ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
      },
      PROGRAMA,
    );
  }

  private ok(r: Resposta, oQue: string): Record<string, unknown> {
    if (r.status === 401 || r.status === 403) throw new ErroDeFaturacao("A Vendus recusou a chave da API. Confirma-a nas Definições › Faturação (e que o plano é Flex ou Pro).", true, r.texto.slice(0, 300));
    if (r.status !== 200 && r.status !== 201) throw erroDaResposta(r, PROGRAMA, oQue);
    return (r.json ?? {}) as Record<string, unknown>;
  }

  async verificar(cred: Credenciais): Promise<{ nome: string }> {
    const c = this.cred(cred);
    const r = await this.chamar(c, "GET", "/registers/");
    this.ok(r, "a verificação");
    const conta = await this.chamar(c, "GET", "/account/").catch(() => null);
    const nome = conta && conta.status === 200 ? String((conta.json as { name?: string; title?: string } | null)?.name ?? (conta.json as { title?: string } | null)?.title ?? "") : "";
    return { nome: nome || "Vendus" };
  }

  async opcoes(cred: Credenciais): Promise<Opcoes> {
    const c = this.cred(cred);
    const [caixas, metodos] = await Promise.all([this.chamar(c, "GET", "/registers/"), this.chamar(c, "GET", "/documents/paymentmethods/")]);
    const lista = (r: Resposta, oQue: string) => (Array.isArray(this.ok(r, oQue)) ? (r.json as Record<string, unknown>[]) : []);
    return {
      series: lista(caixas, "as caixas").map((x) => ({ id: String(x.id), label: String(x.title ?? x.name ?? x.id), detalhe: x.type ? `caixa ${String(x.type)}` : undefined, porOmissao: String(x.type ?? "") === "api" })),
      metodosDePagamento: lista(metodos, "os métodos de pagamento").map((m) => ({ id: String(m.id), label: String(m.title ?? m.name ?? m.id), porOmissao: /mb ?way|multibanco|eupago|cart[ãa]o|online/i.test(String(m.title ?? m.name ?? "")) })),
    };
  }

  porDefinir(def: DefinicoesDaConta): string[] {
    const falta: string[] = [];
    if (!def.serieId) falta.push("a caixa (registo) por onde saem os documentos");
    if (!def.paymentMethodId) falta.push("o método de pagamento");
    return falta;
  }

  async procurar(cred: Credenciais, _def: DefinicoesDaConta, referencia: string): Promise<Emitido | null> {
    const c = this.cred(cred);
    const r = await this.chamar(c, "GET", `/documents/?external_reference=${encodeURIComponent(referencia)}&type=FR&per_page=5`);
    if (r.status !== 200 || !Array.isArray(r.json)) return null;
    const nossa = (r.json as Record<string, unknown>[]).find((d) => String(d.external_reference ?? "") === referencia && String(d.status ?? "") !== "A");
    return nossa ? this.emitidoDe(nossa) : null;
  }

  async emitir(cred: Credenciais, def: DefinicoesDaConta, doc: DocumentoAFaturar): Promise<Emitido> {
    const c = this.cred(cred);
    const r = await this.chamar(c, "POST", "/documents/", {
      type: "FR",
      register_id: Number(def.serieId),
      mode: "normal",
      date: diaIso(doc.pagoEm),
      external_reference: doc.referencia,
      tx_id: doc.referencia,
      notes: observacoes(doc),
      client: {
        name: doc.cliente.nome.slice(0, 100),
        ...(doc.cliente.nif ? { fiscal_id: doc.cliente.nif } : {}),
        ...(doc.cliente.email ? { email: doc.cliente.email } : {}),
        ...(doc.cliente.morada ? { address: doc.cliente.morada } : {}),
        ...(doc.cliente.codigoPostal ? { postalcode: doc.cliente.codigoPostal } : {}),
        ...(doc.cliente.localidade ? { city: doc.cliente.localidade } : {}),
        country: "PT",
        // O email sai por nós, com o PDF, como nos outros programas.
        send_email: "no",
      },
      items: doc.linhas.map((l) => ({
        reference: REFERENCIA[l.tipo],
        title: l.descricao.slice(0, 100),
        qty: l.quantidade,
        gross_price: l.unitarioCents / 100,
        tax_id: TAXA[l.regra.iva] ?? "NOR",
        ...(l.regra.iva === 0 ? { tax_exemption: l.regra.isencao ?? "M07" } : {}),
      })),
      payments: [{ id: Number(def.paymentMethodId), amount: doc.totalCents / 100 }],
      output: "pdf_url",
      errors_full: "yes",
    });
    if (r.status === 409 || (r.status === 400 && /tx_id/i.test(r.texto))) {
      throw new ErroDeFaturacao("A Vendus já tem um documento com esta referência. Voltamos a tentar daqui a pouco.", false, r.texto.slice(0, 300));
    }
    const j = this.ok(r, `a fatura-recibo: ${mensagemDoPrograma(r) ?? ""}`.replace(/: $/, ""));
    if (!j.id) throw new ErroDeFaturacao(`A Vendus não devolveu o documento: ${mensagemDoPrograma(r) ?? "sem mensagem"}.`, true, r.texto.slice(0, 500));
    const total = Math.round(Number(j.amount_gross ?? j.total ?? NaN) * 100);
    if (Number.isFinite(total) && total !== doc.totalCents) {
      throw new ErroDeFaturacao(`A Vendus calculou ${(total / 100).toFixed(2)} € e o pagamento foi de ${(doc.totalCents / 100).toFixed(2)} €. A fatura ficou emitida na Vendus: confere-a lá e as taxas de IVA nas Definições.`, true);
    }
    return this.emitidoDe(j);
  }

  private emitidoDe(d: Record<string, unknown>): Emitido {
    const saida = typeof d.output === "string" && d.output.startsWith("http") ? d.output : null;
    return {
      externalId: String(d.id),
      number: d.number ? String(d.number) : null,
      atcud: d.atcud ? String(d.atcud) : null,
      permalink: saida,
    };
  }

  async pdf(cred: Credenciais, _def: DefinicoesDaConta, emitido: Emitido): Promise<Buffer> {
    const c = this.cred(cred);
    const f = await descarregar(`${BASE}/documents/${emitido.externalId}.pdf?download=yes`, { headers: { Authorization: `Bearer ${c.apiKey.trim()}` } }, PROGRAMA);
    if (f.status === 200 && f.corpo.subarray(0, 4).toString() === "%PDF") return f.corpo;
    if (emitido.permalink) {
      const g = await descarregar(emitido.permalink, {}, PROGRAMA);
      if (g.status === 200 && g.corpo.subarray(0, 4).toString() === "%PDF") return g.corpo;
    }
    if (f.status === 401 || f.status === 403) throw new ErroDeFaturacao("A Vendus recusou a chave da API ao pedir o PDF.", true);
    throw new ErroDeFaturacao("A Vendus não devolveu o PDF. Voltamos a tentar mais tarde.", false, f.corpo.subarray(0, 200).toString());
  }

  /** Uma fatura-recibo não se anula na Vendus: passa-se a nota de crédito com as linhas dela. */
  async anular(cred: Credenciais, def: DefinicoesDaConta, emitido: Emitido, motivo: string, doc: DocumentoAFaturar): Promise<void> {
    const c = this.cred(cred);
    const r = await this.chamar(c, "POST", "/documents/", {
      type: "NC",
      register_id: Number(def.serieId),
      mode: "normal",
      external_reference: `${doc.referencia}-NC`,
      tx_id: `${doc.referencia}-NC`,
      notes: motivo.slice(0, 200) || "Pagamento devolvido",
      client: { name: doc.cliente.nome.slice(0, 100), ...(doc.cliente.nif ? { fiscal_id: doc.cliente.nif } : {}), country: "PT", send_email: "no" },
      items: doc.linhas.map((l, i) => ({
        reference: REFERENCIA[l.tipo],
        title: l.descricao.slice(0, 100),
        qty: l.quantidade,
        gross_price: l.unitarioCents / 100,
        tax_id: TAXA[l.regra.iva] ?? "NOR",
        ...(l.regra.iva === 0 ? { tax_exemption: l.regra.isencao ?? "M07" } : {}),
        reference_document: { document_number: emitido.number ?? emitido.externalId, document_row: i + 1 },
      })),
      errors_full: "yes",
    });
    this.ok(r, "a nota de crédito");
  }
}

/**
 * InvoiceXpress — o conector.
 *
 * A conta é um subdomínio (`<conta>.app.invoicexpress.com`) e a chave vai em
 * `?api_key=` em todos os pedidos; o clube copia as duas do programa, como
 * copia as da euPago. Emite-se uma **fatura-recibo** por pagamento: nasce
 * rascunho e um `change-state: finalized` fecha-a já como paga. O PDF pede-se
 * a seguir (o programa gera-o em segundo plano; 202 até estar pronto).
 *
 * Três coisas que a API faz e que não são óbvias, e que decidem o desenho:
 *
 * - **as taxas vão pelo nome** (`IVA23`), e um nome que não exista aplica a
 *   taxa por omissão **sem erro**. Por isso `preparar` resolve os nomes das
 *   taxas da conta e guarda-os; nunca se envia um nome adivinhado;
 * - **cada linha fica no catálogo de artigos pelo nome**, e um nome que já
 *   exista é reescrito com o preço que se mandar. Os nossos nomes são
 *   genéricos e nossos ("Mensalidade", "Quota de sócio"), e o detalhe vai na
 *   descrição, para não reescrever artigos do clube;
 * - **o cliente é encontrado pelo código** antes do nome. Dois "João Silva"
 *   sem código eram a mesma pessoa; o código é o NIF, ou um código nosso
 *   derivado do email quando não há NIF.
 *
 * Documentação: https://docs.invoicexpress.com e invoicexpress.com/api-v2.
 */
import { createHash } from "node:crypto";
import type { InvoicingProvider } from "@prisma/client";
import { descarregar, erroDaResposta, pedir } from "./http";
import { diaPt, isencaoDoDocumento, observacoes } from "./documento";
import {
  ErroDeFaturacao,
  liquidoDeBruto,
  type Conector,
  type Credenciais,
  type DefinicoesDaConta,
  type DocumentoAFaturar,
  type Emitido,
  type Opcoes,
  type TipoDeVenda,
} from "./tipos";

const PROGRAMA = "A InvoiceXpress";

/** Os nomes dos artigos no catálogo do clube. Nossos, genéricos, curtos (60 no máximo). */
const ARTIGO: Record<TipoDeVenda, string> = {
  MENSALIDADE: "Mensalidade",
  EXTRA: "Cobrança avulsa",
  QUOTA: "Quota de sócio",
  BILHETE: "Bilhete",
  LOJA: "Artigo da loja",
  ENVIO: "Portes de envio",
  TAXA: "Comissão do pagamento",
};

type Cred = Extract<Credenciais, { provider: "INVOICEXPRESS" }>;

export class InvoiceXpress implements Conector {
  readonly provider: InvoicingProvider = "INVOICEXPRESS";
  readonly disponivel = true;

  private cred(c: Credenciais): Cred {
    if (c.provider !== "INVOICEXPRESS") throw new ErroDeFaturacao("Credenciais de outro programa", true);
    return c;
  }

  private url(c: Cred, caminho: string, query: Record<string, string> = {}): string {
    const conta = c.accountName.trim().toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(conta)) throw new ErroDeFaturacao("O nome da conta InvoiceXpress só tem letras, números e hífens.", true);
    const q = new URLSearchParams({ api_key: c.apiKey.trim(), ...query });
    return `https://${conta}.app.invoicexpress.com${caminho}?${q.toString()}`;
  }

  private async chamar(c: Cred, metodo: "GET" | "POST" | "PUT", caminho: string, corpo?: unknown, query?: Record<string, string>) {
    return pedir(
      this.url(c, caminho, query),
      {
        method: metodo,
        headers: { Accept: "application/json", ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}) },
        ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
      },
      PROGRAMA,
    );
  }

  async verificar(cred: Credenciais): Promise<{ nome: string }> {
    const c = this.cred(cred);
    const r = await this.chamar(c, "GET", "/taxes.json");
    if (r.status === 200) return { nome: c.accountName.trim().toLowerCase() };
    if (r.status === 401) throw new ErroDeFaturacao("A InvoiceXpress não reconheceu a chave. Confirma o nome da conta e a chave da API.", true, r.texto.slice(0, 300));
    if (r.status === 404 || r.status === 301 || r.status === 302) throw new ErroDeFaturacao("Não há nenhuma conta InvoiceXpress com esse nome.", true);
    throw erroDaResposta(r, PROGRAMA, "a verificação");
  }

  async opcoes(cred: Credenciais): Promise<Opcoes> {
    const c = this.cred(cred);
    const r = await this.chamar(c, "GET", "/sequences.json");
    if (r.status !== 200) throw erroDaResposta(r, PROGRAMA, "a lista de séries");
    const lista = ((r.json as { sequences?: unknown[] })?.sequences ?? []) as Record<string, unknown>[];
    return {
      series: lista.map((s) => {
        const codigo = String(s.current_invoice_receipt_validation_code ?? "");
        const semAtcud = codigo === "N/D" || codigo === "N/A" || codigo === "";
        return {
          id: String(s.id),
          label: String(s.serie ?? s.id),
          porOmissao: Number(s.default_sequence) === 1,
          detalhe: semAtcud ? undefined : `ATCUD ${codigo}`,
          aviso: semAtcud ? "Esta série não está registada na AT para faturas-recibo: as faturas sairiam sem ATCUD válido." : undefined,
        };
      }),
    };
  }

  porDefinir(): string[] {
    // A série é opcional: sem ela vale a série por omissão da conta.
    return [];
  }

  /**
   * Os nomes das taxas da conta, por percentagem. Uma taxa a 0 % que não
   * exista é criada (`IVA0`, código ISE): as linhas isentas precisam dela.
   */
  async preparar(cred: Credenciais, def: DefinicoesDaConta): Promise<DefinicoesDaConta> {
    const c = this.cred(cred);
    const r = await this.chamar(c, "GET", "/taxes.json");
    if (r.status !== 200) throw erroDaResposta(r, PROGRAMA, "a lista de taxas");
    const taxas = ((r.json as { taxes?: unknown[] })?.taxes ?? []) as { name?: string; value?: string | number; region?: string; default_tax?: number }[];

    const nomeDe = (iva: number): string | null => {
      const candidatas = taxas.filter((t) => Math.round(Number(t.value) * 100) === iva * 100 && t.name);
      const pt = candidatas.filter((t) => !t.region || t.region === "PT");
      const escolhida = (pt.length ? pt : candidatas).sort((a, b) => Number(b.default_tax ?? 0) - Number(a.default_tax ?? 0))[0];
      return escolhida?.name ?? null;
    };

    const interno: Record<string, string> = { ...(def.interno ?? {}) };
    for (const iva of [0, 6, 13, 23]) {
      let nome = nomeDe(iva);
      if (!nome && iva === 0) {
        const criada = await this.chamar(c, "POST", "/taxes.json", { tax: { name: "IVA0", value: "0.0", region: "PT", code: "ISE" } });
        if (criada.status !== 201 && criada.status !== 200) throw erroDaResposta(criada, PROGRAMA, "a criação da taxa a 0 %");
        nome = "IVA0";
      }
      if (nome) interno[`taxa${iva}`] = nome;
      else delete interno[`taxa${iva}`];
    }
    interno.preparadoEm = new Date().toISOString();
    return { ...def, interno };
  }

  async procurar(cred: Credenciais, def: DefinicoesDaConta, referencia: string): Promise<Emitido | null> {
    const c = this.cred(cred);
    const q = new URLSearchParams();
    q.append("type[]", "InvoiceReceipt");
    for (const s of ["draft", "final", "settled"]) q.append("status[]", s);
    q.append("non_archived", "true");
    q.append("reference", referencia);
    const r = await pedir(`${this.url(c, "/invoices.json")}&${q.toString()}`, { headers: { Accept: "application/json" } }, PROGRAMA);
    if (r.status !== 200) throw erroDaResposta(r, PROGRAMA, "a procura de faturas");
    const lista = ((r.json as { invoices?: unknown[] })?.invoices ?? []) as Record<string, unknown>[];
    const nossa = lista.find((i) => String(i.reference ?? "") === referencia);
    if (!nossa) return null;
    if (String(nossa.status) === "draft") return this.finalizar(c, String(nossa.id));
    return this.emitidoDe(nossa);
  }

  async emitir(cred: Credenciais, def: DefinicoesDaConta, doc: DocumentoAFaturar): Promise<Emitido> {
    const c = this.cred(cred);
    const taxas = def.interno ?? {};
    const isencao = isencaoDoDocumento(doc);

    const items = doc.linhas.map((l) => {
      const taxa = taxas[`taxa${l.regra.iva}`];
      if (!taxa) throw new ErroDeFaturacao(`A conta InvoiceXpress não tem uma taxa de IVA a ${l.regra.iva} %. Cria-a no programa e volta a preparar a ligação.`, true);
      return {
        name: ARTIGO[l.tipo],
        description: l.descricao.slice(0, 200),
        unit_price: liquidoDeBruto(l.unitarioCents, l.regra.iva),
        quantity: l.quantidade,
        tax: { name: taxa },
      };
    });

    const cliente = {
      name: doc.cliente.nome.slice(0, 100),
      code: codigoDoCliente(doc.cliente),
      ...(doc.cliente.email ? { email: doc.cliente.email.slice(0, 254) } : {}),
      ...(doc.cliente.nif ? { fiscal_id: doc.cliente.nif } : {}),
      ...(doc.cliente.morada ? { address: doc.cliente.morada.slice(0, 200) } : {}),
      ...(doc.cliente.codigoPostal ? { postal_code: doc.cliente.codigoPostal } : {}),
      ...(doc.cliente.localidade ? { city: doc.cliente.localidade.slice(0, 80) } : {}),
      country: "Portugal",
    };

    const corpo = {
      invoice: {
        date: diaPt(doc.pagoEm),
        due_date: diaPt(doc.pagoEm),
        reference: doc.referencia,
        observations: observacoes(doc),
        ...(isencao ? { tax_exemption: isencao } : {}),
        ...(def.serieId ? { sequence_id: def.serieId } : {}),
        client: cliente,
        items,
      },
      proprietary_uid: doc.referencia,
    };

    const r = await this.chamar(c, "POST", "/invoice_receipts.json", corpo);
    if (r.status === 409) {
      // Outra emissão da mesma referência a decorrer: a fila volta daqui a pouco e `procurar` encontra-a.
      throw new ErroDeFaturacao("A InvoiceXpress ainda está a criar esta fatura. Voltamos a tentar daqui a pouco.", false, r.texto.slice(0, 300));
    }
    if (r.status !== 201 && r.status !== 200) throw erroDaResposta(r, PROGRAMA, "a criação da fatura-recibo");
    const criada = ((r.json as Record<string, unknown>)?.invoice_receipt ?? (r.json as Record<string, unknown>)?.invoice) as Record<string, unknown> | undefined;
    if (!criada?.id) throw new ErroDeFaturacao("A InvoiceXpress criou a fatura mas não devolveu o id dela.", true, r.texto.slice(0, 300));

    return this.finalizar(c, String(criada.id));
  }

  /** Rascunho → emitida e paga, num passo. É aqui que nasce o número, o ATCUD e o hash. */
  private async finalizar(c: Cred, id: string): Promise<Emitido> {
    const r = await this.chamar(c, "PUT", `/invoice_receipts/${id}/change-state.json`, { invoice: { state: "finalized" } });
    if (r.status !== 200) throw erroDaResposta(r, PROGRAMA, "a emissão da fatura-recibo");
    const doc = ((r.json as Record<string, unknown>)?.invoice_receipt ?? (r.json as Record<string, unknown>)?.invoice ?? {}) as Record<string, unknown>;
    const emitido = this.emitidoDe({ ...doc, id: doc.id ?? id });
    if (emitido.atcud === "N/D") {
      throw new ErroDeFaturacao(
        `A fatura ${emitido.number ?? id} saiu sem ATCUD: a série não está registada na AT. Regista-a na InvoiceXpress e volta a tentar.`,
        true,
      );
    }
    return emitido;
  }

  private emitidoDe(d: Record<string, unknown>): Emitido {
    const atcud = d.atcud != null ? String(d.atcud) : null;
    return {
      externalId: String(d.id),
      number: d.sequence_number != null ? `FR ${String(d.sequence_number)}` : null,
      atcud: atcud && atcud !== "N/A" ? atcud : null,
      permalink: d.permalink != null ? String(d.permalink) : null,
    };
  }

  async pdf(cred: Credenciais, _def: DefinicoesDaConta, emitido: Emitido): Promise<Buffer> {
    const c = this.cred(cred);
    // A geração é assíncrona: 202 até estar pronto. Até uns 40 s, a espaçar.
    let url: string | null = null;
    for (let tentativa = 0; tentativa < 12 && !url; tentativa++) {
      const r = await this.chamar(c, "GET", `/api/pdf/${emitido.externalId}.json`, undefined, { second_copy: "false" });
      if (r.status === 200) url = String((r.json as { output?: { pdfUrl?: string } })?.output?.pdfUrl ?? "");
      else if (r.status !== 202) throw erroDaResposta(r, PROGRAMA, "o PDF");
      if (!url) await new Promise((f) => setTimeout(f, 1500 + tentativa * 1000));
    }
    if (!url) throw new ErroDeFaturacao("A InvoiceXpress ainda não acabou de gerar o PDF. Voltamos a tentar mais tarde.", false);
    const f = await descarregar(url, {}, PROGRAMA);
    if (f.status !== 200 || f.corpo.length < 100) throw new ErroDeFaturacao("O PDF da InvoiceXpress veio vazio. Voltamos a tentar mais tarde.", false);
    return f.corpo;
  }

  async anular(cred: Credenciais, _def: DefinicoesDaConta, emitido: Emitido, motivo: string): Promise<void> {
    const c = this.cred(cred);
    const r = await this.chamar(c, "PUT", `/invoice_receipts/${emitido.externalId}/change-state.json`, {
      invoice: { state: "canceled", message: motivo.slice(0, 200) || "Pagamento devolvido" },
    });
    if (r.status !== 200) throw erroDaResposta(r, PROGRAMA, "a anulação");
  }
}

/** O código do cliente no catálogo: o NIF, ou um código nosso estável a partir do email (ou do nome). */
export function codigoDoCliente(cliente: { nif: string | null; email: string | null; nome: string }): string {
  if (cliente.nif) return cliente.nif;
  const base = (cliente.email?.trim().toLowerCase() || cliente.nome.trim().toLowerCase()) ?? "";
  return "AC-" + createHash("sha1").update(base).digest("hex").slice(0, 12).toUpperCase();
}

/**
 * Moloni — o conector.
 *
 * O clube não copia chaves: autoriza-nos na página da Moloni (OAuth 2.0) e
 * ficamos com um par de tokens, o de acesso a valer uma hora e o de renovação
 * catorze dias. Cada renovação devolve um par novo; é a fila que os mantém
 * vivos (`renovar`), senão um clube que vende pouco caía ao fim de duas
 * semanas e tinha de autorizar outra vez.
 *
 * A API é RPC: `POST /v1/<recurso>/<método>/?access_token=…`, com o corpo em
 * JSON quando se pede `json=true`. Tudo precisa de `company_id`: uma conta
 * pode ter várias empresas, e o clube escolhe a dele nas Definições.
 *
 * As linhas de um documento precisam de um `product_id`. Por isso `preparar`
 * cria uma vez, na conta do clube, um produto genérico por tipo de venda
 * (`ACAD-MENSALIDADE`, …) numa categoria "Academias"; o nome e o preço de
 * cada linha são os nossos, por cima do produto. Os preços vão **sem IVA**
 * (`liquidoDeBruto`), com a taxa da empresa na linha; as linhas isentas vão
 * sem taxa e com o motivo.
 *
 * Documentação: https://www.moloni.pt/dev/ e o plugin oficial para o
 * WooCommerce (github.com/moloni-pt/woocommerce), que é onde se vê o que a
 * documentação não diz.
 */
import type { InvoicingProvider } from "@prisma/client";
import { descarregar, mensagemDoPrograma, pedir } from "./http";
import { diaIso, isencaoDoDocumento, observacoes } from "./documento";
import {
  ErroDeFaturacao,
  TIPOS_DE_VENDA,
  liquidoDeBruto,
  type Conector,
  type Credenciais,
  type DefinicoesDaConta,
  type DocumentoAFaturar,
  type Emitido,
  type Opcoes,
  type TipoDeVenda,
} from "./tipos";

const PROGRAMA = "A Moloni";
const BASE = "https://api.moloni.pt/v1";
const AUTORIZAR = "https://www.moloni.pt/ac/root/oauth/";
/** O NIF do consumidor final, que a Moloni aceita num cliente sem NIF. */
const CONSUMIDOR_FINAL = "999999990";
/** A fatura-recibo, no catálogo de tipos de documento da Moloni. */
const TIPO_FATURA_RECIBO = 27;

type Cred = Extract<Credenciais, { provider: "MOLONI" }>;
type Linha = Record<string, unknown>;

export class Moloni implements Conector {
  readonly provider: InvoicingProvider = "MOLONI";

  constructor(private readonly app: { clientId: string; clientSecret: string }) {}

  get disponivel(): boolean {
    return Boolean(this.app.clientId && this.app.clientSecret);
  }

  private cred(c: Credenciais): Cred {
    if (c.provider !== "MOLONI") throw new ErroDeFaturacao("Credenciais de outro programa", true);
    return c;
  }

  /* ---------------------------------------------------------------------- */
  /* OAuth                                                                   */
  /* ---------------------------------------------------------------------- */

  urlDeAutorizacao(redirectUri: string, state: string): string {
    const q = new URLSearchParams({ response_type: "code", client_id: this.app.clientId, redirect_uri: redirectUri, state });
    return `${AUTORIZAR}?${q.toString()}`;
  }

  async trocarCodigo(code: string, redirectUri: string): Promise<Credenciais> {
    const q = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.app.clientId,
      client_secret: this.app.clientSecret,
      redirect_uri: redirectUri,
      code,
    });
    return this.tokens(q);
  }

  async renovar(cred: Credenciais): Promise<Credenciais | null> {
    const c = this.cred(cred);
    // Renova-se com folga: a fila passa de cinco em cinco minutos e o token
    // vale uma hora; renovar a meia hora do fim nunca deixa uma emissão
    // apanhá-lo caducado. Cada renovação é também um refresh token novo.
    if (new Date(c.expiresAt).getTime() - Date.now() > 30 * 60_000) return null;
    const q = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.app.clientId,
      client_secret: this.app.clientSecret,
      refresh_token: c.refreshToken,
    });
    return this.tokens(q);
  }

  private async tokens(q: URLSearchParams): Promise<Cred> {
    const r = await pedir(`${BASE}/grant/?${q.toString()}`, { headers: { Accept: "application/json" } }, PROGRAMA);
    const j = r.json as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
    if (r.status !== 200 || !j?.access_token || !j.refresh_token) {
      const expirado = j?.error === "invalid_grant";
      throw new ErroDeFaturacao(
        expirado
          ? "A autorização da Moloni caducou. O clube tem de voltar a autorizar nas Definições › Faturação."
          : `A Moloni recusou a autorização: ${j?.error_description ?? j?.error ?? `erro ${r.status}`}.`,
        true,
        r.texto.slice(0, 300),
      );
    }
    return {
      provider: "MOLONI",
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresAt: new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000).toISOString(),
    };
  }

  /* ---------------------------------------------------------------------- */
  /* As chamadas                                                             */
  /* ---------------------------------------------------------------------- */

  private async chamar<T = unknown>(c: Cred, recurso: string, corpo: Record<string, unknown>): Promise<T> {
    const q = new URLSearchParams({ access_token: c.accessToken, json: "true", human_errors: "true" });
    const r = await pedir(
      `${BASE}/${recurso}/?${q.toString()}`,
      { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(corpo) },
      PROGRAMA,
    );
    const j = r.json as Record<string, unknown> | unknown[] | null;

    if (r.status === 401 || (j && !Array.isArray(j) && typeof j.error === "string" && /invalid_(grant|token)|expired/i.test(String(j.error_description ?? j.error)))) {
      throw new ErroDeFaturacao("A Moloni recusou o acesso: o clube tem de voltar a autorizar nas Definições › Faturação.", true, r.texto.slice(0, 300));
    }
    if (r.status === 429) throw new ErroDeFaturacao("A Moloni pediu para abrandar. Voltamos a tentar mais tarde.", false);
    if (r.status >= 500) throw new ErroDeFaturacao("A Moloni está com problemas. Voltamos a tentar mais tarde.", false, r.texto.slice(0, 300));

    /*
     * Os erros de dados vêm com 200 e uma lista de `{ code, description }`
     * (com `human_errors`) ou de frases "1 name"; e os `insert`/`update`
     * respondem `{ valid: 0 }` quando não gravaram. Tudo isso é definitivo:
     * mandar o mesmo outra vez dá o mesmo.
     */
    const erroDeDados =
      (Array.isArray(j) && j.length > 0 && j.every((x) => typeof x === "string" || (x && typeof x === "object" && ("code" in (x as object) || "description" in (x as object))))) ||
      (j && !Array.isArray(j) && (typeof j.error === "string" || j.valid === 0 || j.valid === "0"));
    if (r.status !== 200 || erroDeDados) {
      throw new ErroDeFaturacao(`A Moloni recusou o pedido a ${recurso}: ${mensagemDoPrograma(r) ?? `erro ${r.status}`}.`, true, r.texto.slice(0, 500));
    }
    return j as T;
  }

  private empresa(def: DefinicoesDaConta): number {
    const id = Number(def.companyId);
    if (!id) throw new ErroDeFaturacao("Falta escolher a empresa da Moloni nas Definições › Faturação.", true);
    return id;
  }

  async verificar(cred: Credenciais): Promise<{ nome: string }> {
    const c = this.cred(cred);
    const empresas = await this.chamar<{ company_id: number; name: string }[]>(c, "companies/getAll", {});
    if (!Array.isArray(empresas) || empresas.length === 0) throw new ErroDeFaturacao("A conta Moloni não tem nenhuma empresa.", true);
    return { nome: empresas.length === 1 ? empresas[0]!.name : `${empresas.length} empresas` };
  }

  async opcoes(cred: Credenciais, def: DefinicoesDaConta): Promise<Opcoes> {
    const c = this.cred(cred);
    const empresas = await this.chamar<{ company_id: number; name: string; vat?: string }[]>(c, "companies/getAll", {});
    const opcoes: Opcoes = {
      empresas: empresas.map((e) => ({ id: String(e.company_id), label: e.name, detalhe: e.vat ? `NIF ${e.vat}` : undefined, porOmissao: empresas.length === 1 })),
    };
    if (!def.companyId) return opcoes;
    const company_id = this.empresa(def);
    const [series, metodos] = await Promise.all([
      this.chamar<{ document_set_id: number; name: string; active_by_default?: number }[]>(c, "documentSets/getAll", { company_id }),
      this.chamar<{ payment_method_id: number; name: string }[]>(c, "paymentMethods/getAll", { company_id }),
    ]);
    opcoes.series = series.map((s) => ({ id: String(s.document_set_id), label: s.name, porOmissao: Number(s.active_by_default) === 1 }));
    opcoes.metodosDePagamento = metodos.map((m) => ({ id: String(m.payment_method_id), label: m.name, porOmissao: /mb ?way|multibanco|eupago/i.test(m.name) }));
    return opcoes;
  }

  porDefinir(def: DefinicoesDaConta): string[] {
    const falta: string[] = [];
    if (!def.companyId) falta.push("a empresa");
    if (!def.serieId) falta.push("a série");
    if (!def.paymentMethodId) falta.push("o método de pagamento");
    return falta;
  }

  /**
   * O que a conta precisa de ter antes da primeira fatura: as taxas por
   * percentagem, uma unidade, a categoria e um produto por tipo de venda, e a
   * condição "pronto pagamento" para os clientes. Tudo procurado antes de
   * criado, para correr as vezes que for preciso sem duplicar nada.
   */
  async preparar(cred: Credenciais, def: DefinicoesDaConta): Promise<DefinicoesDaConta> {
    const c = this.cred(cred);
    const company_id = this.empresa(def);
    const interno: Record<string, string> = { ...(def.interno ?? {}) };

    const taxas = await this.chamar<{ tax_id: number; value: number | string; saft_type?: number | string; fiscal_zone?: string; active_by_default?: number | string }[]>(c, "taxes/getAll", { company_id });
    for (const iva of [6, 13, 23]) {
      const candidatas = taxas.filter((t) => Math.round(Number(t.value) * 100) === iva * 100 && Number(t.saft_type ?? 1) === 1 && (!t.fiscal_zone || t.fiscal_zone === "PT"));
      const escolhida = candidatas.sort((a, b) => Number(b.active_by_default ?? 0) - Number(a.active_by_default ?? 0))[0];
      if (escolhida) interno[`taxa${iva}`] = String(escolhida.tax_id);
      else delete interno[`taxa${iva}`];
    }

    if (!interno.unitId) {
      const unidades = await this.chamar<{ unit_id: number; name: string; short_name?: string }[]>(c, "measurementUnits/getAll", { company_id });
      let unidade = unidades.find((u) => /^(un|unid|unidade)/i.test(u.short_name ?? u.name)) ?? unidades[0];
      if (!unidade) {
        const criada = await this.chamar<{ unit_id: number }>(c, "measurementUnits/insert", { company_id, name: "Unidade", short_name: "un" });
        unidade = { unit_id: criada.unit_id, name: "Unidade" };
      }
      interno.unitId = String(unidade.unit_id);
    }

    if (!interno.categoryId) {
      const categorias = await this.chamar<{ category_id: number; name: string }[]>(c, "productCategories/getAll", { company_id, parent_id: 0 });
      let categoria = categorias.find((x) => x.name === "Academias");
      if (!categoria) {
        const criada = await this.chamar<{ category_id: number }>(c, "productCategories/insert", { company_id, parent_id: 0, name: "Academias", description: "Vendas da plataforma Academias" });
        categoria = { category_id: criada.category_id, name: "Academias" };
      }
      interno.categoryId = String(categoria.category_id);
    }

    if (!interno.maturityDateId) {
      const prazos = await this.chamar<{ maturity_date_id: number; days?: number; name: string }[]>(c, "maturityDates/getAll", { company_id });
      const pronto = prazos.find((p) => Number(p.days) === 0) ?? prazos[0];
      if (!pronto) throw new ErroDeFaturacao("A empresa Moloni não tem nenhuma condição de pagamento. Cria uma (pronto pagamento) no programa.", true);
      interno.maturityDateId = String(pronto.maturity_date_id);
    }

    for (const { tipo, label } of TIPOS_DE_VENDA) {
      const chave = `produto_${tipo}`;
      if (interno[chave]) continue;
      const reference = `ACAD-${tipo}`;
      const existentes = await this.chamar<{ product_id: number; reference: string }[]>(c, "products/getByReference", { company_id, reference, exact: 1 });
      const existente = Array.isArray(existentes) ? existentes.find((p) => p.reference === reference) : undefined;
      if (existente) {
        interno[chave] = String(existente.product_id);
        continue;
      }
      const criado = await this.chamar<{ product_id: number }>(c, "products/insert", {
        company_id,
        category_id: Number(interno.categoryId),
        type: 2,
        name: label,
        reference,
        price: 0,
        unit_id: Number(interno.unitId),
        has_stock: 0,
        stock: 0,
        // Um produto nasce isento; cada linha traz a sua taxa por cima dele.
        exemption_reason: "M07",
      });
      interno[chave] = String(criado.product_id);
    }

    interno.preparadoEm = new Date().toISOString();
    return { ...def, interno };
  }

  async procurar(cred: Credenciais, def: DefinicoesDaConta, referencia: string): Promise<Emitido | null> {
    const c = this.cred(cred);
    const company_id = this.empresa(def);
    const lista = await this.chamar<Record<string, unknown>[]>(c, "invoiceReceipts/getAll", { company_id, our_reference: referencia, qty: 50 });
    const nossa = (Array.isArray(lista) ? lista : []).find((d) => String(d.our_reference ?? "") === referencia && Number(d.status) !== 2);
    if (!nossa) return null;
    if (Number(nossa.status) === 0) return this.fechar(c, company_id, Number(nossa.document_id));
    return this.emitidoDe(nossa);
  }

  async emitir(cred: Credenciais, def: DefinicoesDaConta, doc: DocumentoAFaturar): Promise<Emitido> {
    const c = this.cred(cred);
    const company_id = this.empresa(def);
    const interno = def.interno ?? {};
    if (!interno.preparadoEm) throw new ErroDeFaturacao("A ligação à Moloni ainda não foi preparada.", true);

    const customer_id = await this.cliente(c, def, doc);

    const products: Linha[] = doc.linhas.map((l, i) => {
      const product_id = Number(interno[`produto_${l.tipo}`]);
      if (!product_id) throw new ErroDeFaturacao(`Falta o produto genérico de ${l.tipo} na Moloni. Volta a preparar a ligação.`, true);
      const base: Linha = {
        product_id,
        name: l.descricao.slice(0, 200),
        qty: l.quantidade,
        price: liquidoDeBruto(l.unitarioCents, l.regra.iva),
        discount: 0,
        order: i,
      };
      if (l.regra.iva === 0) return { ...base, taxes: [], exemption_reason: l.regra.isencao ?? isencaoDoDocumento(doc) ?? "M07" };
      const tax_id = Number(interno[`taxa${l.regra.iva}`]);
      if (!tax_id) throw new ErroDeFaturacao(`A empresa Moloni não tem uma taxa de IVA a ${l.regra.iva} %. Cria-a no programa e volta a preparar a ligação.`, true);
      return { ...base, taxes: [{ tax_id, value: l.regra.iva, order: 0, cumulative: 0 }] };
    });

    const dia = diaIso(doc.pagoEm);
    const criado = await this.chamar<{ document_id: number }>(c, "invoiceReceipts/insert", {
      company_id,
      date: dia,
      expiration_date: dia,
      document_set_id: Number(def.serieId),
      customer_id,
      our_reference: doc.referencia,
      notes: observacoes(doc),
      status: 0,
      products,
      payments: [{ payment_method_id: Number(def.paymentMethodId), date: `${dia} 00:00:00`, value: doc.totalCents / 100, notes: doc.metodo }],
    });

    /*
     * Antes de fechar, o total do rascunho tem de ser o pago. Um cêntimo de
     * diferença num arredondamento do IVA é uma fatura errada em nome do
     * clube; o rascunho apaga-se e o erro diz o que se viu.
     */
    const rascunho = await this.chamar<Record<string, unknown>>(c, "documents/getOne", { company_id, document_id: criado.document_id });
    const total = Math.round(Number(rascunho.net_value ?? rascunho.exchange_total_value ?? NaN) * 100);
    if (!Number.isFinite(total) || total !== doc.totalCents) {
      await this.chamar(c, "invoiceReceipts/delete", { company_id, document_id: criado.document_id }).catch(() => undefined);
      throw new ErroDeFaturacao(`A Moloni calculou ${(total / 100).toFixed(2)} € e o pagamento foi de ${(doc.totalCents / 100).toFixed(2)} €. Confere as taxas de IVA nas Definições › Faturação.`, true);
    }

    return this.fechar(c, company_id, criado.document_id);
  }

  private async fechar(c: Cred, company_id: number, document_id: number): Promise<Emitido> {
    await this.chamar(c, "invoiceReceipts/update", { company_id, document_id, status: 1 });
    const d = await this.chamar<Record<string, unknown>>(c, "documents/getOne", { company_id, document_id });
    return this.emitidoDe({ ...d, document_id });
  }

  private emitidoDe(d: Record<string, unknown>): Emitido {
    const serie = d.document_set_name ? String(d.document_set_name) : "";
    const numero = d.number != null ? String(d.number) : null;
    return {
      externalId: String(d.document_id),
      number: numero ? `FR ${serie ? `${serie}/` : ""}${numero}` : null,
      atcud: d.atcud != null && String(d.atcud) ? String(d.atcud) : null,
      permalink: null,
    };
  }

  /** O cliente na Moloni: pelo NIF, ou pelo email entre os sem NIF; criado se não existe. */
  private async cliente(c: Cred, def: DefinicoesDaConta, doc: DocumentoAFaturar): Promise<number> {
    const company_id = this.empresa(def);
    const interno = def.interno ?? {};
    const vat = doc.cliente.nif ?? CONSUMIDOR_FINAL;

    if (doc.cliente.nif) {
      const porNif = await this.chamar<{ customer_id: number; vat: string }[]>(c, "customers/getByVat", { company_id, vat, exact: 1 });
      const certo = (Array.isArray(porNif) ? porNif : []).find((x) => String(x.vat) === vat);
      if (certo) return certo.customer_id;
    } else if (doc.cliente.email) {
      const porEmail = await this.chamar<{ customer_id: number; vat: string; email?: string }[]>(c, "customers/getByEmail", { company_id, email: doc.cliente.email });
      const certo = (Array.isArray(porEmail) ? porEmail : []).find((x) => String(x.vat) === CONSUMIDOR_FINAL && (x.email ?? "").toLowerCase() === doc.cliente.email!.toLowerCase());
      if (certo) return certo.customer_id;
    }

    const proximo = await this.chamar<{ number?: string | number }>(c, "customers/getNextNumber", { company_id });
    /*
     * A Moloni exige morada e código postal. Quem paga uma mensalidade na
     * app raramente os deu; vai o que o plugin oficial da Moloni também põe
     * quando não sabe ("Desconhecida", 1000-100), em vez de inventar uma rua.
     */
    const criado = await this.chamar<{ customer_id: number }>(c, "customers/insert", {
      company_id,
      vat,
      number: String(proximo?.number ?? Date.now()),
      name: doc.cliente.nome.slice(0, 100),
      language_id: 1,
      address: doc.cliente.morada?.slice(0, 200) || "Desconhecida",
      zip_code: codigoPostalMoloni(doc.cliente.codigoPostal),
      city: doc.cliente.localidade?.slice(0, 80) || "Desconhecida",
      country_id: 1,
      email: doc.cliente.email ?? "",
      maturity_date_id: Number(interno.maturityDateId),
      payment_method_id: Number(def.paymentMethodId),
    });
    return criado.customer_id;
  }

  async pdf(cred: Credenciais, def: DefinicoesDaConta, emitido: Emitido): Promise<Buffer> {
    const c = this.cred(cred);
    const company_id = this.empresa(def);
    const r = await this.chamar<{ url?: string }>(c, "documents/getPDFLink", { company_id, document_id: Number(emitido.externalId), signed: 1 });
    if (!r?.url) throw new ErroDeFaturacao("A Moloni não devolveu o link do PDF. Voltamos a tentar mais tarde.", false);
    const f = await descarregar(r.url, {}, PROGRAMA);
    if (f.status === 200 && f.corpo.length > 100 && (f.tipo.includes("pdf") || f.corpo.subarray(0, 4).toString() === "%PDF")) return f.corpo;
    // O plugin oficial reconstrói o link de descarga a partir da query do que a API devolve.
    const query = r.url.split("?")[1];
    if (query) {
      const g = await descarregar(`https://www.moloni.pt/downloads/index.php?action=getDownload&${query}&t=n`, {}, PROGRAMA);
      if (g.status === 200 && g.corpo.subarray(0, 4).toString() === "%PDF") return g.corpo;
    }
    throw new ErroDeFaturacao("O PDF da Moloni ainda não estava pronto. Voltamos a tentar mais tarde.", false);
  }

  async anular(cred: Credenciais, def: DefinicoesDaConta, emitido: Emitido, motivo: string): Promise<void> {
    const c = this.cred(cred);
    await this.chamar(c, "documents/documentCancel", { company_id: this.empresa(def), document_id: Number(emitido.externalId), notes: motivo.slice(0, 200) });
  }
}

/** "1234-567", ou o que o plugin oficial da Moloni põe quando não sabe. */
function codigoPostalMoloni(cp: string | null): string {
  const s = (cp ?? "").replace(/\s/g, "");
  if (/^\d{4}-\d{3}$/.test(s)) return s;
  if (/^\d{7}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4)}`;
  return "1000-100";
}

/** Exportado para os testes: a fatura-recibo é o tipo 27 no catálogo da Moloni. */
export const MOLONI_TIPO_FATURA_RECIBO = TIPO_FATURA_RECIBO;

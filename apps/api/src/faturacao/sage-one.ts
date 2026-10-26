/**
 * Sage One (Portugal) — o conector.
 *
 * ## O que é diferente aqui
 *
 * A Sage One portuguesa só tem a API v2, que a Sage já não recomenda mas
 * mantém a funcionar "para alguns utilizadores" em PT. Três coisas moldam
 * este conector:
 *
 * - **não há fatura-recibo.** Emite-se uma fatura (FT) e regista-se logo o
 *   pagamento dela, que gera o recibo. São dois documentos por pagamento, e
 *   é por isso que o clube precisa do plano Standard (o Básico dá cinco
 *   documentos por mês);
 * - **cada pedido vai assinado** (OAuth 1.0a por cima do OAuth 2.0): um
 *   HMAC-SHA1 do método, do endereço, dos parâmetros ordenados e de um nonce,
 *   com a chave `segredo-de-assinatura&token-de-acesso`. Está em `assinar`,
 *   e tem teste contra o exemplo da própria Sage;
 * - **não envia emails nem devolve o ATCUD**: o PDF da fatura pede-se com
 *   `Accept: application/pdf` e o email sai por nós, como nos outros.
 *
 * O clube autoriza-nos na página da Sage (OAuth 2.0, só o dono da conta
 * pode). O token de acesso vale uma hora (a documentação também diz um dia);
 * a fila renova-o antes de caducar.
 *
 * Documentação: developers.sageone.com/docs/pt/v2 e o guia em PDF da Sage
 * Portugal (SageOneAPI_PT.pdf), que é mais completo do que a página.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { InvoicingProvider } from "@prisma/client";
import { descarregar, erroDaResposta, formulario, mensagemDoPrograma, pedir, type Resposta } from "./http";
import { diaIso, isencaoDoDocumento, observacoes } from "./documento";
import {
  ErroDeFaturacao,
  type Conector,
  type Credenciais,
  type DefinicoesDaConta,
  type DocumentoAFaturar,
  type Emitido,
  type Opcoes,
} from "./tipos";

const PROGRAMA = "A Sage One";
const API = "https://api.sageone.com";
const AUTORIZAR = "https://app.pt.sageone.com/oauth2/auth";
const PORTUGAL = 175;
/** O contacto do tipo cliente, no catálogo da Sage. */
const TIPO_CLIENTE = 1;

type Cred = Extract<Credenciais, { provider: "SAGE_ONE" }>;

export class SageOne implements Conector {
  readonly provider: InvoicingProvider = "SAGE_ONE";

  constructor(private readonly app: { clientId: string; clientSecret: string; signingSecret: string }) {}

  /**
   * O segredo de assinatura é opcional: o portal novo da Sage
   * (developerselfservice) dá só o Client ID e o Client Secret, e a própria
   * Sage diz que a assinatura deixou de ser verificada nas versões novas da
   * API. Sem ele assina-se com a chave vazia; se a Sage ainda a verificar em
   * PT, o pedido volta com 401 e a consola diz que a ligação foi recusada.
   */
  get disponivel(): boolean {
    return Boolean(this.app.clientId && this.app.clientSecret);
  }

  private cred(c: Credenciais): Cred {
    if (c.provider !== "SAGE_ONE") throw new ErroDeFaturacao("Credenciais de outro programa", true);
    return c;
  }

  /* ---------------------------------------------------------------------- */
  /* OAuth                                                                   */
  /* ---------------------------------------------------------------------- */

  urlDeAutorizacao(redirectUri: string, state: string): string {
    const q = new URLSearchParams({ response_type: "code", client_id: this.app.clientId, redirect_uri: redirectUri, scope: "full_access", state });
    return `${AUTORIZAR}?${q.toString()}`;
  }

  async trocarCodigo(code: string, redirectUri: string): Promise<Credenciais> {
    return this.tokens({ grant_type: "authorization_code", client_id: this.app.clientId, client_secret: this.app.clientSecret, code, redirect_uri: redirectUri });
  }

  async renovar(cred: Credenciais): Promise<Credenciais | null> {
    const c = this.cred(cred);
    if (new Date(c.expiresAt).getTime() - Date.now() > 30 * 60_000) return null;
    return this.tokens({ grant_type: "refresh_token", client_id: this.app.clientId, client_secret: this.app.clientSecret, refresh_token: c.refreshToken });
  }

  private async tokens(corpo: Record<string, string>): Promise<Cred> {
    const r = await pedir(
      `${API}/oauth2/token`,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(corpo).toString() },
      PROGRAMA,
    );
    const j = r.json as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
    if (r.status !== 200 || !j?.access_token) {
      throw new ErroDeFaturacao(
        j?.error === "invalid_grant"
          ? "A autorização da Sage One caducou. O clube tem de voltar a autorizar nas Definições › Faturação."
          : `A Sage One recusou a autorização: ${j?.error_description ?? j?.error ?? `erro ${r.status}`}.`,
        true,
        r.texto.slice(0, 300),
      );
    }
    return {
      provider: "SAGE_ONE",
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? (corpo.refresh_token as string),
      expiresAt: new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000).toISOString(),
    };
  }

  /* ---------------------------------------------------------------------- */
  /* As chamadas assinadas                                                   */
  /* ---------------------------------------------------------------------- */

  private async chamar(
    c: Cred,
    metodo: "GET" | "POST" | "PUT" | "DELETE",
    caminho: string,
    params: Record<string, unknown> = {},
    aceitar = "application/json",
  ): Promise<Resposta> {
    const url = `${API}${caminho}`;
    const form = formulario(params);
    const nonce = nonceNovo();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${c.accessToken}`,
      "X-Signature": assinar(metodo, url, form, nonce, this.app.signingSecret, c.accessToken),
      "X-Nonce": nonce,
      Accept: aceitar,
      "User-Agent": "Academias",
    };
    const corpo = form.toString();
    const comCorpo = metodo === "POST" || metodo === "PUT";
    if (comCorpo) headers["Content-Type"] = "application/x-www-form-urlencoded";
    return pedir(comCorpo || !corpo ? url : `${url}?${corpo}`, { method: metodo, headers, ...(comCorpo ? { body: corpo } : {}) }, PROGRAMA);
  }

  private ok(r: Resposta, oQue: string, estados = [200, 201]): Record<string, unknown> {
    if (!estados.includes(r.status)) throw erroDaResposta(r, PROGRAMA, oQue);
    return (r.json ?? {}) as Record<string, unknown>;
  }

  private lista(r: Resposta, oQue: string): Record<string, unknown>[] {
    const j = this.ok(r, oQue);
    const itens = (j.$items ?? j.items ?? (Array.isArray(r.json) ? r.json : [])) as unknown[];
    return itens as Record<string, unknown>[];
  }

  async verificar(cred: Credenciais): Promise<{ nome: string }> {
    const c = this.cred(cred);
    const r = await this.chamar(c, "GET", "/accounts/v2/financial_settings");
    this.ok(r, "a verificação");
    return { nome: "Sage One" };
  }

  async opcoes(cred: Credenciais): Promise<Opcoes> {
    const c = this.cred(cred);
    const [contas, tipos] = await Promise.all([
      this.chamar(c, "GET", "/accounts/v2/bank_accounts"),
      this.chamar(c, "GET", "/accounts/v2/payment_methods"),
    ]);
    return {
      contasBancarias: this.lista(contas, "as contas bancárias").map((b, i) => ({ id: String(b.id), label: String(b.account_name ?? b.name ?? b.id), porOmissao: i === 0 })),
      tiposDePagamento: this.lista(tipos, "os tipos de pagamento").map((p) => ({ id: String(p.id), label: String(p.name ?? p.id), porOmissao: /banco/i.test(String(p.name ?? "")) })),
    };
  }

  porDefinir(def: DefinicoesDaConta): string[] {
    const falta: string[] = [];
    if (!def.bankAccountId) falta.push("a conta bancária do recibo");
    if (!def.paymentTypeId) falta.push("o tipo de pagamento do recibo");
    return falta;
  }

  /** As taxas da conta por percentagem e os motivos de isenção por código, que a Sage pede por id. */
  async preparar(cred: Credenciais, def: DefinicoesDaConta): Promise<DefinicoesDaConta> {
    const c = this.cred(cred);
    const interno: Record<string, string> = { ...(def.interno ?? {}) };
    const taxas = this.lista(await this.chamar(c, "GET", "/accounts/v2/tax_rates"), "as taxas");
    for (const iva of [0, 6, 13, 23]) {
      const t = taxas.find((x) => Math.round(Number(x.percentage ?? x.rate ?? NaN) * 100) === iva * 100);
      if (t) interno[`taxa${iva}`] = String(t.id);
      else delete interno[`taxa${iva}`];
    }
    const motivos = this.lista(await this.chamar(c, "GET", "/accounts/v2/vat_exemption_reasons"), "os motivos de isenção");
    for (const m of motivos) if (m.code) interno[`isencao_${String(m.code)}`] = String(m.id);
    interno.preparadoEm = new Date().toISOString();
    return { ...def, interno };
  }

  async procurar(cred: Credenciais, _def: DefinicoesDaConta, referencia: string): Promise<Emitido | null> {
    const c = this.cred(cred);
    // A lista não filtra por referência: lê-se a primeira página (as mais recentes) e procura-se a nossa.
    const r = await this.chamar(c, "GET", "/accounts/v2/sales_invoices");
    if (r.status !== 200) return null;
    const nossa = this.lista(r, "a lista de faturas").find((i) => String(i.reference ?? "") === referencia && !i.void_reason);
    return nossa ? this.emitidoDe(nossa) : null;
  }

  async emitir(cred: Credenciais, def: DefinicoesDaConta, doc: DocumentoAFaturar): Promise<Emitido> {
    const c = this.cred(cred);
    const interno = def.interno ?? {};
    if (!interno.preparadoEm) throw new ErroDeFaturacao("A ligação à Sage One ainda não foi preparada.", true);

    const contacto = await this.contacto(c, doc);
    const isencao = isencaoDoDocumento(doc);
    const isencaoId = isencao ? interno[`isencao_${isencao}`] : undefined;
    if (isencao && !isencaoId) throw new ErroDeFaturacao(`A Sage One não conhece o motivo de isenção ${isencao}. Escolhe outro nas Definições › Faturação.`, true);

    const line_items_attributes = doc.linhas.map((l) => {
      const tax_rate_id = interno[`taxa${l.regra.iva}`];
      if (!tax_rate_id) throw new ErroDeFaturacao(`A Sage One não tem uma taxa de IVA a ${l.regra.iva} %.`, true);
      return {
        description: l.descricao.slice(0, 60),
        quantity: l.quantidade,
        // A Sage aceita o preço com IVA incluído: vai o que a pessoa pagou, sem arredondamentos nossos.
        unit_price: (l.unitarioCents / 100).toFixed(2),
        unit_price_includes_tax: 1,
        tax_rate_id,
      };
    });

    const dia = diaIso(doc.pagoEm);
    const fatura: Record<string, unknown> = {
      contact_id: contacto.id,
      customer_name: doc.cliente.nome.slice(0, 100),
      date: dia,
      due_date: dia,
      reference: doc.referencia,
      notes: observacoes(doc).slice(0, 1000),
      main_address_street_1: contacto.morada.rua,
      main_address_postcode: contacto.morada.codigoPostal,
      main_address_locality: contacto.morada.localidade,
      main_address_country_id: PORTUGAL,
      delivery_address_same_as_main: 1,
      carriage: "0.00",
      line_items_attributes,
      /*
       * O motivo de isenção. O guia diz que é obrigatório com a taxa "Isento"
       * e chama-lhe `vat_exemption_reason`, sem dizer se leva o id ou o
       * código; a resposta devolve-o como objeto com id. Vão os dois nomes:
       * o que a Sage não reconhecer, ignora.
       */
      ...(isencaoId ? { vat_exemption_reason_id: isencaoId, vat_exemption_reason: isencaoId } : {}),
    };

    const r = await this.chamar(c, "POST", "/accounts/v2/sales_invoices", { sales_invoice: fatura });
    const criada = this.ok(r, "a criação da fatura");
    const id = String(criada.id ?? "");
    if (!id) throw new ErroDeFaturacao("A Sage One criou a fatura mas não devolveu o id dela.", true, r.texto.slice(0, 300));

    const total = Math.round(Number(criada.total_net_amount ?? NaN) * 100) + Math.round(Number(criada.total_tax_amount ?? 0) * 100);
    if (Number.isFinite(total) && total !== doc.totalCents) {
      await this.chamar(c, "DELETE", `/accounts/v2/sales_invoices/${id}`, { void_reason: "Total errado" }).catch(() => undefined);
      throw new ErroDeFaturacao(`A Sage One calculou ${(total / 100).toFixed(2)} € e o pagamento foi de ${(doc.totalCents / 100).toFixed(2)} €. Confere as taxas de IVA nas Definições › Faturação.`, true);
    }

    // O recibo: o pagamento registado na fatura, no dia e no valor pagos.
    const p = await this.chamar(c, "POST", `/accounts/v1/sales_invoices/${id}/payments`, {
      sales_invoice_payment: { date: dia, amount: (doc.totalCents / 100).toFixed(2), bank_account_id: def.bankAccountId, payment_type_id: def.paymentTypeId },
    });
    const recibo = this.ok(p, "o registo do pagamento");

    return { ...this.emitidoDe({ ...criada, id }), receiptExternalId: recibo.id != null ? String(recibo.id) : null };
  }

  private emitidoDe(d: Record<string, unknown>): Emitido {
    return {
      externalId: String(d.id),
      number: d.artefact_number ? String(d.artefact_number) : null,
      atcud: null,
      permalink: null,
    };
  }

  /**
   * O contacto na Sage. Procura-se pelo email (com o NIF a bater, quando há)
   * e cria-se se não existe. A Sage exige a morada completa num contacto;
   * sem a saber, vai o mesmo que o plugin da Moloni põe ("Desconhecida").
   */
  private async contacto(c: Cred, doc: DocumentoAFaturar): Promise<{ id: string; morada: { rua: string; codigoPostal: string; localidade: string } }> {
    const morada = {
      rua: doc.cliente.morada?.slice(0, 100) || "Desconhecida",
      codigoPostal: /^\d{4}-\d{3}$/.test(doc.cliente.codigoPostal ?? "") ? doc.cliente.codigoPostal! : "1000-100",
      localidade: doc.cliente.localidade?.slice(0, 60) || "Desconhecida",
    };

    if (doc.cliente.email) {
      const r = await this.chamar(c, "GET", "/accounts/v2/contacts", { email: doc.cliente.email, contact_type: TIPO_CLIENTE });
      if (r.status === 200) {
        const certo = this.lista(r, "os contactos").find((x) => (!doc.cliente.nif && !x.tax_number) || String(x.tax_number ?? "") === (doc.cliente.nif ?? ""));
        if (certo) {
          const m = (certo.main_address ?? {}) as Record<string, unknown>;
          return {
            id: String(certo.id),
            morada: {
              rua: String(m.address_line_1 ?? m.street_1 ?? morada.rua) || morada.rua,
              codigoPostal: String(m.postcode ?? morada.codigoPostal) || morada.codigoPostal,
              localidade: String(m.locality ?? m.city ?? morada.localidade) || morada.localidade,
            },
          };
        }
      }
    }

    const r = await this.chamar(c, "POST", "/accounts/v2/contacts", {
      contact: {
        name: doc.cliente.nome.slice(0, 100),
        company: doc.cliente.nome.slice(0, 100),
        contact_type_id: TIPO_CLIENTE,
        ...(doc.cliente.email ? { email: doc.cliente.email } : {}),
        ...(doc.cliente.nif ? { tax_number: doc.cliente.nif } : {}),
        main_address: { street_1: morada.rua, postcode: morada.codigoPostal, locality: morada.localidade, country_id: PORTUGAL },
      },
    });
    const criado = this.ok(r, "a criação do cliente");
    if (!criado.id) throw new ErroDeFaturacao(`A Sage One não criou o cliente: ${mensagemDoPrograma(r) ?? "sem resposta"}.`, true, r.texto.slice(0, 300));
    return { id: String(criado.id), morada };
  }

  async pdf(cred: Credenciais, _def: DefinicoesDaConta, emitido: Emitido): Promise<Buffer> {
    const c = this.cred(cred);
    const url = `${API}/accounts/v2/sales_invoices/${emitido.externalId}`;
    const nonce = nonceNovo();
    const f = await descarregar(
      url,
      {
        headers: {
          Authorization: `Bearer ${c.accessToken}`,
          "X-Signature": assinar("GET", url, new URLSearchParams(), nonce, this.app.signingSecret, c.accessToken),
          "X-Nonce": nonce,
          Accept: "application/pdf",
          "User-Agent": "Academias",
        },
      },
      PROGRAMA,
    );
    if (f.status === 401 || f.status === 403) throw new ErroDeFaturacao("A Sage One recusou o acesso ao PDF: o clube tem de voltar a autorizar.", true);
    if (f.status !== 200 || f.corpo.subarray(0, 4).toString() !== "%PDF") throw new ErroDeFaturacao("A Sage One não devolveu o PDF. Voltamos a tentar mais tarde.", false, f.corpo.subarray(0, 200).toString());
    return f.corpo;
  }

  async anular(cred: Credenciais, _def: DefinicoesDaConta, emitido: Emitido, motivo: string): Promise<void> {
    const c = this.cred(cred);
    const r = await this.chamar(c, "DELETE", `/accounts/v2/sales_invoices/${emitido.externalId}`, { void_reason: motivo.slice(0, 50) || "Pagamento devolvido" });
    if (![200, 204].includes(r.status)) throw erroDaResposta(r, PROGRAMA, "a anulação");
  }
}

/* -------------------------------------------------------------------------- */
/* A assinatura dos pedidos                                                    */
/* -------------------------------------------------------------------------- */

/** A codificação que a Sage pede (RFC 3986): como `encodeURIComponent`, mas também `!'()*`. */
export function codificar(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * `base64(HMAC-SHA1(chave, METODO&enc(url)&enc(params)&enc(nonce)))`, com
 * a chave `enc(segredo)&enc(token)`. Os parâmetros (do corpo ou da query,
 * é o mesmo) vão codificados, ordenados pelo nome e unidos por `&`.
 */
export function assinar(metodo: string, url: string, params: URLSearchParams, nonce: string, signingSecret: string, accessToken: string): string {
  const pares = [...params.entries()].map(([k, v]) => [codificar(k), codificar(v)] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const parametros = pares.map(([k, v]) => `${k}=${v}`).join("&");
  const base = `${metodo.toUpperCase()}&${codificar(url)}&${codificar(parametros)}&${codificar(nonce)}`;
  const chave = `${codificar(signingSecret)}&${codificar(accessToken)}`;
  return createHmac("sha1", chave).update(base).digest("base64");
}

function nonceNovo(): string {
  return randomBytes(32).toString("base64").replace(/\W/g, "");
}

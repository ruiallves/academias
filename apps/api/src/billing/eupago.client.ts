import { Injectable, Logger, ServiceUnavailableException, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";

export type ChargeRequest = {
  /** O nosso id de Payment. Vai para a euPago como `identifier` e volta no webhook. */
  reference: string;
  amountCents: number;
  description: string;
  payerName: string;
  payerEmail: string;
  payerPhone?: string;
  /**
   * A chave do canal do clube, quando o clube tem canal próprio — é o que faz o
   * dinheiro liquidar direitinho no IBAN dele. Ausente = chave global.
   */
  apiKey?: string;
};

export type RedirectUrls = {
  successUrl: string;
  failUrl: string;
  backUrl: string;
};

export type ChargeResult = {
  providerRef: string;
  /** Multibanco devolve entidade + referência; MB Way e cartão não. */
  entity?: string;
  reference?: string;
  /** Formulários alojados (cartão, Google Pay, Apple Pay, PaySafeCard). */
  redirectUrl?: string;
  expiresAt?: Date;
};

/**
 * Cliente da euPago.
 *
 * Isolado atrás de uma interface pequena de propósito: se um dia mudarmos de
 * provedor, muda este ficheiro e mais nada. O domínio fala de `Charge` e
 * `Payment`, nunca de euPago.
 *
 * ## As duas APIs da euPago
 *
 * A euPago tem duas gerações a viver lado a lado, e cada método usa a que o
 * documenta:
 *
 * - **v1.02** (`/api/v1.02/…`): JSON estruturado, chave no header
 *   `Authorization: ApiKey …`. MB Way, cartão, Google Pay, Apple Pay e débito
 *   directo vivem aqui.
 * - **rest_api** (`/clientes/rest_api/…`): a antiga, chave no corpo (`chave`).
 *   Multibanco e PaySafeCard só estão documentados nela.
 *
 * ## Segurança que este ficheiro garante
 *
 * - A chave **nunca** aparece em logs nem em mensagens de erro.
 * - O webhook autentica-se por HMAC-SHA256 comparado em tempo constante
 *   (ver `verifySignature`), com o servidor a recusar arrancar sem segredo.
 * - O valor vai daqui para a euPago; a confirmação compara o que voltou.
 */
@Injectable()
export class EupagoClient implements OnModuleInit {
  private readonly log = new Logger(EupagoClient.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * O servidor recusa arrancar sem um segredo de webhook forte.
   *
   * Antes de existir esta guarda, o servidor subia com `EUPAGO_WEBHOOK_SECRET=""`
   * e o estado inseguro era invisível — a assinatura "verificava" contra um HMAC
   * de segredo vazio, que qualquer pessoa calcula. Recusar arrancar torna a má
   * configuração impossível de ignorar: ou está bem configurado, ou o processo
   * nem sobe.
   *
   * Em produção. Em desenvolvimento com euPago desligado (`EUPAGO_API_KEY` vazio)
   * apenas avisa, para não travar quem está a trabalhar noutra parte do produto.
   */
  onModuleInit() {
    const secret = this.config.get<string>("EUPAGO_WEBHOOK_SECRET") ?? "";
    const eupagoEnabled = this.chaveDe() !== "";

    /*
     * O estado da euPago, dito **ao arrancar**.
     *
     * Um servidor sem chave só se denunciava no dia em que um pai tentasse
     * pagar — e denunciava-se com um aviso no meio de um log que ninguém lê a
     * meio da tarde. Dito aqui, aparece nas primeiras linhas de cada deploy.
     */
    if (!eupagoEnabled) {
      const aviso =
        "EUPAGO_API_KEY não está configurada — os pagamentos online não funcionam neste servidor.";
      if (process.env.NODE_ENV === "production") this.log.error(aviso + " Os pedidos de pagamento vão ser recusados.");
      else this.log.warn(aviso + " Em desenvolvimento, as referências são simuladas e nada fica pago.");
    }

    if (secret.length < 16) {
      const msg =
        "EUPAGO_WEBHOOK_SECRET ausente ou com menos de 16 caracteres. " +
        "O webhook de pagamentos aceitaria eventos forjados.";
      if (eupagoEnabled || process.env.NODE_ENV === "production") {
        throw new Error(msg);
      }
      this.log.warn(`${msg} (tolerado porque a euPago está desligada em desenvolvimento)`);
    }
  }

  /**
   * A chave a usar: a do canal do clube, ou a global do ambiente.
   *
   * Uma coluna a `""` é tão "sem chave" como uma coluna nula — e o `??` não via
   * a diferença, o que dava uma configuração silenciosamente inerte.
   */
  private chaveDe(override?: string): string {
    return override?.trim() || this.config.get<string>("EUPAGO_API_KEY")?.trim() || "";
  }

  private key(override?: string) {
    const k = this.chaveDe(override);
    if (!k) throw new Error("euPago sem chave configurada");
    return k;
  }

  /** `https://clientes.eupago.pt/api` — a raiz da API v1.02. */
  private get apiRoot() {
    return this.config.getOrThrow<string>("EUPAGO_BASE_URL").replace(/\/$/, "");
  }

  /** A raiz da API antiga, derivada da mesma variável — `/clientes/rest_api`. */
  private get restRoot() {
    return this.apiRoot.replace(/\/api$/, "") + "/clientes/rest_api";
  }

  /**
   * A euPago está ligada?
   *
   * Sem chave nenhuma o cliente entra em **modo de desenvolvimento**: devolve
   * uma referência de teste em vez de chamar o provedor, para o fluxo da app da
   * família se poder percorrer sem credenciais reais.
   *
   * O que isto **não** faz é fingir um pagamento. A cobrança fica exactamente
   * onde ficaria na vida real depois de gerar uma referência — por liquidar, à
   * espera do webhook — e nenhum `Charge` passa a pago por este caminho. A regra
   * de que só o webhook liquida continua inteira; o que se simula é o passo de
   * pedir a referência, não o de a pagar.
   */
  private devMode(override?: string): boolean {
    if (this.chaveDe(override)) return false;

    /*
     * Em produção não se finge.
     *
     * A simulação existe para o fluxo da app se poder percorrer sem
     * credenciais. Num servidor a sério é a pior coisa possível: o pai carrega
     * em "pagar", recebe um pedido que parece ter seguido, e a mensalidade fica
     * "a confirmar" **para sempre** — porque a referência é falsa e nenhum
     * webhook virá. Nem dinheiro, nem erro, nem forma de perceber porquê.
     *
     * Aconteceu: um servidor sem `EUPAGO_API_KEY` a simular MB Way a sério.
     * Mais vale recusar e dizer que falta configurar.
     */
    if (process.env.NODE_ENV === "production") {
      this.log.error("Pagamento pedido sem EUPAGO_API_KEY configurada — recusado em vez de simulado");
      throw new ServiceUnavailableException(
        "Os pagamentos online ainda não estão configurados neste servidor. Avisa o clube.",
      );
    }
    return true;
  }

  /* ------------------------------------------------------------------------ */
  /* Métodos de pagamento                                                      */
  /* ------------------------------------------------------------------------ */

  /** MB Way: um push para o telemóvel; o pai tem 5 minutos para aceitar. */
  async createMbWayCharge(req: ChargeRequest & { payerPhone: string }): Promise<ChargeResult> {
    if (this.devMode(req.apiKey)) {
      this.log.warn(`euPago desligada — MB Way simulado para ${req.reference}. Nada fica pago.`);
      return { providerRef: `dev-mbway-${req.reference}` };
    }

    const body = await this.postV102(
      "/mbway/create",
      {
        payment: {
          identifier: req.reference,
          amount: { value: euros(req.amountCents), currency: "EUR" },
          customerPhone: semIndicativo(req.payerPhone),
          countryCode: "+351",
        },
        ...(req.payerEmail ? { customer: { notify: false, email: req.payerEmail } } : {}),
      },
      req.apiKey,
    );

    return { providerRef: String(body.transactionID ?? body.reference ?? req.reference) };
  }

  /** Multibanco: entidade + referência, para pagar na caixa ou no homebanking. */
  async createMultibancoCharge(req: ChargeRequest): Promise<ChargeResult> {
    if (this.devMode(req.apiKey)) {
      this.log.warn(`euPago desligada — Multibanco simulado para ${req.reference}. Nada fica pago.`);
      return {
        providerRef: `dev-mb-${req.reference}`,
        entity: "12345",
        reference: String(hash9(req.reference)),
        expiresAt: new Date(Date.now() + 3 * 86_400_000),
      };
    }

    const body = await this.postRest("/multibanco/create", {
      chave: this.key(req.apiKey),
      valor: euros(req.amountCents),
      id: req.reference,
      // Uma referência, um pagamento. `per_dup: 1` deixaria a mesma referência
      // ser paga várias vezes — e mensalidades não se pagam duas vezes.
      per_dup: 0,
    });

    return {
      providerRef: String(body.referencia),
      entity: String(body.entidade),
      reference: String(body.referencia),
      expiresAt: body.data_fim ? new Date(String(body.data_fim)) : undefined,
    };
  }

  /** Cartão de crédito/débito: formulário alojado da euPago, com 3-D Secure. */
  createCardCharge(req: ChargeRequest, urls: RedirectUrls): Promise<ChargeResult> {
    return this.hostedForm("/creditcard/create", req, urls, {
      // O email é obrigatório no cartão — é para onde segue o recibo da euPago.
      customer: { email: req.payerEmail || "geral@academias.pt", notify: true },
    });
  }

  /** Google Pay: o mesmo formulário alojado, com o botão da Google. */
  createGooglePayCharge(req: ChargeRequest, urls: RedirectUrls): Promise<ChargeResult> {
    return this.hostedForm("/googlepay/create", req, urls);
  }

  /** Apple Pay: idem, para quem vive no iPhone. */
  createApplePayCharge(req: ChargeRequest, urls: RedirectUrls): Promise<ChargeResult> {
    return this.hostedForm("/applepay/create", req, urls);
  }

  /**
   * PaySafeCard, pela API antiga.
   *
   * A documentação não mostra o campo do URL de redireccionamento na resposta,
   * por isso procura-se qualquer campo que seja um URL — e se não vier nenhum o
   * método falha limpo, sem tocar em nada. Defensivo de propósito: mais vale
   * "PaySafeCard indisponível" do que adivinhar contra produção.
   */
  async createPaysafecardCharge(req: ChargeRequest, urls: RedirectUrls): Promise<ChargeResult> {
    if (this.devMode(req.apiKey)) {
      this.log.warn(`euPago desligada — PaySafeCard simulado para ${req.reference}. Nada fica pago.`);
      return { providerRef: `dev-psc-${req.reference}`, redirectUrl: urls.successUrl };
    }

    const body = await this.postRest("/paysafecard/create", {
      chave: this.key(req.apiKey),
      valor: euros(req.amountCents),
      id: req.reference,
      url_retorno: urls.successUrl,
    });

    const redirectUrl = [body.url, body.redirectUrl, body.resposta, body.referencia]
      .map((v) => String(v ?? ""))
      .find((v) => v.startsWith("https://"));
    if (!redirectUrl) {
      this.log.error(`PaySafeCard sem URL de redireccionamento na resposta (${req.reference})`);
      throw new Error("PaySafeCard indisponível de momento — tenta outro método");
    }

    return { providerRef: String(body.referencia ?? req.reference), redirectUrl };
  }

  /**
   * Débito directo, passo 1: a autorização (mandato SEPA).
   *
   * A euPago envia o PDF de autorização para o email do pai. `autoProcess: "0"`
   * é deliberado — quem debita somos nós, mensalidade a mensalidade, para o
   * valor debitado ser sempre o da cobrança na base de dados e nunca um
   * calendário automático do provedor a correr por fora.
   */
  async createDebitAuthorization(req: {
    reference: string;
    iban: string;
    name: string;
    email: string;
    bic?: string;
    apiKey?: string;
  }): Promise<{ providerRef: string }> {
    if (this.devMode(req.apiKey)) {
      this.log.warn(`euPago desligada — autorização de débito simulada para ${req.reference}.`);
      return { providerRef: `dev-dd-${req.reference}` };
    }

    const body = await this.postV102(
      "/directdebit/authorization",
      {
        identifier: req.reference,
        debtor: {
          iban: req.iban,
          name: req.name,
          email: req.email,
          ...(req.bic ? { bic: req.bic } : {}),
        },
        payment: {
          type: "RCUR",
          autoProcess: "0",
          limitDate: "2039-12-31",
        },
      },
      req.apiKey,
    );

    return { providerRef: String(body.reference) };
  }

  /** Débito directo, passo 2: debitar uma mensalidade contra o mandato. */
  async chargeDirectDebit(req: {
    mandateRef: string;
    paymentId: string;
    amountCents: number;
    apiKey?: string;
  }): Promise<{ collectionDate?: string }> {
    if (this.devMode(req.apiKey)) {
      this.log.warn(`euPago desligada — débito simulado para ${req.paymentId}. Nada fica pago.`);
      return {};
    }

    const body = await this.postV102(
      `/directdebit/payment/${encodeURIComponent(req.mandateRef)}`,
      {
        date: new Date().toISOString().slice(0, 10),
        amount: euros(req.amountCents),
        type: "RCUR",
        // `obs` volta no webhook como identificador — é o que liga o débito ao
        // nosso Payment.
        obs: req.paymentId,
      },
      req.apiKey,
    );

    return { collectionDate: body.collectionDate ? String(body.collectionDate) : undefined };
  }

  /* ------------------------------------------------------------------------ */
  /* Webhook                                                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Verificação da assinatura do webhook 2.0 da euPago.
   *
   * O header `X-Signature` traz o HMAC-SHA256 do corpo em bruto, **em base64**
   * (a euPago calcula `hash_hmac('sha256', body, chave, raw)` e codifica). O
   * segredo é a chave definida ao criar o webhook no backoffice — tem de ser a
   * mesma que está em `EUPAGO_WEBHOOK_SECRET`.
   *
   * Comparação em tempo constante — uma comparação normal permite adivinhar a
   * assinatura byte a byte pelo tempo de resposta. É pouco código para uma falha
   * que deixaria qualquer pessoa marcar mensalidades como pagas.
   */
  verifySignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;

    // Falha fechado se o segredo não estiver configurado. Um segredo vazio faz o
    // HMAC ser `HMAC("", body)` — que qualquer atacante calcula, porque o vazio é
    // público. Sem esta guarda, o webhook aceitaria eventos forjados e marcaria
    // mensalidades como pagas sem dinheiro. O arranque também recusa (ver
    // `onModuleInit`); esta é a segunda linha de defesa.
    const secret = this.config.getOrThrow<string>("EUPAGO_WEBHOOK_SECRET");
    if (secret.length < 16) {
      this.log.error("EUPAGO_WEBHOOK_SECRET ausente ou fraco — webhook recusado por segurança");
      return false;
    }

    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();

    let given: Buffer;
    try {
      given = Buffer.from(signature.trim(), "base64");
    } catch {
      return false;
    }
    // Base64 inválido decai para um buffer diferente; o comprimento trava-o.
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /* ------------------------------------------------------------------------ */
  /* Transporte                                                                */
  /* ------------------------------------------------------------------------ */

  /** Um formulário alojado (cartão, Google Pay, Apple Pay) — o corpo é igual. */
  private async hostedForm(
    path: string,
    req: ChargeRequest,
    urls: RedirectUrls,
    extra: Record<string, unknown> = {},
  ): Promise<ChargeResult> {
    if (this.devMode(req.apiKey)) {
      this.log.warn(`euPago desligada — formulário simulado para ${req.reference}. Nada fica pago.`);
      return { providerRef: `dev-form-${req.reference}`, redirectUrl: urls.successUrl };
    }

    const body = await this.postV102(
      path,
      {
        payment: {
          identifier: req.reference,
          amount: { value: euros(req.amountCents), currency: "EUR" },
          successUrl: urls.successUrl,
          failUrl: urls.failUrl,
          backUrl: urls.backUrl,
          lang: "PT",
          // Meia hora para preencher o formulário. O prazo é o que deixa uma
          // tentativa abandonada expirar e o pai trocar de método sem ficarem
          // duas cobranças vivas.
          minutesFormUp: 30,
        },
        ...extra,
      },
      req.apiKey,
    );

    return {
      providerRef: String(body.transactionID ?? body.reference ?? req.reference),
      redirectUrl: body.redirectUrl ? String(body.redirectUrl) : undefined,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    };
  }

  /** API v1.02 — chave no header, JSON estruturado. */
  private async postV102(path: string, payload: Record<string, unknown>, apiKey?: string) {
    const res = await fetch(`${this.apiRoot}/v1.02${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `ApiKey ${this.key(apiKey)}`,
      },
      body: JSON.stringify(payload),
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok || (body.transactionStatus && body.transactionStatus !== "Success")) {
      // Nunca o payload no log: pode ter IBAN ou telemóvel. O código chega.
      this.log.error(`euPago v1.02 ${path} falhou: ${res.status} ${body.code ?? ""} ${body.text ?? ""}`);
      throw new Error(`euPago recusou o pedido: ${body.text ?? body.code ?? res.status}`);
    }

    return body;
  }

  /** API antiga — chave no corpo. Multibanco e PaySafeCard vivem aqui. */
  private async postRest(path: string, payload: Record<string, unknown>) {
    const res = await fetch(`${this.restRoot}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok || body.sucesso === false) {
      const semChave = JSON.stringify({ ...body, chave_api: undefined }).slice(0, 300);
      this.log.error(`euPago rest ${path} falhou: ${semChave}`);
      throw new Error(`euPago recusou o pedido: ${body.resposta ?? res.status}`);
    }

    return body;
  }
}

/** A euPago fala em euros decimais; nós guardamos cêntimos inteiros. */
const euros = (n: number) => Number((n / 100).toFixed(2));

/** "+351912345678" → "912345678" — o indicativo segue à parte em `countryCode`. */
function semIndicativo(phone: string): string {
  return phone.replace(/^\+?351/, "").replace(/\s/g, "");
}

/**
 * Nove dígitos estáveis a partir de um id — a forma de uma referência Multibanco.
 * Só para o modo de desenvolvimento: uma referência que muda a cada pedido dava a
 * ideia errada de que se pode pagar duas vezes a mesma coisa.
 */
function hash9(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 1_000_000_000;
  return 100_000_000 + (h % 900_000_000);
}

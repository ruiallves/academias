import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";

export type ChargeRequest = {
  /** O nosso id de Payment. Vai para a euPago e volta no webhook. */
  reference: string;
  amountCents: number;
  description: string;
  payerName: string;
  payerEmail: string;
  payerPhone?: string;
};

export type ChargeResult = {
  providerRef: string;
  /** Multibanco devolve entidade + referência; MB Way e cartão não. */
  entity?: string;
  reference?: string;
  /** Cartão devolve um URL de redireccionamento. */
  redirectUrl?: string;
  expiresAt?: Date;
};

/**
 * Cliente da euPago.
 *
 * Isolado atrás de uma interface pequena de propósito: se um dia mudarmos de
 * provedor, muda este ficheiro e mais nada. O domínio fala de `Charge` e
 * `Payment`, nunca de euPago.
 */
@Injectable()
export class EupagoClient {
  private readonly log = new Logger(EupagoClient.name);

  constructor(private readonly config: ConfigService) {}

  private get apiKey() {
    return this.config.getOrThrow<string>("EUPAGO_API_KEY");
  }

  private get baseUrl() {
    return this.config.getOrThrow<string>("EUPAGO_BASE_URL");
  }

  async createMbWayCharge(req: ChargeRequest & { payerPhone: string }): Promise<ChargeResult> {
    const body = await this.post("/v1.02/mbway/create", {
      chave: this.apiKey,
      valor: cents(req.amountCents),
      id: req.reference,
      alias: req.payerPhone,
      descricao: req.description,
    });

    return { providerRef: String(body.referencia ?? req.reference) };
  }

  async createMultibancoCharge(req: ChargeRequest): Promise<ChargeResult> {
    const body = await this.post("/v1.02/multibanco/create", {
      chave: this.apiKey,
      valor: cents(req.amountCents),
      id: req.reference,
      per_dup: 0,
    });

    return {
      providerRef: String(body.referencia),
      entity: String(body.entidade),
      reference: String(body.referencia),
      expiresAt: body.data_fim ? new Date(String(body.data_fim)) : undefined,
    };
  }

  /**
   * Verificação da assinatura do webhook.
   *
   * Comparação em tempo constante — uma comparação normal permite adivinhar a
   * assinatura byte a byte pelo tempo de resposta. É pouco código para uma falha
   * que deixaria qualquer pessoa marcar mensalidades como pagas.
   */
  verifySignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;

    const secret = this.config.getOrThrow<string>("EUPAGO_WEBHOOK_SECRET");
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async post(path: string, payload: Record<string, unknown>) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = (await res.json()) as Record<string, unknown>;

    if (!res.ok || body.sucesso === false) {
      this.log.error(`euPago ${path} falhou: ${JSON.stringify(body)}`);
      throw new Error(`euPago recusou o pedido: ${body.resposta ?? res.status}`);
    }

    return body;
  }
}

/** A euPago fala em euros decimais; nós guardamos cêntimos inteiros. */
const cents = (n: number) => (n / 100).toFixed(2);

import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
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
    const eupagoEnabled = (this.config.get<string>("EUPAGO_API_KEY") ?? "") !== "";

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

  private get apiKey() {
    return this.config.getOrThrow<string>("EUPAGO_API_KEY");
  }

  private get baseUrl() {
    return this.config.getOrThrow<string>("EUPAGO_BASE_URL");
  }

  /**
   * A euPago está ligada?
   *
   * Sem `EUPAGO_API_KEY` o cliente entra em **modo de desenvolvimento**: devolve
   * uma referência de teste em vez de chamar o provedor, para o fluxo da app da
   * família se poder percorrer sem credenciais reais.
   *
   * O que isto **não** faz é fingir um pagamento. A cobrança fica exactamente
   * onde ficaria na vida real depois de gerar uma referência — por liquidar, à
   * espera do webhook — e nenhum `Charge` passa a pago por este caminho. A regra
   * de que só o webhook liquida continua inteira; o que se simula é o passo de
   * pedir a referência, não o de a pagar.
   */
  private get devMode(): boolean {
    return (this.config.get<string>("EUPAGO_API_KEY") ?? "") === "";
  }

  async createMbWayCharge(req: ChargeRequest & { payerPhone: string }): Promise<ChargeResult> {
    if (this.devMode) {
      this.log.warn(`euPago desligada — MB Way simulado para ${req.reference}. Nada fica pago.`);
      return { providerRef: `dev-mbway-${req.reference}` };
    }

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
    if (this.devMode) {
      this.log.warn(`euPago desligada — Multibanco simulado para ${req.reference}. Nada fica pago.`);
      return {
        providerRef: `dev-mb-${req.reference}`,
        entity: "12345",
        // Nove dígitos derivados do id, para a referência ser estável entre
        // pedidos do mesmo pagamento — como a real seria.
        reference: String(hash9(req.reference)),
        expiresAt: new Date(Date.now() + 3 * 86_400_000),
      };
    }

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

    // Falha fechado se o segredo não estiver configurado. Um segredo vazio faz o
    // HMAC ser `HMAC("", body)` — que qualquer atacante calcula, porque o vazio é
    // público. Sem esta guarda, o webhook aceitaria eventos forjados e marcaria
    // mensalidades como pagas sem dinheiro. O arranque também recusa (ver o
    // `onModuleInit` abaixo); esta é a segunda linha de defesa.
    const secret = this.config.getOrThrow<string>("EUPAGO_WEBHOOK_SECRET");
    if (secret.length < 16) {
      this.log.error("EUPAGO_WEBHOOK_SECRET ausente ou fraco — webhook recusado por segurança");
      return false;
    }

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

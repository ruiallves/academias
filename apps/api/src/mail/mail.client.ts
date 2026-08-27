import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export type Mail = {
  to: string;
  /** O nome de quem recebe, quando se sabe. Um "Para: Sandra" em vez de um endereço cru. */
  toName?: string;
  subject: string;
  html: string;
  /** A versão em texto. Não é opcional na prática — ver a nota do `send`. */
  text: string;
  /**
   * Quem responde, se alguém responder.
   *
   * O remetente é sempre o nosso (é o único endereço verificado), mas um pai que
   * carregue em "responder" deve falar com o clube, não connosco.
   */
  replyTo?: { email: string; name?: string };
};

export type MailResult = { sent: boolean; reason?: string };

/**
 * Quem entrega o correio.
 *
 * ## Porquê dois, e porquê adivinhados pela chave
 *
 * A escolha inicial foi SendGrid, mas a chave que apareceu no `.env` era da Brevo
 * — e a diferença entre as duas é o prefixo da chave, um endereço, um cabeçalho e
 * o nome de três campos. Perguntar num terceiro valor de configuração
 * (`MAIL_PROVIDER=...`) era criar uma segunda coisa que pode estar errada: quem
 * troca a chave e se esquece de trocar o provedor fica com um erro que não explica
 * nada. A chave já se identifica sozinha; usa-se isso.
 */
type Provider = {
  name: string;
  url: string;
  headers: (key: string) => Record<string, string>;
  body: (mail: Mail, from: { email: string; name: string }) => unknown;
  /** O código que significa "aceite". Não é o mesmo nos dois. */
  ok: number;
};

const SENDGRID: Provider = {
  name: "SendGrid",
  url: "https://api.sendgrid.com/v3/mail/send",
  headers: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
  body: (mail, from) => ({
    personalizations: [{ to: [{ email: mail.to, ...(mail.toName ? { name: mail.toName } : {}) }] }],
    from,
    ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
    subject: mail.subject,
    // A ordem importa para a SendGrid: o texto primeiro, o HTML a seguir.
    content: [
      { type: "text/plain", value: mail.text },
      { type: "text/html", value: mail.html },
    ],
  }),
  ok: 202,
};

const BREVO: Provider = {
  name: "Brevo",
  url: "https://api.brevo.com/v3/smtp/email",
  headers: (key) => ({ "api-key": key, "Content-Type": "application/json", Accept: "application/json" }),
  body: (mail, from) => ({
    sender: from,
    to: [{ email: mail.to, ...(mail.toName ? { name: mail.toName } : {}) }],
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    subject: mail.subject,
    htmlContent: mail.html,
    textContent: mail.text,
  }),
  ok: 201,
};

/** Pela chave se conhece o serviço. `SG.` é SendGrid, `xkeysib-` é Brevo. */
function providerFor(key: string): Provider {
  return key.startsWith("xkeysib-") ? BREVO : SENDGRID;
}

/**
 * O correio a sair.
 *
 * ## Isolado de propósito
 *
 * A SendGrid entra como escolha de **teste** e o produto não deve ficar preso a
 * ela: o resto do código pede `mail.send(...)` e não sabe de que serviço se trata.
 * Trocar por Resend, SES ou um SMTP do clube é mudar este ficheiro e mais nenhum —
 * a mesma disciplina que o `EupagoClient` já segue com os pagamentos.
 *
 * ## Sem SDK
 *
 * A API da SendGrid é um POST a um endereço. O pacote oficial traz uma árvore de
 * dependências para fazer esse POST — e cada dependência num servidor que trata
 * dados de menores é superfície que alguém tem de manter. O `fetch` do Node chega.
 *
 * ## Falhar a enviar não é falhar a convidar
 *
 * Nenhum método daqui atira excepções para quem chama. Um convite existe na base
 * de dados e o link está no ecrã de quem convidou; se o email não sair, o convite
 * continua bom e a consola diz que é preciso mandá-lo à mão. O contrário — perder
 * o convite porque a SendGrid teve um mau minuto — seria trocar um problema
 * pequeno por um grande.
 */
@Injectable()
export class MailClient implements OnModuleInit {
  private readonly log = new Logger(MailClient.name);

  private apiKey = "";
  private from = { email: "", name: "" };
  private provider: Provider = SENDGRID;
  /**
   * Para onde vai o POST, quando não é o do provedor.
   *
   * Serve para apontar a um recolector local em desenvolvimento — assim testa-se
   * o caminho todo (o corpo, os cabeçalhos, o tratamento do erro) sem gastar
   * envios reais nem mandar correio a endereços a sério por engano. Vazio em
   * produção, que é onde tem de estar.
   */
  private override = "";

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.apiKey = this.config.get<string>("MAIL_API_KEY")?.trim() || this.config.get<string>("SENDGRID_API_KEY")?.trim() || "";
    this.override = this.config.get<string>("MAIL_API_URL")?.trim() ?? "";
    this.provider = providerFor(this.apiKey);
    this.from = {
      email: this.config.get<string>("MAIL_FROM")?.trim() ?? "",
      name: this.config.get<string>("MAIL_FROM_NAME")?.trim() || "Academias",
    };

    if (this.ready) {
      // Qual dos dois ficou escolhido, e de que endereço sai. Um envio que não
      // chega investiga-se por aqui, e sem isto a primeira pergunta — "está a
      // usar que serviço?" — não tem resposta no arranque.
      this.log.log(`Email por ${this.provider.name}, a enviar de ${this.from.email}.`);
    } else {
      /*
       * Avisa e segue, como o push faz sem chaves VAPID.
       *
       * Recusar arrancar seria travar quem está a trabalhar noutra parte do
       * produto por causa de uma integração que ainda é de teste. O que não pode
       * acontecer é o estado ser invisível: sem esta linha, um convite que nunca
       * chegou a ninguém parecia um convite enviado.
       */
      this.log.warn("Email por configurar (MAIL_API_KEY / MAIL_FROM) — os convites não saem por email.");
    }
  }

  /** Há chave e remetente? Quem chama usa isto para não prometer o que não pode cumprir. */
  get ready(): boolean {
    return Boolean(this.apiKey && this.from.email);
  }

  /**
   * Envia. Devolve o que aconteceu; nunca atira.
   *
   * O corpo vai sempre em duas versões, texto e HTML. Não é cortesia: um email só
   * com HTML é um sinal clássico de spam, e é o texto que aparece na
   * pré-visualização do telemóvel antes de alguém abrir seja o que for.
   */
  async send(mail: Mail): Promise<MailResult> {
    if (!this.ready) return { sent: false, reason: "Email por configurar no servidor." };

    try {
      const res = await fetch(this.override || this.provider.url, {
        method: "POST",
        headers: this.provider.headers(this.apiKey),
        body: JSON.stringify(this.provider.body(mail, this.from)),
      });

      // Aceite. Qualquer outra coisa traz um corpo que diz porquê — e esse porquê
      // é quase sempre o remetente por verificar.
      if (res.status === this.provider.ok) return { sent: true };

      const detail = await res.text().catch(() => "");
      const reason = explain(res.status, detail);
      this.log.warn(`Email para ${mail.to} recusado por ${this.provider.name} (${res.status}): ${detail.slice(0, 300)}`);
      return { sent: false, reason };
    } catch (error) {
      this.log.warn(`Email para ${mail.to} falhou: ${String(error)}`);
      return { sent: false, reason: "O serviço de email não respondeu." };
    }
  }
}

/**
 * O erro do provedor traduzido para quem está na consola.
 *
 * O corpo que eles devolvem é para programadores. Um diretor que carregue em
 * "enviar" precisa de saber se o problema é dele (endereço errado) ou nosso
 * (configuração) — e o remetente por verificar é a coisa que falha a toda a gente
 * da primeira vez, nos dois serviços.
 */
function explain(status: number, detail: string): string {
  // A frase muda com o serviço; o problema é o mesmo, e a resposta também.
  if (/verified Sender Identity|sender.*not valid|unrecognised.*sender|not.*validated/i.test(detail)) {
    return "O endereço de remetente ainda não está verificado no serviço de email.";
  }
  if (status === 401 || status === 403) return "A chave do serviço de email foi recusada.";
  if (status === 400) return "A mensagem foi recusada — confirma o endereço de destino.";
  if (status === 429) return "Limite de envios atingido. Tenta daqui a pouco.";
  return "O serviço de email recusou a mensagem.";
}

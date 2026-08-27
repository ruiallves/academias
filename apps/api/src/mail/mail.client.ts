import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";

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
  /**
   * O que este email é: `staff-invite`, `family-invite`, `platform-invite`.
   *
   * Serve o registo — sem isto, o painel da plataforma sabe **quantos** emails
   * saíram e não sabe de quê, que é metade da pergunta.
   */
  kind?: string;
};

export type MailResult = { sent: boolean; reason?: string };

/**
 * Quem entrega o correio.
 *
 * ## Porquê três, e porquê adivinhados pela chave
 *
 * O serviço em uso é o **Resend**. Antes foi a Brevo, e antes disso a SendGrid —
 * e a diferença entre os três é o prefixo da chave, um endereço, um cabeçalho e o
 * nome de meia dúzia de campos. Perguntar num segundo valor de configuração
 * (`MAIL_PROVIDER=...`) era criar mais uma coisa que pode estar errada: quem
 * troca a chave e se esquece de trocar o provedor fica com um erro que não explica
 * nada. A chave já se identifica sozinha; usa-se isso.
 *
 * A consequência prática é que mudar de serviço é trocar `MAIL_API_KEY` no
 * ambiente e reiniciar. Foi o que se fez quando a verificação de domínio da Brevo
 * não passou no registador do domínio.
 */
type Provider = {
  name: string;
  url: string;
  headers: (key: string) => Record<string, string>;
  body: (mail: Mail, from: { email: string; name: string }) => unknown;
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
};

/**
 * O Resend — o serviço em uso.
 *
 * A diferença para os outros dois está na forma do endereço: aqui não há objecto
 * `{ email, name }`, há a linha de cabeçalho a sério — `Academias
 * <noreply@academias.pt>`. É por isso que existe o `endereco()` abaixo: um nome
 * com vírgula ("Silva, João") parte um cabeçalho de email se for escrito cru.
 */
const RESEND: Provider = {
  name: "Resend",
  url: "https://api.resend.com/emails",
  headers: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
  body: (mail, from) => ({
    from: endereco(from.email, from.name),
    to: [endereco(mail.to, mail.toName)],
    ...(mail.replyTo ? { reply_to: [endereco(mail.replyTo.email, mail.replyTo.name)] } : {}),
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  }),
};

/**
 * `Nome <email>`, com o nome entre aspas quando precisa.
 *
 * Os nomes vêm de dados do clube — o nome curto da academia, o nome de um
 * encarregado. Um deles com vírgula, ponto e vírgula ou aspas escreve um
 * cabeçalho inválido e o email é recusado por uma razão que ninguém liga ao
 * nome de uma pessoa.
 */
function endereco(email: string, nome?: string): string {
  if (!nome) return email;
  const seguro = /["<>,;:@\\]/.test(nome) ? `"${nome.replace(/["\\]/g, "")}"` : nome;
  return `${seguro} <${email}>`;
}

/**
 * Pela chave se conhece o serviço.
 *
 * `re_` é Resend, `xkeysib-` é Brevo, o resto é SendGrid. Os três continuam aqui
 * porque são dez linhas cada e é isto que torna a troca de serviço uma variável
 * de ambiente em vez de um dia de trabalho — foi assim que se saiu da Brevo.
 */
function providerFor(key: string): Provider {
  if (key.startsWith("re_")) return RESEND;
  if (key.startsWith("xkeysib-")) return BREVO;
  return SENDGRID;
}

/**
 * O correio a sair.
 *
 * ## Isolado de propósito
 *
 * O resto do código pede `mail.send(...)` e não sabe de que serviço se trata.
 * Trocar de serviço — foi Brevo, é Resend, um dia pode ser SES ou o SMTP do
 * clube — é mudar este ficheiro e mais nenhum, e na maior parte dos casos nem
 * isso: só a chave no ambiente. A mesma disciplina que o `EupagoClient` já segue
 * com os pagamentos.
 *
 * ## Sem SDK
 *
 * A API do Resend é um POST a um endereço. O pacote oficial traz uma árvore de
 * dependências para fazer esse POST — e cada dependência num servidor que trata
 * dados de menores é superfície que alguém tem de manter. O `fetch` do Node chega.
 *
 * ## Falhar a enviar não é falhar a convidar
 *
 * Nenhum método daqui atira excepções para quem chama. Um convite existe na base
 * de dados e o link está no ecrã de quem convidou; se o email não sair, o convite
 * continua bom e a consola diz que é preciso mandá-lo à mão. O contrário — perder
 * o convite porque o serviço de email teve um mau minuto — seria trocar um
 * problema pequeno por um grande.
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

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

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

    const resultado = await this.entregar(mail);
    await this.registar(mail, resultado);
    return resultado;
  }

  /**
   * O registo do que se tentou.
   *
   * Falha em silêncio de propósito, e é a mesma regra do envio: **não se perde um
   * convite porque o registo não gravou**. O log serve para contar e para
   * explicar; não é ele que decide se o email saiu.
   */
  private async registar(mail: Mail, resultado: MailResult): Promise<void> {
    try {
      await this.prisma.mailLog.create({
        data: {
          kind: mail.kind ?? "outro",
          to: mail.to,
          ok: resultado.sent,
          reason: resultado.reason?.slice(0, 200),
          provider: this.provider.name,
        },
      });
    } catch (error) {
      this.log.warn(`Não foi possível registar o email para ${mail.to}: ${String(error)}`);
    }
  }

  private async entregar(mail: Mail): Promise<MailResult> {

    try {
      const res = await fetch(this.override || this.provider.url, {
        method: "POST",
        headers: this.provider.headers(this.apiKey),
        body: JSON.stringify(this.provider.body(mail, this.from)),
      });

      /*
       * Aceite é qualquer 2xx.
       *
       * Era um código exacto por serviço — 202 na SendGrid, 201 na Brevo, 200 no
       * Resend — e cada serviço novo trazia mais um número para acertar. Um
       * número errado dava o pior dos resultados: o email saía e o produto dizia
       * que não. Qualquer outra coisa traz um corpo que diz porquê, e esse porquê
       * é quase sempre o remetente ou o domínio por verificar.
       */
      if (res.ok) return { sent: true };

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
  /*
   * A conta em modo de teste é um caso à parte.
   *
   * Uma chave do Resend sem domínio verificado só entrega ao endereço de quem
   * criou a conta — e recusa tudo o resto com "you can only send testing
   * emails". Sem esta linha, quem tenta convidar um treinador vê "a mensagem foi
   * recusada, confirma o endereço de destino" e vai procurar um erro no endereço
   * que está certo.
   */
  if (/only send testing emails|testing emails to your own/i.test(detail)) {
    return "O domínio ainda não está verificado no Resend — por agora só entrega ao email da conta.";
  }
  // A frase muda com o serviço; o problema é o mesmo, e a resposta também.
  if (/verified Sender Identity|sender.*not valid|unrecognised.*sender|not.*validated|domain is not verified/i.test(detail)) {
    return "O endereço de remetente ainda não está verificado no serviço de email.";
  }
  if (status === 401 || status === 403) return "A chave do serviço de email foi recusada.";
  if (status === 400) return "A mensagem foi recusada — confirma o endereço de destino.";
  if (status === 429) return "Limite de envios atingido. Tenta daqui a pouco.";
  return "O serviço de email recusou a mensagem.";
}

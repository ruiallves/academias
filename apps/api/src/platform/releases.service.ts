import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MailClient } from "../mail/mail.client";
import { ACADEMIAS_LOGO_URL, releaseNotesEmail } from "../mail/mail.templates";
import { SELECT_RESPONSAVEL, escolherResponsavel } from "../subscription/responsavel";
import { PlatformPrisma } from "./platform.prisma";
import { PlatformService } from "./platform.service";
import type { PlatformAdminContext } from "./platform.guard";

/**
 * As novidades da plataforma, contadas aos clubes.
 *
 * ## O problema
 *
 * Um clube que não sabe o que mudou não usa o que mudou. As novidades viviam num
 * `release.txt` na raiz do repositório, escrito a cada deploy e lido por uma
 * pessoa — e funcionalidades pedidas por um clube ficavam meses por usar **por
 * esse clube**, que não sabia que já lá estavam.
 *
 * ## Quem recebe
 *
 * O **responsável** de cada clube, que é `responsavelDoClube`: a mesma pessoa que
 * assina o contrato e recebe as cobranças. Não há aqui uma segunda definição de
 * "o responsável" de propósito — duas dariam novidades a uma pessoa e faturas a
 * outra, e ninguém saberia qual das duas estava certa.
 *
 * Um clube sem responsável (ninguém com `legal:club` e email) **não some**:
 * aparece na lista de destinatários marcado como impossível, para se ver que
 * existe e porquê. Escolhê-lo à mesma grava a linha com o motivo, em vez de o
 * envio ficar a mentir que foram todos.
 *
 * ## Editar depois de enviar
 *
 * Dá, sempre. Começou por não dar — a versão fechava ao primeiro envio, com o
 * argumento de que reescrever o texto mudava o histórico sem mudar o que as
 * pessoas leram — e o Rui pediu o contrário: uma gralha encontrada depois de
 * mandar a três clubes tem de se poder corrigir antes de mandar aos outros
 * nove. O argumento continua verdadeiro e por isso é **dito**, em vez de
 * imposto: o ecrã avisa que o que se mudar não chega a quem já recebeu. Quem
 * recebeu, e para que endereço, fica em `ReleaseRecipient`, que editar não toca.
 *
 * Reenviar a clubes novos continua a dar — é o caso de um clube que entrou
 * depois, ou de um email que falhou — e a quem já recebeu não se manda outra vez.
 */
@Injectable()
export class ReleasesService {
  private readonly log = new Logger(ReleasesService.name);

  constructor(
    private readonly prisma: PlatformPrisma,
    private readonly platform: PlatformService,
    private readonly mail: MailClient,
    private readonly config: ConfigService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Ler                                                                     */
  /* ---------------------------------------------------------------------- */

  async list() {
    const rows = await this.prisma.release.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, version: true, title: true, notes: true,
        sentAt: true, createdAt: true,
        author: { select: { name: true } },
        recipients: {
          orderBy: { academyName: "asc" },
          select: { academyId: true, academyName: true, name: true, email: true, sentAt: true, error: true },
        },
      },
    });

    return rows.map(({ author, recipients, ...r }) => ({
      ...r,
      author: author?.name ?? null,
      recipients,
      /* As contagens que a lista mostra sem ter de abrir cada uma. */
      enviados: recipients.filter((d) => d.sentAt).length,
      falhados: recipients.filter((d) => !d.sentAt).length,
    }));
  }

  /**
   * Os clubes e quem os representa — o que o ecrã de escolha precisa.
   *
   * Devolve **todos**, com o estado comercial em bruto (`status`,
   * `subscriptionStatus`, `trialEndsAt`). Quem decide o que vem pré-escolhido é
   * o cliente, com `estadoComercial`/`temReceita`, que é onde essa regra já
   * vive: uma segunda cópia dela aqui e a lista de clubes a pagar do painel
   * passavam a poder discordar uma da outra.
   */
  async destinatarios(releaseId?: string) {
    const academias = await this.prisma.academy.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, shortName: true, slug: true, status: true, trialEndsAt: true,
        subscription: { select: { status: true } },
      },
    });

    /*
     * O responsável de cada clube, um a um. São dezenas de clubes e não milhares,
     * e a alternativa — reescrever a consulta aqui em vez de chamar
     * `responsavelDoClube` — era a segunda definição que este ficheiro existe
     * para não ter.
     */
    const jaRecebeu = releaseId
      ? new Set(
          (
            await this.prisma.releaseRecipient.findMany({
              where: { releaseId, sentAt: { not: null } },
              select: { academyId: true },
            })
          ).map((d) => d.academyId),
        )
      : new Set<string>();

    const out = [];
    for (const a of academias) {
      const responsavel = await this.responsavelDe(a.id);
      out.push({
        id: a.id,
        name: a.name,
        shortName: a.shortName,
        slug: a.slug,
        status: a.status,
        subscriptionStatus: a.subscription?.status ?? null,
        trialEndsAt: a.trialEndsAt,
        responsavel,
        /* Já recebeu esta versão: o ecrã tira-o da escolha por omissão para um
           reenvio não voltar a escrever a quem já leu. */
        jaRecebeu: jaRecebeu.has(a.id),
      });
    }
    return out;
  }

  /* ---------------------------------------------------------------------- */
  /* Escrever                                                                */
  /* ---------------------------------------------------------------------- */

  async create(admin: PlatformAdminContext | null, input: { version: string; title: string; notes: string }, ip?: string) {
    const r = await this.prisma.release.create({
      data: {
        version: input.version.trim(),
        title: input.title.trim(),
        notes: input.notes.trim(),
        authorId: admin?.id ?? null,
      },
      select: { id: true, version: true, title: true },
    });
    await this.platform.audit(admin, "release.create", "release", r.id, { versao: r.version }, ip);
    return r;
  }

  async update(
    admin: PlatformAdminContext | null,
    id: string,
    input: { version?: string; title?: string; notes?: string },
    ip?: string,
  ) {
    const actual = await this.existe(id);
    const r = await this.prisma.release.update({
      where: { id },
      data: {
        ...(input.version !== undefined ? { version: input.version.trim() } : {}),
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
      },
      select: { id: true, version: true, title: true },
    });
    await this.platform.audit(admin, "release.update", "release", id, {
      versao: actual.version,
      /* Fica escrito se foi mexida depois de sair: é a diferença entre corrigir
         um rascunho e mudar um texto que já alguém leu. */
      jaEnviada: Boolean(actual.sentAt),
    }, ip);
    return r;
  }

  /**
   * Apagar — também depois de enviada, pela mesma razão de se poder editar.
   *
   * Leva consigo a lista de quem recebeu (a relação é em cascata). Por isso o
   * registo de auditoria guarda **quantos** a tinham recebido: o email já está
   * na caixa dessas pessoas, e apagar aqui não o tira de lá.
   */
  async remove(admin: PlatformAdminContext | null, id: string, ip?: string) {
    const actual = await this.existe(id);
    const recebidos = await this.prisma.releaseRecipient.count({ where: { releaseId: id, sentAt: { not: null } } });
    await this.prisma.release.delete({ where: { id } });
    await this.platform.audit(admin, "release.delete", "release", id, { versao: actual.version, recebidos }, ip);
    return { ok: true as const };
  }

  /**
   * O email tal e qual vai sair — sem sair.
   *
   * Desenhado **pelo servidor**, com a mesma função do envio, e não imitado no
   * painel: uma pré-visualização feita por outra mão é uma segunda versão do
   * email, e mais tarde ou mais cedo as duas discordam. Assim o que se vê é, byte
   * a byte, o que o responsável recebe.
   *
   * Recebe o texto por gravar, para se poder ver enquanto se escreve. Com um
   * clube escolhido usa o nome e o responsável verdadeiros; sem nenhum, um
   * exemplo. Não escreve nada em lado nenhum e não fala com o fornecedor de
   * email.
   */
  async preview(input: { version: string; title: string; notes: string; academyId?: string }) {
    let clubName = "Clube de Exemplo";
    let para: { name: string; email: string } = { name: "Ana Sousa", email: "presidente@clube-exemplo.pt" };
    let slug = "exemplo";

    if (input.academyId) {
      const a = await this.prisma.academy.findUnique({
        where: { id: input.academyId },
        select: { id: true, name: true, slug: true },
      });
      if (a) {
        clubName = a.name;
        slug = a.slug;
        const responsavel = await this.responsavelDe(a.id);
        if (responsavel) para = { name: responsavel.name, email: responsavel.email };
      }
    }

    const mail = releaseNotesEmail({
      name: para.name,
      clubName,
      version: input.version.trim() || "\u2014",
      title: input.title.trim() || "(sem assunto)",
      notes: input.notes,
      link: this.consolaDe(slug),
      logoUrl: this.logoUrl(),
    });

    return { de: this.mail.remetente, para, clubName, ...mail };
  }

  /**
   * Mandar a versão aos clubes escolhidos.
   *
   * Em série e não em paralelo, como o resto dos envios em massa da casa: o
   * fornecedor de correio limita-nos se lhe atirarmos trinta pedidos ao mesmo
   * tempo, e a diferença entre dois segundos e dez não interessa a ninguém num
   * ecrã onde se carrega uma vez por semana.
   *
   * **Cada clube é independente.** Um email que falha grava o motivo naquela
   * linha e o envio continua: parar no primeiro deixava metade dos clubes sem
   * saber das novidades por causa de um endereço errado noutro.
   *
   * Reenviar é seguro: quem já recebeu não volta a receber (o `upsert` por
   * `(releaseId, academyId)` vê o `sentAt` e salta), e quem falhou é tentado
   * outra vez.
   */
  async enviar(admin: PlatformAdminContext | null, id: string, academyIds: string[], ip?: string) {
    const release = await this.prisma.release.findUnique({
      where: { id },
      select: { id: true, version: true, title: true, notes: true },
    });
    if (!release) throw new NotFoundException("Versão não encontrada");
    if (academyIds.length === 0) throw new BadRequestException("Não escolheste nenhum clube");
    if (!this.mail.ready) throw new BadRequestException("O envio de emails ainda não está configurado no servidor.");

    const academias = await this.prisma.academy.findMany({
      where: { id: { in: [...new Set(academyIds)] } },
      select: { id: true, name: true, slug: true },
    });

    let enviados = 0;
    const falhas: { academyId: string; name: string; reason: string }[] = [];

    for (const a of academias) {
      /* Já lhe foi mandada: não se manda outra vez. Ver o cabeçalho. */
      const anterior = await this.prisma.releaseRecipient.findUnique({
        where: { releaseId_academyId: { releaseId: id, academyId: a.id } },
        select: { sentAt: true },
      });
      if (anterior?.sentAt) continue;

      const responsavel = await this.responsavelDe(a.id);
      if (!responsavel) {
        const reason = "O clube não tem ninguém com poderes de representação e email.";
        await this.gravar(id, a, { name: "—", email: "—" }, null, reason);
        falhas.push({ academyId: a.id, name: a.name, reason });
        continue;
      }

      const mail = releaseNotesEmail({
        name: responsavel.name,
        clubName: a.name,
        version: release.version,
        title: release.title,
        notes: release.notes,
        link: this.consolaDe(a.slug),
        logoUrl: this.logoUrl(),
      });

      let erro: string | null = null;
      try {
        const r = await this.mail.send({
          to: responsavel.email,
          toName: responsavel.name,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          kind: "release-notes",
        });
        if (!r.sent) erro = r.reason ?? "O fornecedor de email recusou a mensagem.";
      } catch (e) {
        erro = e instanceof Error ? e.message : "Não foi possível enviar.";
      }

      await this.gravar(id, a, responsavel, erro ? null : new Date(), erro);
      if (erro) falhas.push({ academyId: a.id, name: a.name, reason: erro });
      else enviados++;
    }

    /*
     * A data de envio marca-se à primeira saída e não se volta a mexer: é
     * "quando esta versão foi anunciada", e um reenvio a um clube novo daqui a
     * um mês não muda essa data.
     */
    if (enviados > 0) {
      await this.prisma.release.updateMany({ where: { id, sentAt: null }, data: { sentAt: new Date() } });
    }

    await this.platform.audit(admin, "release.send", "release", id, {
      versao: release.version,
      enviados,
      falhados: falhas.length,
    }, ip);

    return { ok: true as const, enviados, falhas };
  }

  /* ---------------------------------------------------------------------- */

  /**
   * O responsável de um clube, pela ligação do painel.
   *
   * A consulta é a mesma do servidor das academias e a **regra** é literalmente
   * a mesma função (`escolherResponsavel`). O que muda é só a ligação: esta não
   * tem âmbito. Ver a nota em `responsavel.ts`.
   */
  private async responsavelDe(academyId: string) {
    const vinculos = await this.prisma.membership.findMany({
      where: { academyId, isActive: true, role: { notIn: ["GUARDIAN", "ATHLETE"] } },
      orderBy: { createdAt: "asc" },
      select: SELECT_RESPONSAVEL,
    });
    return escolherResponsavel(vinculos);
  }

  private async gravar(
    releaseId: string,
    academy: { id: string; name: string },
    quem: { name: string; email: string },
    sentAt: Date | null,
    error: string | null,
  ) {
    const dados = { academyName: academy.name, name: quem.name, email: quem.email, sentAt, error };
    await this.prisma.releaseRecipient.upsert({
      where: { releaseId_academyId: { releaseId, academyId: academy.id } },
      update: dados,
      create: { releaseId, academyId: academy.id, ...dados },
    });
  }

  private async existe(id: string) {
    const r = await this.prisma.release.findUnique({ where: { id }, select: { id: true, version: true, sentAt: true } });
    if (!r) throw new NotFoundException("Versão não encontrada");
    return r;
  }

  /**
   * O logótipo do email. Por omissão o que o site serve; `EMAIL_LOGO_URL` muda-o
   * sem deploy, para o dia em que o site mudar de casa.
   */
  private logoUrl(): string {
    return this.config.get<string>("EMAIL_LOGO_URL")?.trim() || ACADEMIAS_LOGO_URL;
  }

  /** A consola deste clube. O mesmo desenho dos outros links da casa. */
  private consolaDe(slug: string): string {
    const base = this.config.get<string>("PUBLIC_BASE_URL");
    if (base) return `${base.replace(/\/$/, "").replace("{slug}", slug)}/consola/`;
    return "http://localhost:5173/";
  }
}

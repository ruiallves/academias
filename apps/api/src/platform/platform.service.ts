import { randomBytes, createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PlatformPrisma } from "./platform.prisma";
import { initialRoles, isPresidente } from "../roles/roles.service";
import type { StaffDepartment } from "@prisma/client";
import type { PlatformAdminContext } from "./platform.guard";

/**
 * As leituras e escritas do painel da plataforma.
 *
 * ## De onde vêm os números
 *
 * De funções `SECURITY DEFINER` estreitas — `app.platform_overview()`,
 * `app.platform_academies()`, `app.platform_series()`. Nenhuma devolve linhas de
 * domínio: nem nomes de atletas, nem contactos, nem boletins clínicos. O painel vê
 * o negócio; não vê as pessoas dentro das academias. Ver `docs/04-plataforma.md`.
 *
 * ## O que é derivado e o que é guardado
 *
 * O progresso de onboarding e os alertas são **derivados a cada leitura**, dos
 * dados reais. Um estado guardado à parte diverge no dia em que um cliente apagar
 * uma equipa, e passa a mentir sem ninguém dar por isso — é a mesma disciplina do
 * resto do produto.
 */

/** Os oito passos de `docs/04-plataforma.md`. */
export const ONBOARDING_STEPS = 8;

type OverviewRow = {
  academies: number; setup: number; trial: number; active: number; past_due: number; cancelled: number;
  athletes: number; guardians: number; staff: number;
  mrr_cents: string; new_this_month: number; churn_this_month: number;
};

type AcademyRow = {
  id: string; slug: string; name: string; status: string;
  created_at: Date; trial_ends_at: Date | null;
  plan_name: string | null; sub_status: string | null; mrr_cents: number;
  athletes: number; staff: number; guardians: number; teams: number;
  onboarding_done: number; last_activity: Date | null;
};

export type Alert = {
  id: string;
  severity: "risk" | "warn";
  title: string;
  detail: string;
  academyId: string;
  academyName: string;
};

const DAY = 86_400_000;

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PlatformPrisma,
    private readonly config: ConfigService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* Leitura                                                                   */
  /* ------------------------------------------------------------------------ */

  async overview() {
    const [totals] = await this.prisma.$queryRaw<OverviewRow[]>`SELECT * FROM app.platform_overview()`;
    const academies = await this.academies();

    const mrr = Number(totals.mrr_cents);
    return {
      academies: {
        total: totals.academies,
        setup: totals.setup,
        trial: totals.trial,
        active: totals.active,
        pastDue: totals.past_due,
        cancelled: totals.cancelled,
        newThisMonth: totals.new_this_month,
        churnThisMonth: totals.churn_this_month,
      },
      people: { athletes: totals.athletes, guardians: totals.guardians, staff: totals.staff },
      revenue: { mrrCents: mrr, arrCents: mrr * 12 },
      /*
       * Utilização: a fatia de academias que fechou presenças nos últimos 7 dias.
       *
       * É o melhor preditor de renovação neste produto. Quem deixa de registar
       * presenças deixa de usar, e quem deixa de usar não renova — muito antes de
       * o dizer.
       */
      usage: usageRate(academies),
      alerts: this.alertsFrom(academies),
    };
  }

  async academies() {
    const rows = await this.prisma.$queryRaw<AcademyRow[]>`SELECT * FROM app.platform_academies()`;
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status,
      createdAt: r.created_at,
      trialEndsAt: r.trial_ends_at,
      plan: r.plan_name,
      subscriptionStatus: r.sub_status,
      mrrCents: r.mrr_cents,
      athletes: r.athletes,
      staff: r.staff,
      guardians: r.guardians,
      teams: r.teams,
      onboarding: { done: r.onboarding_done, total: ONBOARDING_STEPS, percent: Math.round((r.onboarding_done / ONBOARDING_STEPS) * 100) },
      lastActivity: r.last_activity,
    }));
  }

  async series(months = 12) {
    return this.prisma.$queryRaw<{ month: Date; new_academies: number; cancelled: number; active_end: number }[]>`
      -- O Prisma envia inteiros como bigint; a funcao recebe int.
      SELECT * FROM app.platform_series(${months}::int)
    `;
  }

  /**
   * O que precisa de atenção.
   *
   * A regra de cada alerta: tem de haver **alguma coisa para fazer** a seguir a
   * lê-lo. Um sinal que só descreve o mundo é um número, e os números estão no
   * resto da página. Por isso não há aqui "academia com poucos atletas" — não se
   * sabe o que fazer com isso.
   */
  private alertsFrom(academies: Awaited<ReturnType<PlatformService["academies"]>>): Alert[] {
    const now = Date.now();
    const alerts: Alert[] = [];

    for (const a of academies) {
      if (a.status === "CANCELLED") continue;
      const base = { academyId: a.id, academyName: a.name };

      if (a.trialEndsAt && a.status === "TRIAL") {
        const days = Math.ceil((new Date(a.trialEndsAt).getTime() - now) / DAY);
        if (days <= 3) {
          alerts.push({
            ...base, id: `${a.id}:trial`, severity: "risk",
            title: days < 0 ? "Trial expirado" : `Trial acaba em ${days} ${days === 1 ? "dia" : "dias"}`,
            detail: "Sem conversão, perde o acesso. É a altura de ligar.",
          });
        }
      }

      if (a.subscriptionStatus === "PAST_DUE") {
        alerts.push({
          ...base, id: `${a.id}:payment`, severity: "risk",
          title: "Pagamento falhado",
          detail: "Receita em risco. Costuma resolver-se com um telefonema.",
        });
      }

      // Assinou e não arrancou — o preditor de churn mais forte que há.
      if (a.status === "SETUP" && now - new Date(a.createdAt).getTime() > 7 * DAY) {
        alerts.push({
          ...base, id: `${a.id}:onboarding`, severity: "warn",
          title: `Onboarding parado em ${a.onboarding.percent}%`,
          detail: `Entrou há ${Math.floor((now - new Date(a.createdAt).getTime()) / DAY)} dias e ainda não montou a academia.`,
        });
      }

      if (a.status !== "SETUP" && a.lastActivity && now - new Date(a.lastActivity).getTime() > 14 * DAY) {
        alerts.push({
          ...base, id: `${a.id}:idle`, severity: "warn",
          title: "Sem atividade há mais de 2 semanas",
          detail: "Deixou de registar presenças. É o que acontece antes de cancelar.",
        });
      }

      if (a.status !== "SETUP" && a.teams > 0 && a.staff <= 1) {
        alerts.push({
          ...base, id: `${a.id}:nostaff`, severity: "warn",
          title: "Sem treinadores",
          detail: "Tem equipas e ninguém para as treinar — comprou e não está a usar.",
        });
      }
    }

    // Risco primeiro: é o que se resolve hoje.
    return alerts.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === "risk" ? -1 : 1));
  }

  /* ------------------------------------------------------------------------ */
  /* Escrita                                                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Cria uma academia e convida o diretor.
   *
   * Reutiliza o mecanismo de convites que já existe — token de 32 bytes, só o
   * hash guardado, 7 dias, uso único, revogável. Não se inventa um segundo sistema
   * de convites: seriam dois sítios onde a segurança pode divergir.
   *
   * A academia nasce em `SETUP` com trial a contar. É o diretor que a põe de pé,
   * e o painel acompanha o progresso.
   */
  async createAcademy(
    admin: PlatformAdminContext,
    dto: {
      name: string;
      slug?: string;
      directorName: string;
      directorEmail: string;
      /**
       * O nome do cargo de quem vai receber o convite, escrito à mão.
       *
       * "Presidente" é o normal e é o que vem por omissão. Qualquer outra coisa
       * — "Coordenador Desportivo", "Diretor-Geral", o que o clube usar — cria
       * esse cargo **e** o de presidente, que fica por preencher. Uma lista
       * fechada aqui obrigava-nos a adivinhar os nomes que os clubes usam, e
       * eles não são adivinháveis. Ver `initialRoles`.
       */
      roleName?: string;
      /** O departamento desse cargo. Nulo é "nenhum" — o caso do presidente. */
      roleDepartment?: StaffDepartment | null;
      /** A cor do clube, quando já se sabe. Omitir deixa a de omissão do schema. */
      signalColor?: string;
      planId?: string;
      trialDays?: number;
    },
    ip?: string,
  ) {
    const name = dto.name.trim();
    if (name.length < 3) throw new BadRequestException("Nome da academia demasiado curto");

    const email = dto.directorEmail.trim().toLowerCase();
    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
      throw new BadRequestException("Email do diretor inválido");
    }

    const slug = (dto.slug?.trim() || slugify(name)).toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw new BadRequestException("Endereço inválido");

    // Slugs reservados: `admin` é o subdomínio do painel, `www`/`api` são
    // infra-estrutura. Uma academia com um destes colidiria com um endereço nosso
    // e poderia interceptar tráfego que não é dela.
    const RESERVED = new Set(["admin", "www", "api", "app", "mail", "static", "assets", "cdn", "platform"]);
    if (RESERVED.has(slug)) throw new BadRequestException("Esse endereço está reservado");

    const taken = await this.prisma.academy.findFirst({ where: { slug }, select: { id: true } });
    if (taken) throw new ConflictException("Já existe uma academia com esse endereço");

    /*
     * Sem plano é uma resposta, não uma omissão a preencher.
     *
     * Isto escolhia o plano mais barato quando `planId` não vinha — o que
     * significava que **não havia forma de criar um clube sem plano**. E há: a
     * maior parte entra em período experimental sem saber ainda o que quer, e a
     * conversa do plano faz-se depois, com o clube já a funcionar. Atribuir-lhe
     * um plano "por omissão" cria uma subscrição que ninguém escolheu, e a
     * plataforma passa a mostrar um plano que o cliente nunca viu.
     *
     * Um `planId` que não exista (ou que já não esteja activo) continua a dar
     * `plan = null` — o clube abre na mesma, sem subscrição. Recusar a criação
     * de um clube por causa de um id de plano é pior do que abri-lo sem ele.
     */
    const plan = dto.planId
      ? await this.prisma.plan.findFirst({ where: { id: dto.planId, isActive: true } })
      : null;

    /*
     * Os dias de teste, mesmo sem plano de onde os tirar.
     *
     * Com plano, é o que o plano disser. Sem plano, os 30 de sempre — o período
     * experimental existe independentemente de haver subscrição, e é ele que a
     * academia vê no menu lateral (ver `TrialBadge`).
     */
    const trialDays = dto.trialDays ?? plan?.trialDays ?? 30;
    const token = randomBytes(32).toString("base64url");

    /*
     * O cargo de quem recebe o convite.
     *
     * Desconhecido cai em presidente, e não num erro: a plataforma manda uma
     * chave de uma lista fechada, e se um dia essa lista mudar, um clube novo
     * abrir com o presidente é uma degradação aceitável — recusar a criação por
     * causa de um nome de cargo não é.
     */
    const nomeCargo = (dto.roleName ?? "").trim() || "Presidente";
    if (nomeCargo.length > 60) throw new BadRequestException("Nome de cargo demasiado longo");

    /*
     * "Presidente" em qualquer grafia é o presidente.
     *
     * Sem isto, escrever "presidente" em minúsculas criava um segundo cargo ao
     * lado do de origem, os dois com todas as permissões e nomes que se lêem
     * igual — o clube abria com duas presidências e ninguém percebia porquê.
     */
    const template = isPresidente(nomeCargo)
      ? null
      : { key: slugify(nomeCargo), name: nomeCargo, department: dto.roleDepartment ?? null };

    /*
     * A cor é validada aqui outra vez, e não só no DTO.
     *
     * O DTO protege o pedido HTTP; isto protege o método, que também é chamado
     * de outros sítios e que escreve numa coluna que vai parar ao CSS de todas
     * as páginas públicas do clube. Uma cor não é um texto qualquer quando é
     * interpolada num `style`.
     */
    if (dto.signalColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(dto.signalColor)) {
      throw new BadRequestException("Cor inválida — usa o formato #RRGGBB");
    }

    const academy = await this.prisma.academy.create({
      data: {
        slug,
        name,
        shortName: shortNameOf(name),
        status: "SETUP",
        trialEndsAt: new Date(Date.now() + trialDays * DAY),
        // Sem cor escolhida não se escreve nada: fica a de omissão do schema, e
        // um `undefined` aqui é diferente de gravar o verde à mão.
        ...(dto.signalColor ? { signalColor: dto.signalColor.toLowerCase() } : {}),
        ...(plan ? { subscription: { create: { planId: plan.id, status: "TRIALING" } } } : {}),
      },
      select: { id: true, slug: true, name: true },
    });

    /*
     * Os cargos, antes do convite.
     *
     * Por esta ordem porque o convite aponta para o cargo: criá-lo primeiro
     * deixaria um convite a apontar para nada, e quem o resgatasse entrava sem
     * cargo nenhum — a academia ficava aberta e sem ninguém com poder para a
     * configurar.
     */
    const { rows, inviteRoleKey, baseRole } = initialRoles(academy.id, template);
    await this.prisma.academyRole.createMany({ data: rows as never, skipDuplicates: true });

    const inviteRole = await this.prisma.academyRole.findFirst({
      where: { academyId: academy.id, key: inviteRoleKey },
      select: { id: true, name: true },
    });

    await this.prisma.staffInvite.create({
      data: {
        academyId: academy.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        email,
        name: dto.directorName.trim() || inviteRole?.name || "Direção",
        role: baseRole,
        title: inviteRole?.name ?? "Presidente",
        /*
         * O enum antigo fica por preencher, de propósito.
         *
         * `academyRoleId` abaixo é a ligação a sério — o cargo sabe o seu
         * departamento, e o departamento é agora uma linha, não um de cinco
         * valores fixos. Repetir aqui uma aproximação do departamento era
         * guardar a mesma coisa duas vezes, com uma delas a poder mentir.
         */
        department: null,
        academyRoleId: inviteRole?.id ?? null,
        expiresAt: new Date(Date.now() + 7 * DAY),
        updatedAt: new Date(),
      },
    });

    await this.audit(
      admin,
      "academy.create",
      "academy",
      academy.id,
      { slug, directorEmail: email, plan: plan?.name, cargo: inviteRole?.name ?? "Presidente" },
      ip,
    );

    return {
      academy,
      inviteLink: this.inviteLink(slug, token),
      trialEndsAt: new Date(Date.now() + trialDays * DAY),
      roleName: inviteRole?.name ?? "Presidente",
    };
  }

  /**
   * Desactivar ou reactivar um clube.
   *
   * ## O que "desactivar" faz mesmo
   *
   * Põe o estado em `CANCELLED`, e é isso que fecha a porta: o resolvedor de
   * slug — o funil por onde a consola, a landing, a página de sócios e os
   * convites passam — deixa de devolver a academia. Ninguém entra, e nenhum
   * endereço do clube responde. Ver a migração `20260826200000`.
   *
   * Os dados ficam todos. Reactivar devolve o clube exactamente onde estava, e é
   * por isso que esta é a via normal — apagar é a excepção, e está a seguir.
   */
  async setAcademyActive(admin: PlatformAdminContext, id: string, active: boolean, ip?: string) {
    const academy = await this.prisma.academy.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, status: true, trialEndsAt: true },
    });
    if (!academy) throw new BadRequestException("Academia não encontrada");

    /*
     * Reactivar devolve-a a `TRIAL` ou a `ACTIVE`, conforme o trial ainda contar.
     * Voltar sempre a `ACTIVE` dava um clube a pagar sem ninguém ter decidido
     * isso; voltar sempre a `TRIAL` dava avaliação de graça a quem já paga.
     */
    const status = active
      ? academy.trialEndsAt && academy.trialEndsAt > new Date()
        ? "TRIAL"
        : "ACTIVE"
      : "CANCELLED";

    await this.prisma.academy.update({ where: { id }, data: { status } });
    await this.audit(
      admin,
      active ? "academy.activate" : "academy.deactivate",
      "academy",
      id,
      { slug: academy.slug, de: academy.status, para: status },
      ip,
    );

    return { ok: true, status };
  }

  /**
   * Apagar um clube — de vez.
   *
   * ## Porque é que isto pede o endereço escrito
   *
   * Porque leva tudo atrás. `onDelete: Cascade` desce por atletas, equipas,
   * presenças, avaliações, boletins clínicos, mensalidades e famílias — anos de
   * trabalho de um clube, num pedido. Um botão com confirmação de "tens a
   * certeza?" não é proporcional a isso: quem está a apagar o clube errado
   * responde "sim" com a mesma facilidade.
   *
   * Escrever o endereço obriga a olhar para **qual** clube se está a apagar, que
   * é exactamente a pergunta que um clique apressado não faz.
   */
  async deleteAcademy(admin: PlatformAdminContext, id: string, confirmSlug: string, ip?: string) {
    const academy = await this.prisma.academy.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true },
    });
    if (!academy) throw new BadRequestException("Academia não encontrada");

    if (confirmSlug.trim().toLowerCase() !== academy.slug.toLowerCase()) {
      throw new BadRequestException(`Escreve "${academy.slug}" para confirmar que é este o clube a apagar`);
    }

    // O registo **antes** de apagar: depois já não há id que aponte para nada, e
    // esta é precisamente a acção que mais interessa ter no histórico.
    await this.audit(admin, "academy.delete", "academy", id, { slug: academy.slug, name: academy.name }, ip);
    await this.prisma.academy.delete({ where: { id } });

    return { ok: true };
  }

  /** Os planos activos, pela ordem em que se lêem no ecrã. */
  async plans() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ order: "asc" }, { amountCents: "asc" }],
    });
  }

  async auditLog(limit = 100) {
    return this.prisma.auditLog.findMany({
      take: Math.min(limit, 500),
      orderBy: { createdAt: "desc" },
      select: {
        id: true, action: true, targetType: true, targetId: true, detail: true, ip: true, createdAt: true,
        admin: { select: { name: true, email: true } },
      },
    });
  }

  /**
   * Escreve no registo.
   *
   * Nunca lança. Um erro a registar não pode impedir a operação que estava a ser
   * registada — mas é gritado no log do servidor, porque um registo de auditoria
   * que falha em silêncio é pior do que não o ter.
   */
  /**
   * O clube existe? — a pergunta antes de lhe escrever o símbolo.
   *
   * Sem isto, um id inventado no endereço criava uma pasta no bucket público com
   * o nome que quem pede escolhesse, e ficava lá um ficheiro sem dono a ocupar
   * espaço para sempre.
   */
  async mustExist(academyId: string): Promise<void> {
    const existe = await this.prisma.academy.findUnique({ where: { id: academyId }, select: { id: true } });
    if (!existe) throw new NotFoundException("Academia não encontrada");
  }

  async audit(
    admin: PlatformAdminContext | null,
    action: string,
    targetType?: string,
    targetId?: string,
    detail?: Record<string, unknown>,
    ip?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: { adminId: admin?.id ?? null, action, targetType, targetId, detail: detail as never, ip },
      });
    } catch (error) {
      console.error("AUDIT FALHOU", action, targetId, error);
    }
  }

  private inviteLink(slug: string, token: string): string {
    const base = this.config.get<string>("PUBLIC_BASE_URL");
    if (base) return `${base.replace(/\/$/, "").replace("{slug}", slug)}/convite/${token}`;
    return `http://localhost:3000/l/${slug}/convite/${token}`;
  }
}

/* ---------------------------------------------------------------------------- */

function usageRate(academies: { status: string; lastActivity: Date | null }[]): number | null {
  const live = academies.filter((a) => a.status === "ACTIVE" || a.status === "TRIAL");
  if (live.length === 0) return null;
  const now = Date.now();
  const usando = live.filter((a) => a.lastActivity && now - new Date(a.lastActivity).getTime() <= 7 * DAY);
  return Math.round((usando.length / live.length) * 100);
}

/** "Academia Life Club" → "academia-life-club". Sem acentos, que não vivem bem num URL. */
function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** O nome curto que aparece na barra lateral e no telemóvel dos pais. */
function shortNameOf(name: string): string {
  const cleaned = name.replace(/^(academia|clube|club|associação|associacao)\s+/i, "").trim();
  return (cleaned || name).slice(0, 24);
}

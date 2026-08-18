import { randomBytes, createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PlatformPrisma } from "./platform.prisma";
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
    dto: { name: string; slug?: string; directorName: string; directorEmail: string; planId?: string; trialDays?: number },
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

    const plan = dto.planId
      ? await this.prisma.plan.findFirst({ where: { id: dto.planId, isActive: true } })
      : await this.prisma.plan.findFirst({ where: { isActive: true }, orderBy: { amountCents: "asc" } });

    const trialDays = dto.trialDays ?? plan?.trialDays ?? 30;
    const token = randomBytes(32).toString("base64url");

    const academy = await this.prisma.academy.create({
      data: {
        slug,
        name,
        shortName: shortNameOf(name),
        status: "SETUP",
        trialEndsAt: new Date(Date.now() + trialDays * DAY),
        ...(plan ? { subscription: { create: { planId: plan.id, status: "TRIALING" } } } : {}),
        invites: {
          create: {
            tokenHash: createHash("sha256").update(token).digest("hex"),
            email,
            name: dto.directorName.trim() || "Direção",
            role: "DIRECTOR",
            title: "Diretor",
            department: "DIRECTION",
            expiresAt: new Date(Date.now() + 7 * DAY),
          },
        },
      },
      select: { id: true, slug: true, name: true },
    });

    await this.audit(admin, "academy.create", "academy", academy.id, { slug, directorEmail: email, plan: plan?.name }, ip);

    return { academy, inviteLink: this.inviteLink(slug, token), trialEndsAt: new Date(Date.now() + trialDays * DAY) };
  }

  async plans() {
    return this.prisma.plan.findMany({ where: { isActive: true }, orderBy: { amountCents: "asc" } });
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

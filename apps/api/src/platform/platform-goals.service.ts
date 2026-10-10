import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PlatformPrisma } from "./platform.prisma";

/**
 * Os objetivos da plataforma: para onde vai o negócio, e quanto falta.
 *
 * ## Medidos sozinhos, quando dá
 *
 * Um objetivo com `metric` lê o número da base a cada abertura do ecrã: ninguém
 * tem de o atualizar, e por isso não fica desatualizado. Os outros (o primeiro
 * clube em Espanha, uma parceria) são à mão: escreve-se o progresso, ou dá-se
 * como feito.
 *
 * ## O que conta
 *
 * Os clubes de testes (`life-club`, `ad-fafe`) e os cancelados ficam de fora,
 * como nos números do site. Um objetivo atingido com dados de teste seria
 * enganarmo-nos a nós próprios.
 */

/** Os clubes que não contam para objetivo nenhum. */
const CLUBES_DE_TESTE = ["life-club", "ad-fafe"];

/** As métricas que se medem sozinhas, com o nome e a unidade para o ecrã. */
export const METRICAS = {
  clubes_pagantes: { label: "Clubes a pagar", unidade: "clubes" },
  clubes_ativos: { label: "Clubes na plataforma", unidade: "clubes" },
  mrr: { label: "Receita mensal (MRR)", unidade: "€" },
  atletas: { label: "Atletas ativos", unidade: "atletas" },
  familias_app: { label: "Famílias a usar a app", unidade: "famílias" },
  modalidades: { label: "Modalidades em uso", unidade: "modalidades" },
  cidades: { label: "Cidades com clubes", unidade: "cidades" },
  analises_ia: { label: "Jogos analisados pela IA", unidade: "jogos" },
  treinos: { label: "Treinos marcados", unidade: "treinos" },
} as const;

export type Metrica = keyof typeof METRICAS;

export const AREAS = ["Clientes", "Receita", "Produto", "Internacional", "Fora da caixa"] as const;

const eMetrica = (m: string): m is Metrica => m in METRICAS;

export type GoalDto = {
  title?: string;
  description?: string | null;
  area?: string;
  metric?: string | null;
  target?: number | null;
  current?: number | null;
  deadline?: string | null;
  done?: boolean;
};

@Injectable()
export class PlatformGoalsService {
  constructor(private readonly prisma: PlatformPrisma) {}

  /** Os valores de hoje de todas as métricas, numa ida à base. */
  async medir(): Promise<Record<Metrica, number>> {
    const [r] = await this.prisma.$queryRaw<Record<Metrica, number | bigint | null>[]>`
      WITH reais AS (
        SELECT id, city FROM "Academy"
        WHERE status <> 'CANCELLED' AND slug <> ALL(${CLUBES_DE_TESTE})
      )
      SELECT
        (SELECT count(*) FROM "Subscription" s JOIN reais a ON a.id = s."academyId" WHERE s.status = 'ACTIVE') AS clubes_pagantes,
        (SELECT count(*) FROM reais) AS clubes_ativos,
        (SELECT coalesce(sum(coalesce(s."priceCents", p."amountCents")), 0) / 100.0
           FROM "Subscription" s JOIN reais a ON a.id = s."academyId" JOIN "Plan" p ON p.id = s."planId"
          WHERE s.status = 'ACTIVE') AS mrr,
        (SELECT count(*) FROM "Athlete" x JOIN reais a ON a.id = x."academyId" WHERE x.status <> 'LEFT') AS atletas,
        (SELECT count(*) FROM "Membership" m JOIN reais a ON a.id = m."academyId"
          WHERE m.role = 'GUARDIAN' AND m."lastSeenAt" IS NOT NULL) AS familias_app,
        (SELECT count(DISTINCT sp.code) FROM "Sport" sp JOIN reais a ON a.id = sp."academyId"
          WHERE EXISTS (SELECT 1 FROM "Team" t WHERE t."sportId" = sp.id)) AS modalidades,
        (SELECT count(DISTINCT lower(trim(city))) FROM reais WHERE city IS NOT NULL AND trim(city) <> '') AS cidades,
        (SELECT count(*) FROM "AIAnalysis" x JOIN reais a ON a.id = x."academyId" WHERE x.status IN ('COMPLETED', 'REVIEW')) AS analises_ia,
        (SELECT count(*) FROM "TrainingSession" x JOIN reais a ON a.id = x."academyId") AS treinos
    `;
    const out = {} as Record<Metrica, number>;
    for (const k of Object.keys(METRICAS) as Metrica[]) out[k] = Number(r?.[k] ?? 0);
    return out;
  }

  async list() {
    const [goals, valores] = await Promise.all([
      this.prisma.platformGoal.findMany({
        where: { archivedAt: null },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      }),
      this.medir(),
    ]);
    return {
      areas: AREAS,
      metricas: Object.entries(METRICAS).map(([key, m]) => ({ key, ...m, valor: valores[key as Metrica] })),
      goals: goals.map((g) => {
        const metrica = g.metric && eMetrica(g.metric) ? g.metric : null;
        const atual = metrica ? valores[metrica] : g.current;
        const atingido = g.doneAt !== null || (g.target !== null && atual !== null && atual >= g.target);
        return {
          id: g.id,
          title: g.title,
          description: g.description,
          area: g.area,
          metric: metrica,
          unidade: metrica ? METRICAS[metrica].unidade : null,
          target: g.target,
          current: atual,
          deadline: g.deadline,
          doneAt: g.doneAt,
          atingido,
          order: g.order,
        };
      }),
    };
  }

  private validar(dto: GoalDto, criar: boolean) {
    if (criar && !dto.title?.trim()) throw new BadRequestException("Falta o objetivo");
    if (dto.area !== undefined && !(AREAS as readonly string[]).includes(dto.area)) throw new BadRequestException("Área desconhecida");
    if (dto.metric && !eMetrica(dto.metric)) throw new BadRequestException("Métrica desconhecida");
    if (dto.target !== undefined && dto.target !== null && !(dto.target > 0)) throw new BadRequestException("A meta tem de ser maior do que zero");
  }

  private dados(dto: GoalDto) {
    return {
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
      ...(dto.area !== undefined ? { area: dto.area } : {}),
      ...(dto.metric !== undefined ? { metric: dto.metric || null } : {}),
      ...(dto.target !== undefined ? { target: dto.target } : {}),
      ...(dto.current !== undefined ? { current: dto.current } : {}),
      ...(dto.deadline !== undefined ? { deadline: dto.deadline ? new Date(dto.deadline) : null } : {}),
      ...(dto.done !== undefined ? { doneAt: dto.done ? new Date() : null } : {}),
    };
  }

  async create(dto: GoalDto) {
    this.validar(dto, true);
    const ultimo = await this.prisma.platformGoal.findFirst({
      where: { area: dto.area ?? AREAS[0] },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    return this.prisma.platformGoal.create({
      data: {
        title: dto.title!.trim(),
        area: dto.area ?? AREAS[0],
        order: (ultimo?.order ?? 0) + 1,
        ...this.dados({ ...dto, title: undefined, area: undefined }),
      },
      select: { id: true },
    });
  }

  async update(id: string, dto: GoalDto) {
    this.validar(dto, false);
    const g = await this.prisma.platformGoal.findUnique({ where: { id }, select: { id: true } });
    if (!g) throw new NotFoundException("Objetivo não encontrado");
    await this.prisma.platformGoal.update({ where: { id }, data: this.dados(dto) });
    return { ok: true };
  }

  /** Arquivado, não apagado: um objetivo abandonado também é história do negócio. */
  async archive(id: string) {
    const g = await this.prisma.platformGoal.findUnique({ where: { id }, select: { id: true } });
    if (!g) throw new NotFoundException("Objetivo não encontrado");
    await this.prisma.platformGoal.update({ where: { id }, data: { archivedAt: new Date() } });
    return { ok: true };
  }
}

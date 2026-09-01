import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { can, type RequestContext } from "../common/permissions";

/**
 * Os catálogos da academia.
 *
 * ## Quem lê e quem escreve
 *
 * **Lê toda a gente** com `academy:read` — um treinador precisa da lista de locais
 * e balneários para marcar um treino, e obrigá-lo a ter `settings:write` para isso
 * seria dar-lhe as definições inteiras. **Escreve** só quem tem `settings:write`:
 * mudar o catálogo muda os menus de toda a academia.
 *
 * ## Uma academia nova abre vazia
 *
 * E é de propósito. Isto semeava quatro campos, quatro balneários e quatro
 * escalões inventados — "Campo 1", "Sub-9" — e o efeito era pior do que a lista
 * vazia que evitava: um diretor entrava pela primeira vez e encontrava metade do
 * arranque já marcada como feita, com dados que não eram do clube dele. Tinha de
 * apagar quatro coisas antes de escrever a primeira que era mesmo sua.
 *
 * A lista vazia diz a verdade, e o painel de arranque diz o que falta.
 *
 * ## A excepção, e porque é que é uma só
 *
 * Os tipos de evento continuam semeados porque **o domínio depende deles**: um
 * treino abre folha de presenças, um jogo tem adversário e resultado. Não são
 * uma sugestão de arrumação, são a diferença que o produto sabe fazer — daí
 * `isSystem`, que os impede de serem apagados ou renomeados.
 *
 * ## Cargos saíram daqui
 *
 * `staffTitles` era um catálogo de texto livre a par dos papéis, e a duplicação
 * era o problema: criava-se "Treinador principal" nos dois sítios e só um deles
 * decidia alguma coisa. O cargo passou a ser o `AcademyRole`, que é o que já
 * carrega as permissões. Ver a migração `20260826090000_cargos_e_desportos`.
 */

// "ageGroups" saiu: o escalão e a equipa eram a mesma coisa dita duas vezes, e a
// equipa passou a ter `maxAge`. Ver a migração `20260827160000_equipa_sem_escalao`.
// "competitions" — as provas que o clube disputa. Entram no catálogo e não numa
// tabela própria porque é exactamente o que os catálogos são: uma lista de
// nomes que o clube gere, por modalidade. Ver a migração `competicoes`.
const KINDS = ["venues", "dressingRooms", "eventTypes", "competitions", "inventoryCategories", "financeIncome", "financeExpense"] as const;
export type CatalogKind = (typeof KINDS)[number];

export function isCatalogKind(value: string): value is CatalogKind {
  return (KINDS as readonly string[]).includes(value);
}

/**
 * Os que existem à partida.
 *
 * Só os tipos de evento, e só porque o domínio os distingue — ver o cabeçalho.
 * Tudo o resto nasce vazio e é o clube que o escreve.
 */
/**
 * O nome da prova que todas as equipas têm.
 *
 * Constante e não literal espalhado: é procurada pelo nome em três sítios (a
 * semeadura, a criação de equipas e a migração), e um deles a divergir criaria
 * uma segunda "Amigável" que ninguém percebia de onde vinha.
 */
export const AMIGAVEL = "Amigável";

const SEED: Partial<Record<CatalogKind, { label: string; note?: string; isSystem?: boolean }[]>> = {
  eventTypes: [
    { label: "Treino", isSystem: true },
    { label: "Jogo", isSystem: true },
    { label: "Torneio", isSystem: true },
    { label: "Evento", isSystem: true },
  ],
  /*
   * "Amigável" é do sistema, e é a razão de a competição poder ser obrigatória
   * num jogo.
   *
   * Um jogo tem sempre uma prova — nem que seja nenhuma, e "nenhuma" chama-se
   * amigável. Com esta a existir sempre e a entrar em cada equipa nova, pedir a
   * competição ao marcar um jogo deixa de ser uma pergunta sem resposta
   * possível: há sempre pelo menos uma opção certa.
   *
   * `isSystem` impede que seja apagada ou renomeada — é a rede, e uma rede que
   * se pode remover do catálogo não é rede.
   */
  competitions: [{ label: AMIGAVEL, isSystem: true }],
  /*
   * As categorias de material, com que o armazém abre.
   *
   * Semeadas e não obrigatórias: um clube que abra o Inventário e encontre a
   * lista vazia tem de inventar uma taxonomia antes de registar a primeira
   * t-shirt — e é aí que fecha a página. Estas seis cobrem o que os clubes
   * arrumam, e nenhuma é `isSystem`: renomeiam-se, arquivam-se e juntam-se
   * outras, porque a arrumação do armazém é de quem o arruma.
   */
  inventoryCategories: [
    { label: "Equipamento de treino" },
    { label: "Equipamento de jogo" },
    { label: "Material de treino" },
    { label: "Material médico" },
    { label: "Equipamento de staff" },
    { label: "Outros" },
  ],
  /*
   * As categorias das Contas, com que o módulo abre.
   *
   * Um clube que abra as Contas com a lista vazia tem de inventar uma taxonomia
   * antes de registar a primeira despesa — e fecha a página. Estas cobrem o que
   * um clube de formação mexe; nenhuma é `isSystem`: renomeiam-se e arquivam-se,
   * porque a arrumação do dinheiro é de quem o gere.
   *
   * As receitas automáticas (mensalidades) não dependem de nenhuma destas —
   * derivam de `Charge` e trazem o rótulo com elas.
   */
  financeIncome: [
    { label: "Quotas de sócios" },
    { label: "Inscrições" },
    { label: "Patrocínios" },
    { label: "Subsídios e apoios" },
    { label: "Donativos" },
    { label: "Bilheteira" },
    { label: "Eventos e torneios" },
    { label: "Bar" },
    { label: "Venda de equipamento" },
    { label: "Outras receitas" },
  ],
  financeExpense: [
    { label: "Transportes" },
    { label: "Equipamento" },
    { label: "Instalações" },
    { label: "Competições e arbitragem" },
    { label: "Salários e prémios" },
    { label: "Alimentação e alojamento" },
    { label: "Material de treino" },
    { label: "Material médico" },
    { label: "Seguros" },
    { label: "Administração" },
    { label: "Outras despesas" },
  ],
  /*
   * As localizações ficam **vazias** de propósito.
   *
   * "Armazém principal" e "Balneário 2" são o sítio de um clube em concreto, e
   * semear nomes que não existem naquela casa é pior do que não semear nada:
   * ficam na lista para sempre, a ninguém ocorre apagá-los, e o campo perde o
   * significado. Quem quiser localizações escreve as suas.
   */
};

@Injectable()
export class CatalogsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tudo de uma vez: são poucas linhas e a consola precisa de todos ao arrancar. */
  async list(ctx: RequestContext) {
    if (!can(ctx, "academy:read")) throw new ForbiddenException("Sem acesso à academia");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      /*
       * O que o domínio distingue semeia-se; o resto nasce vazio.
       *
       * Por `kind` e não de uma vez: uma academia criada antes de as competições
       * existirem já tem `eventTypes` e ficaria sem "Amigável" para sempre se a
       * condição fosse sobre o catálogo inteiro.
       */
      for (const kind of ["eventTypes", "competitions", "inventoryCategories", "financeIncome", "financeExpense"] as const) {
        const jaLa = await db.catalogItem.count({ where: { kind } });
        if (jaLa > 0) continue;
        await db.catalogItem.createMany({
          data: (SEED[kind] ?? []).map((item, i) => ({
            academyId: ctx.academyId,
            kind,
            label: item.label,
            note: item.note ?? null,
            isSystem: item.isSystem ?? false,
            order: i,
            updatedAt: new Date(),
          })),
          skipDuplicates: true,
        });
      }

      return db.catalogItem.findMany({
        orderBy: [{ kind: "asc" }, { order: "asc" }, { label: "asc" }],
        select: {
          id: true, kind: true, label: true, note: true, order: true,
          isSystem: true, archivedAt: true, sportId: true,
        },
      });
    });
  }

  /**
   * Criar um item, num desporto ou em todos.
   *
   * `sportId` nulo é "todos os desportos" — o que um clube de uma modalidade só
   * usa sem nunca ter de escolher nada, e o que todos os itens criados antes
   * desta coluna são.
   */
  async create(ctx: RequestContext, kind: string, label: string, note?: string, sportId?: string | null) {
    this.mustWrite(ctx);
    if (!isCatalogKind(kind)) throw new BadRequestException("Catálogo desconhecido");

    const clean = label.trim();
    if (clean.length < 1) throw new BadRequestException("Falta o nome");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      // O desporto tem de ser desta academia. A RLS já o garantiria, mas dizer
      // "esse desporto não existe" é melhor do que uma violação de chave externa.
      if (sportId) {
        const sport = await db.sport.findFirst({ where: { id: sportId }, select: { id: true } });
        if (!sport) throw new BadRequestException("Desporto desconhecido");
      }

      /*
       * O duplicado, verificado aqui e não só pela chave única.
       *
       * A chave é `(academyId, kind, sportId, label)`, e no Postgres cada NULL é
       * distinto — dois itens globais com o mesmo nome passariam por ela sem
       * darem erro. Ver a nota na migração `20260826090000_cargos_e_desportos`.
       */
      const existing = await db.catalogItem.findFirst({
        where: { kind, label: clean, sportId: sportId ?? null },
        select: { id: true },
      });
      if (existing) throw new BadRequestException(`"${clean}" já existe neste catálogo`);

      const last = await db.catalogItem.findFirst({
        where: { kind, sportId: sportId ?? null },
        orderBy: { order: "desc" },
        select: { order: true },
      });

      try {
        return await db.catalogItem.create({
          data: {
            academyId: ctx.academyId,
            kind,
            label: clean,
            note: note?.trim() || null,
            sportId: sportId ?? null,
            order: (last?.order ?? 0) + 1,
            updatedAt: new Date(),
          },
          select: {
            id: true, kind: true, label: true, note: true, order: true,
            isSystem: true, archivedAt: true, sportId: true,
          },
        });
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
          throw new BadRequestException(`"${clean}" já existe neste catálogo`);
        }
        throw error;
      }
    });
  }

  async update(ctx: RequestContext, id: string, dto: { label?: string; note?: string; order?: number }) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const item = await db.catalogItem.findFirst({ where: { id }, select: { id: true, isSystem: true } });
      if (!item) throw new NotFoundException("Item não encontrado");
      // Renomear "Jogo" para "Partida" partiria o que o domínio distingue.
      if (item.isSystem && dto.label !== undefined) {
        throw new BadRequestException("Este item é do sistema e não se renomeia");
      }

      await db.catalogItem.update({
        where: { id },
        data: {
          ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
          ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
          ...(dto.order !== undefined ? { order: dto.order } : {}),
          updatedAt: new Date(),
        },
      });

      return { ok: true };
    });
  }

  /**
   * Arquivar ou repor.
   *
   * Nunca apagar. "Campo 2" apagado reescreveria o local de todos os treinos que lá
   * aconteceram — os treinos guardam o nome do local, não uma referência, e é
   * deliberado: um treino de 2019 aconteceu onde aconteceu, mesmo que a academia
   * tenha entretanto vendido o campo.
   */
  async setArchived(ctx: RequestContext, id: string, archived: boolean) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const item = await db.catalogItem.findFirst({ where: { id }, select: { id: true, isSystem: true } });
      if (!item) throw new NotFoundException("Item não encontrado");
      if (item.isSystem) throw new BadRequestException("Este item é do sistema e não se arquiva");

      await db.catalogItem.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null, updatedAt: new Date() },
      });

      return { ok: true };
    });
  }

  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "settings:write")) throw new ForbiddenException("Sem permissão para mudar as definições");
  }
}

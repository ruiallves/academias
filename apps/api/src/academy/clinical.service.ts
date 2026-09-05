import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { ClinicalImpact, ClinicalKind, ClinicalStatus, Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { can, type RequestContext } from "../common/permissions";

/**
 * O boletim clínico — escritas.
 *
 * ## Porque é que isto não existia
 *
 * As leituras sempre existiram: o boletim vem dentro de cada atleta em
 * `AcademyService.athletes()`. As **escritas** não. O que a consola registava —
 * uma baixa, uma consulta agendada, uma alta — vivia num objecto em memória no
 * browser, com um comentário a dizer "quando a API existir, isto passa a
 * `POST /athletes/:id/clinical`".
 *
 * Não passou, e o efeito era o pior possível para um departamento clínico: a
 * médica registava a baixa, via-a no ecrã, e ao recarregar a página ela tinha
 * desaparecido. O atleta continuava apto para o treinador convocar. Trabalho
 * clínico perdido em silêncio é o defeito mais caro que este produto podia ter.
 *
 * ## O âmbito
 *
 * `clinical:write`, e o atleta tem de estar no âmbito de quem escreve. Não é a
 * mesma permissão de editar a ficha (`athlete:write`): a médica tem a primeira e
 * não tem a segunda, e é exactamente essa a fronteira que o produto quer — quem
 * trata do atleta não tem de poder mexer-lhe no nome nem no NIF.
 *
 * ## O exame e a validade
 *
 * Registar um exame com data de validade actualiza também `Athlete.medicalValidUntil`
 * — o campo administrativo que decide se o atleta pode competir. São a mesma
 * decisão dita uma vez: sem isto, a médica tinha de registar o exame **e** ir ao
 * formulário administrativo pôr a data, um formulário que lhe exige o NIF do
 * atleta e que nem é dela. Ver `criar`.
 */
@Injectable()
export class ClinicalService {
  constructor(private readonly prisma: PrismaService) {}

  /* ------------------------------------------------------------------------ */

  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "clinical:write")) throw new ForbiddenException("Sem permissão para escrever no boletim clínico");
  }

  /**
   * O atleta está ao alcance de quem escreve?
   *
   * A mesma regra da edição da ficha, e pela mesma razão: a RLS garante a
   * academia, isto garante o escalão. O departamento clínico vê a academia toda
   * (`teamScopeFilter` devolve `undefined` para `MEDICAL`), por isso na prática
   * isto só trava um treinador a escrever no boletim de uma equipa que não é dele.
   */
  private async atletaNoAmbito(db: ScopedClient, ctx: RequestContext, athleteId: string) {
    const athlete = await db.athlete.findFirst({
      where: { id: athleteId },
      select: { id: true, teams: { select: { teamId: true } } },
    });
    if (!athlete) throw new NotFoundException("Atleta não encontrado");

    const scope = ctx.scope?.teamIds;
    /* Sem âmbito de equipas = vê tudo (direcção, clínico). */
    if (!scope) return athlete;
    if (can(ctx, "athlete:read") && ctx.role === "MEDICAL") return athlete;

    const dentro = athlete.teams.some((t) => scope.includes(t.teamId));
    if (!dentro) throw new ForbiddenException("Esse atleta está fora do teu âmbito");
    return athlete;
  }

  private async entradaNoAmbito(db: ScopedClient, ctx: RequestContext, id: string) {
    const entry = await db.clinicalEntry.findFirst({
      where: { id },
      select: { id: true, athleteId: true, kind: true, status: true },
    });
    if (!entry) throw new NotFoundException("Registo clínico não encontrado");
    await this.atletaNoAmbito(db, ctx, entry.athleteId);
    return entry;
  }

  /* ------------------------------------------------------------------------ */

  /**
   * Registar no boletim — ou agendar.
   *
   * É a mesma entidade em dois momentos (ver `ClinicalStatus`): o agendamento de
   * hoje é o registo de amanhã. O que os distingue é o `status`, e um agendamento
   * futuro nunca afasta ninguém — o impacto força-se a `NONE`, porque uma consulta
   * marcada para a semana que vem não pode pôr o atleta de baixa hoje.
   */
  async criar(ctx: RequestContext, athleteId: string, dto: ClinicalInput) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.atletaNoAmbito(db, ctx, athleteId);

      /* Sem data é hoje — registar o que acabou de acontecer é o caso comum. */
      const date = dto.date ? dia(dto.date, "A data do registo é inválida") : dia(new Date().toISOString(), "");
      const agendado = dto.status === "SCHEDULED";
      const impact: ClinicalImpact = agendado ? "NONE" : ((dto.impact ?? "NONE") as ClinicalImpact);

      const expectedReturn = dto.expectedReturn ? dia(dto.expectedReturn, "A data de retoma é inválida") : null;
      if (expectedReturn && expectedReturn < date) {
        throw new BadRequestException("A retoma não pode ser anterior ao registo");
      }

      const entry = await db.clinicalEntry.create({
        data: {
          academyId: ctx.academyId,
          athleteId,
          authorId: ctx.membershipId,
          kind: (dto.kind ?? "NOTE") as ClinicalKind,
          status: (dto.status ?? "DONE") as ClinicalStatus,
          date,
          time: agendado ? dto.time?.trim() || null : null,
          location: agendado ? dto.location?.trim() || null : null,
          title: dto.title?.trim() || TITULO[(dto.kind ?? "NOTE") as ClinicalKind],
          detail: dto.detail?.trim() || null,
          impact,
          expectedReturn,
          outDays:
            expectedReturn && impact !== "NONE"
              ? Math.max(0, Math.round((expectedReturn.getTime() - date.getTime()) / 86_400_000))
              : null,
        },
        select: { id: true },
      });

      /*
       * O exame actualiza a validade administrativa.
       *
       * `medicalValidUntil` é o que decide se um atleta pode competir, e vivia só
       * no formulário administrativo da ficha — que exige o NIF e pede
       * `athlete:write`, nenhuma das duas coisas do departamento clínico. A
       * médica registava o exame e a ficha continuava a dizer "sem exame".
       *
       * Escreve-se aqui, no mesmo gesto e com a permissão de quem faz o exame.
       * Só para exames **realizados**: um exame agendado ainda não valida nada.
       */
      if (dto.kind === "EXAM" && dto.validUntil && dto.status !== "SCHEDULED") {
        await db.athlete.update({
          where: { id: athleteId },
          data: { medicalValidUntil: dia(dto.validUntil, "A validade do exame é inválida") },
        });
      }

      return { id: entry.id };
    });
  }

  /** Corrigir um registo. O que não vier fica como está. */
  async actualizar(ctx: RequestContext, id: string, dto: ClinicalInput) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const entry = await this.entradaNoAmbito(db, ctx, id);

      const data: Prisma.ClinicalEntryUpdateInput = {};
      if (dto.title !== undefined) data.title = dto.title.trim() || TITULO[entry.kind];
      if (dto.detail !== undefined) data.detail = dto.detail.trim() || null;
      if (dto.date !== undefined) data.date = dia(dto.date, "A data do registo é inválida");
      if (dto.time !== undefined) data.time = dto.time.trim() || null;
      if (dto.location !== undefined) data.location = dto.location.trim() || null;
      if (dto.impact !== undefined) data.impact = dto.impact as ClinicalImpact;
      if (dto.status !== undefined) data.status = dto.status as ClinicalStatus;
      if (dto.expectedReturn !== undefined) {
        data.expectedReturn = dto.expectedReturn ? dia(dto.expectedReturn, "A data de retoma é inválida") : null;
      }

      await db.clinicalEntry.update({ where: { id }, data });

      if (dto.kind === "EXAM" && dto.validUntil) {
        await db.athlete.update({
          where: { id: entry.athleteId },
          data: { medicalValidUntil: dia(dto.validUntil, "A validade do exame é inválida") },
        });
      }

      return { ok: true as const };
    });
  }

  /**
   * Dar alta.
   *
   * Fecha a ocorrência em vez de criar outra — a alta é o fim daquela lesão, não
   * um acontecimento separado no historial. É o que devolve o atleta à
   * disponibilidade, porque a disponibilidade é derivada do boletim e não um
   * campo que alguém tem de se lembrar de mudar.
   */
  async darAlta(ctx: RequestContext, id: string, on?: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.entradaNoAmbito(db, ctx, id);
      await db.clinicalEntry.update({
        where: { id },
        data: { clearedOn: on ? dia(on, "A data da alta é inválida") : new Date() },
      });
      return { ok: true as const };
    });
  }

  /** Reabrir uma alta dada por engano. */
  async reabrir(ctx: RequestContext, id: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.entradaNoAmbito(db, ctx, id);
      await db.clinicalEntry.update({ where: { id }, data: { clearedOn: null } });
      return { ok: true as const };
    });
  }

  /**
   * Apagar.
   *
   * Só o que ainda não aconteceu — um agendamento que se desmarca. Um registo do
   * que se passou é histórico clínico e não se faz desaparecer: corrige-se, ou
   * dá-se alta. Apagar uma lesão apagava a razão pela qual um atleta esteve fora
   * três semanas, e essa razão pertence à ficha dele.
   */
  async apagar(ctx: RequestContext, id: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const entry = await this.entradaNoAmbito(db, ctx, id);
      if (entry.status !== "SCHEDULED") {
        throw new BadRequestException(
          "Um registo do que aconteceu não se apaga — corrige-o, ou dá alta. Só agendamentos se desmarcam.",
        );
      }
      await db.clinicalEntry.delete({ where: { id } });
      return { ok: true as const };
    });
  }
}

/* -------------------------------------------------------------------------- */

export type ClinicalInput = {
  kind?: string;
  status?: string;
  date?: string;
  time?: string;
  location?: string;
  title?: string;
  detail?: string;
  impact?: string;
  expectedReturn?: string | null;
  /** Só para exames: até quando é que o atleta fica com o exame válido. */
  validUntil?: string;
};

/** O título por omissão de cada tipo — um registo sem título não é ilegível. */
const TITULO: Record<ClinicalKind, string> = {
  INJURY: "Lesão",
  EXAM: "Exame médico",
  PHYSIO: "Fisioterapia",
  NUTRITION: "Nutrição",
  PSYCHOLOGY: "Psicologia",
  NOTE: "Nota",
};

/**
 * Uma data de calendário, à meia-noite UTC.
 *
 * As colunas são `@db.Date` e o que chega é `2026-03-14`. Sem o `T00:00:00Z`, o
 * `new Date` interpreta no fuso local e uma consulta marcada para dia 14 fica
 * gravada a 13 em qualquer fuso a oeste de Greenwich — que é o nosso metade do
 * ano.
 */
function dia(valor: string, erro: string): Date {
  const d = new Date(`${valor.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(erro);
  return d;
}

import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type { AthleteStatus, DominantSide, Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { can, teamScopeFilter, type RequestContext } from "../common/permissions";
import { gerarCobrancas, periodoActual } from "../billing/billing.service";
import type { AthleteInputDto, AthleteUpdateDto } from "./athletes.dto";

/**
 * Criação de atletas — um a um ou em lote a partir de um ficheiro.
 *
 * ## O que é validado, e onde
 *
 * A **forma** (tipos, comprimentos) é do DTO, na fronteira. As **regras** são aqui:
 * a equipa tem de existir e estar no âmbito de quem cria, a data de nascimento tem
 * de ser plausível, o número de camisola não pode chocar com outro da mesma equipa.
 *
 * ## Porque é que a importação não é "tudo ou nada"
 *
 * Um ficheiro de 120 atletas com uma data mal escrita na linha 87 não deve rejeitar
 * as outras 119. Cada linha é validada por si; as boas entram, as más voltam com o
 * motivo e o número da linha, para se corrigir só essas. É o oposto de uma
 * transação única que falha inteira por causa de um erro — que obrigaria a caçar a
 * agulha no palheiro antes de qualquer progresso.
 *
 * O que **é** atómico é cada linha: o atleta e a sua ligação à equipa entram
 * juntos, ou nenhum entra.
 */
@Injectable()
export class AthletesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cria um atleta. Devolve o registo criado. */
  async create(ctx: RequestContext, dto: AthleteInputDto) {
    if (!can(ctx, "athlete:write")) throw new ForbiddenException("Sem permissão para inscrever atletas");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const teams = await this.teamsInScope(ctx, db);
      const result = await this.insertOne(db, ctx.academyId, dto, teams);
      if ("error" in result) throw new BadRequestException(result.error);

      /*
       * A mensalidade do mês corrente, à inscrição.
       *
       * Sem isto, um atleta inscrito hoje não aparecia em Mensalidades — a página
       * lê `Charge`, e a inscrição criava o atleta e o plantel mas nunca uma
       * cobrança. Não dava erro nenhum: dava uma ausência, que é pior de
       * diagnosticar do que um erro.
       *
       * Não falha a inscrição se não houver preço configurado: `gerarCobrancas`
       * conta-o em `semPreco` e segue. Um clube que ainda não definiu o preço da
       * equipa tem de conseguir inscrever atletas na mesma — o preço define-se
       * depois, e a cobrança nasce quando alguém gerar o mês.
       */
      await gerarCobrancas(db, ctx.academyId, periodoActual(), [result.athlete.id]);

      return result.athlete;
    });
  }

  /**
   * Editar um atleta.
   *
   * ## Porque é que este endpoint passou a existir
   *
   * Havia aqui escrito que um `PATCH` genérico era perigoso porque "alguns dos
   * campos de um atleta são clínicos". O receio é bom; a conclusão é que era
   * demasiado larga. O resultado prático era uma ficha **impossível de corrigir**:
   * um nome mal escrito, uma data trocada, um miúdo que subiu de escalão — nada
   * disso tinha caminho, e a única saída era apagar e voltar a inscrever, o que
   * leva atrás presenças, convocatórias e mensalidades.
   *
   * O que resolve não é recusar a edição, é **fechar a lista**: `AthleteUpdateDto`
   * enumera os campos, e o que é clínico continua a viver em `ClinicalEntry` com
   * autor e permissão próprios. Um campo novo no modelo não entra aqui por
   * acidente — tem de ser escrito no DTO por alguém.
   */
  async update(ctx: RequestContext, id: string, dto: AthleteUpdateDto) {
    if (!can(ctx, "athlete:write")) throw new ForbiddenException("Sem permissão para editar atletas");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const teams = await this.teamsInScope(ctx, db);

      const athlete = await db.athlete.findFirst({
        where: { id },
        select: { id: true, teams: { select: { id: true, teamId: true } } },
      });
      if (!athlete) throw new BadRequestException("Atleta não encontrado");

      // O âmbito passa pelas equipas, como em todo o resto: um treinador só mexe
      // nos atletas das equipas dele. A RLS garante a academia; isto o resto.
      if (!athlete.teams.some((t) => teams.has(t.teamId))) {
        throw new ForbiddenException("Esse atleta está fora do teu âmbito");
      }

      const data: Prisma.AthleteUpdateInput = {};

      if (dto.name !== undefined) data.name = dto.name.trim();

      if (dto.birthdate !== undefined) {
        const birth = new Date(dto.birthdate);
        const year = birth.getUTCFullYear();
        // A mesma janela da inscrição. Uma data fora disto é quase de certeza um
        // erro de digitação (2105 em vez de 2015).
        if (Number.isNaN(birth.getTime()) || year < new Date().getUTCFullYear() - 60 || year > new Date().getUTCFullYear() - 3) {
          throw new BadRequestException("Data de nascimento improvável");
        }
        data.birthdate = birth;
      }

      if (dto.taxId !== undefined) data.taxId = dto.taxId.replace(/[\s.]/g, "");
      if (dto.medicalValidUntil !== undefined) data.medicalValidUntil = new Date(dto.medicalValidUntil);
      if (dto.heightCm !== undefined) data.heightCm = dto.heightCm;
      if (dto.weightDg !== undefined) data.weightKg = dto.weightDg / 10;
      if (dto.dominantSide !== undefined) data.dominantSide = dto.dominantSide as DominantSide;

      if (dto.squadNumber !== undefined) {
        const teamId = dto.teamId ?? athlete.teams[0]?.teamId;
        const clash = await db.athlete.findFirst({
          where: {
            id: { not: id },
            squadNumber: dto.squadNumber,
            teams: { some: { teamId } },
          },
          select: { name: true },
        });
        if (clash) throw new BadRequestException(`O número ${dto.squadNumber} já é do ${clash.name}`);
        data.squadNumber = dto.squadNumber;
      }

      /*
       * Mudar de escalão é actualizar a ligação, não criar outra.
       *
       * Criar uma segunda `TeamMembership` deixava o atleta em dois plantéis ao
       * mesmo tempo — e é assim que um miúdo aparece convocado por duas equipas
       * para o mesmo sábado. O histórico de escalões, quando existir, faz-se com
       * `leftAt`; até lá, uma ligação por atleta é a leitura honesta do modelo.
       */
      if (dto.teamId !== undefined || dto.position !== undefined) {
        const current = athlete.teams[0];
        const teamId = dto.teamId ?? current?.teamId;
        if (!teamId) throw new BadRequestException("Falta a equipa");
        if (!teams.has(teamId)) throw new ForbiddenException("Essa equipa está fora do teu âmbito");

        const position = dto.position === undefined ? undefined : dto.position.trim() || null;

        if (current) {
          await db.teamMembership.update({
            where: { id: current.id },
            data: { teamId, ...(position !== undefined ? { position } : {}) },
          });
        } else {
          await db.teamMembership.create({
            data: { teamId, athleteId: id, ...(position ? { position } : {}) },
          });
        }
      }

      try {
        return await db.athlete.update({ where: { id }, data, select: { id: true, name: true } });
      } catch (error) {
        // Único por academia: repetir um NIF é sempre engano, e é um engano que
        // faria um pai cair no educando errado ao registar-se na app.
        if (isUniqueViolation(error, "taxId")) {
          throw new BadRequestException("Já existe um atleta com este NIF nesta academia");
        }
        throw error;
      }
    });
  }

  /**
   * Escreve o NIF de um atleta que já existe.
   *
   * ## Porque é que isto é um endpoint só para isto
   *
   * Porque uma academia que já importou duzentos atletas não vai reimportá-los para
   * preencher uma coluna — e sem o NIF preenchido nenhuma família consegue reclamar
   * o educando na app. Faltava um caminho para o campo mais importante do fluxo.
   *
   * Continua a existir depois de `update` — não é redundante. Este é o caminho
   * de um campo só, usado na ficha para preencher NIFs em falta sem abrir o
   * formulário inteiro; `update` é o formulário.
   */
  async setTaxId(ctx: RequestContext, id: string, taxId: string) {
    if (!can(ctx, "athlete:write")) throw new ForbiddenException("Sem permissão");

    const nif = taxId.replace(/[\s.]/g, "");
    if (!/^\d{9}$/.test(nif)) throw new BadRequestException("O NIF tem nove dígitos");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      // O âmbito passa pelas equipas, como em todo o resto: um treinador só mexe
      // nos atletas das equipas dele. A RLS garante a academia; isto garante o resto.
      const teams = await this.teamsInScope(ctx, db);
      const athlete = await db.athlete.findFirst({
        where: { id },
        select: { id: true, teams: { select: { teamId: true } } },
      });
      if (!athlete) throw new BadRequestException("Atleta não encontrado");
      if (!athlete.teams.some((t) => teams.has(t.teamId))) {
        throw new ForbiddenException("Esse atleta está fora do teu âmbito");
      }

      try {
        return await db.athlete.update({ where: { id }, data: { taxId: nif }, select: { id: true, taxId: true } });
      } catch (error) {
        if (isUniqueViolation(error, "taxId")) {
          throw new BadRequestException("Já existe um atleta com este NIF nesta academia");
        }
        throw error;
      }
    });
  }

  /**
   * Importa um lote. Devolve o resultado linha a linha.
   *
   * `created` conta as que entraram; `errors` traz `{ row, name, error }` para as
   * que não — com o número da linha tal como no ficheiro, para quem corrige saber
   * onde olhar.
   */
  async importMany(ctx: RequestContext, rows: AthleteInputDto[]) {
    if (!can(ctx, "athlete:write")) throw new ForbiddenException("Sem permissão para inscrever atletas");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const teams = await this.teamsInScope(ctx, db);

      // Nomes já existentes na academia — para não recriar quem já lá está. A
      // comparação é por nome + data de nascimento: dois "João Silva" de idades
      // diferentes são pessoas diferentes; o mesmo nome e a mesma data é o mesmo.
      const existing = new Set(
        (await db.athlete.findMany({ select: { name: true, birthdate: true } })).map(
          (a) => `${a.name.trim().toLowerCase()}|${a.birthdate.toISOString().slice(0, 10)}`,
        ),
      );

      const created: { id: string; name: string }[] = [];
      const errors: { row: number; name: string; error: string }[] = [];
      // Números de camisola já usados por equipa, para apanhar choques **dentro do
      // próprio ficheiro** — dois atletas com o 7 na mesma equipa, na mesma folha.
      const usedNumbers = new Map<string, Set<number>>();

      for (const [i, dto] of rows.entries()) {
        const line = i + 2; // +1 pela base-0, +1 pelo cabeçalho do ficheiro
        const key = `${dto.name.trim().toLowerCase()}|${dto.birthdate.slice(0, 10)}`;

        if (existing.has(key)) {
          errors.push({ row: line, name: dto.name, error: "Já existe um atleta com este nome e data de nascimento" });
          continue;
        }

        if (dto.squadNumber != null) {
          const set = usedNumbers.get(dto.teamId) ?? new Set<number>();
          if (set.has(dto.squadNumber)) {
            errors.push({ row: line, name: dto.name, error: `Número ${dto.squadNumber} repetido nesta equipa dentro do ficheiro` });
            continue;
          }
          set.add(dto.squadNumber);
          usedNumbers.set(dto.teamId, set);
        }

        const result = await this.insertOne(db, ctx.academyId, dto, teams);
        if ("error" in result) {
          errors.push({ row: line, name: dto.name, error: result.error });
        } else {
          created.push({ id: result.athlete.id, name: result.athlete.name });
          existing.add(key);
        }
      }

      /*
       * As mensalidades de todos os que entraram, de uma vez.
       *
       * No fim e não por linha: cento e vinte atletas dariam cento e vinte
       * gerações, cada uma com as suas leituras de planos e inscrições. Uma
       * chamada com a lista toda lê os planos uma vez e escreve as cobranças
       * todas num `createMany`.
       */
      if (created.length > 0) {
        await gerarCobrancas(
          db,
          ctx.academyId,
          periodoActual(),
          created.map((a) => a.id),
        );
      }

      return { created: created.length, errors, athletes: created };
    });
  }

  /* ------------------------------------------------------------------------ */

  /** As equipas que quem cria pode usar — o âmbito, resolvido uma vez por operação. */
  private async teamsInScope(ctx: RequestContext, db: ScopedClient): Promise<Map<string, string>> {
    const scope = teamScopeFilter(ctx);
    const teams = await db.team.findMany({
      where: scope ? { id: scope } : {},
      select: { id: true, name: true },
    });
    return new Map(teams.map((t) => [t.id, t.name]));
  }

  /**
   * Insere um atleta e liga-o à equipa. Devolve `{ athlete }` ou `{ error }`.
   *
   * Não lança — devolve o erro como valor, para a importação poder continuar nas
   * linhas seguintes. Quem chama pelo caminho de "criar um" é que transforma o erro
   * em excepção.
   */
  private async insertOne(
    db: ScopedClient,
    academyId: string,
    dto: AthleteInputDto,
    teams: Map<string, string>,
  ): Promise<{ athlete: { id: string; name: string } } | { error: string }> {
    if (!teams.has(dto.teamId)) {
      return { error: "Equipa desconhecida ou fora do teu âmbito" };
    }

    const birth = new Date(dto.birthdate);
    const year = birth.getUTCFullYear();
    // Um atleta de formação nasceu, na prática, entre há 3 e há 60 anos. Fora
    // disto é quase de certeza um erro de digitação (2105 em vez de 2015).
    if (Number.isNaN(birth.getTime()) || year < new Date().getUTCFullYear() - 60 || year > new Date().getUTCFullYear() - 3) {
      return { error: "Data de nascimento improvável" };
    }

    // Estilo unchecked (`academyId` escalar + `teamId` na ligação): é o que casa
    // com a extensão de tenant, que injecta `academyId` no `create`. A ligação à
    // equipa entra na mesma escrita — atleta e plantel, ou nada.
    const data: Prisma.AthleteUncheckedCreateInput = {
      academyId,
      name: dto.name.trim(),
      birthdate: birth,
      status: "ACTIVE" as AthleteStatus,
      // Sempre presente: o DTO recusa a inscrição sem ele.
      taxId: dto.taxId.replace(/[\s.]/g, ""),
      ...(dto.medicalValidUntil ? { medicalValidUntil: new Date(dto.medicalValidUntil) } : {}),
      ...(dto.heightCm != null ? { heightCm: dto.heightCm } : {}),
      ...(dto.weightDg != null ? { weightKg: dto.weightDg / 10 } : {}),
      ...(dto.dominantSide ? { dominantSide: dto.dominantSide as DominantSide } : {}),
      ...(dto.squadNumber != null ? { squadNumber: dto.squadNumber } : {}),
      teams: { create: { teamId: dto.teamId, ...(dto.position ? { position: dto.position } : {}) } },
    };

    try {
      const athlete = await db.athlete.create({ data, select: { id: true, name: true } });
      return { athlete };
    } catch (error) {
      // Um choque de número de camisola já na base, ou outra restrição — devolvido
      // como erro de linha, não como 500.
      //
      // O NIF é único por academia: repeti-lo é sempre engano, e é um engano que
      // faria um pai cair no educando errado ao registar-se. Vale a pena nomeá-lo.
      if (isUniqueViolation(error, "taxId")) {
        return { error: "Já existe um atleta com este NIF nesta academia" };
      }
      return { error: "Não foi possível inscrever (número de camisola em uso, ou dado inválido)" };
    }
  }
}

/* ---------------------------------------------------------------------------- */

/**
 * Uma violação de unicidade **naquela** coluna.
 *
 * O `P2002` do Prisma traz em `meta.target` as colunas do índice que estourou.
 * Olhar para elas é o que distingue "já existe um atleta com este NIF" de "esse
 * número de camisola está ocupado" — duas frases que mandam a secretaria fazer
 * coisas diferentes, e que sem isto sairiam ambas como a segunda.
 */
function isUniqueViolation(error: unknown, column: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: string; meta?: { target?: unknown } };
  if (e.code !== "P2002") return false;

  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes(column);
  return typeof target === "string" && target.includes(column);
}

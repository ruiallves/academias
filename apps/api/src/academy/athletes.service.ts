import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type { AthleteStatus, DominantSide, Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { can, teamScopeFilter, type RequestContext } from "../common/permissions";
import type { AthleteInputDto } from "./athletes.dto";

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
      return result.athlete;
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
    } catch {
      // Um choque de número de camisola já na base, ou outra restrição — devolvido
      // como erro de linha, não como 500.
      return { error: "Não foi possível inscrever (número de camisola em uso, ou dado inválido)" };
    }
  }
}

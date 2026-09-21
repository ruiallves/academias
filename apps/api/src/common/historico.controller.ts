import { Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, Query, Req } from "@nestjs/common";
import type { ProfileKind } from "@prisma/client";
import type { AuthedRequest } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { can, teamScopeFilter, type RequestContext } from "./permissions";

/**
 * O histórico de uma ficha, para o painel "Histórico" de cada perfil.
 *
 * ## Quem vê
 *
 * Quem pode **editar** a ficha: o histórico é uma ferramenta de quem responde
 * por ela, e mostrar a um treinador que a secretaria mudou o NIF de um atleta
 * de outro escalão não serve para nada. As regras de âmbito são as mesmas da
 * edição — um treinador vê o histórico dos atletas das equipas dele.
 *
 * Não há como escrever aqui: o histórico escreve-se sozinho, de dentro de cada
 * gravação (`registarAlteracoes`), e a própria base só dá `SELECT` e `INSERT`.
 */
@Injectable()
export class HistoricoService {
  constructor(private readonly prisma: PrismaService) {}

  async doPerfil(ctx: RequestContext, kind: ProfileKind, subjectId: string, limite: number) {
    await this.assertPodeVer(ctx, kind, subjectId);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const linhas = await db.profileChange.findMany({
        where: { kind, subjectId },
        orderBy: { createdAt: "desc" },
        take: limite,
        select: { id: true, field: true, before: true, after: true, byName: true, createdAt: true },
      });
      return linhas;
    });
  }

  /** A mesma porta da edição: quem não pode mudar, não vê o que mudou. */
  private async assertPodeVer(ctx: RequestContext, kind: ProfileKind, subjectId: string) {
    const permissao = kind === "ATHLETE" ? "athlete:write" : kind === "MEMBER" ? "member:write" : "access:write";
    if (!can(ctx, permissao)) throw new ForbiddenException("Sem permissão para ver o histórico desta ficha");

    const scope = teamScopeFilter(ctx);
    if (!scope) return; // Quem vê a academia toda vê o histórico todo.

    if (kind === "ATHLETE") {
      await this.prisma.runAs(ctx.academyId, async (db) => {
        const atleta = await db.athlete.findFirst({
          where: { id: subjectId },
          select: { teams: { where: { leftAt: null }, select: { teamId: true } } },
        });
        if (!atleta) throw new NotFoundException("Atleta não encontrado");
        const dele = atleta.teams.some((t) => scope.in.includes(t.teamId));
        // O atleta sem equipa é de quem organiza plantéis, como na edição.
        if (!dele && !(atleta.teams.length === 0 && can(ctx, "team:write"))) {
          throw new ForbiddenException("Esse atleta está fora do teu âmbito");
        }
      });
      return;
    }

    /*
     * Sócios e staff não têm âmbito por equipa: quem chega aqui já provou a
     * permissão, que nestes dois casos é de quem gere o clube.
     */
  }
}

const KINDS: Record<string, ProfileKind> = { atletas: "ATHLETE", socios: "MEMBER", staff: "STAFF" };

@Controller("api/historico")
export class HistoricoController {
  constructor(private readonly historico: HistoricoService) {}

  /**
   * `GET /api/historico/atletas/:id` — as últimas alterações da ficha.
   *
   * O tipo valida-se aqui à mão e não por DTO: um DTO de parâmetros de caminho
   * passa pelo validador global com `forbidNonWhitelisted`, e o `:id` do mesmo
   * caminho aparecia-lhe como "propriedade a mais".
   */
  @Get(":kind/:id")
  doPerfil(
    @Req() req: AuthedRequest,
    @Param("kind") kind: string,
    @Param("id") id: string,
    @Query("limite") limite?: string,
  ) {
    const tipo = KINDS[kind];
    if (!tipo) throw new NotFoundException("Histórico desconhecido");
    const n = Math.min(Math.max(Number(limite) || 60, 1), 200);
    return this.historico.doPerfil(req.ctx, tipo, id, n);
  }
}

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { athleteScopeFilter, athleteTeamScopeWhere, can, type RequestContext } from "../common/permissions";
import { nomeDeQuemMexe, registarAlteracoes } from "../common/historico";
import { AreaAbertaService } from "../mail/area-aberta.service";

/**
 * Ligar um encarregado de educação que **já tem conta** a um atleta.
 *
 * ## O buraco que isto tapa
 *
 * Quem já entra na app por outra porta — é sócio do clube, é treinador, é
 * delegado — não tinha como dizer que tem um filho na academia. O caminho da
 * família era um só: o link de registo, que cria conta nova. Quem já tinha conta
 * ficava sem saída, e a secretaria também: na ficha do atleta dava para ver o
 * encarregado e não dava para lhe pôr um.
 *
 * Agora a secretaria escolhe a pessoa na ficha do atleta, e a área de Família
 * aparece-lhe na app na vez seguinte em que abrir.
 *
 * ## Uma conta, vários chapéus
 *
 * O contexto de família nasce de uma `Membership` com papel `GUARDIAN` — é isso
 * que `app.resolve_memberships` devolve e que a app lê. Um treinador que também
 * é pai fica com **duas** memberships no mesmo clube, e é assim que o produto já
 * trata quem tem dois chapéus (ver `test-conta-com-varios-papeis`). Por isso
 * aqui não se mexe no vínculo que a pessoa já tem: acrescenta-se o de família.
 *
 * ## Entra activo, e sem fila
 *
 * Quem se regista pelo link fica à espera de aprovação, porque ninguém no clube
 * garantiu que aquela pessoa é mesmo encarregada daquele atleta (ver
 * `family-invites.service`). Aqui é o contrário: é o clube que está a ligar, com
 * o atleta à frente. Pôr em fila um pedido que a própria secretaria acabou de
 * fazer era pedir-lhe que se aprovasse a si mesma.
 */
@Injectable()
export class GuardianLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aviso: AreaAbertaService,
  ) {}

  /**
   * As contas do clube que podem passar a encarregadas.
   *
   * Procura entre quem **já tem conta aqui**: staff, sócios com conta ligada e
   * encarregados que já existem (para lhes acrescentar outro educando). Não
   * inventa gente de fora: uma pessoa sem conta entra pelo link de famílias, que
   * é o caminho que já existe e que lhe cria a conta.
   */
  async candidatos(ctx: RequestContext, athleteId: string, procura: string) {
    if (!can(ctx, "family:write")) throw new ForbiddenException("Sem permissão para gerir famílias");
    const q = procura.trim();

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.assertAtletaVisivel(db, ctx, athleteId);

      const jaLigados = new Set(
        (await db.guardianLink.findMany({ where: { athleteId }, select: { membership: { select: { userId: true } } } })).map(
          (l) => l.membership.userId,
        ),
      );

      const vinculos = await db.membership.findMany({
        where: {
          academyId: ctx.academyId,
          isActive: true,
          // O próprio atleta não é encarregado de si.
          role: { not: "ATHLETE" },
          ...(q
            ? {
                user: {
                  OR: [
                    { name: { contains: q, mode: "insensitive" as const } },
                    { email: { contains: q, mode: "insensitive" as const } },
                  ],
                },
              }
            : {}),
        },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          id: true,
          role: true,
          title: true,
          customRole: { select: { name: true } },
          user: { select: { id: true, name: true, email: true } },
          _count: { select: { guardianOf: true } },
        },
      });

      /*
       * Uma linha por **pessoa**, e não por vínculo: quem é treinador e sócio
       * aparecia duas vezes, e escolher uma das duas não queria dizer nada — o
       * que se liga é a conta.
       */
      const porUtilizador = new Map<string, {
        userId: string;
        name: string;
        email: string | null;
        papeis: string[];
        educandos: number;
        jaEncarregado: boolean;
        jaDesteAtleta: boolean;
      }>();

      for (const v of vinculos) {
        const atual = porUtilizador.get(v.user.id) ?? {
          userId: v.user.id,
          name: v.user.name,
          email: v.user.email,
          papeis: [],
          educandos: 0,
          jaEncarregado: false,
          jaDesteAtleta: jaLigados.has(v.user.id),
        };
        const comoSeChama = v.role === "GUARDIAN" ? "Encarregado" : (v.customRole?.name ?? v.title ?? nomeDoPapel(v.role));
        if (!atual.papeis.includes(comoSeChama)) atual.papeis.push(comoSeChama);
        if (v.role === "GUARDIAN") {
          atual.jaEncarregado = true;
          atual.educandos += v._count.guardianOf;
        }
        porUtilizador.set(v.user.id, atual);
      }

      /* Os sócios com conta que ainda não têm vínculo nenhum de staff nem de família. */
      const socios = await db.member.findMany({
        where: {
          NOT: { userId: null },
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: "insensitive" as const } },
                  { email: { contains: q, mode: "insensitive" as const } },
                ],
              }
            : {}),
        },
        take: 200,
        select: { userId: true, name: true, email: true, number: true },
      });
      for (const s of socios) {
        if (!s.userId) continue;
        const atual = porUtilizador.get(s.userId);
        const etiqueta = s.number ? `Sócio n.º ${s.number}` : "Sócio";
        if (atual) {
          if (!atual.papeis.includes(etiqueta)) atual.papeis.push(etiqueta);
        } else {
          porUtilizador.set(s.userId, {
            userId: s.userId,
            name: s.name,
            email: s.email,
            papeis: [etiqueta],
            educandos: 0,
            jaEncarregado: false,
            jaDesteAtleta: jaLigados.has(s.userId),
          });
        }
      }

      return [...porUtilizador.values()].sort((a, b) => a.name.localeCompare(b.name, "pt")).slice(0, 40);
    });
  }

  /**
   * Ligar a conta ao atleta.
   *
   * Reaproveita a membership de família que a pessoa já tenha — e reactiva-a se
   * estiver desligada ou à espera de aprovação, porque quem está a ligar é o
   * clube. Só cria uma nova quando não há nenhuma.
   */
  async ligar(ctx: RequestContext, athleteId: string, userId: string, relacao: string) {
    if (!can(ctx, "family:write")) throw new ForbiddenException("Sem permissão para gerir famílias");
    const relation = relacao.trim() || "Encarregado";

    const feito = await this.prisma.runAs(ctx.academyId, async (db) => {
      await this.assertAtletaVisivel(db, ctx, athleteId);

      /*
       * Quem é esta conta — e sem passar pela tabela `User`.
       *
       * A política RLS de `User` só mostra quem tem uma `Membership` nesta
       * academia, e **um sócio não tem nenhuma** (ver a migração
       * `escotilhas_do_socio`: é por isso que `app.resolve_memberships` lhe
       * devolve vazio). Ler dali dava "Conta não encontrada" precisamente no
       * caso que isto existe para resolver: o sócio do clube que é pai de um
       * atleta.
       *
       * Então pergunta-se onde a pessoa se vê: no vínculo, se o tiver, ou na
       * ficha de sócio. Uma das duas é também a prova de que a conta é deste
       * clube — não há como ligar alguém de fora.
       */
      const vinculo = await db.membership.findFirst({
        where: { academyId: ctx.academyId, userId },
        select: { user: { select: { name: true, email: true } } },
      });
      const socio = vinculo
        ? null
        : await db.member.findFirst({ where: { userId }, select: { name: true, email: true } });
      const conta = vinculo?.user ?? socio;
      if (!conta) {
        throw new BadRequestException("Essa conta não pertence a este clube. Usa o link de famílias para a convidar.");
      }

      const membership = await this.membershipDeFamilia(db, ctx.academyId, userId);

      const antes = await this.nomesDosEncarregados(db, athleteId);
      await db.guardianLink.upsert({
        where: { athleteId_membershipId: { athleteId, membershipId: membership.id } },
        update: { relation },
        create: { athleteId, membershipId: membership.id, relation },
      });
      const depois = await this.nomesDosEncarregados(db, athleteId);

      await registarAlteracoes(
        db, ctx, "ATHLETE", athleteId,
        { encarregados: antes },
        { encarregados: depois },
        await nomeDeQuemMexe(db, ctx),
      );

      return {
        ok: true as const,
        membershipId: membership.id,
        name: conta.name,
        email: conta.email ?? null,
        relation,
        areaNova: membership.areaNova,
      };
    });

    /*
     * Só quando a área de família é nova para esta pessoa, e só depois de a
     * transacção fechar. Não houve convite — a conta já existia — e sem isto
     * ninguém lhe dizia que passou a ter por onde acompanhar o educando.
     */
    if (feito.areaNova) {
      void this.aviso.avisar(ctx.academyId, "family", { name: feito.name, email: feito.email });
    }

    const { areaNova: _ignora, ...resposta } = feito;
    return resposta;
  }

  /** Desligar — o engano que se corrige, e o encarregado que deixou de o ser. */
  async desligar(ctx: RequestContext, athleteId: string, membershipId: string) {
    if (!can(ctx, "family:write")) throw new ForbiddenException("Sem permissão para gerir famílias");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.assertAtletaVisivel(db, ctx, athleteId);

      const antes = await this.nomesDosEncarregados(db, athleteId);
      const { count } = await db.guardianLink.deleteMany({ where: { athleteId, membershipId } });
      if (count === 0) throw new NotFoundException("Esse encarregado não está ligado a este atleta");
      const depois = await this.nomesDosEncarregados(db, athleteId);

      await registarAlteracoes(
        db, ctx, "ATHLETE", athleteId,
        { encarregados: antes },
        { encarregados: depois },
        await nomeDeQuemMexe(db, ctx),
      );

      /*
       * A membership de família fica, mesmo sem educandos.
       *
       * Apagá-la levava atrás o histórico de quem avisou faltas e respondeu a
       * convocatórias (`AbsenceNotice.noticedById`, entre outros), e a pessoa
       * pode voltar a ter um educando para o ano. Uma família sem educandos
       * abre a app e vê a área vazia, que é a verdade.
       */
      return { ok: true as const };
    });
  }

  /**
   * O atleta existe, e está no âmbito de quem está a mexer.
   *
   * `family:write` chega por omissão a quem vê o clube inteiro, mas um cargo do
   * clube pode dá-la a alguém com âmbito de equipa. Sem isto, essa pessoa
   * alcançava qualquer ficha pelo endereço directo — e o que está deste lado da
   * porta não é um telefone, é dar a alguém acesso de família a uma criança.
   */
  private async assertAtletaVisivel(db: ScopedClient, ctx: RequestContext, athleteId: string) {
    const ambito = athleteScopeFilter(ctx);
    const atleta = await db.athlete.findFirst({
      where: {
        id: athleteId,
        // `AND` e não outro `id`: duas chaves com o mesmo nome e a segunda
        // apagava a primeira, que é o próprio atleta que se pediu.
        ...(ambito ? { AND: [{ id: ambito }] } : {}),
        ...(athleteTeamScopeWhere(ctx) ?? {}),
      },
      select: { id: true, name: true },
    });
    if (!atleta) throw new NotFoundException("Atleta não encontrado");
    return atleta;
  }

  /** A membership `GUARDIAN` desta pessoa, viva. Cria-a, ou acorda a que existir. */
  private async membershipDeFamilia(
    db: ScopedClient,
    academyId: string,
    userId: string,
  ): Promise<{ id: string; areaNova: boolean }> {
    const existente = await db.membership.findFirst({
      where: { academyId, userId, role: "GUARDIAN" },
      select: { id: true, isActive: true },
    });
    /*
     * `areaNova` é o que decide se a pessoa é avisada. Acrescentar-lhe um segundo
     * educando não lhe abre área nenhuma — ela já lá entra — e mandar-lhe "tens
     * uma área nova" a cada filho era transformar um aviso útil em ruído.
     */
    if (!existente) {
      const criada = await db.membership.create({
        data: { academyId, userId, role: "GUARDIAN", isActive: true },
        select: { id: true },
      });
      return { id: criada.id, areaNova: true };
    }
    if (existente.isActive) return { id: existente.id, areaNova: false };
    const reactivada = await db.membership.update({
      where: { id: existente.id },
      data: { isActive: true, approvalRequestedAt: null },
      select: { id: true },
    });
    /* Reactivar também abre: a área tinha desaparecido da app dela. */
    return { id: reactivada.id, areaNova: true };
  }

  /** Os nomes, por ordem — é assim que o histórico da ficha os mostra. */
  private async nomesDosEncarregados(db: ScopedClient, athleteId: string): Promise<string[]> {
    const links = await db.guardianLink.findMany({
      where: { athleteId },
      select: { membership: { select: { user: { select: { name: true } } } } },
    });
    return links.map((l) => l.membership.user.name).sort((a, b) => a.localeCompare(b, "pt"));
  }
}

const PAPEIS: Record<string, string> = {
  OWNER: "Presidência",
  DIRECTOR: "Direção",
  COORDINATOR: "Coordenação",
  COACH: "Equipa técnica",
  MEDICAL: "Departamento clínico",
  SCOUT: "Scouting",
  STAFF: "Staff",
  GUARDIAN: "Encarregado",
  ATHLETE: "Atleta",
};
const nomeDoPapel = (role: string) => PAPEIS[role] ?? role;

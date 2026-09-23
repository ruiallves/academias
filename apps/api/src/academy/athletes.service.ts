import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { AthleteStatus, DominantSide, Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { PHOTO_BUCKET } from "../storage/photos.service";
import { can, teamScopeFilter, type RequestContext, teamScopeForRoster } from "../common/permissions";
import { gerarCobrancas, periodoActual } from "../billing/billing.service";
import type { AthleteInputDto, AthleteUpdateDto } from "./athletes.dto";
import { AthleteInvitesService } from "./athlete-invites.service";
import { nomeDeQuemMexe, registarAlteracoes } from "../common/historico";

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
  private readonly log = new Logger(AthletesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly invites: AthleteInvitesService,
  ) {}

  /** Cria um atleta. Devolve o registo criado. */
  async create(ctx: RequestContext, dto: AthleteInputDto) {
    if (!can(ctx, "athlete:write")) throw new ForbiddenException("Sem permissão para inscrever atletas");

    const athlete = await this.prisma.runAs(ctx.academyId, async (db) => {
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

    /*
     * O convite para a app, logo a seguir — como nos sócios: quem é inscrito
     * com email recebe o convite sem ninguém ter de se lembrar de um segundo
     * gesto. Fora da transação (é correio, não base de dados) e sem esperar:
     * a inscrição já é um facto, e um email que falhe tem o botão da ficha.
     *
     * Salvo se quem inscreveu tiver desligado a opção. `sendInvite` ausente é
     * `true`, para nada mudar para quem não lhe toca. Ver
     * `AthleteCreateDto.sendInvite`.
     */
    if (dto.sendInvite !== false) void this.invites.enviarSePossivel(ctx.academyId, athlete.id);

    return athlete;
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

      /*
       * O antes, para o histórico da ficha.
       *
       * Lido na mesma ida à base que o âmbito já obrigava, e só os campos que
       * este formulário mexe: é o que permite dizer "Peso 62 → 64" e quem o
       * escreveu. Ver `common/historico.ts`.
       */
      const athlete = await db.athlete.findFirst({
        where: { id },
        select: {
          id: true, name: true, email: true, birthdate: true, taxId: true, status: true,
          medicalValidUntil: true, heightCm: true, weightKg: true, dominantSide: true, squadNumber: true,
          teams: { where: { leftAt: null }, select: { id: true, teamId: true, position: true, team: { select: { name: true } } } },
        },
      });
      if (!athlete) throw new BadRequestException("Atleta não encontrado");

      /*
       * O âmbito passa pelas equipas, como em todo o resto: um treinador só mexe
       * nos atletas das equipas dele. A RLS garante a academia; isto o resto.
       *
       * **Com uma excepção: o atleta sem equipa nenhuma.** Esse não pertence ao
       * âmbito de ninguém — e a verificação de cima, tal como estava, recusava-o
       * a toda a gente, presidente incluído. Ficava intocável: não se editava
       * para lhe dar equipa, e não se voltava a inscrever porque o NIF já era
       * dele. Quem organiza plantéis (`team:write`) é quem o pode recolocar, e
       * portanto é quem lhe pode mexer.
       */
      if (athlete.teams.length === 0) {
        if (!can(ctx, "team:write")) {
          throw new ForbiddenException("Este atleta está sem equipa — só quem gere equipas o pode recolocar");
        }
      } else if (!athlete.teams.some((t) => teams.has(t.teamId))) {
        throw new ForbiddenException("Esse atleta está fora do teu âmbito");
      }

      const data: Prisma.AthleteUpdateInput = {};

      if (dto.name !== undefined) data.name = dto.name.trim();
      if (dto.email !== undefined) {
        const email = dto.email.trim().toLowerCase();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException("Email do atleta inválido");
        data.email = email || null;
      }

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
            teams: { some: { leftAt: null, teamId } },
          },
          select: { name: true },
        });
        if (clash) throw new BadRequestException(`O número ${dto.squadNumber} já é do ${clash.name}`);
        data.squadNumber = dto.squadNumber;
      }

      /*
       * Mudar de escalão fecha a passagem e abre outra.
       *
       * Era um `update` do `teamId` da mesma linha, e o Sub-11 do ano passado
       * desaparecia: "por onde este miúdo já passou" não tinha resposta. Agora
       * a passagem antiga fica com data de saída — é ela o percurso — e nasce
       * uma nova no escalão novo. Continua a ser **uma de cada vez** por este
       * caminho: quem muda de equipa sai da anterior, e é assim que se evita um
       * miúdo convocado por duas equipas para o mesmo sábado. (A importação
       * pode somar escalões de propósito; ver a nota em `importMany`.)
       *
       * Mudar só a posição não mexe no percurso: é a mesma passagem.
       */
      if (dto.teamId !== undefined || dto.position !== undefined) {
        const current = athlete.teams[0];
        const teamId = dto.teamId ?? current?.teamId;
        if (!teamId) throw new BadRequestException("Falta a equipa");
        if (!teams.has(teamId)) throw new ForbiddenException("Essa equipa está fora do teu âmbito");

        const position = dto.position === undefined ? undefined : dto.position.trim() || null;
        const mudaDeEquipa = Boolean(current) && teamId !== current.teamId;

        if (current && !mudaDeEquipa) {
          if (position !== undefined) {
            await db.teamMembership.update({ where: { id: current.id }, data: { position } });
          }
        } else {
          const agora = new Date();
          if (current) {
            await db.teamMembership.update({ where: { id: current.id }, data: { leftAt: agora } });
          }
          await db.teamMembership.create({
            data: {
              teamId,
              athleteId: id,
              joinedAt: agora,
              // Sem posição nova, leva a que tinha: mudar de escalão não faz de
              // um defesa central um extremo.
              ...(position !== undefined ? { position } : current?.position ? { position: current.position } : {}),
            },
          });
        }
      }

      try {
        const guardado = await db.athlete.update({ where: { id }, data, select: { id: true, name: true } });

        const equipaNova = dto.teamId === undefined ? undefined : (await db.team.findFirst({ where: { id: dto.teamId }, select: { name: true } }))?.name;
        await registarAlteracoes(db, ctx, "ATHLETE", id, {
          ...athlete,
          weightKg: athlete.weightKg === null ? null : Number(athlete.weightKg),
          team: athlete.teams[0]?.team.name ?? null,
          position: athlete.teams[0]?.position ?? null,
        }, {
          ...data,
          weightKg: dto.weightDg === undefined ? undefined : dto.weightDg / 10,
          team: equipaNova,
          position: dto.position === undefined ? undefined : dto.position.trim() || null,
        }, await nomeDeQuemMexe(db, ctx));

        return guardado;
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
        select: { id: true, teams: { where: { leftAt: null }, select: { teamId: true } } },
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
   * Dar baixa, pôr em pausa, ou trazer de volta.
   *
   * ## A acção que faltava
   *
   * O `status` está de fora do `AthleteUpdateDto` de propósito, com uma nota a
   * dizer que "é outra acção, com outra conversa". A conversa é esta, e até aqui
   * não existia: a base tinha os três estados, a consola já desenhava "Em pausa",
   * e não havia caminho nenhum para lá chegar. Um atleta que saísse do clube ou
   * ficava activo para sempre, ou era apagado — e apagar leva o histórico atrás.
   *
   * ## O que cada estado significa
   *
   * `PAUSED` é uma ausência temporária (uma lesão longa, um semestre fora) — o
   * atleta sai das convocatórias mas continua no plantel. `LEFT` é a saída: deixa
   * de contar em tudo o que olha para atletas activos, mensalidades incluídas
   * (ver `gerarCobrancas`, que só gera para `ACTIVE`).
   *
   * Nos dois casos **nada se apaga**: presenças, avaliações, mensalidades pagas e
   * boletim clínico continuam lá. Voltar é pôr `ACTIVE` outra vez.
   */
  async setStatus(ctx: RequestContext, id: string, status: AthleteStatus) {
    if (!can(ctx, "athlete:write")) throw new ForbiddenException("Sem permissão para dar baixa a atletas");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const athlete = await this.inScope(ctx, db, id);

      return db.athlete.update({
        where: { id: athlete.id },
        data: { status },
        select: { id: true, name: true, status: true },
      });
    });
  }

  /**
   * Apagar.
   *
   * ## Porque é que não apaga à primeira
   *
   * Porque um atleta com meio ano de presenças, mensalidades pagas e uma entrada
   * clínica não é uma linha numa tabela: é o registo do que aconteceu. Apagá-lo
   * reescreve o passado de toda a gente à volta. As presenças de um treino
   * passam a não bater certo, uma mensalidade paga desaparece da contabilidade, e
   * a academia perde prova de coisas que pode precisar de mostrar.
   *
   * Por isso o primeiro pedido recusa e **diz o que está agarrado**, com a
   * alternativa à frente: dar baixa (`setStatus`) tira das listas sem perder
   * nada, e é reversível.
   *
   * ## Mas apaga, se for mesmo isso que se quer
   *
   * Recusar sempre era decidir pelo clube. Há casos legítimos que nenhuma
   * contagem distingue de história a sério: o atleta criado por engano que já
   * levou com a emissão automática do mês em cima, o duplicado que alguém
   * convocou antes de reparar, o pedido de apagamento de dados de um menor a
   * que o clube tem de responder. Em todos eles a pessoa à frente do ecrã sabe
   * o que está a fazer, e o servidor não.
   *
   * `forcar` é esse segundo pedido, e a consola só o manda depois de mostrar a
   * lista do que se perde. O que fica registado em `AuditLog` é isso mesmo: quem
   * apagou, o quê, e quanto histórico levou atrás.
   */
  async remove(ctx: RequestContext, id: string, forcar = false) {
    if (!can(ctx, "athlete:write")) throw new ForbiddenException("Sem permissão para apagar atletas");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const athlete = await this.inScope(ctx, db, id);

      const [charges, attendance, clinical, evaluations, reports, callUps, appearances, pagas] = await Promise.all([
        db.charge.count({ where: { athleteId: id } }),
        db.attendanceRecord.count({ where: { athleteId: id } }),
        db.clinicalEntry.count({ where: { athleteId: id } }),
        db.evaluation.count({ where: { athleteId: id } }),
        db.athleteReport.count({ where: { athleteId: id } }),
        db.matchCallUp.count({ where: { athleteId: id } }),
        db.matchAppearance.count({ where: { athleteId: id } }),
        // O dinheiro que já entrou por este atleta. É a única parte do histórico
        // que a contabilidade do clube pode precisar de mostrar a terceiros, e
        // por isso é dita à parte, com o valor.
        db.charge.aggregate({
          where: { athleteId: id, status: "SETTLED" },
          _count: true,
          _sum: { amountCents: true },
        }),
      ]);

      const historia = [
        { n: charges, um: "mensalidade", muitos: "mensalidades" },
        { n: attendance, um: "registo de presença", muitos: "registos de presença" },
        { n: clinical, um: "entrada clínica", muitos: "entradas clínicas" },
        { n: evaluations, um: "avaliação", muitos: "avaliações" },
        { n: reports, um: "relatório", muitos: "relatórios" },
        { n: callUps, um: "convocatória", muitos: "convocatórias" },
        { n: appearances, um: "participação em jogo", muitos: "participações em jogo" },
      ].filter((h) => h.n > 0);

      const pagasN = pagas._count;
      const pagasCents = pagas._sum.amountCents ?? 0;

      if (historia.length > 0 && !forcar) {
        /*
         * Um corpo com estrutura, e não só uma frase.
         *
         * A consola precisa de distinguir esta recusa de qualquer outra para
         * abrir a confirmação em vez de mostrar um erro — daí o `code`. A frase
         * fica na mesma para quem só a lê (a app, um teste, um pedido à mão).
         */
        throw new ConflictException({
          code: "ATHLETE_HAS_HISTORY",
          message: `Este atleta tem ${listar(historia)}. Ao apagar, estes dados também são apagados e não podem ser recuperados.`,
          historia: historia.map((h) => ({ n: h.n, rotulo: h.n === 1 ? h.um : h.muitos })),
          pagas: { n: pagasN, cents: pagasCents },
        });
      }

      /*
       * O dinheiro que entrou fica nas contas.
       *
       * As Finanças não guardam cópia das mensalidades pagas: os Movimentos e o
       * saldo calculam-nas na hora a partir de `Charge` (ver `FinanceService`,
       * a fonte "fees"). Apagar o atleta apaga as cobranças em cascata, e com
       * elas desaparecia receita já recebida, meses para trás, e o saldo do
       * clube mudava sozinho.
       *
       * Por isso cada mensalidade paga passa primeiro a um movimento registado,
       * com a mesma descrição, o mesmo valor e a mesma data com que aparecia.
       * Depois de a cobrança sair, não há duas contas a somar: a linha
       * automática deixa de existir e fica a registada.
       *
       * Só quando o clube soma as mensalidades nas Finanças (`includeFees`).
       * Um clube que as desligou regista a receita à mão, e acrescentar estas
       * linhas era contar o mesmo dinheiro duas vezes.
       */
      let movimentosPreservados = 0;
      if (pagasN > 0) {
        const definicoes = await db.financeSettings.findFirst({
          where: { academyId: ctx.academyId },
          select: { includeFees: true },
        });
        if (definicoes?.includeFees ?? true) {
          const pagasComDetalhe = await db.charge.findMany({
            where: { athleteId: id, status: "SETTLED" },
            select: {
              period: true,
              amountCents: true,
              settledAt: true,
              updatedAt: true,
              payments: { where: { status: "PAID" }, select: { method: true }, take: 1 },
            },
          });
          const criados = await db.financialTransaction.createMany({
            data: pagasComDetalhe.map((c) => ({
              academyId: ctx.academyId,
              kind: "INCOME" as const,
              status: "COMPLETED" as const,
              description: `Mensalidade ${c.period} · ${athlete.name}`,
              amountCents: c.amountCents,
              occurredAt: c.settledAt ?? c.updatedAt,
              method: c.payments[0]?.method ?? null,
              notes: "Mensalidade paga de um atleta que foi apagado.",
              createdById: ctx.membershipId,
            })),
          });
          movimentosPreservados = criados.count;
        }
      }

      /*
       * Apagar com histórico fica escrito, e fora do contexto do tenant.
       *
       * `AuditLog` é da plataforma, não tem `academyId` e sobrevive à cascata —
       * a mesma manobra de `academy.deleted`. É o que permite responder, meses
       * depois, a "para onde é que foram as mensalidades deste atleta".
       */
      if (forcar && historia.length > 0) {
        await this.prisma.$executeRaw`
          INSERT INTO "AuditLog" ("id", "action", "targetType", "targetId", "detail", "createdAt")
          VALUES (
            ${`ath_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`},
            'athlete.deleted.forced',
            'athlete',
            ${id},
            ${JSON.stringify({
              nome: athlete.name,
              academyId: ctx.academyId,
              porMembershipId: ctx.membershipId,
              porUserId: ctx.userId,
              historia: Object.fromEntries(historia.map((h) => [h.muitos, h.n])),
              mensalidadesPagas: pagasN,
              centimosPagos: pagasCents,
              movimentosPreservados,
            })}::jsonb,
            now()
          )
        `;
        this.log.warn(
          `Atleta ${id} (${athlete.name}) apagado com histórico por ${ctx.userId}: ${listar(historia)}.`,
        );
      }

      /*
       * Sem história: o que resta são as ligações, e essas vão em cascata pelo
       * próprio schema — `TeamMembership`, `GuardianLink` e `Enrollment` têm
       * `onDelete: Cascade` no atleta. A conta do encarregado não: essa é uma
       * pessoa, e continua a existir depois de o educando sair.
       *
       * As sete contagens acima cobrem, uma a uma, todas as tabelas que cascatam
       * daqui e que **guardam história** — é essa a lista que interessa manter
       * alinhada com o schema, e não a das cascatas: uma tabela nova que apenas
       * ligue coisas pode cascatar à vontade, uma que registe o que aconteceu tem
       * de ser contada.
       */
      await db.athlete.delete({ where: { id } });

      /*
       * A fotografia sai com ele.
       *
       * A cascata do Postgres não chega ao armazenamento: sem esta linha ficava
       * no bucket a fotografia de uma criança sem nenhum registo que lhe
       * correspondesse — precisamente o que este produto não pode deixar
       * acontecer. Depois do `delete` e não antes: se o apagar falhar, a
       * fotografia continua a pertencer a um atleta que continua a existir.
       *
       * Não trava o apagar se falhar. O atleta já não existe, e devolver erro
       * aqui era dizer que a operação falhou quando ela foi feita.
       */
      if (athlete.photoKey) {
        await this.storage.remove(PHOTO_BUCKET, athlete.photoKey).catch(() => {
          this.log.warn(`Fotografia ${athlete.photoKey} ficou por apagar depois de remover o atleta ${id}.`);
        });
      }

      return { ok: true as const, id, name: athlete.name };
    });
  }

  /**
   * O atleta, se estiver ao alcance de quem pergunta.
   *
   * O âmbito passa pelas equipas, como em todo o resto: um treinador só mexe nos
   * atletas das equipas dele. A RLS garante a academia; isto garante o resto.
   * Extraído de `setTaxId`, que fazia isto à mão — e agora são quatro sítios a
   * precisar da mesma verificação, que é uma a mais para se repetir.
   */
  private async inScope(ctx: RequestContext, db: ScopedClient, id: string) {
    const teams = await this.teamsInScope(ctx, db);
    const athlete = await db.athlete.findFirst({
      where: { id },
      select: { id: true, name: true, photoKey: true, teams: { where: { leftAt: null }, select: { teamId: true } } },
    });
    if (!athlete) throw new NotFoundException("Atleta não encontrado");
    if (!athlete.teams.some((t) => teams.has(t.teamId))) {
      throw new ForbiddenException("Esse atleta está fora do teu âmbito");
    }
    return athlete;
  }

  /**
   * Importa um lote. Devolve o resultado linha a linha.
   *
   * `created` conta as que entraram; `errors` traz `{ row, name, error }` para as
   * que não — com o número da linha tal como no ficheiro, para quem corrige saber
   * onde olhar.
   */
  async importMany(
    ctx: RequestContext,
    rows: AthleteInputDto[],
    opts: { sobrescrever?: boolean; enviarConvites?: boolean } = {},
  ) {
    if (!can(ctx, "athlete:write")) throw new ForbiddenException("Sem permissão para inscrever atletas");

    /*
     * O tempo que um lote pode demorar.
     *
     * Cada linha são duas idas à base — perguntar pelo NIF e escrever o atleta
     * com a ligação à equipa — e a base está do outro lado da Internet: cerca
     * de 640ms por atleta, medidos. Com o tecto por omissão de cinco segundos
     * do Prisma, um plantel de vinte morria a meio e devolvia 500 sem dizer
     * porquê; quatro atletas passavam. Um segundo por linha, com um mínimo de
     * trinta, cobre as 400 linhas que o DTO aceita sem prometer eternidade a
     * uma transação — que continua a segurar uma das cinco ligações enquanto
     * dura.
     */
    const tectoMs = Math.min(Math.max(30_000, rows.length * 1_000), 420_000);

    const resultado = await this.prisma.runAs(ctx.academyId, async (db) => {
      const teams = await this.teamsInScope(ctx, db);

      /*
       * Quem já cá está, pelas duas chaves que importam.
       *
       * O **NIF** é a identidade: é único por academia, a folha traz sempre um,
       * e é por ele que uma linha se reconhece como uma ficha que já existe.
       *
       * O nome com a data de nascimento é a segunda rede, e serve para outra
       * coisa: apanhar a mesma pessoa a entrar com um NIF diferente — um engano
       * de digitação que, sem isto, criava um segundo atleta com o mesmo nome e
       * a mesma idade. Dois "João Silva" de idades diferentes continuam a ser
       * duas pessoas.
       */
      const plantel = await db.athlete.findMany({
        select: {
          id: true, name: true, birthdate: true, taxId: true, email: true,
          medicalValidUntil: true, heightCm: true, weightKg: true,
          dominantSide: true, squadNumber: true,
          teams: { where: { leftAt: null }, select: { teamId: true } },
        },
      });

      /*
       * Tipados como `AtletaNoPlantel` e não pelo que a leitura devolve: os
       * índices também recebem as fichas escritas durante esta própria folha,
       * e essas vêm da linha, não da base.
       */
      const porNif = new Map<string, AtletaNoPlantel>(
        plantel.filter((a) => a.taxId).map((a) => [a.taxId as string, a]),
      );
      const porNomeEData = new Map<string, AtletaNoPlantel>(
        plantel.map((a) => [chaveDoAtleta(a.name, a.birthdate), a]),
      );

      const created: { id: string; name: string }[] = [];
      const updated: { id: string; name: string }[] = [];
      const existing: {
        line: number;
        name: string;
        matchedName: string;
        taxId: string;
        changes: string[];
      }[] = [];
      const errors: { row: number; name: string; error: string }[] = [];
      // Números de camisola já usados por equipa, para apanhar choques **dentro do
      // próprio ficheiro** — dois atletas com o 7 na mesma equipa, na mesma folha.
      const usedNumbers = new Map<string, Set<number>>();

      for (const [i, dto] of rows.entries()) {
        const line = i + 2; // +1 pela base-0, +1 pelo cabeçalho do ficheiro
        const key = `${dto.name.trim().toLowerCase()}|${dto.birthdate.slice(0, 10)}`;
        const nif = dto.taxId.replace(/[\s.]/g, "");

        const jaLaEsta = porNif.get(nif);

        /*
         * O mesmo nome e a mesma data, com outro NIF.
         *
         * Não é uma actualização — é uma contradição, e das que ninguém quer
         * resolver sozinho: ou o NIF da folha está errado, ou o da ficha está.
         * Fica como erro de linha, com o atleta a entrar de fora, e alguém
         * decide. Só quando não foi reconhecido pelo NIF: com o NIF a bater
         * certo, é a mesma pessoa e o nome pode até estar a ser corrigido.
         */
        if (!jaLaEsta && porNomeEData.has(key)) {
          errors.push({ row: line, name: dto.name, error: "Já existe um atleta com este nome e data de nascimento, com outro NIF" });
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

        /*
         * Já cá está: actualiza-se, ou pergunta-se.
         *
         * A equipa da folha **junta-se** às que o atleta já tem em vez de as
         * substituir. Um miúdo que joga no Sub-13 e sobe ao Sub-15 está nas
         * duas, e uma folha por escalão — que é como os clubes as fazem —
         * tirava-lhe a outra sem ninguém pedir.
         */
        if (jaLaEsta) {
          const mudam = mudancasDoAtleta(jaLaEsta, dto, teams);

          if (!opts.sobrescrever) {
            if (mudam.length > 0) {
              existing.push({ line, name: dto.name.trim(), matchedName: jaLaEsta.name, taxId: nif, changes: mudam });
            }
            continue;
          }

          if (mudam.length > 0) {
            await this.updateOne(db, jaLaEsta, dto);
            updated.push({ id: jaLaEsta.id, name: dto.name.trim() });
          }
          continue;
        }

        const result = await this.insertOne(db, ctx.academyId, dto, teams);
        if ("error" in result) {
          errors.push({ row: line, name: dto.name, error: result.error });
        } else {
          created.push({ id: result.athlete.id, name: result.athlete.name });
          /*
           * Entra nos índices, para a própria folha não se duplicar.
           *
           * Duas linhas com o mesmo NIF são a mesma pessoa escrita duas vezes,
           * e a segunda tem de encontrar a primeira. A ficha indexada é a que
           * acabou de ser escrita — construída da linha, e não uma cópia de
           * outro atleta qualquer.
           */
          const nova: AtletaNoPlantel = {
            id: result.athlete.id,
            name: result.athlete.name,
            birthdate: new Date(dto.birthdate),
            taxId: nif,
            email: dto.email?.trim().toLowerCase() || null,
            medicalValidUntil: dto.medicalValidUntil ? new Date(dto.medicalValidUntil) : null,
            heightCm: dto.heightCm ?? null,
            weightKg: dto.weightDg == null ? null : (dto.weightDg / 10),
            dominantSide: (dto.dominantSide as DominantSide) ?? null,
            squadNumber: dto.squadNumber ?? null,
            teams: [{ teamId: dto.teamId }],
          };
          porNomeEData.set(key, nova);
          porNif.set(nif, nova);
        }
      }

      /*
       * A pergunta, antes de escrever seja o que for.
       *
       * `athletes` vazio para que nenhum convite saia por engano no caminho em
       * que nada foi criado. Ver o fim do método.
       */
      if (existing.length > 0 && !opts.sobrescrever) {
        return { created: 0, updated: 0, errors: [], athletes: [], existing: existing.slice(0, 200), existingTotal: existing.length };
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

      return {
        created: created.length,
        updated: updated.length,
        errors,
        athletes: created,
        existing: [] as typeof existing,
        existingTotal: 0,
      };
    }, { timeoutMs: tectoMs });

    /*
     * Os convites dos importados — depois da transação, em série, sem esperar.
     *
     * **Só se tiverem sido pedidos.** Era o que acontecia sempre, e um plantel
     * carregado por Excel mandava dezenas de emails a famílias que não estavam
     * à espera de nenhum. Quem não tem email na folha continua sem convite e
     * sem erro — o caso normal dos escalões mais novos — e a lista de atletas
     * deixa enviá-los depois, às pessoas certas.
     *
     * Só a quem **entrou agora**: um atleta actualizado já cá estava, e o
     * convite dele já saiu (ou já tem conta).
     */
    if (opts.enviarConvites) {
      for (const a of resultado.athletes) void this.invites.enviarSePossivel(ctx.academyId, a.id);
    }

    return resultado;
  }

  /* ------------------------------------------------------------------------ */

  /**
   * As equipas que quem cria pode usar — resolvido uma vez por operação.
   *
   * O mesmo âmbito largo da lista de equipas (`teamScopeForRoster`), e tem de
   * ser o mesmo: mostrar uma equipa a quem inscreve e depois recusá-la com
   * "fora do teu âmbito" seria oferecer uma escolha impossível.
   */
  private async teamsInScope(ctx: RequestContext, db: ScopedClient): Promise<Map<string, string>> {
    const scope = teamScopeForRoster(ctx);
    const teams = await db.team.findMany({
      where: scope ? { id: scope } : {},
      select: { id: true, name: true },
    });
    return new Map(teams.map((t) => [t.id, t.name]));
  }

  /**
   * Actualiza a ficha de um atleta que a folha voltou a trazer.
   *
   * Só o que a folha traz. Um campo que a folha não tem não é o clube a dizer
   * que ele está vazio — é uma coluna em falta, e apagar por causa disso seria
   * a pior maneira de perder dados. O NIF não muda: foi ele que identificou
   * esta ficha.
   *
   * A equipa **junta-se**: ver a nota em `importMany`.
   */
  private async updateOne(db: ScopedClient, actual: AtletaNoPlantel, dto: AthleteInputDto): Promise<void> {
    await db.athlete.update({
      where: { id: actual.id },
      data: {
        name: dto.name.trim(),
        birthdate: new Date(dto.birthdate),
        ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() || null } : {}),
        ...(dto.medicalValidUntil !== undefined
          ? { medicalValidUntil: dto.medicalValidUntil ? new Date(dto.medicalValidUntil) : null }
          : {}),
        ...(dto.heightCm !== undefined ? { heightCm: dto.heightCm } : {}),
        ...(dto.weightDg !== undefined ? { weightKg: dto.weightDg / 10 } : {}),
        ...(dto.dominantSide !== undefined ? { dominantSide: dto.dominantSide as DominantSide } : {}),
        ...(dto.squadNumber !== undefined ? { squadNumber: dto.squadNumber } : {}),
      },
    });

    const jaNaEquipa = actual.teams.some((t) => t.teamId === dto.teamId);
    if (!jaNaEquipa) {
      await db.teamMembership.create({
        data: { teamId: dto.teamId, athleteId: actual.id, ...(dto.position ? { position: dto.position } : {}) },
      });
    } else if (dto.position) {
      await db.teamMembership.updateMany({
        where: { teamId: dto.teamId, athleteId: actual.id },
        data: { position: dto.position },
      });
    }
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

    /*
     * O NIF repetido, perguntado antes de tentar.
     *
     * A recusa vinha da base (índice único `academyId, taxId`) e era traduzida
     * a partir do `meta.target` do erro do Prisma — que **vem nulo** neste
     * caminho, por ser uma escrita aninhada (atleta + ligação à equipa). Sem
     * saber a coluna, a mensagem caía sempre na genérica: quem tentava
     * reinscrever alguém que já lá estava lia "número de camisola em uso" e ia
     * procurar um problema que não existia.
     *
     * Perguntar primeiro custa uma leitura e paga-a toda: em vez de adivinhar a
     * causa, diz-se **quem** é que já tem aquele NIF — que é o que a secretaria
     * precisa de saber para ir buscar a ficha em vez de criar outra.
     */
    const nif = dto.taxId.replace(/[\s.]/g, "");
    const jaExiste = await db.athlete.findFirst({
      where: { taxId: nif },
      select: { name: true, teams: { where: { leftAt: null }, select: { team: { select: { name: true } } }, take: 1 } },
    });
    if (jaExiste) {
      const equipa = jaExiste.teams[0]?.team.name;
      return {
        error: `Já existe um atleta com este NIF: ${jaExiste.name}${equipa ? ` (${equipa})` : " — sem equipa"}`,
      };
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
      taxId: nif,
      ...(dto.email?.trim() ? { email: dto.email.trim().toLowerCase() } : {}),
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

/**
 * "3 mensalidades e 12 registos de presença" — a partir do que se contou.
 *
 * Escrito por extenso e com o "e" no fim de propósito: quem lê a recusa precisa
 * de perceber logo o que está agarrado, e uma lista separada por vírgulas até ao
 * último item lê-se como um erro de sistema.
 */
function listar(itens: { n: number; um: string; muitos: string }[]): string {
  const partes = itens.map((i) => `${i.n} ${i.n === 1 ? i.um : i.muitos}`);
  if (partes.length === 1) return partes[0];
  return partes.slice(0, -1).join(", ") + " e " + partes[partes.length - 1];
}

/* -------------------------------------------------------------------------- */
/* A importação: reconhecer quem já cá está                                    */
/* -------------------------------------------------------------------------- */

/** A ficha como a importação a lê, para comparar com a linha da folha. */
type AtletaNoPlantel = {
  id: string;
  name: string;
  birthdate: Date;
  taxId: string | null;
  email: string | null;
  medicalValidUntil: Date | null;
  heightCm: number | null;
  /** Aceita o `Decimal` da base e o número que a folha acabou de escrever — ver `mudancasDoAtleta`. */
  weightKg: { toString(): string } | number | null;
  dominantSide: DominantSide | null;
  squadNumber: number | null;
  teams: { teamId: string }[];
};

/** Nome e data de nascimento, comparáveis. Ver `importMany`. */
function chaveDoAtleta(name: string, birthdate: Date): string {
  return `${name.trim().toLowerCase()}|${birthdate.toISOString().slice(0, 10)}`;
}

const dia = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * O que muda nesta ficha se a linha da folha for aplicada, em português.
 *
 * Não é um log: é a frase que se mostra antes de perguntar "substituir?". Uma
 * linha que não muda nada não aparece na confirmação nem chega a escrever — e
 * é o caso da maioria das linhas de quem reimporta a folha do ano passado com
 * três nomes novos no fim.
 */
function mudancasDoAtleta(
  actual: AtletaNoPlantel,
  dto: AthleteInputDto,
  teams: Map<string, string>,
): string[] {
  const mudam: string[] = [];

  if (actual.name.trim() !== dto.name.trim()) mudam.push("nome");
  if (dia(actual.birthdate) !== dto.birthdate.slice(0, 10)) mudam.push("data de nascimento");

  if (dto.email !== undefined && (actual.email ?? "") !== (dto.email.trim().toLowerCase() || "")) {
    mudam.push("email");
  }
  if (dto.medicalValidUntil !== undefined && dia(actual.medicalValidUntil) !== (dto.medicalValidUntil?.slice(0, 10) ?? null)) {
    mudam.push("exame médico");
  }
  if (dto.heightCm !== undefined && actual.heightCm !== dto.heightCm) mudam.push("altura");
  if (dto.weightDg !== undefined && Number(actual.weightKg ?? 0) * 10 !== dto.weightDg) mudam.push("peso");
  if (dto.dominantSide !== undefined && actual.dominantSide !== dto.dominantSide) mudam.push("lado dominante");
  if (dto.squadNumber !== undefined && actual.squadNumber !== dto.squadNumber) mudam.push("número");

  if (!actual.teams.some((t) => t.teamId === dto.teamId)) {
    mudam.push(`entra em ${teams.get(dto.teamId) ?? "outra equipa"}`);
  }

  return mudam;
}

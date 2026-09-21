import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type CycleLevel } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { can, inTeamScope, teamScopeFilter, type RequestContext } from "../common/permissions";

/**
 * A periodização: mesociclos e microciclos por cima do calendário.
 *
 * ## Um ciclo não contém treinos
 *
 * Um ciclo é um intervalo de dias de uma equipa, com intenção: fase, foco,
 * objetivo, notas. Os treinos, os jogos e os eventos pertencem-lhe **pela
 * data**, e nada nas tabelas deles aponta para aqui. É o que faz o resto
 * funcionar sem regras:
 *
 *  - os treinos que já existiam entram no ciclo no momento em que ele nasce;
 *  - mover um treino muda-o de microciclo, sem ninguém acertar nada;
 *  - apagar um ciclo nunca apaga nem desliga treinos, porque não há ligação;
 *  - um treino fora de qualquer ciclo é o normal para quem não periodiza.
 *
 * A época da equipa (`Season`) é o macrociclo.
 *
 * ## O microciclo é uma semana
 *
 * Sempre de segunda a domingo: é assim que os clubes planeiam, e foi a decisão
 * de produto. O mesociclo também é feito de semanas inteiras: começa a uma
 * segunda e acaba a um domingo, e o servidor recusa outras datas. Assim cada
 * semana está dentro de um mesociclo só.
 *
 * Os mesociclos de antes desta regra podem acabar a meio de uma semana. Para
 * esses, a semana pertence ao mesociclo que contém a sua **quinta-feira** (a
 * regra da semana ISO), e nenhuma fica partida entre dois. Continuam
 * editáveis enquanto não se lhes mexer nas datas.
 *
 * ## O mesociclo traz as suas semanas
 *
 * Criar um mesociclo cria logo os microciclos por baixo; alargar-lhe as datas
 * cria os que passam a faltar; apagá-lo leva os que ainda estão vazios (sem
 * objetivo, foco nem notas). Sempre só onde não há micro: o que o treinador
 * escreveu numa semana nunca se perde por mexer no mesociclo.
 *
 * ## Datas
 *
 * `startsOn` e `endsOn` são dias inteiros e inclusivos. Circulam como texto
 * `AAAA-MM-DD` e guardam-se como `@db.Date`.
 *
 * ## Sobreposições
 *
 * Dois ciclos do mesmo nível da mesma equipa não se tocam. A base garante-o
 * (restrições de exclusão na migração `20260919120000_periodizacao`); o
 * serviço verifica antes, só para dizer com qual é que choca.
 */

export type CycleView = {
  id: string;
  teamId: string;
  level: CycleLevel;
  startsOn: string;
  endsOn: string;
  name: string | null;
  phase: string | null;
  focus: string[];
  objective: string | null;
  notes: string | null;
  color: string | null;
};

export type CycleInput = {
  teamId?: string;
  level?: CycleLevel;
  startsOn?: string;
  endsOn?: string;
  name?: string | null;
  phase?: string | null;
  focus?: string[];
  objective?: string | null;
  notes?: string | null;
  color?: string | null;
};

export type GenerateInput = { teamId: string; from: string; to: string };

/** O mais comprido que um mesociclo pode ser: 53 semanas. */
const MAX_DIAS_MESO = 371;
/** O máximo que um gesto de "gerar" cria, e a janela em que o faz. */
const MAX_GERADOS = 60;
const MAX_JANELA = 400;

const SELECT = {
  id: true, teamId: true, level: true, startsOn: true, endsOn: true,
  name: true, phase: true, focus: true, objective: true, notes: true, color: true,
} as const;

@Injectable()
export class CyclesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Os ciclos que tocam o intervalo. As equipas que esta pessoa acompanha, ou
   * uma só.
   *
   * O mesmo âmbito dos planos de treino: a periodização de um escalão é do
   * treinador dele. Quem vê a academia toda (direção, coordenação) lê tudo.
   */
  async list(ctx: RequestContext, q: { teamId?: string; from?: string; to?: string }): Promise<CycleView[]> {
    if (!can(ctx, "training:read")) throw new ForbiddenException("Sem acesso à área técnica");
    const scope = teamScopeFilter(ctx);
    if (scope && q.teamId && !scope.in.includes(q.teamId)) {
      throw new ForbiddenException("Esta equipa está fora do teu âmbito");
    }
    const from = q.from ? dia(q.from, "from") : null;
    const to = q.to ? dia(q.to, "to") : null;

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.trainingCycle.findMany({
        where: {
          ...(q.teamId ? { teamId: q.teamId } : scope ? { teamId: scope } : {}),
          ...(to ? { startsOn: { lte: data(to) } } : {}),
          ...(from ? { endsOn: { gte: data(from) } } : {}),
        },
        orderBy: [{ teamId: "asc" }, { startsOn: "asc" }, { level: "asc" }],
        select: SELECT,
      });
      return rows.map(vista);
    });
  }

  async create(ctx: RequestContext, dto: CycleInput): Promise<CycleView> {
    if (!dto.teamId) throw new BadRequestException("Falta a equipa");
    if (dto.level !== "MESO" && dto.level !== "MICRO") throw new BadRequestException("Nível inválido");
    const startsOn = dia(dto.startsOn, "início");
    const endsOn = dia(dto.endsOn, "fim");
    validarIntervalo(dto.level, startsOn, endsOn);
    const campos = limpar(dto);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.assertEquipa(ctx, db, dto.teamId!);
      await this.assertLivre(db, dto.teamId!, dto.level!, startsOn, endsOn);
      const row = await gravar(() =>
        db.trainingCycle.create({
          data: {
            academyId: ctx.academyId,
            teamId: dto.teamId!,
            level: dto.level!,
            startsOn: data(startsOn),
            endsOn: data(endsOn),
            createdById: ctx.membershipId,
            ...campos,
          },
          select: SELECT,
        }),
      );
      if (dto.level === "MESO") await this.encher(ctx, db, dto.teamId!, startsOn, endsOn);
      return vista(row);
    });
  }

  /**
   * Mudar datas ou texto. O nível e a equipa não mudam: um meso que passa a
   * micro é outro ciclo.
   *
   * Mudar as datas não mexe em treinos nenhuns. Os que ficarem de fora passam
   * a estar "sem microciclo", e é isso que o ecrã mostra. As datas só se
   * validam quando mudam: um micro antigo, de antes de serem todos semanas,
   * continua a poder receber um objetivo.
   */
  async update(ctx: RequestContext, id: string, dto: CycleInput): Promise<CycleView> {
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const atual = await db.trainingCycle.findFirst({ where: { id }, select: SELECT });
      if (!atual) throw new NotFoundException("Ciclo não encontrado");
      await this.assertEquipa(ctx, db, atual.teamId);

      const mudaDatas = dto.startsOn !== undefined || dto.endsOn !== undefined;
      const startsOn = dto.startsOn !== undefined ? dia(dto.startsOn, "início") : texto(atual.startsOn);
      const endsOn = dto.endsOn !== undefined ? dia(dto.endsOn, "fim") : texto(atual.endsOn);
      if (mudaDatas) {
        validarIntervalo(atual.level, startsOn, endsOn);
        await this.assertLivre(db, atual.teamId, atual.level, startsOn, endsOn, id);
      }

      const row = await gravar(() =>
        db.trainingCycle.update({
          where: { id },
          data: { ...(mudaDatas ? { startsOn: data(startsOn), endsOn: data(endsOn) } : {}), ...limpar(dto) },
          select: SELECT,
        }),
      );
      if (mudaDatas && atual.level === "MESO") await this.encher(ctx, db, atual.teamId, startsOn, endsOn);
      return vista(row);
    });
  }

  /**
   * Apaga o ciclo. Os treinos nunca vão com ele: não lhe pertencem por chave.
   *
   * Um mesociclo leva as semanas dele que ainda estão vazias, que foram
   * criadas com ele e sem ele não dizem nada. As que já têm objetivo, foco ou
   * notas ficam: são trabalho do treinador.
   */
  async remove(ctx: RequestContext, id: string): Promise<{ ok: true; id: string; microsRemoved: number }> {
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const atual = await db.trainingCycle.findFirst({
        where: { id },
        select: { teamId: true, level: true, startsOn: true, endsOn: true },
      });
      if (!atual) throw new NotFoundException("Ciclo não encontrado");
      await this.assertEquipa(ctx, db, atual.teamId);
      await db.trainingCycle.delete({ where: { id } });

      let microsRemoved = 0;
      if (atual.level === "MESO") {
        const de = texto(atual.startsOn);
        const ate = texto(atual.endsOn);
        const vazias = await db.trainingCycle.findMany({
          where: {
            teamId: atual.teamId, level: "MICRO", objective: null, notes: null, focus: { isEmpty: true },
            startsOn: { lte: data(ate) }, endsOn: { gte: data(de) },
          },
          select: { id: true, startsOn: true, endsOn: true },
        });
        // Só as semanas que eram dele: as de quinta-feira dentro das datas.
        const dele = vazias.filter((m) => {
          const meio = meioDe(texto(m.startsOn), texto(m.endsOn));
          return meio >= de && meio <= ate;
        });
        if (dele.length > 0) {
          const r = await db.trainingCycle.deleteMany({ where: { id: { in: dele.map((m) => m.id) } } });
          microsRemoved = r.count;
        }
      }
      return { ok: true as const, id, microsRemoved };
    });
  }

  /**
   * As semanas de um intervalo (normalmente uma fase), num gesto.
   *
   * Entram as semanas cuja quinta-feira cai no intervalo: as mesmas que a fase
   * leva. Só se cria onde ainda não há micro: o que o treinador já escreveu
   * fica como está, e carregar duas vezes não cria nada da segunda.
   */
  async generate(ctx: RequestContext, dto: GenerateInput): Promise<{ created: number; cycles: CycleView[] }> {
    const from = dia(dto.from, "from");
    const to = dia(dto.to, "to");
    if (to < from) throw new BadRequestException("O fim é antes do início");
    if (entre(from, to) + 1 > MAX_JANELA) throw new BadRequestException("Escolhe um intervalo mais curto");

    const semanas = semanasDe(from, to);
    if (semanas.length > MAX_GERADOS) throw new BadRequestException("São semanas a mais de uma vez. Escolhe um intervalo mais curto.");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.assertEquipa(ctx, db, dto.teamId);
      const created = await this.encher(ctx, db, dto.teamId, from, to);
      const inicio = semanas[0]?.[0] ?? from;
      const fim = semanas[semanas.length - 1]?.[1] ?? to;

      const cycles = await db.trainingCycle.findMany({
        where: { teamId: dto.teamId, startsOn: { lte: data(fim) }, endsOn: { gte: data(inicio) } },
        orderBy: [{ startsOn: "asc" }, { level: "asc" }],
        select: SELECT,
      });
      return { created, cycles: cycles.map(vista) };
    });
  }

  /**
   * As semanas de [de, até] que ainda não têm micro, criadas vazias. Devolve
   * quantas criou. É a peça que o mesociclo usa ao nascer e ao crescer.
   */
  private async encher(ctx: RequestContext, db: ScopedClient, teamId: string, de: string, ate: string): Promise<number> {
    const semanas = semanasDe(de, ate);
    if (semanas.length === 0) return 0;
    const inicio = semanas[0][0];
    const fim = semanas[semanas.length - 1][1];
    const existentes = await db.trainingCycle.findMany({
      where: { teamId, level: "MICRO", startsOn: { lte: data(fim) }, endsOn: { gte: data(inicio) } },
      select: { startsOn: true, endsOn: true },
    });
    const ocupados = existentes.map((e) => [texto(e.startsOn), texto(e.endsOn)] as const);
    const novas = semanas.filter(([a, b]) => !ocupados.some(([x, y]) => x <= b && y >= a));
    if (novas.length > 0) {
      await gravar(() =>
        db.trainingCycle.createMany({
          data: novas.map(([a, b]) => ({
            academyId: ctx.academyId,
            teamId,
            level: "MICRO" as const,
            startsOn: data(a),
            endsOn: data(b),
            createdById: ctx.membershipId,
          })),
        }),
      );
    }
    return novas.length;
  }

  /* ------------------------------------------------------------------------ */

  /** A equipa existe neste clube, e quem escreve pode escrever nela. */
  private async assertEquipa(ctx: RequestContext, db: ScopedClient, teamId: string) {
    if (!can(ctx, "training:write")) throw new ForbiddenException("Sem permissão para planear treinos");
    const team = await db.team.findFirst({ where: { id: teamId }, select: { id: true } });
    if (!team) throw new NotFoundException("Equipa não encontrada");
    if (!inTeamScope(ctx, teamId)) throw new ForbiddenException("Esta equipa está fora do teu âmbito");
  }

  /** A mensagem legível antes da restrição da base: com quem é que choca. */
  private async assertLivre(
    db: ScopedClient, teamId: string, level: CycleLevel, startsOn: string, endsOn: string, exceptId?: string,
  ) {
    const choque = await db.trainingCycle.findFirst({
      where: {
        teamId, level,
        startsOn: { lte: data(endsOn) },
        endsOn: { gte: data(startsOn) },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { startsOn: true, endsOn: true, name: true },
    });
    if (choque) {
      const qual = level === "MICRO" ? "microciclo" : "mesociclo";
      throw new ConflictException(
        `Já há um ${qual}${choque.name ? ` (${choque.name})` : ""} de ${curto(texto(choque.startsOn))} a ${curto(texto(choque.endsOn))} nesta equipa.`,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Peças                                                                       */
/* -------------------------------------------------------------------------- */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const curto = (d: string) => `${Number(d.slice(8, 10))} ${MESES[Number(d.slice(5, 7)) - 1]}`;

/** Um dia `AAAA-MM-DD` válido, ou 400 com o nome do campo. */
function dia(valor: string | undefined, campo: string): string {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new BadRequestException(`Data inválida (${campo})`);
  const d = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== valor) {
    throw new BadRequestException(`Data inválida (${campo})`);
  }
  return valor;
}

const data = (d: string) => new Date(`${d}T00:00:00Z`);
const texto = (d: Date) => d.toISOString().slice(0, 10);
const entre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const somar = (d: string, n: number) => texto(new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000));
/** 0 = domingo. */
const diaDaSemana = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
/** A segunda-feira da semana deste dia. */
const segunda = (d: string) => somar(d, -((diaDaSemana(d) + 6) % 7));
/** O dia do meio de um micro: a quinta-feira de uma semana. */
const meioDe = (a: string, b: string) => somar(a, Math.floor(entre(a, b) / 2));

function validarIntervalo(level: CycleLevel, startsOn: string, endsOn: string) {
  if (endsOn < startsOn) throw new BadRequestException("O fim é antes do início");
  if (level === "MICRO") {
    if (diaDaSemana(startsOn) !== 1 || entre(startsOn, endsOn) !== 6) {
      throw new BadRequestException("Um microciclo é uma semana, de segunda a domingo.");
    }
    return;
  }
  // O mesociclo é feito de semanas inteiras, como os microciclos que traz.
  if (diaDaSemana(startsOn) !== 1 || diaDaSemana(endsOn) !== 0) {
    throw new BadRequestException("Um mesociclo são semanas inteiras: começa a uma segunda e acaba a um domingo.");
  }
  if (entre(startsOn, endsOn) + 1 > MAX_DIAS_MESO) {
    throw new BadRequestException(`Um mesociclo tem no máximo ${Math.floor(MAX_DIAS_MESO / 7)} semanas.`);
  }
}

/**
 * As semanas (segunda a domingo) cuja quinta-feira cai em [de, até]: as que
 * pertencem a uma fase com essas datas.
 */
export function semanasDe(de: string, ate: string): [string, string][] {
  const out: [string, string][] = [];
  let s = segunda(de);
  if (somar(s, 3) < de) s = somar(s, 7);
  while (somar(s, 3) <= ate) {
    out.push([s, somar(s, 6)]);
    s = somar(s, 7);
  }
  return out;
}

/** Os campos de texto, aparados e com limite. `undefined` fica de fora (não muda). */
function limpar(dto: CycleInput) {
  const t = (v: string | null | undefined, max: number) =>
    v === undefined ? undefined : (v ?? "").trim().slice(0, max) || null;
  const out: Prisma.TrainingCycleUpdateInput = {};
  const name = t(dto.name, 60);
  const phase = t(dto.phase, 40);
  const objective = t(dto.objective, 300);
  const notes = t(dto.notes, 2000);
  if (name !== undefined) out.name = name;
  if (phase !== undefined) out.phase = phase;
  if (objective !== undefined) out.objective = objective;
  if (notes !== undefined) out.notes = notes;
  if (dto.focus !== undefined) {
    out.focus = [...new Set(dto.focus.map((f) => f.trim().slice(0, 60)).filter(Boolean))].slice(0, 8);
  }
  if (dto.color !== undefined) {
    if (dto.color !== null && dto.color !== "" && !/^#[0-9a-f]{6}$/i.test(dto.color)) {
      throw new BadRequestException("Cor inválida");
    }
    out.color = dto.color || null;
  }
  return out as {
    name?: string | null; phase?: string | null; objective?: string | null;
    notes?: string | null; focus?: string[]; color?: string | null;
  };
}

function vista(r: {
  id: string; teamId: string; level: CycleLevel; startsOn: Date; endsOn: Date; name: string | null;
  phase: string | null; focus: string[]; objective: string | null; notes: string | null; color: string | null;
}): CycleView {
  return { ...r, startsOn: texto(r.startsOn), endsOn: texto(r.endsOn) };
}

/**
 * A restrição de exclusão, traduzida. O serviço já verificou antes; isto só
 * apanha dois pedidos ao mesmo tempo.
 */
async function gravar<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("sem_sobreposicao") || msg.includes("23P01")) {
      throw new ConflictException("Já há um ciclo do mesmo nível nesses dias.");
    }
    throw e;
  }
}

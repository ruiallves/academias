import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type { CalendarEventKind } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { calendarScopeFilter, can, teamScopeFilter, type RequestContext } from "../common/permissions";
import { instanteNoFuso, lerHora, partesNoFuso } from "../common/fuso";
import {
  chave,
  diasDaSerie,
  hhmm,
  kindDoRotulo,
  lerDia,
  planearOcorrencias,
  tituloPorOmissao,
  type Candidato,
  type Dia,
  type JaMarcado,
} from "./calendario-regras";

/**
 * Importar o calendário de uma folha.
 *
 * ## Porque é que isto não passa pelo `createEvent`
 *
 * Passaria, e seria uma chamada por evento. Uma época de um clube com dez
 * escalões são mais de mil eventos, e cada um deles faria, no caminho normal,
 * meia dúzia de idas à base — a contar as três tabelas de conflitos. O que aqui
 * se faz é o mesmo trabalho pela ordem inversa: **lê-se uma vez** tudo o que já
 * está marcado na janela do ficheiro, e a seguir decide-se tudo em memória.
 *
 * As regras são as mesmas do diálogo, e têm de continuar a ser: uma equipa não
 * está em dois sítios à mesma hora, um balneário não se partilha, um jogo tem
 * adversário e prova, um treino tem equipa. Ver `createSingleEvent`.
 *
 * ## O ensaio
 *
 * `dryRun` corre tudo e **não escreve nada**: devolve quantos eventos saem de
 * cada linha, o que choca e com quê. É o que permite ao ecrã dizer "1 132
 * eventos, 4 chocam, estes" antes de a pessoa carregar em importar. Uma
 * importação de calendário às cegas é a única em que um engano não se vê: os
 * eventos ficam espalhados por doze meses, e ninguém os relê.
 *
 * ## O que é conflito, e o que não é
 *
 * **Sobreposição de horário da mesma equipa** e **de balneário**. O local não:
 * dois escalões dividem um campo ao meio todos os dias, e recusar isso tornava
 * a importação inútil no clube que mais precisa dela.
 *
 * Um conflito **salta a ocorrência** e conta-se; não derruba o ficheiro. Marcar
 * terças e quintas até Junho vai bater no feriado em que já há outra coisa, e
 * recusar as outras 40 por causa dessa seria obrigar a corrigir o ficheiro para
 * um dia que se resolve num minuto no calendário.
 */

/**
 * O tecto do ficheiro inteiro.
 *
 * Uma época de um clube grande — vinte equipas, três treinos por semana, dez
 * meses — dá umas 2 400. Três mil é folga sobre isso e trava o ficheiro que
 * repete tudo até 2040 por engano num campo "até".
 */
const MAX_TOTAL = 3000;

export type LinhaDoFicheiro = {
  /** A linha no ficheiro, para a mensagem voltar com ela. */
  linha: number;
  /** A folha de onde veio: "Treinos", "Jogos", "Outros". */
  folha: string;
  kind?: string;
  /** O nome da equipa, como está escrito na folha. */
  team?: string;
  title?: string;
  /** `AAAA-MM-DD`, no relógio do clube. */
  date: string;
  /** `HH:MM`. */
  start: string;
  end: string;
  venue: string;
  dressingRooms?: string[];
  /** O nome do tipo de evento, do catálogo do clube. */
  type?: string;
  opponent?: string;
  isHome?: boolean;
  /** O nome da prova, do catálogo do clube. */
  competition?: string;
  respondBy?: string;
  /** `AAAA-MM-DD` — o último dia da repetição, incluído. */
  repeatUntil?: string;
  freq?: string;
  /** 0 = domingo, como `Date.getDay()`. Só no semanal. */
  weekdays?: number[];
};

type Resolvida = {
  origem: LinhaDoFicheiro;
  kind: CalendarEventKind;
  teamId: string | null;
  teamName: string | null;
  title: string;
  venue: string;
  dressingRooms: string[];
  typeId: string | null;
  opponent: string | null;
  isHome: boolean;
  competitionId: string | null;
  respondBy: "GUARDIAN" | "ATHLETE";
  dias: Dia[];
  hora: { hora: number; minuto: number };
  fim: { hora: number; minuto: number };
};

export type ResultadoDaImportacao = {
  /** Quantos eventos as linhas dão, depois de repetidas. */
  total: number;
  /** Quantos foram mesmo criados. Zero no ensaio. */
  criados: number;
  ensaio: boolean;
  /** Por tipo, quantos entram — é o que o ecrã resume. */
  porTipo: { treinos: number; jogos: number; outros: number };
  erros: { linha: number; folha: string; erro: string }[];
  conflitos: { linha: number; folha: string; quando: string; motivo: string }[];
};


/** Uma linha da exportação: as colunas da importação, mais o estado. */
export type LinhaExportada = {
  team: string | null;
  date: string;
  start: string;
  end: string;
  venue: string;
  dressingRooms: string[];
  cancelled: boolean;
  /* Treinos */
  respondBy?: "GUARDIAN" | "ATHLETE";
  /* Jogos */
  opponent?: string;
  isHome?: boolean;
  competition?: string | null;
  /* Outros */
  type?: string | null;
  title?: string;
};

export type CalendarioExportado = { treinos: LinhaExportada[]; jogos: LinhaExportada[]; outros: LinhaExportada[] };

/** Um ano e pouco: uma época inteira, com folga para quem a começa em Julho. */
const MAX_DIAS_EXPORTADOS = 400;

@Injectable()
export class EventsImportService {
  constructor(private readonly prisma: PrismaService) {}

  async importar(
    ctx: RequestContext,
    rows: LinhaDoFicheiro[],
    opcoes: { ensaio?: boolean } = {},
  ): Promise<ResultadoDaImportacao> {
    if (!can(ctx, "calendar:write")) throw new ForbiddenException("Sem permissão para criar eventos");
    if (rows.length === 0) throw new BadRequestException("O ficheiro não tem linhas");

    const ensaio = opcoes.ensaio === true;
    const scope = teamScopeFilter(ctx);

    /* Um lote grande segura uma ligação: o tecto acompanha o tamanho, como na importação de atletas. */
    const tectoMs = Math.min(Math.max(30_000, rows.length * 400), 420_000);

    return this.prisma.runAs(
      ctx.academyId,
      async (db) => {
        const erros: ResultadoDaImportacao["erros"] = [];
        const conflitos: ResultadoDaImportacao["conflitos"] = [];

        /* Os nomes que a folha usa, resolvidos de uma vez. */
        const [equipas, tipos, provas] = await Promise.all([
          db.team.findMany({ select: { id: true, name: true } }),
          db.catalogItem.findMany({ where: { kind: "eventTypes", archivedAt: null }, select: { id: true, label: true } }),
          db.catalogItem.findMany({ where: { kind: "competitions", archivedAt: null }, select: { id: true, label: true } }),
        ]);
        const porNome = <T extends { label?: string; name?: string }>(xs: T[]) =>
          new Map(xs.map((x) => [chave(x.label ?? x.name ?? ""), x]));
        const equipaPorNome = porNome(equipas);
        const tipoPorNome = porNome(tipos);
        const provaPorNome = porNome(provas);

        /* As provas que cada equipa disputa — um jogo só entra numa das suas. */
        const disputa = new Set(
          (await db.teamCompetition.findMany({ select: { teamId: true, competitionId: true } })).map(
            (t) => `${t.teamId}|${t.competitionId}`,
          ),
        );

        const resolvidas: Resolvida[] = [];
        let total = 0;

        for (const row of rows) {
          const falha = (erro: string) => erros.push({ linha: row.linha, folha: row.folha, erro });

          const inicio = lerHora(row.start ?? "");
          const fim = lerHora(row.end ?? "");
          const primeiro = lerDia(row.date ?? "");
          if (!primeiro) {
            falha("Data inválida (usa AAAA-MM-DD)");
            continue;
          }
          if (!inicio || !fim) {
            falha("Hora inválida (usa HH:MM)");
            continue;
          }
          if (fim.hora * 60 + fim.minuto <= inicio.hora * 60 + inicio.minuto) {
            falha("O fim tem de ser depois do início");
            continue;
          }
          if (!row.venue?.trim()) {
            falha("Falta o local");
            continue;
          }

          /*
           * O tipo do catálogo decide o que o evento é — a mesma regra do
           * diálogo (`kindOfEventType` na consola). A folha de onde veio a linha
           * é o recurso quando ela não traz tipo.
           */
          let typeId: string | null = null;
          if (row.type?.trim()) {
            const tipo = tipoPorNome.get(chave(row.type));
            if (!tipo) {
              falha(`Tipo de evento desconhecido: "${row.type.trim()}"`);
              continue;
            }
            typeId = tipo.id;
          }
          const kind = kindDoRotulo(row.type ?? "", row.kind ?? "");

          /* A equipa. Um treino e um jogo têm sempre uma; os outros podem ser da casa. */
          let teamId: string | null = null;
          let teamName: string | null = null;
          if (row.team?.trim()) {
            const equipa = equipaPorNome.get(chave(row.team));
            if (!equipa) {
              falha(`Equipa desconhecida: "${row.team.trim()}"`);
              continue;
            }
            if (scope && !scope.in.includes(equipa.id)) {
              falha(`A equipa "${equipa.name}" está fora do teu âmbito`);
              continue;
            }
            teamId = equipa.id;
            teamName = equipa.name ?? null;
          } else if (scope) {
            falha("Só a direção marca eventos de toda a academia");
            continue;
          }

          if ((kind === "TRAINING" || kind === "MATCH") && !teamId) {
            falha(kind === "TRAINING" ? "Um treino é sempre de uma equipa" : "Um jogo é sempre de uma equipa");
            continue;
          }

          /* O jogo: adversário e prova, e a prova tem de ser das que a equipa disputa. */
          let competitionId: string | null = null;
          if (kind === "MATCH") {
            if (!row.opponent?.trim()) {
              falha("Um jogo precisa de adversário");
              continue;
            }
            if (!row.competition?.trim()) {
              falha("Um jogo precisa de competição (usa \"Amigável\" se não for de nenhuma prova)");
              continue;
            }
            const prova = provaPorNome.get(chave(row.competition));
            if (!prova) {
              falha(`Competição desconhecida: "${row.competition.trim()}"`);
              continue;
            }
            if (!disputa.has(`${teamId}|${prova.id}`)) {
              falha(`${teamName} não disputa "${prova.label}"`);
              continue;
            }
            competitionId = prova.id;
          }

          /* Os dias: um, ou a série toda. */
          const dias = diasDaSerie(primeiro, {
            until: row.repeatUntil,
            freq: row.freq,
            weekdays: row.weekdays,
          });
          if ("error" in dias) {
            falha(dias.error);
            continue;
          }
          if (total + dias.length > MAX_TOTAL) {
            falha(`O ficheiro passa dos ${MAX_TOTAL} eventos — divide-o em dois`);
            continue;
          }
          total += dias.length;

          resolvidas.push({
            origem: row,
            kind,
            teamId,
            teamName,
            title: row.title?.trim() || tituloPorOmissao(kind, tipoPorNome.get(chave(row.type ?? ""))?.label, teamName, row.opponent),
            venue: row.venue.trim(),
            dressingRooms: [...new Set((row.dressingRooms ?? []).map((d) => d.trim()).filter(Boolean))],
            typeId,
            opponent: row.opponent?.trim() || null,
            isHome: row.isHome !== false,
            competitionId,
            respondBy: row.respondBy === "ATHLETE" ? "ATHLETE" : "GUARDIAN",
            dias,
            hora: inicio,
            fim,
          });
        }

        if (resolvidas.length === 0) {
          return { total: 0, criados: 0, ensaio, porTipo: { treinos: 0, jogos: 0, outros: 0 }, erros, conflitos };
        }

        /*
         * O que já está marcado, na janela do ficheiro e numa leitura só.
         *
         * Cancelados ficam de fora: um treino desmarcado liberta o balneário e o
         * horário, como no caminho normal.
         */
        const instantes = resolvidas.flatMap((r) =>
          r.dias.map((d) => instanteNoFuso(d.ano, d.mes, d.dia, r.hora.hora, r.hora.minuto).getTime()),
        );
        const janela = {
          de: new Date(Math.min(...instantes) - 12 * 3_600_000),
          ate: new Date(Math.max(...instantes) + 24 * 3_600_000),
        };
        const where = { startsAt: { gte: janela.de, lte: janela.ate } };
        const [treinos, jogos, outros] = await Promise.all([
          db.trainingSession.findMany({
            where: { ...where, status: { not: "CANCELLED" } },
            select: { teamId: true, startsAt: true, endsAt: true, dressingRooms: true, team: { select: { name: true } } },
          }),
          db.match.findMany({
            where: { ...where, status: { not: "CANCELLED" } },
            select: { teamId: true, startsAt: true, endsAt: true, dressingRooms: true, team: { select: { name: true } } },
          }),
          db.calendarEvent.findMany({
            where: { ...where, cancelled: false },
            select: { teamId: true, startsAt: true, endsAt: true, dressingRooms: true, title: true },
          }),
        ]);

        /*
         * A decisão fica numa função pura, fora daqui: é a parte que se engana
         * sozinha em silêncio — um intervalo comparado ao contrário, um
         * balneário que o próprio ficheiro pisa duas vezes — e é a única que
         * se pode exercitar sem base de dados. Ver `planearOcorrencias`.
         */
        const jaMarcados: JaMarcado[] = [
          ...treinos.map((e) => ({
            equipaId: e.teamId,
            balnearios: e.dressingRooms,
            de: e.startsAt.getTime(),
            ate: e.endsAt.getTime(),
            quem: `treino do ${e.team.name}`,
          })),
          ...jogos.map((e) => ({
            equipaId: e.teamId,
            balnearios: e.dressingRooms,
            de: e.startsAt.getTime(),
            ate: e.endsAt.getTime(),
            quem: `jogo do ${e.team.name}`,
          })),
          ...outros.map((e) => ({
            equipaId: e.teamId,
            balnearios: e.dressingRooms,
            de: e.startsAt.getTime(),
            ate: e.endsAt.getTime(),
            quem: e.title,
          })),
        ];

        /* Cada dia de cada linha é um candidato, já com as horas do relógio do clube. */
        const candidatos: Candidato[] = [];
        const daOcorrencia: { r: Resolvida; startsAt: Date; endsAt: Date; quando: string }[] = [];
        for (const r of resolvidas) {
          for (const d of r.dias) {
            const startsAt = instanteNoFuso(d.ano, d.mes, d.dia, r.hora.hora, r.hora.minuto);
            /*
             * O fim conta-se sobre o **mesmo dia de calendário**, e por isso um
             * evento que passa da meia-noite não existe aqui: "18:00 às 02:00"
             * já foi recusado como fim antes do início.
             */
            const endsAt = instanteNoFuso(d.ano, d.mes, d.dia, r.fim.hora, r.fim.minuto);
            candidatos.push({
              ref: candidatos.length,
              equipa: r.teamId ? { id: r.teamId, nome: r.teamName ?? "A equipa" } : null,
              balnearios: r.dressingRooms,
              de: startsAt.getTime(),
              ate: endsAt.getTime(),
              rotulo: `${r.title} (deste ficheiro)`,
            });
            daOcorrencia.push({
              r,
              startsAt,
              endsAt,
              quando: `${d.dia.toString().padStart(2, "0")}/${d.mes.toString().padStart(2, "0")} às ${hhmm(r.hora)}`,
            });
          }
        }

        const plano = planearOcorrencias(candidatos, jaMarcados);
        for (const c of plano.conflitos) {
          const o = daOcorrencia[c.ref];
          conflitos.push({ linha: o.r.origem.linha, folha: o.r.origem.folha, quando: o.quando, motivo: c.motivo });
        }
        const aCriar = plano.aceites.map((ref) => daOcorrencia[ref]);

        const porTipo = {
          treinos: aCriar.filter((x) => x.r.kind === "TRAINING").length,
          jogos: aCriar.filter((x) => x.r.kind === "MATCH").length,
          outros: aCriar.filter((x) => x.r.kind !== "TRAINING" && x.r.kind !== "MATCH").length,
        };

        if (ensaio) return { total, criados: 0, ensaio, porTipo, erros, conflitos };

        /*
         * Três escritas, e não uma por evento: cada tipo vive na sua tabela e
         * `createMany` mete lá tudo de uma vez. É o que faz um calendário de
         * época caber numa transacção.
         */
        const treinosNovos = aCriar.filter((x) => x.r.kind === "TRAINING");
        const jogosNovos = aCriar.filter((x) => x.r.kind === "MATCH");
        const outrosNovos = aCriar.filter((x) => x.r.kind !== "TRAINING" && x.r.kind !== "MATCH");

        if (treinosNovos.length) {
          await db.trainingSession.createMany({
            data: treinosNovos.map(({ r, startsAt, endsAt }) => ({
              academyId: ctx.academyId,
              teamId: r.teamId!,
              startsAt,
              endsAt,
              venue: r.venue,
              /* Os dois enquanto durar a travessia — ver a migração `20260908120000`. */
              dressingRoom: r.dressingRooms[0] ?? null,
              dressingRooms: r.dressingRooms,
              respondBy: r.respondBy,
            })),
          });
        }

        if (jogosNovos.length) {
          await db.match.createMany({
            data: jogosNovos.map(({ r, startsAt, endsAt }) => ({
              academyId: ctx.academyId,
              teamId: r.teamId!,
              startsAt,
              endsAt,
              venue: r.venue,
              dressingRooms: r.dressingRooms,
              opponent: r.opponent!,
              isHome: r.isHome,
              competitionId: r.competitionId,
            })),
            /*
             * O índice único `(teamId, startsAt)` dos jogos activos é a última
             * rede: a verificação em memória já apanhou o que estava na base e o
             * que veio no ficheiro, e isto cobre o que outra pessoa marcou entre
             * a leitura e a escrita. Saltar é melhor do que derrubar o lote.
             */
            skipDuplicates: true,
          });
        }

        if (outrosNovos.length) {
          await db.calendarEvent.createMany({
            data: outrosNovos.map(({ r, startsAt, endsAt }) => ({
              academyId: ctx.academyId,
              kind: r.kind,
              title: r.title,
              startsAt,
              endsAt,
              venue: r.venue,
              dressingRoom: r.dressingRooms[0] ?? null,
              dressingRooms: r.dressingRooms,
              typeId: r.typeId,
              ...(r.teamId ? { teamId: r.teamId } : {}),
              updatedAt: new Date(),
            })),
          });
        }

        return { total, criados: aCriar.length, ensaio, porTipo, erros, conflitos };
      },
      { timeoutMs: tectoMs },
    );
  }

  /**
   * O calendário de um período, com as colunas da importação.
   *
   * Pelo servidor e não pelo que a consola tem em memória: a consola só traz a
   * janela que está a mostrar, e não traz os balneários de um jogo nem quem
   * avisa as faltas de um treino. Uma exportação a que faltassem esses campos
   * voltava a entrar sem eles, e o ida-e-volta — exportar, corrigir na folha,
   * importar — é a razão de ela existir.
   *
   * As horas saem no relógio do clube (`partesNoFuso`), que é o que a
   * importação lê: um treino das 18:30 sai "18:30" em Março e em Novembro.
   */
  async exportar(
    ctx: RequestContext,
    opcoes: {
      from: Date;
      to: Date;
      /** As equipas escolhidas. Vazio ou ausente é todas. */
      teamIds?: string[];
      /**
       * Com equipas escolhidas, trazer também os eventos de toda a academia
       * (uma reunião de pais, o torneio do clube). Sem equipas escolhidas vêm
       * sempre, porque aí é o calendário inteiro.
       */
      incluirDaAcademia?: boolean;
      /**
       * Os tipos escolhidos, pelo nome do catálogo do clube ("Treino", "Jogo",
       * "Estágio"). Vazio ou ausente é todos.
       */
      tipos?: string[];
      incluirCancelados?: boolean;
    },
  ): Promise<CalendarioExportado> {
    if (!can(ctx, "calendar:read")) throw new ForbiddenException("Sem acesso ao calendário");
    const { from, to } = opcoes;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
      throw new BadRequestException("Período inválido");
    }
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_DIAS_EXPORTADOS) {
      throw new BadRequestException("Escolhe um período até um ano");
    }

    /* O mesmo âmbito da leitura do calendário: o clube todo para o staff, o escalão para a família. */
    const scope = calendarScopeFilter(ctx);
    const escolhidas = [...new Set((opcoes.teamIds ?? []).filter(Boolean))];
    if (scope && escolhidas.some((id) => !scope.in.includes(id))) {
      throw new ForbiddenException("Há uma equipa fora do teu âmbito");
    }
    const equipas = escolhidas.length ? { in: escolhidas } : scope;
    const daEquipa = equipas ? { teamId: equipas } : {};
    const janela = { startsAt: { gte: from, lte: to } };
    const cancelados = opcoes.incluirCancelados === true;

    /*
     * Os tipos, pelo nome. Treino e Jogo decidem se essas tabelas entram; os
     * outros filtram os eventos genéricos pelo nome que o clube lhes deu.
     */
    const tipos = new Set((opcoes.tipos ?? []).map((t) => chave(t)).filter(Boolean));
    const querTodos = tipos.size === 0;
    const querTreinos = querTodos || tipos.has("treino");
    const querJogos = querTodos || tipos.has("jogo");
    /* Os eventos da academia: sempre sem filtro de equipa, e por pedido com ele. */
    const daAcademia = escolhidas.length === 0 || opcoes.incluirDaAcademia === true;

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const [treinos, jogos, todosOsOutros] = await Promise.all([
        !querTreinos ? [] : db.trainingSession.findMany({
          where: { ...janela, ...daEquipa, ...(cancelados ? {} : { status: { not: "CANCELLED" } }) },
          orderBy: { startsAt: "asc" },
          select: {
            startsAt: true, endsAt: true, venue: true, dressingRoom: true, dressingRooms: true,
            status: true, respondBy: true, team: { select: { name: true } },
          },
        }),
        !querJogos ? [] : db.match.findMany({
          where: { ...janela, ...daEquipa, ...(cancelados ? {} : { status: { not: "CANCELLED" } }) },
          orderBy: { startsAt: "asc" },
          select: {
            startsAt: true, endsAt: true, venue: true, dressingRooms: true, status: true,
            opponent: true, isHome: true, competition: { select: { label: true } }, team: { select: { name: true } },
          },
        }),
        db.calendarEvent.findMany({
          where: {
            ...janela,
            ...(equipas
              ? { OR: [{ teamId: equipas }, ...(daAcademia ? [{ teamId: null }] : [])] }
              : {}),
            ...(cancelados ? {} : { cancelled: false }),
          },
          orderBy: { startsAt: "asc" },
          select: {
            startsAt: true, endsAt: true, venue: true, dressingRoom: true, dressingRooms: true, cancelled: true,
            kind: true, title: true, type: { select: { label: true } }, team: { select: { name: true } },
          },
        }),
      ]);

      const base = (e: { startsAt: Date; endsAt: Date; venue: string }, salas: string[], equipa: string | null, cancelado: boolean) => {
        const i = partesNoFuso(e.startsAt);
        const f = partesNoFuso(e.endsAt);
        return {
          team: equipa,
          date: `${i.ano}-${String(i.mes).padStart(2, "0")}-${String(i.dia).padStart(2, "0")}`,
          start: hhmm(i),
          end: hhmm(f),
          venue: e.venue,
          dressingRooms: salas,
          cancelled: cancelado,
        };
      };
      /* Os balneários de antes da lista viviam no singular — ver a migração `20260908120000`. */
      const salas = (lista: string[], um?: string | null) => (lista.length ? lista : um ? [um] : []);

      /* O nome do tipo, e quando não o há, o que o `kind` quer dizer — é isso que a importação lê. */
      const TIPO: Record<string, string> = { TRAINING: "Treino", MATCH: "Jogo", TOURNAMENT: "Torneio", OTHER: "Evento" };
      const outros = querTodos
        ? todosOsOutros
        : todosOsOutros.filter((e) => tipos.has(chave(e.type?.label ?? TIPO[e.kind] ?? "Evento")));

      return {
        treinos: treinos.map((t) => ({
          ...base(t, salas(t.dressingRooms, t.dressingRoom), t.team.name, t.status === "CANCELLED"),
          respondBy: t.respondBy,
        })),
        jogos: jogos.map((m) => ({
          ...base(m, m.dressingRooms, m.team.name, m.status === "CANCELLED"),
          opponent: m.opponent,
          isHome: m.isHome,
          competition: m.competition?.label ?? null,
        })),
        outros: outros.map((e) => ({
          ...base(e, salas(e.dressingRooms, e.dressingRoom), e.team?.name ?? null, e.cancelled),
          type: e.type?.label ?? TIPO[e.kind] ?? "Evento",
          title: e.title,
        })),
      };
    });
  }

}

/* -------------------------------------------------------------------------- */

import { randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { inferSportCode } from "../academy/academy.service";
import {
  DOC_MAX_BYTES,
  DOC_MAX_FICHEIROS,
  DOC_TIPOS,
  DOCUMENT_BUCKET,
  chaveDoAtleta,
  ficheirosDe,
  nomeDoFicheiro,
  pastaDoAtleta,
  tipoDaChave,
  type FicheiroDoDocumento,
} from "../academy/ficha-do-atleta";
import { normalizarLicenca } from "../academy/licencas";
import { nomeDeQuemMexe } from "../common/historico";
import { can, teamScopeFilter, type RequestContext } from "../common/permissions";
import { currentSeason } from "../common/seasons";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { EspacoService } from "../storage/espaco.service";
import { StorageService } from "../storage/storage.service";
import { gerarFolhas } from "./folhas-pdf";
import {
  ESTADOS,
  categoriaPelaIdade,
  eCategoria,
  eEstado,
  eTipo,
  emFalta,
  emFaltaNoClube,
  federacaoDe,
  montarFolha,
  nomeDaCategoria,
  tipoProposto,
  tiposDa,
  type Disciplina,
  type Estado,
  type Folha,
  type Tipo,
} from "./regras";

/** Quantas folhas um pedido gera de uma vez. Um clube grande tem ~300 atletas de futebol. */
const MAX_POR_LOTE = 400;

/**
 * O prefixo das folhas geradas nos documentos do atleta. As assinadas têm
 * outro. "Modelo 2" ficou no nome também para as do basquetebol (que são o
 * Modelo 1 da FPB): é o que distingue a folha gerada nos documentos que já
 * existem, e mudá-lo deixava de as reconhecer.
 */
const PREFIXO_GERADA = "Modelo 2 (gerado)";
const PREFIXO_ASSINADA = "Modelo 2 (assinado)";

/** A modalidade e o clube na federação dela. */
const MODALIDADE = {
  id: true, name: true, code: true,
  federationClubCode: true, insuranceKind: true, insurancePolicy: true, insuranceCompany: true,
} as const;
type Modalidade = {
  id: string; name: string; code: string | null;
  federationClubCode: string | null;
  insuranceKind: string | null; insurancePolicy: string | null; insuranceCompany: string | null;
};

/** O clube: o nome e a associação distrital, que é a mesma em todas as modalidades. */
type ClubeLido = { name: string; association: string | null };

type Epoca = { id: string; label: string; startsOn: Date; endsOn: Date };

const disciplinaDe = (s: { code: string | null; name: string }): Disciplina | null => {
  const code = s.code ?? inferSportCode(s.name);
  return code === "football" || code === "futsal" || code === "basketball" ? code : null;
};

/** O que a folha precisa de cada atleta, numa ida à base. */
async function atletasDaFolha(db: ScopedClient, ids: string[]) {
  const rows = await db.athlete.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, name: true, birthdate: true, sex: true, email: true, phone: true,
      citizenCardNumber: true, idDocLabel: true, idDocNumber: true, birthCountry: true, nationality: true,
      // O que só o boletim da FPB pede.
      taxId: true, idDocValidUntil: true, address: true, postalCode: true, city: true, district: true, municipality: true,
      licenses: { select: { sportId: true, seasonId: true, number: true, season: { select: { startsOn: true } } } },
      guardians: { select: { membership: { select: { user: { select: { email: true, phone: true } } } } } },
    },
  });
  return new Map(rows.map((a) => [a.id, a]));
}

type AtletaLido = Awaited<ReturnType<typeof atletasDaFolha>> extends Map<string, infer V> ? V : never;

/**
 * Inscrições federativas: Modelo 2 da FPF (futebol e futsal) e Modelo 1 da
 * FPB (basquetebol).
 *
 * ## O que faz
 *
 * Lista quem joga futebol, futsal ou basquetebol numa época, uma linha por
 * atleta e modalidade (quem joga duas aparece duas vezes), com o que a folha levaria e o
 * que falta na ficha; gera as folhas (uma ou cem num PDF só); e segue cada
 * inscrição pelos passos que acontecem fora da plataforma: assinada pelos
 * pais, entregue à associação, validada.
 *
 * ## O que não faz
 *
 * Não fala com a FPF. A folha é para imprimir, assinar e entregar; a
 * plataforma só se lembra de em que passo vai cada uma.
 *
 * ## Âmbito
 *
 * Quem tem equipas atribuídas vê os atletas delas; a direção e a coordenação
 * veem o clube inteiro (`teamScopeFilter`).
 */
@Injectable()
export class InscricoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly espaco: EspacoService,
  ) {}

  private mustRead(ctx: RequestContext) {
    if (!can(ctx, "registration:read")) throw new ForbiddenException("Sem acesso às inscrições");
  }

  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "registration:write")) throw new ForbiddenException("Sem permissão para tratar inscrições");
  }

  /* ---------------------------------------------------------------------- */
  /* Leitura                                                                 */
  /* ---------------------------------------------------------------------- */

  async lista(ctx: RequestContext, seasonId?: string) {
    this.mustRead(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const epocas = await db.season.findMany({
        orderBy: { startsOn: "desc" },
        select: { id: true, label: true, startsOn: true, endsOn: true },
      });
      const epoca = (seasonId ? epocas.find((e) => e.id === seasonId) : null) ?? (await currentSeason(db));
      const modalidades = (await db.sport.findMany({ select: MODALIDADE }))
        .map((s) => ({ ...s, disciplina: disciplinaDe(s) }))
        .filter((s): s is typeof s & { disciplina: Disciplina } => s.disciplina !== null);

      const clube = await this.clube(db, ctx);
      const base = {
        canWrite: can(ctx, "registration:write"),
        seasons: epocas.map((e) => ({ id: e.id, label: e.label })),
        /* O que falta ao clube em todas as modalidades: a associação, nas Definições → Geral. */
        club: { association: clube.association, missing: clube.association ? [] : ["associação"] },
        /* Cada modalidade com a sua federação, e o que falta ao clube nela. */
        sports: modalidades.map((s) => {
          const federacao = federacaoDe(s.disciplina);
          const missing = emFaltaNoClube({ ...s, name: clube.name, association: clube.association }, federacao)
            // A associação é do clube e diz-se uma vez, em `club.missing`, e não em cada modalidade.
            .filter((m) => !m.startsWith("associação"));
          return { id: s.id, name: s.name, discipline: s.disciplina, federation: federacao, missing };
        }),
      };
      if (modalidades.length === 0) {
        return {
          ...base,
          available: false as const,
          reason: "As inscrições são para clubes com futebol, futsal ou basquetebol.",
          season: null,
          rows: [],
        };
      }
      if (!epoca) {
        return { ...base, available: false as const, reason: "Ainda não há uma época criada.", season: null, rows: [] };
      }

      const linhas = await this.linhas(db, ctx, epoca, modalidades.map((m) => m.id));
      return {
        ...base,
        available: true as const,
        season: { id: epoca.id, label: epoca.label },
        rows: linhas.map(({ folha, ...l }) => ({
          ...l,
          federation: folha.federacao,
          category: folha.categoria,
          categoryLabel: nomeDaCategoria(folha.categoria, folha.federacao),
          kind: folha.tipo,
          license: folha.licenca,
          missing: emFalta(folha),
        })),
      };
    }, { timeoutMs: 20_000 });
  }

  /**
   * Uma linha por atleta e modalidade: quem está numa equipa de futebol ou
   * futsal da época, e quem já tem inscrição nela (mesmo que tenha saído da
   * equipa entretanto — a folha foi entregue e conta).
   */
  private async linhas(db: ScopedClient, ctx: RequestContext, epoca: Epoca, sportIds: string[]) {
    const equipas = teamScopeFilter(ctx);
    const [passagens, inscricoes] = await Promise.all([
      db.teamMembership.findMany({
        where: {
          leftAt: null,
          athlete: { status: { not: "LEFT" } },
          team: { seasonId: epoca.id, sportId: { in: sportIds }, ...(equipas ? { id: equipas } : {}) },
        },
        select: { athleteId: true, team: { select: { id: true, name: true, sportId: true, gender: true, maxAge: true } } },
      }),
      db.playerRegistration.findMany({
        where: {
          seasonId: epoca.id,
          sportId: { in: sportIds },
          ...(equipas ? { athlete: { teams: { some: { teamId: equipas } } } } : {}),
        },
      }),
    ]);

    // Atleta + modalidade → as equipas dele nessa modalidade.
    const chave = (athleteId: string, sportId: string) => `${athleteId}|${sportId}`;
    const porLinha = new Map<string, { athleteId: string; sportId: string; teams: { id: string; name: string; gender: string | null; maxAge: number }[] }>();
    for (const p of passagens) {
      const k = chave(p.athleteId, p.team.sportId);
      const l = porLinha.get(k) ?? { athleteId: p.athleteId, sportId: p.team.sportId, teams: [] };
      l.teams.push({ id: p.team.id, name: p.team.name, gender: p.team.gender, maxAge: p.team.maxAge });
      porLinha.set(k, l);
    }
    const inscricaoDe = new Map(inscricoes.map((r) => [chave(r.athleteId, r.sportId), r]));
    for (const r of inscricoes) {
      const k = chave(r.athleteId, r.sportId);
      if (!porLinha.has(k)) porLinha.set(k, { athleteId: r.athleteId, sportId: r.sportId, teams: [] });
    }
    if (porLinha.size === 0) return [];

    const athleteIds = [...new Set([...porLinha.values()].map((l) => l.athleteId))];
    const atletas = await atletasDaFolha(db, athleteIds);
    const modalidades = new Map(
      (await db.sport.findMany({ where: { id: { in: sportIds } }, select: MODALIDADE })).map((s) => [s.id, s]),
    );
    const clube = await this.clube(db, ctx);

    const out = [];
    for (const l of porLinha.values()) {
      const a = atletas.get(l.athleteId);
      const sport = modalidades.get(l.sportId);
      if (!a || !sport) continue;
      const r = inscricaoDe.get(chave(l.athleteId, l.sportId)) ?? null;
      const folha = this.folhaDe(a, clube, epoca, sport, l.teams, r ? { tipo: r.kind as Tipo, categoria: r.category } : {});
      out.push({
        athleteId: a.id,
        name: a.name,
        birthdate: a.birthdate,
        sportId: l.sportId,
        teams: l.teams.sort((x, y) => x.maxAge - y.maxAge).map((t) => ({ id: t.id, name: t.name })),
        folha,
        registration: r && {
          id: r.id,
          status: r.status,
          kind: r.kind,
          category: r.category,
          generatedAt: r.generatedAt,
          generatedByName: r.generatedByName,
          signedAt: r.signedAt,
          submittedAt: r.submittedAt,
          doneAt: r.doneAt,
          documentId: r.documentId,
        },
      });
    }
    return out.sort((x, y) => x.name.localeCompare(y.name, "pt"));
  }

  private async clube(db: ScopedClient, ctx: RequestContext): Promise<ClubeLido> {
    const c = await db.academy.findFirst({ where: { id: ctx.academyId }, select: { name: true, association: true } });
    if (!c) throw new NotFoundException("Clube não encontrado");
    return c;
  }

  private folhaDe(
    a: AtletaLido,
    clube: ClubeLido,
    epoca: Epoca,
    sport: Modalidade,
    equipas: { gender: string | null }[],
    escolha: { tipo?: Tipo; categoria?: string },
  ): Folha {
    const disciplina = disciplinaDe(sport) ?? "football";
    const federacao = federacaoDe(disciplina);
    // A licença desta época; senão a mais recente, que é o número que a revalidação leva.
    const daModalidade = a.licenses
      .filter((l) => l.sportId === sport.id)
      .sort((x, y) => y.season.startsOn.getTime() - x.season.startsOn.getTime());
    const licenca = daModalidade.find((l) => l.seasonId === epoca.id) ?? daModalidade[0] ?? null;
    const anterior = daModalidade.some((l) => l.season.startsOn < epoca.startsOn);

    const generos = new Set(equipas.map((t) => t.gender));
    const generoDaEquipa = generos.size === 1 && (generos.has("MALE") || generos.has("FEMALE")) ? ([...generos][0] as "MALE" | "FEMALE") : null;
    const contacto = a.guardians.map((g) => g.membership.user).find((u) => u.email || u.phone);

    return montarFolha({
      atleta: a,
      // O nome e a associação são do clube; o código e o seguro, desta modalidade.
      clube: { ...sport, name: clube.name, association: clube.association },
      epoca,
      disciplina,
      generoDaEquipa,
      tipo: escolha.tipo ?? tipoProposto(anterior),
      categoria: escolha.categoria ?? categoriaPelaIdade(a.birthdate, epoca, federacao),
      licenca: licenca?.number ?? null,
      contactoDoEncarregado: contacto ? { email: contacto.email, phone: contacto.phone ?? null } : undefined,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Gerar                                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Gera as folhas pedidas, num PDF só.
   *
   * Com `register` (o normal), cada inscrição fica "gerada" — e uma que já ia
   * mais à frente volta a esse passo, porque a folha nova tem de ser assinada
   * outra vez. Sem `register` é só para ver, e nada muda.
   *
   * Com `attach`, cada folha vai também para os documentos do atleta, num
   * documento por inscrição; gerar outra vez troca a folha gerada e deixa a
   * cópia assinada que lá estiver.
   */
  async gerar(
    ctx: RequestContext,
    dto: { seasonId: string; items: { athleteId: string; sportId: string; kind?: string; category?: string }[]; attach?: boolean; register?: boolean },
  ) {
    this.mustRead(ctx);
    const registar = dto.register !== false;
    if (registar || dto.attach) this.mustWrite(ctx);
    if (!Array.isArray(dto.items) || dto.items.length === 0) throw new BadRequestException("Escolhe pelo menos um atleta");
    if (dto.items.length > MAX_POR_LOTE) throw new BadRequestException(`No máximo ${MAX_POR_LOTE} folhas de cada vez`);
    // A forma aqui; o que cada federação aceita, mais abaixo, com a modalidade de cada um.
    for (const i of dto.items) {
      if (i.kind !== undefined && !eTipo(i.kind)) throw new BadRequestException("Tipo de boletim inválido");
    }

    // A leitura e as decisões, numa transação; o PDF e o armazenamento, fora.
    const preparado = await this.prisma.runAs(ctx.academyId, async (db) => {
      const epoca = await db.season.findFirst({
        where: { id: dto.seasonId },
        select: { id: true, label: true, startsOn: true, endsOn: true },
      });
      if (!epoca) throw new NotFoundException("Época não encontrada");

      const sportIds = (await db.sport.findMany({ select: { id: true, name: true, code: true } }))
        .filter((s) => disciplinaDe(s))
        .map((s) => s.id);
      const linhas = await this.linhas(db, ctx, epoca, sportIds);
      const porChave = new Map(linhas.map((l) => [`${l.athleteId}|${l.sportId}`, l]));

      const atletas = await atletasDaFolha(db, [...new Set(dto.items.map((i) => i.athleteId))]);
      const clube = await this.clube(db, ctx);
      const modalidades = new Map(
        (await db.sport.findMany({ where: { id: { in: sportIds } }, select: MODALIDADE })).map((s) => [s.id, s]),
      );

      const vistos = new Set<string>();
      const itens = [];
      for (const i of dto.items) {
        const k = `${i.athleteId}|${i.sportId}`;
        if (vistos.has(k)) continue;
        vistos.add(k);
        const linha = porChave.get(k);
        const a = atletas.get(i.athleteId);
        const sport = modalidades.get(i.sportId);
        // Só quem aparece na lista desta pessoa: o âmbito vale para gerar como para ler.
        if (!linha || !a || !sport) throw new NotFoundException("Atleta fora da lista de inscrições");
        const federacao = linha.folha.federacao;
        // O boletim da FPB não tem transferências; e cada federação tem os seus escalões.
        if (i.kind !== undefined && !tiposDa(federacao).includes(i.kind as Tipo)) {
          throw new BadRequestException(`O boletim da ${federacao} não tem esse tipo de inscrição (${a.name})`);
        }
        if (i.category !== undefined && !eCategoria(i.category, federacao)) throw new BadRequestException("Categoria inválida");
        const folha = this.folhaDe(a, clube, epoca, sport, [], {
          tipo: (i.kind as Tipo | undefined) ?? linha.folha.tipo,
          categoria: i.category ?? linha.folha.categoria,
        });
        // O género da equipa já foi decidido na linha; não se perde por gerar.
        folha.genero = linha.folha.genero;
        itens.push({ athleteId: a.id, sportId: sport.id, sportName: sport.name, folha, registration: linha.registration });
      }
      return { epoca, itens, quem: registar ? await nomeDeQuemMexe(db, ctx) : null };
    }, { timeoutMs: 20_000 });

    const pdf = await gerarFolhas(preparado.itens.map((i) => i.folha));

    if (registar) {
      const agora = new Date();
      // Os documentos primeiro: a inscrição grava já com o documento a que ficou ligada.
      const documentos = new Map<string, string>();
      if (dto.attach) {
        await this.espaco.garantirEspaco(ctx.academyId, pdf.length);
        await this.garantirBucket();
        for (const i of preparado.itens) {
          const id = await this.anexarGerada(ctx, i, preparado.epoca.label, preparado.quem);
          documentos.set(`${i.athleteId}|${i.sportId}`, id);
        }
      }

      await this.prisma.runAs(ctx.academyId, async (db) => {
        for (const i of preparado.itens) {
          const documentId = documentos.get(`${i.athleteId}|${i.sportId}`);
          const dados = {
            kind: i.folha.tipo,
            category: i.folha.categoria,
            status: "GENERATED",
            generatedAt: agora,
            generatedByName: preparado.quem,
            signedAt: null,
            submittedAt: null,
            doneAt: null,
            ...(documentId ? { documentId } : {}),
          };
          await db.playerRegistration.upsert({
            where: { athleteId_sportId_seasonId: { athleteId: i.athleteId, sportId: i.sportId, seasonId: preparado.epoca.id } },
            create: { academyId: ctx.academyId, athleteId: i.athleteId, sportId: i.sportId, seasonId: preparado.epoca.id, ...dados },
            update: dados,
          });
        }
      }, { timeoutMs: 20_000 });
    }

    const um = preparado.itens.length === 1 ? preparado.itens[0].folha.nome : null;
    return {
      filename: `Modelo 2 - ${um ?? `${preparado.itens.length} jogadores`} - ${preparado.epoca.label.replace("/", "-")}.pdf`,
      pdf: Buffer.from(pdf).toString("base64"),
      count: preparado.itens.length,
    };
  }

  /**
   * A folha de um atleta nos documentos dele.
   *
   * Um documento por inscrição. Gerar outra vez troca a folha gerada que lá
   * estava (a antiga apaga-se do armazenamento) e deixa as cópias assinadas.
   */
  private async anexarGerada(
    ctx: RequestContext,
    i: { athleteId: string; sportName: string; folha: Folha; registration: { documentId: string | null } | null },
    epocaLabel: string,
    quem: string | null,
  ): Promise<string> {
    const bytes = Buffer.from(await gerarFolhas([i.folha]));
    const key = `${pastaDoAtleta(ctx.academyId, i.athleteId)}/${randomBytes(8).toString("hex")}.pdf`;
    await this.storage.upload(DOCUMENT_BUCKET, key, bytes, "application/pdf");
    const ficheiro: FicheiroDoDocumento = { key, name: `${PREFIXO_GERADA} ${i.folha.nome}.pdf`, type: tipoDaChave(key) };

    const { id, removidos } = await this.prisma.runAs(ctx.academyId, async (db) => {
      const existente = i.registration?.documentId
        ? await db.athleteDocument.findFirst({ where: { id: i.registration.documentId, athleteId: i.athleteId }, select: { id: true, files: true } })
        : null;
      if (existente) {
        const antes = ficheirosDe(existente.files);
        const removidos = antes.filter((f) => f.name.startsWith(PREFIXO_GERADA));
        const ficam = antes.filter((f) => !f.name.startsWith(PREFIXO_GERADA));
        await db.athleteDocument.update({ where: { id: existente.id }, data: { files: [ficheiro, ...ficam].slice(0, DOC_MAX_FICHEIROS) } });
        return { id: existente.id, removidos };
      }
      const doc = await db.athleteDocument.create({
        data: {
          academyId: ctx.academyId,
          athleteId: i.athleteId,
          name: `Inscrição FPF ${epocaLabel} · ${i.sportName}`,
          files: [ficheiro],
          createdByName: quem,
        },
        select: { id: true },
      });
      return { id: doc.id, removidos: [] as FicheiroDoDocumento[] };
    });

    for (const f of removidos) await this.storage.remove(DOCUMENT_BUCKET, f.key);
    return id;
  }

  private garantirBucket() {
    return this.storage.ensureBucket({
      name: DOCUMENT_BUCKET,
      fileSizeLimit: DOC_MAX_BYTES,
      allowedMimeTypes: Object.keys(DOC_TIPOS),
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Os passos                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Põe uma ou mais inscrições num passo qualquer, por atleta e modalidade.
   *
   * Qualquer passo, a partir de qualquer passo, e não só o seguinte: há
   * clubes que trataram as folhas em papel antes de a plataforma existir, e
   * quem entregou vinte boletins na associação marca-os de uma vez, sem os
   * gerar aqui primeiro. Um jogador ainda "por gerar" que vá direto para um
   * passo à frente ganha a inscrição nesse passo, com o tipo de boletim e a
   * categoria propostos.
   *
   * "Por gerar" (`PENDING`) retira a inscrição. Os documentos ficam.
   *
   * Andar para a frente marca a data dos passos que ainda não a tinham (quem
   * marca "entregue" está a dizer que também foi assinada). Voltar atrás
   * limpa as datas dos passos de cima: o que lá estava deixou de ser verdade.
   *
   * Validar pode trazer o n.º de licença, que se grava na ficha (modalidade e
   * época da inscrição). Só para uma inscrição de cada vez.
   */
  async mudarEstado(
    ctx: RequestContext,
    dto: { seasonId: string; items: { athleteId: string; sportId: string }[]; status: string; license?: string },
  ) {
    this.mustWrite(ctx);
    if (dto.status !== "PENDING" && !eEstado(dto.status)) throw new BadRequestException("Estado inválido");
    if (!Array.isArray(dto.items) || dto.items.length === 0) throw new BadRequestException("Nenhum jogador escolhido");
    if (dto.items.length > MAX_POR_LOTE) throw new BadRequestException(`No máximo ${MAX_POR_LOTE} de cada vez`);
    const licenca = normalizarLicenca(dto.license);
    if (licenca && dto.items.length > 1) throw new BadRequestException("A licença escreve-se uma inscrição de cada vez");
    if (licenca && dto.status !== "DONE") throw new BadRequestException("A licença só se escreve ao validar");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const epoca = await db.season.findFirst({
        where: { id: dto.seasonId },
        select: { id: true, label: true, startsOn: true, endsOn: true },
      });
      if (!epoca) throw new NotFoundException("Época não encontrada");
      const sportIds = (await db.sport.findMany({ select: { id: true, name: true, code: true } }))
        .filter((s) => disciplinaDe(s))
        .map((s) => s.id);
      // A lista desta pessoa: o âmbito vale para mudar como para ler.
      const porChave = new Map((await this.linhas(db, ctx, epoca, sportIds)).map((l) => [`${l.athleteId}|${l.sportId}`, l]));
      const alvos = [...new Map(dto.items.map((i) => [`${i.athleteId}|${i.sportId}`, i])).keys()].map((k) => {
        const l = porChave.get(k);
        if (!l) throw new NotFoundException("Atleta fora da lista de inscrições");
        return l;
      });

      if (dto.status === "PENDING") {
        const ids = alvos.flatMap((l) => (l.registration ? [l.registration.id] : []));
        if (ids.length) await db.playerRegistration.deleteMany({ where: { id: { in: ids } } });
        return { ok: true, count: alvos.length };
      }

      const estado: Estado = dto.status as Estado;
      const agora = new Date();
      const nivel = ESTADOS.indexOf(estado);
      const passo = (i: number, actual: Date | null) => (nivel >= i ? (actual ?? agora) : null);
      let quem: string | null | undefined;

      for (const l of alvos) {
        const r = l.registration;
        if (r) {
          await db.playerRegistration.update({
            where: { id: r.id },
            data: { status: estado, signedAt: passo(1, r.signedAt), submittedAt: passo(2, r.submittedAt), doneAt: passo(3, r.doneAt) },
          });
        } else {
          quem ??= await nomeDeQuemMexe(db, ctx);
          await db.playerRegistration.create({
            data: {
              academyId: ctx.academyId,
              athleteId: l.athleteId,
              sportId: l.sportId,
              seasonId: epoca.id,
              kind: l.folha.tipo,
              category: l.folha.categoria,
              status: estado,
              generatedAt: agora,
              generatedByName: quem,
              signedAt: passo(1, null),
              submittedAt: passo(2, null),
              doneAt: passo(3, null),
            },
          });
        }
        if (licenca) {
          await db.athleteLicense.upsert({
            where: { athleteId_sportId_seasonId: { athleteId: l.athleteId, sportId: l.sportId, seasonId: epoca.id } },
            create: { academyId: ctx.academyId, athleteId: l.athleteId, sportId: l.sportId, seasonId: epoca.id, number: licenca },
            update: { number: licenca },
          });
        }
      }
      return { ok: true, count: alvos.length };
    }, { timeoutMs: 20_000 });
  }

  /* ---- a cópia assinada ---- */

  /** Passo 1: o endereço para carregar a folha assinada (PDF ou fotografia). */
  async assinadaUploadUrl(ctx: RequestContext, id: string, contentType: string) {
    this.mustWrite(ctx);
    const ext = DOC_TIPOS[contentType];
    if (!ext || contentType.includes("word")) throw new BadRequestException("A folha assinada tem de ser um PDF ou uma imagem");
    const [r] = await this.prisma.runAs(ctx.academyId, (db) => this.inscricoesNoAmbito(db, ctx, [id]));
    await this.espaco.garantirEspaco(ctx.academyId);
    await this.garantirBucket();
    const key = `${pastaDoAtleta(ctx.academyId, r.athleteId)}/${randomBytes(8).toString("hex")}${ext}`;
    const signed = await this.storage.signUpload(DOCUMENT_BUCKET, key);
    return { ...signed, key, maxBytes: DOC_MAX_BYTES };
  }

  /**
   * Passo 2: a folha assinada chegou. Junta-se ao documento da inscrição (que
   * nasce aqui, se a folha não tinha sido anexada) e a inscrição passa a
   * "assinada", se ainda não ia mais à frente.
   */
  async assinadaConfirmar(ctx: RequestContext, id: string, dto: { key: string; name?: string }) {
    this.mustWrite(ctx);
    const r = await this.prisma.runAs(ctx.academyId, async (db) => {
      const [reg] = await this.inscricoesNoAmbito(db, ctx, [id]);
      const extra = await db.playerRegistration.findFirst({
        where: { id: reg.id },
        select: { season: { select: { label: true } }, sport: { select: { name: true } }, athlete: { select: { name: true } } },
      });
      return { ...reg, ...extra! };
    });
    if (!chaveDoAtleta(dto.key, ctx.academyId, r.athleteId)) throw new BadRequestException("Chave inválida");
    if (!(await this.storage.exists(DOCUMENT_BUCKET, dto.key))) throw new BadRequestException("O ficheiro não chegou ao armazenamento");

    const original = nomeDoFicheiro(dto.name, dto.key);
    const ext = original.includes(".") ? original.slice(original.lastIndexOf(".")) : "";
    const ficheiro: FicheiroDoDocumento = { key: dto.key, name: `${PREFIXO_ASSINADA} ${r.athlete.name}${ext}`, type: tipoDaChave(dto.key) };

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const existente = r.documentId
        ? await db.athleteDocument.findFirst({ where: { id: r.documentId, athleteId: r.athleteId }, select: { id: true, files: true } })
        : null;
      let documentId: string;
      if (existente) {
        const files = ficheirosDe(existente.files);
        if (files.length >= DOC_MAX_FICHEIROS) throw new BadRequestException(`Um documento leva no máximo ${DOC_MAX_FICHEIROS} ficheiros`);
        await db.athleteDocument.update({ where: { id: existente.id }, data: { files: [...files, ficheiro] } });
        documentId = existente.id;
      } else {
        const doc = await db.athleteDocument.create({
          data: {
            academyId: ctx.academyId,
            athleteId: r.athleteId,
            name: `Inscrição FPF ${r.season.label} · ${r.sport.name}`,
            files: [ficheiro],
            createdByName: await nomeDeQuemMexe(db, ctx),
          },
          select: { id: true },
        });
        documentId = doc.id;
      }
      const agora = new Date();
      await db.playerRegistration.update({
        where: { id: r.id },
        data: {
          documentId,
          ...(r.status === "GENERATED" ? { status: "SIGNED", signedAt: agora } : r.signedAt ? {} : { signedAt: agora }),
        },
      });
      return { ok: true, documentId };
    });
  }

  /** As inscrições pedidas, só se todas estiverem ao alcance de quem pede. */
  private async inscricoesNoAmbito(db: ScopedClient, ctx: RequestContext, ids: string[]) {
    const equipas = teamScopeFilter(ctx);
    const regs = await db.playerRegistration.findMany({
      where: {
        id: { in: ids },
        ...(equipas ? { athlete: { teams: { some: { teamId: equipas } } } } : {}),
      },
      select: {
        id: true, athleteId: true, sportId: true, seasonId: true, status: true, documentId: true,
        signedAt: true, submittedAt: true, doneAt: true,
      },
    });
    if (regs.length !== new Set(ids).size) throw new NotFoundException("Inscrição não encontrada");
    return regs;
  }
}

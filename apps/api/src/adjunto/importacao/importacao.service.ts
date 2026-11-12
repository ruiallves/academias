import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { AdjuntoImport, Prisma } from "@prisma/client";
import type { Response as OpenAiResponse } from "openai/resources/responses/responses";
import { PrismaService } from "../../prisma/prisma.service";
import { can, type RequestContext } from "../../common/permissions";
import { AthletesService, type ResultadoDaImportacao } from "../../academy/athletes.service";
import { AcademyService } from "../../academy/academy.service";
import { OpenAiClient } from "../openai.client";
import { extrairFolhas, type Folha } from "./extrair";
import { entradaDoMapeamento, INSTRUCOES_DO_MAPEAMENTO, lerMapeamento, sanearMapeamento, SCHEMA_DO_MAPEAMENTO, type FolhaMapeada, type Mapeamento } from "./mapear";
import { transformarAtletas, type EquipaDoClube, type EquipaNova, type LinhaDeAtleta } from "./transformar";

/**
 * A importação universal: "mandem-nos o que têm".
 *
 * ## Os cinco passos
 *
 *   1. **Extrair** (`extrair.ts`): o ficheiro vira folhas com cabeçalhos e linhas.
 *   2. **Mapear** (`mapear.ts`): o modelo forte decide, uma vez, o que é cada
 *      folha e cada coluna. Vê cabeçalhos e cinco linhas mascaradas.
 *   3. **Transformar** (`transformar.ts`): o código aplica o mapeamento a todas
 *      as linhas e produz as linhas que a importação de sempre aceita.
 *   4. **Ensaiar**: `AthletesService.importMany` com `ensaio`, que corre tudo e
 *      não escreve. Sai "157 entram, 41 já existiam, 14 com problemas".
 *   5. **Confirmar**: criam-se as equipas novas e corre-se a importação a sério,
 *      pelo mesmo serviço e com a sessão de quem confirmou.
 *
 * Por agora só a entidade **atletas** se importa. As outras folhas ficam
 * mapeadas e marcadas "ainda não", para a pessoa saber que as vimos.
 */

type EnsaioDaFolha = {
  nome: string;
  entidade: string;
  suportada: boolean;
  total: number;
  entram: number;
  entramEmEquipaNova: number;
  jaExistiam: number;
  existentes: { line: number; name: string; matchedName: string; changes: string[] }[];
  erros: { line: number; name: string; error: string }[];
  equipasNovas: EquipaNova[];
  encarregadosDeFora: number;
  telefonesASubstituir: number;
};

type ImportacaoParaAConsola = {
  id: string;
  conversationId: string;
  fileName: string;
  status: AdjuntoImport["status"];
  resumo: string;
  folhas: (FolhaMapeada & { headers: string[]; linhas: number; amostra: unknown[][]; ensaio: EnsaioDaFolha | null })[];
  result: unknown;
  error: string | null;
  createdAt: string;
};

@Injectable()
export class ImportacaoService {
  private readonly log = new Logger(ImportacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openai: OpenAiClient,
    private readonly athletes: AthletesService,
    private readonly academy: AcademyService,
  ) {}

  async receber(ctx: RequestContext, conversationId: string, ficheiro: { fileName: string; mime: string; base64: string }): Promise<ImportacaoParaAConsola> {
    if (!this.openai.ligado()) throw new ServiceUnavailableException("O Assistente IA está desligado neste servidor");
    if (!can(ctx, "athlete:write")) throw new ForbiddenException("Sem permissão para inscrever atletas");
    await this.conversaDaPessoa(ctx, conversationId);

    const bytes = Buffer.from(ficheiro.base64, "base64");
    if (bytes.length === 0) throw new BadRequestException("O ficheiro está vazio");
    if (bytes.length > 8 * 1024 * 1024) throw new BadRequestException("O ficheiro é demasiado grande (máximo 8 MB)");

    const folhas = extrairFolhas(bytes, ficheiro.fileName, ficheiro.mime);
    const clube = await this.clube(ctx);

    await this.mensagem(ctx, conversationId, "USER", `Ficheiro: ${ficheiro.fileName}`, []);

    let mapeamento: Mapeamento;
    try {
      mapeamento = await this.mapear(ctx, folhas, clube);
    } catch (e) {
      const erro = (e as Error).message ?? "Não consegui mapear o ficheiro";
      const guardada = await this.prisma.runAs(ctx.academyId, (db) =>
        db.adjuntoImport.create({
          data: { academyId: ctx.academyId, conversationId, membershipId: ctx.membershipId, fileName: ficheiro.fileName, fileType: ficheiro.mime, status: "FAILED", sheets: folhas as unknown as Prisma.InputJsonValue, error: erro },
        }),
      );
      await this.mensagem(ctx, conversationId, "ASSISTANT", `Li o ficheiro mas não consegui perceber as colunas: ${erro}`, [{ type: "importacao", id: guardada.id }]);
      return this.paraAConsola(guardada);
    }

    const ensaio = await this.ensaiar(ctx, folhas, mapeamento, clube);
    const guardada = await this.prisma.runAs(ctx.academyId, (db) =>
      db.adjuntoImport.create({
        data: {
          academyId: ctx.academyId,
          conversationId,
          membershipId: ctx.membershipId,
          fileName: ficheiro.fileName,
          fileType: ficheiro.mime,
          status: "REHEARSED",
          sheets: folhas as unknown as Prisma.InputJsonValue,
          mapping: mapeamento as unknown as Prisma.InputJsonValue,
          rehearsal: ensaio as unknown as Prisma.InputJsonValue,
        },
      }),
    );
    await this.mensagem(ctx, conversationId, "ASSISTANT", textoDoEnsaio(mapeamento, ensaio), [{ type: "importacao", id: guardada.id }]);
    return this.paraAConsola(guardada);
  }

  async ver(ctx: RequestContext, id: string): Promise<ImportacaoParaAConsola> {
    return this.paraAConsola(await this.carregar(ctx, id));
  }

  async corrigir(ctx: RequestContext, id: string, bruto: Record<string, unknown>): Promise<ImportacaoParaAConsola> {
    const imp = await this.carregar(ctx, id);
    if (imp.status === "IMPORTED") throw new BadRequestException("Esta importação já foi feita");
    const folhas = imp.sheets as unknown as Folha[];
    const mapeamento = sanearMapeamento(bruto as Partial<Mapeamento>, folhas);
    const anterior = (imp.mapping as unknown as Mapeamento | null)?.resumo ?? "";
    mapeamento.resumo = mapeamento.resumo || anterior;
    const clube = await this.clube(ctx);
    const ensaio = await this.ensaiar(ctx, folhas, mapeamento, clube);
    const actualizada = await this.prisma.runAs(ctx.academyId, (db) =>
      db.adjuntoImport.update({
        where: { id },
        data: { status: "REHEARSED", error: null, mapping: mapeamento as unknown as Prisma.InputJsonValue, rehearsal: ensaio as unknown as Prisma.InputJsonValue },
      }),
    );
    return this.paraAConsola(actualizada);
  }

  async confirmar(ctx: RequestContext, id: string, opcoes: { sobrescrever?: boolean; enviarConvites?: boolean }): Promise<ImportacaoParaAConsola> {
    const imp = await this.carregar(ctx, id);
    if (imp.status === "IMPORTED") throw new BadRequestException("Esta importação já foi feita");
    if (!imp.mapping) throw new BadRequestException("Esta importação não tem mapeamento");
    const folhas = imp.sheets as unknown as Folha[];
    const mapeamento = imp.mapping as unknown as Mapeamento;
    const ensaioAnterior = (imp.rehearsal as unknown as EnsaioDaFolha[] | null) ?? [];
    let clube = await this.clube(ctx);

    const resultado: Record<string, unknown> = { folhas: [] as unknown[], equipasCriadas: [] as string[] };
    for (const [i, folha] of folhas.entries()) {
      const mapa = mapeamento.folhas.find((m) => m.nome === folha.name);
      if (!mapa || mapa.entidade !== "atletas") continue;

      // As equipas novas primeiro, para as linhas delas terem para onde ir.
      const antes = transformarAtletas(folha, mapa, clube);
      const criadas: string[] = [];
      for (const nova of antes.equipasNovas) {
        if (!nova.sportId) continue;
        try {
          await this.academy.createTeam(ctx, { name: nova.name, sportId: nova.sportId, maxAge: nova.maxAge, season: clube.epoca, schedule: [] });
          criadas.push(nova.name);
        } catch (e) {
          this.log.warn(`Equipa nova "${nova.name}" não criada: ${(e as Error).message}`);
        }
      }
      if (criadas.length) {
        clube = await this.clube(ctx);
        (resultado.equipasCriadas as string[]).push(...criadas);
      }

      const { rows, errors } = transformarAtletas(folha, mapa, clube);
      const ensaioDaFolha = ensaioAnterior.find((e) => e.nome === folha.name);
      // "Só os novos": tira-se da folha quem o ensaio reconheceu como já existente.
      const linhasExistentes = new Set(opcoes.sobrescrever ? [] : (ensaioDaFolha?.existentes ?? []).map((e) => e.line));
      const paraImportar = rows.filter((r) => r.teamId && !linhasExistentes.has(r.line));
      const r = paraImportar.length > 0 ? await this.athletes.importMany(ctx, paraEnviar(paraImportar), { sobrescrever: opcoes.sobrescrever === true, enviarConvites: opcoes.enviarConvites === true }) : null;
      (resultado.folhas as unknown[]).push({
        nome: folha.name,
        enviadas: paraImportar.length,
        semEquipa: rows.filter((x) => !x.teamId).length,
        errosDaTransformacao: errors,
        resultado: r
          ? {
              created: r.created,
              updated: r.updated,
              errors: r.errors.map((e) => ({ ...e, row: paraImportar[e.row - 2]?.line ?? e.row })),
              existingTotal: r.existingTotal,
              encarregadosLigados: r.encarregadosLigados,
              encarregadosDeForaTotal: r.encarregadosDeForaTotal,
            }
          : null,
      });
      void i;
    }

    const actualizada = await this.prisma.runAs(ctx.academyId, (db) =>
      db.adjuntoImport.update({ where: { id }, data: { status: "IMPORTED", result: resultado as Prisma.InputJsonValue } }),
    );
    const totais = (resultado.folhas as { resultado: { created: number; updated: number; errors: unknown[] } | null }[]).reduce(
      (acc, f) => ({ created: acc.created + (f.resultado?.created ?? 0), updated: acc.updated + (f.resultado?.updated ?? 0), errors: acc.errors + (f.resultado?.errors.length ?? 0) }),
      { created: 0, updated: 0, errors: 0 },
    );
    await this.mensagem(
      ctx,
      imp.conversationId,
      "ASSISTANT",
      `Importação feita: ${totais.created} ${totais.created === 1 ? "atleta novo" : "atletas novos"}${totais.updated ? `, ${totais.updated} atualizados` : ""}${totais.errors ? `, ${totais.errors} linhas com erro` : ""}${(resultado.equipasCriadas as string[]).length ? `. Equipas criadas: ${(resultado.equipasCriadas as string[]).join(", ")}` : ""}.`,
      [{ type: "importacao", id }],
    );
    return this.paraAConsola(actualizada);
  }

  /* ---- Os passos ------------------------------------------------------------- */

  private async mapear(ctx: RequestContext, folhas: Folha[], clube: Clube): Promise<Mapeamento> {
    const stream = await this.openai.responder({
      nivel: "forte",
      esforco: "medium",
      instrucoes: INSTRUCOES_DO_MAPEAMENTO,
      entrada: [{ role: "user", content: entradaDoMapeamento(folhas, { equipas: clube.equipas.map((e) => ({ nome: e.name, modalidade: e.sportName })), modalidades: clube.modalidades.map((m) => m.name) }) }],
      formato: { nome: "mapeamento", schema: SCHEMA_DO_MAPEAMENTO },
      maxSaida: 8_000,
    });
    let saida = "";
    let resposta: OpenAiResponse | null = null;
    for await (const evento of stream) {
      if (evento.type === "response.output_text.delta") saida += evento.delta;
      else if (evento.type === "response.completed") resposta = evento.response;
      else if (evento.type === "response.failed" || evento.type === "error") {
        throw new ServiceUnavailableException(evento.type === "error" ? evento.message : (evento.response.error?.message ?? "O modelo falhou"));
      }
    }
    if (resposta?.usage) await this.contarUso(ctx.academyId, this.openai.modelo("forte"), resposta.usage.input_tokens, resposta.usage.input_tokens_details?.cached_tokens ?? 0, resposta.usage.output_tokens);
    return lerMapeamento(saida, folhas);
  }

  private async ensaiar(ctx: RequestContext, folhas: Folha[], mapeamento: Mapeamento, clube: Clube): Promise<EnsaioDaFolha[]> {
    const saida: EnsaioDaFolha[] = [];
    for (const folha of folhas) {
      const mapa = mapeamento.folhas.find((m) => m.nome === folha.name);
      const base: EnsaioDaFolha = {
        nome: folha.name, entidade: mapa?.entidade ?? "ignorar", suportada: mapa?.entidade === "atletas", total: folha.rows.length,
        entram: 0, entramEmEquipaNova: 0, jaExistiam: 0, existentes: [], erros: [], equipasNovas: [], encarregadosDeFora: 0, telefonesASubstituir: 0,
      };
      if (!mapa || mapa.entidade !== "atletas") {
        saida.push(base);
        continue;
      }
      const { rows, errors, equipasNovas } = transformarAtletas(folha, mapa, clube);
      const comEquipa = rows.filter((r) => r.teamId);
      const semEquipa = rows.filter((r) => !r.teamId);
      let r: ResultadoDaImportacao | null = null;
      if (comEquipa.length > 0) {
        try {
          r = await this.athletes.importMany(ctx, paraEnviar(comEquipa), { ensaio: true });
        } catch (e) {
          base.erros.push({ line: 0, name: "", error: (e as Error).message ?? "O ensaio falhou" });
        }
      }
      // O `importMany` numera pelo lote que recebeu (índice mais cabeçalho); aqui volta-se à linha do ficheiro.
      const linhaDoFicheiro = (row: number) => comEquipa[row - 2]?.line ?? row;
      saida.push({
        ...base,
        entram: (r?.created ?? 0) + semEquipa.length,
        entramEmEquipaNova: semEquipa.length,
        jaExistiam: r?.existingTotal ?? 0,
        existentes: (r?.existing ?? []).map((e) => ({ line: linhaDoFicheiro(e.line), name: e.name, matchedName: e.matchedName, changes: e.changes })),
        erros: [...errors, ...(r?.errors ?? []).map((e) => ({ line: linhaDoFicheiro(e.row), name: e.name, error: e.error })), ...base.erros].sort((a, b) => a.line - b.line).slice(0, 300),
        equipasNovas,
        encarregadosDeFora: r?.encarregadosDeForaTotal ?? 0,
        telefonesASubstituir: r?.telefonesTotal ?? 0,
      });
    }
    return saida;
  }

  /* ---- Apoio ----------------------------------------------------------------- */

  private async clube(ctx: RequestContext): Promise<Clube> {
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const epoca = await db.season.findFirst({ where: { isCurrent: true }, select: { label: true } });
      const equipas = await db.team.findMany({ where: { season: { isCurrent: true } }, select: { id: true, name: true, sportId: true, sport: { select: { name: true } } } });
      const modalidades = await db.sport.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, name: true } });
      return {
        epoca: epoca?.label ?? "",
        equipas: equipas.map((e) => ({ id: e.id, name: e.name, sportId: e.sportId, sportName: e.sport.name })),
        modalidades,
      };
    });
  }

  private async conversaDaPessoa(ctx: RequestContext, conversationId: string) {
    const c = await this.prisma.runAs(ctx.academyId, (db) => db.adjuntoConversation.findFirst({ where: { id: conversationId }, select: { membershipId: true } }));
    if (!c) throw new NotFoundException("Conversa não encontrada");
    if (c.membershipId !== ctx.membershipId) throw new ForbiddenException("Esta conversa é de outra pessoa");
  }

  private async carregar(ctx: RequestContext, id: string): Promise<AdjuntoImport> {
    const imp = await this.prisma.runAs(ctx.academyId, (db) => db.adjuntoImport.findFirst({ where: { id } }));
    if (!imp) throw new NotFoundException("Importação não encontrada");
    if (imp.membershipId !== ctx.membershipId) throw new ForbiddenException("Esta importação é de outra pessoa");
    return imp;
  }

  private async mensagem(ctx: RequestContext, conversationId: string, role: "USER" | "ASSISTANT", text: string, blocks: unknown[]) {
    await this.prisma.runAs(ctx.academyId, async (db) => {
      await db.adjuntoMessage.create({
        data: { academyId: ctx.academyId, conversationId, role, text, blocks: blocks as Prisma.InputJsonValue, items: [{ role: role === "USER" ? "user" : "assistant", content: text }] as Prisma.InputJsonValue },
      });
      await db.adjuntoConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    });
  }

  private async contarUso(academyId: string, modelo: string, entrada: number, cache: number, saida: number) {
    const mes = new Date().toISOString().slice(0, 7);
    try {
      await this.prisma.runAs(academyId, (db) =>
        db.adjuntoUsage.upsert({
          where: { academyId_month_model: { academyId, month: mes, model: modelo } },
          create: { academyId, month: mes, model: modelo, requests: 1, inputTokens: entrada, cachedTokens: cache, outputTokens: saida },
          update: { requests: { increment: 1 }, inputTokens: { increment: entrada }, cachedTokens: { increment: cache }, outputTokens: { increment: saida } },
        }),
      );
    } catch (e) {
      this.log.warn(`Não contei o uso da importação: ${(e as Error).message}`);
    }
  }

  /** Público para a conversa (`AdjuntoService.ver`) mostrar as importações na mesma forma. */
  paraAConsola(imp: AdjuntoImport): ImportacaoParaAConsola {
    const folhas = (imp.sheets as unknown as Folha[]) ?? [];
    const mapeamento = (imp.mapping as unknown as Mapeamento | null) ?? null;
    const ensaio = (imp.rehearsal as unknown as EnsaioDaFolha[] | null) ?? [];
    return {
      id: imp.id,
      conversationId: imp.conversationId,
      fileName: imp.fileName,
      status: imp.status,
      resumo: mapeamento?.resumo ?? "",
      folhas: folhas.map((f) => {
        const m = mapeamento?.folhas.find((x) => x.nome === f.name) ?? { nome: f.name, entidade: "ignorar" as const, confianca: "baixa" as const, colunas: [], equipas: [], duvidas: [] };
        return { ...m, headers: f.headers, linhas: f.rows.length, amostra: f.rows.slice(0, 3).map((l) => l.map(mascararParaAConsola)), ensaio: ensaio.find((e) => e.nome === f.name) ?? null };
      }),
      result: imp.result,
      error: imp.error,
      createdAt: imp.createdAt.toISOString(),
    };
  }
}

type Clube = { epoca: string; equipas: EquipaDoClube[]; modalidades: { id: string; name: string }[] };

/** As linhas como o DTO da importação as quer: sem a linha nem o nome da equipa. */
function paraEnviar(rows: LinhaDeAtleta[]) {
  return rows.map(({ line, teamName, ...resto }) => {
    void line;
    void teamName;
    return resto;
  });
}

/** O que a consola mostra como exemplo de cada coluna: a pessoa é do clube, mas um NIF inteiro no ecrã não ajuda ninguém. */
function mascararParaAConsola(c: unknown): unknown {
  if (typeof c === "string" && /^\d{9}$/.test(c)) return `${c.slice(0, 3)}######`;
  if (typeof c === "number" && String(c).length === 9) return `${String(c).slice(0, 3)}######`;
  return c;
}

function textoDoEnsaio(mapeamento: Mapeamento, ensaio: EnsaioDaFolha[]): string {
  const atletas = ensaio.filter((e) => e.suportada);
  const outras = ensaio.filter((e) => !e.suportada && e.entidade !== "ignorar");
  const partes: string[] = [];
  if (mapeamento.resumo) partes.push(mapeamento.resumo);
  for (const e of atletas) {
    const bits = [`${e.entram} ${e.entram === 1 ? "entra" : "entram"}`];
    if (e.entramEmEquipaNova) bits.push(`${e.entramEmEquipaNova} em ${e.equipasNovas.length === 1 ? "equipa nova" : "equipas novas"} (${e.equipasNovas.map((q) => q.name).join(", ")})`);
    if (e.jaExistiam) bits.push(`${e.jaExistiam} já existiam`);
    if (e.erros.length) bits.push(`${e.erros.length} com problemas`);
    partes.push(`Folha "${e.nome}", ${e.total} linhas: ${bits.join(", ")}.`);
  }
  if (outras.length) partes.push(`Vi também ${outras.map((o) => `"${o.nome}" (${o.entidade})`).join(", ")}; por agora só importo atletas.`);
  const duvidas = mapeamento.folhas.flatMap((f) => f.duvidas);
  if (duvidas.length) partes.push(`Tenho ${duvidas.length === 1 ? "uma dúvida" : `${duvidas.length} dúvidas`} para confirmares no ensaio, à direita.`);
  partes.push("Nada entra até carregares em Importar.");
  return partes.join(" ");
}

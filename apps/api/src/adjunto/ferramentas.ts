import type { Tool } from "openai/resources/responses/responses";
import type { PrismaService, ScopedClient } from "../prisma/prisma.service";
import { can, teamScopeFilter, teamScopeForRoster, type RequestContext } from "../common/permissions";
import { formatarNoFuso, instanteNoFuso, partesNoFuso } from "../common/fuso";
import { normalizar, resolverNome, resolverNomes, rotuloDe, type Pessoa } from "./nomes";
import { ACOES, aplicaSe, descricaoDasAcoes, lerDiasDaSemana, lerValor, podeFazer, RECUSADO, respondido, SECCOES_DO_SITE, somarMinutos, type Acao, type Campo, type Condicao, type TipoDeCampo } from "./acoes";
import { ESQUEMA_DO_EXERCICIO, ESQUEMA_DO_PLANO, instrucoesDoExercicio, instrucoesDoPlaneador, lerExercicioNovo, lerPlanoGerado, miniatura, pedidoDoExercicio, pedidoDoPlaneador, terrenoDaEquipa, type ExercicioDaBiblioteca } from "./planos";
import { siteIncluido } from "../site/plano";
import { BANNER_VAZIO, BANNERS_MAX, inicioValido, layoutValido, recintosValidos, tiposValidos, type Inicio, type Recinto, type SeccaoInicio, type TipoGuardado } from "../site/site.tipos";
import { motivoParaNaoVender, SELECT_VENDAS } from "../common/vendas-online";

/**
 * Quem gera um plano de treino: um pedido ao modelo forte, com a resposta na
 * forma de `ESQUEMA_DO_PLANO`. Vive no `AdjuntoService`, que tem o cliente da
 * OpenAI e conta o uso; o executor só o chama. Ver `planos.ts`.
 */
export type Planeador = {
  /** `esquema`: a forma da resposta, o plano inteiro (`ESQUEMA_DO_PLANO`) ou um exercício (`ESQUEMA_DO_EXERCICIO`). */
  gerar(p: { instrucoes: string; pedido: string; pesquisar: boolean; esquema: { nome: string; schema: Record<string, unknown> } }): Promise<string>;
};

/** Um campo como a consola o desenha no formulário do chat. */
export type CampoDoFormulario = {
  nome: string;
  rotulo: string;
  tipo: TipoDeCampo;
  obrigatorio: boolean;
  /** O que a pessoa já disse. Vazio = por preencher. */
  valor: string;
  /** Uma proposta que só fica se a pessoa a deixar (local do horário, hora de fim). */
  sugestao?: string;
  opcoes?: { valor: string; label: string }[];
  /** Vários valores (balneários, equipas). */
  multiplo?: boolean;
  /** Aceita escrever um valor que não está nas opções. */
  livre?: boolean;
  descricao?: string;
  /** Ainda ninguém respondeu a este campo. */
  emFalta: boolean;
  /** Só aparece quando outro campo tem este valor (os balneários de um jogo, só em casa). */
  soSe?: Condicao;
};

export type Formulario = { acao: string; titulo: string; campos: CampoDoFormulario[] };

/**
 * As ferramentas do Adjunto: o que o modelo pode pedir ao servidor.
 *
 * ## Duas famílias
 *
 * **Leituras** devolvem dados e mais nada: as equipas de quem fala, um plantel,
 * os treinos de uma semana, a convocatória de um jogo, quem está lesionado.
 * Passam pelos mesmos filtros de âmbito da consola (`teamScopeFilter`), por
 * isso um treinador só vê as equipas dele através do modelo, como as vê no
 * ecrã.
 *
 * **Propostas** não escrevem. Resolvem os nomes contra o plantel, validam o que
 * dá para validar, e devolvem ao modelo um resumo do que ficaria gravado; o
 * serviço guarda a proposta e a consola mostra o cartão. Quem grava é
 * `PropostasService.confirmar`, com a sessão de quem carregou no botão.
 *
 * ## O que sai para o modelo
 *
 * Nomes de atletas e o mínimo à volta (número, posição, "indisponível"). Nunca
 * datas de nascimento, NIF, contactos ou o detalhe clínico: uma baixa é "de
 * baixa até dia X", não o diagnóstico. O boletim fica no servidor.
 */

export type Contexto = {
  rota?: string;
  teamId?: string;
  sessionId?: string;
  matchId?: string;
  athleteId?: string;
  /** A pessoa está em conversa por voz: as respostas são ditas, um campo de cada vez. */
  voz?: boolean;
};

/** O que uma ferramenta devolve: dados para o modelo, e efeitos para a consola. */
export type ResultadoDaFerramenta = {
  /** O que o modelo lê. Vai em JSON. */
  dados: unknown;
  /** Uma proposta nova, a mostrar como cartão. */
  proposta?: PropostaNova;
  /** Uma pergunta com botões, a mostrar à pessoa. O modelo termina a vez. */
  pergunta?: Pergunta;
  /** Um formulário com os campos de uma ação, a mostrar à pessoa. O modelo pergunta e termina a vez. */
  formulario?: Formulario;
  /** O modelo pequeno não conseguiu: subir de nível e repetir. */
  subir?: string;
};

export type PropostaNova = {
  kind: "ATTENDANCE" | "CLINICAL" | "CALLUPS" | "EVENT" | "ATHLETE" | "ANNOUNCEMENT" | "TRAINING_PLAN" | "SITE_NEWS" | "SITE" | "EXERCISE";
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  /** O que o cartão mostra, pronto a ler. */
  view: Record<string, unknown>;
  /** A ação do registo e os valores do formulário, para o cartão se poder editar. */
  edicao?: { acao: string; valores: Record<string, string> };
};

export type Pergunta = {
  texto: string;
  opcoes: { id: string; label: string }[];
  /** Para que serve a escolha, para a consola a devolver com contexto. */
  campo?: string;
};

type AtletaDoPlantel = Pessoa & { status: string; baixa: boolean; limitado: boolean };

const JSON_SCHEMA_SEM_EXTRAS = { additionalProperties: false } as const;

function ferramenta(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Tool {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: { type: "object", properties, required, ...JSON_SCHEMA_SEM_EXTRAS },
  };
}

/**
 * As definições, para o modelo. `strict: true` obriga a JSON válido com
 * exatamente estes campos, por isso todos os campos são obrigatórios no schema
 * e os opcionais aceitam `null`.
 */
export const FERRAMENTAS: Tool[] = [
  ferramenta("equipas", "As equipas que a pessoa que fala pode ver, com id, nome e modalidade. Usa antes de qualquer outra leitura quando não sabes o teamId.", {}),
  ferramenta(
    "plantel",
    "Os atletas de uma equipa: id, nome, número, posição e se está indisponível (baixa clínica, trabalho condicionado ou em pausa).",
    { teamId: { type: "string" } },
    ["teamId"],
  ),
  ferramenta(
    "treinos",
    "Os treinos de uma equipa num intervalo de dias (por omissão, de há 7 dias a daqui a 7). Cada um traz id, data e hora, estado, se as presenças já estão fechadas, e quem avisou que falta.",
    {
      teamId: { type: "string" },
      de: { type: ["string", "null"], description: "AAAA-MM-DD, inclusive" },
      ate: { type: ["string", "null"], description: "AAAA-MM-DD, inclusive" },
    },
    ["teamId", "de", "ate"],
  ),
  ferramenta(
    "jogos",
    "Os jogos num intervalo de dias (por omissão, de há 14 dias a daqui a 21), de uma equipa ou de todas as que a pessoa vê: id, data, adversário, casa ou fora, resultado, quantos convocados e se a convocatória já foi submetida.",
    {
      teamId: { type: ["string", "null"] },
      de: { type: ["string", "null"] },
      ate: { type: ["string", "null"] },
    },
    ["teamId", "de", "ate"],
  ),
  ferramenta("convocatoria", "Quem está convocado para um jogo, com a resposta da família quando a há.", { matchId: { type: "string" } }, ["matchId"]),
  ferramenta(
    "agenda",
    "Tudo o que está marcado num intervalo de dias (por omissão, de hoje a daqui a 14): treinos, jogos e outros eventos, de uma equipa ou de todas as que a pessoa vê, com o id de cada um (serve para desmarcar ou reativar).",
    { teamId: { type: ["string", "null"] }, de: { type: ["string", "null"] }, ate: { type: ["string", "null"] } },
    ["teamId", "de", "ate"],
  ),
  ferramenta("catalogo", "Os locais, balneários, provas e tipos de evento do clube, como estão nas Definições. Usa antes de marcar um treino, jogo ou evento.", {}),
  ferramenta(
    "exercicios",
    "A biblioteca de exercícios da Área técnica que a pessoa vê: id, nome, categoria, tipo, minutos, formato, intensidade, idades e se tem desenho. De uma modalidade (pelo nome) ou de todas. Para planear um treino não precisas de a ler: o servidor lê-a sozinho.",
    { modalidade: { type: ["string", "null"], description: "O nome da modalidade, ou null para todas." } },
    ["modalidade"],
  ),
  ferramenta(
    "propor_acao",
    `Propõe uma ação da consola a partir de campos. O servidor valida, preenche o que tem valor por omissão, resolve equipa, local e prova pelos nomes, e devolve o que ficaria gravado; a pessoa confirma no cartão. Se faltar um campo obrigatório, o servidor pergunta à pessoa e tu terminas a tua vez. Manda os campos como a pessoa os disse; não inventes valores que ela não deu. Campos com * são obrigatórios.\n${descricaoDasAcoes()}`,
    {
      acao: { type: "string", enum: Object.keys(ACOES) },
      campos: {
        type: "array",
        items: { type: "object", properties: { nome: { type: "string" }, valor: { type: ["string", "null"] } }, required: ["nome", "valor"], ...JSON_SCHEMA_SEM_EXTRAS },
      },
    },
    ["acao", "campos"],
  ),
  ferramenta(
    "lesionados",
    "Os atletas indisponíveis neste momento (baixa ou trabalho condicionado) e até quando, de uma equipa ou de todas.",
    { teamId: { type: ["string", "null"] } },
    ["teamId"],
  ),
  ferramenta(
    "propor_presencas",
    "Propõe a folha de presenças de um treino. Dá os nomes como a pessoa os disse; o servidor encontra-os no plantel e pergunta se houver dois iguais. Quem não vem na lista conta como presente. Não grava: a pessoa confirma depois.",
    {
      sessionId: { type: "string" },
      faltas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            nome: { type: "string" },
            tipo: { type: "string", enum: ["falta", "justificada", "atraso"] },
            motivo: { type: ["string", "null"] },
          },
          required: ["nome", "tipo", "motivo"],
          ...JSON_SCHEMA_SEM_EXTRAS,
        },
      },
    },
    ["sessionId", "faltas"],
  ),
  ferramenta(
    "propor_lesao",
    "Propõe um registo clínico de lesão ou queixa de um atleta: o nome como foi dito, o que se passou, a zona do corpo e se fica de fora (OUT), condicionado (LIMITED) ou só em observação (NONE). Não grava: a pessoa confirma depois.",
    {
      nome: { type: "string" },
      teamId: { type: ["string", "null"], description: "A equipa onde procurar o nome, se se souber." },
      descricao: { type: "string" },
      impacto: { type: "string", enum: ["OUT", "LIMITED", "NONE"] },
      data: { type: ["string", "null"], description: "AAAA-MM-DD. Nulo é hoje." },
      retomaPrevista: { type: ["string", "null"], description: "AAAA-MM-DD, se foi dita." },
    },
    ["nome", "teamId", "descricao", "impacto", "data", "retomaPrevista"],
  ),
  ferramenta(
    "propor_convocatoria",
    "Propõe a convocatória de um jogo. Parte de uma base (a convocatória do último jogo da equipa, o plantel inteiro, ou nenhuma) e acrescenta ou tira nomes como foram ditos. Não grava nem avisa famílias: a pessoa confirma depois.",
    {
      matchId: { type: "string" },
      base: { type: "string", enum: ["ultimo_jogo", "plantel", "nenhuma"] },
      adicionar: { type: "array", items: { type: "string" } },
      remover: { type: "array", items: { type: "string" } },
    },
    ["matchId", "base", "adicionar", "remover"],
  ),
  ferramenta(
    "perguntar",
    "Faz uma pergunta de escolha à pessoa, com botões. Usa quando falta uma decisão que só ela pode tomar (que treino, que equipa, que jogo). Depois de chamar, termina a tua vez.",
    {
      texto: { type: "string" },
      opcoes: {
        type: "array",
        items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" } }, required: ["id", "label"], ...JSON_SCHEMA_SEM_EXTRAS },
      },
    },
    ["texto", "opcoes"],
  ),
  ferramenta(
    "precisar_de_ajuda",
    "Chama isto quando o pedido é mais complexo do que consegues resolver bem com as ferramentas que tens (várias ações encadeadas, regras a cruzar, um pedido que não percebes). O pedido passa para um modelo mais capaz.",
    { motivo: { type: "string" } },
    ["motivo"],
  ),
];

/* -------------------------------------------------------------------------- */
/* Foi a pessoa que disse?                                                     */
/* -------------------------------------------------------------------------- */

/** Os campos que o modelo tende a escolher sozinho: só ficam se a pessoa os disse. */
export function precisaDeTerSidoDito(campo: Campo): boolean {
  return ["local", "prova", "balneario", "tipoEvento"].includes(campo.tipo) || campo.nome === "fim" || campo.nome === "casa";
}

/** Palavras que aparecem em quase todos os nomes do catálogo e não distinguem nada. */
const GENERICAS = new Set(["balneario", "balnearios", "campo", "estadio", "pavilhao", "complexo", "parque", "desportivo", "municipal", "sintetico", "relvado", "futebol", "futsal", "basquetebol", "sub", "escalao", "equipa", "torneio", "jogo"]);

/**
 * A pessoa disse este valor? `falado` é o texto da conversa dela, já normalizado.
 *
 * - casa/fora: disse "casa" ou "fora";
 * - hora de fim: disse essa hora (18, 18h, 18:30, ou 6 com "tarde"/"noite");
 * - catálogo: pelo menos uma palavra que distingue o nome ("Distrital" em
 *   "ZE Distrital", "1" em "Balneário 1") aparece no que ela disse.
 */
export function foiDito(campo: Campo, valor: unknown, falado: string): boolean {
  const texto = ` ${normalizar(falado)} `;
  if (campo.nome === "casa") return /\b(casa|fora)\b/.test(texto);
  if (campo.nome === "fim") {
    const hh = Number(String(valor).slice(0, 2));
    if (!Number.isFinite(hh)) return false;
    const h12 = hh > 12 ? hh - 12 : hh;
    return new RegExp(`\\b${hh}(h|:|\\b)`).test(texto) || (hh > 12 && new RegExp(`\\b${h12}\\b.{0,20}\\b(tarde|noite)\\b`).test(texto)) || /\b(acaba|termina|ate as|fim)\b/.test(texto) && new RegExp(`\\b${h12}\\b`).test(texto);
  }
  const palavrasDoValor = String(valor)
    .split(/\s*[,;]\s*/)
    .flatMap((parte) => normalizar(parte).split(" "))
    .filter((p) => p && !GENERICAS.has(p) && !["de", "da", "do", "das", "dos", "e", "o", "a"].includes(p));
  if (palavrasDoValor.length === 0) return false;
  const ditas = new Set(texto.trim().split(" "));
  return palavrasDoValor.some((p) => ditas.has(p));
}

/** As ferramentas de uma rota, pelo nome. */
export function ferramentasDe(nomes: readonly string[] | "todas"): Tool[] {
  if (nomes === "todas") return FERRAMENTAS;
  const set = new Set(nomes);
  return FERRAMENTAS.filter((f) => f.type === "function" && set.has(f.name));
}

/* -------------------------------------------------------------------------- */
/* O site, para as ações                                                       */
/* -------------------------------------------------------------------------- */

type ProdutoDaLoja = {
  id: string;
  label: string;
  doInventario: boolean;
  dto: {
    nome: string; categoria: string; categoriaId: string | null; preco: number; imagem: string; imagens: string[]; descricao: string; tamanhos: string;
    esgotado: boolean; visivel: boolean; stock: Record<string, unknown>; slug: string; precoAntes: number | null; novidade: boolean; seoTitulo: string; seoDescricao: string;
  };
};

type DadosDoSite = {
  inicio: Inicio;
  recintos: Recinto[];
  layout: string;
  publicado: boolean;
  precos: Record<string, TipoGuardado[]>;
  /** Porque é que o clube não pode vender (pagamentos ou faturação por ligar); nulo quando pode. */
  semVendas: string | null;
  produtos: ProdutoDaLoja[];
  patrocinadores: { id: string; label: string; dto: { nome: string; url: string; logo: string; vantagem: string } }[];
  categorias: string[];
  jogos: { id: string; startsAt: Date; label: string }[];
};

/** As secções visíveis da página de início, com o nome que a consola mostra. */
function seccoesDoSite(inicio: Inicio): { id: string; label: string; banner: boolean }[] {
  return inicio.seccoes.map((s) => ({ id: s.id, label: s.key === "banner" ? `Banner: ${s.banner?.titulo || "sem título"}` : (SECCOES_DO_SITE[s.key] ?? s.key), banner: s.key === "banner" }));
}

/** As secções fixas que não estão na página (escondidas). */
function seccoesEscondidas(inicio: Inicio): { id: string; label: string; banner: boolean }[] {
  const presentes = new Set(inicio.seccoes.map((s) => s.key));
  return Object.entries(SECCOES_DO_SITE)
    .filter(([key]) => !presentes.has(key as SeccaoInicio["key"]))
    .map(([key, label]) => ({ id: key, label, banner: false }));
}

/**
 * Uma coisa de uma lista, como a pessoa a disse: pelo id, pelo nome igual, ou
 * por um nome parecido. Dois parecidos é uma pergunta, não uma escolha.
 */
function escolher<T extends { id: string; label: string }>(lista: T[], dito: string, oQue: string): { ok: true; item: T } | { ok: false; erro: string } {
  const porId = lista.find((x) => x.id === dito);
  if (porId) return { ok: true, item: porId };
  const alvo = normalizar(dito);
  if (!alvo) return { ok: false, erro: `Falta dizer qual ${oQue}.` };
  const iguais = lista.filter((x) => normalizar(x.label) === alvo);
  const palavras = alvo.split(" ").filter((p) => p.length > 2);
  const parecidos = iguais.length
    ? iguais
    : lista.filter((x) => {
        const l = normalizar(x.label);
        return l.includes(alvo) || (palavras.length > 0 && palavras.every((p) => l.includes(p)));
      });
  if (parecidos.length === 1) return { ok: true, item: parecidos[0] };
  if (parecidos.length > 1) return { ok: false, erro: `Há mais do que um ${oQue} parecido com "${dito}": ${parecidos.map((x) => x.label).join("; ")}. Pergunta à pessoa qual é e volta a chamar com o id.` };
  return { ok: false, erro: `Não encontrei nenhum ${oQue} "${dito}". ${lista.length ? `Os que há: ${lista.slice(0, 12).map((x) => x.label).join("; ")}.` : `Não há nenhum ${oQue}.`}` };
}

/** Um dia (AAAA-MM-DD) e uma hora (HH:MM) no relógio do clube → o instante. Sem dia, nulo. */
function instanteDe(dia: unknown, hora: unknown, horaPorOmissao: string): Date | null {
  if (typeof dia !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const [ano, mes, d] = dia.split("-").map(Number);
  const [h, m] = (typeof hora === "string" && /^\d{2}:\d{2}$/.test(hora) ? hora : horaPorOmissao).split(":").map(Number);
  return instanteNoFuso(ano, mes, d, h, m);
}

/* -------------------------------------------------------------------------- */
/* Execução                                                                    */
/* -------------------------------------------------------------------------- */

const DIA_MS = 86_400_000;

function lerDia(s: string | null | undefined, omissao: Date): Date {
  if (!s) return omissao;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return omissao;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function quando(d: Date): string {
  return formatarNoFuso(d, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function diaIso(d: Date): string {
  const p = partesNoFuso(d);
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

/**
 * Corre as ferramentas, com a sessão de quem fala.
 *
 * Uma instância por pedido: guarda o contexto da página e o último plantel
 * lido, para a segunda chamada não ir outra vez à base.
 */
export class Executor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: RequestContext,
    private readonly contexto: Contexto,
    /** Tudo o que a pessoa escreveu ou disse nesta conversa, para confirmar que um valor veio dela. */
    private readonly falado = "",
    /** Quem gera planos de treino. Sem ele, `planear_treino` diz que não está disponível. */
    private readonly planeador?: Planeador,
  ) {}

  async executar(nome: string, args: Record<string, unknown>): Promise<ResultadoDaFerramenta> {
    switch (nome) {
      case "equipas":
        return { dados: await this.equipas() };
      case "plantel":
        return { dados: await this.plantelParaOModelo(String(args.teamId)) };
      case "treinos":
        return { dados: await this.treinos(String(args.teamId), args.de as string | null, args.ate as string | null) };
      case "jogos":
        return { dados: await this.jogos((args.teamId as string | null) ?? null, args.de as string | null, args.ate as string | null) };
      case "convocatoria":
        return { dados: await this.convocatoria(String(args.matchId)) };
      case "agenda":
        return { dados: await this.agenda((args.teamId as string | null) ?? null, args.de as string | null, args.ate as string | null) };
      case "catalogo":
        return { dados: await this.catalogo() };
      case "exercicios":
        return { dados: await this.exercicios((args.modalidade as string | null) ?? null) };
      case "propor_acao":
        return this.proporAcao(String(args.acao), (args.campos as { nome: string; valor: string | null }[]) ?? []);
      case "lesionados":
        return { dados: await this.lesionados((args.teamId as string | null) ?? null) };
      case "propor_presencas":
        return this.proporPresencas(String(args.sessionId), (args.faltas as { nome: string; tipo: string; motivo: string | null }[]) ?? []);
      case "propor_lesao":
        return this.proporLesao(args as { nome: string; teamId: string | null; descricao: string; impacto: string; data: string | null; retomaPrevista: string | null });
      case "propor_convocatoria":
        return this.proporConvocatoria(args as { matchId: string; base: string; adicionar: string[]; remover: string[] });
      case "perguntar":
        return {
          dados: { ok: true, nota: "A pergunta foi mostrada à pessoa. Termina a tua vez e espera pela resposta." },
          pergunta: { texto: String(args.texto ?? ""), opcoes: ((args.opcoes as { id: string; label: string }[]) ?? []).slice(0, 8) },
        };
      case "precisar_de_ajuda":
        return { dados: { ok: true }, subir: String(args.motivo ?? "") };
      default:
        return { dados: { erro: `Ferramenta desconhecida: ${nome}` } };
    }
  }

  /* ---- Leituras ----------------------------------------------------------- */

  private async equipas() {
    if (!can(this.ctx, "team:read")) return { erro: "Sem acesso a equipas" };
    const scope = teamScopeForRoster(this.ctx);
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      const teams = await db.team.findMany({
        where: { season: { isCurrent: true }, ...(scope ? { id: scope } : {}) },
        orderBy: [{ sport: { position: "asc" } }, { position: "asc" }, { name: "asc" }],
        select: { id: true, name: true, sport: { select: { name: true } }, _count: { select: { athletes: { where: { leftAt: null } } } } },
      });
      return teams.map((t) => ({ teamId: t.id, nome: t.name, modalidade: t.sport.name, atletas: t._count.athletes }));
    });
  }

  /** O plantel com o que o servidor precisa (ids, estado, baixa). Não sai inteiro para o modelo. */
  private async plantel(db: ScopedClient, teamId: string): Promise<AtletaDoPlantel[]> {
    const scope = teamScopeForRoster(this.ctx);
    if (scope && !scope.in.includes(teamId)) return [];
    const hoje = new Date();
    const membros = await db.teamMembership.findMany({
      where: { teamId, leftAt: null, athlete: { status: { not: "LEFT" } } },
      orderBy: [{ squadNumber: "asc" }, { athlete: { name: "asc" } }],
      select: {
        squadNumber: true,
        position: true,
        athlete: {
          select: {
            id: true,
            name: true,
            status: true,
            clinical: {
              where: { status: "DONE", impact: { not: "NONE" }, date: { lte: hoje }, OR: [{ clearedOn: null }, { clearedOn: { gt: hoje } }] },
              select: { impact: true },
            },
          },
        },
      },
    });
    return membros.map((m) => ({
      id: m.athlete.id,
      name: m.athlete.name,
      squadNumber: m.squadNumber,
      position: m.position,
      status: m.athlete.status,
      baixa: m.athlete.clinical.some((c) => c.impact === "OUT"),
      limitado: m.athlete.clinical.some((c) => c.impact === "LIMITED"),
    }));
  }

  private async plantelParaOModelo(teamId: string) {
    if (!can(this.ctx, "athlete:read")) return { erro: "Sem acesso a atletas" };
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      const p = await this.plantel(db, teamId);
      if (p.length === 0) return { erro: "Equipa sem atletas, ou fora do teu âmbito" };
      return p.map((a) => ({
        athleteId: a.id,
        nome: a.name,
        numero: a.squadNumber,
        posicao: a.position,
        indisponivel: a.baixa ? "baixa" : a.limitado ? "condicionado" : a.status === "PAUSED" ? "em pausa" : null,
      }));
    });
  }

  private async treinos(teamId: string, de: string | null, ate: string | null) {
    if (!can(this.ctx, "calendar:read") && !can(this.ctx, "attendance:read")) return { erro: "Sem acesso a treinos" };
    const scope = teamScopeFilter(this.ctx);
    if (scope && !scope.in.includes(teamId)) return { erro: "Equipa fora do teu âmbito" };
    const agora = new Date();
    const inicio = lerDia(de, new Date(agora.getTime() - 7 * DIA_MS));
    const fim = new Date(lerDia(ate, new Date(agora.getTime() + 7 * DIA_MS)).getTime() + DIA_MS);
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      const sessoes = await db.trainingSession.findMany({
        where: { teamId, startsAt: { gte: inicio, lt: fim } },
        orderBy: { startsAt: "asc" },
        take: 60,
        select: {
          id: true, startsAt: true, status: true, venue: true, attendanceClosedAt: true,
          absenceNotices: { select: { athlete: { select: { name: true } }, reason: true } },
          attendance: { select: { status: true, athlete: { select: { name: true } } } },
        },
      });
      return sessoes.map((s) => ({
        sessionId: s.id,
        quando: quando(s.startsAt),
        dia: diaIso(s.startsAt),
        local: s.venue,
        estado: s.status,
        presencasFechadas: s.attendanceClosedAt !== null,
        avisaramFalta: s.absenceNotices.map((n) => ({ nome: n.athlete.name, motivo: n.reason })),
        faltas: s.attendance.map((a) => ({ nome: a.athlete.name, estado: a.status })),
      }));
    });
  }

  private async jogos(teamId: string | null, de: string | null, ate: string | null) {
    if (!can(this.ctx, "calendar:read")) return { erro: "Sem acesso ao calendário" };
    const scope = teamScopeFilter(this.ctx);
    if (teamId && scope && !scope.in.includes(teamId)) return { erro: "Equipa fora do teu âmbito" };
    const agora = new Date();
    const inicio = lerDia(de, new Date(agora.getTime() - 14 * DIA_MS));
    const fim = new Date(lerDia(ate, new Date(agora.getTime() + 21 * DIA_MS)).getTime() + DIA_MS);
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      const jogos = await db.match.findMany({
        where: { ...(teamId ? { teamId } : scope ? { teamId: scope } : {}), startsAt: { gte: inicio, lt: fim } },
        orderBy: { startsAt: "asc" },
        take: 60,
        select: {
          id: true, teamId: true, startsAt: true, opponent: true, isHome: true, status: true, ourScore: true, theirScore: true, callUpsClosedAt: true,
          team: { select: { name: true } },
          _count: { select: { callUps: true } },
        },
      });
      return jogos.map((j) => ({
        matchId: j.id,
        teamId: j.teamId,
        equipa: j.team.name,
        quando: quando(j.startsAt),
        dia: diaIso(j.startsAt),
        adversario: j.opponent,
        casa: j.isHome,
        estado: j.status,
        resultado: j.ourScore != null && j.theirScore != null ? `${j.ourScore}-${j.theirScore}` : null,
        convocados: j._count.callUps,
        convocatoriaSubmetida: j.callUpsClosedAt !== null,
      }));
    });
  }

  private async convocatoria(matchId: string) {
    if (!can(this.ctx, "calendar:read")) return { erro: "Sem acesso ao calendário" };
    const scope = teamScopeFilter(this.ctx);
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      const jogo = await db.match.findFirst({
        where: { id: matchId, ...(scope ? { teamId: scope } : {}) },
        select: {
          id: true, opponent: true, startsAt: true, callUpsClosedAt: true,
          callUps: { select: { status: true, isGuest: true, respondedAt: true, declineReason: true, athlete: { select: { name: true } } } },
        },
      });
      if (!jogo) return { erro: "Jogo não encontrado, ou fora do teu âmbito" };
      return {
        matchId: jogo.id,
        adversario: jogo.opponent,
        quando: quando(jogo.startsAt),
        submetida: jogo.callUpsClosedAt !== null,
        convocados: jogo.callUps.map((c) => ({
          nome: c.athlete.name,
          convidado: c.isGuest,
          resposta: c.status === "DECLINED" ? `não vai${c.declineReason ? ` (${c.declineReason})` : ""}` : c.respondedAt ? "vai" : "sem resposta",
        })),
      };
    });
  }

  private async lesionados(teamId: string | null) {
    if (!can(this.ctx, "clinical:status")) return { erro: "Sem acesso à disponibilidade dos atletas" };
    const scope = teamScopeFilter(this.ctx);
    if (teamId && scope && !scope.in.includes(teamId)) return { erro: "Equipa fora do teu âmbito" };
    const hoje = new Date();
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      const entradas = await db.clinicalEntry.findMany({
        where: {
          status: "DONE",
          impact: { not: "NONE" },
          date: { lte: hoje },
          OR: [{ clearedOn: null }, { clearedOn: { gt: hoje } }],
          athlete: { teams: { some: { leftAt: null, ...(teamId ? { teamId } : scope ? { teamId: scope } : {}) } } },
        },
        orderBy: { date: "desc" },
        take: 80,
        select: { impact: true, date: true, expectedReturn: true, athlete: { select: { name: true, teams: { where: { leftAt: null }, select: { team: { select: { name: true } } }, take: 1 } } } },
      });
      return entradas.map((e) => ({
        nome: e.athlete.name,
        equipa: e.athlete.teams[0]?.team.name ?? null,
        situacao: e.impact === "OUT" ? "de baixa" : "trabalho condicionado",
        desde: diaIso(e.date),
        retomaPrevista: e.expectedReturn ? diaIso(e.expectedReturn) : null,
      }));
    });
  }

  private async agenda(teamId: string | null, de: string | null, ate: string | null) {
    if (!can(this.ctx, "calendar:read")) return { erro: "Sem acesso ao calendário" };
    const scope = teamScopeFilter(this.ctx);
    if (teamId && scope && !scope.in.includes(teamId)) return { erro: "Equipa fora do teu âmbito" };
    const agora = new Date();
    const inicio = lerDia(de, new Date(agora.getTime() - 0));
    const fim = new Date(lerDia(ate, new Date(agora.getTime() + 14 * DIA_MS)).getTime() + DIA_MS);
    const porEquipa = teamId ? { teamId } : scope ? { teamId: scope } : {};
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      const [treinos, jogos, eventos] = await Promise.all([
        db.trainingSession.findMany({ where: { ...porEquipa, startsAt: { gte: inicio, lt: fim } }, orderBy: { startsAt: "asc" }, take: 80, select: { id: true, startsAt: true, endsAt: true, venue: true, status: true, team: { select: { name: true } } } }),
        db.match.findMany({ where: { ...porEquipa, startsAt: { gte: inicio, lt: fim } }, orderBy: { startsAt: "asc" }, take: 80, select: { id: true, startsAt: true, venue: true, opponent: true, isHome: true, status: true, team: { select: { name: true } } } }),
        db.calendarEvent.findMany({
          where: { startsAt: { gte: inicio, lt: fim }, ...(teamId ? { teamId } : scope ? { OR: [{ teamId: scope }, { teamId: null }] } : {}) },
          orderBy: { startsAt: "asc" },
          take: 80,
          select: { id: true, startsAt: true, endsAt: true, venue: true, title: true, kind: true, cancelled: true, team: { select: { name: true } } },
        }),
      ]);
      return [
        ...treinos.map((t) => ({ tipo: "treino", id: t.id, equipa: t.team.name, quando: quando(t.startsAt), dia: diaIso(t.startsAt), local: t.venue, desmarcado: t.status === "CANCELLED" })),
        ...jogos.map((j) => ({ tipo: "jogo", id: j.id, equipa: j.team.name, quando: quando(j.startsAt), dia: diaIso(j.startsAt), local: j.venue, adversario: j.opponent, casa: j.isHome, desmarcado: j.status === "CANCELLED" })),
        ...eventos.map((e) => ({ tipo: "evento", id: e.id, equipa: e.team?.name ?? "clube todo", quando: quando(e.startsAt), dia: diaIso(e.startsAt), local: e.venue, titulo: e.title, desmarcado: e.cancelled })),
      ].sort((a, b) => a.dia.localeCompare(b.dia) || a.quando.localeCompare(b.quando));
    });
  }

  private async catalogo() {
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      const itens = await db.catalogItem.findMany({
        where: { archivedAt: null, kind: { in: ["venues", "dressingRooms", "competitions", "eventTypes"] } },
        orderBy: [{ kind: "asc" }, { order: "asc" }, { label: "asc" }],
        select: { kind: true, label: true, sport: { select: { name: true } } },
      });
      const por = (k: string) => itens.filter((i) => i.kind === k).map((i) => (i.sport ? `${i.label} (${i.sport.name})` : i.label));
      return { locais: por("venues"), balnearios: por("dressingRooms"), provas: por("competitions"), tiposDeEvento: por("eventTypes") };
    });
  }

  /* ---- Ações da consola ----------------------------------------------------- */

  /**
   * Uma ação do registo (`acoes.ts`), a partir dos campos que o modelo mandou.
   *
   * O que falta pergunta-se; o que está mal diz-se; o que resolve pelo nome
   * (equipa, local, prova) resolve-se aqui. Só depois nasce a proposta.
   */
  /**
   * ## A regra: nada se assume
   *
   * Todos os campos da ação têm de ter sido **respondidos**: com um valor, ou
   * com "-" (a pessoa disse que não quer ou não se aplica). Um campo que
   * ninguém perguntou não ganha um valor por omissão em silêncio: em vez da
   * proposta, sai um **formulário** com todos os campos, o que a pessoa já disse
   * preenchido e o que falta à vista (com sugestões, nunca escolhidas por ela).
   * A pessoa preenche e envia (`doFormulario`), ou responde por voz e o modelo
   * volta a chamar com mais campos.
   *
   * `doFormulario`: os campos vieram do formulário, que a pessoa viu inteiro.
   * Aí um opcional vazio é uma resposta ("não"), e só os obrigatórios travam.
   */
  async proporAcao(nome: string, campos: { nome: string; valor: string | null }[], opcoes: { doFormulario?: boolean } = {}): Promise<ResultadoDaFerramenta> {
    const acao = ACOES[nome];
    if (!acao) return { dados: { erro: `Não há nenhuma ação "${nome}"` } };
    /*
     * As permissões são as da pessoa que fala, as mesmas que a consola lhe pede
     * para o mesmo gesto: o Adjunto não faz por ela o que ela não pode fazer à
     * mão. Volta-se a verificar ao confirmar (`PropostasService.confirmar`), e
     * os serviços verificam outra vez. Tudo corre no clube da sessão (`runAs`):
     * um id de outro clube não existe para esta pessoa.
     */
    if (!podeFazer(acao, (p) => can(this.ctx, p))) return { dados: { erro: `Esta pessoa não tem permissão para ${acao.rotulo.toLowerCase()}. Diz-lhe que é preciso pedir à direção.` } };
    if (acao.precisaDoSite && !(await this.prisma.runAs(this.ctx.academyId, (db) => siteIncluido(db, this.ctx.academyId)))) {
      return { dados: { erro: "O clube não tem o site no plano (Connect Pro), por isso não há site onde mexer. Diz à pessoa que o site se liga no plano do clube; não há nada a fazer aqui." } };
    }

    // 1. Ler cada campo como o seu tipo manda.
    const dados: Record<string, unknown> = {};
    const erros: string[] = [];
    const mandados = new Map(campos.map((c) => [c.nome, c.valor]));
    /*
     * Os opcionais com uma resposta óbvia (`omissao`) não travam a proposta:
     * sem nada dito, ficam com o valor por omissão, que o cartão mostra e o
     * "Editar" muda. Uma notícia com título, texto e categoria vai logo ao
     * cartão, em vez de um formulário só para perguntar "em destaque?".
     */
    for (const campo of acao.campos) {
      if (campo.omissao !== undefined && !respondido(mandados.get(campo.nome))) mandados.set(campo.nome, campo.omissao);
    }
    for (const campo of acao.campos) {
      const r = lerValor(campo, mandados.get(campo.nome));
      if (!r.ok) erros.push(r.erro);
      else if (r.valor !== undefined) dados[campo.nome] = r.valor;
    }

    /*
     * O modelo não decide pela pessoa.
     *
     * As instruções dizem-lhe para não assumir, e mesmo assim às vezes manda o
     * primeiro balneário, a primeira prova ou uma hora de fim inventada. Aqui
     * confirma-se: um valor de catálogo (local, prova, balneário, tipo), a hora
     * de fim e o casa/fora só ficam se a pessoa os disse nalgum momento da
     * conversa. Os outros voltam a ficar por responder, e o formulário pergunta.
     */
    const ignorados: string[] = [];
    if (!opcoes.doFormulario) {
      for (const campo of acao.campos) {
        if (dados[campo.nome] === undefined || !precisaDeTerSidoDito(campo)) continue;
        if (!foiDito(campo, dados[campo.nome], this.falado)) {
          delete dados[campo.nome];
          mandados.set(campo.nome, null);
          ignorados.push(campo.rotulo);
        }
      }
    }

    // Um campo que não se aplica (balneários de um jogo fora) não conta nem se pergunta.
    for (const c of acao.campos) if (!aplicaSe(c, dados)) delete dados[c.nome];

    // "O treino de amanhã dos sub-11": a equipa e o dia chegam para encontrar o treino.
    if (nome === "planear_treino" && dados.treino === undefined && dados.equipa && dados.dia) {
      const r = await this.treinoDoDia(String(dados.equipa), String(dados.dia));
      if (r.erro) erros.push(r.erro);
      else if (r.sessionId) {
        dados.treino = r.sessionId;
        mandados.set("treino", r.sessionId);
      }
    }

    // 2. O que ainda não foi respondido. Desmarcar e reativar só precisam do id.
    const porResponder = acao.campos.filter((c) => {
      if (!aplicaSe(c, dados) && (c.soSe ? dados[c.soSe.campo] !== undefined : true)) return false;
      if (dados[c.nome] !== undefined) return false;
      if (c.obrigatorio) return true;
      return !opcoes.doFormulario && !respondido(mandados.get(c.nome));
    });
    if (nome === "inscrever_atleta" && !dados.nif && !dados.numero_documento && !porResponder.some((c) => c.nome === "nif")) {
      porResponder.push(acao.campos.find((c) => c.nome === "nif")!);
    }
    if (opcoes.doFormulario) {
      const obrigatorios = porResponder.filter((c) => c.obrigatorio || (nome === "inscrever_atleta" && c.nome === "nif"));
      if (erros.length || obrigatorios.length) {
        return { dados: { erro: [...erros, ...obrigatorios.map((c) => (c.nome === "nif" && nome === "inscrever_atleta" ? "Falta o NIF ou outro documento" : `Falta: ${c.rotulo}`))].join("; ") } };
      }
    } else if (porResponder.length || erros.length) {
      const r = await this.formulario(acao, dados, mandados, porResponder, erros);
      if (ignorados.length) (r.dados as Record<string, unknown>).ignorei = `Ignorei ${ignorados.join(", ")}: a pessoa não os disse. Não voltes a mandar valores que ela não disse.`;
      return r;
    }

    try {
      let r: ResultadoDaFerramenta | null = null;
      switch (acao.kind) {
        case "EVENT":
          r = nome === "desmarcar" || nome === "reativar" ? await this.proporDesmarcar(nome, String(dados.id)) : await this.proporMarcar(nome, dados);
          break;
        case "ATHLETE":
          r = await this.proporAtleta(dados);
          break;
        case "ANNOUNCEMENT":
          r = await this.proporComunicado(dados);
          break;
        case "TRAINING_PLAN":
          r = await this.proporPlano(dados);
          break;
        case "EXERCISE":
          r = await this.proporExercicio(dados);
          break;
        case "SITE_NEWS":
          r = await this.proporNoticia(dados);
          break;
        case "SITE":
          r = await this.proporSite(acao, dados);
          break;
      }
      /*
       * Os valores com que a proposta nasceu ficam com ela: é com eles que o
       * "Editar" do cartão reabre o formulário preenchido.
       */
      if (r?.proposta) {
        const valores = Object.fromEntries(
          acao.campos.map((c) => {
            const v = dados[c.nome];
            return [c.nome, v === undefined ? "" : typeof v === "boolean" ? (v ? "sim" : "não") : String(v)];
          }),
        );
        r.proposta.edicao = { acao: nome, valores };
      }
      if (r) return r;
    } catch (e) {
      return { dados: { erro: (e as Error).message ?? "Não deu para preparar esta ação" } };
    }
    return { dados: { erro: "Ação sem tratamento" } };
  }

  /** O formulário de uma proposta já feita, preenchido com os valores dela, para a editar no cartão. */
  async formularioDeEdicao(nome: string, valores: Record<string, string>): Promise<Formulario | null> {
    const acao = ACOES[nome];
    if (!acao) return null;
    const dados: Record<string, unknown> = {};
    const mandados = new Map<string, string | null>();
    for (const campo of acao.campos) {
      const bruto = valores[campo.nome] ?? "";
      mandados.set(campo.nome, bruto);
      const r = lerValor(campo, bruto);
      if (r.ok && r.valor !== undefined) dados[campo.nome] = r.valor;
    }
    const r = await this.formulario(acao, dados, mandados, [], []);
    return r.formulario ?? null;
  }

  /**
   * O formulário de uma ação: todos os campos, com o que já se sabe e com as
   * escolhas que o clube tem (equipas, locais, balneários, provas, tipos).
   * As sugestões (o local do horário da equipa, a hora de fim) vêm marcadas
   * como sugestão, e só ficam se a pessoa as deixar.
   */
  private async formulario(acao: Acao, dados: Record<string, unknown>, mandados: Map<string, string | null>, porResponder: Campo[], erros: string[]): Promise<ResultadoDaFerramenta> {
    const escolhas = await this.prisma.runAs(this.ctx.academyId, async (db) => {
      const scope = teamScopeForRoster(this.ctx);
      const precisaDeStaff = acao.campos.some((c) => c.tipo === "staff");
      const precisaDeTreinos = acao.campos.some((c) => c.tipo === "treino");
      const precisaDoSite = acao.campos.some((c) => ["jogo", "seccao", "banner", "produto", "patrocinador", "recinto"].includes(c.tipo) || (acao.nome === "criar_produto_na_loja" && c.nome === "categoria"));
      const agora = new Date();
      const site = precisaDoSite ? await this.dadosDoSite(db) : null;
      const [equipas, catalogo, staff, treinos] = await Promise.all([
        db.team.findMany({
          where: { season: { isCurrent: true }, ...(scope ? { id: scope } : {}) },
          orderBy: [{ sport: { position: "asc" } }, { position: "asc" }, { name: "asc" }],
          select: { id: true, name: true, sportId: true, schedule: true, sport: { select: { name: true } }, competitions: { select: { competition: { select: { label: true, archivedAt: true } } } } },
        }),
        db.catalogItem.findMany({
          where: { archivedAt: null, kind: { in: ["venues", "dressingRooms", "competitions", "eventTypes"] } },
          orderBy: [{ order: "asc" }, { label: "asc" }],
          select: { kind: true, label: true, sportId: true },
        }),
        precisaDeStaff
          ? db.membership.findMany({ where: { isActive: true, role: { notIn: ["GUARDIAN", "ATHLETE"] } }, orderBy: { user: { name: "asc" } }, select: { user: { select: { name: true } } } })
          : Promise.resolve([] as { user: { name: string } }[]),
        // Os próximos treinos (de hoje a daqui a 21 dias) das equipas que a pessoa vê: a escolha do campo "treino".
        precisaDeTreinos
          ? db.trainingSession.findMany({
              where: { ...(scope ? { teamId: scope } : {}), status: { not: "CANCELLED" }, startsAt: { gte: new Date(agora.getTime() - 3 * 3_600_000), lt: new Date(agora.getTime() + 21 * DIA_MS) } },
              orderBy: { startsAt: "asc" },
              take: 60,
              select: { id: true, teamId: true, startsAt: true, venue: true, team: { select: { name: true } } },
            })
          : Promise.resolve([] as { id: string; teamId: string; startsAt: Date; venue: string; team: { name: string } }[]),
      ]);
      return { equipas, catalogo, staff, treinos, site };
    });

    // A equipa já dita estreita as provas (as da modalidade) e sugere o local do horário.
    const equipaDita = dados.equipa ? escolhas.equipas.find((e) => e.id === dados.equipa || normalizar(e.name) === normalizar(String(dados.equipa))) : undefined;
    const doCatalogo = (kind: string) =>
      escolhas.catalogo.filter((i) => i.kind === kind && (!equipaDita || !i.sportId || i.sportId === equipaDita.sportId)).map((i) => ({ valor: i.label, label: i.label }));
    const horario = Array.isArray(equipaDita?.schedule) ? (equipaDita!.schedule as { venue?: string }[]).find((h) => h.venue)?.venue : undefined;
    const provasDaEquipa = (equipaDita?.competitions ?? []).filter((x) => !x.competition.archivedAt).map((x) => ({ valor: x.competition.label, label: x.competition.label }));

    const campos: CampoDoFormulario[] = acao.campos.map((c) => {
      const dado = dados[c.nome];
      const bruto = mandados.get(c.nome);
      // O formulário fala a língua dos botões: um booleano é "sim" ou "não".
      const valor = dado === undefined || bruto === RECUSADO ? "" : typeof dado === "boolean" ? (dado ? "sim" : "não") : String(dado);
      let sugestao: string | undefined;
      if (c.nome === "fim" && dados.inicio) sugestao = somarMinutos(String(dados.inicio), acao.nome === "marcar_treino" ? 90 : 120);
      if (c.tipo === "local" && horario) sugestao = horario;
      if (c.tipo === "booleano" && c.nome === "casa") sugestao = "sim";
      const opcoesDoCampo =
        c.tipo === "equipa" || c.tipo === "equipas" ? escolhas.equipas.map((e) => ({ valor: e.name, label: escolhas.equipas.filter((x) => x.name === e.name).length > 1 ? `${e.name} (${e.sport.name})` : e.name }))
        : c.tipo === "local" ? doCatalogo("venues")
        : c.tipo === "balneario" ? doCatalogo("dressingRooms")
        // As provas que a equipa disputa, como no "Novo evento"; sem equipa ou sem provas ligadas, as do catálogo.
        : c.tipo === "prova" ? (provasDaEquipa.length ? provasDaEquipa : doCatalogo("competitions"))
        : c.tipo === "tipoEvento" ? doCatalogo("eventTypes")
        : c.tipo === "staff" ? escolhas.staff.map((m) => ({ valor: m.user.name, label: m.user.name }))
        // Os treinos da equipa dita (ou de todas), e primeiro os do dia dito.
        : c.tipo === "treino"
          ? escolhas.treinos
              .filter((t) => !equipaDita || t.teamId === equipaDita.id)
              .sort((a, b) => (dados.dia ? Number(diaIso(b.startsAt) === dados.dia) - Number(diaIso(a.startsAt) === dados.dia) : 0) || a.startsAt.getTime() - b.startsAt.getTime())
              .map((t) => ({ valor: t.id, label: `${quando(t.startsAt)} · ${t.team.name}${t.venue ? ` · ${t.venue}` : ""}` }))
        : c.tipo === "escolha" ? c.opcoes
        : c.tipo === "seccao" && escolhas.site ? [...seccoesDoSite(escolhas.site.inicio).map((s) => ({ valor: s.id, label: s.label })), ...seccoesEscondidas(escolhas.site.inicio).map((s) => ({ valor: s.id, label: `${s.label} (escondida)` }))]
        : c.tipo === "banner" && escolhas.site ? seccoesDoSite(escolhas.site.inicio).filter((s) => s.banner).map((s) => ({ valor: s.id, label: s.label }))
        : c.tipo === "produto" && escolhas.site ? escolhas.site.produtos.map((p) => ({ valor: p.id, label: p.label }))
        : c.tipo === "patrocinador" && escolhas.site ? escolhas.site.patrocinadores.map((p) => ({ valor: p.id, label: p.label }))
        : c.tipo === "recinto" && escolhas.site ? escolhas.site.recintos.map((r) => ({ valor: r.id, label: r.nome }))
        : c.tipo === "jogo" && escolhas.site ? escolhas.site.jogos.map((j) => ({ valor: j.id, label: j.label }))
        : acao.nome === "criar_produto_na_loja" && c.nome === "categoria" && escolhas.site ? escolhas.site.categorias.map((n) => ({ valor: n, label: n }))
        : undefined;
      return {
        nome: c.nome,
        rotulo: c.rotulo,
        tipo: c.tipo,
        obrigatorio: c.obrigatorio || (acao.nome === "inscrever_atleta" && c.nome === "nif" && !dados.numero_documento),
        valor,
        ...(sugestao && !valor ? { sugestao } : {}),
        ...(opcoesDoCampo ? { opcoes: opcoesDoCampo } : {}),
        multiplo: c.tipo === "balneario" || c.tipo === "equipas",
        livre: c.tipo === "local" || c.tipo === "texto" || c.tipo === "textoLongo",
        // Um recinto, um produto, um jogo: só o que existe. A consola desenha um menu.
        ...(opcoesDoCampo && ["seccao", "banner", "produto", "patrocinador", "recinto", "jogo"].includes(c.tipo) ? { livre: false } : {}),
        ...(c.descricao ? { descricao: c.descricao } : {}),
        ...(c.soSe ? { soSe: c.soSe } : {}),
        emFalta: porResponder.some((p) => p.nome === c.nome),
      };
    });

    const faltamObrigatorios = porResponder.filter((c) => c.obrigatorio).map((c) => c.rotulo.toLowerCase());
    const faltamOpcionais = porResponder.filter((c) => !c.obrigatorio).map((c) => c.rotulo.toLowerCase());
    return {
      dados: {
        formulario: true,
        acao: acao.nome,
        jaTenho: Object.fromEntries(Object.entries(dados).map(([k, v]) => [k, v])),
        faltamObrigatorios,
        faltamOpcionais,
        erros,
        nota:
          "Foi mostrado à pessoa um formulário com todos os campos. Escreve agora uma pergunta curta e natural sobre o PRIMEIRO campo obrigatório em falta, com o contexto do pedido (ex.: 'Para que equipa é o jogo contra os Amigos de Quinchães, sábado às 16:00?'). Não listes as opções nem os outros campos; se não faltar nenhum obrigatório, pergunta pelo primeiro opcional. Não chames mais ferramentas nesta vez. Quando a pessoa responder, volta a chamar propor_acao com TODOS os campos que já sabes mais o novo; para um campo que a pessoa recuse ou diga que não se aplica, manda '-'.",
      },
      formulario: { acao: acao.nome, titulo: acao.rotulo, campos },
    };
  }

  private async equipaPorNome(db: ScopedClient, dito: string): Promise<{ ok: true; equipa: { id: string; name: string; sportId: string; schedule: unknown } } | { ok: false; resultado: ResultadoDaFerramenta }> {
    const scope = teamScopeForRoster(this.ctx);
    const equipas = await db.team.findMany({
      where: { season: { isCurrent: true }, ...(scope ? { id: scope } : {}) },
      select: { id: true, name: true, sportId: true, schedule: true, sport: { select: { name: true } } },
    });
    const porId = equipas.find((e) => e.id === dito);
    if (porId) return { ok: true, equipa: porId };
    const alvo = normalizar(dito);
    const iguais = equipas.filter((e) => normalizar(e.name) === alvo);
    const parecidas = iguais.length ? iguais : equipas.filter((e) => normalizar(e.name).includes(alvo) || alvo.includes(normalizar(e.name)));
    if (parecidas.length === 1) return { ok: true, equipa: parecidas[0] };
    if (parecidas.length > 1) {
      return {
        ok: false,
        resultado: {
          dados: { pergunta: `Há mais do que uma equipa parecida com "${dito}"; a pessoa vai escolher.` },
          pergunta: { texto: `Qual é a equipa?`, opcoes: parecidas.slice(0, 8).map((e) => ({ id: e.name, label: `${e.name} (${e.sport.name})` })), campo: "equipa" },
        },
      };
    }
    return { ok: false, resultado: { dados: { erro: `Não encontrei a equipa "${dito}". As que esta pessoa vê: ${equipas.map((e) => e.name).join(", ") || "nenhuma"}.` } } };
  }

  private async localResolvido(db: ScopedClient, dito: string | undefined, equipa: { schedule: unknown } | null): Promise<{ ok: true; local: string } | { ok: false; resultado: ResultadoDaFerramenta }> {
    const locais = (await db.catalogItem.findMany({ where: { kind: "venues", archivedAt: null }, orderBy: [{ order: "asc" }, { label: "asc" }], select: { label: true } })).map((l) => l.label);
    if (dito) {
      const alvo = normalizar(dito);
      const certo = locais.find((l) => normalizar(l) === alvo) ?? locais.find((l) => normalizar(l).includes(alvo) || alvo.includes(normalizar(l)));
      if (certo) return { ok: true, local: certo };
      // Um local que não está no catálogo aceita-se tal como foi dito: o calendário também o aceita.
      return { ok: true, local: dito.slice(0, 80) };
    }
    const horario = Array.isArray(equipa?.schedule) ? (equipa!.schedule as { venue?: string }[]).find((h) => h.venue)?.venue : undefined;
    if (horario) return { ok: true, local: horario };
    if (locais.length === 1) return { ok: true, local: locais[0] };
    if (locais.length === 0) return { ok: false, resultado: { dados: { erro: "O clube não tem locais no catálogo e não foi dito nenhum. Pergunta o local à pessoa." } } };
    return {
      ok: false,
      resultado: { dados: { pergunta: "Falta o local; a pessoa vai escolher." }, pergunta: { texto: "Em que local?", opcoes: locais.slice(0, 8).map((l) => ({ id: l, label: l })), campo: "local" } },
    };
  }

  private async proporMarcar(nome: string, d: Record<string, unknown>): Promise<ResultadoDaFerramenta> {
    const scope = teamScopeFilter(this.ctx);
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      let equipa: { id: string; name: string; sportId: string; schedule: unknown } | null = null;
      if (d.equipa) {
        const r = await this.equipaPorNome(db, String(d.equipa));
        if (!r.ok) return r.resultado;
        equipa = r.equipa;
      } else if (scope) {
        return { dados: { erro: "Um evento sem equipa é para o clube todo, e só a direção o marca. Diz a equipa." } };
      }
      const local = await this.localResolvido(db, d.local as string | undefined, equipa);
      if (!local.ok) return local.resultado;

      const dia = String(d.dia);
      const inicio = String(d.inicio);
      const fim = (d.fim as string | undefined) ?? somarMinutos(inicio, nome === "marcar_treino" ? 90 : 120);
      const [ano, mes, diaN] = dia.split("-").map(Number);
      const [hi, mi] = inicio.split(":").map(Number);
      const [hf, mf] = fim.split(":").map(Number);
      const startsAt = instanteNoFuso(ano, mes, diaN, hi, mi);
      const endsAt = instanteNoFuso(ano, mes, diaN, hf, mf);
      if (endsAt <= startsAt) return { dados: { erro: "A hora de fim tem de ser depois da de início" } };
      if (startsAt.getTime() < Date.now() - DIA_MS) return { dados: { erro: `${dia} já passou. Confirma a data com a pessoa.` } };

      const kind = nome === "marcar_treino" ? "TRAINING" : nome === "marcar_jogo" ? "MATCH" : "OTHER";
      let competitionId: string | undefined;
      let prova: string | null = null;
      if (kind === "MATCH") {
        // As provas que a equipa disputa, como no "Novo evento"; uma equipa sem provas ligadas usa as do catálogo da modalidade.
        const daEquipa = await db.teamCompetition.findMany({ where: { teamId: equipa!.id, competition: { archivedAt: null } }, select: { competition: { select: { id: true, label: true } } } });
        const provas = daEquipa.length
          ? daEquipa.map((x) => x.competition)
          : await db.catalogItem.findMany({ where: { kind: "competitions", archivedAt: null, OR: [{ sportId: null }, { sportId: equipa!.sportId }] }, select: { id: true, label: true } });
        const dita = normalizar(String(d.prova ?? ""));
        const escolhida = provas.find((p) => normalizar(p.label) === dita) ?? provas.find((p) => normalizar(p.label).includes(dita));
        if (!escolhida) return { dados: { erro: `O ${equipa!.name} não disputa nenhuma prova "${String(d.prova ?? "")}". As dele: ${provas.map((p) => p.label).join(", ")}.` } };
        competitionId = escolhida.id;
        prova = escolhida.label;
      }

      // Quem dá o treino: uma pessoa do staff pelo nome; vazio é o treinador principal.
      let coachId: string | undefined;
      let treinador: string | null = null;
      if (kind === "TRAINING" && d.treinador) {
        const staff = await db.membership.findMany({ where: { isActive: true, role: { notIn: ["GUARDIAN", "ATHLETE"] } }, select: { id: true, user: { select: { name: true } } } });
        const r = resolverNome(String(d.treinador), staff.map((m) => ({ id: m.id, name: m.user.name })));
        if (r.tipo === "ambiguo") return { dados: { pergunta: "Há mais do que uma pessoa com esse nome no staff." }, pergunta: { texto: "Quem dá o treino?", opcoes: r.opcoes.slice(0, 6).map((o) => ({ id: o.name, label: o.name })), campo: "treinador" } };
        if (r.tipo === "nenhum") return { dados: { erro: `Não encontrei "${String(d.treinador)}" no staff do clube.` } };
        coachId = r.pessoa.id;
        treinador = r.pessoa.name;
      }

      // Os balneários: nomes do catálogo, um ou vários. Um que não existe não se inventa.
      const balnearios: string[] = [];
      // Num jogo fora não há balneário nosso: é o que o adversário der.
      if (d.balnearios && !(kind === "MATCH" && d.casa === false)) {
        const doCatalogo = (await db.catalogItem.findMany({ where: { kind: "dressingRooms", archivedAt: null }, select: { label: true } })).map((b) => b.label);
        for (const dito of String(d.balnearios).split(/\s*[,;]\s*|\s+e\s+/).map((s) => s.trim()).filter(Boolean)) {
          const certo = doCatalogo.find((b) => normalizar(b) === normalizar(dito)) ?? doCatalogo.find((b) => normalizar(b).includes(normalizar(dito)));
          if (!certo) return { dados: { erro: `Não há nenhum balneário "${dito}" no catálogo. Os que existem: ${doCatalogo.join(", ") || "nenhum"}.` } };
          if (!balnearios.includes(certo)) balnearios.push(certo);
        }
      }

      // O tipo do evento, do catálogo.
      let typeId: string | undefined;
      let tipoLabel: string | null = null;
      if (kind === "OTHER" && d.tipo) {
        const tipos = await db.catalogItem.findMany({ where: { kind: "eventTypes", archivedAt: null }, select: { id: true, label: true } });
        const t = tipos.find((x) => normalizar(x.label) === normalizar(String(d.tipo))) ?? tipos.find((x) => normalizar(x.label).includes(normalizar(String(d.tipo))));
        if (!t) return { dados: { erro: `Não há nenhum tipo de evento "${String(d.tipo)}". Os que existem: ${tipos.map((x) => x.label).join(", ") || "nenhum"}.` } };
        typeId = t.id;
        tipoLabel = t.label;
      }
      const repeat = d.repetir_ate ? { freq: "WEEKLY" as const, until: String(d.repetir_ate), weekdays: lerDiasDaSemana(d.dias_da_semana as string | undefined) } : undefined;

      // O que já está marcado à mesma hora, para a pessoa saber antes de confirmar.
      const avisos: string[] = [];
      if (equipa) {
        const [t, j, e] = await Promise.all([
          db.trainingSession.count({ where: { teamId: equipa.id, status: { not: "CANCELLED" }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } }),
          db.match.count({ where: { teamId: equipa.id, status: { not: "CANCELLED" }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } }),
          db.calendarEvent.count({ where: { teamId: equipa.id, cancelled: false, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } }),
        ]);
        if (t + j + e > 0) avisos.push(`O ${equipa.name} já tem ${t + j + e === 1 ? "algo marcado" : "coisas marcadas"} a essa hora; ao confirmar, o calendário recusa o choque.`);
      }
      // Horas que quase de certeza estão erradas: o cartão diz, a pessoa confirma ou edita.
      if (hi < 7 || hi >= 23) avisos.push(`Começa às ${inicio}. Confirma a hora: é invulgar para um ${kind === "MATCH" ? "jogo" : kind === "TRAINING" ? "treino" : "evento"}.`);
      const duracao = (endsAt.getTime() - startsAt.getTime()) / 60_000;
      if (duracao > 4 * 60) avisos.push(`Dura ${Math.floor(duracao / 60)}h${String(duracao % 60).padStart(2, "0")} (das ${inicio} às ${fim}). Confirma a hora de fim.`);

      // A equipa da casa primeiro, como na consola (`matchTitle`): em casa "Sub-11 vs Quinchães", fora "Quinchães vs Sub-11".
      const titulo = kind === "TRAINING" ? `Treino · ${equipa!.name}` : kind === "MATCH" ? (d.casa === false ? `${String(d.adversario)} vs ${equipa!.name}` : `${equipa!.name} vs ${String(d.adversario)}`) : String(d.titulo);
      const dto = {
        kind,
        teamId: equipa?.id,
        title: titulo.slice(0, 120),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        venue: local.local,
        ...(balnearios.length ? { dressingRooms: balnearios } : {}),
        ...(kind === "MATCH" ? { opponent: String(d.adversario).slice(0, 80), isHome: d.casa !== false, competitionId } : {}),
        ...(kind === "OTHER" && d.publico === true ? { isPublic: true } : {}),
        ...(kind === "TRAINING" ? { respondBy: d.quem_avisa === "ATHLETE" ? "ATHLETE" : "GUARDIAN", ...(coachId ? { coachId } : {}) } : {}),
        ...(typeId ? { typeId } : {}),
        ...(repeat ? { repeat } : {}),
      };
      const rotulo = kind === "TRAINING" ? "Treino" : kind === "MATCH" ? "Jogo" : "Evento";
      const linhas = [
        ...(equipa ? [{ rotulo: "Equipa", valor: equipa.name }] : [{ rotulo: "Equipa", valor: "Clube todo" }]),
        { rotulo: "Quando", valor: `${quando(startsAt)} até ${formatarNoFuso(endsAt, { hour: "2-digit", minute: "2-digit" })}` },
        { rotulo: "Local", valor: local.local },
        ...(kind === "MATCH" && d.casa === false ? [] : [{ rotulo: "Balneários", valor: balnearios.length ? balnearios.join(", ") : "nenhum" }]),
        ...(kind === "TRAINING"
          ? [
              { rotulo: "Quem dá", valor: treinador ?? "o treinador principal" },
              { rotulo: "Avisa as faltas", valor: d.quem_avisa === "ATHLETE" ? "o próprio atleta" : "o encarregado" },
            ]
          : []),
        ...(kind === "MATCH" ? [{ rotulo: "Adversário", valor: `${String(d.adversario)} (${d.casa === false ? "fora" : "em casa"})` }, { rotulo: "Prova", valor: prova ?? "sem prova" }] : []),
        ...(kind === "OTHER" ? [{ rotulo: "Título", valor: String(d.titulo) }, ...(tipoLabel ? [{ rotulo: "Tipo", valor: tipoLabel }] : [])] : []),
        ...(repeat ? [{ rotulo: "Repete", valor: `todas as semanas até ${repeat.until}${repeat.weekdays ? ` (${repeat.weekdays.join(", ")})` : ""}` }] : []),
      ];
      const proposta: PropostaNova = {
        kind: "EVENT",
        title: `${rotulo} · ${equipa?.name ?? "Clube"} · ${quando(startsAt)}`,
        summary: kind === "MATCH" ? `vs ${String(d.adversario)}, ${local.local}` : `${titulo}, ${local.local}`,
        payload: { acao: "criar", dto },
        view: { rotulo, linhas, avisos },
      };
      return { dados: { ok: true, proposta: { rotulo, linhas, avisos, nota: "A pessoa vê o cartão e confirma. Não digas que ficou marcado." } }, proposta };
    });
  }

  private async proporDesmarcar(nome: "desmarcar" | "reativar", id: string): Promise<ResultadoDaFerramenta> {
    const scope = teamScopeFilter(this.ctx);
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      const [t, j, e] = await Promise.all([
        db.trainingSession.findFirst({ where: { id }, select: { teamId: true, startsAt: true, status: true, attendanceClosedAt: true, team: { select: { name: true } } } }),
        db.match.findFirst({ where: { id }, select: { teamId: true, startsAt: true, status: true, opponent: true, team: { select: { name: true } } } }),
        db.calendarEvent.findFirst({ where: { id }, select: { teamId: true, startsAt: true, cancelled: true, title: true, team: { select: { name: true } } } }),
      ]);
      const alvo = t
        ? { teamId: t.teamId, quando: quando(t.startsAt), descricao: `Treino do ${t.team.name}`, desmarcado: t.status === "CANCELLED", bloqueio: t.attendanceClosedAt ? "Um treino com presenças registadas não se desmarca" : t.status === "DONE" ? "Este treino já aconteceu" : null }
        : j
          ? { teamId: j.teamId, quando: quando(j.startsAt), descricao: `Jogo do ${j.team.name} vs ${j.opponent}`, desmarcado: j.status === "CANCELLED", bloqueio: j.status === "PLAYED" ? "Este jogo já foi disputado" : null }
          : e
            ? { teamId: e.teamId, quando: quando(e.startsAt), descricao: `${e.title}${e.team ? ` (${e.team.name})` : ""}`, desmarcado: e.cancelled, bloqueio: null }
            : null;
      if (!alvo) return { dados: { erro: "Não encontrei nenhum treino, jogo ou evento com esse id. Usa a ferramenta agenda para o encontrar." } };
      if (scope && alvo.teamId && !scope.in.includes(alvo.teamId)) return { dados: { erro: "Esse evento é de uma equipa fora do teu âmbito" } };
      if (alvo.bloqueio) return { dados: { erro: alvo.bloqueio } };
      if (nome === "desmarcar" && alvo.desmarcado) return { dados: { erro: "Já está desmarcado" } };
      if (nome === "reativar" && !alvo.desmarcado) return { dados: { erro: "Não está desmarcado" } };
      const proposta: PropostaNova = {
        kind: "EVENT",
        title: `${nome === "desmarcar" ? "Desmarcar" : "Reativar"} · ${alvo.descricao}`,
        summary: alvo.quando,
        payload: { acao: nome, id },
        view: { rotulo: nome === "desmarcar" ? "Desmarcar" : "Reativar", linhas: [{ rotulo: "O quê", valor: alvo.descricao }, { rotulo: "Quando", valor: alvo.quando }], avisos: nome === "desmarcar" ? ["Fica riscado no calendário; as famílias veem-no desmarcado na app."] : [] },
      };
      return { dados: { ok: true, proposta: { descricao: alvo.descricao, quando: alvo.quando, nota: "A pessoa confirma no cartão." } }, proposta };
    });
  }

  private async proporAtleta(d: Record<string, unknown>): Promise<ResultadoDaFerramenta> {
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      const r = await this.equipaPorNome(db, String(d.equipa));
      if (!r.ok) return r.resultado;
      const nome = String(d.nome).trim();
      const nascimento = String(d.data_nascimento);
      const avisos: string[] = [];
      const repetido = await db.athlete.findFirst({ where: { name: { equals: nome, mode: "insensitive" }, birthdate: new Date(nascimento) }, select: { id: true } });
      if (repetido) avisos.push("Já existe um atleta com este nome e data de nascimento. Ao confirmar, a inscrição é recusada se for a mesma identificação.");
      if (d.nif) {
        const mesmoNif = await db.athlete.findFirst({ where: { taxId: String(d.nif) }, select: { name: true } });
        if (mesmoNif) return { dados: { erro: `Esse NIF já é do atleta ${mesmoNif.name}.` } };
      }
      const encarregados = d.encarregado_nome || d.encarregado_email || d.encarregado_telefone
        ? [{ nome: d.encarregado_nome as string | undefined, email: d.encarregado_email as string | undefined, telefone: d.encarregado_telefone as string | undefined }]
        : undefined;
      const dto = {
        name: nome,
        birthdate: nascimento,
        teamId: r.equipa.id,
        ...(d.nif ? { taxId: String(d.nif) } : {}),
        ...(d.outro_documento ? { idDocLabel: String(d.outro_documento) } : {}),
        ...(d.numero_documento ? { idDocNumber: String(d.numero_documento) } : {}),
        ...(d.email ? { email: String(d.email) } : {}),
        ...(d.posicao ? { position: String(d.posicao) } : {}),
        ...(typeof d.numero === "number" ? { squadNumber: Math.round(d.numero) } : {}),
        ...(encarregados ? { encarregados } : {}),
        sendInvite: false,
      };
      const linhas = [
        { rotulo: "Nome", valor: nome },
        { rotulo: "Nascimento", valor: nascimento },
        { rotulo: "Equipa", valor: r.equipa.name },
        { rotulo: "Identificação", valor: d.nif ? `NIF ${String(d.nif).slice(0, 3)}******` : `${String(d.outro_documento ?? "Documento")} ${String(d.numero_documento ?? "")}`.trim() },
        ...(d.posicao ? [{ rotulo: "Posição", valor: String(d.posicao) }] : []),
        ...(typeof d.numero === "number" ? [{ rotulo: "Número", valor: String(d.numero) }] : []),
        ...(encarregados ? [{ rotulo: "Encarregado", valor: [encarregados[0].nome, encarregados[0].email, encarregados[0].telefone].filter(Boolean).join(" · ") }] : []),
      ];
      const proposta: PropostaNova = {
        kind: "ATHLETE",
        title: `Inscrever · ${nome}`,
        summary: `${r.equipa.name}, nascido a ${nascimento}`,
        payload: { dto },
        view: { rotulo: "Inscrever atleta", linhas, avisos },
      };
      return { dados: { ok: true, proposta: { nome, equipa: r.equipa.name, avisos, nota: "A pessoa confirma no cartão. A mensalidade do mês nasce com a inscrição. Não digas que ficou inscrito." } }, proposta };
    });
  }

  private async proporComunicado(d: Record<string, unknown>): Promise<ResultadoDaFerramenta> {
    const scope = teamScopeFilter(this.ctx);
    const publico = String(d.publico);
    if (scope && publico !== "guardians" && publico !== "athletes") return { dados: { erro: "Esta pessoa só comunica com as famílias ou os atletas das suas equipas." } };
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      const teamIds: string[] = [];
      const nomes: string[] = [];
      if (d.equipas) {
        for (const dito of String(d.equipas).split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
          const r = await this.equipaPorNome(db, dito);
          if (!r.ok) return r.resultado;
          teamIds.push(r.equipa.id);
          nomes.push(r.equipa.name);
        }
      }
      const rotuloDoPublico = ACOES.publicar_comunicado.campos.find((c) => c.nome === "publico")!.opcoes!.find((o) => o.valor === publico)?.label ?? publico;
      const dto = { title: String(d.titulo).slice(0, 120), body: String(d.texto).slice(0, 2000), audience: publico, ...(teamIds.length ? { teamIds } : {}) };
      const linhas = [
        { rotulo: "Título", valor: dto.title },
        { rotulo: "Para", valor: nomes.length ? `${rotuloDoPublico} de ${nomes.join(", ")}` : rotuloDoPublico },
        { rotulo: "Texto", valor: dto.body },
      ];
      const proposta: PropostaNova = {
        kind: "ANNOUNCEMENT",
        title: `Comunicado · ${dto.title}`,
        summary: linhas[1].valor,
        payload: { dto },
        view: { rotulo: "Publicar comunicado", linhas, avisos: ["Ao confirmar, sai logo a notificação para quem for o público."] },
      };
      return { dados: { ok: true, proposta: { titulo: dto.title, para: linhas[1].valor, nota: "A pessoa vê o texto inteiro no cartão e confirma. Não digas que foi enviado." } }, proposta };
    });
  }

  /* ---- Propostas ---------------------------------------------------------- */

  private perguntaDeNomes(ambiguos: { dito: string; opcoes: Pessoa[] }[]): Pergunta {
    const a = ambiguos[0];
    return {
      texto: `Há mais do que um "${a.dito}" no plantel. Qual é?`,
      opcoes: a.opcoes.slice(0, 6).map((o) => ({ id: o.id, label: rotuloDe(o) })),
      campo: "nome",
    };
  }

  /**
   * Uma notícia para o site do clube. O texto é do modelo (como o comunicado);
   * o que se confirma aqui é o plano: sem o site no plano não há onde publicar,
   * e é melhor dizê-lo antes do cartão do que ao confirmar.
   */
  private async proporNoticia(d: Record<string, unknown>): Promise<ResultadoDaFerramenta> {
    const comSite = await this.prisma.runAs(this.ctx.academyId, (db) => siteIncluido(db, this.ctx.academyId));
    if (!comSite) return { dados: { erro: "O clube não tem o site no plano (Connect Pro), por isso não há onde publicar a notícia. Sugere um comunicado às famílias em vez disso." } };
    const dto = {
      titulo: String(d.titulo).slice(0, 200),
      resumo: String(d.resumo).slice(0, 600),
      corpo: String(d.corpo).slice(0, 20_000),
      categoria: String(d.categoria),
      destaque: d.destaque === true,
      estado: d.estado === "rascunho" ? ("rascunho" as const) : ("publicada" as const),
    };
    const linhas = [
      { rotulo: "Título", valor: dto.titulo },
      { rotulo: "Resumo", valor: dto.resumo },
      { rotulo: "Texto", valor: dto.corpo },
      { rotulo: "Categoria", valor: `${dto.categoria}${dto.destaque ? " · em destaque" : ""}` },
      { rotulo: "Estado", valor: dto.estado === "publicada" ? "Publicada no site ao confirmar" : "Rascunho, para rever na consola" },
    ];
    const proposta: PropostaNova = {
      kind: "SITE_NEWS",
      title: `Notícia · ${dto.titulo}`,
      summary: dto.estado === "publicada" ? `${dto.categoria} · sai no site ao confirmar` : `${dto.categoria} · rascunho`,
      payload: { dto },
      view: {
        rotulo: "Notícia no site",
        linhas,
        avisos: dto.estado === "publicada" ? ["Ao confirmar, a notícia fica logo no site do clube."] : [],
        abrir: { rotulo: "Abrir as notícias do site", to: "/website?secao=noticias" },
      },
    };
    return { dados: { ok: true, proposta: { titulo: dto.titulo, estado: dto.estado, nota: "A pessoa revê o texto no cartão e confirma. Não digas que ficou publicada." } }, proposta };
  }

  /* ---- O site do clube ------------------------------------------------------- */

  /** O que as ações do site precisam de saber, numa ida: a página de início, os recintos, os preços, a loja, os patrocinadores, os jogos. */
  private async dadosDoSite(db: ScopedClient): Promise<DadosDoSite> {
    const agora = Date.now();
    const scope = teamScopeFilter(this.ctx);
    const [config, produtos, patrocinadores, categorias, jogos, academia] = await Promise.all([
      db.siteConfig.findUnique({ where: { academyId: this.ctx.academyId } }),
      db.siteProduct.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
      db.siteSponsor.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, url: true, logoUrl: true, benefit: true } }),
      db.siteProductCategory.findMany({ orderBy: { position: "asc" }, select: { name: true } }),
      db.match.findMany({
        where: { ...(scope ? { teamId: scope } : {}), status: { not: "CANCELLED" }, startsAt: { gte: new Date(agora - DIA_MS), lt: new Date(agora + 60 * DIA_MS) } },
        orderBy: { startsAt: "asc" },
        take: 60,
        select: { id: true, startsAt: true, opponent: true, isHome: true, team: { select: { name: true } } },
      }),
      db.academy.findFirst({ where: { id: this.ctx.academyId }, select: SELECT_VENDAS }),
    ]);
    const precos: Record<string, TipoGuardado[]> = {};
    const brutos = (config?.ticketDefaults && typeof config.ticketDefaults === "object" ? config.ticketDefaults : {}) as Record<string, unknown>;
    for (const [recintoId, lista] of Object.entries(brutos)) precos[recintoId] = tiposValidos(lista);
    return {
      inicio: inicioValido(config?.home),
      recintos: recintosValidos(config?.venues),
      layout: layoutValido(config?.layout),
      publicado: config?.published ?? false,
      precos,
      semVendas: motivoParaNaoVender(academia),
      produtos: produtos.map((p) => ({
        id: p.id,
        label: `${p.name} · ${(p.priceCents / 100).toFixed(2).replace(".", ",")} €${p.visible ? "" : " (escondido)"}`,
        doInventario: p.inventoryItemId !== null,
        dto: {
          nome: p.name,
          categoria: p.category,
          categoriaId: p.categoryId ?? null,
          preco: p.priceCents / 100,
          imagem: p.imageUrl ?? "",
          imagens: p.images,
          descricao: p.description,
          tamanhos: p.sizes,
          esgotado: p.soldOut,
          visivel: p.visible,
          stock: (p.stock ?? {}) as Record<string, unknown>,
          slug: p.slug ?? "",
          precoAntes: p.compareAtPriceCents ? p.compareAtPriceCents / 100 : null,
          novidade: p.isNew === true,
          seoTitulo: p.seoTitle ?? "",
          seoDescricao: p.seoDescription ?? "",
        },
      })),
      patrocinadores: patrocinadores.map((p) => ({ id: p.id, label: p.name, dto: { nome: p.name, url: p.url ?? "", logo: p.logoUrl ?? "", vantagem: p.benefit } })),
      categorias: categorias.map((c) => c.name),
      jogos: jogos.map((j) => ({ id: j.id, startsAt: j.startsAt, label: `${quando(j.startsAt)} · ${j.team.name} vs ${j.opponent} (${j.isHome ? "casa" : "fora"})` })),
    };
  }

  /**
   * As ações do site: a página de início, o layout, o site no ar, a loja, os
   * patrocinadores e a bilheteira. Cada uma vira uma operação (`op`) que
   * `PropostasService.executarSite` corre ao confirmar e desfaz com a mesma
   * tabela. As regras são as dos ecrãs do Website na consola: um banner tem
   * tecto, a bilheteira precisa de recinto e de preços, uma venda paga precisa
   * dos pagamentos ligados, um produto do Inventário não se marca esgotado aqui.
   */
  private async proporSite(acao: Acao, d: Record<string, unknown>): Promise<ResultadoDaFerramenta> {
    const site = await this.prisma.runAs(this.ctx.academyId, (db) => this.dadosDoSite(db));
    const nome = acao.nome;
    const avisos: string[] = [];
    const paginaDepois = (inicio: Inicio) => seccoesDoSite(inicio).map((s, i) => `${i + 1}. ${s.label}`).join("\n");
    const propostaDeInicio = (titulo: string, resumo: string, inicio: Inicio, linhas: { rotulo: string; valor: string }[]): ResultadoDaFerramenta => ({
      dados: { ok: true, proposta: { resumo, paginaDepois: seccoesDoSite(inicio).map((s) => s.label), avisos, nota: "A pessoa confirma no cartão. Não digas que ficou feito." } },
      proposta: {
        kind: "SITE",
        title: `${acao.rotulo} · ${titulo}`,
        summary: resumo,
        payload: { op: "inicio", inicio, antes: site.inicio },
        view: { rotulo: acao.rotulo, linhas: [...linhas, { rotulo: "Página depois", valor: paginaDepois(inicio) }], avisos, abrir: { rotulo: "Abrir a página de início", to: "/website?secao=inicio" } },
      },
    });

    switch (nome) {
      case "mostrar_seccao_do_site": {
        const visivel = d.visivel === true;
        const dito = String(d.seccao);
        const visiveis = seccoesDoSite(site.inicio);
        const escondidas = seccoesEscondidas(site.inicio);
        const r = escolher([...visiveis, ...escondidas], dito, "secção");
        if (!r.ok) return { dados: { erro: r.erro } };
        const estaVisivel = visiveis.some((s) => s.id === r.item.id);
        if (visivel === estaVisivel) return { dados: { erro: `A secção "${r.item.label}" já está ${visivel ? "visível" : "escondida"}. Nada a fazer.` } };
        const seccoes = visivel
          ? [...site.inicio.seccoes, { id: r.item.id, key: r.item.id as SeccaoInicio["key"], visivel: true }]
          : site.inicio.seccoes.filter((s) => s.id !== r.item.id);
        if (!visivel && r.item.banner) avisos.push("Esconder um banner apaga-o da página: para o voltar a ter, cria-se de novo.");
        const inicio = { ...site.inicio, seccoes };
        return propostaDeInicio(r.item.label, visivel ? "Passa a aparecer na página de início" : "Deixa de aparecer na página de início", inicio, [
          { rotulo: "Secção", valor: r.item.label },
          { rotulo: "Ação", valor: visivel ? "Mostrar" : "Esconder" },
        ]);
      }
      case "mover_seccao_do_site": {
        const visiveis = seccoesDoSite(site.inicio);
        const r = escolher(visiveis, String(d.seccao), "secção");
        if (!r.ok) return { dados: { erro: r.erro } };
        const de = site.inicio.seccoes.findIndex((s) => s.id === r.item.id);
        const para = Math.max(0, Math.min(site.inicio.seccoes.length - 1, Math.round(Number(d.posicao)) - 1));
        if (de === para) return { dados: { erro: `A secção "${r.item.label}" já está na posição ${para + 1}.` } };
        const seccoes = [...site.inicio.seccoes];
        const [movida] = seccoes.splice(de, 1);
        seccoes.splice(para, 0, movida);
        return propostaDeInicio(r.item.label, `Da posição ${de + 1} para a ${para + 1}`, { ...site.inicio, seccoes }, [
          { rotulo: "Secção", valor: r.item.label },
          { rotulo: "Posição", valor: `${para + 1}.ª` },
        ]);
      }
      case "adicionar_banner_ao_site": {
        const quantos = site.inicio.seccoes.filter((s) => s.key === "banner").length;
        if (quantos >= BANNERS_MAX) return { dados: { erro: `A página de início já tem ${BANNERS_MAX} banners, que é o máximo. Para pôr outro, tira-se um (remover_banner_do_site).` } };
        const banner = { ...BANNER_VAZIO, titulo: String(d.titulo).slice(0, 80), texto: d.texto ? String(d.texto).slice(0, 400) : "", botao: d.botao ? String(d.botao).slice(0, 40) : "", url: d.url ? String(d.url).slice(0, 500) : "" };
        if (banner.botao && !banner.url) avisos.push("O botão sem ligação não aparece no site; junta a ligação na consola ou diz-ma.");
        const novo: SeccaoInicio = { id: `banner-${Date.now().toString(36)}`, key: "banner", visivel: true, banner };
        const seccoes = [...site.inicio.seccoes];
        const posicao = typeof d.posicao === "number" ? Math.max(0, Math.min(seccoes.length, Math.round(d.posicao) - 1)) : seccoes.length;
        seccoes.splice(posicao, 0, novo);
        avisos.push("Sem imagem: o banner fica só com texto até se juntar uma na consola (Website, Página de início).");
        return propostaDeInicio(banner.titulo, `Na posição ${posicao + 1}`, { ...site.inicio, seccoes }, [
          { rotulo: "Título", valor: banner.titulo },
          ...(banner.texto ? [{ rotulo: "Texto", valor: banner.texto }] : []),
          ...(banner.botao ? [{ rotulo: "Botão", valor: `${banner.botao}${banner.url ? ` → ${banner.url}` : ""}` }] : []),
        ]);
      }
      case "remover_banner_do_site": {
        const banners = seccoesDoSite(site.inicio).filter((s) => s.banner);
        if (banners.length === 0) return { dados: { erro: "A página de início não tem banners." } };
        const r = escolher(banners, String(d.banner), "banner");
        if (!r.ok) return { dados: { erro: r.erro } };
        const seccoes = site.inicio.seccoes.filter((s) => s.id !== r.item.id);
        return propostaDeInicio(r.item.label, "Sai da página de início", { ...site.inicio, seccoes }, [{ rotulo: "Banner", valor: r.item.label }]);
      }
      case "mudar_layout_do_site": {
        const layout = String(d.layout);
        if (layout === site.layout) return { dados: { erro: `O site já está no layout ${layout === "tribuna" ? "Tribuna" : "Holofote"}.` } };
        const rotulo = layout === "tribuna" ? "Tribuna (claro)" : "Holofote (escuro)";
        return {
          dados: { ok: true, proposta: { layout: rotulo, nota: "A pessoa confirma no cartão." } },
          proposta: {
            kind: "SITE",
            title: `${acao.rotulo} · ${rotulo}`,
            summary: `De ${site.layout === "tribuna" ? "Tribuna" : "Holofote"} para ${rotulo}`,
            payload: { op: "config", data: { layout }, antes: { layout: site.layout } },
            view: { rotulo: acao.rotulo, linhas: [{ rotulo: "Layout", valor: rotulo }], avisos, abrir: { rotulo: "Abrir o Aspeto do site", to: "/website?secao=aspeto" } },
          },
        };
      }
      case "por_site_no_ar": {
        const publicado = d.publicado === true;
        if (publicado === site.publicado) return { dados: { erro: `O site já está ${publicado ? "no ar" : "fora do ar"}.` } };
        avisos.push(publicado ? "Ao confirmar, o site fica acessível a toda a gente no endereço do clube." : "Ao confirmar, o endereço do site deixa de responder até voltares a publicar.");
        return {
          dados: { ok: true, proposta: { noAr: publicado, avisos, nota: "A pessoa confirma no cartão." } },
          proposta: {
            kind: "SITE",
            title: publicado ? "Pôr o site no ar" : "Tirar o site do ar",
            summary: publicado ? "O site passa a estar acessível" : "O site deixa de estar acessível",
            payload: { op: "config", data: { publicado }, antes: { publicado: site.publicado } },
            view: { rotulo: acao.rotulo, linhas: [{ rotulo: "Site", valor: publicado ? "No ar" : "Fora do ar" }], avisos, abrir: { rotulo: "Abrir o Website", to: "/website" } },
          },
        };
      }
      case "criar_produto_na_loja": {
        const dto = {
          nome: String(d.nome).slice(0, 120),
          preco: Math.round(Number(d.preco) * 100) / 100,
          ...(d.categoria ? { categoria: String(d.categoria).slice(0, 40) } : {}),
          ...(d.descricao ? { descricao: String(d.descricao).slice(0, 2000) } : {}),
          ...(d.tamanhos ? { tamanhos: String(d.tamanhos).slice(0, 300) } : {}),
          visivel: d.visivel === true,
        };
        if (!(dto.preco >= 0 && dto.preco <= 10_000)) return { dados: { erro: "O preço tem de estar entre 0 e 10 000 €." } };
        if (site.produtos.some((p) => normalizar(p.dto.nome) === normalizar(dto.nome))) avisos.push(`Já há um produto chamado "${dto.nome}" na loja; este fica como outro.`);
        if (site.semVendas) avisos.push(`${site.semVendas} Até lá a loja mostra o produto em catálogo, sem comprar.`);
        avisos.push("Sem fotografia: junta-se na consola (Website, Loja).");
        const preco = `${dto.preco.toFixed(2).replace(".", ",")} €`;
        return {
          dados: { ok: true, proposta: { nome: dto.nome, preco, avisos, nota: "A pessoa confirma no cartão. Não digas que ficou à venda." } },
          proposta: {
            kind: "SITE",
            title: `Produto · ${dto.nome}`,
            summary: `${preco}${dto.categoria ? ` · ${dto.categoria}` : ""}${dto.visivel ? "" : " · escondido"}`,
            payload: { op: "produto_criar", dto },
            view: {
              rotulo: acao.rotulo,
              linhas: [
                { rotulo: "Nome", valor: dto.nome },
                { rotulo: "Preço", valor: preco },
                ...(dto.categoria ? [{ rotulo: "Categoria", valor: dto.categoria }] : []),
                ...(dto.descricao ? [{ rotulo: "Descrição", valor: dto.descricao }] : []),
                ...(dto.tamanhos ? [{ rotulo: "Tamanhos", valor: dto.tamanhos }] : []),
                { rotulo: "Na loja", valor: dto.visivel ? "Visível" : "Escondido" },
              ],
              avisos,
              abrir: { rotulo: "Abrir a loja", to: "/website?secao=loja" },
            },
          },
        };
      }
      case "mudar_produto_da_loja": {
        const r = escolher(site.produtos, String(d.produto), "produto");
        if (!r.ok) return { dados: { erro: r.erro } };
        const antes = r.item.dto;
        const mudancas: string[] = [];
        const dto = { ...antes };
        if (typeof d.preco === "number") {
          if (!(d.preco >= 0 && d.preco <= 10_000)) return { dados: { erro: "O preço tem de estar entre 0 e 10 000 €." } };
          dto.preco = Math.round(d.preco * 100) / 100;
          mudancas.push(`preço ${antes.preco.toFixed(2).replace(".", ",")} € → ${dto.preco.toFixed(2).replace(".", ",")} €`);
        }
        if (typeof d.visivel === "boolean" && d.visivel !== antes.visivel) {
          dto.visivel = d.visivel;
          mudancas.push(d.visivel ? "passa a visível" : "fica escondido");
        }
        if (typeof d.esgotado === "boolean" && d.esgotado !== antes.esgotado) {
          if (r.item.doInventario) return { dados: { erro: "Este produto vende um artigo do Inventário: o esgotado vem do stock do artigo e não se marca aqui." } };
          dto.esgotado = d.esgotado;
          mudancas.push(d.esgotado ? "marcado como esgotado" : "deixa de estar esgotado");
        }
        if (typeof d.novidade === "boolean" && d.novidade !== antes.novidade) {
          dto.novidade = d.novidade;
          mudancas.push(d.novidade ? "marcado como novidade" : "deixa de ser novidade");
        }
        if (mudancas.length === 0) return { dados: { erro: "Não foi dito nada para mudar neste produto (preço, visível, esgotado ou novidade), ou já está assim." } };
        return {
          dados: { ok: true, proposta: { produto: antes.nome, mudancas, nota: "A pessoa confirma no cartão." } },
          proposta: {
            kind: "SITE",
            title: `Produto · ${antes.nome}`,
            summary: mudancas.join(" · "),
            payload: { op: "produto_editar", id: r.item.id, dto, antes },
            view: { rotulo: acao.rotulo, linhas: [{ rotulo: "Produto", valor: antes.nome }, ...mudancas.map((m) => ({ rotulo: "Muda", valor: m }))], avisos, abrir: { rotulo: "Abrir a loja", to: "/website?secao=loja" } },
          },
        };
      }
      case "remover_produto_da_loja": {
        const r = escolher(site.produtos, String(d.produto), "produto");
        if (!r.ok) return { dados: { erro: r.erro } };
        avisos.push("O produto sai da loja de vez. As encomendas já feitas ficam, com o nome do produto na altura.");
        return {
          dados: { ok: true, proposta: { produto: r.item.dto.nome, avisos, nota: "A pessoa confirma no cartão." } },
          proposta: {
            kind: "SITE",
            title: `Remover produto · ${r.item.dto.nome}`,
            summary: "Sai da loja do site",
            payload: { op: "produto_apagar", id: r.item.id, antes: r.item.dto },
            view: { rotulo: acao.rotulo, linhas: [{ rotulo: "Produto", valor: r.item.label }], avisos, abrir: { rotulo: "Abrir a loja", to: "/website?secao=loja" } },
          },
        };
      }
      case "adicionar_patrocinador": {
        const dto = { nome: String(d.nome).slice(0, 120), ...(d.url ? { url: String(d.url).slice(0, 500) } : {}), ...(d.vantagem ? { vantagem: String(d.vantagem).slice(0, 160) } : {}) };
        if (site.patrocinadores.some((p) => normalizar(p.dto.nome) === normalizar(dto.nome))) return { dados: { erro: `Já há um patrocinador chamado "${dto.nome}".` } };
        avisos.push("Sem logótipo: junta-se na consola (Gestão, Patrocinadores).");
        return {
          dados: { ok: true, proposta: { nome: dto.nome, avisos, nota: "A pessoa confirma no cartão." } },
          proposta: {
            kind: "SITE",
            title: `Patrocinador · ${dto.nome}`,
            summary: dto.vantagem ? `Vantagem para os sócios: ${dto.vantagem}` : "Só patrocinador",
            payload: { op: "patrocinador_criar", dto },
            view: {
              rotulo: acao.rotulo,
              linhas: [{ rotulo: "Nome", valor: dto.nome }, ...(dto.url ? [{ rotulo: "Site", valor: dto.url }] : []), ...(dto.vantagem ? [{ rotulo: "Vantagem", valor: dto.vantagem }] : [])],
              avisos,
              abrir: { rotulo: "Abrir os patrocinadores", to: "/patrocinadores" },
            },
          },
        };
      }
      case "remover_patrocinador": {
        const r = escolher(site.patrocinadores, String(d.patrocinador), "patrocinador");
        if (!r.ok) return { dados: { erro: r.erro } };
        return {
          dados: { ok: true, proposta: { nome: r.item.dto.nome, nota: "A pessoa confirma no cartão." } },
          proposta: {
            kind: "SITE",
            title: `Remover patrocinador · ${r.item.dto.nome}`,
            summary: "Sai do site e da app dos sócios",
            payload: { op: "patrocinador_apagar", id: r.item.id, antes: r.item.dto },
            view: { rotulo: acao.rotulo, linhas: [{ rotulo: "Patrocinador", valor: r.item.dto.nome }], avisos, abrir: { rotulo: "Abrir os patrocinadores", to: "/patrocinadores" } },
          },
        };
      }
      case "abrir_bilheteira":
      case "fechar_bilheteira":
        return this.proporBilheteira(acao, d, site, avisos);
    }
    return { dados: { erro: "Ação do site sem tratamento" } };
  }

  private async proporBilheteira(acao: Acao, d: Record<string, unknown>, site: DadosDoSite, avisos: string[]): Promise<ResultadoDaFerramenta> {
    const j = escolher(site.jogos, String(d.jogo), "jogo");
    if (!j.ok) return { dados: { erro: j.erro } };
    const jogo = j.item;
    const actual = await this.prisma.runAs(this.ctx.academyId, (db) => db.siteMatchTickets.findUnique({ where: { matchId: jogo.id } }));
    const antes = actual
      ? {
          aberta: actual.open,
          recintoId: actual.venueId,
          lotacao: actual.capacity,
          nota: actual.note,
          tipos: tiposValidos(actual.types).map((t) => ({ id: t.id, nome: t.nome, preco: t.precoCents / 100, bancadaId: t.bancadaId, para: t.para, tierId: t.tierId })),
          sociosDesde: actual.membersFrom?.toISOString() ?? null,
          publicoDesde: actual.publicFrom?.toISOString() ?? null,
          soSocios: actual.membersOnly,
          fechaEm: actual.closesAt?.toISOString() ?? null,
        }
      : null;

    if (acao.nome === "fechar_bilheteira") {
      if (!antes) return { dados: { erro: `O jogo ${jogo.label} não tem bilheteira no site.` } };
      if (!antes.aberta) return { dados: { erro: `A venda de bilhetes do jogo ${jogo.label} já está fechada.` } };
      return {
        dados: { ok: true, proposta: { jogo: jogo.label, nota: "A pessoa confirma no cartão." } },
        proposta: {
          kind: "SITE",
          title: `Fechar bilheteira · ${jogo.label}`,
          summary: "A venda fecha; os bilhetes comprados ficam válidos",
          payload: { op: "bilheteira", matchId: jogo.id, dto: { ...antes, aberta: false }, antes },
          view: { rotulo: acao.rotulo, linhas: [{ rotulo: "Jogo", valor: jogo.label }], avisos, abrir: { rotulo: "Abrir a bilheteira", to: "/website?secao=bilheteira" } },
        },
      };
    }

    const r = escolher(site.recintos.map((x) => ({ id: x.id, label: x.nome, recinto: x })), String(d.recinto), "recinto");
    if (!r.ok) return { dados: { erro: site.recintos.length === 0 ? "O clube ainda não desenhou nenhum recinto no Estádio do site; sem recinto não há bilheteira." : r.erro } };
    const recinto: Recinto = r.item.recinto;
    const tipos = antes?.tipos.length && antes.recintoId === recinto.id ? antes.tipos : (site.precos[recinto.id] ?? []).map((t) => ({ id: t.id, nome: t.nome, preco: t.precoCents / 100, bancadaId: t.bancadaId, para: t.para, tierId: t.tierId }));
    if (tipos.length === 0) return { dados: { erro: `O recinto "${recinto.nome}" não tem preços por omissão. Definem-se na consola, em Website, Bilheteira, Preços; depois a venda abre-se daqui.` } };
    if (tipos.some((t) => t.preco > 0) && site.semVendas) return { dados: { erro: `${site.semVendas} Sem isso só se vendem bilhetes a 0 €.` } };

    const quem = String(d.quem);
    const abre = instanteDe(d.abre_dia, d.abre_hora, "00:00") ?? new Date();
    const publico = quem === "socios_primeiro" ? instanteDe(d.publico_dia, d.publico_hora, "00:00") : null;
    if (quem === "socios_primeiro" && !publico) return { dados: { erro: "Falta o dia em que a venda abre ao público." } };
    if (publico && publico.getTime() <= abre.getTime()) return { dados: { erro: "O público tem de entrar depois dos sócios: a data do público tem de ser posterior à abertura." } };
    const fecha = instanteDe(d.fecha_dia, d.fecha_hora, "23:59");
    if (fecha && fecha.getTime() <= abre.getTime()) return { dados: { erro: "A venda fecha antes de abrir: a data de fecho tem de ser posterior à abertura." } };
    if (fecha && fecha.getTime() > jogo.startsAt.getTime()) avisos.push("A venda fecha depois da hora do jogo.");
    if (abre.getTime() > jogo.startsAt.getTime()) return { dados: { erro: "A venda abriria depois do jogo." } };
    const lotacao = typeof d.lotacao === "number" ? Math.round(d.lotacao) : null;
    if (lotacao !== null && (lotacao < 1 || lotacao > 200_000)) return { dados: { erro: "A lotação tem de estar entre 1 e 200 000." } };

    const dto = {
      aberta: true,
      recintoId: recinto.id,
      lotacao,
      nota: d.nota ? String(d.nota).slice(0, 500) : "",
      tipos,
      soSocios: quem === "so_socios",
      sociosDesde: abre.toISOString(),
      publicoDesde: quem === "so_socios" ? null : (publico ?? abre).toISOString(),
      fechaEm: fecha?.toISOString() ?? null,
    };
    if (antes?.aberta) avisos.push("A venda deste jogo já estava aberta: confirmar substitui as condições; os bilhetes já comprados ficam válidos.");
    const nomeDaBancada = (id: string | null) => recinto.bancadas.find((b) => b.id === id)?.nome ?? "";
    const precos = tipos.map((t) => `${t.nome}${t.bancadaId ? ` (${nomeDaBancada(t.bancadaId)})` : ""}: ${t.preco.toFixed(2).replace(".", ",")} €`).join("; ");
    const quandoTexto = (dt: Date) => formatarNoFuso(dt, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const quemTexto = quem === "todos" ? `Toda a gente, desde ${quandoTexto(abre)}` : quem === "so_socios" ? `Só sócios, desde ${quandoTexto(abre)}` : `Sócios desde ${quandoTexto(abre)}, público desde ${quandoTexto(publico!)}`;
    return {
      dados: { ok: true, proposta: { jogo: jogo.label, recinto: recinto.nome, precos, quem: quemTexto, avisos, nota: "A pessoa confirma no cartão. Não digas que os bilhetes já estão à venda." } },
      proposta: {
        kind: "SITE",
        title: `Bilhetes · ${jogo.label}`,
        summary: `${recinto.nome} · ${quemTexto}`,
        payload: { op: "bilheteira", matchId: jogo.id, dto, antes },
        view: {
          rotulo: acao.rotulo,
          linhas: [
            { rotulo: "Jogo", valor: jogo.label },
            { rotulo: "Recinto", valor: recinto.nome },
            { rotulo: "Preços", valor: precos },
            { rotulo: "Quem compra", valor: quemTexto },
            { rotulo: "Fecha", valor: fecha ? quandoTexto(fecha) : "À hora do jogo" },
            ...(lotacao ? [{ rotulo: "Lotação", valor: String(lotacao) }] : []),
            ...(dto.nota ? [{ rotulo: "Nota", valor: dto.nota }] : []),
          ],
          avisos,
          abrir: { rotulo: "Abrir a bilheteira", to: "/website?secao=bilheteira" },
        },
      },
    };
  }

  /* ---- Planos de treino ------------------------------------------------------ */

  /** A biblioteca como o modelo a lê: sem desenhos nem imagens, só o que distingue um exercício. */
  private async exercicios(modalidade: string | null) {
    if (!can(this.ctx, "training:read")) return { erro: "Sem acesso à área técnica" };
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      let sportId: string | undefined;
      if (modalidade) {
        const alvo = normalizar(modalidade);
        const sports = await db.sport.findMany({ select: { id: true, name: true } });
        sportId = sports.find((s) => normalizar(s.name) === alvo)?.id ?? sports.find((s) => normalizar(s.name).includes(alvo))?.id;
        if (!sportId) return { erro: `Não há nenhuma modalidade "${modalidade}". As do clube: ${sports.map((s) => s.name).join(", ")}.` };
      }
      const lista = await this.biblioteca(db, sportId);
      return lista.map(({ descricao: _descricao, ...e }) => e);
    });
  }

  /** Os exercícios que esta pessoa vê (os do clube e os seus privados), de uma modalidade ou de todas. */
  private async biblioteca(db: ScopedClient, sportId?: string): Promise<ExercicioDaBiblioteca[]> {
    const rows = await db.exercise.findMany({
      where: { archivedAt: null, AND: [{ OR: [{ visibility: "CLUB" }, { createdById: this.ctx.membershipId }] }, ...(sportId ? [{ OR: [{ sportId }, { sportId: null }] }] : [])] },
      orderBy: { updatedAt: "desc" },
      take: 120,
      select: { id: true, name: true, category: true, type: true, durationMin: true, players: true, intensity: true, ageMin: true, ageMax: true, description: true, diagram: true, imageKeys: true },
    });
    return rows.map((e) => ({
      id: e.id,
      nome: e.name,
      categoria: e.category,
      tipo: e.type,
      minutos: e.durationMin,
      jogadores: e.players,
      intensidade: e.intensity,
      idadeMin: e.ageMin,
      idadeMax: e.ageMax,
      descricao: e.description ? e.description.replace(/\s+/g, " ").slice(0, 160) : null,
      comDesenho: e.diagram !== null || e.imageKeys.length > 0,
    }));
  }

  /** O treino de uma equipa num dia: um só serve logo; nenhum é um erro; vários ficam para o formulário escolher. */
  private async treinoDoDia(equipaDita: string, dia: string): Promise<{ sessionId?: string; erro?: string }> {
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      const r = await this.equipaPorNome(db, equipaDita);
      if (!r.ok) return {};
      const [ano, mes, diaDoMes] = dia.split("-").map(Number);
      const inicio = instanteNoFuso(ano, mes, diaDoMes, 0, 0);
      const sessoes = await db.trainingSession.findMany({
        where: { teamId: r.equipa.id, status: { not: "CANCELLED" }, startsAt: { gte: inicio, lt: new Date(inicio.getTime() + DIA_MS) } },
        orderBy: { startsAt: "asc" },
        select: { id: true },
      });
      if (sessoes.length === 1) return { sessionId: sessoes[0].id };
      if (sessoes.length === 0) return { erro: `O ${r.equipa.name} não tem treino marcado a ${dia}. Marca-o primeiro (marcar_treino) ou escolhe outro dia.` };
      return {};
    });
  }

  /**
   * O plano de um treino, gerado pelo planeador (modelo forte) a partir do que
   * a pessoa quer e da biblioteca do clube. Não grava: a proposta leva a sessão,
   * os blocos e os exercícios novos (com desenho), e é ao confirmar que tudo
   * entra na Área técnica.
   */
  private async proporPlano(d: Record<string, unknown>): Promise<ResultadoDaFerramenta> {
    if (!can(this.ctx, "training:write")) return { dados: { erro: "Esta pessoa não pode planear treinos" } };
    if (!this.planeador) return { dados: { erro: "O planeador de treinos não está disponível neste momento" } };
    const scope = teamScopeFilter(this.ctx);
    const lido = await this.prisma.runAs(this.ctx.academyId, async (db) => {
      const s = await db.trainingSession.findFirst({
        where: { id: String(d.treino) },
        select: {
          id: true, teamId: true, startsAt: true, endsAt: true, status: true, objective: true,
          team: { select: { name: true, maxAge: true, sport: { select: { id: true, name: true, code: true } } } },
          blocks: { orderBy: { order: "asc" }, select: { name: true, durationMin: true } },
        },
      });
      if (!s) return { erro: "Não encontrei esse treino. Pede a lista com a ferramenta treinos ou agenda." };
      if (scope && !scope.in.includes(s.teamId)) return { erro: "Esse treino é de uma equipa fora do teu âmbito" };
      if (s.status === "CANCELLED") return { erro: "Esse treino está desmarcado" };
      const academia = await db.academy.findFirst({ where: { id: this.ctx.academyId }, select: { name: true } });
      const biblioteca = await this.biblioteca(db, s.team.sport.id);
      return { s, academia, biblioteca };
    });
    if ("erro" in lido) return { dados: { erro: lido.erro } };
    const { s, academia, biblioteca } = lido;

    const terreno = terrenoDaEquipa({ sportCode: s.team.sport.code, sportName: s.team.sport.name, maxAge: s.team.maxAge });
    const duracaoMin = Math.max(30, Math.min(240, Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000)));
    const pedido = pedidoDoPlaneador({
      clube: academia?.name ?? "",
      equipa: s.team.name,
      idade: s.team.maxAge,
      modalidade: s.team.sport.name,
      terreno,
      quando: formatarNoFuso(s.startsAt, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }),
      duracaoMin,
      foco: String(d.foco),
      intensidade: d.intensidade ? String(d.intensidade) : undefined,
      notas: d.notas ? String(d.notas) : undefined,
      usarBiblioteca: d.biblioteca === "sim" ? true : d.biblioteca === "nao" ? false : null,
      biblioteca: d.biblioteca === "nao" ? [] : biblioteca,
      planoActual: s.blocks.length ? { objetivo: s.objective, blocos: s.blocks.map((b) => ({ nome: b.name, minutos: b.durationMin })) } : null,
      pesquisar: d.pesquisar === true,
    });

    let bruto: unknown;
    try {
      bruto = JSON.parse(await this.planeador.gerar({ instrucoes: instrucoesDoPlaneador(), pedido, pesquisar: d.pesquisar === true, esquema: { nome: "plano_de_treino", schema: ESQUEMA_DO_PLANO } }));
    } catch (e) {
      return { dados: { erro: `O planeador falhou: ${(e as Error).message ?? "sem resposta"}. Diz à pessoa para tentar outra vez daqui a pouco.` } };
    }
    const r = lerPlanoGerado(bruto, terreno, new Set(biblioteca.map((e) => e.id)));
    if (!r.ok) return { dados: { erro: r.erro } };
    const { plano, avisos } = r;

    const porId = new Map(biblioteca.map((e) => [e.id, e.nome]));
    const total = plano.blocos.reduce((n, b) => n + b.durationMin, 0);
    const novos = plano.blocos.filter((b) => b.novo).length;
    if (s.blocks.length) avisos.unshift(`Este treino já tinha um plano com ${s.blocks.length} ${s.blocks.length === 1 ? "bloco" : "blocos"}; ao confirmar é substituído (dá para desfazer durante dez minutos).`);
    if (Math.abs(total - duracaoMin) > 10) avisos.push(`Os blocos somam ${total} min e o treino tem ${duracaoMin}.`);
    if (novos) avisos.push(`${novos} ${novos === 1 ? "exercício novo entra" : "exercícios novos entram"} na biblioteca do clube ao confirmar.`);

    const quandoTexto = quando(s.startsAt);
    const linhas = [
      { rotulo: "Treino", valor: `${s.team.name} · ${quandoTexto} · ${duracaoMin} min` },
      { rotulo: "Objetivo", valor: [plano.sessao.objective, ...(plano.sessao.objectives ?? [])].filter(Boolean).join(" · ") },
      ...(plano.sessao.sessionType ? [{ rotulo: "Tipo", valor: plano.sessao.sessionType }] : []),
      ...(plano.sessao.intensity ? [{ rotulo: "Intensidade", valor: `${plano.sessao.intensity}/10` }] : []),
      ...(plano.sessao.material ? [{ rotulo: "Material", valor: plano.sessao.material }] : []),
      ...(plano.sessao.planNotes ? [{ rotulo: "Notas", valor: plano.sessao.planNotes }] : []),
    ];
    const blocos = plano.blocos.map((b) => ({
      nome: b.nome,
      minutos: b.durationMin,
      categoria: b.category,
      objetivo: b.objective,
      intensidade: b.intensity,
      jogadores: b.players,
      notas: b.notes,
      exercicio: b.exerciseId ? { nome: porId.get(b.exerciseId) ?? "", novo: false, descricao: null, desenho: null } : b.novo ? { nome: b.novo.name, novo: true, descricao: b.novo.description, desenho: miniatura(b.novo.diagram) } : null,
    }));
    const proposta: PropostaNova = {
      kind: "TRAINING_PLAN",
      title: `Plano · ${s.team.name} · ${quandoTexto}`,
      summary: `${plano.blocos.length} blocos · ${total} min${plano.sessao.intensity ? ` · intensidade ${plano.sessao.intensity}/10` : ""}${novos ? ` · ${novos} ${novos === 1 ? "exercício novo" : "exercícios novos"}` : ""}`,
      payload: { sessionId: s.id, sportId: s.team.sport.id, sessao: plano.sessao, blocos: plano.blocos },
      view: { rotulo: "Plano de treino", linhas, blocos, avisos, abrir: { rotulo: "Abrir o plano na Área técnica", to: `/treinos/${s.id}` } },
    };
    return {
      dados: {
        ok: true,
        proposta: {
          objetivo: plano.sessao.objective,
          blocos: blocos.map((b) => `${b.nome} (${b.minutos} min${b.exercicio ? `, ${b.exercicio.novo ? "exercício novo" : "da biblioteca"}: ${b.exercicio.nome}` : ""})`),
          avisos,
          nota: "A pessoa vê o plano inteiro no cartão, com os desenhos, e confirma. Resume em duas frases o que o plano trabalha; não repitas a lista dos blocos. Não digas que ficou gravado.",
        },
      },
      proposta,
    };
  }

  /**
   * Um exercício sozinho para a biblioteca: a equipa dá a modalidade, a idade
   * e o campo do desenho; o autor (o mesmo modelo do planeador, com a forma
   * `ESQUEMA_DO_EXERCICIO`) escreve a ficha e o desenho. Não toca em treino
   * nenhum: ao confirmar entra na biblioteca do clube, e só.
   */
  private async proporExercicio(d: Record<string, unknown>): Promise<ResultadoDaFerramenta> {
    if (!can(this.ctx, "training:write")) return { dados: { erro: "Esta pessoa não pode criar exercícios" } };
    if (!this.planeador) return { dados: { erro: "O autor de exercícios não está disponível neste momento" } };
    const lido = await this.prisma.runAs(this.ctx.academyId, async (db) => {
      const r = await this.equipaPorNome(db, String(d.equipa));
      if (!r.ok) return { resultado: r.resultado };
      const equipa = await db.team.findFirst({ where: { id: r.equipa.id }, select: { id: true, name: true, maxAge: true, sport: { select: { id: true, name: true, code: true } } } });
      if (!equipa) return { resultado: { dados: { erro: "Equipa não encontrada" } } as ResultadoDaFerramenta };
      const academia = await db.academy.findFirst({ where: { id: this.ctx.academyId }, select: { name: true } });
      const biblioteca = await this.biblioteca(db, equipa.sport.id);
      return { equipa, academia, biblioteca };
    });
    if ("resultado" in lido && lido.resultado) return lido.resultado;
    if (!("equipa" in lido) || !lido.equipa) return { dados: { erro: "Equipa não encontrada" } };
    const { equipa, academia, biblioteca } = lido;

    const terreno = terrenoDaEquipa({ sportCode: equipa.sport.code, sportName: equipa.sport.name, maxAge: equipa.maxAge });
    const pedido = pedidoDoExercicio({
      clube: academia?.name ?? "",
      equipa: equipa.name,
      idade: equipa.maxAge,
      modalidade: equipa.sport.name,
      terreno,
      foco: String(d.foco),
      intensidade: d.intensidade ? String(d.intensidade) : undefined,
      duracaoMin: typeof d.duracao === "number" ? Math.round(d.duracao) : undefined,
      notas: d.notas ? String(d.notas) : undefined,
      pesquisar: d.pesquisar === true,
      jaHa: biblioteca.slice(0, 40).map((e) => e.nome),
    });

    let bruto: unknown;
    try {
      bruto = JSON.parse(await this.planeador.gerar({ instrucoes: instrucoesDoExercicio(), pedido, pesquisar: d.pesquisar === true, esquema: { nome: "exercicio", schema: ESQUEMA_DO_EXERCICIO } }));
    } catch (e) {
      return { dados: { erro: `O autor de exercícios falhou: ${(e as Error).message ?? "sem resposta"}. Diz à pessoa para tentar outra vez daqui a pouco.` } };
    }
    const ex = lerExercicioNovo(bruto, terreno, typeof d.duracao === "number" ? Math.round(d.duracao) : null);
    if (!ex) return { dados: { erro: "O autor não devolveu um exercício" } };

    const avisos: string[] = [];
    if (!ex.diagram) avisos.push("Este exercício veio sem desenho; junta-se na consola, no editor da Área técnica.");
    if (biblioteca.some((e) => normalizar(e.nome) === normalizar(ex.name))) avisos.push(`Já há um exercício chamado "${ex.name}" na biblioteca; este fica como outro.`);
    avisos.push("Ao confirmar, entra na biblioteca do clube. Não fica em nenhum treino.");
    const linhas = [
      { rotulo: "Para", valor: `${equipa.name} · ${equipa.sport.name}` },
      ...(ex.category ? [{ rotulo: "Categoria", valor: [ex.category, ex.type].filter(Boolean).join(" · ") }] : []),
      ...([ex.players, ex.space, ex.durationMin ? `${ex.durationMin} min` : null, ex.intensity ? `intensidade ${ex.intensity}/10` : null].some(Boolean)
        ? [{ rotulo: "Formato", valor: [ex.players, ex.space, ex.durationMin ? `${ex.durationMin} min` : null, ex.intensity ? `intensidade ${ex.intensity}/10` : null].filter(Boolean).join(" · ") }]
        : []),
      ...(ex.description ? [{ rotulo: "Como se faz", valor: ex.description }] : []),
      ...(ex.rules ? [{ rotulo: "Regras", valor: ex.rules }] : []),
      ...(ex.coachingPoints ? [{ rotulo: "Pontos de treino", valor: ex.coachingPoints }] : []),
      ...(ex.commonErrors ? [{ rotulo: "Erros comuns", valor: ex.commonErrors }] : []),
      ...(ex.progressions ? [{ rotulo: "Progressão", valor: ex.progressions }] : []),
      ...(ex.regressions ? [{ rotulo: "Regressão", valor: ex.regressions }] : []),
      ...(ex.material ? [{ rotulo: "Material", valor: ex.material }] : []),
    ];
    const proposta: PropostaNova = {
      kind: "EXERCISE",
      title: `Exercício · ${ex.name}`,
      summary: [equipa.name, ex.category, ex.durationMin ? `${ex.durationMin} min` : null].filter(Boolean).join(" · "),
      payload: { sportId: equipa.sport.id, exercicio: ex },
      view: { rotulo: "Exercício novo", linhas, avisos, desenho: ex.diagram },
    };
    return {
      dados: { ok: true, proposta: { nome: ex.name, comDesenho: Boolean(ex.diagram), avisos, nota: "A pessoa vê a ficha e o desenho no cartão e confirma. Resume em uma ou duas frases o que o exercício trabalha. Não digas que ficou gravado." } },
      proposta,
    };
  }

  private async proporPresencas(sessionId: string, faltas: { nome: string; tipo: string; motivo: string | null }[]): Promise<ResultadoDaFerramenta> {
    if (!can(this.ctx, "attendance:write")) return { dados: { erro: "Esta pessoa não pode registar presenças" } };
    const scope = teamScopeFilter(this.ctx);
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      const treino = await db.trainingSession.findFirst({
        where: { id: sessionId },
        select: { id: true, teamId: true, startsAt: true, status: true, attendanceClosedAt: true, team: { select: { name: true } } },
      });
      if (!treino) return { dados: { erro: "Treino não encontrado" } };
      if (scope && !scope.in.includes(treino.teamId)) return { dados: { erro: "Esse treino é de uma equipa fora do teu âmbito" } };
      if (treino.status === "CANCELLED") return { dados: { erro: "O treino está cancelado; não tem presenças" } };

      const plantel = await this.plantel(db, treino.teamId);
      const { resolvidos, ambiguos, desconhecidos } = resolverNomes(faltas.map((f) => f.nome), plantel);
      if (ambiguos.length > 0) {
        return {
          dados: { pergunta: `Há mais do que um "${ambiguos[0].dito}" no plantel; a pessoa vai escolher. Quando responder, volta a chamar propor_presencas com o nome completo.`, opcoes: ambiguos[0].opcoes.map(rotuloDe) },
          pergunta: this.perguntaDeNomes(ambiguos),
        };
      }
      if (desconhecidos.length > 0) {
        return { dados: { erro: `Não encontrei no plantel do ${treino.team.name}: ${desconhecidos.join(", ")}. Confirma o nome com a pessoa.` } };
      }
      const deBaixa = resolvidos.filter((r) => (r.pessoa as AtletaDoPlantel).baixa);
      if (deBaixa.length > 0) {
        return { dados: { erro: `${deBaixa.map((r) => r.pessoa.name).join(", ")}: está de baixa e não leva falta a este treino. Deixa-o fora da lista.` } };
      }

      const absences = resolvidos.map((r, i) => {
        const f = faltas[i] ?? faltas.find((x) => x.nome === r.dito)!;
        const kind = f.tipo === "justificada" ? "justified" : f.tipo === "atraso" ? "late" : "absent";
        return { athleteId: r.pessoa.id, nome: r.pessoa.name, kind, note: kind === "justified" && f.motivo ? f.motivo.slice(0, 200) : undefined };
      });
      /*
       * O plantel inteiro vai para o cartão, cada um com o estado com que fica:
       * quem confirma tem de ver a folha toda, não só as faltas, para dar pela
       * falta de alguém que o modelo não percebeu. Quem está de baixa aparece
       * como tal e não conta como presente.
       */
      const porAtleta = new Map(absences.map((a) => [a.athleteId, a]));
      const atletas = plantel.map((p) => {
        const a = porAtleta.get(p.id);
        const estado = a ? a.kind : (p as AtletaDoPlantel).baixa ? "baixa" : "presente";
        return { athleteId: p.id, nome: p.name, numero: p.squadNumber ?? null, estado, motivo: a?.note ?? null };
      });
      const deBaixaNoPlantel = atletas.filter((a) => a.estado === "baixa").length;
      const presentes = plantel.length - absences.length - deBaixaNoPlantel;
      const resumo =
        absences.length === 0
          ? `Estiveram todos${deBaixaNoPlantel ? ` · ${deBaixaNoPlantel} de baixa` : ""}`
          : `${presentes} presentes · ${absences.length} ${absences.length === 1 ? "falta" : "faltas"}${deBaixaNoPlantel ? ` · ${deBaixaNoPlantel} de baixa` : ""}`;
      const proposta: PropostaNova = {
        kind: "ATTENDANCE",
        title: `Presenças · ${treino.team.name} · ${quando(treino.startsAt)}`,
        summary: resumo,
        payload: { sessionId, absences: absences.map(({ athleteId, kind, note }) => ({ athleteId, kind, note })) },
        view: {
          teamName: treino.team.name,
          quando: quando(treino.startsAt),
          presentes,
          faltas: absences.map((a) => ({ athleteId: a.athleteId, nome: a.nome, tipo: a.kind, motivo: a.note ?? null })),
          /** O plantel todo, com o estado de cada um. As propostas de antes de 12/11/2026 só têm `faltas`. */
          atletas,
          jaFechada: treino.attendanceClosedAt !== null,
        },
      };
      return {
        dados: { ok: true, proposta: { resumo, faltas: absences.map((a) => `${a.nome} (${a.kind})`), presentes, nota: "A pessoa vê o cartão e confirma. Não digas que ficou gravado." } },
        proposta,
      };
    });
  }

  private async proporLesao(a: { nome: string; teamId: string | null; descricao: string; impacto: string; data: string | null; retomaPrevista: string | null }): Promise<ResultadoDaFerramenta> {
    const escreve = can(this.ctx, "clinical:write");
    if (!escreve && !can(this.ctx, "attendance:write")) return { dados: { erro: "Esta pessoa não pode registar lesões nem avisar o clínico" } };
    const scope = teamScopeFilter(this.ctx);
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      // O plantel onde procurar: a equipa dita, a do contexto, ou todas as da pessoa.
      const teamIds = a.teamId ? [a.teamId] : this.contexto.teamId ? [this.contexto.teamId] : null;
      const equipas = await db.team.findMany({
        where: { season: { isCurrent: true }, ...(teamIds ? { id: { in: teamIds } } : scope ? { id: scope } : {}) },
        select: { id: true, name: true },
      });
      let plantel: (AtletaDoPlantel & { teamName: string })[] = [];
      for (const t of equipas) plantel.push(...(await this.plantel(db, t.id)).map((p) => ({ ...p, teamName: t.name })));
      // O mesmo atleta em duas equipas é uma pessoa só.
      const vistos = new Set<string>();
      plantel = plantel.filter((p) => (vistos.has(p.id) ? false : (vistos.add(p.id), true)));

      const r = resolverNome(a.nome, plantel);
      if (r.tipo === "ambiguo") {
        return { dados: { pergunta: `Há mais do que um "${a.nome}"; a pessoa vai escolher. Depois volta a chamar propor_lesao com o nome completo.` }, pergunta: this.perguntaDeNomes([{ dito: a.nome, opcoes: r.opcoes }]) };
      }
      if (r.tipo === "nenhum") return { dados: { erro: `Não encontrei "${a.nome}" nos plantéis que esta pessoa vê. Confirma o nome.` } };

      const impact = a.impacto === "OUT" || a.impacto === "LIMITED" ? a.impacto : "NONE";
      const data = a.data && /^\d{4}-\d{2}-\d{2}$/.test(a.data) ? a.data : diaIso(new Date());
      const retoma = a.retomaPrevista && /^\d{4}-\d{2}-\d{2}$/.test(a.retomaPrevista) ? a.retomaPrevista : null;
      const descricao = a.descricao.trim().slice(0, 400);
      const situacao = impact === "OUT" ? "Fica de fora" : impact === "LIMITED" ? "Trabalho condicionado" : "Em observação";
      const proposta: PropostaNova = {
        kind: "CLINICAL",
        title: escreve ? `Lesão · ${r.pessoa.name}` : `Avisar o clínico · ${r.pessoa.name}`,
        summary: `${descricao} · ${situacao}`,
        payload: { athleteId: r.pessoa.id, modo: escreve ? "registar" : "avisar", descricao, impact, data, retomaPrevista: retoma },
        view: {
          nome: r.pessoa.name,
          teamName: r.pessoa.teamName,
          descricao,
          situacao,
          data,
          retomaPrevista: retoma,
          modo: escreve ? "registar" : "avisar",
        },
      };
      return {
        dados: {
          ok: true,
          proposta: {
            atleta: r.pessoa.name,
            situacao,
            data,
            nota: escreve
              ? "A pessoa vê o cartão e confirma o registo no boletim. Não digas que ficou gravado."
              : "Esta pessoa não escreve no boletim clínico: ao confirmar, o departamento clínico recebe o aviso e regista. Diz isso.",
          },
        },
        proposta,
      };
    });
  }

  private async proporConvocatoria(a: { matchId: string; base: string; adicionar: string[]; remover: string[] }): Promise<ResultadoDaFerramenta> {
    if (!can(this.ctx, "calendar:write")) return { dados: { erro: "Esta pessoa não pode fazer convocatórias" } };
    const scope = teamScopeFilter(this.ctx);
    return this.prisma.runAs(this.ctx.academyId, async (db) => {
      const jogo = await db.match.findFirst({
        where: { id: a.matchId },
        select: { id: true, teamId: true, startsAt: true, opponent: true, callUpsClosedAt: true, team: { select: { name: true, maxCallUps: true } }, callUps: { select: { athleteId: true } } },
      });
      if (!jogo) return { dados: { erro: "Jogo não encontrado" } };
      if (scope && !scope.in.includes(jogo.teamId)) return { dados: { erro: "Esse jogo é de uma equipa fora do teu âmbito" } };

      const plantel = await this.plantel(db, jogo.teamId);
      const porId = new Map(plantel.map((p) => [p.id, p]));

      let base: string[] = [];
      let origem = "";
      if (a.base === "ultimo_jogo") {
        const anterior = await db.match.findFirst({
          where: { teamId: jogo.teamId, startsAt: { lt: jogo.startsAt }, callUps: { some: {} } },
          orderBy: { startsAt: "desc" },
          select: { opponent: true, startsAt: true, callUps: { select: { athleteId: true } } },
        });
        if (!anterior) return { dados: { erro: "Esta equipa ainda não tem nenhum jogo anterior com convocatória. Usa base = plantel ou dá a lista." } };
        base = anterior.callUps.map((c) => c.athleteId).filter((id) => porId.has(id));
        origem = `a convocatória de ${quando(anterior.startsAt)} vs ${anterior.opponent}`;
      } else if (a.base === "plantel") {
        base = plantel.map((p) => p.id);
        origem = "o plantel inteiro";
      } else {
        origem = "uma lista nova";
      }

      const resolver = (nomes: string[]) => resolverNomes(nomes, plantel);
      const add = resolver(a.adicionar ?? []);
      const rem = resolver(a.remover ?? []);
      const ambiguos = [...add.ambiguos, ...rem.ambiguos];
      if (ambiguos.length > 0) {
        return { dados: { pergunta: `Há mais do que um "${ambiguos[0].dito}"; a pessoa vai escolher. Depois volta a chamar propor_convocatoria com o nome completo.` }, pergunta: this.perguntaDeNomes(ambiguos) };
      }
      const desconhecidos = [...add.desconhecidos, ...rem.desconhecidos];
      if (desconhecidos.length > 0) return { dados: { erro: `Não encontrei no plantel do ${jogo.team.name}: ${desconhecidos.join(", ")}.` } };

      const ids = new Set(base);
      for (const r of rem.resolvidos) ids.delete(r.pessoa.id);
      for (const r of add.resolvidos) ids.add(r.pessoa.id);

      // Quem está de baixa ou em pausa sai sozinho, e diz-se porquê.
      const deFora: string[] = [];
      for (const id of [...ids]) {
        const p = porId.get(id);
        if (!p) continue;
        if (p.baixa) { ids.delete(id); deFora.push(`${p.name} (de baixa)`); }
        else if (p.status === "PAUSED") { ids.delete(id); deFora.push(`${p.name} (em pausa)`); }
      }
      if (ids.size > jogo.team.maxCallUps) {
        return { dados: { erro: `Ficam ${ids.size} convocados e esta equipa convoca no máximo ${jogo.team.maxCallUps}. Tira ${ids.size - jogo.team.maxCallUps}.` } };
      }
      const convocados = plantel.filter((p) => ids.has(p.id));
      const proposta: PropostaNova = {
        kind: "CALLUPS",
        title: `Convocatória · ${jogo.team.name} · ${quando(jogo.startsAt)} vs ${jogo.opponent}`,
        summary: `${convocados.length} convocados, a partir de ${origem}`,
        payload: { matchId: jogo.id, athleteIds: convocados.map((p) => p.id) },
        view: {
          teamName: jogo.team.name,
          quando: quando(jogo.startsAt),
          adversario: jogo.opponent,
          convocados: convocados.map((p) => ({ athleteId: p.id, nome: p.name, numero: p.squadNumber, posicao: p.position })),
          deFora,
          jaSubmetida: jogo.callUpsClosedAt !== null,
          tinha: jogo.callUps.length,
        },
      };
      return {
        dados: {
          ok: true,
          proposta: { total: convocados.length, convocados: convocados.map((p) => p.name), deFora, nota: "A pessoa vê o cartão e confirma. Confirmar guarda a convocatória sem a submeter às famílias; a submissão faz-se na página do jogo. Não digas que ficou gravado." },
        },
        proposta,
      };
    });
  }
}

import { useSyncExternalStore } from "react";
import { academySlug, apiDelete, apiGet, apiGetSilencioso, apiOrigin, apiPost } from "@/lib/http";
import { getAccessToken } from "@/lib/session";
import { mostrarErro } from "@/lib/avisos";
import { reloadAcademy } from "@/lib/store";

/**
 * O Adjunto na consola: os pedidos e o estado partilhado.
 *
 * ## Um estado só
 *
 * O minichat ao canto e a página inteira são a mesma conversa. O que se começa
 * num aparece no outro, por isso a conversa aberta vive aqui, em variáveis de
 * módulo com `useSyncExternalStore`, como o `store.ts` faz para o resto.
 *
 * ## O streaming
 *
 * A resposta do servidor chega por Server-Sent Events, num `POST` com a
 * sessão no cabeçalho. O `EventSource` do browser não faz `POST` nem manda
 * cabeçalhos, por isso lê-se o corpo com `fetch` e parte-se à mão nos eventos.
 * Cada evento tem `event:` e `data:` em JSON (ver `adjunto.controller.ts`).
 */

/** O nome que a pessoa vê. Um sítio só: mudar aqui muda a consola toda (o do servidor está em `adjunto.service.ts`, `NOME`). */
export const NOME_DO_ADJUNTO = "Assistente IA";

export type Contexto = { rota?: string; teamId?: string; sessionId?: string; matchId?: string; athleteId?: string; voz?: boolean };

/** Um campo do formulário de uma ação, como o servidor o manda (ver `ferramentas.ts`, `CampoDoFormulario`). */
export type CampoDoFormulario = {
  nome: string;
  rotulo: string;
  tipo: string;
  obrigatorio: boolean;
  valor: string;
  sugestao?: string;
  opcoes?: { valor: string; label: string }[];
  multiplo?: boolean;
  livre?: boolean;
  descricao?: string;
  emFalta: boolean;
  /** Só aparece quando outro campo tem este valor (ex.: balneários só num jogo em casa). */
  soSe?: { campo: string; igual: string };
};

export type Formulario = { acao: string; titulo: string; campos: CampoDoFormulario[] };

export type Acao = "presencas" | "lesao" | "convocatoria_simples" | "convocatoria_criterios" | "agenda" | "acao" | "pergunta_simples" | "pergunta_cruzada" | "varias_acoes" | "conversa";

export type Pergunta = { texto: string; opcoes: { id: string; label: string }[]; campo?: string };

export type Bloco =
  | { type: "proposta"; id: string }
  | { type: "pergunta"; pergunta: Pergunta }
  | { type: "importacao"; id: string }
  | { type: "formulario"; formulario: Formulario; enviado?: boolean };

export type Mensagem = {
  id: string;
  role: "USER" | "ASSISTANT";
  text: string;
  blocks: Bloco[];
  model: string | null;
  createdAt: string;
  /** Só no cliente: a resposta ainda está a chegar. */
  aChegar?: boolean;
};

export type Proposta = {
  id: string;
  kind: "ATTENDANCE" | "CLINICAL" | "CALLUPS" | "EVENT" | "ATHLETE" | "ANNOUNCEMENT" | "TRAINING_PLAN" | "SITE_NEWS" | "SITE" | "EXERCISE";
  status: "PENDING" | "CONFIRMED" | "REJECTED" | "UNDONE" | "EXPIRED";
  title: string;
  summary: string;
  view: Record<string, unknown>;
  result: unknown;
  createdAt: string;
  confirmedAt: string | null;
  podeDesfazer: boolean;
  /** Nasceu de um formulário e está pendente: o cartão tem "Editar". */
  editavel?: boolean;
};

export type ResumoDeConversa = { id: string; title: string; updatedAt: string; createdAt: string; pendentes: number };

export type FolhaDaImportacao = {
  nome: string;
  entidade: string;
  confianca: "alta" | "media" | "baixa";
  headers: string[];
  linhas: number;
  amostra: unknown[][];
  colunas: { origem: string; destino: string; transformacao: string; nota: string }[];
  equipas: { origem: string; destino: string }[];
  duvidas: { coluna: string; texto: string; opcoes: { label: string; transformacao: string }[] }[];
  ensaio: {
    suportada: boolean;
    total: number;
    entram: number;
    entramEmEquipaNova: number;
    jaExistiam: number;
    existentes: { line: number; name: string; matchedName: string; changes: string[] }[];
    erros: { line: number; name: string; error: string }[];
    equipasNovas: { name: string; maxAge: number; sportName: string; linhas: number }[];
    encarregadosDeFora: number;
    telefonesASubstituir: number;
  } | null;
};

export type Importacao = {
  id: string;
  conversationId: string;
  fileName: string;
  status: "REHEARSED" | "IMPORTED" | "FAILED";
  resumo: string;
  folhas: FolhaDaImportacao[];
  result: unknown;
  error: string | null;
  createdAt: string;
};

export type ConversaAberta = {
  id: string;
  title: string;
  messages: Mensagem[];
  proposals: Proposta[];
  imports: Importacao[];
};

/* -------------------------------------------------------------------------- */
/* Estado                                                                      */
/* -------------------------------------------------------------------------- */

type Estado = {
  /** `null` = ainda não se perguntou. */
  ligado: boolean | null;
  voz: boolean;
  /** Só em desenvolvimento: a interface aparece sem a chave do modelo, e diz-o. */
  semChave: boolean;
  /** O minichat ao canto está aberto. */
  aberto: boolean;
  conversa: ConversaAberta | null;
  conversas: ResumoDeConversa[];
  /** O servidor está a responder. */
  aResponder: boolean;
  /** O que o modelo está a fazer agora ("a ler o plantel"), para o indicador. */
  passo: string | null;
  /** O texto que o compositor deve mostrar (uma sugestão escolhida, um ditado). */
  rascunho: string;
  /** Pedido de abrir a página inteira com a conversa atual (do minichat). */
  irParaAPagina: number;
  /** A conversa por voz (mãos livres) está ligada. */
  modoVoz: boolean;
  /** A abrir uma conversa do histórico que ainda não estava em memória. */
  aAbrir: boolean;
};

let estado: Estado = { ligado: null, voz: false, semChave: false, aberto: false, conversa: null, conversas: [], aResponder: false, passo: null, rascunho: "", irParaAPagina: 0, modoVoz: false, aAbrir: false };
const ouvintes = new Set<() => void>();
const emitir = () => ouvintes.forEach((o) => o());
function set(parte: Partial<Estado>) {
  estado = { ...estado, ...parte };
  /*
   * A conversa aberta entra sempre na memória: o que se escreveu, as propostas
   * confirmadas e as importações ficam lá, e voltar a ela depois é instantâneo.
   */
  if (parte.conversa && parte.conversa.messages.length > 0) emCache.set(parte.conversa.id, parte.conversa);
  emitir();
}

export function useAdjunto(): Estado {
  return useSyncExternalStore(
    (o) => {
      ouvintes.add(o);
      return () => ouvintes.delete(o);
    },
    () => estado,
    () => estado,
  );
}

/** Para quem não é componente (o menu). `null` = ainda não se sabe. */
export function adjuntoLigado(): boolean | null {
  return estado.ligado;
}

export function abrirMini(aberto = true) {
  set({ aberto });
}

export function pedirPagina() {
  set({ aberto: false, irParaAPagina: estado.irParaAPagina + 1 });
}

export function definirRascunho(texto: string) {
  set({ rascunho: texto });
}

export function ligarModoVoz(ligado: boolean) {
  set({ modoVoz: ligado });
}

/* -------------------------------------------------------------------------- */
/* Pedidos                                                                     */
/* -------------------------------------------------------------------------- */

let carregouEstado = false;

/**
 * O estado que veio no arranque da consola (`/api/bootstrap`).
 *
 * Chega antes do primeiro desenho, e por isso a barra de baixo do telemóvel
 * nasce já com o robô no meio. Antes só se perguntava em `carregarEstado`,
 * depois de a barra estar no ecrã: aparecia o Calendário e o robô a seguir.
 * Com isto o `carregarEstado` já não vai ao servidor.
 */
export function aplicarEstadoDoArranque(e: { ligado: boolean; voz: boolean; semChave: boolean }): void {
  carregouEstado = true;
  set({ ligado: e.ligado === true, voz: e.voz === true, semChave: e.semChave === true });
}

/** Pergunta uma vez ao servidor se o Adjunto está ligado neste clube. */
export async function carregarEstado(): Promise<void> {
  if (carregouEstado) return;
  carregouEstado = true;
  try {
    const r = await apiGetSilencioso<{ ligado: boolean; voz: boolean; semChave?: boolean }>("/api/adjunto/estado");
    set({ ligado: r?.ligado === true, voz: r?.voz === true, semChave: r?.semChave === true });
  } catch {
    set({ ligado: false });
  }
}

export async function carregarConversas(): Promise<void> {
  const conversas = await apiGet<ResumoDeConversa[]>("/api/adjunto/conversas");
  set({ conversas });
}

export async function novaConversa(contexto?: Contexto): Promise<ConversaAberta> {
  const r = await apiPost<ResumoDeConversa>("/api/adjunto/conversas", { contexto: contexto ?? {} });
  const conversa: ConversaAberta = { id: r.id, title: r.title, messages: [], proposals: [], imports: [] };
  set({ conversa, conversas: [r, ...estado.conversas] });
  return conversa;
}

/*
 * As conversas já abertas, em memória.
 *
 * Voltar a uma conversa do histórico mostra logo a última versão que se viu, e
 * a do servidor chega por trás (sem desfoque). Passar o rato por cima de uma
 * conversa da lista já a vai buscar (`preCarregar`), por isso o clique quase
 * sempre encontra a conversa pronta.
 */
const emCache = new Map<string, ConversaAberta>();
const aCaminho = new Map<string, Promise<ConversaAberta>>();

function buscarConversa(id: string): Promise<ConversaAberta> {
  const ja = aCaminho.get(id);
  if (ja) return ja;
  const p = apiGet<ConversaAberta>(`/api/adjunto/conversas/${id}`)
    .then((c) => {
      emCache.set(id, c);
      return c;
    })
    .finally(() => aCaminho.delete(id));
  aCaminho.set(id, p);
  return p;
}

export function preCarregar(id: string): void {
  if (emCache.has(id) || aCaminho.has(id)) return;
  void buscarConversa(id).catch(() => undefined);
}

/** Qual conversa se pediu por último: uma resposta lenta de outra não a substitui. */
let pedida: string | null = null;

export async function abrirConversa(id: string): Promise<void> {
  pedida = id;
  const guardada = emCache.get(id);
  if (guardada) {
    set({ conversa: guardada });
    // Atualizar por trás; se a pessoa já foi para outra, não mexe.
    void buscarConversa(id)
      .then((c) => {
        if (pedida === id && !estado.aResponder) set({ conversa: c });
      })
      .catch(() => undefined);
    return;
  }
  set({ aAbrir: true });
  try {
    const c = await buscarConversa(id);
    if (pedida === id) set({ conversa: c });
  } finally {
    if (pedida === id) set({ aAbrir: false });
  }
}

export function fecharConversa() {
  pedida = null;
  set({ conversa: null, aAbrir: false });
}

export async function apagarConversa(id: string): Promise<void> {
  await apiDelete(`/api/adjunto/conversas/${id}`);
  emCache.delete(id);
  set({ conversas: estado.conversas.filter((c) => c.id !== id), conversa: estado.conversa?.id === id ? null : estado.conversa });
}

/** A conversa aberta, ou uma nova se não houver. */
export async function conversaOuNova(contexto?: Contexto): Promise<ConversaAberta> {
  return estado.conversa ?? novaConversa(contexto);
}

type Evento =
  | { evento: "inicio"; dados: { conversationId: string; messageId: string } }
  | { evento: "rota"; dados: { acao: string; nivel: string; motivo?: string } }
  | { evento: "texto"; dados: { delta: string } }
  | { evento: "ferramenta"; dados: { nome: string } }
  | { evento: "proposta"; dados: { proposta: Proposta } }
  | { evento: "pergunta"; dados: { pergunta: Pergunta } }
  | { evento: "formulario"; dados: { formulario: Formulario } }
  | { evento: "fim"; dados: { messageId: string; modelo: string } }
  | { evento: "erro"; dados: { mensagem: string; status: number } };

const PASSOS: Record<string, string> = {
  equipas: "a ver as equipas",
  plantel: "a ler o plantel",
  treinos: "a ver os treinos",
  jogos: "a ver os jogos",
  convocatoria: "a ler a convocatória",
  lesionados: "a ver quem está indisponível",
  propor_presencas: "a preparar as presenças",
  propor_lesao: "a preparar o registo",
  propor_convocatoria: "a montar a convocatória",
  agenda: "a ver o calendário",
  catalogo: "a ver os locais e as provas",
  propor_acao: "a preparar o formulário",
  exercicios: "a ver a biblioteca de exercícios",
  planear_treino: "a montar o plano de treino, com os desenhos (leva cerca de um minuto)",
  criar_exercicio: "a criar o exercício, com o desenho (leva menos de um minuto)",
  perguntar: "a perguntar",
  precisar_de_ajuda: "a pedir reforços",
};

/**
 * Manda uma mensagem e vai pondo a resposta na conversa à medida que chega.
 * Resolve quando o servidor acaba. Os erros aparecem no cartão de avisos, como
 * os dos outros pedidos, e a resposta fica marcada.
 */
export async function enviar(pedido: { texto: string; contexto?: Contexto; acao?: Acao; escolha?: { campo?: string; id: string; label: string } }): Promise<{ messageId: string | null; texto: string }> {
  let idDaResposta: string | null = null;
  const conversa = await conversaOuNova(pedido.contexto);
  const textoVisivel = pedido.escolha ? (pedido.texto ? `${pedido.texto} (${pedido.escolha.label})` : pedido.escolha.label) : pedido.texto;
  const agora = new Date().toISOString();
  const minha: Mensagem = { id: `local-${Date.now()}`, role: "USER", text: textoVisivel, blocks: [], model: null, createdAt: agora };
  const resposta: Mensagem = { id: `local-r-${Date.now()}`, role: "ASSISTANT", text: "", blocks: [], model: null, createdAt: agora, aChegar: true };
  set({
    conversa: { ...conversa, messages: [...conversa.messages, minha, resposta] },
    aResponder: true,
    passo: "a pensar",
    rascunho: "",
  });

  const actualizarResposta = (muda: (m: Mensagem) => Mensagem) => {
    const c = estado.conversa;
    if (!c) return;
    set({ conversa: { ...c, messages: c.messages.map((m) => (m.id === resposta.id ? muda(m) : m)) } });
  };

  try {
    const token = await getAccessToken();
    const res = await fetch(`${apiOrigin()}/api/adjunto/conversas/${conversa.id}/mensagens`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "x-academy-slug": academySlug(),
        "x-app": "console",
      },
      body: JSON.stringify({ texto: pedido.texto, contexto: pedido.contexto, acao: pedido.acao, escolha: pedido.escolha }),
    });
    if (!res.ok || !res.body) {
      let msg = "O Assistente IA não respondeu.";
      try {
        const corpo = (await res.json()) as { message?: string | string[] };
        if (corpo.message) msg = Array.isArray(corpo.message) ? corpo.message.join("; ") : corpo.message;
      } catch {
        /* sem corpo */
      }
      throw new Error(msg);
    }

    for await (const ev of lerEventos(res.body)) {
      if (ev.evento === "texto") {
        actualizarResposta((m) => ({ ...m, text: m.text + ev.dados.delta }));
        set({ passo: null });
      } else if (ev.evento === "ferramenta") {
        set({ passo: PASSOS[ev.dados.nome] ?? "a trabalhar" });
      } else if (ev.evento === "proposta") {
        const c = estado.conversa;
        if (c) set({ conversa: { ...c, proposals: [...c.proposals, ev.dados.proposta] } });
        actualizarResposta((m) => ({ ...m, blocks: [...m.blocks, { type: "proposta", id: ev.dados.proposta.id }] }));
      } else if (ev.evento === "pergunta") {
        actualizarResposta((m) => ({ ...m, blocks: [...m.blocks, { type: "pergunta", pergunta: ev.dados.pergunta }] }));
      } else if (ev.evento === "formulario") {
        actualizarResposta((m) => ({ ...m, blocks: [...m.blocks, { type: "formulario", formulario: ev.dados.formulario }] }));
      } else if (ev.evento === "rota") {
        if (ev.dados.motivo) set({ passo: "a pedir um modelo mais forte" });
      } else if (ev.evento === "fim") {
        idDaResposta = ev.dados.messageId;
        actualizarResposta((m) => ({ ...m, id: ev.dados.messageId, model: ev.dados.modelo, aChegar: false }));
      } else if (ev.evento === "erro") {
        throw new Error(ev.dados.mensagem);
      }
    }
  } catch (e) {
    const msg = (e as Error).message || "O Assistente IA não respondeu.";
    mostrarErro(msg);
    actualizarResposta((m) => ({ ...m, text: m.text || "Não consegui responder. Tenta outra vez.", aChegar: false }));
  } finally {
    set({ aResponder: false, passo: null });
    const c = estado.conversa;
    if (c) {
      // O título nasce da primeira mensagem; a lista precisa de o saber.
      const titulo = c.title === "Conversa nova" && c.messages.length ? c.messages[0].text.slice(0, 60) : c.title;
      set({
        conversa: { ...c, title: titulo },
        conversas: [{ id: c.id, title: titulo, updatedAt: new Date().toISOString(), createdAt: c.messages[0]?.createdAt ?? new Date().toISOString(), pendentes: c.proposals.filter((p) => p.status === "PENDING").length }, ...estado.conversas.filter((x) => x.id !== c.id)],
      });
    }
  }
  const mensagemDaResposta = estado.conversa?.messages.find((m) => m.id === idDaResposta);
  return { messageId: idDaResposta, texto: mensagemDaResposta?.text ?? "" };
}

/** A resposta de uma mensagem em voz: um endereço de objeto com o MP3, para o altifalante. */
export async function vozDaMensagem(messageId: string): Promise<string> {
  const token = await getAccessToken();
  const res = await fetch(`${apiOrigin()}/api/adjunto/mensagens/${messageId}/voz`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "x-academy-slug": academySlug(), "x-app": "console" },
  });
  if (!res.ok) {
    let msg = "Não consegui dizer a resposta.";
    try {
      const corpo = (await res.json()) as { message?: string | string[] };
      if (corpo.message) msg = Array.isArray(corpo.message) ? corpo.message.join("; ") : corpo.message;
    } catch {
      /* sem corpo */
    }
    throw new Error(msg);
  }
  return URL.createObjectURL(await res.blob());
}

/** Parte um corpo SSE nos seus eventos. */
async function* lerEventos(body: ReadableStream<Uint8Array>): AsyncGenerator<Evento> {
  const leitor = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await leitor.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let corte: number;
    while ((corte = buffer.indexOf("\n\n")) >= 0) {
      const bloco = buffer.slice(0, corte);
      buffer = buffer.slice(corte + 2);
      let evento = "";
      let dados = "";
      for (const linha of bloco.split("\n")) {
        if (linha.startsWith("event:")) evento = linha.slice(6).trim();
        else if (linha.startsWith("data:")) dados += linha.slice(5).trim();
      }
      if (!evento) continue;
      try {
        yield { evento, dados: JSON.parse(dados || "{}") } as Evento;
      } catch {
        /* um evento partido não pára a leitura */
      }
    }
  }
}

/* ---- Formulários --------------------------------------------------------- */

/**
 * Enviar o formulário de uma ação preenchido no chat. O servidor devolve a
 * conversa inteira já com a proposta a confirmar; um campo obrigatório vazio
 * volta como erro (no cartão de avisos) e o formulário fica como estava.
 */
export async function enviarFormulario(messageId: string, formulario: Formulario, valores: Record<string, string>): Promise<void> {
  const c = estado.conversa;
  if (!c) return;
  const atualizada = await apiPost<ConversaAberta>(`/api/adjunto/conversas/${c.id}/formularios`, { acao: formulario.acao, valores, messageId: messageId.startsWith("local-") ? undefined : messageId });
  set({ conversa: atualizada });
}

/* ---- Propostas ----------------------------------------------------------- */

function substituirProposta(p: Proposta) {
  const c = estado.conversa;
  if (!c) return;
  set({ conversa: { ...c, proposals: c.proposals.map((x) => (x.id === p.id ? p : x)) } });
}

/*
 * Depois de o Adjunto escrever (confirmar, desfazer, importar), a consola volta
 * a carregar os dados do clube, como faz o diálogo de cada página. Sem isto, o
 * comunicado, o evento ou o atleta gravados não apareciam na página respetiva
 * até se atualizar o browser, e parecia que não tinham ficado gravados. Corre
 * por trás: o cartão muda logo e as páginas redesenham-se quando chegar.
 */
function recarregarOClube() {
  void reloadAcademy().catch(() => {
    /* a falha já aparece pelo arranque; a escrita ficou feita */
  });
}

export async function confirmarProposta(id: string): Promise<Proposta> {
  const p = await apiPost<Proposta>(`/api/adjunto/propostas/${id}/confirmar`, {});
  substituirProposta(p);
  recarregarOClube();
  return p;
}

export async function recusarProposta(id: string): Promise<Proposta> {
  const p = await apiPost<Proposta>(`/api/adjunto/propostas/${id}/recusar`, {});
  substituirProposta(p);
  return p;
}

/** O formulário de uma proposta pendente, para o "Editar" do cartão. */
export function formularioDaProposta(id: string): Promise<Formulario> {
  return apiGet<Formulario>(`/api/adjunto/propostas/${id}/formulario`);
}

/** Gravar a edição: a proposta fica com o conteúdo novo, no mesmo sítio, e continua por confirmar. */
export async function editarProposta(id: string, valores: Record<string, string>): Promise<Proposta> {
  const p = await apiPost<Proposta>(`/api/adjunto/propostas/${id}/editar`, { valores });
  substituirProposta(p);
  return p;
}

export async function desfazerProposta(id: string): Promise<Proposta> {
  const p = await apiPost<Proposta>(`/api/adjunto/propostas/${id}/desfazer`, {});
  substituirProposta(p);
  recarregarOClube();
  return p;
}

/* ---- Voz ------------------------------------------------------------------- */

export async function transcrever(audioBase64: string, mime: string): Promise<string> {
  const r = await apiPost<{ texto: string }>("/api/adjunto/transcrever", { audioBase64, mime });
  return r.texto;
}

/* ---- Importação ------------------------------------------------------------ */

function porImportacao(imp: Importacao) {
  const c = estado.conversa;
  if (!c) return;
  const existe = c.imports.some((i) => i.id === imp.id);
  set({ conversa: { ...c, imports: existe ? c.imports.map((i) => (i.id === imp.id ? imp : i)) : [...c.imports, imp] } });
}

export async function enviarFicheiro(file: File, contexto?: Contexto): Promise<Importacao> {
  const conversa = await conversaOuNova(contexto);
  const base64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Não consegui ler o ficheiro"));
    r.readAsDataURL(file);
  });
  set({ aResponder: true, passo: "a ler o ficheiro" });
  try {
    const imp = await apiPost<Importacao>(`/api/adjunto/conversas/${conversa.id}/importacoes`, { fileName: file.name, mime: file.type || "application/octet-stream", base64 });
    // As mensagens novas (o ficheiro e o resumo) vêm da conversa inteira.
    await abrirConversa(conversa.id);
    porImportacao(imp);
    return imp;
  } finally {
    set({ aResponder: false, passo: null });
  }
}

export async function corrigirMapeamento(id: string, mapping: unknown): Promise<Importacao> {
  const imp = await apiPost<Importacao>(`/api/adjunto/importacoes/${id}/mapeamento`, { mapping });
  porImportacao(imp);
  return imp;
}

export async function confirmarImportacao(id: string, opcoes: { sobrescrever?: boolean; enviarConvites?: boolean }): Promise<Importacao> {
  const imp = await apiPost<Importacao>(`/api/adjunto/importacoes/${id}/confirmar`, opcoes);
  if (estado.conversa) await abrirConversa(estado.conversa.id);
  porImportacao(imp);
  recarregarOClube();
  return imp;
}

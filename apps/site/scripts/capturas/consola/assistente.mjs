/**
 * O Assistente IA nas capturas: as conversas do CD Academias e a API simulada.
 *
 * Três conversas guardadas (as presenças de quarta ditas ao assistente, um
 * plano de treino e um exercício desenhado) e uma resposta em streaming para
 * o minichat, quando a cena escreve na caixa. Nada disto vai a um modelo: as
 * respostas estão escritas aqui, na forma exata em que a API as devolve.
 */
import { em } from "./clube.mjs";
import { SAIDA_A_TRES, TREINO_DE_QUARTA } from "./tecnica.mjs";

const iso = (dia, hora) => em(dia, hora).toISOString();

/* -------------------------------------------------------------------------- */
/* As propostas                                                                */
/* -------------------------------------------------------------------------- */

/** O plantel dos Sub-13 do guião, na folha de presenças de quarta. */
const PLANTEL_SUB13 = [
  [1, "Afonso Lima"], [2, "Bernardo Costa"], [3, "Daniel Pinto"], [4, "Diogo Reis"], [5, "Duarte Matos"], [6, "Francisco Sá"],
  [7, "Gabriel Nunes"], [8, "Tomás Ferreira"], [9, "Henrique Melo"], [10, "João Brito"], [11, "Lourenço Faria"], [12, "Martim Rocha"],
  [13, "Rodrigo Leal"], [14, "Salvador Cruz"], [15, "Vicente Maia"], [16, "Gonçalo Vaz"],
];

const PRESENCAS = {
  id: "prop-presencas-quarta",
  kind: "ATTENDANCE",
  status: "PENDING",
  title: "Presenças · Sub-13 · quarta, 7 de outubro às 19:00",
  summary: "14 presentes, 1 falta justificada, 1 de baixa",
  view: {
    teamName: "Sub-13",
    quando: "quarta, 7 de outubro às 19:00",
    atletas: PLANTEL_SUB13.map(([numero, nome]) => ({
      athleteId: `a-${numero}`,
      nome,
      numero,
      estado: nome === "Lourenço Faria" ? "justified" : nome === "Salvador Cruz" ? "baixa" : "presente",
      motivo: nome === "Lourenço Faria" ? "Avisado pela família às 17:10" : null,
    })),
    faltas: [{ athleteId: "a-11", nome: "Lourenço Faria", tipo: "justified", motivo: "Avisado pela família às 17:10" }],
  },
  result: null,
  createdAt: iso("2026-10-07", "20:21"),
  confirmedAt: null,
  podeDesfazer: false,
};

const PLANO = {
  id: "prop-plano-sexta",
  kind: "TRAINING_PLAN",
  status: "PENDING",
  title: "Plano de treino · Sub-13 · sexta, 9 de outubro às 19:00",
  summary: "60 minutos, 4 blocos, com um exercício novo desenhado",
  view: {
    rotulo: "Plano de treino",
    linhas: [
      { rotulo: "Equipa", valor: "Sub-13" },
      { rotulo: "Treino", valor: "Sexta, 9 de outubro, 19:00 às 20:00, Campo 2" },
      { rotulo: "Foco", valor: "Passe e receção orientada, com pouco contacto por ser véspera de jogo" },
      { rotulo: "Duração", valor: "60 minutos" },
    ],
    blocos: [
      { nome: "Ativação com bola", minutos: 12, categoria: "Aquecimento", objetivo: "Mobilidade e primeiros toques", intensidade: 2, jogadores: "16 jogadores", notas: null, exercicio: { nome: "Rondo 4×1 em quadrado", novo: false, descricao: null, desenho: null } },
      { nome: "Passe e receção orientada", minutos: 18, categoria: "Técnica", objetivo: "Receber já virado para a baliza", intensidade: 3, jogadores: "4 grupos de 4", notas: "Trocar de lado a meio", exercicio: { nome: "Receção orientada em losango", novo: true, descricao: "Quatro jogadores num losango de 12 metros. O passe entra pelo vértice de baixo e a receção é sempre com o pé mais afastado, a sair para o cone seguinte.", desenho: SAIDA_A_TRES } },
      { nome: "Jogo reduzido 6×6", minutos: 20, categoria: "Jogo", objetivo: "Dois toques no meio-campo defensivo", intensidade: 3, jogadores: "6×6 com guarda-redes", notas: null, exercicio: { nome: "Jogo reduzido 6×6", novo: false, descricao: null, desenho: null } },
      { nome: "Retorno à calma", minutos: 10, categoria: "Recuperação", objetivo: "Alongamentos e conversa sobre o jogo de sábado", intensidade: 1, jogadores: null, notas: null, exercicio: null },
    ],
    avisos: [],
  },
  result: null,
  createdAt: iso("2026-10-08", "21:32"),
  confirmedAt: null,
  podeDesfazer: false,
  editavel: true,
};

const EXERCICIO = {
  id: "prop-exercicio-saida",
  kind: "EXERCISE",
  status: "PENDING",
  title: "Exercício · Saída a três com finalização",
  summary: "Futebol 9, 12 jogadores, 15 minutos",
  view: {
    rotulo: "Exercício",
    linhas: [
      { rotulo: "Nome", valor: "Saída a três com finalização" },
      { rotulo: "Tema", valor: "Saída de bola pelo guarda-redes e pelos centrais" },
      { rotulo: "Jogadores", valor: "12, em meio campo de futebol 9" },
      { rotulo: "Duração", valor: "15 minutos, em três séries de 4" },
      { rotulo: "Pontos-chave", valor: "O guarda-redes sai curto. Os laterais abrem antes de a bola sair. Quem recebe de frente procura logo o terceiro homem." },
    ],
    desenho: SAIDA_A_TRES,
    avisos: [],
  },
  result: null,
  createdAt: iso("2026-10-06", "18:12"),
  confirmedAt: null,
  podeDesfazer: false,
  editavel: true,
};

const CONVOCATORIA = {
  id: "prop-convocatoria-sabado",
  kind: "CALLUPS",
  status: "PENDING",
  title: "Convocatória · Sub-13 · sábado, 10 de outubro às 15:00 vs União da Serra",
  summary: "16 convocados, os mesmos do último jogo sem o Salvador Cruz",
  view: {
    teamName: "Sub-13",
    quando: "sábado, 10 de outubro às 15:00",
    adversario: "União da Serra",
    convocados: PLANTEL_SUB13.filter(([, nome]) => nome !== "Salvador Cruz").map(([numero, nome]) => ({
      athleteId: `a-${numero}`,
      nome,
      numero,
      posicao: numero === 1 ? "GR" : numero <= 5 ? "DEF" : numero <= 11 ? "MED" : "AVA",
    })),
    deFora: ["Salvador Cruz (de baixa)"],
    jaSubmetida: false,
  },
  result: null,
  createdAt: iso("2026-10-08", "21:40"),
  confirmedAt: null,
  podeDesfazer: false,
};

const COMUNICADO = {
  id: "prop-comunicado-sabado",
  kind: "ANNOUNCEMENT",
  status: "PENDING",
  title: "Comunicado · Sábado jogamos em casa",
  summary: "Para as famílias dos Sub-13, por notificação",
  view: {
    rotulo: "Comunicado",
    linhas: [
      { rotulo: "Para", valor: "Famílias dos Sub-13" },
      { rotulo: "Título", valor: "Sábado jogamos em casa" },
      {
        rotulo: "Texto",
        valor:
          "Boa tarde a todos.\n\nEste sábado, 10 de outubro, os Sub-13 jogam em casa contra a União da Serra, às 15:00. A concentração é às 14:15 no Campo 1, com o equipamento principal.\n\nQuem não puder ir, por favor avise pela app até sexta à noite.\n\nObrigado,\nCD Academias",
      },
    ],
    avisos: ["Sai logo por notificação às famílias ao confirmar."],
  },
  result: null,
  createdAt: iso("2026-10-09", "17:38"),
  confirmedAt: null,
  podeDesfazer: false,
  editavel: true,
};

/* -------------------------------------------------------------------------- */
/* As conversas                                                                */
/* -------------------------------------------------------------------------- */

const mensagem = (id, role, text, dia, hora, blocks = []) => ({ id, role, text, blocks, model: role === "ASSISTANT" ? "gpt-6-luna" : null, createdAt: iso(dia, hora) });

export const CONVERSAS = {
  "conv-presencas": {
    id: "conv-presencas",
    title: "Presenças do treino de hoje",
    createdAt: iso("2026-10-07", "20:20"),
    updatedAt: iso("2026-10-07", "20:21"),
    messages: [
      mensagem("m1", "USER", "No treino de hoje faltou o Lourenço, a mãe avisou. O Salvador continua de baixa. Os outros estiveram todos.", "2026-10-07", "20:20"),
      mensagem("m2", "ASSISTANT", "Preparei a folha de presenças de hoje: 14 presentes, a falta do Lourenço Faria fica justificada pelo aviso da família e o Salvador Cruz fica de baixa. Confirma quando quiseres.", "2026-10-07", "20:21", [{ type: "proposta", id: PRESENCAS.id }]),
    ],
    proposals: [PRESENCAS],
  },
  "conv-plano": {
    id: "conv-plano",
    title: "Plano do treino de sexta",
    createdAt: iso("2026-10-08", "21:30"),
    updatedAt: iso("2026-10-08", "21:32"),
    messages: [
      mensagem("m3", "USER", "Planeia o treino de sexta dos Sub-13. Quero trabalhar passe e receção, sem muito contacto porque sábado há jogo.", "2026-10-08", "21:30"),
      mensagem("m4", "ASSISTANT", "Está pronto para confirmares. Um treino de 60 minutos em quatro blocos, com um exercício novo de receção orientada que fica na biblioteca do clube.", "2026-10-08", "21:32", [{ type: "proposta", id: PLANO.id }]),
    ],
    proposals: [PLANO],
  },
  "conv-exercicio": {
    id: "conv-exercicio",
    title: "Exercício de saída de bola",
    createdAt: iso("2026-10-06", "18:10"),
    updatedAt: iso("2026-10-06", "18:12"),
    messages: [
      mensagem("m5", "USER", "Cria um exercício de saída de bola a três para os Sub-13, com finalização, 12 jogadores em meio campo.", "2026-10-06", "18:10"),
      mensagem("m6", "ASSISTANT", "Desenhei o exercício no campo de futebol 9, em quatro momentos. Ao confirmar entra na biblioteca do clube e podes usá-lo num plano de treino.", "2026-10-06", "18:12", [{ type: "proposta", id: EXERCICIO.id }]),
    ],
    proposals: [EXERCICIO],
  },
  "conv-convocatoria": {
    id: "conv-convocatoria",
    title: "Convocatória para sábado",
    createdAt: iso("2026-10-08", "21:38"),
    updatedAt: iso("2026-10-08", "21:40"),
    messages: [
      mensagem("m7", "USER", "O Salvador saiu do treino com dor no tornozelo, fica de fora. Convoca para sábado os mesmos do último jogo menos ele.", "2026-10-08", "21:38"),
      mensagem("m8", "ASSISTANT", "O Salvador Cruz já está de baixa no boletim clínico, por isso não registei nada de novo. A convocatória para sábado contra a União da Serra leva os 16 do último jogo sem ele. Confirmar guarda a lista; submeter às famílias faz-se na página do jogo.", "2026-10-08", "21:40", [{ type: "proposta", id: CONVOCATORIA.id }]),
    ],
    proposals: [CONVOCATORIA],
  },
  "conv-comunicado": {
    id: "conv-comunicado",
    title: "Aviso aos pais sobre o jogo",
    createdAt: iso("2026-10-09", "17:36"),
    updatedAt: iso("2026-10-09", "17:38"),
    messages: [
      mensagem("m9", "USER", "Avisa os pais dos Sub-13 que sábado jogamos em casa às 15h e a concentração é às 14h15 no Campo 1.", "2026-10-09", "17:36"),
      mensagem("m10", "ASSISTANT", "Escrevi o comunicado para as famílias dos Sub-13. Lê o texto e muda o que quiseres antes de confirmar; sai por notificação assim que confirmares.", "2026-10-09", "17:38", [{ type: "proposta", id: COMUNICADO.id }]),
    ],
    proposals: [COMUNICADO],
  },
  "conv-pergunta": {
    id: "conv-pergunta",
    title: "Quem faltou mais em setembro",
    createdAt: iso("2026-10-08", "21:14"),
    updatedAt: iso("2026-10-08", "21:15"),
    messages: [
      mensagem("m11", "USER", "Quem faltou mais aos treinos dos Sub-13 em setembro? E quem está indisponível para sábado?", "2026-10-08", "21:14"),
      mensagem(
        "m12",
        "ASSISTANT",
        "Em setembro os Sub-13 tiveram 9 treinos. Quem mais faltou: Lourenço Faria, 3 faltas (2 justificadas), Martim Rocha, 2 faltas, e Gonçalo Vaz, 1 falta. Os outros 13 estiveram em todos.\n\nPara sábado está indisponível o Salvador Cruz, de baixa desde 1 de outubro. Não há mais ninguém condicionado.",
        "2026-10-08",
        "21:15",
      ),
    ],
    proposals: [],
  },
};

const resumo = (c, agora) => ({
  id: c.id,
  title: c.title,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
  pendentes: new Date(c.updatedAt) <= agora ? c.proposals.filter((p) => p.status === "PENDING").length : 0,
});

/* -------------------------------------------------------------------------- */
/* A API                                                                       */
/* -------------------------------------------------------------------------- */

/** Um evento do streaming, como a API o escreve. */
const evento = (nome, dados) => `event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`;

export function criarAssistente(clube) {
  const agora = clube.agora;
  const lista = Object.values(CONVERSAS)
    .filter((c) => new Date(c.createdAt) <= agora)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((c) => resumo(c, agora));

  return {
    GET: {
      "/api/adjunto/estado": { ligado: true, voz: true, semChave: false, nome: "Assistente IA" },
      "/api/adjunto/conversas": lista,
    },
    PADROES: [
      [/^\/api\/adjunto\/conversas\/([^/]+)$/, (m) => {
        const c = CONVERSAS[m[1]];
        return c && { id: c.id, title: c.title, messages: c.messages, proposals: c.proposals, imports: [] };
      }],
    ],
    /**
     * As escritas: uma conversa nova e a resposta em streaming à mensagem que a
     * cena escreve no minichat. A resposta é a das presenças de quarta.
     */
    responder(metodo, caminho) {
      if (metodo !== "POST") return null;
      if (caminho === "/api/adjunto/conversas") {
        return { status: 200, json: { id: "conv-nova", title: "Conversa nova", createdAt: agora.toISOString(), updatedAt: agora.toISOString(), pendentes: 0 } };
      }
      const m = caminho.match(/^\/api\/adjunto\/conversas\/([^/]+)\/mensagens$/);
      if (m) {
        const corpo =
          evento("inicio", { conversationId: m[1], messageId: "m-nova" }) +
          evento("ferramenta", { nome: "propor_presencas" }) +
          evento("texto", { delta: CONVERSAS["conv-presencas"].messages[1].text }) +
          evento("proposta", { proposta: PRESENCAS }) +
          evento("fim", { messageId: "m-resposta", modelo: "gpt-6-luna", nivel: "leve", acao: "presencas" });
        return { status: 200, tipo: "text/event-stream; charset=utf-8", corpo };
      }
      return null;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* As cenas                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Abre uma conversa do histórico. No telemóvel a lista está atrás do botão
 * "Conversas", e a conversa abre com o fim à vista (o botão Confirmar); para a
 * captura volta-se ao início, onde está o pedido da pessoa e o cabeçalho do cartão.
 */
const abrirConversa = (titulo, espera = "Por confirmar", doInicio = false) => async (page) => {
  const botaoLista = page.getByRole("button", { name: /^Conversas/ });
  if (await botaoLista.count()) await botaoLista.first().click();
  await page.getByRole("button", { name: titulo }).first().click();
  await page.getByText(espera).first().waitFor();
  if (doInicio) {
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      for (const el of document.querySelectorAll("div, main")) {
        if (el.scrollHeight > el.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = 0;
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(300);
  }
};

/** Uma cena da página do assistente, igual no computador e no telemóvel. */
const cenaDaPagina = ({ id, descricao, agora, titulo, espera, focos = {} }) => ({
  id,
  descricao,
  agora,
  url: "/assistente",
  preparar: abrirConversa(titulo, espera),
  focos: { cartao, ...focos },
  telemovel: { preparar: abrirConversa(titulo, espera, true), focos: { cartao } },
});

const cartao = (p) => p.locator("section[aria-label]", { hasText: "Por confirmar" }).first();

export const CENAS_ASSISTENTE = [
  {
    id: "con-assistente",
    descricao: "O Assistente IA na página inteira: as presenças de quarta ditas numa frase e a folha pronta a confirmar",
    agora: em("2026-10-07", "20:22"),
    url: "/assistente",
    preparar: abrirConversa("Presenças do treino de hoje"),
    focos: {
      cartao: cartao,
      pedido: (p) => p.getByText("No treino de hoje faltou o Lourenço", { exact: false }).first(),
      confirmar: (p) => p.getByRole("button", { name: "Confirmar" }).first(),
    },
    telemovel: {
      preparar: abrirConversa("Presenças do treino de hoje", "Por confirmar", true),
      focos: { cartao: cartao },
    },
  },
  {
    id: "con-assistente-plano",
    descricao: "Um plano de treino pedido ao Assistente IA: quatro blocos e um exercício novo desenhado",
    agora: em("2026-10-08", "21:33"),
    url: "/assistente",
    preparar: abrirConversa("Plano do treino de sexta"),
    focos: {
      cartao: cartao,
      blocos: (p) => p.getByText("Receção orientada em losango", { exact: false }).first(),
    },
  },
  {
    id: "con-assistente-exercicio",
    descricao: "Um exercício criado pelo Assistente IA, com o desenho no campo de futebol 9",
    agora: em("2026-10-06", "18:13"),
    url: "/assistente",
    preparar: abrirConversa("Exercício de saída de bola"),
    focos: {
      cartao: cartao,
      desenho: (p) => cartao(p).locator("svg").first(),
    },
  },
  cenaDaPagina({
    id: "con-assistente-convocatoria",
    descricao: "Uma lesão dita e a convocatória de sábado montada a partir do último jogo, pronta a confirmar",
    agora: em("2026-10-08", "21:41"),
    titulo: "Convocatória para sábado",
    focos: { convocados: (p) => p.getByText("Tomás Ferreira", { exact: true }).first() },
  }),
  cenaDaPagina({
    id: "con-assistente-comunicado",
    descricao: "Um comunicado às famílias escrito pelo Assistente IA, para rever antes de sair",
    agora: em("2026-10-09", "17:39"),
    titulo: "Aviso aos pais sobre o jogo",
    focos: { texto: (p) => p.getByText("Boa tarde a todos.", { exact: false }).first() },
  }),
  {
    id: "con-assistente-pergunta",
    descricao: "Uma pergunta aos dados do clube: quem faltou mais em setembro e quem está indisponível para sábado",
    agora: em("2026-10-08", "21:16"),
    url: "/assistente",
    preparar: abrirConversa("Quem faltou mais em setembro", "Em setembro os Sub-13"),
    focos: {
      resposta: (p) => p.getByText("Em setembro os Sub-13", { exact: false }).first(),
    },
  },
  {
    id: "con-assistente-mini",
    descricao: "O minichat do Assistente IA aberto por cima da página do treino de quarta, com as presenças a confirmar",
    agora: em("2026-10-07", "20:22"),
    url: `/treinos/${TREINO_DE_QUARTA}`,
    preparar: async (page) => {
      await page.getByRole("button", { name: "Abrir Assistente IA" }).click();
      const caixa = page.getByPlaceholder("Escreve, fala ou larga um ficheiro");
      await caixa.waitFor();
      await caixa.fill("No treino de hoje faltou o Lourenço, a mãe avisou. O Salvador continua de baixa.");
      await page.getByRole("button", { name: "Enviar" }).click();
      await page.getByText("Por confirmar").first().waitFor();
    },
    focos: {
      minichat: (p) => p.locator("section[aria-label], div", { has: p.getByText("Por confirmar") }).filter({ hasText: "Assistente IA" }).last(),
      cartao: cartao,
    },
  },
];

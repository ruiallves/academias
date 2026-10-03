/**
 * As cenas: uma por captura.
 *
 * Cada cena diz a hora a que o relógio fica parado, o endereço da consola, o que
 * é preciso fazer na página antes de fotografar (`preparar`) e os focos a medir.
 * Os dados vêm de `clube.mjs`, que sabe o que já aconteceu a essa hora.
 */
import { em } from "./clube.mjs";
import { EX_SAIDA, TREINO_DE_QUARTA } from "./tecnica.mjs";
import { JOGO_DE_SABADO } from "./jogos.mjs";

const quadro = (n) => ({
  id: `con-quadro-${n}`,
  descricao: `Editor tático: "Saída a três e finalização" em futebol 9, frame ${n} de 4`,
  agora: em("2026-10-06", "18:30"),
  url: `/modalidades/sp-futebol/exercicios/${EX_SAIDA}`,
  preparar: async (page) => {
    const regua = page.locator("div", { has: page.getByText("Frames", { exact: true }) }).last();
    await regua.getByRole("button", { name: String(n), exact: true }).click();
  },
  focos: {
    campo: (p) => p.locator("svg:has(g[data-id])"),
  },
});

/** A caixa mais pequena da página que contém os dois textos: um painel, um cartão, uma linha. */
const caixa = (page, a, b) => page.locator("div, section, article, ul, li").filter({ hasText: a }).filter({ hasText: b }).last();

const linha = (page, texto) => page.locator("tbody tr, li", { hasText: texto });

export const CENAS = [
  {
    id: "con-mensalidades-antes",
    descricao: "Mensalidades de outubro, com a do Tomás Ferreira por pagar",
    agora: em("2026-10-05", "09:12"),
    url: "/mensalidades",
    focos: {
      "linha-tomas": (p) => linha(p, "Tomás Ferreira"),
      "estado-tomas": (p) => linha(p, "Tomás Ferreira").locator("td").nth(3),
      total: (p) => p.getByText("Cobrado", { exact: true }).locator("xpath=ancestor::*[self::div or self::section][2]"),
    },
  },
  {
    id: "con-mensalidades-depois",
    descricao: "Mensalidades de outubro, com a do Tomás Ferreira paga por MB WAY pela mãe",
    agora: em("2026-10-05", "09:15"),
    url: "/mensalidades",
    focos: {
      "linha-tomas": (p) => linha(p, "Tomás Ferreira"),
      "estado-tomas": (p) => linha(p, "Tomás Ferreira").locator("td").nth(3),
      total: (p) => p.getByText("Cobrado", { exact: true }).locator("xpath=ancestor::*[self::div or self::section][2]"),
    },
  },
  {
    id: "con-visao-geral",
    descricao: "Visão geral da direção na segunda de manhã, com a lista do que precisa de atenção",
    agora: em("2026-10-12", "09:00"),
    url: "/",
    /*
     * Três textos desta página estão escritos à mão no código da consola
     * (`routes/director/Overview.tsx`): o nome "Academia Life Club" por cima da
     * saudação, e "agosto" em "Cobrado em agosto" e "Cobrança de agosto". Num
     * clube chamado CD Academias, em outubro, ficam errados. Trocam-se aqui, na
     * página já desenhada; os números por baixo são os de outubro, calculados
     * pela consola. Quando o produto for corrigido, apaga-se este bloco.
     */
    remendarTexto: {
      "Academia Life Club": "CD Academias",
      "Cobrado em agosto": "Cobrado em outubro",
      "Cobrança de agosto": "Cobrança de outubro",
    },
    focos: {
      atencao: (p) => caixa(p, "Precisa de atenção", "mensalidades vencidas"),
      "linha-mensalidades": (p) => p.locator("li", { hasText: "mensalidades vencidas" }),
      semana: (p) => caixa(p, "Esta semana", "Seniores"),
    },
  },
  {
    id: "con-presencas-antes",
    descricao: "Presenças dos Sub-13 na quarta à noite: o treino das 19:00 por registar, com um aviso de falta da família",
    agora: em("2026-10-07", "20:20"),
    clube: { folhaDeQuarta: false },
    url: "/presencas?equipa=t-sub13",
    focos: {
      "linha-treino": (p) => p.locator("li", { hasText: "Registar" }),
      lista: (p) => p.locator("ul", { has: p.locator("li", { hasText: "Registar" }) }),
    },
  },
  {
    id: "con-presencas-depois",
    descricao: "Folha de presenças do treino de quarta dos Sub-13: 14 de 15 presentes, a falta avisada já justificada e um atleta de baixa",
    agora: em("2026-10-07", "20:20"),
    clube: { folhaDeQuarta: false },
    url: "/presencas?equipa=t-sub13",
    preparar: async (page) => {
      await page.locator("li button", { hasText: "Registar" }).click();
      await page.getByRole("dialog").waitFor();
    },
    focos: {
      "linha-tomas": (p) => p.getByRole("dialog").locator("li", { hasText: "Tomás Ferreira" }),
      lista: (p) => p.getByRole("dialog").locator("ul"),
      contagem: (p) => p.getByRole("dialog").getByText("14 de 15 presentes"),
    },
  },
  quadro(1),
  quadro(2),
  quadro(3),
  quadro(4),
  {
    id: "con-plano-sessao",
    descricao: "Plano de sessão do treino de quarta dos Sub-13: quatro blocos, 75 minutos",
    agora: em("2026-10-06", "18:40"),
    url: `/treinos/${TREINO_DE_QUARTA}`,
    focos: {
      blocos: (p) => caixa(p, "Estrutura do treino", "Retorno à calma"),
      "bloco-saida": (p) => p.getByText("Saída a três e finalização", { exact: true }).first().locator("xpath=ancestor::*[self::li or self::div][2]"),
      carga: (p) => caixa(p, "Carga estimada", "min planeados"),
    },
  },
  {
    id: "con-planeamento",
    descricao: "Planeamento dos Sub-13: microciclo de 5 a 11 de outubro, com a carga e os dias MD",
    agora: em("2026-10-06", "18:45"),
    url: "/treinos?equipa=t-sub13&vista=micro",
    focos: {
      carga: (p) => caixa(p, "Carga média", "/100"),
      objetivos: (p) => caixa(p, "O que se treina", "Organização ofensiva"),
      semana: (p) => p.getByText("MD-3").locator("xpath=ancestor::div[3]"),
      quarta: (p) => p.getByText("MD-3").locator("xpath=ancestor::div[2]"),
    },
  },
  {
    id: "con-planeamento-meso",
    descricao: "Planeamento dos Sub-13: mesociclo Competição I, com a carga semana a semana",
    agora: em("2026-10-06", "18:45"),
    url: "/treinos?equipa=t-sub13&vista=meso",
    focos: {
      carga: (p) => caixa(p, "Carga por semana", "já treinado"),
    },
  },
  {
    id: "con-jogo-visao",
    descricao: "Página do jogo de sábado dos Sub-13 contra a União da Serra (2-1): visão geral",
    agora: em("2026-10-11", "11:00"),
    url: `/jogos/${JOGO_DE_SABADO}`,
    focos: {
      resultado: (p) => p.getByText("Vitória", { exact: true }).locator("xpath=.."),
      onze: (p) => caixa(p, "Quem joga", "T. Ferreira"),
      passos: (p) => p.getByText("Está tudo feito").locator("xpath=ancestor::*[self::section or self::div][3]"),
    },
  },
  {
    id: "con-jogo-ficha",
    descricao: "Página do jogo de sábado, área Pós-jogo: resultado 2-1 e a ficha preenchida",
    agora: em("2026-10-11", "11:00"),
    url: `/jogos/${JOGO_DE_SABADO}?aba=pos`,
    // A linha do Tomás (n.º 8) fica abaixo da dobra: desce-se o bastante para ela
    // caber, sem tirar o resultado de cima.
    preparar: async (page) => {
      await page.mouse.move(1100, 600);
      await page.mouse.wheel(0, 118);
      await page.waitForTimeout(300);
    },
    focos: {
      "linha-tomas": (p) => p.locator("li", { hasText: "Tomás Ferreira" }),
      resultado: (p) => p.getByText("Vitória", { exact: true }).locator("xpath=.."),
    },
  },
  {
    id: "con-atleta",
    descricao: "Ficha do Tomás Ferreira, separador Visão geral",
    agora: em("2026-10-11", "11:10"),
    url: "/atletas/a-tomas-ferreira",
    focos: {
      cabecalho: (p) => p.getByRole("heading", { name: "Tomás Ferreira" }).locator("xpath=ancestor::div[2]"),
      "ultimos-jogos": (p) => p.locator("ul", { has: p.getByText("vs União da Serra") }),
      "jogo-sabado": (p) => p.locator("li", { hasText: "vs União da Serra" }),
      assiduidade: (p) => p.getByText("12 de 13 treinos").locator("xpath=ancestor::div[2]"),
    },
  },
  {
    id: "con-atleta-avaliacoes",
    descricao: "Avaliações dos Sub-13 no 1.º período: a do Tomás Ferreira entregue, com 4, 4, 4 e 5",
    agora: em("2026-10-11", "11:15"),
    url: "/avaliacoes",
    // A página abre na primeira equipa e em "Todos": escolhe-se os Sub-13 e as
    // entregues, que é onde está a do Tomás.
    preparar: async (page) => {
      await page.locator("select").nth(1).selectOption("t-sub13");
      await page.getByRole("button", { name: /Entregues/ }).click();
    },
    focos: {
      "linha-tomas": (p) => p.locator("tbody tr", { hasText: "Tomás Ferreira" }),
      tabela: (p) => p.locator("table"),
    },
  },
  {
    id: "con-avaliacao",
    descricao: "Avaliação por competências do Tomás Ferreira, 1.º período de 2026/27",
    agora: em("2026-10-11", "11:15"),
    url: "/avaliacoes",
    preparar: async (page) => {
      await page.locator("select").nth(1).selectOption("t-sub13");
      await page.getByRole("button", { name: /Entregues/ }).click();
      await page.locator("tbody tr", { hasText: "Tomás Ferreira" }).getByRole("button").last().click();
      await page.getByRole("dialog").waitFor();
    },
    focos: {
      avaliacao: (p) => p.getByRole("dialog"),
      competencias: (p) => p.getByRole("dialog").getByText("Técnica", { exact: true }).locator("xpath=ancestor::div[2]"),
    },
  },
  {
    id: "con-convocatoria",
    descricao: "Convocatória do jogo de sábado: 16 convocados, 15 confirmados e 1 que não pode",
    agora: em("2026-10-09", "22:10"),
    url: "/convocatorias",
    focos: {
      respostas: (p) => p.getByText("confirmaram").locator("xpath=ancestor::div[2]"),
      "linha-tomas": (p) => p.locator("li", { hasText: "Tomás Ferreira" }),
      recusa: (p) => p.getByText("Continua com febre").locator("xpath=.."),
    },
  },
  {
    id: "con-clinico",
    descricao: "Departamento clínico: boletins, com o Salvador Cruz de baixa por entorse",
    agora: em("2026-10-12", "09:30"),
    url: "/clinico",
    focos: {
      baixa: (p) => p.locator("tbody tr", { hasText: "Salvador Cruz" }),
      condicionado: (p) => p.locator("tbody tr", { hasText: "Jorge Cardoso" }),
    },
  },
  {
    id: "con-clinico-consultas",
    descricao: "Departamento clínico: consultas e exames marcados para a semana",
    agora: em("2026-10-12", "09:30"),
    url: "/clinico/consultas",
    focos: {
      calendario: (p) => caixa(p, "Rafael Cunha", "Bruno Ramos"),
      "consulta-salvador": (p) => p.getByText("17:30").locator("xpath=.."),
    },
  },
  {
    id: "con-scouting",
    descricao: "Scouting: prospetos em observação",
    agora: em("2026-10-12", "09:40"),
    url: "/scouting/prospects",
    focos: {
      lista: (p) => p.locator("table"),
      "linha-trial": (p) => p.locator("tbody tr", { hasText: "Ivan Marçal" }),
    },
  },
  {
    id: "con-socios",
    descricao: "Sócios: o livro do clube, com as quotas de cada um",
    agora: em("2026-10-12", "09:45"),
    url: "/socios",
    focos: {
      "linha-carla": (p) => p.locator("tbody tr", { hasText: "Carla Ferreira" }),
      "quota-carla": (p) => p.locator("tbody tr", { hasText: "Carla Ferreira" }).getByText("Out 2026"),
    },
  },
  {
    id: "con-inventario",
    descricao: "Inventário: os artigos do clube, com o stock de cada um",
    agora: em("2026-10-12", "09:30"),
    url: "/inventario/artigos",
    focos: {
      lista: (p) => p.locator("table"),
      "stock-baixo": (p) => p.locator("tbody tr", { hasText: "Bola de futebol tamanho 5" }),
      "tamanhos-camisola": (p) => p.locator("tbody tr", { hasText: "Camisola de jogo principal" }),
    },
  },
  {
    id: "con-inventario-painel",
    descricao: "Inventário: o painel, com o que há a repor e os últimos movimentos",
    agora: em("2026-10-12", "09:30"),
    url: "/inventario",
    focos: {
      repor: (p) => caixa(p, "A repor", "Saco de gelo instantâneo"),
      "stock-baixo": (p) => p.locator("tbody tr", { hasText: "Bola de futebol tamanho 5" }),
      movimentos: (p) => caixa(p, "Últimos movimentos", "Meias de jogo"),
    },
  },
  {
    id: "con-contas",
    descricao: "Contas do clube: saldo, receitas e despesas dos últimos meses e a previsão",
    agora: em("2026-10-12", "09:30"),
    url: "/contas",
    focos: {
      saldo: (p) => caixa(p, "Saldo atual", "Despesas este mês"),
      grafico: (p) => caixa(p, "Receitas e despesas", "out 26"),
      previsao: (p) => caixa(p, "Previsão", "Saldo projetado"),
      movimentos: (p) => caixa(p, "Próximas despesas", "12 bolas tamanho 5"),
      categorias: (p) => caixa(p, "Este mês, por categoria", "Transportes"),
    },
  },
  {
    id: "con-contas-movimentos",
    descricao: "Contas: os movimentos de setembro e outubro",
    agora: em("2026-10-12", "09:30"),
    url: "/contas/movimentos",
    focos: {
      movimentos: (p) => p.locator("table"),
      mensalidades: (p) => p.locator("tbody tr", { hasText: "Mensalidades de outubro" }),
    },
  },
  {
    id: "con-comunicacao",
    descricao: "Comunicação: o aviso de sexta aos Sub-13, lido por 41 de 46",
    agora: em("2026-10-09", "22:10"),
    url: "/comunicacao",
    focos: {
      leitura: (p) => p.getByText("41 de 46 leram").locator("xpath=.."),
      aviso: (p) => p.locator("li", { hasText: "Jogo de sábado em casa" }),
    },
  },
];

/** As cenas que se tiram também no telemóvel (`--telemovel`), por esta ordem. */
export const CENAS_TELEMOVEL = [
  "con-visao-geral", "con-mensalidades-depois", "con-quadro-1", "con-quadro-2", "con-quadro-3", "con-quadro-4",
  "con-planeamento", "con-presencas-depois", "con-jogo-ficha", "con-atleta-avaliacoes", "con-comunicacao",
  "con-inventario", "con-contas",
];

/* -------------------------------------------------------------------------- */
/* Ajustes do telemóvel                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Leva um elemento para o primeiro ecrã. `topo` deixa-o logo abaixo da barra de
 * cima da consola (56 px); senão fica ao centro.
 */
async function rolarAte(loc, topo = false) {
  await loc.first().evaluate((el, t) => {
    el.scrollIntoView({ block: t ? "start" : "center" });
    if (t) window.scrollBy(0, -72);
  }, topo);
  await loc.page().waitForTimeout(300);
}

const cartao = (page, texto) => page.locator("li", { hasText: texto });

const AJUSTES_TELEMOVEL = {
  "con-mensalidades-depois": {
    // A tabela vira cartões e o Tomás fica abaixo das métricas: desce-se até ele.
    preparar: async (page) => rolarAte(cartao(page, "Tomás Ferreira")),
    focos: {
      "linha-tomas": (p) => cartao(p, "Tomás Ferreira"),
      "estado-tomas": (p) => cartao(p, "Tomás Ferreira").getByText("Pago", { exact: true }),
    },
  },
  "con-planeamento": {
    preparar: async (page) => rolarAte(page.getByText("5–11 out", { exact: true }), true),
    focos: {
      micro: (p) => caixa(p, "5–11 out", "Organização ofensiva"),
      semana: (p) => p.getByText("MD-5").locator("xpath=ancestor::div[2]"),
    },
  },
  "con-contas": {
    focos: {
      saldo: (p) => caixa(p, "Saldo atual", "Despesas este mês"),
      grafico: (p) => caixa(p, "Receitas e despesas", "out"),
    },
  },
  "con-presencas-depois": {
    // A folha rola dentro da janela: traz-se o Tomás para o meio, com o rodapé à vista.
    preparar: async (page) => {
      await page.locator("li button", { hasText: "Registar" }).click();
      await page.getByRole("dialog").waitFor();
      await rolarAte(page.getByRole("dialog").locator("li", { hasText: "Tomás Ferreira" }));
    },
  },
  "con-jogo-ficha": {
    preparar: async (page) => rolarAte(cartao(page, "Tomás Ferreira")),
    focos: {
      "linha-tomas": (p) => cartao(p, "Tomás Ferreira"),
    },
  },
  "con-atleta-avaliacoes": {
    preparar: async (page) => {
      await page.locator("select").nth(1).selectOption("t-sub13");
      await page.getByRole("button", { name: /Entregues/ }).click();
      await rolarAte(cartao(page, "Tomás Ferreira"));
    },
    focos: {
      "linha-tomas": (p) => cartao(p, "Tomás Ferreira"),
    },
  },
  "con-inventario": {
    focos: {
      lista: (p) => p.locator("ul", { has: cartao(p, "Camisola de jogo principal") }),
      "stock-baixo": (p) => cartao(p, "Camisola de jogo principal"),
    },
  },
};

for (const [id, ajuste] of Object.entries(AJUSTES_TELEMOVEL)) {
  const cena = CENAS.find((c) => c.id === id);
  if (cena) cena.telemovel = ajuste;
}

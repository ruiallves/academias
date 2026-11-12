/**
 * Que modelo faz cada coisa.
 *
 * ## A regra
 *
 * O modelo pequeno faz o trabalho óbvio e o forte só entra quando é preciso.
 * Marcar presenças a partir de uma lista de nomes, registar "dor no joelho",
 * responder "quando é o próximo jogo" são tarefas de listas e datas, e o modelo
 * mais barato chega. Cruzar presenças com o boletim clínico para montar uma
 * convocatória, ou separar três pedidos ditos numa frase, já pede o médio.
 * Perceber as colunas de um Excel desarrumado, uma vez por ficheiro e com um
 * erro caro, é do forte.
 *
 * A diferença de preço entre níveis é de 10 a 20 vezes, e é isto que faz o
 * pacote com IA dar dinheiro em clubes grandes: ver o estudo de 11/11/2026.
 *
 * ## Como se decide
 *
 * Em três camadas, por esta ordem:
 *
 *   1. **Pelo sítio.** Quem carrega em "Ditar presenças" dentro de um treino já
 *      disse o que vai fazer: a ação vem no pedido e não se classifica nada.
 *      Um ficheiro largado no chat é importação.
 *   2. **Pelo classificador.** No chat livre, uma chamada curta ao modelo leve
 *      diz que tipo de pedido é, e a tabela abaixo encaminha.
 *   3. **Pela subida.** Quando o modelo pequeno falha (devolve uma ação que não
 *      passa na validação, pede ajuda pela ferramenta própria, ou a pessoa
 *      recusa a proposta), o pedido seguinte vai um nível acima.
 *
 * Cada ação é uma linha desta tabela. Mudar uma ação de modelo é mudar uma
 * linha, e é o que se vai fazer quando houver dados de uso real.
 */

export type Nivel = "leve" | "medio" | "forte";

/** O que a OpenAI aceita em `reasoning.effort`. `none` só nos modelos que o têm. */
export type Esforco = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const MODELOS_POR_OMISSAO: Record<Nivel, string> = {
  leve: "gpt-6-luna",
  medio: "gpt-6.1-terra",
  forte: "gpt-6.1-sol",
};

export const ACOES = [
  "presencas",
  "lesao",
  "convocatoria_simples",
  "convocatoria_criterios",
  "agenda",
  "acao",
  "pergunta_simples",
  "pergunta_cruzada",
  "varias_acoes",
  "conversa",
  "importacao",
] as const;

export type Acao = (typeof ACOES)[number];

export type Rota = {
  nivel: Nivel;
  esforco: Esforco;
  /** Que ferramentas o modelo vê. `"todas"` abre o conjunto inteiro. */
  ferramentas: readonly string[] | "todas";
};

const LEITURAS = ["equipas", "plantel", "treinos", "jogos", "agenda", "catalogo", "convocatoria", "lesionados", "perguntar", "precisar_de_ajuda"] as const;

export const ROTAS: Record<Acao, Rota> = {
  presencas: { nivel: "leve", esforco: "low", ferramentas: [...LEITURAS, "propor_presencas"] },
  lesao: { nivel: "leve", esforco: "low", ferramentas: [...LEITURAS, "propor_lesao"] },
  convocatoria_simples: { nivel: "leve", esforco: "low", ferramentas: [...LEITURAS, "propor_convocatoria"] },
  convocatoria_criterios: { nivel: "medio", esforco: "medium", ferramentas: "todas" },
  // Datas, horas e locais a cruzar com o que já está marcado: o médio acerta mais.
  agenda: { nivel: "medio", esforco: "medium", ferramentas: [...LEITURAS, "propor_acao"] },
  // Inscrever alguém, publicar um comunicado: formulários, o médio preenche-os com cuidado.
  acao: { nivel: "medio", esforco: "medium", ferramentas: [...LEITURAS, "propor_acao"] },
  pergunta_simples: { nivel: "leve", esforco: "low", ferramentas: LEITURAS },
  pergunta_cruzada: { nivel: "medio", esforco: "medium", ferramentas: LEITURAS },
  varias_acoes: { nivel: "medio", esforco: "medium", ferramentas: "todas" },
  conversa: { nivel: "leve", esforco: "low", ferramentas: LEITURAS },
  importacao: { nivel: "forte", esforco: "medium", ferramentas: [] },
};

/*
 * ## A rota de hoje (11/11/2026): uma só, no modelo leve
 *
 * O trabalho difícil deixou de ser do modelo: o formulário, a validação, os
 * nomes do plantel e o "não assumir" vivem no servidor. O modelo só percebe o
 * que a pessoa disse e passa os campos, e o leve chega para isso. Com todas as
 * ferramentas, sem classificador: o classificador enganava-se ("marca um jogo"
 * como conversa), o leve ficava sem a ferramenta, pedia ajuda, e o pedido subia
 * três modelos. Esforço médio e não baixo: no leve custa quase nada, e é o que
 * segura a qualidade.
 *
 * Quando o leve não consegue (pede ajuda, ou falha a mesma escrita duas vezes),
 * o pedido repete-se **uma vez** no médio. O forte não entra no chat: só no
 * mapeamento de colunas da importação, uma vez por ficheiro.
 *
 * A tabela `ROTAS` de cima fica como referência do que cada ação pede; quando
 * houver uso real (`AdjuntoUsage`), uma ação que suba muito pode ganhar rota
 * própria outra vez.
 */
export const ROTA_GERAL: Rota = { nivel: "leve", esforco: "medium", ferramentas: "todas" };
export const ROTA_REFORCO: Rota = { nivel: "medio", esforco: "medium", ferramentas: "todas" };
/**
 * O planeador de treinos (`planos.ts`): um pedido à parte, fora da conversa,
 * que escreve um plano inteiro com exercícios e desenhos no campo. É redação
 * longa com raciocínio espacial, e é raro (um por treino, no máximo): vai ao
 * forte. Estimativa (não medida): 5 a 12 cêntimos por plano; o uso real fica
 * em `AdjuntoUsage`, e se mostrar que o médio chega, muda-se aqui.
 *
 * Esforço baixo: o trabalho está na escrita do plano, não no raciocínio, e com
 * esforço médio o pedido passava dos dois minutos (12/11/2026).
 */
export const ROTA_PLANEADOR: Rota = { nivel: "forte", esforco: "low", ferramentas: [] };

const ORDEM: Nivel[] = ["leve", "medio", "forte"];

/** O nível acima. O forte já não sobe. */
export function subir(nivel: Nivel): Nivel {
  return ORDEM[Math.min(ORDEM.indexOf(nivel) + 1, ORDEM.length - 1)];
}

/** A rota de uma ação, já com a subida aplicada quando a conversa a pediu. */
export function rotaDe(acao: Acao, opcoes: { escalada?: boolean } = {}): Rota {
  const base = ROTAS[acao];
  if (!opcoes.escalada) return base;
  const nivel = subir(base.nivel);
  return { ...base, nivel, esforco: nivel === base.nivel ? base.esforco : "medium" };
}

/**
 * O classificador: uma frase, uma ação.
 *
 * Corre no modelo leve com saída estruturada, e custa uns três centésimos de
 * cêntimo. A descrição de cada ação é o que o modelo lê para decidir, por isso
 * está escrita para ele e não para nós.
 */
export const CLASSIFICADOR = {
  instrucoes: [
    "Classificas pedidos feitos ao assistente de um clube desportivo de formação em Portugal.",
    "Devolve só a categoria que melhor descreve o pedido inteiro.",
    "",
    "presencas: marcar presenças, faltas, atrasos ou justificações de um treino.",
    "lesao: registar uma lesão, dor, queixa ou indisponibilidade de um atleta.",
    "convocatoria_simples: convocar para um jogo com uma lista dada, ou copiar a convocatória anterior tirando ou pondo nomes.",
    "convocatoria_criterios: convocar com regras a cruzar (quem mais treinou, sem lesionados, por posição, equilíbrio de minutos).",
    "agenda: marcar, desmarcar, reativar ou mudar um treino, um jogo ou outro evento do calendário (datas, horas, locais, adversários).",
    "acao: outra escrita na consola que não é presenças, lesão, convocatória nem calendário: inscrever um atleta, publicar um comunicado ou aviso às famílias, e afins.",
    "pergunta_simples: uma pergunta de leitura direta (próximo jogo, quem está lesionado, quem faltou a um treino).",
    "pergunta_cruzada: uma pergunta que junta vários dados ou períodos (minutos por atleta desde janeiro, assiduidade por equipa).",
    "varias_acoes: dois ou mais pedidos de escrita na mesma mensagem (presenças e lesão, lesão e convocatória).",
    "conversa: cumprimentos, dúvidas sobre o que o assistente faz, ou um pedido que não cabe nas outras categorias.",
  ].join("\n"),
  schema: {
    type: "object",
    properties: {
      acao: { type: "string", enum: ACOES.filter((a) => a !== "importacao") },
    },
    required: ["acao"],
    additionalProperties: false,
  } as Record<string, unknown>,
};

/** Lê a resposta do classificador sem confiar nela cegamente. */
export function lerAcao(texto: string): Acao {
  try {
    const { acao } = JSON.parse(texto) as { acao?: string };
    return (ACOES as readonly string[]).includes(acao ?? "") && acao !== "importacao" ? (acao as Acao) : "conversa";
  } catch {
    return "conversa";
  }
}

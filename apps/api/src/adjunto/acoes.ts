import type { AdjuntoProposalKind } from "@prisma/client";
import type { Permission } from "../common/permissions";

/**
 * O registo das ações do Adjunto: o que ele sabe fazer, campo a campo.
 *
 * ## Porque é que é uma tabela
 *
 * "Marcar um jogo", "inscrever um atleta", "publicar um comunicado" são
 * formulários da consola. Em vez de uma ferramenta à mão por formulário, cada
 * um é uma linha aqui, com os campos que tem, quais são obrigatórios e de que
 * tipo são. A ferramenta `propor_acao` lê esta tabela: valida o que o modelo
 * mandou, preenche o que tem valor por omissão, resolve nomes (equipa, local,
 * prova) e, quando falta um campo obrigatório, **pergunta à pessoa** em vez de
 * inventar. Acrescentar uma ação nova é acrescentar uma linha.
 *
 * ## Os tipos de campo
 *
 * Decidem como o valor que vem do modelo se lê e se confirma:
 *   texto, textoLongo, numero, booleano, data (AAAA-MM-DD ou dd/mm/aaaa),
 *   hora (HH:MM), nif (9 algarismos), email, telefone,
 *   equipa (nome ou id de uma equipa que a pessoa vê),
 *   local (do catálogo do clube ou do horário da equipa),
 *   prova (do catálogo; "amigável" por omissão),
 *   escolha (uma das `opcoes`).
 */

export type TipoDeCampo =
  | "texto" | "textoLongo" | "numero" | "booleano" | "data" | "hora" | "nif" | "email" | "telefone"
  | "equipa" | "local" | "prova" | "escolha"
  /** Um ou mais balneários do catálogo, separados por vírgula. */
  | "balneario"
  /** Um tipo de evento do catálogo ("Estágio", "Reunião de pais"). */
  | "tipoEvento"
  /** Uma ou mais equipas, separadas por vírgula. */
  | "equipas"
  /** Uma pessoa do staff do clube (quem dá o treino). */
  | "staff"
  /** Um treino marcado (o sessionId), escolhido entre os próximos da equipa. */
  | "treino"
  /** Um jogo marcado (o matchId), dos próximos dois meses. */
  | "jogo"
  /** Uma secção da página de início do site (as fixas pelo nome, os banners pelo id). */
  | "seccao"
  /** Um banner da página de início do site (pelo id). */
  | "banner"
  /** Um produto da loja do site (pelo id). */
  | "produto"
  /** Um patrocinador do clube (pelo id). */
  | "patrocinador"
  /** Um recinto desenhado no Estádio do site (pelo id). */
  | "recinto";

/**
 * Um campo que só existe nalgumas condições, como no formulário da consola:
 * os balneários de um jogo só em casa (fora, é o que o adversário der).
 */
export type Condicao = { campo: string; igual: string };

export type Campo = {
  nome: string;
  rotulo: string;
  tipo: TipoDeCampo;
  obrigatorio: boolean;
  /** Para o modelo e para a pergunta à pessoa. */
  descricao?: string;
  /** Só em `escolha`. */
  opcoes?: { valor: string; label: string }[];
  /** Só se pergunta (e só conta) quando outro campo tem este valor. */
  soSe?: Condicao;
  /**
   * O valor quando a pessoa não diz nada, para os opcionais com uma resposta
   * óbvia (uma notícia não vai para destaque, um banner sem botão, a venda
   * abre já). Entra direto no cartão, que se muda com "Editar", em vez de
   * travar a proposta num formulário. "-" é "fica vazio". Os campos em que um
   * valor errado custa (local, prova, balneários, hora de fim, casa ou fora)
   * não têm omissão: perguntam-se sempre.
   */
  omissao?: string;
};

/** O campo aplica-se, dados os valores que já se sabem? Sem condição, sempre. */
export function aplicaSe(campo: Campo, dados: Record<string, unknown>): boolean {
  if (!campo.soSe) return true;
  const v = dados[campo.soSe.campo];
  const texto = typeof v === "boolean" ? (v ? "sim" : "não") : v === undefined ? "" : String(v);
  return texto === campo.soSe.igual;
}

export type Acao = {
  nome: string;
  rotulo: string;
  descricao: string;
  /** A permissão que a pessoa tem de ter. É a mesma que a consola exige para o mesmo gesto. */
  permissao: Permission;
  /** Outras permissões que também servem (os patrocinadores editam-se da Gestão ou do Website). */
  permissoesAlternativas?: Permission[];
  kind: AdjuntoProposalKind;
  campos: Campo[];
  /** Precisa de o clube ter o site no plano. Sem ele, a ação diz que não há site. */
  precisaDoSite?: boolean;
};

/** A pessoa pode fazer esta ação? Pelas mesmas permissões que a consola pede. */
export function podeFazer(acao: Acao, pode: (p: Permission) => boolean): boolean {
  return pode(acao.permissao) || (acao.permissoesAlternativas ?? []).some(pode);
}

/** As secções fixas da página de início do site, pelo nome que a consola mostra. */
export const SECCOES_DO_SITE: Record<string, string> = {
  jogo: "Próximo jogo e último resultado",
  noticias: "Mais notícias",
  equipas: "Equipas",
  socios: "Bloco de sócios",
  loja: "Loja",
  patrocinadores: "Patrocinadores",
};

const equipa = (obrigatorio: boolean, descricao?: string): Campo => ({ nome: "equipa", rotulo: "Equipa", tipo: "equipa", obrigatorio, descricao });
const dia: Campo = { nome: "dia", rotulo: "Dia", tipo: "data", obrigatorio: true, descricao: "AAAA-MM-DD. 'Sábado' ou 'amanhã' contam-se a partir de hoje." };
const inicio: Campo = { nome: "inicio", rotulo: "Hora de início", tipo: "hora", obrigatorio: true, descricao: "HH:MM" };
const fim = (descricao: string): Campo => ({ nome: "fim", rotulo: "Hora de fim", tipo: "hora", obrigatorio: false, descricao });
const local: Campo = { nome: "local", rotulo: "Local", tipo: "local", obrigatorio: true, descricao: "Um local do catálogo do clube (ou outro, escrito)." };
const balnearios: Campo = { nome: "balnearios", rotulo: "Balneários", tipo: "balneario", obrigatorio: false, descricao: "Um ou mais balneários do catálogo, separados por vírgula. '-' se não usa." };

export const ACOES: Record<string, Acao> = {
  marcar_treino: {
    nome: "marcar_treino",
    rotulo: "Marcar treino",
    descricao: "Marca um treino de uma equipa num dia e hora. Pode repetir até uma data.",
    permissao: "calendar:write",
    kind: "EVENT",
    campos: [
      equipa(true),
      dia,
      inicio,
      fim("HH:MM."),
      local,
      balnearios,
      { nome: "treinador", rotulo: "Quem dá o treino", tipo: "staff", obrigatorio: false, descricao: "Uma pessoa do staff. '-' para o treinador principal da equipa." },
      {
        nome: "quem_avisa",
        rotulo: "Quem avisa as faltas",
        tipo: "escolha",
        obrigatorio: true,
        descricao: "O encarregado nos escalões de formação; o próprio atleta nos mais velhos.",
        opcoes: [
          { valor: "GUARDIAN", label: "O encarregado" },
          { valor: "ATHLETE", label: "O próprio atleta" },
        ],
      },
      { nome: "repetir_ate", rotulo: "Repetir até", tipo: "data", obrigatorio: false, descricao: "AAAA-MM-DD, inclusive: todas as semanas no mesmo dia até esta data. '-' se é só este." },
      { nome: "dias_da_semana", rotulo: "Dias da semana", tipo: "texto", obrigatorio: false, descricao: "Só com repetir_ate: 'ter,qui' ou '2,4' (0 é domingo)." },
    ],
  },
  marcar_jogo: {
    nome: "marcar_jogo",
    rotulo: "Marcar jogo",
    descricao: "Marca um jogo de uma equipa contra um adversário, em casa ou fora.",
    permissao: "calendar:write",
    kind: "EVENT",
    campos: [
      equipa(true),
      dia,
      inicio,
      fim("HH:MM."),
      { nome: "adversario", rotulo: "Adversário", tipo: "texto", obrigatorio: true },
      { nome: "casa", rotulo: "Em casa", tipo: "booleano", obrigatorio: true, descricao: "Sim se é em casa, não se é fora." },
      { ...local, descricao: "Em casa, um local do catálogo do clube. Fora, o campo do adversário (nome ou morada), como a pessoa o disser." },
      { ...balnearios, soSe: { campo: "casa", igual: "sim" }, descricao: "Só em casa: um ou mais balneários do catálogo. Fora não se pergunta." },
      { nome: "prova", rotulo: "Prova", tipo: "prova", obrigatorio: true, descricao: "Uma das provas que a equipa disputa (campeonato, taça, amigável)." },
    ],
  },
  marcar_evento: {
    nome: "marcar_evento",
    rotulo: "Marcar evento",
    descricao: "Marca outro evento do calendário (torneio, reunião de pais, estágio, convívio) para uma equipa ou para o clube todo.",
    permissao: "calendar:write",
    kind: "EVENT",
    campos: [
      { nome: "titulo", rotulo: "Título", tipo: "texto", obrigatorio: true },
      { nome: "tipo", rotulo: "Tipo de evento", tipo: "tipoEvento", obrigatorio: false, descricao: "Um tipo do catálogo do clube. '-' se nenhum." },
      equipa(false, "Sem equipa é para o clube todo (só a direção). '-' para o clube todo."),
      dia,
      inicio,
      fim("HH:MM."),
      local,
      balnearios,
      { nome: "publico", rotulo: "Mostrar no site", tipo: "booleano", obrigatorio: false },
    ],
  },
  desmarcar: {
    nome: "desmarcar",
    rotulo: "Desmarcar",
    descricao: "Desmarca um treino, jogo ou evento (fica riscado, reativa-se depois). O id vem da ferramenta agenda, treinos ou jogos.",
    permissao: "calendar:write",
    kind: "EVENT",
    campos: [{ nome: "id", rotulo: "O evento", tipo: "texto", obrigatorio: true, descricao: "O sessionId, matchId ou eventId." }],
  },
  reativar: {
    nome: "reativar",
    rotulo: "Reativar",
    descricao: "Volta a marcar um treino, jogo ou evento que estava desmarcado.",
    permissao: "calendar:write",
    kind: "EVENT",
    campos: [{ nome: "id", rotulo: "O evento", tipo: "texto", obrigatorio: true, descricao: "O sessionId, matchId ou eventId." }],
  },
  inscrever_atleta: {
    nome: "inscrever_atleta",
    rotulo: "Inscrever atleta",
    descricao: "Inscreve um atleta numa equipa. Precisa do NIF, ou de outro documento para quem não tem NIF.",
    permissao: "athlete:write",
    kind: "ATHLETE",
    campos: [
      { nome: "nome", rotulo: "Nome completo", tipo: "texto", obrigatorio: true },
      { nome: "data_nascimento", rotulo: "Data de nascimento", tipo: "data", obrigatorio: true },
      equipa(true),
      { nome: "nif", rotulo: "NIF", tipo: "nif", obrigatorio: false, descricao: "9 algarismos. Obrigatório se não houver outro documento." },
      { nome: "outro_documento", rotulo: "Outro documento", tipo: "texto", obrigatorio: false, descricao: "Passaporte, título de residência; só para quem não tem NIF." },
      { nome: "numero_documento", rotulo: "N.º do documento", tipo: "texto", obrigatorio: false },
      { nome: "email", rotulo: "Email do atleta", tipo: "email", obrigatorio: false },
      { nome: "posicao", rotulo: "Posição", tipo: "texto", obrigatorio: false },
      { nome: "numero", rotulo: "Número da camisola", tipo: "numero", obrigatorio: false },
      { nome: "encarregado_nome", rotulo: "Nome do encarregado", tipo: "texto", obrigatorio: false },
      { nome: "encarregado_email", rotulo: "Email do encarregado", tipo: "email", obrigatorio: false },
      { nome: "encarregado_telefone", rotulo: "Telemóvel do encarregado", tipo: "telefone", obrigatorio: false },
    ],
  },
  publicar_comunicado: {
    nome: "publicar_comunicado",
    rotulo: "Publicar comunicado",
    descricao:
      "Publica um aviso que chega por notificação a quem for o público. O título e o texto redige-os TU a partir do que a pessoa pediu (ela revê no formulário antes de seguir): português de Portugal, tom cordial e claro, como um clube escreve às famílias. Texto com 2 a 5 frases curtas: uma saudação ('Caros pais e encarregados de educação,'), o essencial com o dia e a hora concretos (converte 'amanhã' na data), o que muda para eles se for o caso, um agradecimento, e a assinatura com o nome do clube. Não inventes factos que a pessoa não disse (o motivo, uma data nova, uma compensação). Sem emojis, sem travessões, sem maiúsculas a gritar.",
    permissao: "comms:write",
    kind: "ANNOUNCEMENT",
    campos: [
      { nome: "titulo", rotulo: "Título", tipo: "texto", obrigatorio: true, descricao: "Curto e informativo, até 8 palavras (ex.: 'Sem treino amanhã, quinta-feira 12 de novembro'). Redigido por ti." },
      { nome: "texto", rotulo: "Texto", tipo: "textoLongo", obrigatorio: true, descricao: "O texto do aviso, redigido por ti como descrito na ação." },
      {
        nome: "publico",
        rotulo: "Para quem",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: [
          { valor: "guardians", label: "Famílias" },
          { valor: "athletes", label: "Atletas" },
          { valor: "coaches", label: "Equipa técnica" },
          { valor: "members", label: "Sócios" },
          { valor: "all", label: "Toda a gente" },
        ],
      },
      { nome: "equipas", rotulo: "Só estes escalões", tipo: "equipas", obrigatorio: false, omissao: "-", descricao: "Nomes de equipas separados por vírgula, só para famílias ou atletas. '-' para todas as equipas de quem publica." },
    ],
  },
  publicar_noticia: {
    nome: "publicar_noticia",
    rotulo: "Publicar notícia no site",
    descricao:
      "Publica uma notícia no site do clube (só com o site no plano). Como no comunicado, o título, o resumo e o texto redige-os TU a partir do que a pessoa pediu, e ela revê no formulário: português de Portugal, tom de notícia de clube (terceira pessoa, 'o clube informa'), com os factos concretos que a pessoa deu (dia, hora, motivo) e sem inventar outros (nem datas de retoma, nem decisões que ela não disse). Uma notícia é um artigo, não um aviso: escreve 4 a 6 parágrafos, separados por uma linha em branco, cada um com duas ou três frases. Abre com o essencial (o quê, quando, porquê); depois desenvolve o contexto que a pessoa deu ou que decorre dele sem ser um facto novo (o que motivou a decisão, a quem se aplica, o que muda para atletas e famílias, a preocupação do clube com a segurança quando é o caso); diz como e onde as pessoas ficam a saber mais (a app do clube, o treinador, os canais do clube) sem inventar contactos; fecha com uma frase de agradecimento ou de ânimo em nome do clube. O resumo é diferente do primeiro parágrafo: uma ou duas frases que dão vontade de abrir. Sem saudação nem assinatura (não é uma carta). Sem emojis, sem travessões, sem maiúsculas a gritar.",
    permissao: "website:write",
    kind: "SITE_NEWS",
    campos: [
      { nome: "titulo", rotulo: "Título", tipo: "texto", obrigatorio: true, descricao: "Curto, até 10 palavras, como um título de notícia. Redigido por ti." },
      { nome: "resumo", rotulo: "Resumo", tipo: "textoLongo", obrigatorio: true, descricao: "Uma ou duas frases que aparecem na lista de notícias, diferentes do primeiro parágrafo. Redigido por ti." },
      { nome: "corpo", rotulo: "Texto", tipo: "textoLongo", obrigatorio: true, descricao: "O artigo, 4 a 6 parágrafos, redigido por ti como descrito na ação." },
      {
        nome: "categoria",
        rotulo: "Categoria",
        tipo: "escolha",
        obrigatorio: true,
        descricao: "A secção do site. 'Clube' quando é geral.",
        opcoes: [
          { valor: "Clube", label: "Clube" },
          { valor: "Seniores", label: "Seniores" },
          { valor: "Formação", label: "Formação" },
          { valor: "Futsal", label: "Futsal" },
          { valor: "Sócios", label: "Sócios" },
          { valor: "Loja", label: "Loja" },
        ],
      },
      { nome: "destaque", rotulo: "Em destaque na página inicial", tipo: "booleano", obrigatorio: false, omissao: "não", descricao: "Sim só se a pessoa pediu destaque. '-' se não disse." },
      {
        nome: "estado",
        rotulo: "Publicar",
        tipo: "escolha",
        obrigatorio: true,
        descricao: "'publicada' sai logo no site ao confirmar; 'rascunho' fica guardada para rever na consola.",
        opcoes: [
          { valor: "publicada", label: "Publicar já no site" },
          { valor: "rascunho", label: "Guardar como rascunho" },
        ],
      },
    ],
  },
  mostrar_seccao_do_site: {
    nome: "mostrar_seccao_do_site",
    rotulo: "Mostrar ou esconder secção do site",
    descricao: "Mostra ou esconde uma secção da página de início do site do clube (próximo jogo, mais notícias, equipas, bloco de sócios, loja, patrocinadores, ou um banner).",
    permissao: "website:write",
    kind: "SITE",
    precisaDoSite: true,
    campos: [
      { nome: "seccao", rotulo: "Secção", tipo: "seccao", obrigatorio: true, descricao: "O nome da secção como a pessoa a disse ('loja', 'patrocinadores', 'sócios', 'notícias', 'equipas', 'jogo') ou o id de um banner." },
      { nome: "visivel", rotulo: "Mostrar", tipo: "booleano", obrigatorio: true, descricao: "Sim para mostrar, não para esconder." },
    ],
  },
  mover_seccao_do_site: {
    nome: "mover_seccao_do_site",
    rotulo: "Mover secção do site",
    descricao: "Muda a ordem das secções da página de início do site: põe uma secção numa posição (1 é logo a seguir às notícias em destaque, que ficam sempre no topo).",
    permissao: "website:write",
    kind: "SITE",
    precisaDoSite: true,
    campos: [
      { nome: "seccao", rotulo: "Secção", tipo: "seccao", obrigatorio: true },
      { nome: "posicao", rotulo: "Posição", tipo: "numero", obrigatorio: true, descricao: "1 é a primeira. 'Para o fim' é um número grande (99)." },
    ],
  },
  adicionar_banner_ao_site: {
    nome: "adicionar_banner_ao_site",
    rotulo: "Adicionar banner ao site",
    descricao: "Acrescenta um banner à página de início do site (uma campanha, um torneio, um apoio): título, texto, botão e ligação. A imagem junta-se depois na consola. O título e o texto redige-os tu a partir do que a pessoa pediu, curtos; sem inventar datas ou factos.",
    permissao: "website:write",
    kind: "SITE",
    precisaDoSite: true,
    campos: [
      { nome: "titulo", rotulo: "Título", tipo: "texto", obrigatorio: true, descricao: "Até 8 palavras." },
      { nome: "texto", rotulo: "Texto", tipo: "textoLongo", obrigatorio: false, omissao: "-", descricao: "Uma ou duas frases. '-' se só o título." },
      { nome: "botao", rotulo: "Texto do botão", tipo: "texto", obrigatorio: false, omissao: "-", descricao: "'Inscreve-te', 'Saber mais'. '-' sem botão." },
      { nome: "url", rotulo: "Ligação do botão", tipo: "texto", obrigatorio: false, omissao: "-", descricao: "O endereço para onde o botão leva. '-' sem ligação." },
      { nome: "posicao", rotulo: "Posição na página", tipo: "numero", obrigatorio: false, omissao: "-", descricao: "1 é a primeira secção. '-' para o fim." },
    ],
  },
  remover_banner_do_site: {
    nome: "remover_banner_do_site",
    rotulo: "Remover banner do site",
    descricao: "Tira um banner da página de início do site.",
    permissao: "website:write",
    kind: "SITE",
    precisaDoSite: true,
    campos: [{ nome: "banner", rotulo: "Banner", tipo: "banner", obrigatorio: true, descricao: "O título do banner como a pessoa o disse, ou o id." }],
  },
  mudar_layout_do_site: {
    nome: "mudar_layout_do_site",
    rotulo: "Mudar o layout do site",
    descricao: "Troca o layout do site do clube: Tribuna (claro) ou Holofote (escuro). A cor e o emblema são os do clube e não mudam aqui.",
    permissao: "website:write",
    kind: "SITE",
    precisaDoSite: true,
    campos: [
      {
        nome: "layout",
        rotulo: "Layout",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: [
          { valor: "tribuna", label: "Tribuna (claro)" },
          { valor: "holofote", label: "Holofote (escuro)" },
        ],
      },
    ],
  },
  por_site_no_ar: {
    nome: "por_site_no_ar",
    rotulo: "Pôr o site no ar ou tirá-lo",
    descricao: "Publica o site do clube (fica acessível no endereço) ou tira-o do ar.",
    permissao: "website:write",
    kind: "SITE",
    precisaDoSite: true,
    campos: [{ nome: "publicado", rotulo: "No ar", tipo: "booleano", obrigatorio: true, descricao: "Sim para publicar, não para tirar do ar." }],
  },
  criar_produto_na_loja: {
    nome: "criar_produto_na_loja",
    rotulo: "Criar produto na loja",
    descricao: "Põe um produto novo à venda na loja do site, com nome, preço em euros, categoria, descrição e tamanhos. A fotografia e o stock por tamanho juntam-se depois na consola (Website, Loja).",
    permissao: "website:write",
    kind: "SITE",
    precisaDoSite: true,
    campos: [
      { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true },
      { nome: "preco", rotulo: "Preço (€)", tipo: "numero", obrigatorio: true, descricao: "Em euros, com IVA. '12,50'." },
      { nome: "categoria", rotulo: "Categoria", tipo: "texto", obrigatorio: false, omissao: "-", descricao: "Uma categoria da loja, ou uma nova. '-' sem categoria." },
      { nome: "descricao", rotulo: "Descrição", tipo: "textoLongo", obrigatorio: false, omissao: "-", descricao: "Curta, redigida por ti a partir do que a pessoa disse. '-' se nada." },
      { nome: "tamanhos", rotulo: "Tamanhos", tipo: "texto", obrigatorio: false, omissao: "-", descricao: "'S, M, L, XL' ou '6, 8, 10, 12'. '-' se não tem tamanhos." },
      { nome: "visivel", rotulo: "Visível na loja", tipo: "booleano", obrigatorio: true, descricao: "Não deixa-o guardado mas escondido." },
    ],
  },
  mudar_produto_da_loja: {
    nome: "mudar_produto_da_loja",
    rotulo: "Mudar produto da loja",
    descricao: "Muda o preço de um produto da loja, mostra-o ou esconde-o, marca-o como esgotado ou como novidade.",
    permissao: "website:write",
    kind: "SITE",
    precisaDoSite: true,
    campos: [
      { nome: "produto", rotulo: "Produto", tipo: "produto", obrigatorio: true, descricao: "O nome do produto como a pessoa o disse, ou o id." },
      { nome: "preco", rotulo: "Preço novo (€)", tipo: "numero", obrigatorio: false, omissao: "-", descricao: "'-' para manter." },
      { nome: "visivel", rotulo: "Visível na loja", tipo: "booleano", obrigatorio: false, omissao: "-", descricao: "'-' para manter." },
      { nome: "esgotado", rotulo: "Esgotado", tipo: "booleano", obrigatorio: false, omissao: "-", descricao: "'-' para manter." },
      { nome: "novidade", rotulo: "Marcar como novidade", tipo: "booleano", obrigatorio: false, omissao: "-", descricao: "'-' para manter." },
    ],
  },
  remover_produto_da_loja: {
    nome: "remover_produto_da_loja",
    rotulo: "Remover produto da loja",
    descricao: "Tira um produto da loja do site de vez. Para o esconder sem apagar, usa mudar_produto_da_loja com visível = não.",
    permissao: "website:write",
    kind: "SITE",
    precisaDoSite: true,
    campos: [{ nome: "produto", rotulo: "Produto", tipo: "produto", obrigatorio: true }],
  },
  adicionar_patrocinador: {
    nome: "adicionar_patrocinador",
    rotulo: "Adicionar patrocinador",
    descricao: "Acrescenta um patrocinador ou parceiro do clube (aparece no site, se o houver, e na app dos sócios com a vantagem). O logótipo junta-se depois na consola.",
    permissao: "sponsor:write",
    permissoesAlternativas: ["website:write"],
    kind: "SITE",
    campos: [
      { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true },
      { nome: "url", rotulo: "Site do parceiro", tipo: "texto", obrigatorio: false, omissao: "-", descricao: "'-' se não tem." },
      { nome: "vantagem", rotulo: "Vantagem para os sócios", tipo: "texto", obrigatorio: false, omissao: "-", descricao: "'15 % em consultas'. '-' se é só patrocinador." },
    ],
  },
  remover_patrocinador: {
    nome: "remover_patrocinador",
    rotulo: "Remover patrocinador",
    descricao: "Tira um patrocinador ou parceiro da lista do clube.",
    permissao: "sponsor:write",
    permissoesAlternativas: ["website:write"],
    kind: "SITE",
    campos: [{ nome: "patrocinador", rotulo: "Patrocinador", tipo: "patrocinador", obrigatorio: true, descricao: "O nome como a pessoa o disse, ou o id." }],
  },
  abrir_bilheteira: {
    nome: "abrir_bilheteira",
    rotulo: "Pôr bilhetes à venda",
    descricao: "Abre a venda de bilhetes no site para um jogo (em casa ou fora), num recinto desenhado no Estádio, com os preços por omissão desse recinto. Diz quem compra e desde quando: toda a gente, os sócios primeiro e o público mais tarde, ou só sócios.",
    permissao: "website:write",
    kind: "SITE",
    precisaDoSite: true,
    campos: [
      { nome: "jogo", rotulo: "Jogo", tipo: "jogo", obrigatorio: true, descricao: "O matchId (da ferramenta jogos ou agenda), ou o adversário e o dia como a pessoa disse." },
      { nome: "recinto", rotulo: "Recinto", tipo: "recinto", obrigatorio: true, descricao: "Um recinto do Estádio do site, pelo nome." },
      { nome: "lotacao", rotulo: "Lotação", tipo: "numero", obrigatorio: false, omissao: "-", descricao: "Quantos bilhetes no total. '-' para a lotação das bancadas." },
      {
        nome: "quem",
        rotulo: "Quem compra",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: [
          { valor: "todos", label: "Toda a gente" },
          { valor: "socios_primeiro", label: "Sócios primeiro, público depois" },
          { valor: "so_socios", label: "Só sócios" },
        ],
      },
      { nome: "abre_dia", rotulo: "Abre no dia", tipo: "data", obrigatorio: false, omissao: "-", descricao: "AAAA-MM-DD. '-' para abrir já." },
      { nome: "abre_hora", rotulo: "Abre à hora", tipo: "hora", obrigatorio: false, omissao: "-", descricao: "HH:MM. '-' para as 00:00 desse dia." },
      { nome: "publico_dia", rotulo: "Público a partir do dia", tipo: "data", obrigatorio: true, soSe: { campo: "quem", igual: "socios_primeiro" } },
      { nome: "publico_hora", rotulo: "Público a partir da hora", tipo: "hora", obrigatorio: false, omissao: "-", soSe: { campo: "quem", igual: "socios_primeiro" }, descricao: "'-' para as 00:00." },
      { nome: "fecha_dia", rotulo: "Fecha no dia", tipo: "data", obrigatorio: false, omissao: "-", descricao: "'-' para fechar à hora do jogo." },
      { nome: "fecha_hora", rotulo: "Fecha à hora", tipo: "hora", obrigatorio: false, omissao: "-", descricao: "'-' para as 23:59 desse dia." },
      { nome: "nota", rotulo: "Nota para quem compra", tipo: "textoLongo", obrigatorio: false, omissao: "-", descricao: "'Portas abrem 1 h antes'. '-' se nada." },
    ],
  },
  fechar_bilheteira: {
    nome: "fechar_bilheteira",
    rotulo: "Fechar a venda de bilhetes",
    descricao: "Fecha a venda de bilhetes de um jogo no site. Os bilhetes já comprados ficam válidos.",
    permissao: "website:write",
    kind: "SITE",
    precisaDoSite: true,
    campos: [{ nome: "jogo", rotulo: "Jogo", tipo: "jogo", obrigatorio: true }],
  },
  criar_exercicio: {
    nome: "criar_exercicio",
    rotulo: "Criar exercício",
    descricao:
      "Cria UM exercício novo na biblioteca da Área técnica, com a ficha completa e o desenho no campo, sem o pôr em treino nenhum. É esta a ação quando a pessoa pede 'um exercício', 'cria um exercício de...', 'preciso de um exercício para...'. Não pede treino nem dia. O servidor gera o exercício com um modelo próprio; tu só recolhes o que a pessoa quer. Não escrevas tu o exercício no texto.",
    permissao: "training:write",
    kind: "EXERCISE",
    campos: [
      equipa(true, "Para quem é o exercício: dá a modalidade, a idade e o campo do desenho."),
      { nome: "foco", rotulo: "O que trabalhar", tipo: "textoLongo", obrigatorio: true, descricao: "O que a pessoa quer que o exercício trabalhe, com as palavras dela ('posse de bola e gestão da posse', 'finalização', 'transição defensiva')." },
      {
        nome: "intensidade",
        rotulo: "Intensidade",
        tipo: "escolha",
        obrigatorio: false,
        omissao: "-",
        opcoes: [
          { valor: "baixa", label: "Baixa" },
          { valor: "moderada", label: "Moderada" },
          { valor: "alta", label: "Alta" },
          { valor: "maxima", label: "Máxima" },
        ],
      },
      { nome: "duracao", rotulo: "Duração (minutos)", tipo: "numero", obrigatorio: false, omissao: "-", descricao: "'-' deixa o autor decidir." },
      { nome: "pesquisar", rotulo: "Procurar ideias na internet", tipo: "booleano", obrigatorio: false, omissao: "não", descricao: "Sim só se a pessoa pediu para procurar na internet." },
      { nome: "notas", rotulo: "Indicações extra", tipo: "textoLongo", obrigatorio: false, omissao: "-", descricao: "Quantos atletas, material disponível, espaço, o que evitar." },
    ],
  },
  planear_treino: {
    nome: "planear_treino",
    rotulo: "Planear treino",
    descricao:
      "Monta o plano INTEIRO de um treino já marcado (objetivo, vários blocos com minutos e intensidade, exercícios da biblioteca do clube ou novos, com o desenho no campo). Só quando a pessoa fala de um treino ou de um plano ('o plano do treino de amanhã', 'prepara o treino de sexta'); um exercício sozinho é criar_exercicio. O servidor gera o plano com um modelo próprio; tu só recolhes o que a pessoa quer. Não escrevas tu o plano no texto.",
    permissao: "training:write",
    kind: "TRAINING_PLAN",
    campos: [
      equipa(true),
      { nome: "dia", rotulo: "Dia do treino", tipo: "data", obrigatorio: false, omissao: "-", descricao: "AAAA-MM-DD. 'Amanhã' conta-se a partir de hoje. Serve para o servidor encontrar o treino; se a pessoa não disse o dia, '-'." },
      { nome: "treino", rotulo: "Treino", tipo: "treino", obrigatorio: true, descricao: "O sessionId (da ferramenta treinos ou agenda). Se só sabes o dia, deixa vazio: o servidor encontra o treino desse dia." },
      { nome: "foco", rotulo: "O que trabalhar", tipo: "textoLongo", obrigatorio: true, descricao: "O que a pessoa quer do treino, com as palavras dela ('físico, puxado, condição física'; 'transição defensiva'; 'finalização')." },
      {
        nome: "intensidade",
        rotulo: "Intensidade",
        tipo: "escolha",
        obrigatorio: false, omissao: "-",
        descricao: "'-' se a pessoa não disse.",
        opcoes: [
          { valor: "baixa", label: "Baixa" },
          { valor: "moderada", label: "Moderada" },
          { valor: "alta", label: "Alta" },
          { valor: "maxima", label: "Máxima" },
        ],
      },
      {
        nome: "biblioteca",
        rotulo: "Exercícios do clube",
        tipo: "escolha",
        obrigatorio: false, omissao: "-",
        descricao: "Se usa os exercícios já criados na biblioteca. '-' deixa o planeador decidir.",
        opcoes: [
          { valor: "sim", label: "Usar quando servirem" },
          { valor: "nao", label: "Só exercícios novos" },
        ],
      },
      { nome: "pesquisar", rotulo: "Procurar ideias na internet", tipo: "booleano", obrigatorio: false, omissao: "não", descricao: "Sim só se a pessoa pediu para procurar na internet. '-' se não disse." },
      { nome: "notas", rotulo: "Indicações extra", tipo: "textoLongo", obrigatorio: false, omissao: "-", descricao: "Material disponível, quantos atletas, limitações, o que evitar. '-' se não há." },
    ],
  },
};

/**
 * Um campo foi respondido? Com valor, ou com "-" (a pessoa disse que não).
 * Nulo, vazio ou ausente é "ainda ninguém perguntou": esse pergunta-se.
 */
export function respondido(bruto: string | null | undefined): boolean {
  return (bruto ?? "").trim() !== "";
}

/** O texto das ações para a descrição da ferramenta: o modelo lê isto para saber o que pedir. */
export function descricaoDasAcoes(): string {
  return Object.values(ACOES)
    .map((a) => {
      const campos = a.campos.map((c) => `${c.nome}${c.obrigatorio ? "*" : ""} (${c.tipo}${c.descricao ? `: ${c.descricao}` : ""}${c.opcoes ? `: ${c.opcoes.map((o) => o.valor).join("|")}` : ""}${c.omissao !== undefined ? `; se não for dito: ${c.omissao === RECUSADO ? "vazio" : c.omissao}, não perguntes` : ""})`).join("; ");
      return `- ${a.nome}: ${a.descricao} Campos: ${campos}.`;
    })
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/* Leituras dos valores                                                        */
/* -------------------------------------------------------------------------- */

export type Lido = { ok: true; valor: unknown } | { ok: false; erro: string };

/** Lê um valor como o campo o quer. Vazio é ausente; o que não se lê é um erro com a razão. */
/** "-" é a resposta "não quero / não se aplica": o campo foi perguntado e fica vazio. */
export const RECUSADO = "-";

export function lerValor(campo: Campo, bruto: string | null | undefined): Lido {
  const s = (bruto ?? "").trim();
  if (!s || s === RECUSADO) return { ok: true, valor: undefined };
  switch (campo.tipo) {
    case "texto":
    case "textoLongo":
    case "equipa":
    case "local":
    case "prova":
    case "balneario":
    case "tipoEvento":
    case "equipas":
    case "staff":
    case "treino":
    case "jogo":
    case "seccao":
    case "banner":
    case "produto":
    case "patrocinador":
    case "recinto":
      return { ok: true, valor: s };
    case "numero": {
      const n = Number(s.replace(",", "."));
      return Number.isFinite(n) ? { ok: true, valor: n } : { ok: false, erro: `${campo.rotulo}: "${s}" não é um número` };
    }
    case "booleano": {
      const n = s.toLowerCase();
      if (/^(sim|s|true|1|yes|casa|em casa)$/.test(n)) return { ok: true, valor: true };
      if (/^(nao|não|n|false|0|no|fora)$/.test(n)) return { ok: true, valor: false };
      return { ok: false, erro: `${campo.rotulo}: diz sim ou não` };
    }
    case "data": {
      const d = lerDataSolta(s);
      return d ? { ok: true, valor: d } : { ok: false, erro: `${campo.rotulo}: "${s}" não é uma data (AAAA-MM-DD)` };
    }
    case "hora": {
      const m = /^(\d{1,2})[:h.](\d{2})$/.exec(s) ?? /^(\d{1,2})h?$/.exec(s);
      if (!m) return { ok: false, erro: `${campo.rotulo}: "${s}" não é uma hora (HH:MM)` };
      const h = Number(m[1]);
      const mi = Number(m[2] ?? "0");
      if (h > 23 || mi > 59) return { ok: false, erro: `${campo.rotulo}: "${s}" não é uma hora válida` };
      return { ok: true, valor: `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` };
    }
    case "nif": {
      const d = s.replace(/\D/g, "");
      return d.length === 9 ? { ok: true, valor: d } : { ok: false, erro: "O NIF tem 9 algarismos" };
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { ok: true, valor: s.toLowerCase() } : { ok: false, erro: `${campo.rotulo}: "${s}" não é um email` };
    case "telefone": {
      const d = s.replace(/[\s().-]/g, "");
      return /^\+?\d{9,15}$/.test(d) ? { ok: true, valor: d } : { ok: false, erro: `${campo.rotulo}: "${s}" não é um número de telefone` };
    }
    case "escolha": {
      const n = s.toLowerCase();
      const o = (campo.opcoes ?? []).find((x) => x.valor.toLowerCase() === n || x.label.toLowerCase() === n);
      return o ? { ok: true, valor: o.valor } : { ok: false, erro: `${campo.rotulo}: escolhe entre ${(campo.opcoes ?? []).map((x) => x.label).join(", ")}` };
    }
  }
}

/** `AAAA-MM-DD`, `dd/mm/aaaa` ou `dd-mm-aaaa`. */
export function lerDataSolta(s: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return valida(+iso[1], +iso[2], +iso[3]);
  const pt = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (pt) return valida(+pt[3], +pt[2], +pt[1]);
  return null;
}

function valida(ano: number, mes: number, dia: number): string | null {
  if (ano < 1900 || ano > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** "ter,qui" ou "2,4" → [2, 4]. 0 é domingo. */
export function lerDiasDaSemana(s: string | undefined): number[] | undefined {
  if (!s) return undefined;
  const NOMES: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
  const dias = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s*[,;]\s*|\s+e\s+|\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/^\d$/.test(p) ? Number(p) : NOMES[p.slice(0, 3)]))
    .filter((n): n is number => n !== undefined && n >= 0 && n <= 6);
  return dias.length ? [...new Set(dias)] : undefined;
}

/** "HH:MM" mais minutos. */
export function somarMinutos(hhmm: string, minutos: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutos);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

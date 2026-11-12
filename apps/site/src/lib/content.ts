/**
 * O que o site diz.
 *
 * Texto e números num sítio só. O site tem várias páginas que falam do mesmo
 * produto, e um preço escrito em dois ficheiros é um preço que vai divergir.
 *
 * ## A regra que atravessa este ficheiro
 *
 * **Nada aqui promete o que o produto não faz.** O que está construído está nas
 * listas; o que está a caminho está no roteiro, marcado como tal.
 *
 * ## Como se escreve
 *
 * Frases simples e diretas. Sem travessões, sem "X num só Y" e sem "não é A, é
 * B". Um título diz o que a coisa é.
 */

/* -------------------------------------------------------------------------- */
/* Preços                                                                      */
/* -------------------------------------------------------------------------- */

/** Um ano pago à cabeça sai 10% mais barato. */
export const ANNUAL_DISCOUNT = 0.1;

export type Plan = {
  id: "consola" | "ligado" | "pro";
  name: string;
  tagline: string;
  monthly: number;
  /** O recomendado: o cartão escuro, com a etiqueta "Recomendado". */
  featured?: boolean;
  /** O que mais clubes escolhem: a etiqueta "O mais escolhido", num cartão claro. */
  popular?: boolean;
  /** O que este plano faz, escrito como um clube o diria. */
  includes: string[];
  /** Só no plano de baixo: o que fica de fora, dito sem rodeios. */
  excludes?: string[];
  /**
   * Ainda não se vende. O preço está à vista para o clube poder orçamentar a
   * época, mas não há botão de experimentar uma coisa que ninguém pode abrir.
   */
  soon?: boolean;
  /** O preço é o ponto de partida: o cartão escreve "desde". */
  from?: boolean;
  /** A linha por baixo do preço, no lugar de "faturado mensalmente". */
  priceNote?: string;
};

/**
 * O Assistente IA é um extra, com o mesmo preço em qualquer plano.
 *
 * O preço inclui um saldo mensal de créditos. Um crédito é uma unidade de
 * custo real: marcar presenças gasta cerca de 1, um treino planeado com
 * ideias da internet gasta perto de 100 (medido a 12/11/2026). O saldo é o
 * teto do que o clube pode gastar; mais créditos compram-se à parte, em
 * pacotes iguais ao saldo mensal.
 */
export const AI_ADDON = {
  name: "Assistente IA",
  monthly: 14.99,
  credits: 4000,
  /** Um pacote a mais, com os mesmos créditos do saldo mensal. */
  extraPack: 9.99,
};

export const PLANS: Plan[] = [
  {
    id: "consola",
    name: "Consola",
    tagline: "O clube por dentro, para a direção e os treinadores.",
    monthly: 19.99,
    includes: [
      "Atletas, equipas, staff e cargos",
      "Calendário, treinos e convocatórias",
      "Área técnica e jogos",
      "Avaliações e relatórios",
      "Clínico e scouting",
      "Comunicação e Excel",
    ],
    excludes: ["App do clube", "Pagamentos", "Sócios"],
  },
  {
    id: "ligado",
    name: "Connect",
    tagline: "O clube, as famílias, os sócios e os pagamentos.",
    monthly: 29.99,
    popular: true,
    includes: [
      "Tudo da Consola",
      "App do clube com a vossa marca",
      "Família, atleta, sócio e staff na mesma app",
      "Mensalidades por MB WAY, Multibanco e cartão",
      "Sócios, quotas e adesão online",
      "Notificações push",
    ],
  },
  {
    id: "pro",
    name: "Connect Pro",
    tagline: "O Connect com o site do clube.",
    monthly: 34.99,
    featured: true,
    includes: [
      "Tudo do Connect",
      "Site com domínio .pt incluído",
      "Notícias, equipas, calendário e contactos",
      "Loja online",
      "Bilheteira",
      "Alojamento, SSL e manutenção",
    ],
  },
];

export function annualTotal(monthly: number): number {
  return monthly * 12 * (1 - ANNUAL_DISCOUNT);
}

/** "14,99 €": vírgula decimal e espaço antes do símbolo. */
export function euro(value: number): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(value);
}

/* -------------------------------------------------------------------------- */
/* Quem já cá está                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Os clubes com subscrição ativa a 2 de outubro de 2026, por ordem alfabética.
 *
 * São clubes reais. Antes de publicar, confirmar com cada um que pode aparecer
 * aqui. Os emblemas em `public/clubes/` são o símbolo que cada clube carregou
 * na plataforma (`Academy.logoUrl`), aparado e a 192 px. Só aparecem na página
 * os clubes com emblema: um nome sem emblema ao lado dos outros parecia um erro.
 */
export const CLUBES: { nome: string; curto: string; emblema?: string }[] = [
  { nome: "Futebol Clube Ferreirense", curto: "FC Ferreirense", emblema: "/clubes/fcferreirense.webp" },
  { nome: "Clube Desportivo de Loureiro", curto: "CD Loureiro", emblema: "/clubes/cdloureiro.webp" },
  { nome: "Clube de Basquetebol do Fundão", curto: "CB Fundão", emblema: "/clubes/cbfundao.webp" },
  { nome: "Santa Maria Futebol Clube", curto: "Santa Maria FC", emblema: "/clubes/santamariafc.webp" },
  { nome: "Castanheira Sport Clube", curto: "Castanheira SC", emblema: "/clubes/castanheirasportclube.webp" },
  { nome: "Juventude Atlético Clube", curto: "Juventude AC", emblema: "/clubes/juventudeatleticoclube.webp" },
  { nome: "AD Márcia Miranda Felgueiras", curto: "AD Márcia Miranda", emblema: "/clubes/admarciamirandafelgueiras.webp" },
  { nome: "Casa do Povo da Gafanha da Boa Hora", curto: "CP Gafanha da Boa Hora", emblema: "/clubes/vaboahora.webp" },
];

/** Os clubes que a página mostra: os que têm emblema. */
export const CLUBES_COM_EMBLEMA = CLUBES.filter((c): c is (typeof CLUBES)[number] & { emblema: string } => !!c.emblema);

/**
 * Os números da plataforma.
 *
 * **São contagens verdadeiras**, feitas à base de dados a 12 de novembro de 2026:
 * tudo o que os clubes criaram na plataforma (clubes cancelados incluídos),
 * sem contar os dois clubes de testes (`life-club` e `ad-fafe`). Não se
 * arredonda para cima e não se inventa. Um número inventado numa página de
 * vendas é publicidade enganosa, e basta um clube fazer as contas para o resto
 * da página deixar de ser acreditado.
 *
 * Para atualizar, voltar a contar (contagem simples de `Athlete`, `Team`,
 * `Member`, `TrainingSession` e `Match` sem esses dois clubes) e mudar aqui os
 * valores e a data. Pode descer: treinos e equipas apagados pelos clubes saem.
 */
export const NUMEROS = {
  data: "12 de novembro de 2026",
  itens: [
    { valor: 1024, rotulo: "atletas" },
    { valor: 89, rotulo: "equipas" },
    { valor: 705, rotulo: "sócios" },
    { valor: 5927, rotulo: "treinos marcados" },
    { valor: 379, rotulo: "jogos" },
  ],
};

/* -------------------------------------------------------------------------- */
/* O clube por dentro, pessoa a pessoa                                         */
/* -------------------------------------------------------------------------- */

export type Pessoa = {
  id: string;
  nome: string;
  linha: string;
  itens: string[];
  /** Só no Connect. */
  connect?: boolean;
  /** O que a montra mostra quando esta pessoa está à vista. */
  montra: { tipo: "pc" | "tel"; captura: string };
};

export const PESSOAS: Pessoa[] = [
  {
    id: "direcao",
    nome: "Direção",
    linha: "O clube inteiro, e uma lista do que precisa de atenção.",
    itens: [
      "Atletas, equipas, escalões e staff",
      "Cargos, departamentos e permissões definidos pelo clube",
      "Mensalidades por escalão, por modalidade ou por atleta",
      "Sócios, categorias e quotas mensais ou anuais",
      "Finanças e inventário",
      "Comunicação por público, com taxa de leitura",
      "Certificação FPF: uma estimativa do nível do clube e do que falta para a estrela seguinte",
      "Histórico de alterações em cada ficha",
      "Importação e exportação por Excel",
    ],
    montra: { tipo: "pc", captura: "con-visao-geral" },
  },
  {
    id: "treinador",
    nome: "Treinador",
    linha: "O treino desenha-se, planeia-se e mede-se.",
    itens: [
      "Editor tático com animação por fotogramas",
      "Futebol de 11, 9, 7 e 5, futsal e basquetebol",
      "Planos de sessão por blocos e biblioteca de exercícios",
      "Planeamento da época por ciclos, com a carga de cada semana",
      "Presenças e convocatórias",
      "Jogos: preparação, equipa inicial, ficha e análise",
      "Relatórios do jogo e do adversário",
      "Avaliações por competência e relatórios de atleta",
    ],
    montra: { tipo: "pc", captura: "con-quadro-2" },
  },
  {
    id: "clinico",
    nome: "Clínico",
    linha: "Quem pode jogar no sábado.",
    itens: [
      "Lesões e baixas, com datas",
      "Consultas e exames",
      "Disponibilidade do atleta no dia do treino e do jogo",
      "Ficha médica e documentos",
      "Acesso restrito ao departamento clínico",
    ],
    montra: { tipo: "pc", captura: "con-clinico" },
  },
  {
    id: "scouting",
    nome: "Scouting",
    linha: "Quem se anda a ver, e o que já se sabe dele.",
    itens: ["Prospectos e funil", "Observações de jogo", "Avaliações", "Vídeo", "Shortlists"],
    montra: { tipo: "pc", captura: "con-scouting" },
  },
  {
    id: "familia",
    nome: "Família",
    linha: "O clube no telemóvel de casa.",
    connect: true,
    itens: [
      "Treinos, jogos e convocatórias, com resposta na app",
      "Assiduidade e aviso de falta ao treino",
      "Avaliações e relatórios",
      "Mensalidades por MB WAY, Multibanco e cartão",
      "Avisos do clube e notificações",
      "Instalação a partir de um link, sem loja",
    ],
    montra: { tipo: "tel", captura: "app-inicio" },
  },
  {
    id: "atleta",
    nome: "Atleta",
    linha: "O atleta tem a sua área.",
    connect: true,
    itens: ["Os treinos e os jogos dele", "As convocatórias", "O que o treinador partilha com ele", "Nutrição"],
    montra: { tipo: "tel", captura: "app-area-atleta" },
  },
  {
    id: "socio",
    nome: "Sócio",
    linha: "O cartão, as quotas e os jogos do clube.",
    connect: true,
    itens: [
      "Cartão digital com fotografia",
      "Quotas mensais ou anuais, pagas na app",
      "Os jogos de todos os escalões",
      "Novidades e sondagens",
      "Página pública de adesão a sócio",
    ],
    montra: { tipo: "tel", captura: "app-socio-inicio" },
  },
];

/* -------------------------------------------------------------------------- */
/* O Assistente IA                                                             */
/* -------------------------------------------------------------------------- */

/**
 * O que o assistente faz hoje, escrito como se diz a um clube.
 *
 * A regra do ficheiro vale aqui a dobrar: a IA só promete o que já está na
 * consola. Cada item tem a captura que o mostra.
 */
export const ASSISTENTE = {
  rotulo: "Assistente com IA para clubes",
  titulo: "Diz ao assistente o que aconteceu, e ele trata do resto",
  lede:
    "Está em todas as páginas da consola. Escreve-se ou fala-se, como a um adjunto à beira do campo, e ele prepara as presenças, a lesão, a convocatória ou o treino. Nada fica gravado sem alguém do clube carregar em Confirmar.",
  capacidades: [
    {
      titulo: "O dia a dia do treinador, dito em voz alta",
      texto: "\"Faltaram o Pedro e o Rui, o Tiago chegou atrasado.\" O assistente abre a folha de presenças do treino com todos os atletas no estado certo. O mesmo para registar uma lesão, fazer a convocatória de sábado ou marcar e desmarcar treinos e jogos.",
      captura: "con-assistente",
      tel: "con-assistente-tel",
    },
    {
      titulo: "Treinos planeados e exercícios desenhados",
      texto: "Pede um treino de passe e receção para os Sub-13 e recebe a sessão em blocos, com o tempo, a intensidade e os exercícios. Um exercício novo vem desenhado no campo, com animação, e entra na biblioteca do clube. Se quiseres, procura ideias na internet antes de planear.",
      captura: "con-assistente-plano",
    },
    {
      titulo: "Exercícios desenhados no campo",
      texto: "\"Cria um exercício de saída de bola a três, com finalização, para 12 jogadores.\" O exercício nasce desenhado no campo da modalidade, em vários momentos animados e com os pontos-chave escritos. Ao confirmar entra na biblioteca do clube e edita-se no editor tático como qualquer outro.",
      captura: "con-assistente-exercicio",
    },
    {
      titulo: "Comunicados, notícias e o Excel tal como está",
      texto: "\"Avisa os pais dos Sub-11 que não há treino amanhã por causa da chuva.\" O comunicado sai redigido com o tom de um clube a escrever às famílias, para rever antes de enviar; no Connect Pro escreve também a notícia do jogo para o site. E um Excel de atletas desarrumado entra tal como está: o assistente percebe as colunas, ensaia e só grava depois de confirmares.",
      captura: "con-assistente-mini",
    },
  ],
  regras: [
    "Nada fica gravado sem confirmar",
    "Vê só o que a pessoa que fala pode ver",
    "Não assume o que não foi dito: pergunta",
    "Diz sempre que é uma IA",
  ],
};

/* -------------------------------------------------------------------------- */
/* Módulos (a tabela de comparação dos planos)                                 */
/* -------------------------------------------------------------------------- */

export type Module = { key: string; name: string; line: string; paidTier?: boolean };

export const MODULES: Module[] = [
  { key: "gestao", name: "Gestão", line: "Atletas, equipas, staff, cargos e permissões." },
  { key: "tecnica", name: "Área técnica", line: "Editor tático, planos de sessão, exercícios e planeamento." },
  { key: "jogos", name: "Jogos", line: "Preparação, convocatória, ficha e análise." },
  { key: "avaliacoes", name: "Avaliações e relatórios", line: "Por competência, com a evolução do atleta." },
  { key: "clinico", name: "Clínico", line: "Lesões, consultas, exames e disponibilidade." },
  { key: "scouting", name: "Scouting", line: "Prospectos, observações, vídeo e shortlists." },
  { key: "comunicacao", name: "Comunicação", line: "Avisos por público, com taxa de leitura." },
  { key: "app", name: "App do clube", line: "Família, atleta, sócio e staff na mesma app.", paidTier: true },
  { key: "pagamentos", name: "Pagamentos", line: "Mensalidades e quotas com confirmação automática.", paidTier: true },
  { key: "socios", name: "Sócios e adesão pública", line: "Cartão, quotas e inscrições online.", paidTier: true },
];

/* -------------------------------------------------------------------------- */
/* Segurança                                                                   */
/* -------------------------------------------------------------------------- */

export const SECURITY = [
  {
    title: "Cada clube é uma ilha",
    body: "O isolamento é uma política na base de dados. Um pedido que perca o contexto do clube não devolve dados a mais. Não devolve nada.",
  },
  {
    title: "Permissões que o clube define",
    body: "Cargos com verbos concretos: quem lê mensalidades, quem escreve no boletim clínico, quem convoca. Um treinador vê os atletas das equipas dele e um pai vê os filhos.",
  },
  {
    title: "Acesso administrativo restrito e registado",
    body: "Dizemos quem pode aceder, quando, e fica escrito. O acesso de apoio a um clube exige motivo e tem prazo.",
  },
  {
    title: "Dados clínicos à parte",
    body: "Categoria especial no RGPD, tratada como tal. Ficam fora do alcance de quem não é do departamento clínico e fora do alcance do apoio ao cliente.",
  },
  {
    title: "Autenticação e sessões",
    body: "Contas geridas por um fornecedor de identidade dedicado. As palavras-passe nunca passam pelos nossos servidores.",
  },
  {
    title: "Registo de auditoria",
    body: "O que se faz sobre um clube fica registado, com quem e quando, e não se apaga.",
  },
  {
    title: "Na União Europeia",
    body: "Base de dados e ficheiros alojados na UE. Tratamos dados de menores, e a região conta.",
  },
  {
    title: "Sair é um direito",
    body: "Os dados são do clube. Exportamo-los a pedido e apagamos o que houver para apagar quando o clube sai.",
  },
];

/* -------------------------------------------------------------------------- */
/* Roteiro                                                                     */
/* -------------------------------------------------------------------------- */

export type RoadmapItem = { when: string; title: string; body: string };

/**
 * O roteiro, por ordem.
 *
 * As datas são **intenções**, e a página diz isso. A primeira depende de
 * licenciamento com terceiros.
 */
export const ROADMAP: RoadmapItem[] = [
  {
    when: "Em curso",
    title: "Integração ZeroZero e FPF",
    body: "Jogos, calendários e resultados oficiais sem ninguém os copiar à mão. Depende de licenciamento, e estamos a tratar disso.",
  },
  {
    when: "Janeiro 2027",
    title: "Assistente IA: relatórios e candidaturas",
    body: "Relatórios de época e candidaturas à Câmara ou ao IPDJ escritos a partir dos dados do clube, pelo assistente que já marca presenças e planeia treinos.",
  },
  {
    when: "Março 2027",
    title: "IA sobre os vídeos do clube",
    body: "Análise de vídeo por visão computacional: cada jogador seguido ao longo do jogo, métricas por atleta, clips ligados ao lance e a leitura do adversário. Cada número vem com a confiança medida ao lado.",
  },
];

/* -------------------------------------------------------------------------- */
/* Perguntas                                                                   */
/* -------------------------------------------------------------------------- */

export const FAQ = [
  {
    q: "Os dados do nosso clube ficam separados dos outros?",
    a: "Ficam. Cada pedido corre com o contexto do clube a que pertence e a base de dados recusa tudo o resto. O nosso painel interno vê contagens e o estado da subscrição, e não vê atletas nem famílias.",
  },
  {
    q: "Conseguimos exportar os nossos dados?",
    a: "Os dados são do clube. As listas principais exportam-se para Excel a partir da consola, com as mesmas colunas da importação. O resto exportamos nós a pedido, em formato aberto e sem custo.",
  },
  {
    q: "Como funciona a app do clube?",
    a: "O clube gera um link e envia-o a quem interessa. A pessoa abre-o no telemóvel, instala a app do clube, com o nome, a cor e o ícone do clube, e entra. Um pai identifica o filho, o clube aprova o pedido, e a família passa a ter treinos, convocatórias, assiduidade, avaliações e mensalidades. Um sócio tem o cartão, as quotas, os jogos e as novidades.",
  },
  {
    q: "É preciso uma app para as famílias e outra para os sócios?",
    a: "Não. É a mesma app, a mesma conta e a mesma instalação. O que muda é a área. Quem é só pai entra direto na área da família, e quem é só sócio entra direto na do sócio. Quem é as duas coisas escolhe ao entrar e troca quando quiser, sem sair da conta. Quem trabalha no clube tem também a área de staff, que abre a consola dentro da própria app instalada.",
  },
  {
    q: "Os pais e os sócios têm de instalar alguma coisa da App Store?",
    a: "Não. A app instala-se a partir do link, em dois toques, no iPhone e no Android. Não há loja, aprovações nem atualizações para fazer.",
  },
  {
    q: "Como funcionam os pagamentos?",
    a: "O clube define a mensalidade, por escalão ou por atleta. A família recebe o aviso e paga por MB WAY, Multibanco ou cartão. A confirmação chega do banco ao nosso servidor e o estado no clube muda sozinho. Ninguém marca nada como pago à mão.",
  },
  {
    q: "Podemos pôr a nossa marca na plataforma?",
    a: "Sim. O nome, a cor e o ícone do clube atravessam a consola, a app em todas as áreas e a página pública de adesão. Quem instala a app instala a app do clube.",
  },
  {
    q: "O que traz o Connect Pro?",
    a: "O site do clube, ligado à plataforma. As notícias, as equipas e o calendário saem do que o clube já tem na consola, e a loja e a bilheteira ficam no próprio site. Tratamos do domínio .pt, do alojamento e da manutenção. Tem os mesmos 30 dias de experiência dos outros planos.",
  },
  {
    q: "O domínio do site fica em nome de quem?",
    a: "Do clube. Registamo-lo e renovamo-lo nós enquanto o plano estiver ativo. Se o clube já tiver um domínio, usa-se esse.",
  },
  {
    q: "O que faz o Assistente IA?",
    a: "Está em todas as páginas da consola. Diz-se o que aconteceu, por escrito ou por voz, e ele prepara as presenças do treino, o registo de uma lesão, a convocatória, a marcação de um treino ou jogo, um comunicado às famílias ou um plano de treino com exercícios desenhados. Também importa um Excel de atletas tal como está. Nada fica gravado sem alguém do clube carregar em Confirmar.",
  },
  {
    q: "Quanto custa o Assistente IA?",
    a: "É um extra de 14,99 € por mês, com IVA, em qualquer plano. Inclui 4.000 créditos por mês. Marcar presenças, registar uma lesão ou fazer uma convocatória gasta cerca de 1 crédito. Um treino planeado com ideias da internet gasta perto de 100. Um clube com oito equipas usa cerca de metade do saldo. Quando os créditos acabam, o clube compra mais 4.000 por 9,99 € ou espera pelo mês seguinte. Nunca há cobranças automáticas.",
  },
  {
    q: "Os dados do clube vão para onde, quando usamos o assistente?",
    a: "O que a pessoa escreve e os nomes dos atletas que a resposta precisa vão ao fornecedor do modelo de linguagem, pela rota europeia e sem ficarem guardados nem servirem para treinar modelos. Datas de nascimento, contactos, NIF e diagnósticos clínicos não saem da plataforma. O Acordo de Tratamento de Dados lista o fornecedor.",
  },
  {
    q: "A IA vai inventar estatísticas sobre os nossos atletas?",
    a: "Não, e a arquitetura é feita para que não possa. A visão computacional produz dados com a confiança medida, e a estatística deriva desses dados. O que fica abaixo do limiar pede confirmação a um treinador em vez de se fazer passar por certo. Também não há reconhecimento facial. São menores, e a identificação faz-se pelo plantel confirmado antes do processamento, pelo número da camisola e pela trajetória.",
  },
  {
    q: "Existe período de teste?",
    a: "Trinta dias, com a plataforma toda. Não pedimos cartão para começar.",
  },
  {
    q: "Podemos cancelar?",
    a: "A qualquer momento, e sem período mínimo. Hoje o cancelamento trata-se connosco. Ao sair, exportamos os dados do clube.",
  },
  {
    q: "Como funciona o suporte?",
    a: "Por email, com resposta em dias úteis. Nos primeiros trinta dias acompanhamos a montagem do clube: equipas, atletas, mensalidades e o convite às famílias.",
  },
  {
    q: "Conseguimos migrar de outro software?",
    a: "O plantel entra por Excel, com um modelo que damos e validação linha a linha antes de gravar. O resto da migração é assistida. Fala connosco com o que tens e dizemos o que é possível.",
  },
];

/* -------------------------------------------------------------------------- */
/* Navegação                                                                   */
/* -------------------------------------------------------------------------- */

export const NAV_LINKS = [
  { to: "/produto", label: "Produto" },
  { to: "/planos", label: "Planos" },
  { to: "/contactos", label: "Contacto" },
];

/**
 * A identificação legal da entidade.
 *
 * Está vazia de propósito, e as páginas legais só mostram estes campos quando
 * tiverem valor. Preencher antes de publicar os documentos legais.
 */
export const COMPANY = {
  brand: "Academias",
  legalName: "",
  nif: "",
  address: "",
};

/** O endereço da consola. Em produção, cada clube tem o seu subdomínio. */
export const CONSOLE_URL = "https://app.academias.pt";
export const CONTACT_EMAIL = "geral@academias.pt";
export const INSTAGRAM_URL = "https://instagram.com/getacademias";

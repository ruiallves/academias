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
  id: "consola" | "ligado" | "vision";
  name: string;
  tagline: string;
  monthly: number;
  featured?: boolean;
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

export const PLANS: Plan[] = [
  {
    id: "consola",
    name: "Consola",
    tagline: "O clube por dentro. Tudo o que a direção e os treinadores precisam.",
    monthly: 14.99,
    includes: [
      "Atletas, equipas, escalões e staff",
      "Cargos e permissões à medida do clube",
      "Calendário, treinos, presenças e convocatórias",
      "Área técnica: editor tático, planos de treino e exercícios",
      "Jogos: preparação, ficha e análise",
      "Avaliações e relatórios de atleta",
      "Departamento clínico: lesões, consultas e disponibilidade",
      "Scouting: prospectos, observações, vídeo e shortlists",
      "Comunicação segmentada e notificações",
      "Importação e exportação por Excel",
    ],
    excludes: ["App do clube para famílias e sócios", "Mensalidades e pagamentos", "Página pública de adesão a sócio"],
  },
  {
    id: "ligado",
    name: "Connect",
    tagline: "O clube, as famílias, os sócios e o dinheiro. A plataforma inteira.",
    monthly: 19.99,
    featured: true,
    includes: [
      "Tudo o que está na Consola",
      "App do clube com a marca do clube",
      "Área da família: convocatórias, presenças e avaliações no telemóvel dos pais",
      "Área do atleta: os treinos e o que o treinador partilha",
      "Área do sócio: cartão digital, quotas, jogos e novidades",
      "Área do staff: a consola dentro da mesma app",
      "Mensalidades por MB WAY, Multibanco e cartão",
      "Confirmação automática do pagamento",
      "Página pública de adesão a sócio",
      "Gestão de sócios e quotas",
      "Notificações push",
    ],
  },
  {
    id: "vision",
    name: "Vision AI",
    tagline: "O vídeo dos teus jogos transformado em dados sobre os atletas e a equipa.",
    monthly: 29.99,
    from: true,
    soon: true,
    priceNote: "Inclui 5 análises de jogo por mês",
    includes: [
      "Tudo o que está no Connect",
      "Análise automática de jogos",
      "Deteção e seguimento de cada jogador",
      "Distância percorrida, zonas ocupadas e tempo em campo",
      "Estatísticas, momentos-chave e clips por jogador",
      "Análise do adversário a partir do que o clube já grava",
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
 * aqui. Quando houver o emblema de um clube, entra em `public/clubes/` e o
 * nome passa a levar o emblema ao lado.
 */
export const CLUBES = [
  "AD Márcia Miranda Felgueiras",
  "Castanheira Sport Clube",
  "Clube de Basquetebol do Fundão",
  "Clube Desportivo de Loureiro",
  "Futebol Clube Ferreirense",
  "Juventude Atlético Clube",
  "Santa Maria Futebol Clube",
  "VA Boa Hora",
];

/**
 * Os números da plataforma.
 *
 * **São contagens verdadeiras**, feitas à base de dados a 5 de outubro de 2026:
 * tudo o que os clubes criaram na plataforma, sem contar o clube interno de
 * testes. Não se arredonda para cima e não se inventa. Um número inventado
 * numa página de vendas é publicidade enganosa, e basta um clube fazer as
 * contas para o resto da página deixar de ser acreditado.
 *
 * Para atualizar, voltar a contar e mudar aqui os valores e a data.
 */
export const NUMEROS = {
  data: "5 de outubro de 2026",
  itens: [
    { valor: 767, rotulo: "atletas" },
    { valor: 77, rotulo: "equipas" },
    { valor: 652, rotulo: "sócios" },
    { valor: 5224, rotulo: "treinos marcados" },
    { valor: 213, rotulo: "jogos" },
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
    when: "Novembro 2026",
    title: "Sistema de bilheteira",
    body: "Gestão da venda de bilhetes para os jogos do clube.",
  },
  {
    when: "Janeiro 2027",
    title: "IA sobre os dados do clube",
    body: "Resumos e sinais a partir do que já lá está, sem inventar o que ninguém registou. Entra no plano Vision AI.",
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
    q: "O que é o plano Vision AI, e porque aparece se ainda não existe?",
    a: "É o passo a seguir ao Connect: o vídeo que o clube já grava transformado em dados. Cada jogador seguido ao longo do jogo, distância e zonas por atleta, clips ligados ao lance e a leitura do adversário. Aparece porque um clube escolhe plataforma uma vez e fica anos com ela, e o preço à vista permite orçamentar a época. Ainda não o vendemos, e por isso não tem período de teste.",
  },
  {
    q: "Como é cobrado o Vision AI?",
    a: "Por análises, e não por jogador ou por equipa. Analisar um jogo custa tempo de máquina, e um clube que analisa dois jogos por mês não deve pagar o mesmo que um que analisa vinte. O plano começa nos 29,99 € por mês com cinco análises de jogo, e 49,99 € analisa até dez. Se precisares de mais, ou de um mês de pico a meio da época, fala connosco e estende-se.",
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

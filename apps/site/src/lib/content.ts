/**
 * O que a página diz.
 *
 * Texto e números num sítio só — o site tem quatro páginas que falam do mesmo
 * produto, e um preço escrito em dois ficheiros é um preço que vai divergir.
 *
 * ## A regra que atravessa este ficheiro
 *
 * **Nada aqui promete o que o produto não faz.** O que está construído está na
 * lista de módulos; o que está a caminho está no roteiro, marcado como tal. Um
 * clube que compra por causa de uma linha desta página e não a encontra lá dentro
 * cancela — e conta-o aos outros clubes, que é o que num mercado destes custa mais
 * do que a subscrição.
 */

/* -------------------------------------------------------------------------- */
/* Preços                                                                      */
/* -------------------------------------------------------------------------- */

/** Um ano pago à cabeça sai 10% mais barato. */
export const ANNUAL_DISCOUNT = 0.1;

export type Plan = {
  id: "consola" | "ligado";
  name: string;
  tagline: string;
  monthly: number;
  featured?: boolean;
  /** O que este plano faz, escrito como um clube o diria. */
  includes: string[];
  /** Só no plano de baixo: o que fica de fora, dito sem rodeios. */
  excludes?: string[];
};

export const PLANS: Plan[] = [
  {
    id: "consola",
    name: "Consola",
    tagline: "O clube por dentro. Tudo o que a direção e os treinadores precisam.",
    monthly: 14.99,
    includes: [
      "Atletas, equipas, escalões e staff",
      "Papéis e permissões à medida do clube",
      "Calendário, treinos, presenças e convocatórias",
      "Área técnica: editor tático, planos de treino e exercícios",
      "Avaliações e relatórios de atleta",
      "Departamento clínico: lesões, consultas e disponibilidade",
      "Scouting: prospectos, observações, vídeo e shortlists",
      "Comunicação segmentada e notificações",
      "Importação de atletas por Excel",
    ],
    excludes: ["App das famílias", "Mensalidades e pagamentos", "Página pública de adesão a sócio"],
  },
  {
    id: "ligado",
    name: "Connect",
    tagline: "O clube, as famílias e o dinheiro. A plataforma inteira.",
    monthly: 19.99,
    featured: true,
    includes: [
      "Tudo o que está na Consola",
      "App das famílias com a marca do clube (PWA)",
      "Convocatórias, presenças e avaliações no telemóvel dos pais",
      "Mensalidades: MB WAY, Multibanco e cartão",
      "Confirmação automática e estado sempre actualizado",
      "Página pública de adesão a sócio",
      "Gestão de sócios e quotas",
      "Notificações push para as famílias",
    ],
  },
];

export function annualTotal(monthly: number): number {
  return monthly * 12 * (1 - ANNUAL_DISCOUNT);
}

/** "14,99 €" — vírgula decimal, espaço antes do símbolo. Português, não inglês. */
export function euro(value: number): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(value);
}

/* -------------------------------------------------------------------------- */
/* Módulos                                                                     */
/* -------------------------------------------------------------------------- */

export type Module = {
  key: string;
  name: string;
  line: string;
  items: string[];
  /** Só o Connect. */
  paidTier?: boolean;
};

export const MODULES: Module[] = [
  {
    key: "gestao",
    name: "Gestão",
    line: "O registo do clube, com quem pode ver o quê.",
    items: ["Atletas e equipas", "Staff e papéis", "Permissões por pessoa", "Calendário", "Presenças e Convocatórias", "Gestão de Inventário", "Gestão de Sócios e quotas"],
  },
  {
    key: "tecnica",
    name: "Equipa técnica",
    line: "O treinador trabalha no que é dele",
    items: ["Treinos e presenças", "Convocatórias", "Avaliações por competência", "Relatórios de atleta", "Plantel e âmbito por equipa"],
  },
  {
    key: "treino",
    name: "Área técnica",
    line: "O treino desenha-se, planeia-se e mede-se.",
    items: [
      "Editor tático com animação por frames",
      "Futebol de 11, 9, 7 e 5 — e futsal",
      "Em expansão: basquetebol e outros desportos",
      "Planos de sessão por blocos",
      "Carga e tempo por objetivo, derivados",
      "Biblioteca de exercícios com favoritos",
      "Modelos de jogo e bolas paradas",
    ],
  },
  {
    key: "familias",
    name: "Famílias",
    line: "A app do clube no telemóvel dos pais.",
    paidTier: true,
    items: ["Próximo treino e próximo jogo", "Convocatórias", "Assiduidade", "Avaliações e relatórios", "Notificações", "Mensalidades"],
  },
  {
    key: "pagamentos",
    name: "Pagamentos",
    line: "A mensalidade cobra-se sozinha.",
    paidTier: true,
    items: ["MB WAY, Multibanco e cartão", "Mensalidades por escalão ou por atleta", "Confirmação automática", "Histórico e dívida real", "Lembretes"],
  },
  {
    key: "scouting",
    name: "Scouting",
    line: "Quem se anda a ver, e o que já se sabe dele.",
    items: ["Prospectos e funil", "Observações de jogo", "Avaliações", "Vídeo", "Shortlists"],
  },
  {
    key: "clinico",
    name: "Clínico",
    line: "Quem pode jogar no sábado.",
    items: ["Lesões e boletins", "Consultas e exames", "Disponibilidade do atleta", "Acesso restrito ao departamento"],
  },
  {
    key: "comunicacao",
    name: "Comunicação",
    line: "Uma mensagem chega a quem tem de a ler.",
    items: ["Avisos por público", "Notificações push", "Taxa de leitura", "Segmentação por equipa"],
  },
];

/* -------------------------------------------------------------------------- */
/* Segurança                                                                   */
/* -------------------------------------------------------------------------- */

export const SECURITY = [
  {
    title: "Cada clube é uma ilha",
    body: "O isolamento não é um filtro na aplicação — é uma política na base de dados. Um pedido que perca o contexto do clube não devolve dados a mais: não devolve nada.",
  },
  {
    title: "Permissões que o clube define",
    body: "Papéis com verbos concretos — quem lê mensalidades, quem escreve no boletim clínico, quem convoca. Um treinador vê os atletas das equipas dele; um pai vê os filhos.",
  },
  {
    title: "O acesso administrativo é restrito e registado",
    body: "Não dizemos que não conseguimos aceder — dizemos quem pode, quando, e que fica escrito. O acesso de apoio a um clube exige motivo e tem prazo.",
  },
  {
    title: "Dados clínicos à parte",
    body: "Categoria especial no RGPD, tratada como tal: fora do alcance de quem não é do departamento clínico, e fora do alcance do apoio ao cliente.",
  },
  {
    title: "Autenticação e sessões",
    body: "Contas geridas por um fornecedor de identidade dedicado. As palavras-passe nunca passam pelos nossos servidores.",
  },
  {
    title: "Registo de auditoria",
    body: "O que se faz sobre um clube fica registado, com quem e quando. Um registo que se pode apagar não é um registo.",
  },
  {
    title: "Na União Europeia",
    body: "Base de dados e ficheiros alojados na UE. Tratamos dados de menores; a região não é um detalhe de infra-estrutura.",
  },
  {
    title: "Sair é um direito, não uma negociação",
    body: "Os dados são do clube. Exportamo-los a pedido, e apagamos o que houver para apagar quando o clube sai.",
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
 * licenciamento com terceiros, e prometer um mês para uma coisa que depende de uma
 * assinatura alheia é a forma mais rápida de perder a confiança de um clube.
 */
export const ROADMAP: RoadmapItem[] = [
  {
    when: "Setembro 2026",
    title: "Pagamentos de mensalidade",
    body: "MB WAY, Multibanco e cartão. O clube define a mensalidade, a família paga, o estado actualiza-se sozinha.",
  },
  {
    when: "Setembro 2026",
    title: "Integração ZeroZero e FPF",
    body: "Jogos, calendários e resultados oficiais sem ninguém os copiar à mão. Depende de licenciamento — estamos a tratar disso.",
  },
  {
    when: "Outubro 2026",
    title: "Aplicação para os atletas",
    body: "O atleta instala a app do clube, vê o que é dele e recebe notificações. Treinos, convocatórias, presenças e avaliações.",
  },
  {
    when: "Outubro 2026",
    title: "Sistema Financeiro Avançado",
    body: "Todo o sistema financeiro do clube com despesas, receitas, relatórios e exportação para contabilidade.",
  },
  {
    when: "Novembro 2026",
    title: "Sistema de bilheteira",
    body: "Gestão da venda de bilhetes para os jogos do clube.",
  },
  {
    when: "Dezembro 2026",
    title: "Área técnica noutros desportos",
    body: "O editor tático, a biblioteca de exercícios e os modelos de jogo a chegar ao basquetebol e a outras modalidades — cada uma com o seu campo e as suas posições, não um relvado com outro nome.",
  },
  {
    when: "Janeiro 2027",
    title: "IA sobre os dados do clube",
    body: "Resumos e sinais a partir do que já lá está — nunca a inventar o que ninguém registou.",
  },
    {
    when: "Março 2027",
    title: "IA sobre os videos do clube",
    body: "Análise de vídeo com visão computacional, para extrair métricas e insights a partir do que o clube já grava para analisar adversarios, treinos e jogos.",
  },
];

/* -------------------------------------------------------------------------- */
/* Perguntas                                                                   */
/* -------------------------------------------------------------------------- */

export const FAQ = [
  {
    q: "Os dados do nosso clube ficam separados dos outros?",
    a: "Ficam. Cada pedido corre com o contexto do clube a que pertence e a base de dados recusa tudo o resto — não é um filtro que alguém se possa esquecer de escrever. O nosso painel interno vê contagens e estado de subscrição, não vê atletas nem famílias.",
  },
  {
    q: "Conseguimos exportar os nossos dados?",
    a: "Os dados são do clube. Hoje a exportação é feita por nós a pedido, em formato aberto, sem custo. A exportação directa a partir da consola está no roteiro.",
  },
  {
    q: "Como funciona a app das famílias?",
    a: "O clube gera um link e manda-o às famílias. O pai abre no telemóvel, instala a app do clube — nome, cor e ícone do clube, não os nossos — e identifica o filho pelo NIF e data de nascimento. A partir daí tem treinos, convocatórias, assiduidade, avaliações e mensalidades.",
  },
  {
    q: "Os pais têm de instalar alguma coisa da App Store?",
    a: "Não. É uma PWA: instala-se a partir do link, em dois toques, no iPhone e no Android. Não há loja, não há aprovação, não há actualizações a fazer.",
  },
  {
    q: "Como funcionam os pagamentos?",
    a: "O clube define a mensalidade — por escalão ou por atleta. A família recebe e paga por MB WAY, Multibanco ou cartão. A confirmação chega do banco ao nosso servidor e o estado no clube muda sozinho: ninguém marca nada como pago à mão.",
  },
  {
    q: "Podemos pôr a nossa marca na plataforma?",
    a: "Sim. O nome, a cor e o ícone do clube atravessam a consola, a app das famílias e a página pública de adesão. Quem instala a app instala a app do clube.",
  },
  {
    q: "Existe período de teste?",
    a: "Trinta dias, com a plataforma toda. Não pedimos cartão para começar.",
  },
  {
    q: "Podemos cancelar?",
    a: "A qualquer momento, e sem período mínimo. Hoje o cancelamento trata-se connosco — o autosserviço está a caminho. Ao sair, exportamos os dados do clube.",
  },
  {
    q: "Como funciona o suporte?",
    a: "Por email, com resposta em dias úteis. Nos primeiros trinta dias acompanhamos a montagem do clube — equipas, atletas, mensalidades e o convite às famílias.",
  },
  {
    q: "Conseguimos migrar de outro software?",
    a: "O plantel entra por Excel, com um modelo que damos e validação linha a linha antes de gravar. O resto da migração é assistida: fala connosco com o que tens e dizemos o que é possível.",
  },
];

/* -------------------------------------------------------------------------- */
/* Navegação                                                                   */
/* -------------------------------------------------------------------------- */

export const NAV_LINKS = [
  { to: "/software", label: "Software" },
  { to: "/planos", label: "Planos" },
  { to: "/contactos", label: "Contacto" },
];

/**
 * A identificação legal da entidade.
 *
 * Está vazia de propósito, e as páginas legais só mostram estes campos quando
 * tiverem valor: uma página com "[NOME DA EMPRESA]" à vista é pior do que uma
 * página sem morada, e inventar uma sede é pior do que as duas.
 *
 * Preencher antes de publicar os documentos legais.
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

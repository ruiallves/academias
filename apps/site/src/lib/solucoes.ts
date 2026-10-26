/**
 * As páginas de cada pesquisa.
 *
 * Quem procura um programa para o clube escreve coisas diferentes: "software
 * para clube de futebol", "gestão de sócios", "cobrar mensalidades por MB WAY".
 * Cada página destas responde a uma dessas pesquisas, com o que o produto faz
 * nesse assunto, as perguntas que um clube faz e links para as outras.
 *
 * As regras são as de `content.ts`: nada promete o que o produto não faz, e
 * escreve-se sem travessões, sem "X num só Y" e sem "não é A, é B".
 *
 * Para acrescentar uma página, junta-se aqui um objeto. O build gera o HTML, o
 * sitemap e os dados estruturados a partir desta lista.
 */

export type Bloco = {
  titulo: string;
  texto: string;
  itens: string[];
  /** Captura da consola (`con-…`) ou da app (`app-…`). */
  captura: string;
};

export type Solucao = {
  path: string;
  /** O nome curto, para os links entre páginas e o rodapé. */
  nome: string;
  title: string;
  description: string;
  /** A linha por cima do H1: a pesquisa, escrita como se escreve. */
  rotulo: string;
  h1: string;
  lede: string;
  captura: string;
  blocos: Bloco[];
  perguntas: { q: string; a: string }[];
  /** Outras páginas desta lista, pelo `path`. */
  relacionadas: string[];
};

export const SOLUCOES: Solucao[] = [
  /* ------------------------------------------------------------------------ */
  {
    path: "/gestao-clubes-futebol",
    nome: "Clubes de futebol",
    title: "Software de gestão para clubes de futebol | Academias",
    description:
      "Gestão do clube de futebol: plantéis por escalão, treinos, convocatórias, ficha de jogo, inscrições FPF e mensalidades por MB WAY. 30 dias grátis.",
    rotulo: "Software de gestão para clubes de futebol",
    h1: "O clube de futebol, do treino ao jogo",
    lede:
      "Atletas por escalão, treinos e convocatórias, a ficha de cada jogo e as mensalidades pagas por MB WAY. Para futebol de 11, 9, 7 e 5, dos petizes aos seniores.",
    captura: "con-jogo-ficha",
    blocos: [
      {
        titulo: "Plantéis e escalões",
        texto:
          "Cada atleta tem uma ficha com os dados pessoais, os documentos, a licença de cada época e o percurso pelos escalões. A passagem de época faz-se com um botão, e o escalão conta pela idade a 31 de dezembro.",
        itens: [
          "Equipas por escalão, com treinadores e staff",
          "Um atleta pode estar em duas equipas, com número e posição em cada uma",
          "Licenças federativas por época",
          "Importação e exportação do plantel por Excel",
        ],
        captura: "con-atleta",
      },
      {
        titulo: "Treino",
        texto:
          "O treinador desenha os exercícios no campo, monta o plano da sessão por blocos e planeia a época por ciclos, com a carga de cada semana à vista. As presenças marcam-se no telemóvel, no campo.",
        itens: [
          "Editor tático para futebol de 11, 9, 7 e 5, com animação",
          "Biblioteca de exercícios do clube",
          "Planeamento por mesociclos e microciclos",
          "Presenças e assiduidade por atleta",
        ],
        captura: "con-quadro-2",
      },
      {
        titulo: "Jogo",
        texto:
          "A convocatória chega à família pela app e a resposta volta ao treinador. No dia do jogo regista-se o resultado, quem jogou e quanto tempo, e no fim fica a ficha completa e o relatório.",
        itens: [
          "Convocatórias com confirmação da família",
          "Equipa inicial e substituições",
          "Jogo ao vivo com relógio por parte e tempo de compensação",
          "Golos, assistências, cartões e minutos de cada jogador",
          "Relatório do jogo e do adversário",
        ],
        captura: "con-convocatoria",
      },
      {
        titulo: "Federação e certificação",
        texto:
          "As inscrições saem no Modelo 2 da FPF, já preenchido com os dados de cada atleta, prontas a assinar. Para a certificação de entidade formadora, a consola estima o nível do clube e mostra o que falta para a estrela seguinte.",
        itens: [
          "Modelo 2 da FPF preenchido, um ou muitos atletas de cada vez",
          "Estimativa do nível de certificação FPF",
          "Requisitos por nível, com o que já está cumprido",
        ],
        captura: "con-certificacao",
      },
    ],
    perguntas: [
      {
        q: "Serve para a formação e para os seniores?",
        a: "Serve. O clube cria as equipas que tem, dos petizes aos seniores, e cada uma tem o seu plantel, treinadores, treinos e jogos. A direção vê o clube todo e cada treinador vê as suas equipas.",
      },
      {
        q: "Funciona para futebol de 7 e de 5?",
        a: "Funciona. O editor tático tem o campo de 11, 9, 7 e 5, e a equipa inicial e a ficha de jogo seguem o formato da equipa.",
      },
      {
        q: "A Academias faz a certificação da FPF pelo clube?",
        a: "Não. A certificação é atribuída pela FPF. A consola junta o que o clube já tem registado, estima o nível e mostra os requisitos que faltam, para a direção saber onde está antes de submeter.",
      },
      {
        q: "Os pais respondem às convocatórias?",
        a: "Respondem na app do clube, com o plano Connect. O treinador vê quem confirmou, quem não vai e quem ainda não respondeu.",
      },
      {
        q: "Os jogos vêm do ZeroZero ou da FPF?",
        a: "Ainda não. A integração está em curso e depende de licenciamento. Hoje o calendário de jogos importa-se por Excel ou cria-se na consola.",
      },
    ],
    relacionadas: ["/gestao-clubes-futsal", "/mensalidades-clube", "/app-clube", "/gestao-academias-desportivas"],
  },

  /* ------------------------------------------------------------------------ */
  {
    path: "/gestao-clubes-futsal",
    nome: "Clubes de futsal",
    title: "Software de gestão para clubes de futsal | Academias",
    description:
      "Gestão do clube de futsal: equipas, treinos, convocatórias, jogo ao vivo com substituições ilimitadas, minutos por atleta e inscrições FPF. 30 dias grátis.",
    rotulo: "Software de gestão para clubes de futsal",
    h1: "O clube de futsal, com os minutos de cada atleta",
    lede:
      "No futsal entra-se e sai-se muitas vezes. A consola acompanha as substituições ilimitadas, soma os minutos de cada atleta e guarda a ficha do jogo, com o resto do clube à volta.",
    captura: "con-jogo-visao",
    blocos: [
      {
        titulo: "Jogo ao vivo",
        texto:
          "Durante o jogo regista-se quem entra e quem sai, as vezes que for preciso. O relógio corre parte a parte, com pausas e intervalo, e os minutos de cada atleta somam-se sozinhos.",
        itens: [
          "Substituições ilimitadas, ligadas por equipa",
          "Minutos de cada atleta somados pelos períodos em campo",
          "Golos, assistências e cartões",
          "Prolongamento quando o jogo o tem",
        ],
        captura: "con-jogo-ficha",
      },
      {
        titulo: "Treino",
        texto:
          "O editor tático tem o campo de futsal. O treinador desenha os exercícios, monta o plano da sessão e marca as presenças.",
        itens: [
          "Editor tático com campo de futsal e animação",
          "Planos de sessão por blocos",
          "Planeamento da época por ciclos",
          "Presenças e assiduidade",
        ],
        captura: "con-plano-sessao",
      },
      {
        titulo: "Clube e federação",
        texto:
          "As inscrições de futsal saem no Modelo 2 da FPF, preenchido. As mensalidades cobram-se por MB WAY, Multibanco ou cartão, e as famílias recebem as convocatórias na app.",
        itens: [
          "Modelo 2 da FPF preenchido",
          "Atletas em várias modalidades com uma só ficha",
          "Mensalidades com confirmação automática",
          "Convocatórias com resposta da família",
        ],
        captura: "con-inscricoes",
      },
    ],
    perguntas: [
      {
        q: "O clube tem futebol e futsal. Precisa de duas contas?",
        a: "Não. O clube tem as modalidades que quiser na mesma conta. Um atleta que joga nas duas tem uma ficha, com número e posição em cada equipa, e a mensalidade soma as modalidades.",
      },
      {
        q: "Como se contam os minutos com substituições ilimitadas?",
        a: "Cada entrada e saída fica registada ao minuto, e os minutos do atleta são a soma dos períodos em campo. Se ninguém registou as substituições, os minutos escrevem-se à mão no pós-jogo.",
      },
      {
        q: "Serve para futsal feminino e de formação?",
        a: "Serve. Cada equipa tem o seu escalão e género, e os treinos, jogos e convocatórias são da equipa.",
      },
    ],
    relacionadas: ["/gestao-clubes-futebol", "/gestao-clubes-basquetebol", "/mensalidades-clube", "/app-clube"],
  },

  /* ------------------------------------------------------------------------ */
  {
    path: "/gestao-clubes-basquetebol",
    nome: "Clubes de basquetebol",
    title: "Software de gestão para clubes de basquetebol | Academias",
    description:
      "Gestão do clube de basquetebol: equipas por escalão, editor tático com campo FIBA, jogos ao vivo, inscrições FPB e mensalidades por MB WAY. 30 dias grátis.",
    rotulo: "Software de gestão para clubes de basquetebol",
    h1: "O clube de basquetebol, do minibasquete aos seniores",
    lede:
      "Equipas por escalão, treinos desenhados no campo FIBA, jogos com substituições ilimitadas e as inscrições da FPB preenchidas. As famílias recebem tudo na app do clube.",
    captura: "con-jogo-ficha",
    blocos: [
      {
        titulo: "Treino",
        texto:
          "O editor tático tem o campo de basquetebol com as marcações FIBA. Desenham-se jogadas e exercícios com animação, e o plano da sessão monta-se por blocos.",
        itens: [
          "Campo FIBA no editor tático",
          "Jogadas e exercícios com animação por fotogramas",
          "Biblioteca de exercícios do clube",
          "Presenças e assiduidade",
        ],
        captura: "con-basquetebol",
      },
      {
        titulo: "Jogo",
        texto:
          "O jogo regista-se ao vivo, período a período, com as substituições que houver. No fim ficam os pontos, as assistências e os minutos de cada atleta.",
        itens: [
          "Substituições ilimitadas",
          "Pontos, assistências e minutos por atleta",
          "Prolongamento",
          "Convocatórias com resposta da família",
        ],
        captura: "con-jogo-ficha",
      },
      {
        titulo: "Inscrições na FPB",
        texto:
          "As inscrições saem no Modelo 1 da Federação Portuguesa de Basquetebol, preenchido com os dados de cada atleta. O clube imprime, assina e entrega.",
        itens: [
          "Modelo 1 da FPB preenchido",
          "Licenças por época",
          "Documentos guardados na ficha do atleta",
        ],
        captura: "con-inscricoes",
      },
    ],
    perguntas: [
      {
        q: "O editor tático tem o campo de basquetebol?",
        a: "Tem, com as marcações FIBA. Cada modalidade do clube tem o seu campo no editor.",
      },
      {
        q: "Dá para ter basquetebol e outra modalidade no mesmo clube?",
        a: "Dá. O clube tem as modalidades que quiser, cada uma com as suas equipas, e a mensalidade de um atleta em duas modalidades soma as duas.",
      },
    ],
    relacionadas: ["/gestao-clubes-futsal", "/gestao-clubes-futebol", "/mensalidades-clube", "/gestao-socios"],
  },

  /* ------------------------------------------------------------------------ */
  {
    path: "/mensalidades-clube",
    nome: "Mensalidades",
    title: "Cobrar mensalidades do clube por MB WAY | Academias",
    description:
      "Mensalidades do clube pagas por MB WAY, Multibanco ou cartão, com confirmação automática. Preços por escalão, modalidade ou atleta. Sem marcar pagamentos à mão.",
    rotulo: "Gestão de mensalidades do clube",
    h1: "Mensalidades pagas por MB WAY, sem folhas de Excel",
    lede:
      "O clube define o preço, a família recebe o aviso na app e paga por MB WAY, Multibanco ou cartão. A confirmação chega do banco e o estado muda sozinho na consola.",
    captura: "con-mensalidades-depois",
    blocos: [
      {
        titulo: "Preço à medida do clube",
        texto:
          "A mensalidade define-se por escalão, por modalidade ou atleta a atleta. Um atleta em duas modalidades paga a soma das duas numa só mensalidade, e cada escalão pode ter o seu período de cobrança.",
        itens: [
          "Preço por escalão, por modalidade ou por atleta",
          "Ajustes de preço atleta a atleta",
          "Período de cobrança do clube todo ou por escalão",
          "Meses sem cobrança, como agosto",
        ],
        captura: "con-mensalidades-antes",
      },
      {
        titulo: "A família paga no telemóvel",
        texto:
          "Na app do clube a família vê o que tem por pagar e escolhe como paga. A referência Multibanco e o pedido MB WAY são gerados na hora.",
        itens: ["MB WAY", "Referência Multibanco", "Cartão", "Histórico de pagamentos na app"],
        captura: "app-pagar-metodos",
      },
      {
        titulo: "O dinheiro vai para a conta do clube",
        texto:
          "Os pagamentos passam pela euPago, uma instituição de pagamento portuguesa, na conta do próprio clube. A Academias não toca no dinheiro. A confirmação chega ao nosso servidor e a mensalidade fica paga na consola, com quem pagou e quando.",
        itens: [
          "Conta euPago em nome do clube",
          "Confirmação automática de cada pagamento",
          "O clube escolhe se a taxa fica com quem paga",
          "Contas do clube com receitas por mês",
        ],
        captura: "con-contas",
      },
    ],
    perguntas: [
      {
        q: "Quanto custa cada pagamento?",
        a: "As taxas são as da euPago, e o clube escolhe se ficam com o clube ou com quem paga. Quando ficam com quem paga, a taxa é igual em todos os métodos.",
      },
      {
        q: "Ainda é preciso marcar pagamentos como pagos?",
        a: "Não, nos pagamentos feitos pela app. A confirmação vem do banco. Um pagamento em dinheiro ou transferência marca-se à mão na consola.",
      },
      {
        q: "Em que plano estão os pagamentos?",
        a: "No Connect e no Connect Pro. A Consola, o plano de entrada, não tem pagamentos nem app para as famílias.",
      },
      {
        q: "O clube precisa de conta na euPago?",
        a: "Precisa. É a conta do clube, onde o dinheiro entra. Ajudamos a ligá-la durante os 30 dias de experiência.",
      },
    ],
    relacionadas: ["/gestao-socios", "/app-clube", "/gestao-clubes-futebol", "/gestao-academias-desportivas"],
  },

  /* ------------------------------------------------------------------------ */
  {
    path: "/gestao-socios",
    nome: "Sócios e quotas",
    title: "Gestão de sócios e quotas do clube | Academias",
    description:
      "Gestão de sócios do clube: categorias, quotas mensais ou anuais pagas por MB WAY, cartão de sócio digital com fotografia e adesão online. 30 dias grátis.",
    rotulo: "Gestão de sócios para clubes",
    h1: "Sócios, quotas e cartão de sócio no telemóvel",
    lede:
      "O sócio adere online, paga as quotas na app e tem o cartão com fotografia no telemóvel. O clube vê na consola quem tem as quotas em dia.",
    captura: "con-socios",
    blocos: [
      {
        titulo: "Categorias e quotas",
        texto:
          "O clube cria as categorias que tem, com o preço de cada uma. As quotas podem ser mensais ou anuais, e a quota anual abre no dia e mês que o clube escolher.",
        itens: [
          "Categorias de sócio com preço próprio",
          "Quotas mensais ou anuais",
          "Quotas pagas por MB WAY, Multibanco ou cartão",
          "Quotas de sócios menores pagas pelos encarregados",
        ],
        captura: "con-socios",
      },
      {
        titulo: "O sócio na app",
        texto:
          "O sócio tem a área dele na app do clube: o cartão digital com fotografia, as quotas, os jogos de todos os escalões e as novidades do clube.",
        itens: [
          "Cartão de sócio digital com fotografia",
          "Quotas pagas na app",
          "Jogos de todos os escalões, dia a dia",
          "Novidades e sondagens",
        ],
        captura: "app-socio-inicio",
      },
      {
        titulo: "Adesão online",
        texto:
          "O clube tem uma página pública de adesão a sócio. Quem quer ser sócio preenche o pedido online e escolhe a categoria, sem papel.",
        itens: [
          "Página de adesão com a marca do clube",
          "Escolha da categoria",
          "Sócio-atleta com as duas áreas na mesma conta",
          "Exportação da lista de sócios para Excel",
        ],
        captura: "app-socio-quotas",
      },
    ],
    perguntas: [
      {
        q: "O sócio precisa de instalar uma app da loja?",
        a: "Não. A app do clube instala-se a partir de um link, no iPhone e no Android, sem passar pela App Store nem pelo Google Play.",
      },
      {
        q: "Um pai pode ser sócio e encarregado de educação na mesma conta?",
        a: "Pode. A app tem uma área para cada papel, e quem tem os dois escolhe ao entrar e troca quando quiser.",
      },
      {
        q: "Dá para importar os sócios que já temos?",
        a: "Dá. A lista entra por Excel, com validação linha a linha antes de gravar.",
      },
    ],
    relacionadas: ["/mensalidades-clube", "/app-clube", "/site-clube", "/gestao-clubes-futebol"],
  },

  /* ------------------------------------------------------------------------ */
  {
    path: "/app-clube",
    nome: "App do clube",
    title: "App para clubes desportivos, com a marca do clube | Academias",
    description:
      "A app do clube para famílias, atletas e sócios: treinos, convocatórias, mensalidades, quotas e avisos, com o nome, a cor e o ícone do clube. Instala-se por link.",
    rotulo: "App para clubes desportivos",
    h1: "A app do teu clube, com o nome e as cores do clube",
    lede:
      "Uma app para as famílias, os atletas e os sócios. Instala-se a partir de um link, sem loja, e cada pessoa vê a sua parte do clube.",
    captura: "app-inicio",
    blocos: [
      {
        titulo: "Para as famílias",
        texto:
          "Os pais veem os treinos e os jogos dos filhos, respondem às convocatórias, avisam quando o filho falta e pagam as mensalidades.",
        itens: [
          "Treinos, jogos e convocatórias com resposta",
          "Aviso de falta ao treino",
          "Assiduidade, avaliações e relatórios",
          "Mensalidades por MB WAY, Multibanco e cartão",
        ],
        captura: "app-convocatoria",
      },
      {
        titulo: "Para os atletas e os sócios",
        texto:
          "O atleta tem a sua área, com a agenda e o que o treinador partilha com ele. O sócio tem o cartão, as quotas e os jogos do clube.",
        itens: [
          "Área do atleta com treinos, jogos e partilhas do treinador",
          "Área do sócio com cartão digital e quotas",
          "Uma conta para quem é pai e sócio",
          "Área de staff que abre a consola",
        ],
        captura: "app-area-atleta",
      },
      {
        titulo: "Avisos que chegam",
        texto:
          "O clube envia avisos por público, com notificações no telemóvel, e vê quem já leu. Acabam as mensagens perdidas no grupo de WhatsApp.",
        itens: ["Notificações push no iPhone e no Android", "Avisos por equipa, escalão ou clube", "Taxa de leitura", "Novidades e sondagens"],
        captura: "app-aviso",
      },
    ],
    perguntas: [
      {
        q: "A app está na App Store e no Google Play?",
        a: "Não precisa. A app instala-se a partir de um link em dois toques, no iPhone e no Android, e atualiza-se sozinha.",
      },
      {
        q: "A app fica com o nome do clube?",
        a: "Fica. O nome, a cor e o ícone do clube aparecem no ecrã do telemóvel e dentro da app.",
      },
      {
        q: "Em que plano está a app?",
        a: "No Connect e no Connect Pro, com os pagamentos e os sócios.",
      },
    ],
    relacionadas: ["/mensalidades-clube", "/gestao-socios", "/site-clube", "/gestao-academias-desportivas"],
  },

  /* ------------------------------------------------------------------------ */
  {
    path: "/site-clube",
    nome: "Site do clube",
    title: "Site para clubes desportivos com domínio .pt | Academias",
    description:
      "Site do clube com domínio .pt, notícias, equipas, calendário, loja online e bilheteira, ligado à gestão do clube. Alojamento e manutenção incluídos.",
    rotulo: "Site para clubes desportivos",
    h1: "O site do clube, ligado ao que o clube já tem",
    lede:
      "As equipas e o calendário saem da consola, as notícias escrevem-se lá, e a loja e a bilheteira ficam no próprio site. Tratamos do domínio .pt, do alojamento e da manutenção.",
    captura: "con-visao-geral",
    blocos: [
      {
        titulo: "Conteúdo que se atualiza sozinho",
        texto:
          "O site lê as equipas, os jogos e o calendário da consola. O que o clube muda lá aparece no site, sem ninguém o copiar.",
        itens: ["Notícias", "Equipas e plantéis", "Calendário de jogos", "Contactos e formulário"],
        captura: "con-visao-geral",
      },
      {
        titulo: "Loja e bilheteira",
        texto:
          "O clube vende equipamentos e bilhetes no próprio site, e o dinheiro entra na conta euPago do clube.",
        itens: ["Loja online com stock", "Bilheteira para os jogos, a partir de novembro de 2026", "Pagamento por MB WAY, Multibanco e cartão", "Página de adesão a sócio"],
        captura: "con-contas",
      },
    ],
    perguntas: [
      {
        q: "O domínio fica em nome de quem?",
        a: "Do clube. Registamo-lo e renovamo-lo nós enquanto o plano estiver ativo. Se o clube já tiver um domínio, usa-se esse.",
      },
      {
        q: "Em que plano está o site?",
        a: "No Connect Pro, que inclui tudo do Connect: a app do clube, os pagamentos e os sócios.",
      },
    ],
    relacionadas: ["/gestao-socios", "/app-clube", "/mensalidades-clube", "/gestao-clubes-futebol"],
  },

  /* ------------------------------------------------------------------------ */
  {
    path: "/gestao-academias-desportivas",
    nome: "Academias de formação",
    title: "Software para academias desportivas e escolas de formação | Academias",
    description:
      "Gestão de academias desportivas e escolas de futebol: atletas por escalão, treinos, presenças, avaliações, comunicação com as famílias e mensalidades por MB WAY.",
    rotulo: "Gestão de academias desportivas",
    h1: "A academia de formação, com as famílias por perto",
    lede:
      "Numa academia, a maior parte do trabalho é com os pais: treinos, faltas, avaliações e mensalidades. A consola organiza o clube e a app mantém as famílias a par.",
    captura: "con-presencas-depois",
    blocos: [
      {
        titulo: "Presenças e assiduidade",
        texto:
          "O treinador marca as presenças no telemóvel, no campo. A família avisa pela app quando o atleta falta, e a assiduidade de cada atleta fica sempre à vista.",
        itens: ["Presenças no telemóvel", "Aviso de falta pela família", "Assiduidade por atleta e por equipa", "Estado clínico no dia do treino"],
        captura: "con-presencas-depois",
      },
      {
        titulo: "Avaliações e relatórios",
        texto:
          "O treinador avalia cada atleta por competência, e a evolução fica guardada época a época. A família recebe os relatórios na app.",
        itens: ["Avaliações por competência", "Relatórios de atleta", "Evolução ao longo das épocas", "Notas da escola enviadas pelos pais"],
        captura: "con-atleta-avaliacoes",
      },
      {
        titulo: "Mensalidades e comunicação",
        texto:
          "As mensalidades pagam-se por MB WAY, Multibanco ou cartão, e a confirmação é automática. Os avisos chegam ao telemóvel das famílias, por equipa ou escalão.",
        itens: ["Mensalidades com confirmação automática", "Avisos por equipa ou escalão", "Taxa de leitura dos avisos", "Inscrição das famílias por link, com aprovação do clube"],
        captura: "con-comunicacao",
      },
    ],
    perguntas: [
      {
        q: "Serve para escolas de futebol e academias de outras modalidades?",
        a: "Serve. A Academias trabalha com futebol, futsal e basquetebol, e a parte de gestão, presenças, avaliações e mensalidades é igual em qualquer modalidade.",
      },
      {
        q: "Os pais inscrevem-se sozinhos?",
        a: "Inscrevem-se pelo link do clube e identificam o filho. O clube aprova o pedido antes de a família ter acesso.",
      },
      {
        q: "Quanto tempo leva a pôr a academia a funcionar?",
        a: "O plantel entra por Excel, com um modelo que damos. Nos primeiros 30 dias acompanhamos a montagem: equipas, atletas, mensalidades e o convite às famílias.",
      },
    ],
    relacionadas: ["/gestao-clubes-futebol", "/mensalidades-clube", "/app-clube", "/gestao-clubes-basquetebol"],
  },
];

export const solucaoDe = (path: string) => SOLUCOES.find((s) => s.path === path);

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
  /**
   * O ecrã principal: uma captura da consola ou do site no computador
   * (`con-…`, `site-…`), ou de um telemóvel (`app-…`, `site-tel-…`, `porta-…`,
   * `…-tel`).
   */
  captura: string;
  /** Um segundo ecrã, sempre num telemóvel: à frente do computador, ou ao lado do outro telemóvel. */
  tel?: string;
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
  /** O telemóvel do herói, à frente do computador (ou ao lado de outro telemóvel). */
  tel?: string;
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
    tel: "app-agenda",
    blocos: [
      {
        titulo: "A ficha de cada atleta",
        texto:
          "Na consola, a ficha junta os jogos, os minutos e os golos da época, as equipas em que o atleta joga, a ficha física e a assiduidade. Na app, a família vê a mesma ficha: a presença nos treinos, as convocatórias e a avaliação do treinador.",
        itens: [
          "Jogos, minutos e golos de cada época",
          "Equipas, número e posição",
          "Assiduidade nos treinos",
          "Documentos, licenças e percurso pelos escalões",
        ],
        captura: "con-atleta",
        tel: "app-atleta",
      },
      {
        titulo: "Exercícios desenhados no campo",
        texto:
          "O treinador desenha o exercício no editor tático e anima-o fotograma a fotograma: os jogadores e a bola movem-se de um para o seguinte. O exercício fica na biblioteca do clube e entra no plano da sessão.",
        itens: [
          "Campos de futebol de 11, 9, 7 e 5",
          "Animação por fotogramas",
          "Biblioteca de exercícios do clube",
          "Exercícios usados nos planos de sessão",
        ],
        captura: "con-quadro-2",
      },
      {
        titulo: "Convocatórias com resposta da família",
        texto:
          "A convocatória chega ao telemóvel de cada família, que confirma ou diz que não pode. Na consola, o treinador vê quem confirmou, quem não vai e porquê, e quem ainda não respondeu.",
        itens: [
          "Convocados, confirmados e por responder",
          "Motivo de quem não pode ir",
          "Aviso ao treinador quando alguém recusa",
          "Hora de cada resposta",
        ],
        captura: "con-convocatoria",
        tel: "app-convocatoria-confirmada",
      },
      {
        titulo: "Inscrições no Modelo 2 da FPF",
        texto:
          "As inscrições saem no Modelo 2 da FPF, já preenchido com os dados de cada atleta. A lista mostra em que passo está cada boletim, de por gerar a validado.",
        itens: [
          "Modelo 2 da FPF preenchido",
          "Um atleta ou muitos de uma vez",
          "Estado de cada boletim",
          "Licenças por época",
        ],
        captura: "con-inscricoes",
      },
      {
        titulo: "A certificação da FPF",
        texto:
          "Para a certificação de entidade formadora, a consola estima o nível do clube a partir do que já está registado e mostra o que falta para a estrela seguinte.",
        itens: [
          "Estimativa do nível e dos pontos",
          "O que falta para a estrela seguinte",
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
    relacionadas: ["/gestao-clubes-futsal", "/mensalidades-clube", "/app-clube", "/assistente-ia-clubes"],
  },

  /* ------------------------------------------------------------------------ */
  {
    path: "/gestao-clubes-futsal",
    nome: "Clubes de futsal",
    title: "Software de gestão para clubes de futsal | Academias",
    description:
      "Gestão do clube de futsal: equipas, treinos, convocatórias, jogo ao vivo com substituições ilimitadas, minutos por atleta e inscrições FPF. 30 dias grátis.",
    rotulo: "Software de gestão para clubes de futsal",
    h1: "O clube de futsal, do pavilhão ao telemóvel das famílias",
    lede:
      "O editor tático tem o campo de futsal, as famílias recebem os treinos e os jogos na app, e a ficha do jogo soma os minutos de cada atleta mesmo com substituições ilimitadas.",
    captura: "con-futsal",
    tel: "app-agenda",
    blocos: [
      {
        titulo: "Presenças no treino",
        texto:
          "O treinador marca as presenças no pavilhão, com as faltas avisadas pela família já justificadas e os atletas de baixa assinalados. Na app, a família vê a assiduidade do atleta.",
        itens: [
          "Folha de presenças de cada treino",
          "Faltas avisadas pela família, já justificadas",
          "Atletas de baixa no dia do treino",
          "Assiduidade do atleta na app",
        ],
        captura: "con-presencas-depois",
        tel: "app-atleta",
      },
      {
        titulo: "Convocatórias com resposta da família",
        texto:
          "A convocatória chega ao telemóvel de cada família, com o local, a hora de encontro e o que levar. A família confirma ou diz que não pode, e a resposta volta ao treinador.",
        itens: [
          "Convocatória no telemóvel",
          "Confirmar ou dizer que não pode, com o motivo",
          "Local, ponto de encontro e hora",
          "Notas do clube para o jogo",
        ],
        captura: "app-convocatoria",
        tel: "app-convocatoria-confirmada",
      },
      {
        titulo: "Inscrições na FPF e mensalidades",
        texto:
          "As inscrições de futsal saem no Modelo 2 da FPF, preenchido. As mensalidades chegam à app da família, que paga por MB WAY, Multibanco ou cartão.",
        itens: [
          "Modelo 2 da FPF preenchido",
          "Atletas em várias modalidades com uma só ficha",
          "Mensalidade que soma as modalidades do atleta",
          "Confirmação automática de cada pagamento",
        ],
        captura: "con-inscricoes",
        tel: "app-mensalidades-por-pagar",
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
    captura: "con-basquetebol",
    tel: "app-agenda",
    blocos: [
      {
        titulo: "Exercícios no campo FIBA",
        texto:
          "O editor tático tem o campo de basquetebol com as marcações FIBA. Desenham-se jogadas e exercícios com animação, e cada um fica na biblioteca do clube.",
        itens: [
          "Campo FIBA inteiro ou meio campo",
          "Jogadas e exercícios com animação por fotogramas",
          "Biblioteca de exercícios do clube",
          "Exercícios usados nos planos de sessão",
        ],
        captura: "con-basquetebol-lancamento",
      },
      {
        titulo: "Convocatórias com resposta da família",
        texto:
          "A convocatória chega ao telemóvel de cada família, que confirma ou diz que não pode. O treinador vê as respostas na consola antes do jogo.",
        itens: [
          "Convocatória no telemóvel",
          "Confirmar ou dizer que não pode, com o motivo",
          "Local, ponto de encontro e hora",
          "Hora de cada resposta",
        ],
        captura: "app-convocatoria",
        tel: "app-convocatoria-confirmada",
      },
      {
        titulo: "Inscrições na FPB",
        texto:
          "As inscrições saem no Modelo 1 da Federação Portuguesa de Basquetebol, preenchido com os dados de cada atleta. A lista mostra em que passo está cada boletim.",
        itens: [
          "Modelo 1 da FPB preenchido",
          "Estado de cada boletim, de por gerar a validado",
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
    tel: "app-mensalidades-pago",
    blocos: [
      {
        titulo: "As mensalidades do mês",
        texto:
          "No início do mês as mensalidades são emitidas para cada atleta, com o preço do escalão, da modalidade ou do próprio atleta. A lista mostra o que está pago, o que está por pagar e o que já venceu.",
        itens: [
          "Preço por escalão, por modalidade ou por atleta",
          "Pagas, por pagar e vencidas",
          "Período de cobrança do clube todo ou por escalão",
          "Meses sem cobrança, como agosto",
        ],
        captura: "con-mensalidades-antes",
      },
      {
        titulo: "A família paga no telemóvel",
        texto:
          "Na app do clube a família vê o que tem por pagar e escolhe como paga. O pedido MB WAY e a referência Multibanco são gerados na hora.",
        itens: [
          "MB WAY",
          "Referência Multibanco",
          "Cartão",
          "Histórico de pagamentos na app",
        ],
        captura: "app-mensalidades-por-pagar",
        tel: "app-pagar-metodos",
      },
      {
        titulo: "As contas do clube, mês a mês",
        texto:
          "Os pagamentos entram na conta euPago do próprio clube e aparecem nas contas como receita do mês. A Academias não toca no dinheiro.",
        itens: [
          "Saldo, receitas e despesas de cada mês",
          "Previsão dos próximos meses",
          "O clube escolhe se a taxa fica com quem paga",
          "Também no telemóvel, na área de staff",
        ],
        captura: "con-contas",
        tel: "con-contas-tel",
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
    tel: "app-socio-inicio",
    blocos: [
      {
        titulo: "Adesão a sócio no site do clube",
        texto:
          "Quem quer ser sócio escolhe a categoria numa página com a marca do clube, vê o preço e o que a categoria dá, e faz o pedido sem papel. O pedido chega à consola para o clube aprovar.",
        itens: [
          "Categorias de sócio com preço próprio",
          "Quotas mensais ou anuais",
          "Pedido de adesão online",
          "Quotas de sócios menores pagas pelos encarregados",
        ],
        captura: "site-socio",
      },
      {
        titulo: "O sócio na app",
        texto:
          "O sócio vê as quotas que já pagou e paga as seguintes na app. Quem é sócio e pai, ou sócio e atleta, escolhe a área ao abrir a app e troca quando quiser, sem sair da conta.",
        itens: [
          "Quotas em dia e próximos meses",
          "Pagamento adiantado de quotas",
          "Uma conta para várias áreas",
          "Cartão de sócio digital com fotografia",
        ],
        captura: "app-socio-quotas",
        tel: "app-contextos",
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
    tel: "app-inicio-serra",
    blocos: [
      {
        titulo: "Convocatórias e mensalidades",
        texto:
          "Os pais respondem às convocatórias dos filhos e pagam as mensalidades sem sair da app. O treinador fica a saber quem vai, e o clube recebe o pagamento confirmado pelo banco.",
        itens: [
          "Convocatória com local, hora e notas do clube",
          "Confirmar ou dizer que não pode",
          "Mensalidades por MB WAY, Multibanco e cartão",
          "Histórico do que já está pago",
        ],
        captura: "app-convocatoria",
        tel: "app-mensalidades-por-pagar",
      },
      {
        titulo: "Para os atletas e os sócios",
        texto:
          "O atleta tem a sua área, com os treinos, os jogos e as convocatórias dele. O sócio tem o cartão, as quotas e os jogos do clube.",
        itens: [
          "Área do atleta com treinos, jogos e convocatórias",
          "Área do sócio com cartão digital e quotas",
          "Uma conta para quem é pai e sócio",
          "Área de staff que abre a consola",
        ],
        captura: "app-area-atleta",
        tel: "app-socio-inicio",
      },
      {
        titulo: "Avisos que chegam, e saber quem leu",
        texto:
          "O clube escreve na consola para uma equipa, um escalão ou o clube todo. O aviso chega como notificação ao telemóvel, e a consola mostra quantas famílias já o leram.",
        itens: [
          "Notificações no iPhone e no Android",
          "Avisos por equipa, escalão ou clube",
          "Taxa de leitura",
          "Novidades e sondagens",
        ],
        captura: "con-comunicacao",
        tel: "app-aviso",
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
    title: "Site para clubes desportivos com loja, bilheteira e domínio .pt | Academias",
    description:
      "Site do clube com domínio .pt: notícias, equipas e plantéis, calendário, loja online e bilheteira com bilhete QR lido à porta. Ligado à gestão do clube, com alojamento incluído.",
    rotulo: "Site para clubes desportivos",
    h1: "O site do clube, ligado ao que o clube já tem",
    lede:
      "As equipas, os jogos e os resultados saem da consola, as notícias escrevem-se lá, e a loja e a bilheteira vendem no próprio site. Tratamos do domínio .pt, do alojamento e da manutenção.",
    captura: "site-inicio",
    tel: "site-tel-loja",
    blocos: [
      {
        titulo: "Notícias com a cara do clube",
        texto:
          "As notícias escrevem-se no menu Website da consola, com fotografia, categoria e destaque. Na página inicial aparecem as mais recentes, o próximo jogo e o último resultado.",
        itens: [
          "Notícias por categoria, com destaque na página inicial",
          "Próximo jogo e último resultado",
          "Partilha com imagem no WhatsApp e no Facebook",
          "Páginas preparadas para o Google",
        ],
        captura: "site-noticias",
        tel: "site-tel-noticia",
      },
      {
        titulo: "Equipas e plantéis",
        texto:
          "Cada equipa tem a sua página, com a equipa técnica, o plantel, os jogos e os resultados. O clube escolhe que equipas aparecem, se o plantel leva fotografias e se os resultados dos escalões mais novos ficam de fora.",
        itens: [
          "Equipa técnica e plantel com número e posição",
          "Fotografias dos atletas, ligadas por equipa",
          "Resultados escondidos onde a federação não os deixa publicar",
          "Tudo atualizado a partir da consola",
        ],
        captura: "site-plantel",
        tel: "site-tel-equipa",
      },
      {
        titulo: "Calendário de jogos e eventos",
        texto:
          "Os jogos de todas as equipas e os eventos do clube, por ordem, com o local e a competição. Um jogo marcado na consola aparece no site sem ninguém o copiar.",
        itens: [
          "Jogos de todas as equipas e modalidades",
          "Eventos do clube, como a assembleia ou o jantar de Natal",
          "Resultados à medida que os jogos acabam",
          "Ligação direta para os bilhetes de cada jogo",
        ],
        captura: "site-calendario",
        tel: "site-tel-calendario",
      },
      {
        titulo: "Loja online",
        texto:
          "O clube vende equipamentos e artigos de adepto no próprio site, com tamanhos, stock e fotografias. Quem compra paga por MB WAY, Multibanco ou cartão, e o dinheiro entra na conta euPago do clube.",
        itens: [
          "Artigos com tamanhos e stock por tamanho",
          "Levantamento na sede ou envio por correio",
          "As encomendas chegam à consola",
          "Fatura automática no programa de faturação do clube",
        ],
        captura: "site-loja",
      },
      {
        titulo: "A página de cada artigo",
        texto:
          "Fotografias grandes, os tamanhos numa grelha com os esgotados riscados, e os botões de comprar sempre à mão. No telemóvel, o preço e o botão ficam numa barra no fundo do ecrã.",
        itens: [
          "Galeria com várias fotografias",
          "Tamanhos esgotados e últimas unidades à vista",
          "Carrinho com vários artigos",
          "Entrega e pagamento explicados na própria página",
        ],
        captura: "site-produto",
      },
      {
        titulo: "Bilheteira com o mapa do estádio",
        texto:
          "O clube desenha o estádio com as bancadas e as portas, e põe os bilhetes de cada jogo à venda. Quem compra escolhe a bancada no mapa, e os sócios com as quotas em dia compram ao preço de sócio.",
        itens: [
          "Preços por bancada e por categoria de sócio",
          "Venda só para sócios, sócios primeiro, ou para todos",
          "Lotação por bancada e lugares anuais",
          "Jogos em casa e fora",
        ],
        captura: "site-estadio",
        tel: "site-tel-estadio",
      },
      {
        titulo: "O bilhete com QR, lido à porta",
        texto:
          "Pago o bilhete, o código QR chega ao telemóvel e ao email. À porta, o segurança abre o leitor com um link e um PIN, aponta a câmara e o ecrã diz logo se a pessoa entra. Um bilhete só entra uma vez.",
        itens: [
          "Bilhete com QR no telemóvel e no email",
          "Leitor no telemóvel do segurança, sem conta nem app",
          "Ecrã verde, vermelho ou âmbar, com som e vibração",
          "Porta certa para cada bancada e contador de entradas",
        ],
        captura: "site-tel-bilhete",
        tel: "porta-ok-tel",
      },
      {
        titulo: "Dois temas, com as cores do clube",
        texto:
          "O clube escolhe o tema. O Holofote, no computador, tem o menu ao lado e a notícia em grande. O Tribuna, no telemóvel, tem o menu em cima. Os dois levam o emblema, a cor e as fotografias do clube.",
        itens: [
          "Tema Holofote e tema Tribuna, a trocar quando o clube quiser",
          "Domínio .pt em nome do clube",
          "Alojamento, SSL e manutenção incluídos",
          "Páginas legais e livro de reclamações já feitos",
        ],
        captura: "site-holofote",
        tel: "site-tel-inicio",
      },
    ],
    perguntas: [
      {
        q: "O domínio fica em nome de quem?",
        a: "Do clube. Registamo-lo e renovamo-lo nós enquanto o plano estiver ativo. Se o clube já tiver um domínio, usa-se esse.",
      },
      {
        q: "Em que plano está o site?",
        a: "No Connect Pro, que inclui tudo do Connect: a app do clube, os pagamentos e os sócios. Nos 30 dias de experiência o site está incluído, num endereço de pré-visualização.",
      },
      {
        q: "Os seguranças precisam de instalar alguma coisa para ler os bilhetes?",
        a: "Não. O clube envia a cada porta um link e um PIN. O segurança abre o link no telemóvel, escreve o PIN e aponta a câmara aos bilhetes. O link só serve para aquele jogo e aquela porta, e caduca no fim do dia.",
      },
      {
        q: "O dinheiro da loja e dos bilhetes vai para onde?",
        a: "Para a conta euPago do clube, como as mensalidades. A Academias não toca no dinheiro.",
      },
      {
        q: "Quem escreve as notícias?",
        a: "Quem o clube quiser. A permissão de mexer no site dá-se a um cargo, e o resto do staff não lhe toca.",
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
    captura: "con-atleta-avaliacoes",
    tel: "app-inicio",
    blocos: [
      {
        titulo: "Presenças e assiduidade",
        texto:
          "O treinador marca as presenças no campo, com as faltas avisadas pela família já justificadas e os atletas de baixa assinalados. Na app, a família vê a assiduidade do filho.",
        itens: [
          "Folha de presenças de cada treino",
          "Faltas avisadas pela família, já justificadas",
          "Atletas de baixa no dia do treino",
          "Assiduidade do atleta na app",
        ],
        captura: "con-presencas-depois",
        tel: "app-atleta",
      },
      {
        titulo: "Avaliações por competência",
        texto:
          "O treinador avalia cada atleta por competência e publica. A família recebe a avaliação na app, com a evolução desde a avaliação anterior.",
        itens: [
          "Competências definidas pelo clube",
          "Avaliação por período",
          "Evolução ao longo da época",
          "Relatórios de atleta",
        ],
        captura: "con-avaliacao",
        tel: "app-atleta-avaliacoes",
      },
      {
        titulo: "Avisos às famílias",
        texto:
          "Os avisos chegam ao telemóvel das famílias, por equipa ou escalão, e a consola mostra quem já leu. Acabam as mensagens perdidas no grupo dos pais.",
        itens: [
          "Avisos por equipa ou escalão",
          "Notificação no telemóvel",
          "Taxa de leitura dos avisos",
          "Inscrição das famílias por link, com aprovação do clube",
        ],
        captura: "con-comunicacao",
        tel: "app-aviso",
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
    relacionadas: ["/gestao-clubes-futebol", "/mensalidades-clube", "/app-clube", "/assistente-ia-clubes"],
  },

  /* ------------------------------------------------------------------------ */
  {
    path: "/assistente-ia-clubes",
    nome: "Assistente IA",
    title: "Assistente com IA para clubes desportivos | Academias",
    description:
      "O assistente com IA da Academias marca presenças, regista lesões, faz convocatórias, planeia treinos com exercícios desenhados e escreve comunicados a partir do que o treinador diz. Nada fica gravado sem confirmar. 14,99 € por mês em qualquer plano.",
    rotulo: "Assistente com IA para clubes desportivos",
    h1: "Diz ao assistente o que aconteceu, e ele trata do resto",
    lede:
      "Está em todas as páginas da consola. Escreve-se ou fala-se, como a um adjunto à beira do campo, e ele prepara as presenças, a lesão, a convocatória, o treino ou o comunicado. Uma pessoa do clube confirma, e só então fica gravado.",
    captura: "con-assistente-mini",
    tel: "con-assistente-tel",
    blocos: [
      {
        titulo: "As presenças ditas numa frase",
        texto:
          "\"No treino de hoje faltou o Lourenço, a mãe avisou. O Salvador continua de baixa.\" O assistente abre a folha do treino com os 16 atletas no estado certo: a falta avisada pela família já justificada, o atleta de baixa assinalado, os outros presentes. Confirmar grava a folha como se tivesse sido feita à mão.",
        itens: [
          "Presenças, faltas, atrasos e justificações",
          "Os nomes resolvem-se contra o plantel, com alcunhas e sem acentos",
          "Dois atletas com o mesmo nome viram uma pergunta, nunca um palpite",
          "Também por voz, no campo, com o telemóvel",
        ],
        captura: "con-assistente",
        tel: "con-assistente-tel",
      },
      {
        titulo: "Lesões, convocatórias e marcações",
        texto:
          "\"O Dinis saiu com dor no joelho\" regista a lesão ou avisa o departamento clínico, conforme quem fala pode ou não escrever no boletim. \"Convoca os mesmos do último jogo menos o Pedro\" monta a convocatória. \"Marca um jogo sábado às 16h contra o Vizela\" abre o formulário com as regras do clube: os campos de casa em lista, os balneários, a prova da equipa.",
        itens: [
          "Lesão ou aviso ao clínico, conforme as permissões de quem fala",
          "Convocatória a partir da anterior, de uma lista ou de critérios",
          "Marcar, mudar e desmarcar treinos, jogos e eventos",
          "Inscrever um atleta novo",
        ],
        captura: "con-assistente-convocatoria",
        tel: "con-assistente-convocatoria-tel",
      },
      {
        titulo: "Treinos planeados em blocos",
        texto:
          "Pede um treino de passe e receção para os Sub-13, véspera de jogo, e recebe a sessão em quatro blocos com o tempo, a intensidade e os exercícios. Os exercícios que o clube já tem na biblioteca são reaproveitados; os novos vêm desenhados. Se quiseres, o assistente procura ideias na internet antes de planear.",
        itens: [
          "Blocos com duração, objetivo e intensidade",
          "Exercícios da biblioteca do clube e exercícios novos",
          "À medida do escalão e do número de atletas",
          "Fica na Área técnica, no treino a que pertence",
        ],
        captura: "con-assistente-plano",
        tel: "con-assistente-plano-tel",
      },
      {
        titulo: "Exercícios desenhados no campo",
        texto:
          "\"Cria um exercício de saída de bola a três, com finalização, para 12 jogadores.\" O exercício nasce desenhado no campo da modalidade, em vários momentos animados, com os pontos-chave escritos. Ao confirmar entra na biblioteca do clube, pronto a usar num plano.",
        itens: [
          "Futebol de 11, 9, 7 e 5, futsal e basquetebol",
          "Animação por momentos, como no editor tático",
          "Edita-se depois no editor, como qualquer outro",
          "Procura de ideias na internet, se o treinador pedir",
        ],
        captura: "con-assistente-exercicio",
        tel: "con-assistente-exercicio-tel",
      },
      {
        titulo: "Comunicados e notícias escritos por ele",
        texto:
          "\"Avisa os pais dos Sub-11 que não há treino amanhã por causa da chuva.\" O comunicado sai redigido com o tom de um clube a escrever às famílias, com o dia concreto em vez de \"amanhã\", para rever e mudar antes de enviar. Nos clubes com site, escreve também a notícia do jogo a partir do resultado e dos marcadores.",
        itens: [
          "Comunicados às famílias, por equipa ou escalão",
          "Notícias do site do clube, no Connect Pro",
          "Sempre para rever antes de sair",
          "Sem envio agendado: sai ao confirmar",
        ],
        captura: "con-assistente-comunicado",
        tel: "con-assistente-comunicado-tel",
      },
      {
        titulo: "Perguntas aos dados do clube",
        texto:
          "\"Quando é o próximo jogo dos Sub-13?\", \"quem faltou mais aos treinos em outubro?\", \"quem está indisponível para sábado?\". O assistente lê o que está na plataforma e responde com os dados do clube, sem inventar. Um treinador só vê as equipas dele, como na consola.",
        itens: [
          "Treinos, jogos, convocatórias e indisponíveis",
          "Com o âmbito e as permissões de quem pergunta",
          "Sem dados clínicos além de indisponível, de baixa ou condicionado",
          "Importa um Excel de atletas tal como está, sem gastar créditos",
        ],
        captura: "con-assistente-pergunta",
      },
    ],
    perguntas: [
      {
        q: "O assistente grava alguma coisa sozinho?",
        a: "Não. Tudo o que prepara é uma proposta num cartão, com o botão Confirmar. Quem grava é a pessoa do clube que carrega no botão, com as permissões dela. Depois de confirmar há dez minutos para desfazer.",
      },
      {
        q: "Quanto custa?",
        a: "É um extra de 14,99 € por mês, com IVA, em qualquer plano, com 4.000 créditos por mês. Marcar presenças, registar uma lesão ou fazer uma convocatória gasta cerca de 1 crédito. Um treino planeado com ideias da internet gasta perto de 100. Um clube com oito equipas usa cerca de metade do saldo.",
      },
      {
        q: "O que acontece quando os créditos acabam?",
        a: "O clube compra mais 4.000 créditos por 9,99 € ou espera pelo mês seguinte. Não há cobranças automáticas: a direção decide. A importação de ficheiros não gasta créditos.",
      },
      {
        q: "Que dados saem da plataforma?",
        a: "O que a pessoa escreve e os nomes dos atletas de que a resposta precisa vão ao fornecedor do modelo de linguagem, pela rota europeia, sem ficarem guardados nem servirem para treinar modelos. Datas de nascimento, contactos, NIF, moradas e diagnósticos clínicos não saem. O Acordo de Tratamento de Dados identifica o fornecedor.",
      },
      {
        q: "O assistente pode errar?",
        a: "Pode, como qualquer modelo de linguagem. Por isso nada fica gravado sem uma pessoa ver o cartão e confirmar, e por isso ele pergunta em vez de assumir o que não foi dito: o local do jogo, a prova, a hora de fim. O que fica gravado é responsabilidade de quem confirmou, como na consola.",
      },
      {
        q: "Funciona por voz?",
        a: "Funciona. Há um botão para ditar e um modo de conversa mãos-livres, em que o assistente responde em voz alta. Confirmar continua a ser um toque no cartão: dizer \"confirma\" não grava nada.",
      },
      {
        q: "Está em todos os planos?",
        a: "É um extra que se junta a qualquer plano, Consola, Connect ou Connect Pro, pelo mesmo preço. Nos 30 dias de experiência está incluído.",
      },
    ],
    relacionadas: ["/gestao-clubes-futebol", "/gestao-academias-desportivas", "/app-clube", "/site-clube"],
  },
];

export const solucaoDe = (path: string) => SOLUCOES.find((s) => s.path === path);

/**
 * Um clube inventado, para o site se poder ver antes de haver endpoints.
 *
 * A AD Monte Verde não existe. As fotos vêm do picsum e são paisagens: servem
 * para medir o lugar das fotos reais, não para fingir que são do clube.
 * Datas relativas a hoje, para o "próximo jogo" ser sempre próximo.
 */

import type { Clube, Equipa, Evento, Jogo, Noticia, Produto } from "../tipos";

const foto = (seed: string, w = 1200, h = 800) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

/** Hoje às 00:00 de Lisboa, aproximado: basta para datas de demonstração. */
function dia(offset: number, hhmm = "16:00"): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  const [h, m] = hhmm.split(":").map(Number);
  // Lisboa está a UTC+1 entre finais de março e finais de outubro.
  const mes = d.getUTCMonth() + 1;
  const verao = mes >= 4 && mes <= 10;
  d.setUTCHours(h - (verao ? 1 : 0), m);
  return d.toISOString();
}

export const DOMINIOS_DEMO: Record<string, string> = {
  "admonteverde.pt": "monteverde",
  "www.admonteverde.pt": "monteverde",
};

export const CLUBE: Clube = {
  slug: "monteverde",
  layout: "classico",
  name: "Associação Desportiva de Monte Verde",
  shortName: "AD Monte Verde",
  city: "Guimarães",
  signalColor: "#1f4e8c",
  foundedYear: 1947,
  motto: "Do monte para o campo",
  about:
    "Clube de formação de Guimarães com futebol, futsal e basquetebol. Mais de 300 atletas dos 5 aos 19 anos, uma equipa sénior no Campeonato de Portugal e uma comunidade de sócios que enche o Estádio do Monte em cada jogo em casa.",
  history: [
    "A AD Monte Verde nasceu em 1947, quando um grupo de operários da fábrica de curtumes juntou dinheiro para comprar uma bola e alugar o terreno baldio junto ao monte. O primeiro jogo oficial foi contra o Vitória B, e perdeu-se por 6-1. O segundo também se perdeu. Ao terceiro ano o clube subiu à distrital.",
    "O Estádio do Monte foi construído em 1963 pelos próprios sócios, aos fins-de-semana, com cimento oferecido pela Câmara. A bancada central ainda é a original. O relvado sintético chegou em 2011 e o segundo campo, de formação, em 2019.",
    "Hoje o clube é sobretudo formação: 14 equipas, 23 treinadores com certificação e um departamento clínico próprio. Os seniores disputam o Campeonato de Portugal desde 2022, e a equipa de futsal feminino foi campeã distrital em 2025.",
  ],
  modalidades: ["Futebol", "Futsal", "Basquetebol"],
  address: {
    lines: ["Estádio do Monte", "Rua da Fábrica Velha, 12", "4810-225 Guimarães"],
    mapsUrl: "https://maps.google.com/?q=Guimar%C3%A3es",
  },
  phone: "253 000 000",
  email: "geral@admonteverde.pt",
  social: {
    facebook: "https://facebook.com/",
    instagram: "https://instagram.com/",
    youtube: "https://youtube.com/",
  },
  membershipUrl: "https://monteverde.academias.pt/ser-socio",
  board: [
    { name: "Rui Martins", role: "Presidente" },
    { name: "Ana Fernandes", role: "Vice-presidente" },
    { name: "Carlos Oliveira", role: "Tesoureiro" },
    { name: "Marta Sousa", role: "Diretora da formação" },
    { name: "João Pedro Lima", role: "Diretor desportivo" },
    { name: "Sofia Ribeiro", role: "Secretária" },
  ],
  facilities: [
    {
      name: "Estádio do Monte",
      description: "Campo principal, relvado sintético, bancada com 1 200 lugares e iluminação para jogos noturnos.",
      image: foto("estadio", 1200, 800),
    },
    {
      name: "Campo 2",
      description: "Campo de formação, com duas metades para futebol de 7 e balneários próprios.",
      image: foto("campo2", 1200, 800),
    },
    {
      name: "Pavilhão Dr. Azevedo",
      description: "Pavilhão municipal onde treinam e jogam o futsal e o basquetebol.",
      image: foto("pavilhao", 1200, 800),
    },
  ],
  recintos: [
    {
      id: "estadio-monte",
      nome: "Estádio do Monte",
      tipo: "campo",
      bancadas: [
        { id: "central", nome: "Central", lado: "nascente", ordem: 0, lotacao: 450, coberta: true },
        { id: "poente", nome: "Bancada Poente", lado: "poente", ordem: 0, lotacao: 350, coberta: false },
        { id: "topo-norte", nome: "Topo Norte", lado: "norte", ordem: 0, lotacao: 250, coberta: false },
        { id: "visitantes", nome: "Visitantes", lado: "sul", ordem: 0, lotacao: 150, coberta: false },
      ],
    },
  ],
  sponsors: [
    { name: "Curtumes do Ave" },
    { name: "Café Central" },
    { name: "Farmácia do Monte" },
    { name: "Construções Lima & Filhos" },
    { name: "Auto Guimarães" },
    { name: "Padaria Flor do Minho" },
  ],
};

const EQUIPAS: Equipa[] = [
  {
    id: "seniores",
    slug: "seniores",
    name: "Seniores",
    sport: "Futebol",
    maxAge: null,
    gender: "M",
    image: foto("seniores", 1200, 800),
    competition: "Campeonato de Portugal, Série A",
    staff: [
      { name: "Miguel Antunes", role: "Treinador principal" },
      { name: "Pedro Castro", role: "Treinador adjunto" },
      { name: "Tiago Mendes", role: "Treinador de guarda-redes" },
      { name: "Inês Rocha", role: "Fisioterapeuta" },
    ],
    roster: [
      { name: "Bruno Sá", number: 1, position: "Guarda-redes" },
      { name: "Diogo Freitas", number: 2, position: "Defesa" },
      { name: "Rafael Costa", number: 4, position: "Defesa" },
      { name: "André Pinto", number: 5, position: "Defesa" },
      { name: "Gonçalo Vieira", number: 6, position: "Médio" },
      { name: "Hugo Teixeira", number: 8, position: "Médio" },
      { name: "Nuno Barbosa", number: 10, position: "Médio" },
      { name: "Fábio Marques", number: 7, position: "Avançado" },
      { name: "Leandro Silva", number: 9, position: "Avançado" },
      { name: "Ricardo Lopes", number: 11, position: "Avançado" },
    ],
  },
  {
    id: "sub19",
    slug: "sub-19",
    name: "Sub-19",
    sport: "Futebol",
    maxAge: 19,
    gender: "M",
    image: foto("sub19", 1200, 800),
    competition: "Juniores A, 1.ª Divisão AF Braga",
    staff: [
      { name: "Vasco Moreira", role: "Treinador principal" },
      { name: "Luís Faria", role: "Treinador adjunto" },
    ],
    roster: [],
  },
  {
    id: "sub15",
    slug: "sub-15",
    name: "Sub-15",
    sport: "Futebol",
    maxAge: 15,
    gender: "M",
    image: foto("sub15", 1200, 800),
    competition: "Iniciados, 1.ª Divisão AF Braga",
    staff: [{ name: "Carla Nunes", role: "Treinadora principal" }],
    roster: [],
  },
  {
    id: "sub11",
    slug: "sub-11",
    name: "Sub-11",
    sport: "Futebol",
    maxAge: 11,
    gender: "MISTA",
    image: foto("sub11", 1200, 800),
    competition: "Benjamins, AF Braga",
    staff: [
      { name: "Joana Carvalho", role: "Treinadora principal" },
      { name: "Filipe Santos", role: "Treinador adjunto" },
    ],
    roster: [],
  },
  {
    id: "futsal-fem",
    slug: "futsal-feminino",
    name: "Futsal feminino",
    sport: "Futsal",
    maxAge: null,
    gender: "F",
    image: foto("futsalfem", 1200, 800),
    competition: "Campeonato Distrital, AF Braga",
    staff: [{ name: "Sérgio Alves", role: "Treinador principal" }],
    roster: [],
  },
  {
    id: "basquete-sub14",
    slug: "basquetebol-sub-14",
    name: "Basquetebol Sub-14",
    sport: "Basquetebol",
    maxAge: 14,
    gender: "MISTA",
    image: foto("basquete", 1200, 800),
    competition: "ABM, Sub-14",
    staff: [{ name: "Helena Machado", role: "Treinadora principal" }],
    roster: [],
  },
];

const BILHETES_CASA = {
  open: true,
  capacity: 1200,
  recintoId: "estadio-monte",
  types: [
    { id: "central", name: "Central", price: 8, description: "Lugar marcado, coberto.", bancadaId: "central" },
    { id: "central-jovem", name: "Central, até 16 anos", price: 4, description: "Com documento de identificação na entrada.", bancadaId: "central" },
    { id: "poente", name: "Poente", price: 5, description: "Lugar não marcado.", bancadaId: "poente" },
    { id: "poente-jovem", name: "Poente, até 16 anos", price: 2, description: "Com documento de identificação na entrada.", bancadaId: "poente" },
    { id: "norte", name: "Topo Norte", price: 5, description: "A bancada da claque. De pé.", bancadaId: "topo-norte" },
    { id: "visitantes", name: "Visitantes", price: 6, description: "Entrada pelo portão sul.", bancadaId: "visitantes" },
  ],
  note: "Sócios com quota em dia entram sem bilhete, com o cartão na app.",
};

const JOGOS: Jogo[] = [
  // Passados
  {
    id: "j1",
    teamId: "seniores",
    teamName: "Seniores",
    startsAt: dia(-21, "16:00"),
    venue: "Estádio do Monte",
    opponent: "GD Taipas",
    isHome: true,
    competition: "Campeonato de Portugal",
    roundLabel: "Jornada 3",
    status: "PLAYED",
    ourScore: 2,
    theirScore: 1,
  },
  {
    id: "j2",
    teamId: "seniores",
    teamName: "Seniores",
    startsAt: dia(-14, "15:00"),
    venue: "Estádio Municipal de Fafe",
    opponent: "AD Fafe",
    isHome: false,
    competition: "Campeonato de Portugal",
    roundLabel: "Jornada 4",
    status: "PLAYED",
    ourScore: 1,
    theirScore: 1,
  },
  {
    id: "j3",
    teamId: "sub19",
    teamName: "Sub-19",
    startsAt: dia(-8, "11:00"),
    venue: "Campo 2",
    opponent: "Vitória SC",
    isHome: true,
    competition: "Juniores A",
    roundLabel: "Jornada 5",
    status: "PLAYED",
    ourScore: 0,
    theirScore: 3,
  },
  {
    id: "j4",
    teamId: "seniores",
    teamName: "Seniores",
    startsAt: dia(-7, "16:00"),
    venue: "Estádio do Monte",
    opponent: "Merelinense FC",
    isHome: true,
    competition: "Campeonato de Portugal",
    roundLabel: "Jornada 5",
    status: "PLAYED",
    ourScore: 3,
    theirScore: 0,
  },
  {
    id: "j5",
    teamId: "futsal-fem",
    teamName: "Futsal feminino",
    startsAt: dia(-3, "20:30"),
    venue: "Pavilhão Dr. Azevedo",
    opponent: "CS Marítimo",
    isHome: true,
    competition: "Campeonato Distrital",
    roundLabel: "Jornada 2",
    status: "PLAYED",
    ourScore: 4,
    theirScore: 2,
  },
  // Futuros
  {
    id: "j6",
    teamId: "seniores",
    teamName: "Seniores",
    startsAt: dia(2, "16:00"),
    venue: "Estádio do Monte",
    opponent: "SC Vianense",
    isHome: true,
    competition: "Campeonato de Portugal",
    roundLabel: "Jornada 6",
    status: "SCHEDULED",
    tickets: BILHETES_CASA,
  },
  {
    id: "j7",
    teamId: "sub15",
    teamName: "Sub-15",
    startsAt: dia(3, "10:30"),
    venue: "Campo 2",
    opponent: "FC Famalicão",
    isHome: true,
    competition: "Iniciados",
    roundLabel: "Jornada 6",
    status: "SCHEDULED",
  },
  {
    id: "j8",
    teamId: "basquete-sub14",
    teamName: "Basquetebol Sub-14",
    startsAt: dia(4, "15:00"),
    venue: "Pavilhão de Caldas das Taipas",
    opponent: "CD Taipas",
    isHome: false,
    competition: "ABM",
    roundLabel: "Jornada 3",
    status: "SCHEDULED",
  },
  {
    id: "j9",
    teamId: "seniores",
    teamName: "Seniores",
    startsAt: dia(9, "15:00"),
    venue: "Estádio do Sport Clube de Braga B",
    opponent: "SC Braga B",
    isHome: false,
    competition: "Campeonato de Portugal",
    roundLabel: "Jornada 7",
    status: "SCHEDULED",
  },
  {
    id: "j10",
    teamId: "seniores",
    teamName: "Seniores",
    startsAt: dia(16, "15:00"),
    venue: "Estádio do Monte",
    opponent: "Vitória SC B",
    isHome: true,
    competition: "Campeonato de Portugal",
    roundLabel: "Jornada 8",
    status: "SCHEDULED",
    tickets: { ...BILHETES_CASA, note: "Dérbi: lotação limitada, sócios devem reservar na app até 48 h antes." },
  },
  {
    id: "j11",
    teamId: "futsal-fem",
    teamName: "Futsal feminino",
    startsAt: dia(10, "21:00"),
    venue: "Pavilhão Dr. Azevedo",
    opponent: "AD Bairro",
    isHome: true,
    competition: "Campeonato Distrital",
    roundLabel: "Jornada 3",
    status: "SCHEDULED",
  },
];

const EVENTOS: Evento[] = [
  {
    id: "e1",
    title: "Assembleia Geral de sócios",
    startsAt: dia(12, "21:00"),
    venue: "Sede do clube",
    description: "Apresentação e votação das contas da época 2025/26 e do orçamento para 2026/27.",
  },
  {
    id: "e2",
    title: "Jantar de Natal do clube",
    startsAt: dia(45, "20:00"),
    venue: "Restaurante O Monte",
    description: "Inscrições abertas na secretaria até 10 de dezembro. 25 € por pessoa, crianças até 10 anos não pagam.",
  },
];

const NOTICIAS: Noticia[] = [
  {
    id: "n1",
    slug: "vitoria-por-3-0-frente-ao-merelinense",
    title: "Vitória por 3-0 frente ao Merelinense deixa o Monte Verde no segundo lugar",
    summary:
      "Dois golos de Leandro Silva e um de Nuno Barbosa numa tarde em que o Estádio do Monte esteve cheio. A equipa não perde há quatro jornadas.",
    body: [
      "O Estádio do Monte voltou a encher este domingo para receber o Merelinense, e a equipa respondeu com a exibição mais completa da época. Leandro Silva abriu o marcador aos 12 minutos, de cabeça, e voltou a marcar logo a seguir ao intervalo. Nuno Barbosa fechou a contagem aos 78, num remate de fora da área que ainda tocou no poste antes de entrar.",
      "O treinador Miguel Antunes destacou no final a atitude da equipa sem bola: \"Fomos agressivos na pressão desde o primeiro minuto e isso tirou-lhes o jogo. Era o que tínhamos pedido durante a semana.\"",
      "Com este resultado a AD Monte Verde sobe ao segundo lugar da Série A, a dois pontos do líder. O próximo jogo é já no sábado, em casa, frente ao Vianense. Os bilhetes estão à venda na bilheteira digital e os sócios entram com o cartão da app.",
    ],
    category: "Seniores",
    image: foto("noticia1", 1600, 1000),
    publishedAt: dia(-6, "20:15"),
    featured: true,
  },
  {
    id: "n2",
    slug: "bilhetes-para-o-derbi-com-o-vitoria-b",
    title: "Bilhetes para o dérbi com o Vitória B à venda a partir de segunda-feira",
    summary:
      "Lotação limitada a 1 200 lugares. Os sócios têm prioridade até quarta-feira e reservam diretamente na app do clube.",
    body: [
      "O jogo com o Vitória SC B, da jornada 8 do Campeonato de Portugal, tem os bilhetes à venda a partir de segunda-feira às 10h00. Pela primeira vez, a venda faz-se inteiramente online, na bilheteira digital do site, com pagamento por MB WAY, Multibanco ou cartão. O bilhete chega por email com um código QR e é lido à entrada.",
      "Os sócios com quota em dia continuam a entrar sem bilhete, mas neste jogo têm de reservar lugar na app até 48 horas antes, por causa da lotação. A reserva é gratuita.",
      "Preços: bancada geral 5 €, bancada central 8 €, até 16 anos 2 €.",
    ],
    category: "Clube",
    image: foto("noticia2", 1600, 1000),
    publishedAt: dia(-4, "11:00"),
    featured: true,
  },
  {
    id: "n3",
    slug: "futsal-feminino-vence-maritimo",
    title: "Futsal feminino vence o Marítimo e soma a segunda vitória seguida",
    summary: "4-2 no Pavilhão Dr. Azevedo, com dois golos de Beatriz Costa. A equipa lidera o grupo com seis pontos.",
    body: [
      "A equipa de futsal feminino continua sem perder esta época. Frente ao Marítimo, no pavilhão Dr. Azevedo, esteve a perder por 0-1 ao intervalo e deu a volta na segunda parte com quatro golos em doze minutos.",
      "Beatriz Costa, com dois golos, foi a figura do jogo. O próximo jogo é em casa, frente ao AD Bairro, na próxima semana.",
    ],
    category: "Futsal",
    image: foto("noticia3", 1600, 1000),
    publishedAt: dia(-3, "23:10"),
    featured: true,
  },
  {
    id: "n4",
    slug: "nova-epoca-da-escola-de-futebol",
    title: "Escola de futebol abre inscrições para a nova época com 40 vagas",
    summary: "Dos 5 aos 9 anos, treinos à terça e quinta no Campo 2. As inscrições fazem-se online e as famílias recebem tudo na app do clube.",
    body: [
      "A escola de futebol da AD Monte Verde abre 40 vagas para a época 2026/27. Os treinos são à terça e à quinta-feira, das 18h00 às 19h00, no Campo 2, e começam na primeira semana de setembro.",
      "A inscrição faz-se online. Depois de aceite, a família instala a app do clube e passa a receber os treinos, as convocatórias e as mensalidades no telemóvel.",
    ],
    category: "Formação",
    image: foto("noticia4", 1600, 1000),
    publishedAt: dia(-9, "09:30"),
  },
  {
    id: "n5",
    slug: "sub-19-perdem-com-o-vitoria",
    title: "Sub-19 perdem com o Vitória em jogo de muitas oportunidades",
    summary: "Derrota por 0-3 em casa, num jogo em que a equipa teve duas bolas no poste antes do primeiro golo vitoriano.",
    body: [
      "Os Sub-19 perderam com o Vitória SC por 0-3, no Campo 2, num resultado que não espelha o equilíbrio da primeira parte. A equipa teve duas bolas no poste antes de sofrer o primeiro golo, já perto do intervalo.",
      "O treinador Vasco Moreira preferiu olhar para o que correu bem: \"Jogámos de igual para igual contra uma equipa de outro campeonato durante 40 minutos. Isso fica.\"",
    ],
    category: "Formação",
    image: foto("noticia5", 1600, 1000),
    publishedAt: dia(-8, "14:00"),
  },
  {
    id: "n6",
    slug: "nova-camisola-2026-27",
    title: "A camisola 2026/27 já está na loja",
    summary: "Verde e azul como sempre, com a bancada central desenhada no padrão. Os sócios têm 15 % de desconto.",
    body: [
      "A nova camisola principal mantém o verde e o azul do clube e traz um padrão subtil inspirado na bancada central do Estádio do Monte, a que os sócios construíram em 1963.",
      "Está disponível na loja online em tamanhos de criança e adulto, a 39,90 €. Os sócios com quota em dia têm 15 % de desconto, aplicado automaticamente com o código do cartão.",
    ],
    category: "Loja",
    image: foto("noticia6", 1600, 1000),
    publishedAt: dia(-12, "10:00"),
  },
  {
    id: "n7",
    slug: "assembleia-geral-de-socios",
    title: "Assembleia Geral de sócios marcada para dia 21",
    summary: "Na sede, às 21h00. Em discussão as contas da época passada e o orçamento para a próxima.",
    body: [
      "A direção convoca todos os sócios para a Assembleia Geral ordinária, na sede do clube, às 21h00. A ordem de trabalhos inclui a apresentação e votação das contas da época 2025/26 e do orçamento para 2026/27.",
      "Podem votar os sócios com as quotas em dia. A quota pode ser regularizada na app do clube até ao próprio dia.",
    ],
    category: "Clube",
    image: foto("noticia7", 1600, 1000),
    publishedAt: dia(-15, "18:00"),
  },
  {
    id: "n8",
    slug: "empate-em-fafe",
    title: "Empate em Fafe num jogo de poucas ocasiões",
    summary: "1-1 no Estádio Municipal, com golo de Fábio Marques. Ponto importante fora de casa.",
    body: [
      "A AD Monte Verde empatou a uma bola em Fafe, num jogo fechado e com poucas oportunidades. Fábio Marques marcou aos 61 minutos, e o Fafe empatou de penálti dez minutos depois.",
      "A equipa regressa a casa na próxima jornada.",
    ],
    category: "Seniores",
    image: foto("noticia8", 1600, 1000),
    publishedAt: dia(-14, "19:00"),
  },
];

export const DEMO = { clube: CLUBE, equipas: EQUIPAS, jogos: JOGOS, eventos: EVENTOS, noticias: NOTICIAS };

export const PRODUTOS: Produto[] = [
  {
    id: "p1",
    slug: "camisola-principal-2026-27",
    name: "Camisola principal 2026/27",
    price: 39.9,
    image: foto("camisola", 900, 1100),
    category: "Equipamento",
    description:
      "A camisola de jogo desta época. Verde e azul do clube, padrão da bancada central, tecido respirável. Corte regular.",
    variants: { name: "Tamanho", options: ["6 anos", "8 anos", "10 anos", "12 anos", "XS", "S", "M", "L", "XL", "XXL"] },
  },
  {
    id: "p2",
    slug: "camisola-alternativa-2026-27",
    name: "Camisola alternativa 2026/27",
    price: 39.9,
    image: foto("alternativa", 900, 1100),
    category: "Equipamento",
    description: "Branca, com os detalhes em verde. A que a equipa usa fora de casa.",
    variants: { name: "Tamanho", options: ["XS", "S", "M", "L", "XL", "XXL"] },
  },
  {
    id: "p3",
    slug: "cachecol-monte-verde",
    name: "Cachecol",
    price: 12,
    image: foto("cachecol", 900, 1100),
    category: "Adeptos",
    description: "Cachecol de lã em verde e azul, com o emblema bordado nas duas pontas.",
  },
  {
    id: "p4",
    slug: "sweat-com-capuz",
    name: "Sweat com capuz",
    price: 34.9,
    image: foto("sweat", 900, 1100),
    category: "Roupa",
    description: "Sweat de algodão grosso, verde escuro, com o emblema ao peito e o nome do clube nas costas.",
    variants: { name: "Tamanho", options: ["S", "M", "L", "XL", "XXL"] },
  },
  {
    id: "p5",
    slug: "bone",
    name: "Boné",
    price: 15,
    image: foto("bone", 900, 1100),
    category: "Adeptos",
    description: "Boné de pala curva, ajustável, com o emblema bordado.",
  },
  {
    id: "p6",
    slug: "casaco-de-treino",
    name: "Casaco de treino",
    price: 44.9,
    image: foto("casaco", 900, 1100),
    category: "Roupa",
    description: "O casaco que a equipa técnica usa no banco. Corta-vento, forrado, com fecho até ao queixo.",
    variants: { name: "Tamanho", options: ["S", "M", "L", "XL"] },
  },
  {
    id: "p7",
    slug: "garrafa",
    name: "Garrafa 750 ml",
    price: 9,
    image: foto("garrafa", 900, 1100),
    category: "Adeptos",
    description: "Garrafa de alumínio com o emblema. Vai para o treino e para a escola.",
  },
  {
    id: "p8",
    slug: "calcoes-de-jogo",
    name: "Calções de jogo",
    price: 19.9,
    image: foto("calcoes", 900, 1100),
    category: "Equipamento",
    description: "Os calções do equipamento principal.",
    variants: { name: "Tamanho", options: ["6 anos", "8 anos", "10 anos", "12 anos", "S", "M", "L", "XL"] },
    soldOut: true,
  },
];

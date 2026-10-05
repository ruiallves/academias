/**
 * Os emails que saem daqui.
 *
 * ## Porque é que isto não se parece com o resto do produto
 *
 * Porque um cliente de email não é um browser. O Outlook ainda hoje desenha com o
 * motor do Word: não há flexbox, não há grid, e uma folha de estilos externa é
 * ignorada ou removida. Por isso — tabelas, estilos colados a cada elemento, e
 * largura fixa. Escrever isto com as ferramentas da consola dava um email partido
 * em metade das caixas de correio.
 *
 * ## O que todos têm em comum
 *
 * A cor e o nome do clube em cima (é o clube que convida, não nós), um botão
 * grande, e **o link outra vez em texto** por baixo. O botão falha mais vezes do
 * que se pensa — clientes que não desenham o fundo colorido, quem lê em modo
 * texto — e um convite que não se consegue abrir é um convite perdido.
 *
 * ## Nota técnica
 *
 * Isto vive dentro de templates literais: **nenhuma crase pode aparecer no HTML
 * abaixo**, pela mesma razão que na pagina de socios.
 */

import { periodoMinimoPorExtenso } from "../subscription/condicoes";
import { periodoPorExtenso } from "../subscription/cobranca";

export type MailBrand = {
  /** O nome curto, para o cabeçalho e para o assunto. */
  shortName: string;
  /** O nome por extenso, para a linha que explica o que é isto. */
  name: string;
  /** A cor do clube. Cai para o verde da plataforma quando o clube não escolheu. */
  signalColor?: string | null;
  /**
   * O emblema, quando o clube já o carregou.
   *
   * Fica sempre **atrás** das iniciais, nunca em vez delas: metade dos clientes
   * de email não carrega imagens remotas sem a pessoa pedir, e um cabeçalho que
   * dependesse da imagem chegaria vazio. Com o `alt` nas iniciais, quem bloqueia
   * imagens vê exactamente o que via antes.
   */
  logoUrl?: string | null;
};

const FALLBACK = "#0f6b62";

/** Só letras e dígitos do que veio da base de dados entram numa folha de estilos. */
function safeColor(value: string | null | undefined): string {
  return value && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : FALLBACK;
}

/**
 * Preto ou branco por cima da cor do clube.
 *
 * ## Porque é que isto não podia ficar em branco fixo
 *
 * Porque num produto white-label a cor é do clube, e há clubes de amarelo. O
 * Life Club, com que isto se testou, tem `#fff700`: texto branco por cima ficava
 * literalmente invisível, e o email chegava com o nome do clube e o botão em
 * branco sobre amarelo. Num email não há como corrigir depois de enviado.
 *
 * ## Porque é que não basta "claro ou escuro"
 *
 * Um limiar de luminância a meio resolve os extremos e falha no meio. O dourado
 * `#d4af37` fica logo abaixo da linha, escolheria branco, e dava 2,1:1 — pior do
 * que o amarelo que se queria corrigir. Por isso não se pergunta se a cor é
 * clara: calcula-se o contraste contra preto e contra branco, e fica o melhor
 * dos dois.
 *
 * Com isso, as cores de clube que se vêem na prática ficam todas acima de 4,5:1
 * (o mínimo da WCAG para texto normal) — o amarelo dá 15,3:1, o dourado 8,3:1, o
 * laranja 4,8:1. O pior caso possível é o cinzento a meio, `#808080`, com 4,4:1:
 * está à mesma distância do preto e do branco e não há tinta que faça melhor.
 * Fica dito para não se andar à procura — não é um descuido, é o limite.
 */
function inkOn(hex: string): { fg: string; veil: string } {
  const escuro = contrast(hex, "#1c1a18");
  const claro = contrast(hex, "#ffffff");
  return escuro >= claro
    ? { fg: "#1c1a18", veil: "rgba(0,0,0,0.12)" }
    : { fg: "#ffffff", veil: "rgba(255,255,255,0.22)" };
}

/**
 * A cor do clube, quando serve de tinta sobre branco.
 *
 * O mesmo problema do outro lado: um amarelo que resulta como fundo é ilegível
 * como texto no branco do corpo. Abaixo de 4,5:1 troca-se pelo cinzento-tinta —
 * o link continua sublinhado, por isso não deixa de se ver que é um link.
 */
function onWhite(hex: string): string {
  return contrast(hex, "#ffffff") >= 4.5 ? hex : "#3c3a37";
}

/** A razão de contraste da WCAG entre duas cores. 1:1 é igual, 21:1 é preto no branco. */
function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function luminance(hex: string): number {
  const v = hex.replace("#", "");
  const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** As iniciais, quando não há logótipo. As mesmas que a consola desenha. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

type Layout = {
  brand: MailBrand;
  /** "Olá Rui," — a linha por cima do título. Omitir quando não se sabe o nome. */
  greeting?: string;
  /** A primeira linha a seguir ao cabeçalho, em grande. */
  heading: string;
  /** Os parágrafos do corpo, já em texto simples. */
  paragraphs: string[];
  /**
   * Blocos de HTML por baixo dos parágrafos, escritos tal e qual.
   *
   * Existe porque `paragraphs` embrulha cada linha num `<p>`, e há corpos que
   * não são prosa: uma tabela de campos, um bloco com a mensagem que alguém
   * escreveu. Uma `<table>` dentro de um `<p>` é HTML inválido, e o Outlook —
   * que é metade do correio de trabalho em Portugal — desenha-a como lhe apetece.
   *
   * Quem escreve aqui é responsável por escapar o que vem de fora (`esc`). É a
   * mesma responsabilidade que `paragraphs` já tem, dita em voz alta.
   */
  blocks?: string[];
  /**
   * O botão. **Opcional**: nem todo o email pede uma acção.
   *
   * O recibo da adesão a sócio (`memberSignupReceivedEmail`) é o primeiro sem
   * ele — diz "recebemos o teu pedido" e mais nada, porque o link só existe
   * depois de o clube aprovar. Um botão inventado ali levaria a pessoa a uma
   * conta que ainda não pode ter.
   */
  cta?: { label: string; url: string };
  /** O rodapé por baixo do link — validade, avisos. */
  notes: string[];
};

/**
 * O molde de todos eles.
 *
 * Uma função só, porque três emails com três moldes divergem ao terceiro retoque
 * e passam a parecer de produtos diferentes.
 */
function layout({ brand, greeting, heading, paragraphs, blocks, cta, notes }: Layout): string {
  const color = safeColor(brand.signalColor);
  // O texto por cima da cor do clube — preto num clube de amarelo, branco num de azul.
  const ink = inkOn(color);
  const mark = esc(initials(brand.shortName));

  /*
   * O emblema por cima das iniciais, e não em vez delas.
   *
   * A imagem vive dentro da mesma célula redonda: quando carrega, tapa as
   * iniciais; quando o cliente de email bloqueia imagens remotas — o que é o
   * comportamento por omissão em boa parte deles — fica o `alt`, que são as
   * iniciais, e o cabeçalho continua a ler-se igual ao de sempre.
   *
   * `width`/`height` em atributos e não só em CSS porque o Outlook ignora o
   * estilo e desenharia a imagem no tamanho original.
   */
  const emblema = brand.logoUrl
    ? '<img src="' + esc(brand.logoUrl) + '" alt="' + mark + '" width="34" height="34" ' +
      'style="display:block;width:34px;height:34px;border:0;border-radius:50%;object-fit:contain;' +
      'background:' + ink.veil + ';font-family:Helvetica,Arial,sans-serif;font-size:12px;' +
      'font-weight:700;color:' + ink.fg + ';text-align:center;line-height:34px;" />'
    : mark;

  const ola = greeting
    ? '<p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#6b6862;">' + esc(greeting) + "</p>"
    : "";
  const corpo =
    paragraphs
      .map(
        (p) =>
          '<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3c3a37;">' + p + "</p>",
      )
      .join("") +
    (blocks ?? []).map((b) => '<div style="margin:0 0 14px;">' + b + "</div>").join("");
  const rodape = notes
    .map(
      (n) =>
        '<p style="margin:0 0 6px;font-size:12.5px;line-height:1.5;color:#8a8681;">' + n + "</p>",
    )
    .join("");

  return `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${esc(brand.shortName)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f2ef;">
<!-- O texto que o telemovel mostra ao lado do assunto, antes de abrir. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(heading)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f2ef;">
<tr><td align="center" style="padding:32px 16px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;
              box-shadow:0 1px 3px rgba(0,0,0,0.06);">

  <tr>
    <td style="background:${color};padding:20px 28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="width:34px;height:34px;background:${ink.veil};border-radius:50%;
                     text-align:center;vertical-align:middle;font-family:Helvetica,Arial,sans-serif;
                     font-size:12px;font-weight:700;color:${ink.fg};">${emblema}</td>
          <td style="padding-left:11px;font-family:Helvetica,Arial,sans-serif;font-size:15px;
                     font-weight:600;color:${ink.fg};letter-spacing:0.01em;">${esc(brand.shortName)}</td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:30px 28px 26px;font-family:Helvetica,Arial,sans-serif;">
      ${ola}
      <h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;font-weight:600;color:#1c1a18;">
        ${esc(heading)}
      </h1>
      ${corpo}

      ${
        /* Sem botão, sem bloco: um email que não pede acção nenhuma — o
           recibo da adesão a sócio — não deve ter um espaço vazio nem um
           "copia este endereço" a apontar para endereço nenhum. */
        cta
          ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 18px;">
        <tr>
          <td style="background:${color};border-radius:7px;">
            <a href="${esc(cta.url)}"
               style="display:inline-block;padding:13px 26px;font-family:Helvetica,Arial,sans-serif;
                      font-size:15px;font-weight:600;color:${ink.fg};text-decoration:none;">
              ${esc(cta.label)}
            </a>
          </td>
        </tr>
      </table>

      <!-- O link outra vez, para quem o botao nao alcanca. -->
      <p style="margin:0 0 4px;font-size:12.5px;color:#8a8681;">Se o botão não funcionar, copia este endereço:</p>
      <p style="margin:0 0 22px;font-size:12.5px;line-height:1.5;word-break:break-all;">
        <a href="${esc(cta.url)}" style="color:${onWhite(color)};text-decoration:underline;">${esc(cta.url)}</a>
      </p>`
          : ""
      }

      <div style="border-top:1px solid #eae7e3;padding-top:16px;">${rodape}</div>
    </td>
  </tr>

</table>

<p style="margin:18px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#a8a49f;">
  ${esc(brand.name)} · enviado pela plataforma Academias
</p>

</td></tr>
</table>
</body>
</html>`;
}

/** A versão em texto, montada das mesmas peças. */
function plain(
  heading: string,
  paragraphs: string[],
  cta: { label: string; url: string } | undefined,
  notes: string[],
): string {
  return [heading, "", ...paragraphs, "", ...(cta ? [cta.label + ":", cta.url, ""] : []), ...notes].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Convite de staff — alguém que vai gerir a academia                          */
/* -------------------------------------------------------------------------- */

export function staffInviteEmail(input: {
  brand: MailBrand;
  name: string;
  title: string;
  link: string;
  expiresAt: Date;
}): { subject: string; html: string; text: string } {
  const primeiro = input.name.trim().split(/\s+/)[0] || input.name;

  const heading = "Convite para " + input.title;
  const paragraphs = [
    // O nome do clube como sujeito, sem artigo à frente. "O Academia Life Club"
    // não concorda, "a Sporting" também não — e o nome vem da base de dados, por
    // isso não há artigo que sirva a todos. Sem artigo serve sempre.
    esc(input.brand.name) + " convidou-te para <strong>" + esc(input.title) + "</strong>.",
    "Ao abrir o convite escolhes a tua palavra-passe e ficas com acesso à consola do clube.",
  ];
  const notes = [
    "Este convite é válido até " + dia(input.expiresAt) + ".",
    "Só funciona para o endereço a que foi enviado.",
    "Se não estavas à espera disto, ignora este email — sem abrir o link, nada acontece.",
  ];

  return {
    subject: input.brand.shortName + " · convite para " + input.title,
    html: layout({
      brand: input.brand,
      greeting: "Olá " + primeiro + ",",
      heading,
      paragraphs,
      cta: { label: "Aceitar o convite", url: input.link },
      notes,
    }),
    text: plain(
      "Olá " + primeiro + ",",
      [
        input.brand.name + " convidou-te para " + input.title + ".",
        "Ao abrir o convite escolhes a tua palavra-passe e ficas com acesso à consola do clube.",
      ],
      { label: "Aceitar o convite", url: input.link },
      notes.map(semTags),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Convite de família — a app dos pais                                         */
/* -------------------------------------------------------------------------- */

export function familyInviteEmail(input: {
  brand: MailBrand;
  /** O nome de quem recebe, quando a secretaria o soube dizer. */
  name?: string | null;
  link: string;
  expiresAt: Date | null;
}): { subject: string; html: string; text: string } {
  // Sem o nome do clube no título: ele está já na barra colorida por cima, e
  // "a app do/da {nome}" obrigava a acertar o artigo com um nome que não conhecemos.
  const heading = "A app para as famílias";
  const paragraphs = [
    esc(input.brand.name) + " tem uma app onde podes ver os treinos e os jogos do teu educando, as convocatórias, as mensalidades e os avisos do clube.",
    "Para entrares vais precisar do <strong>número de contribuinte</strong> e da <strong>data de nascimento</strong> do teu educando — é assim que o clube confirma que és tu.",
  ];
  const notes = [
    input.expiresAt ? "Este link é válido até " + dia(input.expiresAt) + "." : "Este link não tem prazo.",
    "Podes partilhá-lo com o outro encarregado de educação.",
  ];

  return {
    subject: input.brand.shortName + " · a app para as famílias",
    html: layout({ brand: input.brand, heading, paragraphs, cta: { label: "Abrir a app", url: input.link }, notes }),
    text: plain(
      input.name ? "Olá " + input.name.trim().split(/\s+/)[0] + "," : "Olá,",
      [
        input.brand.name + " tem uma app onde podes ver os treinos e os jogos do teu educando, as convocatórias, as mensalidades e os avisos do clube.",
        "Para entrares vais precisar do número de contribuinte e da data de nascimento do teu educando — é assim que o clube confirma que és tu.",
      ],
      { label: "Abrir a app", url: input.link },
      notes.map(semTags),
    ),
  };
}

/**
 * O clube aprovou o acesso de uma família à app.
 *
 * Sai quando a secretaria carrega em "Aprovar" na página Famílias. O pai
 * registou-se, viu o ecrã "à espera do clube" e fechou a app; é este email que
 * o faz voltar.
 */
export function familyApprovedEmail(input: {
  brand: MailBrand;
  name: string;
  /** Os educandos a que a conta ficou ligada. */
  children: string[];
  link: string;
}): { subject: string; html: string; text: string } {
  const heading = "O teu acesso foi aprovado";
  const filhos = input.children.map((c) => c.trim().split(/\s+/)[0]);
  const deQuem =
    filhos.length === 0
      ? "do teu educando"
      : filhos.length === 1
        ? "de " + filhos[0]
        : "de " + filhos.slice(0, -1).join(", ") + " e " + filhos[filhos.length - 1];
  const paragraphs = [
    esc(input.brand.name) + " aprovou o teu pedido. Já podes entrar na app e acompanhar os treinos, os jogos, as convocatórias e os avisos " + esc(deQuem) + ".",
    "Entra com o email e a palavra-passe que escolheste no registo.",
  ];
  const notes = ["Se não pediste acesso à app deste clube, responde a este email para o avisar."];

  return {
    subject: input.brand.shortName + " · o teu acesso à app foi aprovado",
    html: layout({ brand: input.brand, heading, paragraphs, cta: { label: "Abrir a app", url: input.link }, notes }),
    text: plain(
      "Olá " + input.name.trim().split(/\s+/)[0] + ",",
      [
        input.brand.name + " aprovou o teu pedido. Já podes entrar na app e acompanhar os treinos, os jogos, as convocatórias e os avisos " + deQuem + ".",
        "Entra com o email e a palavra-passe que escolheste no registo.",
      ],
      { label: "Abrir a app", url: input.link },
      notes,
    ),
  };
}

/**
 * O convite de um sócio para a app do clube.
 *
 * Sai quando a direcção inscreve o sócio à mão e quando aprova uma adesão do
 * site — foi assim que foi pedido: o sócio recebe logo o caminho para escolher
 * a password e instalar a app. O link reclama a ficha **dele**: a conta nasce
 * com o email que o clube tem na ficha, e com mais nenhum.
 */
export function memberInviteEmail(input: {
  brand: MailBrand;
  name: string;
  link: string;
}): { subject: string; html: string; text: string } {
  const heading = "A tua área de sócio";
  const paragraphs = [
    "És sócio de <strong>" + esc(input.brand.name) + "</strong> — e o clube tem uma app onde podes ver o teu cartão, as quotas, os jogos e as novidades.",
    "Abre o link, escolhe a tua palavra-passe e instala a app. Fica tudo pronto em menos de um minuto.",
  ];
  const notes = [
    "Este convite é só teu — a conta fica ligada ao email para onde ele foi enviado.",
    "Se não pediste isto, podes ignorar este email.",
  ];

  return {
    subject: input.brand.shortName + " · a tua área de sócio",
    html: layout({ brand: input.brand, heading, paragraphs, cta: { label: "Criar a minha conta", url: input.link }, notes }),
    text: plain(
      "Olá " + input.name.trim().split(/\s+/)[0] + ",",
      [
        "És sócio de " + input.brand.name + " — e o clube tem uma app onde podes ver o teu cartão, as quotas, os jogos e as novidades.",
        "Abre o link, escolhe a tua palavra-passe e instala a app.",
      ],
      { label: "Criar a minha conta", url: input.link },
      notes.map(semTags),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Convite de atleta — a ficha ganha uma conta na app                          */
/* -------------------------------------------------------------------------- */

/**
 * O convite que sai para o email do próprio atleta.
 *
 * A mesma forma do de sócio — é o mesmo gesto do outro lado: abrir o link,
 * escolher a palavra-passe, instalar. Diz o que a área lhe dá (treinos, jogos,
 * convocatórias, avaliações, o que o treinador partilhar) para o email não
 * parecer um convite genérico, e diz que é pessoal, porque é: a conta fica
 * ligada ao endereço para onde isto foi.
 */
export function athleteInviteEmail(input: {
  brand: MailBrand;
  name: string;
  link: string;
}): { subject: string; html: string; text: string } {
  const primeiro = input.name.trim().split(/\s+/)[0] || input.name;
  const heading = "A tua área de atleta";
  const paragraphs = [
    "És atleta de <strong>" + esc(input.brand.name) + "</strong> — e o clube tem uma app onde vês os teus treinos e jogos, as convocatórias, as avaliações do treinador e os planos que ele partilhar contigo.",
    "Abre o link, escolhe a tua palavra-passe e instala a app. Fica pronto em menos de um minuto.",
  ];
  const notes = [
    "Este convite é só teu — a conta fica ligada ao email para onde ele foi enviado.",
    "Se não pediste isto, podes ignorar este email.",
  ];

  return {
    subject: input.brand.shortName + " · a tua área de atleta",
    html: layout({
      brand: input.brand,
      greeting: "Olá " + esc(primeiro) + ",",
      heading,
      paragraphs,
      cta: { label: "Criar a minha conta", url: input.link },
      notes,
    }),
    text: plain(
      "Olá " + primeiro + ",",
      [
        "És atleta de " + input.brand.name + " — e o clube tem uma app onde vês os teus treinos e jogos, as convocatórias, as avaliações do treinador e os planos que ele partilhar contigo.",
        "Abre o link, escolhe a tua palavra-passe e instala a app.",
      ],
      { label: "Criar a minha conta", url: input.link },
      notes.map(semTags),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Adesão a sócio — o recibo de quem se inscreveu pelo site                    */
/* -------------------------------------------------------------------------- */

/**
 * "Recebemos o teu pedido" — e mais nada.
 *
 * ## Porque é que este email existe
 *
 * Quem preenche o formulário de adesão no site fica sem saber se aquilo chegou
 * a algum lado. A inscrição fica `PENDING` à espera de aprovação — que pode
 * demorar dias, porque do outro lado está uma direcção de clube a tratar disto
 * ao serão — e o silêncio nesse intervalo é o que faz as pessoas voltarem a
 * submeter o formulário, ou telefonar para a secretaria a perguntar.
 *
 * ## O que ele NÃO diz
 *
 * Não promete aprovação, não diz prazo, e **não traz link nenhum**. É um
 * recibo: dá o nome do clube, diz que o pedido está a ser analisado, e avisa
 * que virá outro email quando houver decisão. O convite da app — esse sim com
 * link — é o `memberInviteEmail`, e só sai depois de o clube aprovar.
 *
 * Um recibo que prometesse "vais ser aceite" faria o clube desdizê-lo, e um
 * clube não deve deixar de poder recusar uma adesão por causa do nosso email.
 */
/**
 * Uma área nova abriu numa conta que já existia — e por isso não houve convite.
 *
 * ## Porque é que este email existe
 *
 * Porque o silêncio era o preço de uma coisa boa. Quem já tem conta no clube não
 * recebe convite quando lhe abrem outro perfil: a ficha cola-se à conta e a área
 * aparece. Do lado de quem lá está, isso queria dizer **nada** — nenhum aviso, e
 * a área a aparecer um dia em que a pessoa por acaso abrisse a app. O treinador
 * que passou a sócio sabia que tinha pago a quota e não sabia que a podia pagar
 * ali.
 *
 * Por isso este email não é um convite e não leva token nenhum: leva a notícia e
 * o caminho. Entra-se com a conta que já se tem, e é exactamente isso que o texto
 * diz — era o engano do convite (pedia para "escolher" uma palavra-passe a quem
 * já tinha uma).
 *
 * Só sai quando **o clube** abre a área. Quando é a própria pessoa a fazer a
 * ligação acontecer, abrindo a app, não sai: escrever a alguem que está a olhar
 * para o ecrã a dizer-lhe o que tem no ecrã não é um aviso, é ruído.
 */
export function areaAbertaEmail(input: {
  brand: MailBrand;
  name: string;
  area: "member" | "athlete" | "family";
  link: string;
}): { subject: string; html: string; text: string } {
  const A = {
    member: {
      nome: "área de sócio",
      o_que: "ver o teu cartão de sócio, as tuas quotas e pagá-las pelo telemóvel",
    },
    athlete: {
      nome: "área de atleta",
      o_que: "ver os teus treinos, os teus jogos, as convocatórias e o que o treinador partilhar contigo",
    },
    family: {
      nome: "área de família",
      o_que: "acompanhar os treinos, os jogos, as convocatórias e os avisos dos teus educandos",
    },
  }[input.area];

  const heading = "Tens uma área nova na app";
  const paragraphs = [
    esc(input.brand.name) + " abriu-te a <strong>" + esc(A.nome) + "</strong> na app do clube. Já podes " + esc(A.o_que) + ".",
    /* A frase que o convite nunca conseguiu dizer: não há conta para criar. */
    "Não precisas de criar conta nem de escolher palavra-passe nenhuma — entra com a conta que já tens neste clube e a área está lá.",
  ];
  const notes = ["Se achas que isto é um engano, responde a este email para o clube o corrigir."];

  return {
    subject: input.brand.shortName + " · já tens a " + A.nome + " na app",
    html: layout({ brand: input.brand, heading, paragraphs, cta: { label: "Abrir a app", url: input.link }, notes }),
    text: plain(
      "Olá " + input.name.trim().split(/\s+/)[0] + ",",
      [
        input.brand.name + " abriu-te a " + A.nome + " na app do clube. Já podes " + A.o_que + ".",
        "Não precisas de criar conta nem de escolher palavra-passe nenhuma — entra com a conta que já tens neste clube e a área está lá.",
      ],
      { label: "Abrir a app", url: input.link },
      notes,
    ),
  };
}

/**
 * As novidades de uma versão, como uma lista.
 *
 * Uma linha, uma novidade. O travessão à cabeça tira-se se lá estiver, porque é
 * assim que se escreve um `release.txt` e ninguém deve ter de o reescrever para
 * o mandar; as linhas vazias caem, para um parágrafo a mais no meio do texto não
 * abrir um marcador vazio no email.
 *
 * Vive aqui, ao lado do template, e é exportada para poder ser exercitada sem
 * montar um email inteiro — é a única parte disto com regras.
 */
export function linhasDeNovidades(notes: string): string[] {
  return notes
    .split(/\r?\n/)
    .map((linha) => linha.trim().replace(/^[-*\u2022]\s*/, "").trim())
    .filter((linha) => linha.length > 0);
}

/**
 * Uma novidade partida em tema e texto, quando se escreveu assim.
 *
 * "Ficha do atleta: as equipas passam a editar-se na Visão geral." — o que vem
 * antes dos dois pontos é o sítio da plataforma, e no email aparece em negrito
 * por cima do resto. É a diferença entre uma lista de frases e uma lista que se
 * lê na diagonal, e custa zero a quem escreve: é como já se escrevia no
 * `release.txt`.
 *
 * Só parte quando parece mesmo um tema: dois pontos **seguidos de espaço** (um
 * `https://` ou umas `10:30` não partem), e um tema curto (até 48 caracteres) —
 * uma frase comprida com dois pontos no meio é uma frase, não um título.
 */
export function partirNovidade(linha: string): { tema: string | null; texto: string } {
  const i = linha.indexOf(": ");
  if (i < 2 || i > 48) return { tema: null, texto: linha };
  const tema = linha.slice(0, i).trim();
  const texto = linha.slice(i + 2).trim();
  if (!texto) return { tema: null, texto: linha };
  return { tema, texto };
}

/**
 * O logótipo da plataforma, para os emails que são **da** plataforma.
 *
 * A versão de 128 px que o site já serve: mostra-se a 44 px, e três vezes a
 * resolução chega para um ecrã de telemóvel sem pesar nada. O original
 * (`images/academias-logo.png`) tem 4096 px e quase um megabyte — num email
 * seria um anexo disfarçado.
 */
export const ACADEMIAS_LOGO_URL = "https://academias.pt/academias-logo.png";

/**
 * A primeira letra em maiúscula.
 *
 * Só no HTML, e só quando o tema foi partido: aí a descrição fica numa linha
 * própria, e "as equipas passam a…" em minúscula lê-se como um fragmento. No
 * texto simples fica "Tema: as equipas…", onde a minúscula é a certa.
 */
function maiuscula(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase("pt-PT") + texto.slice(1);
}

/** O verde do logótipo, que é o da marca. */
const VERDE = "#14594c";
const VERDE_ESCURO = "#0e3f36";

/**
 * O que mudou na plataforma, contado ao responsável de um clube.
 *
 * ## Porque é que este email existe
 *
 * Porque um clube que não sabe o que mudou não usa o que mudou. As novidades
 * viviam num `release.txt` na raiz do repositório, escrito a cada deploy e lido
 * por uma pessoa, e funcionalidades pedidas por um clube ficavam meses por usar
 * por esse clube, que não sabia que já lá estavam.
 *
 * ## Porque é que não usa o `layout` dos outros
 *
 * Porque os outros são emails **de sistema** — um convite, um aviso de
 * pagamento — e esse desenho é deliberadamente discreto: a cor do clube, um
 * título, um botão. Isto é um **anúncio**, e a primeira versão, feita com esse
 * desenho, pareceu "um pouco básica". Tem por isso o seu próprio: o logótipo da
 * plataforma no topo, a versão como etiqueta, cada novidade como uma linha com
 * marcador e tema em negrito, e um rodapé que diz porquê se recebe isto.
 * Mexer no `layout` partilhado para chegar aqui mudaria também o convite de
 * sócio e o aviso de pagamento, que não pediram nada.
 *
 * ## Mesmas regras de sobrevivência
 *
 * Tabelas e estilos em linha, porque é o que o Outlook percebe. `width` e
 * `height` do logótipo em atributos, porque o Outlook ignora o CSS e desenhava a
 * imagem com 128 px. E o cabeçalho **lê-se sem imagens**: o nome da plataforma
 * é texto ao lado do logótipo, e o `alt` é um "A" branco sobre o mesmo verde —
 * metade dos clientes de email bloqueia imagens até a pessoa pedir.
 */
export function releaseNotesEmail(input: {
  /** O nome de quem recebe — usa-se o primeiro. */
  name: string;
  /** O clube, para a carta dizer a quem se dirige. */
  clubName: string;
  /** "1.4", "29/09/2026" — como foi escrita no painel. */
  version: string;
  title: string;
  /** O corpo em bruto, uma novidade por linha. Ver `linhasDeNovidades`. */
  notes: string;
  /** A consola deste clube. */
  link: string;
  /** Para testes e ambientes sem o site; por omissão, o do site. */
  logoUrl?: string;
}): { subject: string; html: string; text: string } {
  const itens = linhasDeNovidades(input.notes).map(partirNovidade);
  const primeiro = input.name.trim().split(/\s+/)[0] || input.name.trim();
  const logo = input.logoUrl ?? ACADEMIAS_LOGO_URL;
  const n = itens.length;
  const quantas = n === 1 ? "1 novidade" : n + " novidades";

  const lista = itens
    .map(
      (it, i) => `
          <tr>
            <td valign="top" style="width:34px;padding:${i === 0 ? "4px" : "16px"} 0 ${i === n - 1 ? "4px" : "16px"};${i > 0 ? "border-top:1px solid #efece8;" : ""}">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td align="center" valign="middle" style="width:22px;height:22px;background:#e6f0ec;border-radius:50%;
                    font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;color:${VERDE};line-height:22px;">${i + 1}</td>
              </tr></table>
            </td>
            <td valign="top" style="padding:${i === 0 ? "4px" : "16px"} 0 ${i === n - 1 ? "4px" : "16px"};${i > 0 ? "border-top:1px solid #efece8;" : ""}
                font-family:Helvetica,Arial,sans-serif;">
              ${it.tema ? `<p style="margin:0 0 3px;font-size:15px;line-height:1.4;font-weight:700;color:#1c1a18;">${esc(it.tema)}</p>` : ""}
              <p style="margin:0;font-size:15px;line-height:1.6;color:${it.tema ? "#4a4743" : "#2d2b28"};">${esc(it.tema ? maiuscula(it.texto) : it.texto)}</p>
            </td>
          </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${esc(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f1efeb;">
<!-- O texto que o telemóvel mostra ao lado do assunto, antes de abrir. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(quantas)} na plataforma do ${esc(input.clubName)}.</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1efeb;">
<tr><td align="center" style="padding:36px 16px 28px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="max-width:580px;background:#ffffff;border-radius:14px;overflow:hidden;
              border:1px solid #e7e3dd;">

  <!-- Cabeçalho: o logótipo e o nome, que se lê mesmo com as imagens bloqueadas. -->
  <tr>
    <td style="background:${VERDE_ESCURO};padding:22px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle" style="width:44px;height:44px;">
              <img src="${esc(logo)}" alt="A" width="44" height="44"
                   style="display:block;width:44px;height:44px;border:0;border-radius:50%;background:${VERDE};
                          font-family:Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:#ffffff;
                          text-align:center;line-height:44px;" />
            </td>
            <td valign="middle" style="padding-left:12px;font-family:Helvetica,Arial,sans-serif;">
              <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.01em;">Academias</p>
              <p style="margin:2px 0 0;font-size:12px;color:#a9c9bf;">Plataforma de gestão de clubes</p>
            </td>
          </tr></table>
        </td>
        <td align="right" valign="middle" style="font-family:Helvetica,Arial,sans-serif;">
          <span style="display:inline-block;padding:5px 11px;border-radius:999px;background:#1d5c50;
                       font-size:11.5px;font-weight:700;color:#d8ece5;letter-spacing:0.04em;white-space:nowrap;">NOVIDADES</span>
        </td>
      </tr></table>
    </td>
  </tr>

  <!-- A abertura: versão, título e a quem se escreve. -->
  <tr>
    <td style="padding:32px 32px 8px;font-family:Helvetica,Arial,sans-serif;">
      <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:${VERDE};letter-spacing:0.06em;text-transform:uppercase;">
        Versão ${esc(input.version)} · ${esc(quantas)}
      </p>
      <h1 style="margin:0 0 18px;font-size:25px;line-height:1.25;font-weight:700;color:#1c1a18;">${esc(input.title)}</h1>
      <p style="margin:0 0 6px;font-size:15px;line-height:1.6;color:#4a4743;">Olá ${esc(primeiro)},</p>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#4a4743;">
        Há novidades na plataforma do <strong style="color:#1c1a18;">${esc(input.clubName)}</strong>. Fica aqui o resumo do que mudou.
      </p>
    </td>
  </tr>

  <!-- As novidades. -->
  ${
    n > 0
      ? `<tr>
    <td style="padding:20px 32px 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:#faf9f7;border:1px solid #efece8;border-radius:10px;">
        <tr><td style="padding:14px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lista}
          </table>
        </td></tr>
      </table>
    </td>
  </tr>`
      : ""
  }

  <!-- O caminho para lá. -->
  <tr>
    <td style="padding:26px 32px 30px;font-family:Helvetica,Arial,sans-serif;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="background:${VERDE};border-radius:8px;">
          <a href="${esc(input.link)}"
             style="display:inline-block;padding:14px 28px;font-family:Helvetica,Arial,sans-serif;
                    font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Abrir a consola do clube</a>
        </td>
      </tr></table>
      <p style="margin:14px 0 0;font-size:12.5px;line-height:1.5;color:#8a8681;">
        Ou copia este endereço:
        <a href="${esc(input.link)}" style="color:${VERDE};text-decoration:underline;word-break:break-all;">${esc(input.link)}</a>
      </p>
    </td>
  </tr>

  <!-- Porquê se recebe isto. -->
  <tr>
    <td style="padding:18px 32px 22px;background:#faf9f7;border-top:1px solid #efece8;font-family:Helvetica,Arial,sans-serif;">
      <p style="margin:0;font-size:12.5px;line-height:1.55;color:#8a8681;">
        Recebes este email porque estás registado como responsável do ${esc(input.clubName)} na plataforma Academias.
        Tens alguma dúvida ou sugestão? Basta responder.
      </p>
    </td>
  </tr>

</table>

<p style="margin:20px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#a8a49f;">
  Academias · <a href="https://academias.pt" style="color:#a8a49f;text-decoration:underline;">academias.pt</a>
</p>

</td></tr>
</table>
</body>
</html>`;

  const text = [
    "ACADEMIAS · NOVIDADES",
    "Versão " + input.version + " · " + quantas,
    "",
    input.title,
    "",
    "Olá " + primeiro + ",",
    "",
    "Há novidades na plataforma do " + input.clubName + ". Fica aqui o resumo do que mudou.",
    "",
    ...itens.map((it, i) => (i + 1) + ". " + (it.tema ? it.tema + ": " + it.texto : it.texto)),
    "",
    "Abrir a consola do clube:",
    input.link,
    "",
    "--",
    "Recebes este email porque estás registado como responsável do " + input.clubName + " na plataforma Academias.",
    "Tens alguma dúvida ou sugestão? Basta responder.",
  ].join("\n");

  return { subject: "Academias · " + input.title, html, text };
}

/**
 * Um comunicado livre da plataforma a um clube: assunto e texto.
 *
 * Irmão de `releaseNotesEmail`, com o mesmo cabeçalho e o mesmo rodapé, para os
 * dois se reconhecerem como vindos da mesma casa. O que muda é o miolo: em vez
 * de uma lista numerada de novidades, o texto como foi escrito. Uma linha em
 * branco separa parágrafos; uma quebra simples fica uma quebra.
 *
 * O botão para a consola é opcional de propósito: um aviso de manutenção ou uma
 * mensagem de boas festas não mandam ninguém a lado nenhum.
 */
export function comunicadoEmail(input: {
  name: string;
  clubName: string;
  /** O assunto. */
  title: string;
  /** O texto em bruto. Ver `paragrafosDoComunicado`. */
  notes: string;
  link: string;
  logoUrl?: string;
}): { subject: string; html: string; text: string } {
  const paragrafos = paragrafosDoComunicado(input.notes);
  const primeiro = input.name.trim().split(/\s+/)[0] || input.name.trim();
  const logo = input.logoUrl ?? ACADEMIAS_LOGO_URL;
  const resumo = (paragrafos[0] ?? "").replace(/\s+/g, " ").slice(0, 110);

  const corpo = paragrafos
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#2d2b28;">${esc(p).replace(/\n/g, "<br />")}</p>`,
    )
    .join("\n      ");

  const html = `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${esc(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f1efeb;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(resumo)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1efeb;">
<tr><td align="center" style="padding:36px 16px 28px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="max-width:580px;background:#ffffff;border-radius:14px;overflow:hidden;
              border:1px solid #e7e3dd;">

  <tr>
    <td style="background:${VERDE_ESCURO};padding:22px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle" style="width:44px;height:44px;">
              <img src="${esc(logo)}" alt="A" width="44" height="44"
                   style="display:block;width:44px;height:44px;border:0;border-radius:50%;background:${VERDE};
                          font-family:Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:#ffffff;
                          text-align:center;line-height:44px;" />
            </td>
            <td valign="middle" style="padding-left:12px;font-family:Helvetica,Arial,sans-serif;">
              <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.01em;">Academias</p>
              <p style="margin:2px 0 0;font-size:12px;color:#a9c9bf;">Plataforma de gestão de clubes</p>
            </td>
          </tr></table>
        </td>
        <td align="right" valign="middle" style="font-family:Helvetica,Arial,sans-serif;">
          <span style="display:inline-block;padding:5px 11px;border-radius:999px;background:#1d5c50;
                       font-size:11.5px;font-weight:700;color:#d8ece5;letter-spacing:0.04em;white-space:nowrap;">COMUNICADO</span>
        </td>
      </tr></table>
    </td>
  </tr>

  <tr>
    <td style="padding:32px 32px 6px;font-family:Helvetica,Arial,sans-serif;">
      <h1 style="margin:0 0 18px;font-size:25px;line-height:1.25;font-weight:700;color:#1c1a18;">${esc(input.title)}</h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#4a4743;">Olá ${esc(primeiro)},</p>
      ${corpo}
    </td>
  </tr>

  <tr>
    <td style="padding:12px 32px 30px;font-family:Helvetica,Arial,sans-serif;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="background:${VERDE};border-radius:8px;">
          <a href="${esc(input.link)}"
             style="display:inline-block;padding:14px 28px;font-family:Helvetica,Arial,sans-serif;
                    font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Abrir a consola do clube</a>
        </td>
      </tr></table>
    </td>
  </tr>

  <tr>
    <td style="padding:18px 32px 22px;background:#faf9f7;border-top:1px solid #efece8;font-family:Helvetica,Arial,sans-serif;">
      <p style="margin:0;font-size:12.5px;line-height:1.55;color:#8a8681;">
        Recebes este email porque estás registado como responsável do ${esc(input.clubName)} na plataforma Academias.
        Para falar connosco, basta responder.
      </p>
    </td>
  </tr>

</table>

<p style="margin:20px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#a8a49f;">
  Academias · <a href="https://academias.pt" style="color:#a8a49f;text-decoration:underline;">academias.pt</a>
</p>

</td></tr>
</table>
</body>
</html>`;

  const text = [
    "ACADEMIAS · COMUNICADO",
    "",
    input.title,
    "",
    "Olá " + primeiro + ",",
    "",
    ...paragrafos.flatMap((p) => [p, ""]),
    "Abrir a consola do clube:",
    input.link,
    "",
    "--",
    "Recebes este email porque estás registado como responsável do " + input.clubName + " na plataforma Academias.",
    "Para falar connosco, basta responder.",
  ].join("\n");

  return { subject: "Academias · " + input.title, html, text };
}

/**
 * O texto de um comunicado, em parágrafos: uma ou mais linhas em branco separam
 * dois. As quebras simples dentro de um parágrafo ficam (uma morada, uma lista
 * escrita à mão). Gémeo de `paragrafosDoComunicado` no painel.
 */
export function paragrafosDoComunicado(notes: string): string[] {
  return notes
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => l.trim()).join("\n").trim())
    .filter((p) => p.length > 0);
}

export function memberSignupReceivedEmail(input: {
  brand: MailBrand;
  name: string;
}): { subject: string; html: string; text: string } {
  const heading = "Recebemos o teu pedido";
  const paragraphs = [
    "O teu pedido para te tornares sócio de <strong>" + esc(input.brand.name) + "</strong> foi submetido e está a ser analisado pelo clube.",
    "Assim que houver uma decisão, recebes um email neste endereço. Se for aprovado, virá com o acesso à app do clube — onde tens o cartão de sócio, as quotas e as novidades.",
  ];
  const notes = [
    "Não é preciso fazer mais nada por agora, nem voltar a preencher o formulário.",
    "Se não foste tu que pediste, podes ignorar este email — nada fica em teu nome sem aprovação do clube.",
  ];

  return {
    subject: input.brand.shortName + " · recebemos o teu pedido de sócio",
    html: layout({ brand: input.brand, heading, paragraphs, notes }),
    text: plain(
      "Olá " + input.name.trim().split(/\s+/)[0] + ",",
      [
        "O teu pedido para te tornares sócio de " + input.brand.name + " foi submetido e está a ser analisado pelo clube.",
        "Assim que houver uma decisão, recebes um email neste endereço.",
      ],
      undefined,
      notes.map(semTags),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Clube acabado de abrir — o primeiro convite, o de quem o vai montar         */
/* -------------------------------------------------------------------------- */

/**
 * O convite de quem recebe um clube vazio.
 *
 * ## Porque é que não é o `staffInviteEmail`
 *
 * Aquele diz "X convidou-te para Y" — um clube que já existe a chamar mais uma
 * pessoa para dentro. Aqui não há clube nenhum a convidar: a plataforma abriu-o
 * agora, não tem lá ninguém, e quem recebe isto é a primeira pessoa e a que vai
 * montar tudo. A frase certa é outra, e a expectativa que ela cria também: não é
 * "tens acesso", é "isto ainda está por fazer e és tu que o fazes".
 *
 * ## De quem vem
 *
 * O assunto diz **Academias** porque é a plataforma que envia e quem recebe pode
 * não reconhecer mais nada — pode nem saber que o clube já foi criado. O corpo
 * leva as cores e o nome do clube, que é sobre o que isto é.
 */
export function academyOwnerInviteEmail(input: {
  brand: MailBrand;
  name: string;
  /** O cargo com que entra: "Presidente", ou o que o clube usar. */
  title: string;
  link: string;
  expiresAt: Date;
  /**
   * Já tem conta nesta plataforma, com este email.
   *
   * Muda a frase, porque muda o que a página lhe vai pedir: quem tem conta
   * confirma a palavra-passe que já usa — não escolhe uma nova. Prometer aqui
   * "escolhes a tua palavra-passe" e depois mostrar um campo a dizer "a tua
   * palavra-passe atual" é o género de contradição que faz uma pessoa achar que
   * abriu o link errado. Ver `invited_account` e `existingAccountFields`.
   */
  hasAccount?: boolean;
}): { subject: string; html: string; text: string } {
  const primeiro = input.name.trim().split(/\s+/)[0] || input.name;

  const entrada = input.hasAccount
    ? "Já tens conta na plataforma com este email — confirmas a palavra-passe que já usas e este clube passa a estar lá dentro."
    : "Ao abrir o convite escolhes a tua palavra-passe.";

  const heading = esc(input.brand.name) + " está pronta";
  const paragraphs = [
    // Sem artigo antes do nome do clube, pela mesma razão do `staffInviteEmail`:
    // o nome vem da base de dados e não há artigo que sirva a todos.
    "Criámos " + esc(input.brand.name) + " na plataforma Academias e o acesso é teu, como <strong>" +
      esc(input.title) + "</strong>.",
    entrada + " A partir daí montas as equipas, o staff e os atletas — e as famílias passam a ter a app do clube.",
  ];
  const notes = [
    "Este convite é válido até " + dia(input.expiresAt) + ".",
    "Só funciona para o endereço a que foi enviado, e só pode ser usado uma vez.",
    "Se não estavas à espera disto, ignora este email — sem abrir o link, nada acontece.",
  ];

  return {
    subject: "Academias · convite para gerir o teu clube",
    html: layout({
      brand: input.brand,
      greeting: "Olá " + primeiro + ",",
      heading,
      paragraphs,
      cta: { label: "Começar a montar o clube", url: input.link },
      notes,
    }),
    text: plain(
      "Olá " + primeiro + ",",
      [
        "Criámos " + input.brand.name + " na plataforma Academias e o acesso é teu, como " + input.title + ".",
        semTags(entrada) + " A partir daí montas as equipas, o staff e os atletas — e as famílias passam a ter a app do clube.",
      ],
      { label: "Começar a montar o clube", url: input.link },
      notes.map(semTags),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Convite de administrador — quem vem pôr uma academia a andar                */
/* -------------------------------------------------------------------------- */

export function adminInviteEmail(input: {
  name: string;
  role: string;
  link: string;
  expiresAt: Date;
}): { subject: string; html: string; text: string } {
  const brand: MailBrand = { shortName: "Academias", name: "Plataforma Academias", signalColor: FALLBACK };
  const heading = "Acesso à plataforma Academias";
  const paragraphs = [
    "Foste convidado para <strong>" + esc(input.role) + "</strong> na plataforma, de onde se criam e acompanham as academias.",
    "Ao abrir o convite escolhes a tua palavra-passe.",
  ];
  const notes = [
    "Este convite é válido até " + dia(input.expiresAt) + ".",
    "Só funciona para o endereço a que foi enviado.",
  ];

  return {
    subject: "Academias · convite de acesso",
    html: layout({ brand, heading, paragraphs, cta: { label: "Aceitar o convite", url: input.link }, notes }),
    text: plain(
      "Olá " + (input.name.trim().split(/\s+/)[0] || input.name) + ",",
      [
        "Foste convidado para " + input.role + " na plataforma Academias, de onde se criam e acompanham as academias.",
        "Ao abrir o convite escolhes a tua palavra-passe.",
      ],
      { label: "Aceitar o convite", url: input.link },
      notes.map(semTags),
    ),
  };
}


/* -------------------------------------------------------------------------- */
/* Aviso de ticket novo — para nós, não para o cliente                         */
/* -------------------------------------------------------------------------- */

/**
 * Chegou um pedido pelo site.
 *
 * ## Porque é que este email é diferente de todos os outros
 *
 * Os outros são convites: vão para fora, pedem uma acção a quem os recebe e o
 * corpo é curto de propósito. Este vai para **dentro** — para quem atende os
 * pedidos — e a acção dele é ler. Por isso leva o pedido inteiro no corpo: nome,
 * clube, contactos, assunto e a mensagem tal como foi escrita.
 *
 * Se for preciso abrir a plataforma para saber de que se trata, o email falhou o
 * seu trabalho. Serve para decidir, no telemóvel, se isto espera pela segunda ou
 * se se responde agora.
 *
 * ## O `replyTo`
 *
 * É o email de quem escreveu. Carregar em "responder" fala com a pessoa, não com
 * o servidor — que é o gesto que se faz nove em cada dez vezes.
 */
export function ticketAlertEmail(input: {
  name: string;
  email: string;
  phone?: string | null;
  club?: string | null;
  subject: string;
  role?: string | null;
  athletes?: string | null;
  message?: string | null;
  link: string;
}): { subject: string; html: string; text: string } {
  const brand: MailBrand = { shortName: "Academias", name: "Plataforma Academias", signalColor: FALLBACK };

  const campos: [string, string | null | undefined][] = [
    ["Nome", input.name],
    ["Clube", input.club],
    ["Email", input.email],
    ["Telefone", input.phone],
    ["Assunto", input.subject],
    ["Cargo", input.role],
    ["Atletas", input.athletes],
  ];
  const preenchidos = campos.filter((c): c is [string, string] => Boolean(c[1]));

  /*
   * Os campos como linhas de uma tabela, e não como parágrafos.
   *
   * Um bloco de "Nome: X. Clube: Y. Telefone: Z." lê-se como prosa e obriga a
   * procurar. Em duas colunas o olho salta directamente ao que quer — e é assim
   * que se lê um pedido de contacto, não a começar no princípio.
   */
  const tabela =
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">' +
    preenchidos
      .map(
        ([rotulo, valor]) =>
          '<tr>' +
          '<td style="padding:4px 12px 4px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;' +
          'color:#8a867c;white-space:nowrap;vertical-align:top">' + esc(rotulo) + "</td>" +
          '<td style="padding:4px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;' +
          'color:#1a1917;vertical-align:top">' + esc(valor) + "</td>" +
          "</tr>",
      )
      .join("") +
    "</table>";

  /* A mensagem com as quebras de linha que a pessoa escreveu. */
  const mensagem = input.message?.trim()
    ? '<div style="margin-top:4px;padding:12px 14px;background:#f7f6f3;border-radius:8px;' +
      'font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1a1917;' +
      'white-space:pre-wrap">' + esc(input.message.trim()) + "</div>"
    : '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#8a867c">' +
      "Sem mensagem — só o formulário.</p>";

  return {
    // O assunto traz o nome e o clube: é o que se lê na lista de correio, e é
    // onde se decide se vale a pena abrir agora.
    subject: `Novo pedido no site — ${input.name}${input.club ? ` (${input.club})` : ""}`,
    html: layout({
      brand,
      heading: "Chegou um pedido pelo site",
      // `blocks` e não `paragraphs`: são uma tabela e um bloco, e um `<p>` à
      // volta de uma `<table>` é HTML inválido. Ver `Layout.blocks`.
      paragraphs: [],
      blocks: [tabela, mensagem],
      cta: { label: "Abrir na plataforma", url: input.link },
      notes: ["Responder a este email fala directamente com quem o escreveu."],
    }),
    text: plain(
      "Chegou um pedido pelo site",
      [
        ...preenchidos.map(([rotulo, valor]) => `${rotulo}: ${valor}`),
        "",
        input.message?.trim() || "Sem mensagem.",
      ],
      { label: "Abrir na plataforma", url: input.link },
      ["Responder a este email fala directamente com quem o escreveu."],
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Repor a palavra-passe — quem se esqueceu dela                               */
/* -------------------------------------------------------------------------- */

/**
 * O link para escolher uma palavra-passe nova.
 *
 * Com a marca do clube onde foi pedido. Quem se esqueceu da palavra-passe estava
 * na página do clube ou na app do clube; um email de um remetente genérico, com
 * um assunto em inglês, é o que se apaga sem abrir.
 *
 * Sem saudação com nome: o pedido chega só com um endereço de email.
 */
export function passwordResetEmail(input: {
  brand: MailBrand;
  link: string;
}): { subject: string; html: string; text: string } {
  const heading = "Repor a palavra-passe";
  const paragraphs = [
    "Recebemos um pedido para repor a palavra-passe da tua conta.",
    "Carrega no botão para escolheres uma nova. Até lá, a atual continua a funcionar.",
  ];
  const notes = [
    "O link vale durante uma hora e só pode ser usado uma vez.",
    "Se não foste tu a pedir, ignora este email — a tua palavra-passe não muda.",
  ];
  const cta = { label: "Escolher palavra-passe nova", url: input.link };

  return {
    subject: input.brand.shortName + " · repor a palavra-passe",
    html: layout({ brand: input.brand, heading, paragraphs, cta, notes }),
    text: plain(heading, paragraphs, cta, notes),
  };
}

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Ordem de adesão — o que o clube contratou, e o pedido de assinatura         */
/* -------------------------------------------------------------------------- */

/**
 * As condições comerciais de um clube, para quem as assina.
 *
 * ## Porque é que isto é uma tabela e não um parágrafo
 *
 * Porque é um contrato. Quem o lê procura um número — o preço, a data, o
 * período mínimo — e procura-o com o olho, não com a leitura. Uma frase com
 * "19,99 € por mês a partir de 12 de Setembro por um mínimo de 12 meses" obriga
 * a lê-la inteira para encontrar um campo, e é a forma mais rápida de alguém
 * assinar sem ver o que assinou.
 *
 * ## O que o email **não** faz
 *
 * Não assina. O botão leva à consola, onde a pessoa entra com a conta dela e
 * assina lá — é a mesma porta por onde já aceita os Termos de Serviço, e é o
 * que garante que quem assinou é quem diz ser. Um link que assinasse ao ser
 * aberto punha um contrato à mercê de um reencaminhamento de correio.
 */
export function subscriptionOrderEmail(input: {
  brand: MailBrand;
  /** Quem recebe — o responsável do clube. */
  name: string;
  /** O cargo com que consta: "Presidente". */
  title: string;
  /** O nome do cliente no contrato — o clube, por extenso. */
  clientName: string;
  planName: string;
  annual: boolean;
  /** O que paga por período, em cêntimos, já com desconto. */
  amountCents: number;
  /** O preço de tabela por mês, para se ver de onde vem o desconto. */
  listMonthlyCents: number;
  discountPct: number;
  startsOn: Date;
  minimumMonths: number;
  renewalNote: string;
  notes?: string | null;
  termsVersion?: string | null;
  link: string;
  /** Já houve uma ordem antes desta — muda a primeira frase. */
  isUpdate?: boolean;
}): { subject: string; html: string; text: string } {
  const primeiro = input.name.trim().split(/\s+/)[0] || input.name;
  const porPeriodo = input.annual ? "por ano" : "por mês";

  /*
   * O preço de tabela só aparece quando há desconto.
   *
   * Sem desconto seriam dois números iguais um por cima do outro, e dois números
   * iguais num contrato fazem quem lê parar para perceber a diferença que não há.
   */
  /*
   * No anual, a mensalidade que o desconto dá — o ano a dividir por doze — e a
   * de tabela ao lado. Antes ia só a de tabela, e o clube lia no contrato o
   * preço que não paga.
   */
  const mensal = input.annual ? Math.round(input.amountCents / 12) : input.amountCents;
  const preco = input.discountPct > 0
    ? euros(input.amountCents) + " " + porPeriodo +
      " <span style=\"color:#8a867c\">(" + euros(mensal) + "/mês em vez de " + euros(input.listMonthlyCents) +
      ", menos " + input.discountPct + "%)</span>"
    : euros(input.amountCents) + " " + porPeriodo;

  const linhas: [string, string][] = [
    ["Cliente", esc(input.clientName)],
    ["Plano", esc(input.planName)],
    ["Preço", preco],
    ["Periodicidade", input.annual ? "Anual" : "Mensal"],
    ["Data de início", dia(input.startsOn)],
    ["Período contratual mínimo", esc(periodoMinimoPorExtenso(input.minimumMonths))],
    ["Renovação", esc(input.renewalNote)],
  ];
  if (input.notes?.trim()) linhas.push(["Observações", esc(input.notes.trim())]);

  const tabela =
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;' +
    'border:1px solid #e5e2dc;border-radius:10px;overflow:hidden;">' +
    linhas
      .map(
        ([rotulo, valor], i) =>
          '<tr style="' + (i % 2 === 0 ? "background:#faf9f7;" : "") + '">' +
          '<td style="padding:9px 12px;font-size:13px;color:#52504c;white-space:nowrap;">' + esc(rotulo) + "</td>" +
          '<td style="padding:9px 12px;font-size:13px;color:#1a1917;font-weight:600;text-align:right;">' + valor + "</td>" +
          "</tr>",
      )
      .join("") +
    "</table>";

  const abertura = input.isUpdate
    ? "As condições da subscrição de " + esc(input.brand.name) + " foram actualizadas."
    : "Aqui ficam as condições da subscrição de " + esc(input.brand.name) + " na plataforma Academias.";

  const paragraphs = [
    abertura + " Chegam a ti como <strong>" + esc(input.title) + "</strong>, que é quem representa o clube.",
  ];

  const notes = [
    input.termsVersion
      ? "Aplicam-se os Termos de Serviço em vigor (versão " + esc(input.termsVersion) + "), incluindo a cláusula de cancelamento antecipado."
      : "Aplicam-se os Termos de Serviço em vigor, incluindo a cláusula de cancelamento antecipado.",
    "A assinatura é feita na consola, com a tua conta — este email não assina nada.",
    "Se alguma destas condições não é a que combinaste, responde a este email antes de assinar.",
  ];

  return {
    subject: "Academias · condições da subscrição de " + input.brand.shortName,
    html: layout({
      brand: input.brand,
      greeting: "Olá " + primeiro + ",",
      heading: input.isUpdate ? "Condições actualizadas" : "Condições da subscrição",
      paragraphs,
      // `blocks` e não `paragraphs`: uma `<table>` dentro de um `<p>` é HTML
      // inválido, e o Outlook desenha-a como lhe apetece. Ver `Layout.blocks`.
      blocks: [tabela],
      cta: { label: "Rever e assinar", url: input.link },
      notes,
    }),
    text: plain(
      "Olá " + primeiro + ",",
      [
        semTags(abertura) + " Chegam a ti como " + input.title + ", que é quem representa o clube.",
        ...linhas.map(([rotulo, valor]) => rotulo + ": " + semTags(valor)),
      ],
      { label: "Rever e assinar", url: input.link },
      notes.map(semTags),
    ),
  };
}

/**
 * O aviso de pagamento da subscrição — o que sai todos os meses.
 *
 * ## O que este email é, e o que não é
 *
 * É o aviso de que a mensalidade da plataforma está a vencer: quanto, que
 * período cobre, e até quando. **Não traz dados de pagamento** — a factura segue
 * pelo caminho do costume, e um IBAN escrito num email automático é a porta por
 * onde entra a burla que se conhece (o email falso com o IBAN trocado).
 *
 * ## Porque é que o período vem escrito
 *
 * Porque "a mensalidade de Outubro" não quer dizer nada num ciclo que corre de
 * dia 20 a dia 19. Quem recebe tem de poder confirmar o que está a pagar sem
 * perguntar a ninguém — e quem trata das contas do clube arquiva isto.
 */
export function subscriptionNoticeEmail(input: {
  brand: MailBrand;
  /** Quem recebe — o responsável do clube. */
  name: string;
  /** O cargo com que consta: "Presidente". */
  title: string;
  /** O nome do cliente, o clube por extenso. */
  clientName: string;
  planName: string;
  annual: boolean;
  amountCents: number;
  periodStart: Date;
  periodEnd: Date;
  dueOn: Date;
  /** Onde estão as condições assinadas. */
  link: string;
}): { subject: string; html: string; text: string } {
  const primeiro = input.name.trim().split(/\s+/)[0] || input.name;
  const periodo = dia(input.periodStart) + " a " + dia(input.periodEnd);

  const linhas: [string, string][] = [
    ["Cliente", esc(input.clientName)],
    ["Plano", esc(input.planName)],
    ["Período", esc(periodo)],
    ["Valor", euros(input.amountCents)],
    ["Data-limite", dia(input.dueOn)],
  ];

  const tabela =
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;' +
    'border:1px solid #e5e2dc;border-radius:10px;overflow:hidden;">' +
    linhas
      .map(
        ([rotulo, valor], i) =>
          '<tr style="' + (i % 2 === 0 ? "background:#faf9f7;" : "") + '">' +
          '<td style="padding:9px 12px;font-size:13px;color:#52504c;white-space:nowrap;">' + esc(rotulo) + "</td>" +
          '<td style="padding:9px 12px;font-size:13px;color:#1a1917;font-weight:600;text-align:right;">' + valor + "</td>" +
          "</tr>",
      )
      .join("") +
    "</table>";

  const abertura =
    (input.annual ? "Venceu a anuidade" : "Venceu a mensalidade") +
    " de " + esc(input.brand.name) + " na plataforma Academias, referente a " + esc(periodo) + ".";

  const notes = [
    "A factura segue pelo caminho do costume. Este email é o aviso, e não pede dados de pagamento nenhuns.",
    "Se já pagaste, ignora este aviso. Ele sai no dia do vencimento e não sabe do banco.",
    "Alguma coisa não bate certo? Responde a este email.",
  ];

  return {
    subject:
      "Academias · " + (input.annual ? "anuidade" : "mensalidade") + " de " + input.brand.shortName +
      " · " + euros(input.amountCents),
    html: layout({
      brand: input.brand,
      greeting: "Olá " + primeiro + ",",
      heading: input.annual ? "Anuidade a pagamento" : "Mensalidade a pagamento",
      paragraphs: [
        abertura + " Chega a ti como <strong>" + esc(input.title) + "</strong>, que é quem representa o clube.",
      ],
      blocks: [tabela],
      cta: { label: "Ver as condições", url: input.link },
      notes,
    }),
    text: plain(
      "Olá " + primeiro + ",",
      [
        semTags(abertura) + " Chega a ti como " + input.title + ", que é quem representa o clube.",
        ...linhas.map(([rotulo, valor]) => rotulo + ": " + semTags(valor)),
      ],
      { label: "Ver as condições", url: input.link },
      notes.map(semTags),
    ),
  };
}

/**
 * Os emails da mensalidade da plataforma, desde que se paga na consola.
 *
 * Quatro momentos, um molde: a mensalidade ficou disponível (no primeiro dia
 * do período), um lembrete por semana enquanto estiver por pagar, a suspensão
 * quando o período acaba sem pagamento, e o recibo quando o pagamento chega.
 *
 * ## O que nunca vem aqui
 *
 * A referência Multibanco, o número de telemóvel, qualquer dado de pagamento.
 * A referência vê-se na consola, com sessão iniciada: um email com "paga para
 * a entidade X, referência Y" é precisamente o que uma burla por email imita,
 * e quem recebe não tem como distinguir o nosso do falso. O email diz o que
 * está em falta e aponta para a consola; a consola é que mostra como pagar.
 *
 * ## "De 5 de outubro a 4 de novembro"
 *
 * Nunca "a mensalidade de outubro": o período começa no dia em que o clube
 * aderiu, e um que aderiu a 20 tem dois meses do calendário em cada
 * mensalidade. A frase vem de `periodoPorExtenso`, a mesma da consola.
 */
export function subscriptionPaymentEmail(input: {
  brand: MailBrand;
  kind: "disponivel" | "lembrete" | "suspenso" | "recebido";
  /** Quem recebe: o responsável do clube. */
  name: string;
  title: string;
  planName: string;
  annual: boolean;
  amountCents: number;
  periodStart: Date;
  periodEnd: Date;
  /** O número do lembrete, de 1 a 3. */
  lembrete?: number;
  /** Na suspensão: outras mensalidades também por pagar, se as houver. */
  outras?: { periodStart: Date; periodEnd: Date; amountCents: number }[];
  /** No recibo: como se pagou. */
  metodo?: string;
  /** Há condições de adesão por aceitar: sem isso a mensalidade não se paga. */
  porAssinar?: boolean;
  paidAt?: Date;
  /** A secção da mensalidade nas Definições da consola. */
  link: string;
}): { subject: string; html: string; text: string } {
  const primeiro = input.name.trim().split(/\s+/)[0] || input.name;
  const periodo = periodoPorExtenso(input.periodStart, input.periodEnd);
  const nome = input.annual ? "anuidade" : "mensalidade";
  const limite = dia(input.periodEnd);

  const linhas: [string, string][] = [
    ["Clube", esc(input.brand.name)],
    ["Plano", esc(input.planName)],
    ["Período", esc(periodo)],
    ["Valor", euros(input.amountCents)],
  ];
  if (input.kind === "recebido") {
    if (input.paidAt) linhas.push(["Pago em", dia(input.paidAt)]);
    if (input.metodo) linhas.push(["Pago por", esc(input.metodo)]);
  } else if (input.kind !== "suspenso") {
    linhas.push(["Pagar até", limite]);
  }
  for (const o of input.outras ?? []) {
    linhas.push(["Também em falta", esc(periodoPorExtenso(o.periodStart, o.periodEnd)) + " · " + euros(o.amountCents)]);
  }

  const tabela =
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;' +
    'border:1px solid #e5e2dc;border-radius:10px;overflow:hidden;">' +
    linhas
      .map(
        ([rotulo, valor], i) =>
          '<tr style="' + (i % 2 === 0 ? "background:#faf9f7;" : "") + '">' +
          '<td style="padding:9px 12px;font-size:13px;color:#52504c;white-space:nowrap;">' + esc(rotulo) + "</td>" +
          '<td style="padding:9px 12px;font-size:13px;color:#1a1917;font-weight:600;text-align:right;">' + valor + "</td>" +
          "</tr>",
      )
      .join("") +
    "</table>";

  const texto = ((): { heading: string; abertura: string; cta: string; subject: string; notes: string[] } => {
    const como = "Paga-se na consola, em Definições, por MB WAY ou com referência Multibanco.";
    switch (input.kind) {
      case "disponivel":
        return {
          heading: "A " + nome + " da plataforma está disponível",
          abertura:
            "A " + nome + " de " + esc(input.brand.name) + " na plataforma Academias, de " + esc(periodo) +
            ", já pode ser paga. " + como,
          cta: "Pagar a " + nome,
          subject: "Academias · " + nome + " de " + periodo + " · " + euros(input.amountCents),
          notes: [
            "Tens até " + limite + " para pagar. Depois dessa data o acesso do clube à consola e à app fica suspenso até o pagamento chegar.",
            "Este email não traz dados de pagamento nenhuns. A referência vê-se só na consola, com sessão iniciada.",
          ],
        };
      case "lembrete":
        return {
          heading: "A " + nome + " de " + periodo + " está em falta",
          abertura:
            "A " + nome + " de " + esc(input.brand.name) + " na plataforma Academias, de " + esc(periodo) +
            ", continua por pagar. " + como,
          cta: "Pagar a " + nome,
          subject:
            "Academias · " + nome + " de " + periodo + " em falta" +
            (input.lembrete && input.lembrete >= 3 ? " · último aviso" : ""),
          notes: [
            "Tens até " + limite + " para pagar. Depois dessa data o acesso do clube à consola e à app fica suspenso até o pagamento chegar.",
            "Se já pagaste hoje, ignora este aviso: a confirmação do banco pode demorar umas horas.",
            "Este email não traz dados de pagamento nenhuns. A referência vê-se só na consola, com sessão iniciada.",
          ],
        };
      case "suspenso":
        return {
          heading: "O acesso do clube ficou suspenso",
          abertura:
            "A " + nome + " de " + esc(input.brand.name) + " na plataforma Academias, de " + esc(periodo) +
            ", não foi paga até " + limite + ". O acesso do clube à consola e à app ficou suspenso até o pagamento chegar. " +
            "Os dados estão todos guardados e nada se perde.",
          cta: "Pagar e reabrir o clube",
          subject: "Academias · acesso de " + input.brand.shortName + " suspenso · " + nome + " de " + periodo + " em falta",
          notes: [
            "Quem representa o clube continua a poder entrar na consola só para pagar. Assim que o pagamento é confirmado, o acesso reabre sozinho.",
            "Este email não traz dados de pagamento nenhuns. A referência vê-se só na consola, com sessão iniciada.",
          ],
        };
      case "recebido":
        return {
          heading: "Pagamento recebido",
          abertura:
            "Recebemos o pagamento da " + nome + " de " + esc(input.brand.name) + " na plataforma Academias, de " +
            esc(periodo) + ". Obrigado.",
          cta: "Ver as mensalidades",
          subject: "Academias · " + nome + " de " + periodo + " paga",
          notes: ["A factura segue por email nos próximos dias, para este endereço."],
        };
    }
  })();

  const assinar =
    input.porAssinar && input.kind !== "recebido"
      ? " Antes de pagar, é preciso aceitar as condições de adesão do clube, na consola em Definições, Plano. Só depois aparecem o MB WAY e a referência Multibanco."
      : "";
  const paragrafo = texto.abertura + assinar + " Chega a ti como <strong>" + esc(input.title) + "</strong>, que é quem representa o clube.";
  const notes = [...texto.notes, "Alguma coisa não bate certo? Responde a este email."];

  return {
    subject: texto.subject,
    html: layout({
      brand: input.brand,
      greeting: "Olá " + primeiro + ",",
      heading: texto.heading,
      paragraphs: [paragrafo],
      blocks: [tabela],
      cta: { label: texto.cta, url: input.link },
      notes,
    }),
    text: plain(
      "Olá " + primeiro + ",",
      [semTags(paragrafo), ...linhas.map(([rotulo, valor]) => rotulo + ": " + semTags(valor))],
      { label: texto.cta, url: input.link },
      notes.map(semTags),
    ),
  };
}

/**
 * A fatura da mensalidade da plataforma, em anexo.
 *
 * Sai do painel, quando se anexa a fatura emitida no Portal das Finanças e se
 * escolhe enviá-la. Vai para o responsável do clube, com o PDF anexado e o
 * período por extenso; na consola, a mesma fatura fica junto da mensalidade.
 */
export function subscriptionInvoiceEmail(input: {
  brand: MailBrand;
  name: string;
  title: string;
  annual: boolean;
  amountCents: number;
  periodStart: Date;
  periodEnd: Date;
  fileName: string;
  link: string;
}): { subject: string; html: string; text: string } {
  const primeiro = input.name.trim().split(/s+/)[0] || input.name;
  const periodo = periodoPorExtenso(input.periodStart, input.periodEnd);
  const nome = input.annual ? "anuidade" : "mensalidade";
  const paragrafo =
    "Segue em anexo a fatura da " + nome + " de " + esc(input.brand.name) + " na plataforma Academias, de " +
    esc(periodo) + ", no valor de " + euros(input.amountCents) + ". Chega a ti como <strong>" + esc(input.title) +
    "</strong>, que é quem representa o clube.";
  const notes = [
    "A fatura também fica guardada na consola, em Definições, Mensalidade, junto do pagamento.",
    "Alguma coisa não bate certo? Responde a este email.",
  ];
  return {
    subject: "Academias · fatura da " + nome + " de " + periodo,
    html: layout({
      brand: input.brand,
      greeting: "Olá " + primeiro + ",",
      heading: "Fatura da " + nome,
      paragraphs: [paragrafo, "Ficheiro: " + esc(input.fileName)],
      cta: { label: "Ver na consola", url: input.link },
      notes,
    }),
    text: plain(
      "Olá " + primeiro + ",",
      [semTags(paragrafo), "Ficheiro: " + input.fileName],
      { label: "Ver na consola", url: input.link },
      notes,
    ),
  };
}

/**
 * O aviso a quem factura: um clube pagou a mensalidade da plataforma.
 *
 * A euPago não emite facturas; quem as emite é a pessoa, no Portal das
 * Finanças, com o que este email traz à mão: o cliente, o NIF da instituição
 * (o da ordem assinada, quando a há), o período e o valor. Vai para
 * `PLATFORM_ALERT_EMAIL`, como os tickets.
 */
export function platformPaymentAlertEmail(input: {
  clubName: string;
  slug: string;
  institutionName: string | null;
  taxId: string | null;
  periodStart: Date;
  periodEnd: Date;
  amountCents: number;
  metodo: string;
  providerRef: string | null;
  paidAt: Date;
  /** A ficha do clube no painel. */
  link: string;
}): { subject: string; html: string; text: string } {
  const periodo = periodoPorExtenso(input.periodStart, input.periodEnd);
  const linhas: [string, string][] = [
    ["Clube", esc(input.clubName) + " (" + esc(input.slug) + ")"],
    ["Facturar a", input.institutionName ? esc(input.institutionName) : "<em>sem ordem assinada</em>"],
    ["NIF", input.taxId ? esc(input.taxId) : "<em>por obter</em>"],
    ["Período", esc(periodo)],
    ["Valor (com IVA)", euros(input.amountCents)],
    ["Pago por", esc(input.metodo) + (input.providerRef ? " · " + esc(input.providerRef) : "")],
    ["Pago em", dia(input.paidAt)],
  ];
  const tabela =
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;' +
    'border:1px solid #e5e2dc;border-radius:10px;overflow:hidden;">' +
    linhas
      .map(
        ([rotulo, valor], i) =>
          '<tr style="' + (i % 2 === 0 ? "background:#faf9f7;" : "") + '">' +
          '<td style="padding:9px 12px;font-size:13px;color:#52504c;white-space:nowrap;">' + esc(rotulo) + "</td>" +
          '<td style="padding:9px 12px;font-size:13px;color:#1a1917;font-weight:600;text-align:right;">' + valor + "</td>" +
          "</tr>",
      )
      .join("") +
    "</table>";

  const abertura = esc(input.clubName) + " pagou a mensalidade de " + esc(periodo) + ". Falta emitir a factura.";
  const notes = ["O movimento já está nas contas da plataforma, ligado à mensalidade."];
  const brand: MailBrand = { shortName: "Academias", name: "Plataforma Academias" };

  return {
    subject: "Factura a emitir · " + input.clubName + " · " + euros(input.amountCents),
    html: layout({
      brand,
      heading: "Pagamento recebido de " + input.clubName,
      paragraphs: [abertura],
      blocks: [tabela],
      cta: { label: "Abrir a ficha do clube", url: input.link },
      notes,
    }),
    text: plain(
      "Pagamento recebido de " + input.clubName,
      [semTags(abertura), ...linhas.map(([rotulo, valor]) => rotulo + ": " + semTags(valor))],
      { label: "Abrir a ficha do clube", url: input.link },
      notes,
    ),
  };
}

/** "19,99 €" — o formato que o resto do produto usa. */
function euros(cents: number): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function semTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

/** Uma data como se diz em voz alta: 3 de Setembro de 2026. */
function dia(date: Date): string {
  const meses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  return date.getDate() + " de " + meses[date.getMonth()] + " de " + date.getFullYear();
}

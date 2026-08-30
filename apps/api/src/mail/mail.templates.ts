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
  cta: { label: string; url: string };
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

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 18px;">
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
      </p>

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
function plain(heading: string, paragraphs: string[], cta: { label: string; url: string }, notes: string[]): string {
  return [heading, "", ...paragraphs, "", cta.label + ":", cta.url, "", ...notes].join("\n");
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

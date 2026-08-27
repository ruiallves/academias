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
  /** A primeira linha a seguir ao cabeçalho, em grande. */
  heading: string;
  /** Os parágrafos do corpo, já em texto simples. */
  paragraphs: string[];
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
function layout({ brand, heading, paragraphs, cta, notes }: Layout): string {
  const color = safeColor(brand.signalColor);
  // O texto por cima da cor do clube — preto num clube de amarelo, branco num de azul.
  const ink = inkOn(color);
  const mark = esc(initials(brand.shortName));
  const corpo = paragraphs
    .map(
      (p) =>
        '<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3c3a37;">' + p + "</p>",
    )
    .join("");
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
                     font-size:12px;font-weight:700;color:${ink.fg};">${mark}</td>
          <td style="padding-left:11px;font-family:Helvetica,Arial,sans-serif;font-size:15px;
                     font-weight:600;color:${ink.fg};letter-spacing:0.01em;">${esc(brand.shortName)}</td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:30px 28px 26px;font-family:Helvetica,Arial,sans-serif;">
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
    html: layout({ brand: input.brand, heading, paragraphs, cta: { label: "Aceitar o convite", url: input.link }, notes }),
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

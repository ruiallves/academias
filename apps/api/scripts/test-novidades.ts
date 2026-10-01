/**
 * As novidades da plataforma — quem recebe, e o que lá vai escrito.
 *
 * ## O que se está a proteger
 *
 * Três coisas, e a do meio é a razão de este teste existir:
 *
 * 1. **quem vem escolhido** — "os clubes que pagam" é uma regra comercial, e um
 *    engano aqui manda novidades a quem está em avaliação ou deixa de fora quem
 *    paga;
 * 2. **a pré-visualização não pode mentir.** O painel mostra as novidades como
 *    lista antes de enviar, e essa lista é construída por uma função do painel;
 *    o email é construído por outra, no servidor. São duas implementações da
 *    mesma regra, e este teste passa-lhes **o mesmo conjunto de casos** para se
 *    saber no minuto zero se discordarem;
 * 3. **quem representa o clube** — a regra passou a ser partilhada por dois
 *    caminhos com ligações diferentes (o servidor das academias e o painel), e
 *    ficou pura para poder ser exercitada sem base de dados.
 *
 * Agrupado com esbuild porque atravessa dois workspaces: o `@` aponta para o
 * painel e o servidor entra por caminho relativo.
 *
 * Uso: npm run test:novidades
 */
import { ACADEMIAS_LOGO_URL, comunicadoEmail, linhasDeNovidades, paragrafosDoComunicado, partirNovidade, releaseNotesEmail } from "../src/mail/mail.templates";
import { escolherResponsavel, type VinculoDeStaff } from "../src/subscription/responsavel";
import { ROLE_PERMISSIONS } from "../src/common/permissions";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { PreviewDto } from "../src/platform/releases.controller";
import {
  corpoDaPreview,
  escolhidosPorOmissao,
  linhasDeNovidades as linhasNoPainel,
  paragrafosDoComunicado as paragrafosNoPainel,
  type Destinatario,
} from "../../platform/src/lib/releases";

let ok = 0;
let bad = 0;
const check = (label: string, cond: unknown, detalhe = "") => {
  if (cond) {
    ok++;
    console.log("  OK    " + label);
  } else {
    bad++;
    console.log("  FALHA " + label + (detalhe ? " — " + detalhe : ""));
  }
};

/* -------------------------------------------------------------------------- */
console.log("=== 1. Uma linha, uma novidade ===");

/*
 * O formato é o do `release.txt` que já existia: uma novidade por linha, com ou
 * sem travessão à cabeça. Ninguém deve ter de reescrever o ficheiro para o
 * mandar.
 */
const CASOS: { nome: string; entrada: string; esperado: string[] }[] = [
  { nome: "uma linha simples", entrada: "Mudou isto.", esperado: ["Mudou isto."] },
  { nome: "travessão à cabeça", entrada: "- Mudou isto.", esperado: ["Mudou isto."] },
  { nome: "asterisco", entrada: "* Mudou isto.", esperado: ["Mudou isto."] },
  { nome: "bolinha", entrada: "• Mudou isto.", esperado: ["Mudou isto."] },
  { nome: "sem espaço a seguir ao travessão", entrada: "-Mudou isto.", esperado: ["Mudou isto."] },
  { nome: "espaços à volta", entrada: "   -   Mudou isto.   ", esperado: ["Mudou isto."] },
  { nome: "linhas em branco caem", entrada: "- Um\n\n\n- Dois", esperado: ["Um", "Dois"] },
  { nome: "só espaços também cai", entrada: "- Um\n   \n- Dois", esperado: ["Um", "Dois"] },
  { nome: "CRLF do Windows", entrada: "- Um\r\n- Dois", esperado: ["Um", "Dois"] },
  { nome: "texto vazio", entrada: "", esperado: [] },
  { nome: "só linhas vazias", entrada: "\n\n  \n", esperado: [] },
  { nome: "mistura de com e sem travessão", entrada: "Título da semana\n- Um\nDois", esperado: ["Título da semana", "Um", "Dois"] },
  /* Um travessão a meio da frase não é um marcador e não se toca nele. */
  { nome: "travessão a meio fica", entrada: "- Ficha do atleta - agora edita-se.", esperado: ["Ficha do atleta - agora edita-se."] },
];

for (const c of CASOS) {
  const r = linhasDeNovidades(c.entrada);
  check(`${c.nome}`, JSON.stringify(r) === JSON.stringify(c.esperado), JSON.stringify(r));
}

/* -------------------------------------------------------------------------- */
console.log("\n=== 2. A pré-visualização diz o mesmo que o email ===");

/*
 * A razão de este teste existir. O painel desenha a lista com a função dele, o
 * servidor desenha o email com a dele. No dia em que uma mudar sem a outra, o
 * que se vê antes de enviar deixa de ser o que sai — e isso descobria-se por um
 * clube a responder "não era isto que estava no email".
 */
let iguais = true;
let discordam = "";
for (const c of CASOS) {
  const a = JSON.stringify(linhasDeNovidades(c.entrada));
  const b = JSON.stringify(linhasNoPainel(c.entrada));
  if (a !== b) {
    iguais = false;
    discordam = `${c.nome}: servidor ${a} / painel ${b}`;
  }
}
check(`as duas implementações dão o mesmo nos ${CASOS.length} casos`, iguais, discordam);

/* -------------------------------------------------------------------------- */
console.log("\n=== 3. Quem representa o clube ===");

/* Os papéis-base que o teste usa, verificados contra os de verdade: sem isto, as
   fixtures podiam estar erradas e o teste passava na mesma. */
check("OWNER tem legal:club", (ROLE_PERMISSIONS.OWNER as string[]).includes("legal:club"));
check("COACH não tem legal:club", !(ROLE_PERMISSIONS.COACH as string[]).includes("legal:club"));

const vinculo = (over: Partial<VinculoDeStaff> = {}): VinculoDeStaff => ({
  title: null,
  role: "OWNER",
  customRole: null,
  user: { name: "Ana Maria Sousa", email: "ana@clube.pt" },
  ...over,
});

check("o primeiro com poderes é o escolhido", escolherResponsavel([vinculo()])?.email === "ana@clube.pt");
check(
  "um treinador não representa o clube",
  escolherResponsavel([vinculo({ role: "COACH" })]) === null,
);
check(
  "entre um treinador e um presidente, o presidente",
  escolherResponsavel([
    vinculo({ role: "COACH", user: { name: "Zé", email: "ze@clube.pt" } }),
    vinculo({ role: "OWNER", user: { name: "Ana", email: "ana@clube.pt" } }),
  ])?.email === "ana@clube.pt",
);

/*
 * Sem email não serve, por muito presidente que seja: o que se quer é alguém a
 * quem escrever. Passa ao seguinte em vez de devolver nulo.
 */
check(
  "sem email, passa ao seguinte com poderes",
  escolherResponsavel([
    vinculo({ user: { name: "Sem email", email: null } }),
    vinculo({ user: { name: "Ana", email: "ana@clube.pt" } }),
  ])?.name === "Ana",
);

/* Um cargo à medida manda sobre o papel-base, nos dois sentidos. */
check(
  "um cargo à medida com legal:club representa",
  escolherResponsavel([
    vinculo({ role: "COACH", customRole: { name: "Direção", permissions: ["legal:club"] } }),
  ])?.title === "Direção",
);
check(
  "um cargo à medida sem legal:club não representa, mesmo em cima de OWNER",
  escolherResponsavel([vinculo({ role: "OWNER", customRole: { name: "Só treinos", permissions: [] } })]) === null,
);

check("sem ninguém, é nulo", escolherResponsavel([]) === null);
check("o título cai para Presidente", escolherResponsavel([vinculo()])?.title === "Presidente");
check("e usa o título do vínculo quando existe", escolherResponsavel([vinculo({ title: "Vice" })])?.title === "Vice");

/* -------------------------------------------------------------------------- */
console.log("\n=== 4. Quem vem escolhido de início ===");

const clube = (over: Partial<Destinatario> = {}): Destinatario => ({
  id: "a1",
  name: "Clube",
  shortName: "Clube",
  slug: "clube",
  status: "ACTIVE",
  subscriptionStatus: "ACTIVE",
  trialEndsAt: null,
  responsavel: { name: "Ana", email: "ana@clube.pt", title: "Presidente" },
  jaRecebeu: false,
  ...over,
});

const daqui = (cs: Destinatario[]) => [...escolhidosPorOmissao(cs)];

check("um clube a pagar vem escolhido", daqui([clube()]).length === 1);
check(
  "um clube com pagamento falhado também — é cliente na mesma",
  daqui([clube({ subscriptionStatus: "PAST_DUE" })]).length === 1,
);
check(
  "um clube em avaliação não vem escolhido",
  daqui([clube({ subscriptionStatus: null, trialEndsAt: new Date(Date.now() + 86_400_000).toISOString() })]).length === 0,
);
check(
  "um clube por decidir também não",
  daqui([clube({ subscriptionStatus: null, trialEndsAt: null })]).length === 0,
);
check(
  "um clube cancelado não, mesmo com subscrição activa na base",
  daqui([clube({ status: "CANCELLED" })]).length === 0,
);

/*
 * As duas exclusões que não são sobre dinheiro: não há a quem escrever, e já
 * recebeu. A segunda é o que faz "enviar a mais clubes" ser seguro — reenviar
 * existe para alcançar quem faltou, não para escrever duas vezes a quem já leu.
 */
check("sem responsável, não vem escolhido", daqui([clube({ responsavel: null })]).length === 0);
check("quem já recebeu, não vem escolhido", daqui([clube({ jaRecebeu: true })]).length === 0);

const varios = [
  clube({ id: "paga" }),
  clube({ id: "avaliacao", subscriptionStatus: null, trialEndsAt: new Date(Date.now() + 86_400_000).toISOString() }),
  clube({ id: "sem-quem", responsavel: null }),
  clube({ id: "ja-leu", jaRecebeu: true }),
];
check("numa lista real, só o que paga e falta", JSON.stringify(daqui(varios)) === JSON.stringify(["paga"]), daqui(varios).join(","));

/* -------------------------------------------------------------------------- */
console.log("\n=== 5. Tema e texto ===");

/*
 * "Ficha do atleta: as equipas…" — o que vem antes dos dois pontos é o sítio da
 * plataforma, e sai em negrito. Mas só quando parece mesmo um tema: é aqui que
 * se prova que um endereço, uma hora ou uma frase comprida não são partidos.
 */
const TEMAS: { nome: string; linha: string; tema: string | null; texto: string }[] = [
  { nome: "tema e texto", linha: "Ficha do atleta: as equipas editam-se.", tema: "Ficha do atleta", texto: "as equipas editam-se." },
  { nome: "sem dois pontos", linha: "Tudo mais rápido.", tema: null, texto: "Tudo mais rápido." },
  { nome: "um endereço não parte", linha: "Vê em https://academias.pt agora", tema: null, texto: "Vê em https://academias.pt agora" },
  { nome: "uma hora não parte", linha: "Treinos às 10:30 aparecem certos", tema: null, texto: "Treinos às 10:30 aparecem certos" },
  {
    nome: "um tema comprido é uma frase, não um título",
    linha: "Quando um clube tem muitas equipas e muitos atletas ao mesmo tempo: fica mais rápido",
    tema: null,
    texto: "Quando um clube tem muitas equipas e muitos atletas ao mesmo tempo: fica mais rápido",
  },
  { nome: "dois pontos no fim não partem", linha: "Novidades: ", tema: null, texto: "Novidades: " },
  { nome: "uma letra antes não é tema", linha: "A: b", tema: null, texto: "A: b" },
  { nome: "só o primeiro par parte", linha: "Quotas: agora: mais claro", tema: "Quotas", texto: "agora: mais claro" },
];
for (const c of TEMAS) {
  const r = partirNovidade(c.linha);
  check(c.nome, r.tema === c.tema && r.texto === c.texto, JSON.stringify(r));
}

/* -------------------------------------------------------------------------- */
console.log("\n=== 6. O email ===");

const LINK = "https://admarciamirandafelgueiras.academias.pt/consola/";
const mail = releaseNotesEmail({
  name: "Ana Maria Sousa",
  clubName: "AD Márcia Miranda Felgueiras",
  version: "29/09/2026",
  title: "O que há de novo",
  notes: "- Ficha do atleta: as equipas editam-se na Visão geral.\n- Quadro tático: a cor dos jogadores é livre.\n- Tudo mais rápido.",
  link: LINK,
});

/* Quantos marcadores numerados tem a lista — é o que se vê, contado. */
const marcadores = (html: string) => (html.match(/width:22px;height:22px/g) ?? []).length;

check("o assunto leva a plataforma à frente", mail.subject === "Academias · O que há de novo", mail.subject);
check("trata a pessoa pelo primeiro nome", mail.html.includes("Olá Ana,") && mail.text.includes("Olá Ana,"));
check("diz o nome do clube", mail.html.includes("AD Márcia Miranda Felgueiras"));
check("a versão vai como etiqueta, com a contagem", mail.html.includes("Versão 29/09/2026 · 3 novidades"));
check("uma novidade, um marcador numerado", marcadores(mail.html) === 3, String(marcadores(mail.html)));
check("o tema sai em negrito, à parte", /font-weight:700;color:#1c1a18;">Ficha do atleta<\/p>/.test(mail.html));
check("uma linha sem tema não inventa um", !/>Tudo mais rápido\.<\/p>[\s\S]{0,5}font-weight:700/.test(mail.html) && mail.html.includes(">Tudo mais rápido.</p>"));
check("o texto simples numera e mantém o tema", mail.text.includes("1. Ficha do atleta: as equipas editam-se na Visão geral.") && mail.text.includes("3. Tudo mais rápido."));
check("o botão leva à consola do clube", mail.html.includes(`href="${LINK}"`));
check("e o endereço vai também por extenso", mail.text.includes(LINK));

/*
 * O logótipo. Três coisas, e cada uma é um email partido em algum cliente:
 * endereço absoluto (um relativo não carrega fora do site), largura e altura em
 * atributos (o Outlook ignora o CSS e desenhava os 128 px), e um `alt` — metade
 * dos clientes bloqueia imagens até se pedir, e o cabeçalho tem de se ler assim.
 */
const img = mail.html.match(/<img[^>]*>/)?.[0] ?? "";
check("o logótipo é o da plataforma", img.includes(`src="${ACADEMIAS_LOGO_URL}"`), img.slice(0, 80));
check("por endereço absoluto e seguro", ACADEMIAS_LOGO_URL.startsWith("https://"));
check("com largura e altura em atributos", /width="44"/.test(img) && /height="44"/.test(img), img);
check("e um alt para quando as imagens estão bloqueadas", /alt="[^"]+"/.test(img), img);
check("o nome da plataforma é texto, não só imagem", />Academias<\/p>/.test(mail.html));
check("o logótipo pode vir de outro sítio", releaseNotesEmail({ name: "A", clubName: "C", version: "1", title: "T", notes: "x", link: "h", logoUrl: "https://cdn/x.png" }).html.includes('src="https://cdn/x.png"'));

/*
 * O que se escreve no painel entra num email em HTML. Um `<script>` escrito por
 * engano — ou de propósito — não pode atravessar, nem no tema nem no texto.
 */
const comHtml = releaseNotesEmail({
  name: "Ana",
  clubName: 'Clube "do" <Norte>',
  version: "<b>1</b>",
  title: "Teste <i>x</i>",
  notes: "- <b>Tema</b>: <script>alert(1)</script>\n- <img src=x onerror=alert(1)>",
  link: "https://x.academias.pt/consola/",
});
check("o HTML das novidades sai escapado", !comHtml.html.includes("<script>") && !comHtml.html.includes("<img src=x"));
check("o do tema também", comHtml.html.includes("&lt;b&gt;Tema&lt;/b&gt;"));
check("o do nome do clube também", comHtml.html.includes("&lt;Norte&gt;") && !comHtml.html.includes("<Norte>"));
check("o da versão e do título também", comHtml.html.includes("&lt;b&gt;1&lt;/b&gt;") && comHtml.html.includes("Teste &lt;i&gt;x&lt;/i&gt;"));
check("no texto simples fica cru, que é o que se quer", comHtml.text.includes("<script>alert(1)</script>"));

/* Um corpo sem novidades nenhumas não pode abrir uma caixa vazia. */
const vazio = releaseNotesEmail({ name: "Ana", clubName: "C", version: "1", title: "T", notes: "   \n  ", link: "https://x/" });
check("sem novidades, não há marcadores", marcadores(vazio.html) === 0, String(marcadores(vazio.html)));
check("nem a caixa da lista", !vazio.html.includes("background:#faf9f7;border:1px solid #efece8;border-radius:10px"));

/* -------------------------------------------------------------------------- */
console.log("\n=== 7. O que o painel manda, a API aceita ===");

/*
 * O bug que isto guarda: a pré-visualização mandava o objecto do ecrã inteiro,
 * com um `releaseId` que o DTO não declara. A API recusa campos desconhecidos
 * (`forbidNonWhitelisted`), e o painel mostrava "o servidor ainda está a receber
 * a versão nova" — a mensagem certa para um deploy desencontrado, a errada para
 * isto. Numa versão nova o campo era `undefined` e sumia no JSON, por isso só
 * falhava ao pré-visualizar uma versão já gravada.
 *
 * Aqui valida-se o corpo **que o painel constrói** com as regras **da API**, as
 * mesmas do `ValidationPipe`. É o contrato entre os dois, e é o que nenhum dos
 * dois lados via sozinho.
 */
const pipe = { whitelist: true, forbidNonWhitelisted: true } as const;
const errosDe = (body: unknown) =>
  validateSync(plainToInstance(PreviewDto, JSON.parse(JSON.stringify(body))) as object, pipe)
    .map((e) => e.property + ": " + Object.values(e.constraints ?? {}).join(", "));

/* O objecto que o ecrã tem na mão quando abre a pré-visualização de uma versão gravada. */
const doEcra = { version: "29/09/2026", title: "O que há de novo", notes: "- Um\n- Dois", releaseId: "rel_123" };

check("a API recusaria o objecto do ecrã tal e qual", errosDe(doEcra).some((e) => e.startsWith("releaseId")), errosDe(doEcra).join(" | "));
check("o corpo do painel passa, sem clube", errosDe(corpoDaPreview(doEcra)).length === 0, errosDe(corpoDaPreview(doEcra)).join(" | "));
check("e com clube", errosDe(corpoDaPreview(doEcra, "academia_1")).length === 0, errosDe(corpoDaPreview(doEcra, "academia_1")).join(" | "));
check("não leva o releaseId", !("releaseId" in corpoDaPreview(doEcra)));
check("sem clube, não leva academyId vazio", !("academyId" in corpoDaPreview(doEcra, undefined)));
/* Um rascunho ainda por escrever também se pré-visualiza. */
check("um texto ainda vazio passa", errosDe(corpoDaPreview({ version: "", title: "", notes: "" })).length === 0);

/* -------------------------------------------------------------------------- */
console.log("");
console.log("=== 8. A mensagem: um comunicado livre ===");

/*
 * As Novidades passaram a Comunicados: além de uma versão, manda-se aos clubes
 * uma mensagem com assunto e texto. O que se guarda aqui é o mesmo de sempre:
 * a pré-visualização do painel e o email do servidor partem o texto da mesma
 * maneira, e o corpo que o painel manda é o que a API aceita.
 */
const TEXTOS: { nome: string; entrada: string; esperado: string[] }[] = [
  { nome: "um parágrafo", entrada: "Olá a todos.", esperado: ["Olá a todos."] },
  { nome: "linha em branco separa", entrada: "Um.\n\nDois.", esperado: ["Um.", "Dois."] },
  { nome: "várias linhas em branco contam como uma", entrada: "Um.\n\n\n\nDois.", esperado: ["Um.", "Dois."] },
  { nome: "a quebra simples fica dentro do parágrafo", entrada: "Rua A\nPorto\n\nAté já.", esperado: ["Rua A\nPorto", "Até já."] },
  { nome: "quebras do Windows", entrada: "Um.\r\n\r\nDois.", esperado: ["Um.", "Dois."] },
  { nome: "espaços à volta saem", entrada: "  Um.  \n   \n  Dois.  ", esperado: ["Um.", "Dois."] },
  { nome: "só espaços não é texto", entrada: "  \n \n", esperado: [] },
];
for (const c of TEXTOS) {
  const servidor = paragrafosDoComunicado(c.entrada);
  const painel = paragrafosNoPainel(c.entrada);
  check(`${c.nome}: o servidor parte como esperado`, JSON.stringify(servidor) === JSON.stringify(c.esperado), JSON.stringify(servidor));
  check(`${c.nome}: o painel concorda com o servidor`, JSON.stringify(painel) === JSON.stringify(servidor), JSON.stringify(painel));
}

const carta = comunicadoEmail({
  name: "Ana Sousa",
  clubName: "Clube <de> Teste",
  title: "Manutenção no sábado",
  notes: "A plataforma pára entre as 7h e as 9h.\nNão é preciso fazer nada.\n\nObrigado & até já.",
  link: "https://exemplo.academias.pt/consola/",
});
check("o assunto leva o título", carta.subject === "Academias · Manutenção no sábado", carta.subject);
check("trata quem recebe pelo primeiro nome", carta.html.includes("Olá Ana,") && carta.text.includes("Olá Ana,"));
check("dois parágrafos, e a quebra simples vira <br>", (carta.html.match(/line-height:1\.65;color:#2d2b28/g) ?? []).length === 2 && carta.html.includes("7h e as 9h.<br />Não é preciso"));
check("o texto é escapado", carta.html.includes("Obrigado &amp; até já.") && carta.html.includes("Clube &lt;de&gt; Teste") && !carta.html.includes("<de>"));
check("diz COMUNICADO, e não fala de versões", carta.html.includes("COMUNICADO") && !/Vers[aã]o/.test(carta.html) && !/novidade/i.test(carta.html));
check("leva o caminho para a consola", carta.html.includes("https://exemplo.academias.pt/consola/") && carta.text.includes("https://exemplo.academias.pt/consola/"));
check("o texto simples tem os dois parágrafos", carta.text.includes("Não é preciso fazer nada.\n\nObrigado & até já."));

/* Uma mensagem não vem com ninguém escolhido; as novidades continuam com os que pagam. */
const pagante = clube({ id: "paga", subscriptionStatus: "ACTIVE" });
check("as novidades escolhem quem paga", escolhidosPorOmissao([pagante]).has("paga") && escolhidosPorOmissao([pagante], "NOVIDADES").has("paga"));
check("uma mensagem não escolhe ninguém", escolhidosPorOmissao([pagante], "MENSAGEM").size === 0);

const mensagemDoEcra = { kind: "MENSAGEM" as const, version: "", title: "Manutenção", notes: "Texto.", releaseId: "rel_9" };
check("o corpo de uma mensagem passa na API", errosDe(corpoDaPreview(mensagemDoEcra)).length === 0, errosDe(corpoDaPreview(mensagemDoEcra)).join(" | "));
check("e leva o tipo", corpoDaPreview(mensagemDoEcra).kind === "MENSAGEM");
check("um tipo inventado é recusado", errosDe({ ...corpoDaPreview(mensagemDoEcra), kind: "OUTRA" }).some((e) => e.startsWith("kind")));
check("as novidades continuam a não mandar o tipo quando o ecrã não o tem", !("kind" in corpoDaPreview(doEcra)));

console.log("");
console.log(`${bad === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${ok} ok, ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

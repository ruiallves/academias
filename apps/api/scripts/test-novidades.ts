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
import { linhasDeNovidades, releaseNotesEmail } from "../src/mail/mail.templates";
import { escolherResponsavel, type VinculoDeStaff } from "../src/subscription/responsavel";
import { ROLE_PERMISSIONS } from "../src/common/permissions";
import {
  escolhidosPorOmissao,
  linhasDeNovidades as linhasNoPainel,
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
console.log("\n=== 5. O email ===");

const mail = releaseNotesEmail({
  name: "Ana Maria Sousa",
  clubName: "AD Márcia Miranda Felgueiras",
  version: "29/09/2026",
  title: "O que há de novo",
  notes: "- Ficha do atleta: as equipas editam-se na Visão geral.\n- Quadro tático: a cor dos jogadores é livre.",
  link: "https://admarciamirandafelgueiras.academias.pt/consola/",
});

check("o assunto leva a plataforma à frente", mail.subject === "Academias · O que há de novo", mail.subject);
check("trata a pessoa pelo primeiro nome", mail.text.startsWith("Olá Ana,"), mail.text.slice(0, 30));
check("diz o nome do clube", mail.html.includes("AD Márcia Miranda Felgueiras"));
check("as novidades vão como lista no HTML", (mail.html.match(/<li/g) ?? []).length === 2);
check("e como travessões no texto simples", mail.text.includes("- Quadro tático: a cor dos jogadores é livre."));
check("o botão leva à consola do clube", mail.html.includes("https://admarciamirandafelgueiras.academias.pt/consola/"));

/*
 * O que se escreve no painel entra num email em HTML. Um `<script>` escrito por
 * engano — ou de propósito — não pode atravessar.
 */
const comHtml = releaseNotesEmail({
  name: "Ana",
  clubName: 'Clube "do" <Norte>',
  version: "1",
  title: "Teste",
  notes: "- <script>alert(1)</script> e <b>negrito</b>",
  link: "https://x.academias.pt/consola/",
});
check("o HTML das novidades sai escapado", !comHtml.html.includes("<script>"), comHtml.html.match(/.{0,40}script.{0,20}/)?.[0] ?? "");
check("e o do nome do clube também", comHtml.html.includes("&lt;Norte&gt;") && !comHtml.html.includes("<Norte>"));
check("no texto simples fica cru, que é o que se quer", comHtml.text.includes("<script>alert(1)</script>"));

/* Um corpo sem novidades nenhumas não pode abrir uma lista vazia. */
const vazio = releaseNotesEmail({ name: "Ana", clubName: "C", version: "1", title: "T", notes: "   \n  ", link: "https://x/" });
check("sem novidades, não há lista", !vazio.html.includes("<ul"), vazio.html.match(/<ul[^>]*>.{0,40}/)?.[0] ?? "");

console.log("");
console.log(`${bad === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${ok} ok, ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

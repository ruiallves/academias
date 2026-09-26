/**
 * O email que substitui o convite — "tens uma área nova na app".
 *
 * ## O que se está a proteger
 *
 * Este email existe porque o convite deixou de sair a quem já tem conta. Se ele
 * disser a coisa errada, a pessoa fica pior do que antes: o convite ao menos
 * tinha um botão. As três coisas que não podem falhar são
 *
 * 1. **não pede palavra-passe nova** — era exactamente o engano do convite, que
 *    pedia a quem já tinha conta que "escolhesse" uma;
 * 2. **não leva token** — não é um convite, é uma notícia, e um token neste email
 *    seria um link de resgate a viajar por correio sem precisar de o fazer;
 * 3. **diz de que área se trata** — sócio, atleta e família prometem coisas
 *    diferentes, e um texto genérico ("tens acesso à app") não diria nada a quem
 *    já entrava na app por outra porta.
 *
 * Corre a função verdadeira, agrupada com esbuild como os testes da consola,
 * porque `mail.templates.ts` importa por caminho sem extensão e o
 * `--experimental-strip-types` não o resolve.
 *
 * Uso: npm run test:aviso-area
 */
import { areaAbertaEmail } from "../src/mail/mail.templates";

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

const brand = { shortName: "AD Márcia", name: "AD Márcia Felgueiras", signalColor: "#1f6feb", logoUrl: null };
const LINK = "https://ad-marcia.academias.pt/app/";
const fazer = (area: "member" | "athlete" | "family") =>
  areaAbertaEmail({ brand, name: "Ana Maria Sousa", area, link: LINK });

const areas = ["member", "athlete", "family"] as const;

/* ------------------------------------------------------------------ 1 ---- */
console.log("=== 1. Não é um convite ===");

for (const area of areas) {
  const m = fazer(area);

  /*
   * O botão é o teste mais honesto de "isto não é um convite": os convites
   * levam "Criar a minha conta" ou "Aceitar o convite", e a pessoa que já tem
   * conta a quem se mostra um botão "Criar a minha conta" faz uma de duas coisas
   * — ignora, ou tenta e falha.
   */
  /* O rótulo vem indentado dentro do `<a>`, por isso lê-se o conteúdo da âncora. */
  const botao = /<a\s[^>]*>([\s\S]*?)<\/a>/.exec(m.html)?.[1]?.trim();
  check(`${area}: o botão é "Abrir a app"`, botao === "Abrir a app", String(botao));
  check(
    `${area}: nenhum botão de convite`,
    !/Criar a minha conta|Aceitar o convite/i.test(m.html + m.text),
    "",
  );

  /*
   * As palavras "criar conta" e "palavra-passe" **podem** aparecer, e aparecem:
   * a frase que faltava ao convite é precisamente dizer que nada disso é
   * preciso. O que se exige é que nunca apareçam fora de uma negação — se
   * alguém reescrever o texto e deixar cair o "Não precisas", isto cai.
   */
  for (const fonte of [m.html, m.text]) {
    const frases = fonte.split(/(?<=[.!?])\s+|<\/p>|<br\s*\/?>/i);
    const suspeitas = frases.filter((f) => /palavra-passe|criar (a |uma )?(tua )?conta/i.test(f));
    check(
      `${area}: fala de palavra-passe só para dizer que não é precisa`,
      suspeitas.length > 0 && suspeitas.every((f) => /Não precisas/i.test(f)),
      suspeitas.join(" ¦ ").slice(0, 160),
    );
  }

  /* E diz o que fazer em vez disso, que é a informação que falta. */
  check(`${area}: diz para entrar com a conta que já tem`, /conta que já tens/i.test(m.html) && /conta que já tens/i.test(m.text));
}

/* ------------------------------------------------------------------ 2 ---- */
console.log("\n=== 2. Nenhum token viaja neste email ===");

for (const area of areas) {
  const m = fazer(area);
  const urls = [...(m.html + " " + m.text).matchAll(/https?:\/\/[^\s"'<>]+/g)].map((u) => u[0]);
  check(`${area}: há um caminho para a app`, urls.some((u) => u.startsWith(LINK)), urls.join(" | "));
  /*
   * Os links de convite são `/socio/<token>`, `/atleta/<token>`, `/familia/<token>`.
   * Nenhum deles pode aparecer aqui: o link é a raiz da app e mais nada.
   */
  check(
    `${area}: nenhum link de resgate`,
    !urls.some((u) => /\/(socio|atleta|familia)\/[A-Za-z0-9_-]{16,}/.test(u)),
    urls.join(" | "),
  );
  check(`${area}: só links para este clube`, urls.every((u) => u.startsWith("https://ad-marcia.academias.pt")), urls.join(" | "));
}

/* ------------------------------------------------------------------ 3 ---- */
console.log("\n=== 3. Cada área promete o que é dela ===");

const m = { member: fazer("member"), athlete: fazer("athlete"), family: fazer("family") };

check("sócio fala em quotas", /quotas/i.test(m.member.text), m.member.text);
check("sócio fala no cartão", /cartão/i.test(m.member.text));
check("atleta fala em treinos e convocatórias", /treinos/i.test(m.athlete.text) && /convocatórias/i.test(m.athlete.text));
check("atleta não fala em quotas (são da família)", !/quotas/i.test(m.athlete.text), m.athlete.text);
check("família fala em educandos", /educandos/i.test(m.family.text), m.family.text);
check("família não fala no cartão de sócio", !/cartão/i.test(m.family.text));

/* Os três assuntos têm de ser distinguíveis na caixa de entrada. */
const assuntos = new Set(areas.map((a) => fazer(a).subject));
check("três assuntos diferentes", assuntos.size === 3, [...assuntos].join(" | "));
check(
  "e todos começam pelo nome curto do clube",
  [...assuntos].every((a) => a.startsWith("AD Márcia")),
  [...assuntos].join(" | "),
);

/* ------------------------------------------------------------------ 4 ---- */
console.log("\n=== 4. O nome e a fuga por HTML ===");

const comAspas = areaAbertaEmail({
  brand: { ...brand, name: 'Clube "do" <Norte> & Sul' },
  name: "Ana Maria Sousa",
  area: "member",
  link: LINK,
});
check("trata a pessoa pelo primeiro nome", comAspas.text.includes("Olá Ana,"), comAspas.text.slice(0, 40));
check(
  "o nome do clube sai escapado no HTML",
  comAspas.html.includes("&lt;Norte&gt;") && !comAspas.html.includes("<Norte>"),
  comAspas.html.match(/.{0,30}Norte.{0,30}/)?.[0] ?? "",
);
check("e cru no texto simples", comAspas.text.includes("<Norte>"));

console.log("");
console.log(`${bad === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${ok} ok, ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);

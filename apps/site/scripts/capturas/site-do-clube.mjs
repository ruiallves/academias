// Capturas do site do clube de demonstração (AD Monte Verde), para as páginas
// do academias.pt (as `site-*` em public/shots) e para o carrossel do Connect Pro.
//
//   1. Em apps/clube-site: `npx next dev -p 5191` (o .env.local põe SITE_FONTE=demo).
//   2. node apps/site/scripts/capturas/site-do-clube.mjs [nome...]   (sem nomes: todas)
//      Saem em PNG na pasta de trabalho (CAPTURAS_TRABALHO/site-do-clube).
//   3. Converter para WebP com o nome `site-…` (e `site-tel-…` no telemóvel), a
//      inteira e a metade da largura (`-m`), como as outras capturas.
//
// Ver LEIA-ME.md ao lado: o que este guião muda na página, só na captura.
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { tmpdir } from "node:os";
const TRABALHO = process.env.CAPTURAS_TRABALHO ?? path.join(tmpdir(), "claude", "capturas-consola");
const require = createRequire(path.join(TRABALHO, "package.json"));
const { chromium } = require("playwright-core");

const OUT = path.join(TRABALHO, "site-do-clube");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5191";
const PADRAO = "C:/Users/ruist/Desktop/club-man/academia-pro/apps/clube-site/public/padrao";

// As fotos do picsum trocadas pelas fotos de omissão do site (sem caras nem marcas).
const FOTOS = {
  estadio: "bancada", campo2: "futebol-2", pavilhao: "futsal",
  seniores: "futebol", sub19: "futebol-2", sub15: "futebol-3", sub11: "futebol", futsalfem: "futsal-2", basquete: "basquetebol",
  noticia1: "futebol", noticia2: "bancada", noticia3: "futsal-3", noticia4: "futebol-3",
  noticia5: "futebol-2", noticia6: "generico", noticia7: "futsal", noticia8: "basquetebol-2",
};

// Os produtos: fotografias do Pexels (licença livre, sem marcas), ver capturas/fotos-loja/FONTES.md.
const FOTOS_LOJA = "C:/Users/ruist/Desktop/club-man/instagram/carrossel-11-connect-pro/capturas/fotos-loja";
const LOJA = {
  camisola: "t-shirt-verde", alternativa: "t-shirt-branca", cachecol: "cachecol", sweat: "sweats",
  bone: "bone", casaco: "rack", garrafa: "bola", calcoes: "t-shirt-branca-2",
};

// A cor do clube no post: verde-floresta, para combinar com o verde da série
// em vez do azul da demo. As variáveis são as de `signalVars("#1b6e4b")`
// (packages/ui/src/tokens.ts), por cima das que o site escreve no contentor.
const COR_DO_CLUBE = {
  "--color-signal": "#1b6e4b", "--color-signal-ink": "#134f36", "--color-signal-soft": "#edf3f1",
  "--color-signal-strong": "#1b6e4b", "--color-signal-line": "#1b6e4b", "--color-signal-on": "#ffffff",
  "--signal-on-rgb": "255 255 255", "--signal-lift": "#367f61", "--signal-deep": "#134f36",
};
const CSS_COR = `:root, [style*="--color-signal"]{${Object.entries(COR_DO_CLUBE).map(([k, v]) => `${k}:${v}!important`).join(";")}}`;

const CSS = `${CSS_COR}
  [role="group"][aria-label="Layout do site"]{display:none!important}
  nextjs-portal, [data-nextjs-toast], #__next-build-watcher{display:none!important}
  *{scrollbar-width:none!important}
`;

const CENAS = {
  "pc-inicio": { url: "/", w: 1440, h: 900, dpr: 2 },
  "pc-inicio-longo": { url: "/", w: 1440, h: 2400, dpr: 1.5 },
  "pc-porto": { url: "/", w: 1440, h: 900, dpr: 2, layout: "holofote" },
  "pc-noticias": { url: "/noticias", w: 1440, h: 900, dpr: 2 },
  "pc-noticia": { url: "/noticias/vitoria-por-3-0-frente-ao-merelinense", w: 1440, h: 900, dpr: 2 },
  "pc-loja": { url: "/loja", w: 1440, h: 900, dpr: 2 },
  "pc-produto": { url: "/loja/camisola-principal-2026-27", w: 1440, h: 900, dpr: 2 },
  "pc-bilheteira": { url: "/bilheteira", w: 1440, h: 900, dpr: 2 },
  "pc-bilhete": { url: "/bilheteira/j6", w: 1440, h: 900, dpr: 2 },
  "pc-calendario": { url: "/calendario", w: 1440, h: 900, dpr: 2 },
  "pc-equipa": { url: "/equipas/seniores", w: 1440, h: 900, dpr: 2 },
  "pc-clube": { url: "/clube", w: 1440, h: 900, dpr: 2 },
  "tel-inicio": { url: "/", w: 390, h: 844, dpr: 3 },
  "tel-loja": { url: "/loja", w: 390, h: 844, dpr: 3 },
  "tel-produto": { url: "/loja/camisola-principal-2026-27", w: 390, h: 844, dpr: 3 },
  "tel-bilhete": { url: "/bilheteira/j6", w: 390, h: 844, dpr: 3 },
  "tel-noticia": { url: "/noticias/vitoria-por-3-0-frente-ao-merelinense", w: 390, h: 844, dpr: 3 },
  "tel-porto": { url: "/", w: 390, h: 844, dpr: 3, layout: "holofote" },
  "tel-calendario": { url: "/calendario", w: 390, h: 844, dpr: 3 },
  "pc-socio": { url: "/ser-socio", w: 1440, h: 900, dpr: 2 },
  "tel-socio": { url: "/ser-socio", w: 390, h: 844, dpr: 3 },
  "tel-socio-cat": { url: "/ser-socio", w: 390, h: 844, dpr: 3, clicarBotao: "Começar" },
  "pc-socio-cat": { url: "/ser-socio", w: 1440, h: 900, dpr: 2, clicarBotao: "Começar" },
  "pc-estadio": { url: "/bilheteira/j6", w: 1440, h: 900, dpr: 2, rolar: "Bilhetes", folga: 130 },
  "tel-equipa": { url: "/equipas/seniores", w: 390, h: 844, dpr: 3 },
  "tel-jogos": { url: "/", w: 390, h: 844, dpr: 3, rolar: "Próximo jogo" },
  // Recortes: o elemento que contém o texto, subindo até ter o tamanho pedido.
  "el-jogos": { url: "/", w: 1440, h: 900, dpr: 3, el: { texto: "Próximo jogo", minW: 1100 } },
  "el-equipas": { url: "/", w: 1440, h: 900, dpr: 3, el: { texto: "O clube em campo", minW: 1100, minH: 300, pad: 28 } },
  "el-noticias": { url: "/", w: 1440, h: 900, dpr: 3, el: { texto: "Últimas", minW: 1100, minH: 300, pad: 28 } },
  "el-estadio": { url: "/bilheteira/j6", w: 1440, h: 1400, dpr: 3, el: { texto: "Topo Norte", minW: 700, minH: 500 } },
  "el-estadio-central": { url: "/bilheteira/j6", w: 1440, h: 1400, dpr: 3, clicar: "Central", el: { texto: "Topo Norte", minW: 700, minH: 500 } },
  "tel-bilhete-qr": { url: "/bilhete/exemplo", w: 390, h: 844, dpr: 3, rolar: "Bilhete 1 de 2", folga: 200 },
  "pc-plantel": { url: "/equipas/seniores", w: 1440, h: 900, dpr: 2, rolar: "Plantel", folga: 40 },
  "pc-estadio-central": { url: "/bilheteira/j6", w: 1440, h: 900, dpr: 2, clicar: "Central", rolar: "Bilhetes", folga: 130 },
  "tel-loja-2": { url: "/loja", w: 390, h: 844, dpr: 3, rolar: "Tudo" },
  "tel-estadio": { url: "/bilheteira/j6", w: 390, h: 844, dpr: 3, rolar: "Bilhetes" },
};

const pedidas = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium_headless_shell-1234", "chrome-headless-shell-win64", "chrome-headless-shell.exe") });

for (const [nome, c] of Object.entries(CENAS)) {
  if (pedidas.length && !pedidas.includes(nome)) continue;
  const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: c.dpr, reducedMotion: "reduce", locale: "pt-PT", timezoneId: "Europe/Lisbon" });
  await ctx.addCookies([{ name: "site-layout", value: c.layout ?? "tribuna", url: BASE }]);
  await ctx.route(/\/_next\/image\?url=.*picsum/, async (route) => {
    const u = decodeURIComponent(new URL(route.request().url()).searchParams.get("url") ?? "");
    const seed = /seed\/([^/]+)/.exec(u)?.[1] ?? "";
    if (LOJA[seed]) return route.fulfill({ status: 200, contentType: "image/jpeg", body: readFileSync(`${FOTOS_LOJA}/${LOJA[seed]}.jpg`) });
    const f = FOTOS[seed] ?? "generico";
    return route.fulfill({ status: 200, contentType: "image/jpeg", body: readFileSync(`${PADRAO}/${f}.jpg`) });
  });
  const page = await ctx.newPage();
  await page.goto(BASE + c.url, { waitUntil: "networkidle", timeout: 60000 });
  await page.addStyleTag({ content: CSS });
  // Imagens lazy: descer e voltar, para todas carregarem.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
    document.querySelectorAll(".revelar, [data-revelar]").forEach((e) => e.classList.add("visivel"));
  });
  await page.waitForLoadState("networkidle");
  // Os adversários da demo são clubes reais com resultados inventados: num post
  // público trocam-se por nomes que não existem.
  await page.evaluate(() => {
    const trocas = [
      [/dérbi com o Vitória B/g, "dérbi com o Desportivo B"],
      [/perdem com o Vitória/g, "perdem com o Desportivo"],
      [/Vitória SC B/g, "Desportivo B"],
      [/Vitória SC/g, "Desportivo"],
      [/Merelinense FC/g, "FC Ribeira"],
      [/Merelinense/g, "Ribeira"],
      [/SC Vianense/g, "SC Lameiras"],
      [/CS Marítimo/g, "CD Ponte Nova"],
      [/o Marítimo/g, "o Ponte Nova"],
      [/Empate em Fafe/g, "Empate em Vila Seca"],
      [/Estádio Municipal de Fafe/g, "Estádio de Vila Seca"],
      [/AD Fafe/g, "GD Vila Seca"],
      [/FC Famalicão/g, "FC Pedra Alta"],
      [/GD Taipas|CD Taipas/g, "CD Vale do Este"],
      [/Pavilhão de Caldas das Taipas/g, "Pavilhão do Vale do Este"],
      [/Estádio do Sport Clube de Braga B/g, "Estádio da Serra"],
      [/SC Braga B/g, "SC Serra B"],
      // A loja mostra fotografias de t-shirts, e não de camisolas de jogo.
      [/Camisola principal 2026\/27/g, "T-shirt de treino 2026/27"],
      [/Camisola alternativa 2026\/27/g, "T-shirt branca 2026/27"],
      [/A camisola de jogo desta época\..*$/g, "A t-shirt de treino desta época, em algodão. Corte regular."],
    ];
    const exatas = { SV: "SL", CM: "PN" };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      let t = n.nodeValue;
      if (exatas[t.trim()]) { n.nodeValue = t.replace(t.trim(), exatas[t.trim()]); continue; }
      for (const [re, s] of trocas) t = t.replace(re, s);
      if (t !== n.nodeValue) n.nodeValue = t;
    }
  });
  await page.waitForTimeout(700);
  if (c.clicar) {
    await page.getByText(c.clicar, { exact: true }).first().click();
    await page.waitForTimeout(500);
  }
  if (c.clicarBotao) {
    await page.getByRole("button", { name: new RegExp(`^${c.clicarBotao}`) }).first().click();
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  if (c.esconder) {
    // O cartão "Como funciona" promete pagamento e QR, que ainda não existem.
    await page.evaluate((texto) => {
      let e = [...document.querySelectorAll("body *")].find((x) => x.children.length === 0 && x.textContent.trim() === texto);
      while (e && e.getBoundingClientRect().height < 150) e = e.parentElement;
      if (e) e.style.visibility = "hidden";
    }, c.esconder);
  }
  if (c.rolar) {
    await page.getByText(c.rolar, { exact: true }).first().evaluate((e, folga) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - folga), c.folga ?? 24);
    await page.waitForTimeout(400);
  }
  if (c.el) {
    const caixa = await page.evaluate(({ texto, minW = 0, minH = 0, pad = 0 }) => {
      const alvo = [...document.querySelectorAll("body *")].find((e) => e.children.length === 0 && e.textContent.trim().toLowerCase() === texto.toLowerCase());
      let e = alvo;
      while (e && (e.getBoundingClientRect().width < minW || e.getBoundingClientRect().height < minH)) e = e.parentElement;
      e.scrollIntoView({ block: "center" });
      const r = e.getBoundingClientRect();
      return { x: r.x + window.scrollX - pad, y: r.y + window.scrollY - pad, width: r.width + 2 * pad, height: r.height + 2 * pad };
    }, c.el);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${nome}.png`), fullPage: true, clip: caixa });
  } else {
    await page.screenshot({ path: path.join(OUT, `${nome}.png`) });
  }
  console.log("ok", nome);
  await ctx.close();
}
await browser.close();

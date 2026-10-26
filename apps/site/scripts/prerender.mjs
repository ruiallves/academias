/**
 * Escreve cada página do site em HTML, com o texto todo e as etiquetas certas.
 *
 * Corre no fim do build, depois de `vite build` (o site) e de
 * `vite build --ssr` (o mesmo site, para correr em Node). Para cada página de
 * `src/lib/seo.ts`:
 *
 *   - desenha o React em HTML e mete-o dentro de `<div id="root">`;
 *   - escreve o título, a descrição, o canónico, as etiquetas de partilha e os
 *     dados estruturados entre `<!--seo-->` e `<!--/seo-->`.
 *
 * E no fim o `404.html`, o `sitemap.xml` e o `robots.txt`.
 *
 * `/produto` fica em `dist/produto.html`; o Vercel serve-o em `/produto` por
 * causa do `cleanUrls` do `vercel.json`.
 */
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(raiz, "dist");
const ssr = join(raiz, "dist-ssr");

const { render, PAGINAS, PAGINA_404, SITE_URL, dadosEstruturados } = await import(
  pathToFileURL(join(ssr, "entry-server.js")).href
);

const modelo = await readFile(join(dist, "index.html"), "utf8");
if (!modelo.includes("<!--seo-->") || !modelo.includes('<div id="root"></div>')) {
  throw new Error("index.html sem os marcadores <!--seo--> ou sem <div id=\"root\"></div>.");
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A imagem de partilha (public/partilha.jpg, 1200×630), a que aparece quando
// alguém envia o link no WhatsApp, no LinkedIn ou no Facebook.
if (!existsSync(join(dist, "partilha.jpg"))) throw new Error("Falta public/partilha.jpg.");
const imagem = `${SITE_URL}/partilha.jpg`;

function cabeca(p, { canonico = true } = {}) {
  const url = SITE_URL + (p.path === "/" ? "/" : p.path);
  const json = dadosEstruturados(p.path);
  return [
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}" />`,
    p.privada ? `<meta name="robots" content="noindex, follow" />` : `<meta name="robots" content="index, follow, max-image-preview:large" />`,
    canonico ? `<link rel="canonical" href="${url}" />` : "",
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Academias" />`,
    `<meta property="og:locale" content="pt_PT" />`,
    `<meta property="og:title" content="${esc(p.title)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    canonico ? `<meta property="og:url" content="${url}" />` : "",
    `<meta property="og:image" content="${imagem}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="A consola e a app da Academias, software de gestão de clubes desportivos" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    json ? `<script type="application/ld+json">${JSON.stringify(json).replace(/</g, "\\u003c")}</script>` : "",
  ]
    .filter(Boolean)
    .join("\n    ");
}

function pagina(p, url, opcoes) {
  const corpo = render(url);
  return modelo
    .replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, cabeca(p, opcoes))
    .replace('<div id="root"></div>', `<div id="root">${corpo}</div>`);
}

const ficheiro = (path) => (path === "/" ? "index.html" : `${path.slice(1)}.html`);

for (const p of PAGINAS) {
  // Os documentos legais abrem todos a partir da mesma página (vercel.json), e
  // cada um tem o seu endereço: o canónico fixo apontaria todos para /legal.
  const opcoes = p.path === "/legal" ? { canonico: false } : {};
  await writeFile(join(dist, ficheiro(p.path)), pagina(p, p.path, opcoes));
  console.log(`  ${p.path.padEnd(12)} → dist/${ficheiro(p.path)}`);
}

await writeFile(join(dist, "404.html"), pagina(PAGINA_404, "/404", { canonico: false }));
console.log(`  404          → dist/404.html`);

const hoje = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGINAS.filter((p) => !p.privada)
  .map(
    (p) => `  <url>
    <loc>${SITE_URL}${p.path === "/" ? "/" : p.path}</loc>
    <lastmod>${hoje}</lastmod>
    <priority>${(p.prioridade ?? 0.5).toFixed(1)}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;
await writeFile(join(dist, "sitemap.xml"), sitemap);

await writeFile(
  join(dist, "robots.txt"),
  `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`,
);
console.log("  sitemap.xml e robots.txt");

await rm(ssr, { recursive: true, force: true });

#!/usr/bin/env node
/**
 * O diretório dos clubes federados de Portugal, com o emblema de cada um.
 *
 * Lê as fontes oficiais, trata cada emblema e guarda tudo no bucket público
 * `emblemas` e na tabela `KnownClub` (ver `prisma/schema.prisma`).
 *
 * ## As fontes
 *
 *   - **FPF** (futebol, futsal, futebol de praia): o diretório de clubes do
 *     site, `fpf.pt/pt/Clubes`, que é uma página Angular sobre a API
 *     `/DesktopModules/MVC/SearchClubs/Default/GetClubs` (precisa dos
 *     cabeçalhos ModuleId e TabId da página). Dá o nome, a associação e o
 *     emblema (`imagehandler.fpf.pt`, pequeno: ~100 px). A modalidade vem de
 *     pedir a lista filtrada por cada tipo (futebol, futsal, praia).
 *   - **FPB** (basquetebol): `fpb.pt/clubes/`, uma página com todos os clubes
 *     (as páginas por associação rebentam a meio em quatro associações). Dá o
 *     nome, o nome curto, o pavilhão, a associação e o emblema (`sav2.fpb.pt`).
 *
 * Os pedidos vão pelo `curl` com User-Agent de browser: o `fetch` do Node leva
 * "Your request was blocked" do WAF da FPF.
 *
 * ## O emblema e o egress
 *
 * Cada emblema é tratado com o `sharp` em duas medidas (256 e 64 px, WebP, sem
 * ampliar) e guardado com o original em `emblemas/<id>/<versao>/`. Sobe com
 * `cache-control: max-age=31536000`: o endereço é fixo e o browser guarda-o um
 * ano, por isso o mesmo emblema não volta a sair do Supabase. Um emblema que
 * muda na fonte (hash diferente) ganha uma versão nova, e com ela um endereço
 * novo. Um emblema igual ao que já cá está não se trata nem sobe.
 *
 * Uso:
 *   node scripts/emblemas-importar.mjs                 tudo (FPF + FPB)
 *   node scripts/emblemas-importar.mjs --so fpb        só uma fonte
 *   node scripts/emblemas-importar.mjs --limite 20     só os primeiros N de cada fonte (ensaio)
 *   node scripts/emblemas-importar.mjs --sem-imagens   só a tabela, sem tocar no bucket
 *   node scripts/emblemas-importar.mjs --de-cache      reutiliza as listas descarregadas na última hora
 *   node scripts/emblemas-importar.mjs --forcar        volta a comparar os emblemas tratados nas últimas 24 h
 *
 * Aguenta a ligação à base cair a meio (o Supabase corta ligações longas;
 * aconteceu ao clube 6.389 de 6.563 na primeira importação): liga outra vez e
 * continua. Repetir uma importação é barato: um emblema tratado há menos de
 * 24 h salta-se sem o descarregar, um igual ao que cá está não sobe.
 *
 * Escreve com `MIGRATE_DATABASE_URL` (a tabela é da plataforma: `academia_app`
 * só lê) e no Storage com a chave de serviço. Lê o `.env` da API.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");
require("dotenv").config({ path: path.join(RAIZ, ".env"), quiet: true });
const { Client } = require("pg");
const sharp = require("sharp");

const args = process.argv.slice(2);
const opcao = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : null; };
const SO = opcao("--so");
const LIMITE = Number(opcao("--limite") ?? 0) || 0;
const SEM_IMAGENS = args.includes("--sem-imagens");
const DE_CACHE = args.includes("--de-cache");
/** Voltar a descarregar e comparar os emblemas tratados nas últimas 24 h (por omissão saltam-se). */
const FORCAR = args.includes("--forcar");

const BUCKET = "emblemas";
/** O limite por ficheiro do bucket. */
const LIMITE_FICHEIRO = 1024 * 1024;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36";
const CACHE = path.join(RAIZ, "node_modules", ".cache", "emblemas");
mkdirSync(CACHE, { recursive: true });

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DB_URL = (process.env.MIGRATE_DATABASE_URL ?? "").replace(/[?&]pgbouncer=true/, "");
if (!SUPABASE_URL || !SERVICE_KEY || !DB_URL) throw new Error("Faltam SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou MIGRATE_DATABASE_URL no .env da API");

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sem acentos, minúsculas, sem pontuação, com as siglas com pontos juntas
 * ("Rio Ave F.C." → "rio ave fc", "C. D. Cucujães" → "cd cucujaes"). A mesma
 * regra de `nomeNormalizado` em `src/clubes/diretorio.service.ts`: é por aqui
 * que a consola procura, e as duas têm de concordar.
 */
function fold(s) {
  const tokens = (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim().split(" ").filter(Boolean);
  const letra = (t) => /^[a-z]\.?$/.test(t);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (letra(tokens[i])) {
      let j = i;
      while (j < tokens.length && letra(tokens[j])) j++;
      if (j - i >= 2) { out.push(tokens.slice(i, j).map((t) => t[0]).join("")); i = j - 1; continue; }
    }
    out.push(tokens[i].replace(/\./g, ""));
  }
  return out.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------- */
/* Pedidos pelo curl                                                            */
/* -------------------------------------------------------------------------- */

function curl(url, { headers = [], body = null, binario = false } = {}) {
  const a = ["-sL", "--max-time", "60", "-A", UA];
  for (const h of headers) a.push("-H", h);
  if (body !== null) a.push("-X", "POST", "-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  a.push(url);
  return execFileSync("curl", a, { encoding: binario ? "buffer" : "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function curlJson(url, opts) {
  for (let t = 0; t < 4; t++) {
    const out = curl(url, opts).trim();
    if (out.startsWith("{") || out.startsWith("[")) return JSON.parse(out);
    console.log(`  resposta estranha de ${url.slice(0, 80)} (${out.slice(0, 50).replace(/\s+/g, " ")}); a esperar`);
    execFileSync("node", ["-e", `setTimeout(()=>{}, ${4000 * (t + 1)})`]);
  }
  throw new Error(`sem JSON de ${url}`);
}

/** A cache das listas, para repetir uma importação sem voltar às federações. */
function comCache(nome, ler) {
  const f = path.join(CACHE, `${nome}.json`);
  if (DE_CACHE && existsSync(f) && Date.now() - statSync(f).mtimeMs < 3600_000) return JSON.parse(readFileSync(f, "utf8"));
  const v = ler();
  writeFileSync(f, JSON.stringify(v, null, 1));
  return v;
}

/* -------------------------------------------------------------------------- */
/* FPF: futebol, futsal, futebol de praia                                        */
/* -------------------------------------------------------------------------- */

const FPF = "https://www.fpf.pt/DesktopModules/MVC/SearchClubs/Default";
const FPF_H = ["ModuleId: 3220", "TabId: 848", "Referer: https://www.fpf.pt/pt/Clubes", "Accept: application/json, text/plain, */*"];
const TIPO_FPF = { Futebol: "football", Futsal: "futsal", "Futebol Praia": "beach_football", "Futebol de Praia": "beach_football" };

/**
 * O emblema de um clube da FPF, ou nulo.
 *
 * 3.690 dos 6.563 registos do diretório (17/11/2026) trazem o emblema por
 * omissão do site (`/Portals/0/FPF_PlaceHolers/club-default.png`): é um
 * escudo genérico, não o do clube. Fica sem emblema, em vez de subirem 3.690
 * cópias do mesmo escudo. Um endereço relativo resolve-se contra fpf.pt.
 */
function logoFpf(url) {
  if (!url) return null;
  if (/placeholer|placeholder|club-default/i.test(url)) return null;
  return url.startsWith("/") ? `https://www.fpf.pt${url}` : url;
}

function paginasFpf(filtro, rotulo) {
  const out = new Map();
  let total = null;
  for (let page = 1; page < 500; page++) {
    const j = curlJson(`${FPF}/GetClubs`, { headers: FPF_H, body: { Season: null, FootballClass: null, Competition: null, Name: null, Association: null, ...filtro, Page: page } });
    if (total === null) total = j.TotalPages ?? null;
    const lista = j.Clubs ?? [];
    if (lista.length === 0) break;
    for (const c of lista) out.set(c.Id, { fpfId: c.Id, nome: (c.Name ?? "").trim(), logo: logoFpf(c.Logo), associacao: c.Association?.Name ?? null, url: c.Url ?? null });
    if (page % 20 === 0) process.stdout.write(`  ${rotulo}: ${out.size}…\r`);
    if (total && page >= total) break;
  }
  console.log(`  ${rotulo}: ${out.size} clubes`);
  return out;
}

function lerFpf() {
  console.log("FPF: a ler o diretório de clubes");
  const classes = curlJson(`${FPF}/GetFootballClasses?season=100`, { headers: FPF_H });
  const tipos = [...new Map(classes.map((c) => [c.Type, c.TypeName])).entries()];
  const todos = paginasFpf({}, "todos");
  const porTipo = {};
  for (const [type, nome] of tipos) {
    const cls = classes.find((c) => c.Type === type);
    porTipo[nome] = [...paginasFpf({ Season: 100, FootballClass: cls }, nome).keys()];
  }
  /*
   * A modalidade só se sabe para quem tem equipas nas provas nacionais da
   * época 100 (uns 250 clubes): o filtro por tipo não chega aos distritais.
   * Os outros ficam sem modalidade, mas com `fpfId`: são da FPF, portanto
   * futebol ou futsal.
   */
  return [...todos.values()].map((c) => ({
    ...c,
    sports: Object.entries(porTipo).filter(([, ids]) => ids.includes(c.fpfId)).map(([n]) => TIPO_FPF[n] ?? fold(n).replace(/ /g, "_")),
  }));
}

/* -------------------------------------------------------------------------- */
/* FPB: basquetebol                                                             */
/* -------------------------------------------------------------------------- */

function lerFpb() {
  console.log("FPB: a ler a lista de clubes");
  const html = curl("https://www.fpb.pt/clubes/");
  const out = [];
  const re = /<div class="clube[^"]*">\s*<a href="\/calendario\/clube_(\d+)">([\s\S]*?)<\/a>\s*<\/div>/g;
  for (const m of html.matchAll(re)) {
    const b = m[2];
    const g = (r) => { const x = b.match(r); return x ? x[1].trim() : null; };
    out.push({ fpbId: Number(m[1]), logo: g(/<img class="logo[^"]*" src="([^"]*)"/), nomeCurto: g(/clube-shortname">([^<]*)</), nome: g(/clube-name">([^<]*)</), local: g(/clube-local">([^<]*)</), associacao: g(/clube-region">([^<]*)</), sports: ["basketball"] });
  }
  console.log(`  FPB: ${out.length} clubes`);
  return out;
}

/* -------------------------------------------------------------------------- */
/* A região a partir da associação                                              */
/* -------------------------------------------------------------------------- */

function regiaoDe(associacao) {
  if (!associacao) return null;
  let s = associacao.replace(/^(A\.?\s*F\.?|Associa[cç][aã]o de (Futebol|Basquetebol))\s*(de|do|da|das|dos)?\s*/i, "").trim();
  s = s.replace(/^(Ilha (da|de|do)\s*)/i, "").replace(/\s*\(.*\)$/, "");
  return s || null;
}

/* -------------------------------------------------------------------------- */
/* O bucket                                                                     */
/* -------------------------------------------------------------------------- */

const SH = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function garantirBucket() {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, { headers: SH });
  if (r.ok) return;
  const c = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...SH, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: LIMITE_FICHEIRO, allowed_mime_types: ["image/webp", "image/png", "image/jpeg", "image/gif"] }),
  });
  if (!c.ok) throw new Error(`não foi possível criar o bucket ${BUCKET}: ${c.status} ${await c.text()}`);
  console.log(`bucket ${BUCKET} criado (público, 1 MB por ficheiro)`);
}

async function subir(key, bytes, contentType) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
    method: "POST",
    headers: { ...SH, "Content-Type": contentType, "x-upsert": "true", "cache-control": "max-age=31536000" },
    body: bytes,
  });
  if (!r.ok) throw new Error(`upload ${key}: ${r.status} ${await r.text()}`);
}

/* -------------------------------------------------------------------------- */
/* As imagens                                                                   */
/* -------------------------------------------------------------------------- */

function descarregar(url) {
  try {
    const b = curl(url, { binario: true, headers: ["Accept: image/*,*/*"] });
    if (b.length < 100) return null;
    const cabeca = b.subarray(0, 12).toString("latin1");
    if (cabeca.startsWith("<") || cabeca.toLowerCase().includes("html")) return null;
    return b;
  } catch {
    return null;
  }
}

async function tratar(original) {
  const meta = await sharp(original).metadata();
  const ext = meta.format === "jpeg" ? "jpg" : meta.format === "png" ? "png" : meta.format === "webp" ? "webp" : meta.format === "gif" ? "gif" : null;
  if (!ext) return null;
  const base = sharp(original, { animated: false }).rotate();
  const w256 = await base.clone().resize(256, 256, { fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
  const w64 = await base.clone().resize(64, 64, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  return { ext, width: meta.width ?? null, height: meta.height ?? null, w256, w64, tipo: `image/${meta.format}` };
}

/* -------------------------------------------------------------------------- */
/* A importação                                                                  */
/* -------------------------------------------------------------------------- */

/** A ligação à base, que se refaz sozinha quando o Supabase a corta a meio. */
class Base {
  constructor(url) {
    this.url = url;
    this.c = null;
  }
  async ligar() {
    if (this.c) await this.c.end().catch(() => {});
    this.c = new Client({ connectionString: this.url, ssl: { rejectUnauthorized: false } });
    this.c.on("error", () => { this.c = null; });
    await this.c.connect();
  }
  async query(sql, params) {
    for (let t = 0; t < 3; t++) {
      try {
        if (!this.c) await this.ligar();
        return await this.c.query(sql, params);
      } catch (e) {
        if (!/terminated|ECONNRESET|EPIPE|timeout|Connection ended/i.test(String(e.message))) throw e;
        console.log(`  a ligação à base caiu (${e.message}); a ligar outra vez…`);
        this.c = null;
        await dormir(2000 * (t + 1));
      }
    }
    throw new Error("a base não voltou");
  }
  async end() {
    if (this.c) await this.c.end().catch(() => {});
  }
}

async function importar(db, fonte, clubes) {
  const chave = fonte === "fpf" ? "fpfId" : "fpbId";
  let novos = 0, iguais = 0, mudados = 0, semLogo = 0, falhas = 0, saltados = 0, bytes = 0;
  const lista = LIMITE ? clubes.slice(0, LIMITE) : clubes;
  for (let i = 0; i < lista.length; i++) {
    const c = lista[i];
    const atual = (await db.query(`SELECT id, "logoHash", "logoVersion", "fetchedAt" FROM "KnownClub" WHERE "${chave}" = $1`, [c[chave]])).rows[0] ?? null;
    // Tratado há pouco: não vale a pena ir buscar o mesmo emblema outra vez (uma importação interrompida retoma-se daqui).
    const recente = !FORCAR && atual?.logoHash && atual.fetchedAt && Date.now() - new Date(atual.fetchedAt).getTime() < 24 * 3600_000;
    const nome = c.nome || c.nomeCurto || `Clube ${c[chave]}`;
    const dados = {
      name: nome,
      shortName: c.nomeCurto ?? null,
      // O nome curto entra aqui também, a seguir a um separador: a procura é um `contains` e o nome curto da FPB ("Ovarense Basquetebol") é o que as pessoas escrevem.
      normalizedName: c.nomeCurto && fold(c.nomeCurto) !== fold(nome) ? `${fold(nome)} | ${fold(c.nomeCurto)}` : fold(nome),
      association: c.associacao ?? null,
      region: regiaoDe(c.associacao),
      locality: c.local ?? null,
      sports: c.sports ?? [],
      sourceLogoUrl: c.logo ?? null,
    };

    let id = atual?.id ?? null;
    if (!id) {
      id = `kc_${createHash("sha1").update(`${fonte}:${c[chave]}`).digest("hex").slice(0, 20)}`;
      await db.query(
        `INSERT INTO "KnownClub" (id, name, "shortName", "normalizedName", association, region, locality, sports, "${chave}", "sourceLogoUrl", "fetchedAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())`,
        [id, dados.name, dados.shortName, dados.normalizedName, dados.association, dados.region, dados.locality, dados.sports, c[chave], dados.sourceLogoUrl],
      );
      novos++;
    } else {
      await db.query(
        `UPDATE "KnownClub" SET name=$2, "shortName"=$3, "normalizedName"=$4, association=$5, region=$6, locality=$7, sports=$8, "sourceLogoUrl"=$9, "fetchedAt"=now(), "updatedAt"=now() WHERE id=$1`,
        [id, dados.name, dados.shortName, dados.normalizedName, dados.association, dados.region, dados.locality, dados.sports, dados.sourceLogoUrl],
      );
    }

    if (SEM_IMAGENS) continue;
    if (!c.logo) { semLogo++; continue; }
    if (recente) { saltados++; continue; }

    const original = descarregar(c.logo);
    if (!original) { falhas++; console.log(`  sem imagem: ${nome} (${c.logo})`); continue; }
    const hash = createHash("sha1").update(original).digest("hex");
    if (atual?.logoHash === hash) { iguais++; continue; }

    let t;
    try {
      t = await tratar(original);
    } catch (e) {
      falhas++;
      console.log(`  imagem inválida: ${nome}: ${e.message}`);
      continue;
    }
    if (!t) { falhas++; console.log(`  formato desconhecido: ${nome}`); continue; }

    const versao = (atual?.logoVersion ?? 0) + 1;
    const prefixo = `${id}/${versao}`;
    try {
      await subir(`${prefixo}/256.webp`, t.w256, "image/webp");
      await subir(`${prefixo}/64.webp`, t.w64, "image/webp");
      /*
       * O original só sobe até ao limite do bucket (1 MB). Acima disso (a FPB
       * tem PNG de 2 e 3 MB) guarda-se uma cópia a 512 px em WebP: chega para
       * qualquer uso nosso e não enche o bucket com ficheiros que ninguém vai
       * servir. Ninguém pede o original a uma lista.
       */
      if (original.length <= LIMITE_FICHEIRO) {
        await subir(`${prefixo}/original.${t.ext}`, original, t.tipo);
        bytes += original.length;
      } else {
        const w512 = await sharp(original, { animated: false }).rotate().resize(512, 512, { fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
        await subir(`${prefixo}/original.webp`, w512, "image/webp");
        bytes += w512.length;
      }
    } catch (e) {
      falhas++;
      console.log(`  não subiu: ${nome}: ${e.message.slice(0, 160)}`);
      continue;
    }
    bytes += t.w256.length + t.w64.length;
    await db.query(`UPDATE "KnownClub" SET "logoKey"=$2, "logoVersion"=$3, "logoHash"=$4, "logoWidth"=$5, "logoHeight"=$6, "updatedAt"=now() WHERE id=$1`, [id, prefixo, versao, hash, t.width, t.height]);
    if (atual?.logoHash) mudados++;
    if ((i + 1) % 50 === 0) console.log(`  ${fonte}: ${i + 1}/${lista.length} (${(bytes / 1024 / 1024).toFixed(1)} MB subidos)`);
    await dormir(150);
  }
  console.log(`${fonte}: ${lista.length} clubes; ${novos} novos, ${mudados} emblemas mudados, ${iguais} iguais, ${saltados} tratados há menos de 24 h, ${semLogo} sem emblema na fonte, ${falhas} falhas; ${(bytes / 1024 / 1024).toFixed(1)} MB subidos`);
}

const db = new Base(DB_URL);
await db.ligar();
try {
  if (!SEM_IMAGENS) await garantirBucket();
  if (!SO || SO === "fpf") await importar(db, "fpf", comCache("fpf", lerFpf));
  if (!SO || SO === "fpb") await importar(db, "fpb", comCache("fpb", lerFpb));
  const r = await db.query(`SELECT count(*)::int AS n, count("logoKey")::int AS com_logo, count(*) FILTER (WHERE 'basketball' = ANY(sports))::int AS basquete, count(*) FILTER (WHERE 'futsal' = ANY(sports))::int AS futsal, count(*) FILTER (WHERE 'football' = ANY(sports))::int AS futebol FROM "KnownClub"`);
  console.log("diretório:", JSON.stringify(r.rows[0]));
} finally {
  await db.end();
}

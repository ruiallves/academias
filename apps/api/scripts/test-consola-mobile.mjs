#!/usr/bin/env node
/**
 * A consola no telemóvel — o guarda.
 *
 * ## O que se prova
 *
 * Não corre a consola: lê o código e verifica que as decisões que a fazem
 * caber num telemóvel continuam lá. São regras que se perdem sem ninguém
 * reparar — uma tabela nova feita à mão, um `w-[420px]` num menu, o
 * `min-width` que alguém repõe "para as colunas não apertarem" — e que só se
 * vêem no telemóvel de um treinador, semanas depois.
 *
 *  - **Tabelas.** A `DataTable` tem o modo de cartões; qualquer `<table>` fora
 *    dela vive num ficheiro que pergunta `useMobile()` e desenha outra coisa.
 *  - **Nada rola de lado.** O `min-width: 560px` não volta; os menus pendurados
 *    com largura fixa têm tecto; o viewport respeita os recortes do ecrã.
 *  - **A área de staff da app.** O servidor devolve `STAFF`, a app conhece-o,
 *    entrega a sessão à consola, e a consola tem o caminho de volta.
 *
 * Uso: node scripts/test-consola-mobile.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(HERE, "..", "..");
const CONSOLA = path.join(RAIZ, "console", "src");
const APP = path.join(RAIZ, "family", "src");
const API = path.join(RAIZ, "api", "src");

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };
const ler = (p) => readFileSync(p, "utf8");

function ficheiros(dir, ext) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...ficheiros(p, ext));
    else if (ext.some((e) => nome.endsWith(e))) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(RAIZ, p).replace(/\\/g, "/");

/* ------------------------------------------------------------------------ */
console.log("=== A tabela ===");
const primitives = ler(path.join(CONSOLA, "components", "primitives.tsx"));
check("a DataTable pergunta se está num telemóvel", primitives.includes("const mobile = useMobile();"));
check("e desenha cartões quando está", primitives.includes("if (mobile) {") && primitives.includes("<dl className=\"mt-2.5 grid grid-cols-2"));
check("com a coluna principal como cabeçalho", primitives.includes("columns.find((c) => c.primary) ?? columns[0]"));
check("e a selecção continua lá", primitives.includes("Escolher todas as linhas visíveis") && primitives.split("Escolher esta linha").length === 3);

/* ------------------------------------------------------------------------ */
console.log("\n=== Nenhuma tabela rola de lado ===");
const css = ler(path.join(CONSOLA, "styles.css"));
check("o min-width de 560px não voltou", !/min-width:\s*560px/.test(css));
check("os menus pendurados têm tecto", css.includes('[role="menu"].absolute') && css.includes("calc(100vw - 28px)"));
check("há uma fila que rola sem barra", css.includes(".scroll-x-clean"));
check("o viewport respeita os recortes", ler(path.join(CONSOLA, "..", "index.html")).includes("viewport-fit=cover"));

/*
 * Qualquer `<table` fora da DataTable tem de viver num ficheiro que também
 * sabe desenhar-se de outra forma no telemóvel. A linha de custo do pagamento
 * é a excepção declarada: quatro linhas, cabe.
 */
const EXCEPCOES = new Set(["console/src/components/finance/CustoDoPagamento.tsx", "console/src/components/primitives.tsx"]);
const comTabela = ficheiros(CONSOLA, [".tsx"]).filter((f) => /<table[\s>]/.test(ler(f)));
console.log("     com <table>: " + comTabela.map(rel).join(", "));
for (const f of comTabela) {
  if (EXCEPCOES.has(rel(f))) continue;
  check(`${rel(f)} tem forma de telemóvel`, ler(f).includes("useMobile()"), "uma <table> feita à mão sem ramo `mobile`");
}

/*
 * Larguras fixas acima de 300px sem nenhuma defesa na mesma linha. A barra
 * lateral não conta (some abaixo de 768px) nem a moldura de arranque (é
 * `max-w`, encolhe sozinha).
 */
const LARGOS = /\bw-\[(\d{3,})px\]/g;
const SEGUROS = new Set(["console/src/components/Sidebar.tsx"]);
let largosSemDefesa = [];
for (const f of ficheiros(CONSOLA, [".tsx"])) {
  if (SEGUROS.has(rel(f))) continue;
  ler(f).split("\n").forEach((linha, i) => {
    for (const m of linha.matchAll(LARGOS)) {
      if (Number(m[1]) <= 300) continue;
      if (/max-md|max-w-|pop-erro|mobile-notif|md:w-|sm:w-/.test(linha)) continue;
      largosSemDefesa.push(`${rel(f)}:${i + 1} ${m[0]}`);
    }
  });
}
check("nenhuma largura fixa acima de 300px sem defesa", largosSemDefesa.length === 0, largosSemDefesa.join("; "));

check("o cabeçalho de página embrulha as acções", ler(path.join(CONSOLA, "components", "Shell.tsx")).includes("max-md:w-full max-md:flex-wrap"));
check("a barra de selecção sobe acima dos separadores", ler(path.join(CONSOLA, "components", "BulkDelete.tsx")).includes("max-md:bottom-[calc(76px"));
check("os separadores rolam dentro do carril", ler(path.join(CONSOLA, "components", "filters.tsx")).includes("max-md:overflow-x-auto max-md:[&>*]:shrink-0"));
check("o calendário abre na agenda", ler(path.join(CONSOLA, "routes", "director", "Calendar.tsx")).includes('isMobile() ? "agenda" : "mes"'));
check("e o mês tem forma de telemóvel", ler(path.join(CONSOLA, "components", "MonthGrid.tsx")).includes("function MobileMonth("));

/* ------------------------------------------------------------------------ */
console.log("\n=== A área de staff ===");
const servico = ler(path.join(API, "club-app", "club-app.service.ts"));
check("o servidor devolve o contexto STAFF", servico.includes('contexts.push({ type: "STAFF", role: staff.role })'));
check("a qualquer membership que não seja de família", servico.includes("daAcademia.find((m) => !deFamilia(m.role))"));

const contexts = ler(path.join(APP, "lib", "contexts.ts"));
check("a app conhece o contexto", contexts.includes('"FAMILY" | "MEMBER" | "STAFF"'));
check("e guarda a escolha", contexts.includes('v === "STAFF"'));
check("a entrega existe", existsSync(path.join(APP, "lib", "handoff.ts")));
const handoff = ler(path.join(APP, "lib", "handoff.ts"));
check("escreve na chave que a consola lê", handoff.includes('"academia.session"') && ler(path.join(CONSOLA, "lib", "session.ts")).includes('const KEY = "academia.session"'));
check("com o par inteiro e o slug", handoff.includes("refreshToken: actual.refreshToken") && handoff.includes("academySlug: academySlug()"));
check("e o App entrega ao vestir STAFF", ler(path.join(APP, "App.tsx")).includes('areaActiva === "STAFF"'));
check("o ecrã de escolha só mostra o que a conta tem", ler(path.join(APP, "screens", "socio", "EscolherArea.tsx")).includes("contexts?.some((c) => c.type === o.type)"));
check("o switcher tem Staff", ler(path.join(APP, "screens", "socio", "AreaSwitch.tsx")).includes('type: "STAFF"'));

const manifest = ler(path.join(API, "tenant", "tenant-assets.controller.ts"));
check("o manifest cobre /consola (scope /)", /scope:\s*"\/"/.test(manifest));
const nav = ler(path.join(CONSOLA, "components", "MobileNav.tsx"));
check("a consola tem o caminho de volta", nav.includes("irParaApp(") && nav.includes("Mudar de área"));
check("e devolve o par mais recente à app", ler(path.join(CONSOLA, "lib", "app-contexts.ts")).includes('"academia.family.session"'));
check("sair da consola sai da app", ler(path.join(CONSOLA, "lib", "session.ts")).includes('removeItem("academia.family.session")'));
check("sair da app sai da consola", ler(path.join(APP, "lib", "session.ts")).includes('removeItem("academia.session")'));

/* ------------------------------------------------------------------------ */
console.log(`\n${ok} OK, ${bad} falhas`);
process.exit(bad ? 1 : 0);

/**
 * Que erros é que aparecem ao canto — e, sobretudo, quais é que **não**.
 *
 * ## A avaria que este teste existe para não voltar
 *
 * Quando os avisos passaram a ser levantados no cliente HTTP, ganharam uma
 * cobertura que nenhum ecrã tinha de programar. E ganharam também um problema
 * que só se vê com a consola a arrancar: o arranque pede oito listas de uma
 * vez, e um cargo sem staff nem mensalidades recebe dois 403 — que são a
 * resposta **certa**, e que o arranque já deitava fora. Passaram a aparecer ao
 * canto, a cada entrada, a dizer "Sem acesso ao staff" e "Sem acesso a
 * mensalidades" a quem nunca pediu nada disso.
 *
 * A regra que ficou, e que isto guarda:
 *
 *  - um erro a seguir a um **gesto** aparece — é para isso que os avisos servem;
 *  - um pedido que corre **sozinho** (arranque, sondagem, contagem de fundo) não
 *    aparece, mesmo quando falha;
 *  - o 401 de sessão acabada não aparece: leva a pessoa à porta do clube, e um
 *    cartão por cima disso só assusta.
 *
 * ## Corre o cliente verdadeiro
 *
 * Com o `fetch` e o armazenamento do browser substituídos — é a única forma de
 * provocar um 403 sem servidor. O que está a ser testado é o `lib/http.ts` de
 * produção, não uma cópia das regras.
 *
 * Uso: npm run test:avisos-http
 */

/* -------------------------------------------------------------------------- */
/* O browser, o mínimo que o cliente precisa                                   */
/* -------------------------------------------------------------------------- */

const guardado = new Map<string, string>();
const armazenamento = {
  getItem: (k: string) => guardado.get(k) ?? null,
  setItem: (k: string, v: string) => void guardado.set(k, v),
  removeItem: (k: string) => void guardado.delete(k),
  clear: () => guardado.clear(),
};

Object.assign(globalThis, {
  localStorage: armazenamento,
  sessionStorage: armazenamento,
  window: {
    location: { origin: "http://localhost", hostname: "localhost", href: "http://localhost/" },
    addEventListener: () => {},
    localStorage: armazenamento,
  },
});

/** O que o próximo `fetch` vai responder. Cada teste põe aqui o seu caso. */
let resposta: { status: number; corpo: unknown } = { status: 200, corpo: {} };

globalThis.fetch = (async () =>
  new Response(JSON.stringify(resposta.corpo), {
    status: resposta.status,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

/* -------------------------------------------------------------------------- */

const { apiGet, apiGetSilencioso, apiPost } = await import("../src/lib/http");
const { avisosActuais, fecharAviso } = await import("../src/lib/avisos");

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

const limpar = () => {
  for (const a of [...avisosActuais()]) fecharAviso(a.id);
};

/** Corre o pedido à espera de que falhe, e devolve os avisos que ficaram. */
async function aoFalhar(status: number, mensagem: string, pedido: () => Promise<unknown>) {
  limpar();
  resposta = { status, corpo: { message: mensagem } };
  await pedido().catch(() => {});
  return avisosActuais();
}

/* -------------------------------------------------------------------------- */

console.log("\n=== O que aparece ===");

let avisos = await aoFalhar(400, "Já há um mesociclo (Pré-época) de 17 ago a 6 set nesta equipa.", () =>
  apiPost("/api/training/cycles", {}),
);
check("um erro numa escrita aparece", avisos.length === 1, String(avisos.length));
check(
  "com a frase do servidor, tal e qual",
  avisos[0]?.texto === "Já há um mesociclo (Pré-época) de 17 ago a 6 set nesta equipa.",
  avisos[0]?.texto,
);

avisos = await aoFalhar(403, "Sem permissão para editar equipas", () => apiPost("/api/teams", {}));
check("um 403 a seguir a um gesto aparece", avisos.length === 1, String(avisos.length));

avisos = await aoFalhar(404, "Equipa não encontrada", () => apiGet("/api/teams/xyz"));
check("uma leitura que alguém pediu também aparece", avisos.length === 1, String(avisos.length));

/*
 * Sem `message` no corpo, a frase é a do estado: "Não foi possível…" e não
 * "Request failed with status code 500".
 */
limpar();
resposta = { status: 500, corpo: {} };
await apiGet("/api/qualquer").catch(() => {});
check("um erro sem frase própria ganha uma em português", avisosActuais()[0]?.texto.length > 0, avisosActuais()[0]?.texto);
check("e não é um código HTTP", !/\b500\b/.test(avisosActuais()[0]?.texto ?? ""), avisosActuais()[0]?.texto);

/* -------------------------------------------------------------------------- */

console.log("\n=== O que não aparece ===");

/*
 * **A regressão.** O arranque da consola corre sozinho e pede o que a pessoa
 * talvez não possa ver. Um 403 aí é o âmbito a funcionar, e o `soft()` do
 * arranque usa exactamente esta chamada.
 */
avisos = await aoFalhar(403, "Sem acesso ao staff", () => apiGetSilencioso("/api/staff"));
check("o 403 do arranque não aparece (staff)", avisos.length === 0, JSON.stringify(avisos.map((a) => a.texto)));

avisos = await aoFalhar(403, "Sem acesso a mensalidades", () => apiGetSilencioso("/api/charges"));
check("nem o das mensalidades", avisos.length === 0, JSON.stringify(avisos.map((a) => a.texto)));

avisos = await aoFalhar(500, "O servidor está em baixo", () => apiGetSilencioso("/api/calendar"));
check("uma sondagem de fundo também não avisa", avisos.length === 0, JSON.stringify(avisos.map((a) => a.texto)));

/* -------------------------------------------------------------------------- */

console.log("\n=== Entrar como treinador: tudo recusado, nada aparece ===");

/*
 * O teste que interessa, e a razão de ele correr os **carregadores
 * verdadeiros** em vez de uma lista de caminhos escrita à mão: foi assim que a
 * avaria escapou à primeira correcção. Silenciei o arranque das oito listas e
 * dei o assunto por fechado; ficaram de fora `/api/invites` (que responde "Sem
 * permissão" a quem não tem `staff:read` — ou seja, a um treinador e a um
 * scout), as notificações, os catálogos, os departamentos e os cargos. Todos
 * correm sozinhos ao entrar.
 *
 * Aqui recusa-se **tudo**, que é o pior caso, e exige-se zero cartões. Um
 * carregador de fundo novo que se esqueça do silêncio cai neste teste.
 */
const { loadInvites } = await import("../src/lib/invites");
const { loadNotifications } = await import("../src/lib/notifications");
const { loadCatalogs } = await import("../src/lib/catalogs");
const { loadDepartments } = await import("../src/lib/departments");
const { loadRoles } = await import("../src/lib/roles");

limpar();
const original = globalThis.fetch;
globalThis.fetch = (async () =>
  new Response(JSON.stringify({ message: "Sem permissão" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

/* Primeiro o que o `soft()` do arranque pede — as oito listas da academia. */
await Promise.all(
  ["/api/teams", "/api/athletes", "/api/staff", "/api/sessions", "/api/charges", "/api/matches", "/api/events", "/api/announcements"].map(
    (p) => apiGetSilencioso(p).catch(() => []),
  ),
);

/* E depois o resto do arranque, pelos próprios carregadores. */
await Promise.all([loadInvites(), loadNotifications(), loadCatalogs(true), loadDepartments(), loadRoles()]);

globalThis.fetch = original;

check("entrar na consola não mostra aviso nenhum", avisosActuais().length === 0, JSON.stringify(avisosActuais().map((a) => a.texto)));

/* -------------------------------------------------------------------------- */

console.log("\n=== A promessa que ninguém apanhou ===");

/*
 * A **segunda** fuga, e a que fez o "Sem permissão" continuar a aparecer
 * depois de eu ter silenciado os pedidos.
 *
 * `void carregar()` sem `catch` produz uma promessa rejeitada sem dono, e o
 * vigia de promessas perdidas apanhava-a e mostrava-a — mesmo quando o cliente
 * HTTP tinha acabado de decidir, de propósito, que aquele erro não se mostra.
 * Silenciar o pedido não chegava: o erro entrava pela outra porta.
 *
 * A regra: quem decide sobre um erro de pedido é o cliente HTTP, e o vigia não
 * o repete. O que o vigia continua a apanhar são os erros do lado do browser,
 * que é para isso que existe.
 */
const { vigiarPromessasPerdidas } = await import("../src/lib/avisos");

/* O vigia liga-se a `window`; aqui guarda-se o ouvinte para o chamar à mão. */
let ouvinte: ((e: { reason: unknown }) => void) | null = null;
(globalThis as { window: { addEventListener: (t: string, f: (e: { reason: unknown }) => void) => void } }).window.addEventListener =
  (tipo, f) => {
    if (tipo === "unhandledrejection") ouvinte = f;
  };
vigiarPromessasPerdidas();
check("o vigia ficou ligado", ouvinte !== null, "");

limpar();
resposta = { status: 403, corpo: { message: "Sem permissão" } };
const rejeitada = await apiGetSilencioso("/api/invites").catch((e: unknown) => e);
ouvinte?.({ reason: rejeitada });
check(
  "um erro da API silenciado não volta a entrar pelo vigia",
  avisosActuais().length === 0,
  JSON.stringify(avisosActuais().map((a) => a.texto)),
);

limpar();
ouvinte?.({ reason: new TypeError("Cannot read properties of undefined (reading 'papel')") });
check("mas um erro do browser aparece", avisosActuais().length === 1, String(avisosActuais().length));
check(
  "com a frase do erro",
  /reading 'papel'/.test(avisosActuais()[0]?.texto ?? ""),
  avisosActuais()[0]?.texto,
);

limpar();
const cancelado = new Error("O pedido foi cancelado");
cancelado.name = "AbortError";
ouvinte?.({ reason: cancelado });
check("um pedido cancelado não diz nada a ninguém", avisosActuais().length === 0, String(avisosActuais().length));

limpar();

/* -------------------------------------------------------------------------- */

console.log(`\n${ok} OK, ${bad} FALHA`);
process.exit(bad ? 1 : 0);

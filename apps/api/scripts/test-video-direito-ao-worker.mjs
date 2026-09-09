#!/usr/bin/env node
/**
 * O vídeo vai direito ao worker — sem Supabase, sem limite de tamanho.
 *
 * ## O que se prova
 *
 *  - **Estático.** O bilhete existe nos dois lados com o mesmo formato; a API
 *    devolve `ingestUrl` quando há worker exposto; o claim só entrega a quem
 *    tem o ficheiro; a purga existe e não se purga a si própria; a consola
 *    envia em blocos com retoma; a migração acrescenta `holder`/`PURGED`.
 *  - **O bilhete.** Assina-se aqui com o token da API e verifica-se com a
 *    mesma aritmética que o worker usa — e um bilhete adulterado cai.
 *  - **Ao vivo** (com a API a correr e `AI_WORKER_PUBLIC_URL` definido): criar
 *    uma análise no Sub-19, pedir o carregamento → vem `ingestUrl` + bilhete
 *    válido, e nada foi assinado no Storage.
 *  - **Com o worker a correr:** envia-se um "vídeo" pequeno em blocos, com um
 *    bloco fora de sítio pelo meio (409 + realinhar), até ao `complete`. Se o
 *    worker não estiver de pé, estes checks dizem-no e não contam como falha.
 *
 * Uso: node scripts/test-video-direito-ao-worker.mjs
 */
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(HERE, "..", "..", "..");
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(k + "="));
  return l ? l.slice(k.length + 1).trim().replace(/^"|"$/g, "") : "";
};
const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const API = process.env.API_URL ?? "http://127.0.0.1:3000";
const ler = (rel) => readFileSync(path.join(RAIZ, rel), "utf8");

let ok = 0, bad = 0, saltados = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };
const salta = (l, d) => { saltados++; console.log("  SALTO " + l + (d ? " — " + d : "")); };

/* ------------------------------------------------------------------------ */
console.log("=== Estático ===");
const ticketTs = ler("apps/api/src/ai/ai-ticket.ts");
const ingestPy = ler("ai-worker/academias_ai/ingest.py");
check("a API assina o bilhete com HMAC-SHA256 em base64url", ticketTs.includes('createHmac("sha256"') && ticketTs.includes('"base64url"'));
check("o worker verifica com a mesma aritmética", ingestPy.includes("hashlib.sha256") && ingestPy.includes("compare_digest"));
check("a chave é o AI_WORKER_TOKEN nos dois lados", ler("apps/api/src/ai/ai.service.ts").includes('get<string>("AI_WORKER_TOKEN")') && ingestPy.includes("config.TOKEN"));

const svc = ler("apps/api/src/ai/ai.service.ts");
check("com AI_WORKER_PUBLIC_URL a API devolve ingestUrl + ticket", svc.includes("ingestUrl: ingest, ticket"));
check("e sem ela fica o Storage", svc.includes("this.video.signUpload(created.storageKey)"));
check("reprocessar um vídeo purgado é recusado com explicação", svc.includes('status === "PURGED"') && svc.includes("cria uma análise nova"));

const wsvc = ler("apps/api/src/ai/ai-worker.service.ts");
check("o claim só entrega a quem tem o ficheiro", /v\.holder IS NOT NULL\s+AND v\.holder <> \$\{dto\.worker\}/.test(wsvc));
check("o job diz de onde vem o vídeo", wsvc.includes('source: video.holder ? "worker" : "storage"'));
check("a recepção marca READY + holder e enfileira a qualidade", wsvc.includes("async videoReceived(") && wsvc.includes('holder: dto.worker') && wsvc.includes('"quality_check", { videoId }'));
check("a purga entra depois da detecção", /recomputeReview\(db, job\.analysisId\);[\s\S]{0,600}enqueuePurge\(db, job\.academyId, job\.analysisId\)/.test(wsvc));
check("e depois de uma falha final — mas não da própria purga", wsvc.includes('if (job.kind !== "purge_video") await this.enqueuePurge'));
check("a purga marca PURGED e larga o holder", wsvc.includes('status: "PURGED", holder: null, purgedAt: new Date()'));
/*
 * A purga é arrumação, não trabalho: reclamá-la não pode pôr uma análise
 * concluída de volta em "A processar". Aconteceu — a análise ficava a 100 %
 * com o estado errado, para sempre, porque a purga não tem um fim que a
 * devolva a COMPLETED.
 */
/*
 * Verifica-se a intenção, não a redacção: a condição já ganhou um `&&`
 * para as propagações, e um teste que exigisse o texto exacto dava
 * vermelho a cada linha nova sem nada estar partido.
 */
check(
  "reclamar a purga não mexe no estado da análise",
  /job\.kind !== "purge_video"[\s\S]{0,220}?aIAnalysis\.update\(\{[\s\S]{0,120}?status: "PROCESSING"/.test(wsvc),
);
check("nem o heartbeat dela no progresso", wsvc.includes('dto.progress != null && job.kind !== "purge_video"'));

/* O contentor do Railway: ffmpeg dentro, torch de CPU, uma réplica. */
const dockerfile = ler("ai-worker/Dockerfile");
check("o contentor traz o ffmpeg", /apt-get install .*ffmpeg/s.test(dockerfile));
check("e o torch da build de CPU", dockerfile.includes("download.pytorch.org/whl/cpu"));
check("o spool aponta para o volume", dockerfile.includes("AI_WORKER_SPOOL=/data/spool"));
check("uma réplica só", JSON.parse(ler("ai-worker/railway.json")).deploy.numReplicas === 1);
check("com healthcheck", JSON.parse(ler("ai-worker/railway.json")).deploy.healthcheckPath === "/health");
check("a porta vem de PORT na plataforma", ler("ai-worker/academias_ai/config.py").includes('os.environ.get("PORT") or os.environ.get("AI_WORKER_INGEST_PORT"'));
/*
 * A performance da detecção. O torchvision reescala cada frame para 800 px de
 * lado curto por omissão — num vídeo de 360p isso é ampliar 2,2x e pagar quase
 * cinco vezes os píxeis da fonte. Custava 178 min por jogo em CPU contra 54.
 * Se alguém tirar o `min_size`, volta tudo ao que era, em silêncio.
 */
const dt = ler("ai-worker/academias_ai/pipelines/detect_track.py");
check("o detector recebe a resolução de trabalho", dt.includes("min_size=plano[") && dt.includes("max_size=plano["));
check("que respeita um tecto de ampliação", dt.includes("fonte * config.MAX_UPSCALE"));
check("os frames vão em lote", dt.includes("def escoar()") && dt.includes("plano[\"batch\"]"));
check("com meia precisão na GPU", dt.includes("torch.autocast(device_type=device, dtype=torch.float16, enabled=plano["));
check("e os frames saltados não são convertidos", dt.includes("cap.grab()") && dt.includes("cap.retrieve()"));
check("o plano fica no resultado, para um número lento se poder explicar", dt.includes('"workShort": plano["short"]'));
/*
 * A fragmentação e o que ela custava. Num jogo real o ByteTrack abriu mais de
 * 10 000 identidades para 22 jogadores (a 5 FPS as caixas do mesmo jogador mal
 * se sobrepõem entre frames), e cada uma virava um ficheiro no Storage: dez
 * minutos de rede com a análise parada nos 95 % — e, pior, sem bater o coração,
 * a cinco minutos de a API repor o trabalho na fila e deitar fora 100 minutos.
 */
check("os fragmentos são juntados antes de gravar", dt.includes("def _merge_fragments(") && dt.includes("_merge_fragments(tracks, meta)"));
check("com critérios físicos, não estatísticos", dt.includes("MERGE_GAP_SEC") && dt.includes("MERGE_SPEED_FRAC") && dt.includes("MERGE_SIZE_RATIO"));
check("o tracker está afinado para cadência baixa", dt.includes("def _build_tracker(") && dt.includes("minimum_matching_threshold"));
check("e sobrevive a essa API mudar de nome", /_build_tracker[\s\S]{0,900}except TypeError/.test(dt));
check("as posições vão num ficheiro só", dt.includes('POSITIONS_KEY = "tracks/positions.json.gz"') && dt.includes('"dataKey": POSITIONS_KEY'));
check("e o coração bate durante a arrumação", /_summarise\([\s\S]{0,400}progress: Callable/.test(dt) && dt.includes("if progress:"));
check("o resultado diz quantos fragmentos havia e quantos ficaram", dt.includes('"rawTracks": brutos') && dt.includes('"mergedTracks": len(tracks)'));

/*
 * A Academias AI ainda não é para os clubes. Um filtro em tempo de execução
 * escondia o menu e deixava os rótulos e caminhos todos dentro do pacote que o
 * clube descarrega; o spread condicional deixa o empacotador deitá-lo fora.
 */
const nav = ler("apps/console/src/lib/nav.ts");
check("a Academias AI só entra no menu em desenvolvimento", nav.includes("...(import.meta.env.DEV ? [GRUPO_AI] : [])"));
check("e as rotas dela também", ler("apps/console/src/App.tsx").includes("{import.meta.env.DEV && ("));

check("há uma ferramenta para medir a troca antes de a fazer", existsSync(path.join(RAIZ, "ai-worker/scripts/comparar-detector.py")));

check("o OpenCV do contentor é headless", ler("ai-worker/requirements.txt").includes("opencv-python-headless"));

check("a rota do worker existe", ler("apps/api/src/ai/ai.controller.ts").includes('@Post("videos/:id/received")'));
const mig = "apps/api/prisma/migrations/20260906180000_video_direito_ao_worker/migration.sql";
check("a migração acrescenta holder, purgedAt e PURGED", existsSync(path.join(RAIZ, mig)) && /"holder" TEXT/.test(ler(mig)) && /ADD VALUE IF NOT EXISTS 'PURGED'/.test(ler(mig)));
check("o schema acompanha", /holder\s+String\?/.test(ler("apps/api/prisma/schema.prisma")) && /purgedAt DateTime\?/.test(ler("apps/api/prisma/schema.prisma")));

const main = ler("ai-worker/academias_ai/__main__.py");
check("o worker abre a porta antes da fila", main.includes("ingest.start()"));
check("um vídeo no disco não se apaga no fim do job", main.includes("temporary = False") && main.includes("if temporary and video_path is not None"));
check("e um vídeo que já não está cá falha com explicação", main.includes("O vídeo já não está neste worker"));
check("a purga está sempre disponível", ler("ai-worker/academias_ai/pipelines/__init__.py").includes('"purge_video": purge_video'));
check("o worker aceita apagar já, com o token", ingestPy.includes("def do_DELETE(") && ingestPy.includes("x-ai-worker-token"));
check("e a API pede-lho ao apagar a análise", ler("apps/api/src/ai/ai-video.service.ts").includes("async askWorkerToPurge(") && ler("apps/api/src/ai/ai.service.ts").includes("askWorkerToPurge(v.id)"));
check("o worker tem zelador", ingestPy.includes("def janitor(") && ingestPy.includes("spool-janitor"));
check("um bloco fora de sítio dá 409 com o received", ingestPy.includes("self._json(409, {\"received\": received})"));
check("e nunca mais bytes do que o bilhete anuncia", ingestPy.includes("mais bytes do que o bilhete anuncia"));

const lib = ler("apps/console/src/lib/ai.ts");
check("a consola envia em blocos de 8 MB", lib.includes("const CHUNK = 8 * 1024 * 1024") && lib.includes("enviarEmBlocos("));
check("realinha-se a um 409", lib.includes("r.status === 409"));
check("e guarda o bilhete para retomar depois de fechar o separador", lib.includes("academia.ai.upload:"));
check("o caminho antigo continua lá", lib.includes("uploadUrl") && lib.includes('apiPost(`/api/ai/videos/${started.id}/complete`'));

/* ------------------------------------------------------------------------ */
console.log("\n=== O bilhete ===");
const secret = env("AI_WORKER_TOKEN");
if (!secret) {
  salta("assinar e verificar", "AI_WORKER_TOKEN não está no .env da API");
} else {
  const b64 = (x) => Buffer.from(x).toString("base64url");
  const sign = (p) => createHmac("sha256", secret).update(p).digest("base64url");
  const payload = b64(JSON.stringify({ v: "vid_1", a: "an_1", ac: "acd_lifeclub", s: 123, m: "video/mp4", e: Math.floor(Date.now() / 1000) + 60 }));
  const ticket = `${payload}.${sign(payload)}`;
  // Verificar como o worker verifica.
  const [p, sig] = ticket.split(".");
  check("um bilhete assinado verifica", sign(p) === sig);
  check("um bilhete adulterado cai", sign(p.slice(0, -2) + "AA") !== sig);
  const caducado = b64(JSON.stringify({ v: "vid_1", e: Math.floor(Date.now() / 1000) - 1 }));
  check("um bilhete caducado tem `e` no passado", JSON.parse(Buffer.from(caducado, "base64url").toString()).e < Date.now() / 1000);
}

/* ------------------------------------------------------------------------ */
console.log("\n=== Ao vivo — a API ===");
const login = async (email, password = "academia2026") =>
  (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })).json()).access_token;
const call = async (token, method, pathname, body) => {
  const r = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club", "x-app": "console", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (!r) return { status: 0, body: null };
  return { status: r.status, body: await r.json().catch(() => null) };
};

const apiViva = await fetch(`${API}/billing/fees`).then((r) => r.status).catch(() => 0);
let analysisId = null, started = null, presidente = null;
if (!apiViva) {
  salta("criar análise e pedir carregamento", "a API não está a correr em " + API);
} else {
  presidente = await login("presidente@lifeclub.pt");
  const equipas = await call(presidente, "GET", "/api/teams");
  const sub19 = (equipas.body ?? []).find((t) => /Sub-19/i.test(t.name));
  const atletas = await call(presidente, "GET", "/api/athletes");
  const plantel = (atletas.body ?? []).filter((a) => a.teamId === sub19?.id).slice(0, 5);
  check("há um Sub-19 com atletas para o plantel", Boolean(sub19) && plantel.length > 0, `${sub19?.name} · ${plantel.length}`);

  const criada = await call(presidente, "POST", "/api/ai/analyses", {
    teamId: sub19?.id, title: "ZZ Teste ingestão", squad: plantel.map((a) => ({ athleteId: a.id, jerseyNumber: a.squadNumber ?? undefined })),
  });
  check("a análise cria-se", criada.status === 201 || criada.status === 200, `${criada.status} ${JSON.stringify(criada.body).slice(0, 120)}`);
  analysisId = criada.body?.id ?? null;

  if (analysisId) {
    started = await call(presidente, "POST", `/api/ai/analyses/${analysisId}/videos`, { mimeType: "video/mp4", sizeBytes: 3 * 1024 * 1024 + 12345 });
    check("o arranque do carregamento responde", started.status === 201 || started.status === 200, `${started.status} ${JSON.stringify(started.body).slice(0, 160)}`);
    const modo = started.body?.ingestUrl ? "worker" : started.body?.uploadUrl ? "storage" : "?";
    console.log("     modo:", modo, started.body?.ingestUrl ?? "");
    check("vem ingestUrl + bilhete (o vídeo vai direito ao worker)", modo === "worker", "sem AI_WORKER_PUBLIC_URL no .env da API — ou a API precisa de reiniciar para ler o .env");
    if (modo === "worker" && secret) {
      const [p, sig] = String(started.body.ticket).split(".");
      const sign = (x) => createHmac("sha256", secret).update(x).digest("base64url");
      const payload = JSON.parse(Buffer.from(p, "base64url").toString());
      check("o bilhete é da API e bate com o token", sign(p) === sig);
      check("e diz o vídeo, a análise, o tamanho e o tipo", payload.v === started.body.id && payload.a === analysisId && payload.s === 3 * 1024 * 1024 + 12345 && payload.m === "video/mp4", JSON.stringify(payload));
      check("e dura horas, não minutos", payload.e - Date.now() / 1000 > 3600);
    }
  }
}

/* ------------------------------------------------------------------------ */
console.log("\n=== Ao vivo — o worker ===");
const ingestUrl = started?.body?.ingestUrl;
const saude = ingestUrl ? await fetch(`${ingestUrl}/health`).then((r) => r.json()).catch(() => null) : null;
if (!ingestUrl || !saude?.ok) {
  salta("enviar em blocos até ao complete", ingestUrl ? `o worker não responde em ${ingestUrl} — arranca-o: cd ai-worker && python -m academias_ai` : "sem ingestUrl");
} else {
  console.log("     worker:", saude.worker, "· livre:", (saude.spoolFreeBytes / 1e9).toFixed(1), "GB");
  const base = `${ingestUrl}/ingest/${started.body.ticket}`;
  const total = 3 * 1024 * 1024 + 12345;
  const dados = Buffer.alloc(total, 7);
  const abrir = await fetch(base, { method: "POST" }).then((r) => r.json());
  check("abre com received=0", abrir.received === 0, JSON.stringify(abrir));

  const CHUNK = 1024 * 1024;
  let received = 0;
  const put = (offset, buf) => fetch(`${base}?offset=${offset}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: buf });
  const r1 = await put(0, dados.subarray(0, CHUNK));
  received = (await r1.json()).received;
  check("o primeiro bloco entra", r1.status === 200 && received === CHUNK, `${r1.status} ${received}`);

  const errado = await put(0, dados.subarray(0, CHUNK));
  const corpo = await errado.json();
  check("um bloco fora de sítio dá 409 e diz onde estamos", errado.status === 409 && corpo.received === CHUNK, `${errado.status} ${JSON.stringify(corpo)}`);

  while (received < total) {
    const r = await put(received, dados.subarray(received, Math.min(received + CHUNK, total)));
    received = (await r.json()).received;
  }
  check("chega ao tamanho anunciado", received === total, `${received}`);

  const aMais = await put(received, Buffer.alloc(10));
  check("um byte a mais é recusado (413)", aMais.status === 413, `${aMais.status}`);

  const estado = await fetch(base).then((r) => r.json());
  check("GET diz o received", estado.received === total);

  // Não é um vídeo a sério: o ffprobe vai recusar, e é isso que se prova —
  // o worker não põe lixo na fila.
  const done = await fetch(`${base}/complete`, { method: "POST" });
  const dc = await done.json().catch(() => null);
  check("um ficheiro que não é vídeo não entra na fila (422)", done.status === 422, `${done.status} ${JSON.stringify(dc)}`);

  const invalido = await fetch(`${ingestUrl}/ingest/abc.def`, { method: "POST" });
  check("sem bilhete válido: 401", invalido.status === 401, `${invalido.status}`);

  const semToken = await fetch(`${ingestUrl}/video/${started.body.id}`, { method: "DELETE" });
  check("apagar um vídeo sem o token do worker: 401", semToken.status === 401, `${semToken.status}`);
}

/* ------------------------------------------------------------------------ */
if (analysisId && presidente) {
  console.log("\n=== Limpeza ===");
  const del = await call(presidente, "DELETE", `/api/ai/analyses/${analysisId}`);
  console.log("  análise de teste apagada:", del.status);

  /*
   * E o ficheiro foi com ela. Este teste já deixou 3 MB esquecidos no disco do
   * worker de cada vez que correu — foi assim que a lacuna se descobriu.
   */
  if (started?.body?.ingestUrl && secret) {
    const resta = await fetch(`${started.body.ingestUrl}/ingest/${started.body.ticket}`, { method: "GET" })
      .then((r) => (r.ok ? r.json() : { received: -1 }))
      .catch(() => ({ received: -1 }));
    // O carregamento deste teste **não** chegou ao fim (o ficheiro não é vídeo):
    // é o caso interrompido, o mais comum, e é o que tem de ficar limpo.
    check("apagar a análise apaga o vídeo do worker, mesmo com o carregamento a meio", resta.received === 0 || resta.received === -1, `ficaram ${resta.received} bytes`);
  }
}

console.log(`\n${ok} OK, ${bad} falhas, ${saltados} saltados`);
process.exit(bad ? 1 : 0);

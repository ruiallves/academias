import { clubPalette, type ClubPalette } from "../common/contrast";
import type { Role } from "@prisma/client";
import type { InvitePreview } from "./invites.service";

/**
 * A página que abre quando alguém clica no link do convite.
 *
 * Gerada no servidor, como a landing, e pela mesma razão de fundo: é uma página
 * que se abre uma vez na vida, num telemóvel qualquer, possivelmente com rede má.
 * Uma SPA aqui seria mandar carregar um framework para preencher dois campos.
 *
 * ## O que a pessoa pode e não pode mudar
 *
 * O nome e o email são da academia — mostram-se como texto, não como campos. Não é
 * uma limitação técnica: o convite está preso àquele email, e é isso que o
 * distingue de uma porta aberta. Deixar trocá-lo era deixar que o convite feito ao
 * Rui fosse resgatado por quem apanhasse o link.
 *
 * O que a pessoa escolhe é uma coisa só — a password. As equipas foram decididas
 * por quem convidou e aqui só se mostram, porque neste produto as equipas de um
 * treinador *são* o acesso dele aos dados dos atletas.
 */

const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Direção",
  DIRECTOR: "Direção",
  COORDINATOR: "Coordenação",
  COACH: "Equipa técnica",
  STAFF: "Operações",
  MEDICAL: "Departamento clínico",
  SCOUT: "Departamento de scouting",
  GUARDIAN: "Encarregado de educação",
  ATHLETE: "Atleta",
};

/** O que cada papel vai encontrar lá dentro. Dito por palavras, não por permissões. */
const ROLE_BLURB: Record<Role, string> = {
  OWNER: "Acesso a toda a academia.",
  DIRECTOR: "Acesso a toda a academia.",
  COORDINATOR: "Atletas, equipas, calendário e avaliações da academia.",
  COACH: "Treinos, presenças e avaliações — das tuas equipas.",
  STAFF: "Consulta de atletas, equipas e calendário.",
  SCOUT: "Prospectos, observações e vídeo de scouting.",
  MEDICAL: "Boletins clínicos e consultas de toda a academia.",
  GUARDIAN: "A área do teu educando.",
  ATHLETE: "A tua área.",
};

export function renderInvite(opts: {
  preview: InvitePreview;
  token: string;
  consoleUrl: string;
  /** A anon key é pública por desenho — é a que o browser usa para autenticar. */
  supabaseUrl: string;
  supabaseAnonKey: string;
}): string {
  const { preview, token, consoleUrl, supabaseUrl, supabaseAnonKey } = opts;
  const { academy } = preview;
  const paleta = clubPalette(academy.signalColor);
  const signal = paleta.club;

  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Convite · ${esc(academy.shortName)}</title>
<meta name="theme-color" content="${signal}" />
<!-- Um convite não se partilha nem se indexa. -->
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="no-referrer" />

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

<style>
${styles(paleta)}
</style>
</head>
<body>
<main>
  <!--
    Os estilhacos. Decorativos, e por isso fora da arvore de acessibilidade —
    quem usa leitor de ecra ouve o convite e o formulario, nao seis divs vazias.
  -->
  <div class="shards" aria-hidden="true">
    <i class="s1"></i><i class="s2"></i><i class="s3"></i>
    <i class="s4"></i><i class="s5"></i><i class="s6"></i>
  </div>
  <div class="card">
    <div class="mark${academy.logoUrl ? " logo" : ""}">${academy.logoUrl ? `<img src="${esc(academy.logoUrl)}" alt="" />` : esc(academy.mark)}</div>
    <p class="eyebrow">Convite</p>
    <h1>${esc(academy.shortName)}</h1>
    <p class="subtitle">
      ${esc(firstName(preview.name))}, foste convidado para a ${esc(academy.name)}
      ${preview.title ? `como <strong>${esc(preview.title)}</strong>` : ""}.
    </p>

    <!-- Passo 1: provar que é a pessoa. -->
    <section class="panel" id="step-identity">
      <div class="identity">
        <div class="row">
          <span class="k">Nome</span>
          <span class="v">${esc(preview.name)}</span>
        </div>
        <div class="row">
          <span class="k">E-mail</span>
          <span class="v">${esc(preview.email)}</span>
        </div>
      </div>
      <p class="hint">
        Definidos pela academia. Se algo estiver errado, fala com quem te convidou —
        o convite só funciona para este endereço.
      </p>

      <form id="accept-form" novalidate>
        ${preview.hasAccount ? existingAccountFields() : newAccountFields()}
        <button class="btn" type="submit" id="accept-submit">
          ${preview.hasAccount ? "Confirmar e entrar" : "Criar conta"}
        </button>
        <div id="accept-error" class="error" hidden></div>
      </form>
    </section>

    <!-- Passo 2: o que ficou com acesso. Mostra-se, não se escolhe. -->
    <section class="panel" id="step-done" hidden>
      <div class="done-mark" aria-hidden="true">✓</div>
      <h2 class="done-title">Conta criada</h2>
      <p class="done-sub">É isto que tens acesso na ${esc(academy.shortName)}.</p>

      <div class="grant">
        <div class="grant-row">
          <span class="k">Perfil</span>
          <span class="v">${esc(ROLE_LABEL[preview.role])}</span>
        </div>
        <p class="blurb">${esc(ROLE_BLURB[preview.role])}</p>
      </div>

      ${renderTeams(preview)}

      <button class="btn" type="button" id="enter">Entrar na consola</button>
      <div id="enter-error" class="error" hidden></div>
    </section>
  </div>
</main>

<footer>
  <span class="foot">${esc(academy.slug)}.academias.pt</span>
</footer>

<script>
(function () {
  var token = ${jsonForScript(token)};
  var email = ${jsonForScript(preview.email)};
  var slug = ${jsonForScript(academy.slug)};
  var consoleUrl = ${jsonForScript(consoleUrl)};
  var hasAccount = ${jsonForScript(preview.hasAccount)};

  var form = document.getElementById('accept-form');
  var submit = document.getElementById('accept-submit');
  var errorBox = document.getElementById('accept-error');
  var stepIdentity = document.getElementById('step-identity');
  var stepDone = document.getElementById('step-done');

  // Guardada só em memória, entre resgatar e entrar. Nunca toca no armazenamento.
  var chosenPassword = '';

  function fail(box, button, label, message) {
    box.textContent = message;
    box.hidden = false;
    if (button) { button.disabled = false; button.textContent = label; }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorBox.hidden = true;

    var password = document.getElementById('password').value;

    if (!hasAccount) {
      var confirm = document.getElementById('password2').value;
      if (password.length < 8) {
        fail(errorBox, null, null, 'A palavra-passe tem de ter pelo menos 8 caracteres.');
        return;
      }
      if (password !== confirm) {
        fail(errorBox, null, null, 'As duas palavras-passe não são iguais.');
        return;
      }
    }

    var phoneField = document.getElementById('phone');
    var phone = phoneField ? phoneField.value.trim() : '';

    submit.disabled = true;
    submit.textContent = 'Um momento…';

    fetch('/api/convites/' + encodeURIComponent(token) + '/aceitar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password, phone: phone || undefined }),
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok) {
          fail(errorBox, submit, hasAccount ? 'Confirmar e entrar' : 'Criar conta',
            res.body.message || 'Não foi possível concluir. Tenta outra vez.');
          return;
        }
        chosenPassword = password;
        stepIdentity.hidden = true;
        stepDone.hidden = false;
        window.scrollTo(0, 0);
      })
      .catch(function () {
        fail(errorBox, submit, hasAccount ? 'Confirmar e entrar' : 'Criar conta',
          'Não foi possível contactar o servidor.');
      });
  });

  // Entrar reaproveita a password que a pessoa acabou de escolher — pedi-la outra
  // vez dois segundos depois seria cerimónia, não segurança.
  var enter = document.getElementById('enter');
  var enterError = document.getElementById('enter-error');

  enter.addEventListener('click', function () {
    enterError.hidden = true;
    enter.disabled = true;
    enter.textContent = 'A entrar…';

    fetch(${jsonForScript(supabaseUrl)} + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: ${jsonForScript(supabaseAnonKey)}, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: chosenPassword }),
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok) {
          fail(enterError, enter, 'Entrar na consola', 'A conta foi criada. Entra pela página da academia.');
          return;
        }
        try {
          sessionStorage.setItem('academia.session', JSON.stringify({
            accessToken: res.body.access_token,
            refreshToken: res.body.refresh_token,
            academySlug: slug,
          }));
        } catch (err) { /* modo privado: a consola pede login */ }
        location.href = consoleUrl;
      })
      .catch(function () {
        fail(enterError, enter, 'Entrar na consola', 'Não foi possível entrar. Vai à página da academia.');
      });
  });
})();
</script>
</body>
</html>`;
}

/** Conta nova: escolher password, duas vezes. */
function newAccountFields(): string {
  return `<label class="field">
          <span>Palavra-passe</span>
          <input type="password" id="password" autocomplete="new-password" required minlength="8" />
        </label>
        <label class="field">
          <span>Repetir palavra-passe</span>
          <input type="password" id="password2" autocomplete="new-password" required minlength="8" />
        </label>
        <label class="field">
          <span>Telemóvel <em class="opt">opcional</em></span>
          <input type="tel" id="phone" autocomplete="tel" inputmode="tel" />
        </label>`;
}

/**
 * Conta que já existe — o pai que passa a treinador, ou quem treina em duas
 * academias. Não se cria conta nova nem se pede password nova: pede-se a que a
 * pessoa já tem, e é ao verificá-la que se prova que é ela.
 */
function existingAccountFields(): string {
  return `<p class="notice">
          Já tens conta com este e-mail. Confirma a tua palavra-passe atual e passas
          a ter também acesso a esta academia — a conta é a mesma.
        </p>
        <label class="field">
          <span>A tua palavra-passe</span>
          <input type="password" id="password" autocomplete="current-password" required />
        </label>`;
}

function renderTeams(preview: InvitePreview): string {
  if (preview.role !== "COACH" && preview.role !== "STAFF") return "";

  // Sem equipas não se finge que está tudo bem: quem entrar assim não vê atletas
  // nenhuns, e é melhor sabê-lo agora do que perante uma lista vazia.
  if (preview.teams.length === 0) {
    return `<div class="grant">
        <div class="grant-row"><span class="k">Equipas</span><span class="v">Nenhuma ainda</span></div>
        <p class="blurb">
          A direção ainda não te atribuiu equipas. Vais entrar na consola sem atletas
          à vista até isso acontecer.
        </p>
      </div>`;
  }

  return `<div class="grant">
        <div class="grant-row"><span class="k">Equipas</span><span class="v">${preview.teams.length}</span></div>
        <div class="teams">
          ${preview.teams.map((t) => `<span class="team">${esc(t.name)}</span>`).join("")}
        </div>
        <p class="blurb">
          Definidas pela academia. Vês os atletas, treinos e presenças destas equipas —
          para mudar, fala com a direção.
        </p>
      </div>`;
}

export function renderInviteError(): string {
  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Convite inválido</title>
<meta name="robots" content="noindex, nofollow" />
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f6f5f2; color: #1a1917;
    min-height: 100dvh; display: flex; align-items: center; justify-content: center; margin: 0; padding: 24px; }
  div { text-align: center; max-width: 340px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
  p { color: #8a867c; font-size: 14px; line-height: 1.55; margin: 0; }
</style>
</head>
<body>
  <div>
    <h1>Este convite já não é válido</h1>
    <p>
      Pode ter expirado, já ter sido usado, ou ter sido fechado pela academia.
      Pede um novo a quem te convidou.
    </p>
  </div>
</body>
</html>`;
}

function styles(paleta: ClubPalette): string {
  const signal = paleta.club;
  return `  :root {
    --canvas: #f6f5f2;
    --surface: #ffffff;
    --sunken: #efede8;
    --line: #e5e2dc;
    --ink: #1a1917;
    --ink-2: #524f48;
    --ink-3: #8a867c;
    --signal: ${signal};
    /*
     * A cor do clube, escurecida.
     *
     * Da profundidade aos estilhacos e serve onde tem de haver branco por cima:
     * um clube amarelo com texto branco e ilegivel, e este mix poe qualquer tom
     * abaixo desse limiar. Gemea de --club-deep na pagina de socios e de
     * --signal-deep na pagina do clube.
     */
    --signal-deep: ${paleta.deep};
    --signal-strong: ${paleta.strong};
    --signal-on: ${paleta.on};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh; display: flex; flex-direction: column;
    background: var(--canvas); color: var(--ink-2);
    font-family: "Instrument Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 40px 20px 24px;
    position: relative; overflow: hidden;
  }

  /* ====================================================================
     Estilhacos — a mesma linguagem grafica da pagina de socios
     ====================================================================

     Esta pagina era branca e sem cor nenhuma: quem abre o convite para montar um
     clube encontrava um formulario cinzento, e a primeira impressao do produto
     era essa. Os estilhacos poem a cor do clube em volta **sem nunca a por por
     baixo de texto** — o conteudo vive sempre sobre branco, e por isso funciona
     igual com um amarelo e com um azul-marinho. */

  .shards { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .shards i { position: absolute; display: block; }

  .s1 { width: 190px; height: 130px; left: -46px; bottom: 14%;
        background: var(--signal); clip-path: polygon(0 0, 100% 42%, 30% 100%); opacity: .9; }
  .s2 { width: 150px; height: 190px; left: 44px; bottom: 4%;
        background: var(--signal-deep); clip-path: polygon(0 22%, 100% 0, 62% 100%); opacity: .85; }
  .s3 { width: 92px; height: 62px; left: 132px; bottom: 30%;
        background: var(--signal); clip-path: polygon(0 50%, 100% 0, 78% 100%); opacity: .45; }
  .s4 { width: 210px; height: 150px; right: -60px; top: 15%;
        background: var(--signal); clip-path: polygon(0 0, 100% 50%, 26% 100%); opacity: .5; }
  .s5 { width: 160px; height: 210px; right: 30px; top: 32%;
        background: var(--signal-deep); clip-path: polygon(30% 0, 100% 30%, 0 100%); opacity: .65; }
  .s6 { width: 120px; height: 84px; right: -20px; bottom: 12%;
        background: var(--signal); clip-path: polygon(0 30%, 100% 0, 60% 100%); opacity: .35; }

  /* Abaixo destas larguras os estilhacos passariam por cima do cartao. */
  @media (max-width: 1240px) { .s4, .s5 { display: none; } }
  @media (max-width: 980px) {
    .s3 { display: none; }
    .s1, .s2 { transform: scale(.5); transform-origin: left bottom; opacity: .35; }
    .s6 { transform: scale(.5); transform-origin: right bottom; opacity: .22; }
  }

  .card {
    position: relative; z-index: 1;
    width: 100%; max-width: 440px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 22px;
    padding: 38px 34px 30px;
    box-shadow: 0 1px 2px rgba(26,25,23,.04), 0 24px 56px -26px rgba(26,25,23,.24);
  }
  /* Os paineis interiores perdem a moldura: ja estao dentro de uma. */
  .card .panel { border: 0; padding: 0; background: none; }

  .mark {
    /* Escurecida, para as iniciais brancas lerem com qualquer cor de clube. */
    /* A caixa das iniciais leva a tinta que se le nela — ver common/contrast.ts. */
    width: 64px; height: 64px; border-radius: 20px; background: var(--signal-strong); color: var(--signal-on);
    overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 20px; margin: 0 auto 20px; letter-spacing: -0.01em;
  }
  /* Com emblema nao ha caixa: a forma e a do emblema. */
  .mark.logo { background: none; border-radius: 0; }
  .mark.logo img { width: 100%; height: 100%; object-fit: contain; }

  .eyebrow {
    text-align: center; font-size: 11px; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--ink-3); margin: 0 0 6px;
  }
  h1 { text-align: center; font-size: 26px; font-weight: 600; letter-spacing: -0.02em; color: var(--ink); margin: 0 0 8px; }
  .subtitle { text-align: center; font-size: 14px; line-height: 1.5; color: var(--ink-3); margin: 0 0 26px; }
  .subtitle strong { color: var(--ink-2); font-weight: 600; }
  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 20px; }

  .identity { border: 1px solid var(--line); border-radius: 11px; overflow: hidden; }
  .identity .row {
    display: flex; align-items: baseline; justify-content: space-between; gap: 14px;
    padding: 11px 13px; background: var(--sunken); border-bottom: 1px solid var(--line);
  }
  .identity .row:last-child { border-bottom: 0; }
  .k { font-size: 12.5px; color: var(--ink-3); flex-shrink: 0; }
  .v { font-size: 14px; font-weight: 600; color: var(--ink); text-align: right; word-break: break-word; }
  .hint { font-size: 12px; line-height: 1.5; color: var(--ink-3); margin: 9px 2px 18px; }

  label.field { display: block; margin-bottom: 10px; }
  label.field span { display: block; font-size: 12.5px; font-weight: 500; color: var(--ink); margin-bottom: 5px; }
  .opt { font-style: normal; font-weight: 400; color: var(--ink-3); }
  .field input {
    width: 100%; height: 42px; padding: 0 11px; border: 1px solid var(--line);
    border-radius: 10px; background: var(--surface); font: inherit; font-size: 15px; color: var(--ink);
  }
  .field input:focus { outline: 2px solid var(--signal); outline-offset: 1px; border-color: transparent; }

  .btn {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    height: 48px; border-radius: 12px; background: var(--ink); color: #fff;
    font-family: inherit; font-weight: 600; font-size: 15px; border: 0;
    width: 100%; margin-top: 14px; cursor: pointer;
  }
  .btn:active { opacity: 0.85; }
  .btn:disabled { background: var(--ink-3); cursor: default; opacity: 0.6; }

  .notice {
    margin: 0 0 16px; padding: 10px 12px; background: var(--sunken);
    border-radius: 10px; font-size: 12.5px; line-height: 1.5; color: var(--ink-2);
  }
  .error {
    margin-top: 10px; padding: 9px 11px; background: #fae9e7; color: #a82a20;
    border-radius: 9px; font-size: 12.5px; line-height: 1.45;
  }

  .done-mark {
    width: 40px; height: 40px; border-radius: 999px; background: #e6f2e9; color: #1f7a45;
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; font-weight: 700; margin: 2px auto 12px;
  }
  .done-title { text-align: center; font-size: 18px; font-weight: 600; color: var(--ink); margin: 0 0 4px; }
  .done-sub { text-align: center; font-size: 13px; color: var(--ink-3); margin: 0 0 18px; }

  .grant { border: 1px solid var(--line); border-radius: 11px; padding: 12px 13px; margin-bottom: 10px; }
  .grant-row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; }
  .blurb { font-size: 12.5px; line-height: 1.5; color: var(--ink-3); margin: 7px 0 0; }
  .teams { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .team {
    background: var(--sunken); border-radius: 999px; padding: 4px 10px;
    font-size: 12.5px; font-weight: 600; color: var(--ink);
  }

  footer { padding: 20px; text-align: center; }
  .foot { font-size: 12px; color: var(--ink-3); }`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * `JSON.stringify` seguro para **dentro de um `<script>`**.
 *
 * O `JSON.stringify` normal escapa aspas mas não `</script>` — o parser HTML vê
 * essa sequência e fecha o bloco de script, deixando o resto executar como HTML.
 * Um email malicioso como `x</script><script>alert(1)</script>@e.pt` explorava
 * exactamente isto.
 *
 * Escapa-se `<`, `>`, `&` e os separadores de linha Unicode (U+2028/U+2029, que o
 * JSON permite mas o JavaScript não) para a sua forma `\uXXXX`. O resultado
 * continua a ser JSON válido e já não consegue quebrar o contexto de script. É a
 * segunda linha de defesa — o regex de email é a primeira.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

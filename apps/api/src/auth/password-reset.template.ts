import { clubPalette } from "../common/contrast";
import type { AcademyBranding } from "../landing/landing.template";

/**
 * A página onde se escolhe a palavra-passe nova.
 *
 * É o destino do link de `passwordResetEmail`. Gerada no servidor, como a landing
 * e o convite, e pela mesma razão: abre-se uma vez, num telemóvel qualquer, e são
 * dois campos.
 *
 * ## O token nunca chega ao nosso servidor
 *
 * O link é `/repor-palavra-passe#t=…`. O fragmento não vai no pedido HTTP — não
 * fica em logs de acesso nem em cabeçalhos `Referer` — e é o browser que o troca
 * por uma sessão directamente no Supabase. A palavra-passe nova também vai directa
 * para lá: a nossa API não vê palavras-passe de login, e esta porta não é excepção.
 *
 * ## O token só se gasta ao guardar
 *
 * Os filtros de correio (o Safe Links do Outlook, os antivírus das empresas)
 * abrem os links dos emails antes da pessoa. Se abrir a página gastasse o token, o
 * link chegava morto a quem o pediu. Um robô abre a página; não escreve duas
 * palavras-passe iguais e carrega em guardar.
 *
 * ## Para onde vai a seguir
 *
 * Depende de onde foi pedido (`a=` no fragmento):
 *
 *   - `console` — o login da página do clube. Entra na consola, se a conta for de
 *     staff deste clube.
 *   - `family` — o login da app. Abre a app já com sessão.
 *   - `invite` — um convite a meio. **Não entra**. O convite só se completa com a
 *     palavra-passe escrita no próprio convite, e é aí que se cria a ligação ao
 *     clube ou ao educando. Uma sessão aberta aqui saltava esse passo: a app via
 *     sessão, deixava de mostrar o convite, e a ligação nunca chegava a ser feita.
 *
 * (Nenhuma crase no HTML abaixo: vive dentro de um template literal.)
 */
export function renderPasswordReset(opts: {
  academy: AcademyBranding;
  consoleUrl: string;
  familyUrl: string;
  landingUrl: string;
  /** A anon key é pública por desenho — é a que o browser usa para autenticar. */
  supabaseUrl: string;
  supabaseAnonKey: string;
}): string {
  const { academy, consoleUrl, familyUrl, landingUrl, supabaseUrl, supabaseAnonKey } = opts;
  const paleta = clubPalette(academy.signalColor);

  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Palavra-passe · ${esc(academy.shortName)}</title>
<meta name="theme-color" content="${paleta.club}" />
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="no-referrer" />

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

<style>
  :root {
    --canvas: #f6f5f2; --surface: #ffffff; --sunken: #efede8; --line: #e5e2dc;
    --ink: #1a1917; --ink-2: #524f48; --ink-3: #8a867c;
    --signal: ${paleta.club}; --signal-deep: ${paleta.deep};
    --signal-strong: ${paleta.strong}; --signal-on: ${paleta.on};
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
    padding: 40px 20px 24px; position: relative; overflow: hidden;
  }

  /* Os estilhacos da cor do clube — a mesma linguagem do convite e da landing. */
  .shards { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .shards i { position: absolute; display: block; }
  .s1 { width: 190px; height: 130px; left: -46px; bottom: 14%;
        background: var(--signal); clip-path: polygon(0 0, 100% 42%, 30% 100%); opacity: .9; }
  .s2 { width: 150px; height: 190px; left: 44px; bottom: 4%;
        background: var(--signal-deep); clip-path: polygon(0 22%, 100% 0, 62% 100%); opacity: .85; }
  .s4 { width: 210px; height: 150px; right: -60px; top: 15%;
        background: var(--signal); clip-path: polygon(0 0, 100% 50%, 26% 100%); opacity: .5; }
  .s6 { width: 120px; height: 84px; right: -20px; bottom: 12%;
        background: var(--signal); clip-path: polygon(0 30%, 100% 0, 60% 100%); opacity: .35; }
  @media (max-width: 1240px) { .s4 { display: none; } }
  @media (max-width: 980px) {
    .s1, .s2 { transform: scale(.5); transform-origin: left bottom; opacity: .35; }
    .s6 { transform: scale(.5); transform-origin: right bottom; opacity: .22; }
  }

  .card {
    position: relative; z-index: 1; width: 100%; max-width: 420px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 22px;
    padding: 38px 34px 30px;
    box-shadow: 0 1px 2px rgba(26,25,23,.04), 0 24px 56px -26px rgba(26,25,23,.24);
  }
  .mark {
    width: 64px; height: 64px; border-radius: 20px; background: var(--signal-strong); color: var(--signal-on);
    overflow: hidden; display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 20px; margin: 0 auto 20px; letter-spacing: -0.01em;
  }
  .mark.logo { background: none; border-radius: 0; }
  .mark.logo img { width: 100%; height: 100%; object-fit: contain; }
  .eyebrow {
    text-align: center; font-size: 11px; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--ink-3); margin: 0 0 6px;
  }
  h1 { text-align: center; font-size: 26px; font-weight: 600; letter-spacing: -0.02em; color: var(--ink); margin: 0 0 8px; }
  .subtitle { text-align: center; font-size: 14px; line-height: 1.5; color: var(--ink-3); margin: 0 0 24px; }

  label.field { display: block; margin-bottom: 10px; }
  label.field span { display: block; font-size: 12.5px; font-weight: 500; color: var(--ink); margin-bottom: 5px; }
  .field input {
    width: 100%; height: 44px; padding: 0 11px; border: 1px solid var(--line);
    border-radius: 10px; background: var(--surface); font: inherit; font-size: 16px; color: var(--ink);
  }
  .field input:focus { outline: 2px solid var(--signal); outline-offset: 1px; border-color: transparent; }

  .btn {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    height: 48px; border-radius: 12px; background: var(--ink); color: #fff;
    font-family: inherit; font-weight: 600; font-size: 15px; border: 0; text-decoration: none;
    width: 100%; margin-top: 14px; cursor: pointer;
  }
  .btn:active { opacity: 0.85; }
  .btn:disabled { background: var(--ink-3); cursor: default; opacity: 0.6; }
  .link-quiet {
    display: block; margin: 16px auto 0; text-align: center; font-size: 13px;
    color: var(--ink-3); text-decoration: none;
  }
  .link-quiet:hover { color: var(--ink); }
  .error {
    margin-top: 10px; padding: 9px 11px; background: #fae9e7; color: #a82a20;
    border-radius: 9px; font-size: 12.5px; line-height: 1.45;
  }
  .state { text-align: center; }
  .state-mark {
    width: 40px; height: 40px; border-radius: 999px; display: flex; align-items: center; justify-content: center;
    font-size: 20px; font-weight: 700; margin: 2px auto 12px;
  }
  .state-mark.ok { background: #e6f2e9; color: #1f7a45; }
  .state-mark.dead { background: var(--sunken); color: var(--ink-3); }
  .state h2 { font-size: 18px; font-weight: 600; color: var(--ink); margin: 0 0 6px; }
  .state p { font-size: 13.5px; line-height: 1.5; color: var(--ink-3); margin: 0 auto; max-width: 32ch; }

  footer { padding: 20px; text-align: center; }
  .foot { font-size: 12px; color: var(--ink-3); }
</style>
</head>
<body>
<main>
  <div class="shards" aria-hidden="true"><i class="s1"></i><i class="s2"></i><i class="s4"></i><i class="s6"></i></div>

  <div class="card">
    <div class="mark${academy.logoUrl ? " logo" : ""}">${academy.logoUrl ? `<img src="${esc(academy.logoUrl)}" alt="" />` : esc(academy.mark)}</div>
    <p class="eyebrow">${esc(academy.shortName)}</p>

    <section id="step-form">
      <h1>Palavra-passe nova</h1>
      <p class="subtitle">Escolhe a palavra-passe com que vais passar a entrar.</p>
      <form id="reset-form" novalidate>
        <label class="field">
          <span>Palavra-passe nova</span>
          <input type="password" id="password" autocomplete="new-password" minlength="8" required />
        </label>
        <label class="field">
          <span>Repetir palavra-passe</span>
          <input type="password" id="password2" autocomplete="new-password" minlength="8" required />
        </label>
        <button class="btn" type="submit" id="reset-submit">Guardar palavra-passe</button>
        <div id="reset-error" class="error" hidden></div>
      </form>
    </section>

    <section id="step-dead" class="state" hidden>
      <div class="state-mark dead" aria-hidden="true">!</div>
      <h2>Este link já não serve</h2>
      <p>Os links para repor a palavra-passe valem uma hora e só se usam uma vez. Pede outro no ecrã de entrada.</p>
      <a class="btn" href="${esc(landingUrl)}">Ir para a página do clube</a>
    </section>

    <section id="step-done" class="state" hidden>
      <div class="state-mark ok" aria-hidden="true">✓</div>
      <h2>Palavra-passe alterada</h2>
      <p id="done-sub"></p>
      <button class="btn" type="button" id="done-go" hidden></button>
      <div id="done-error" class="error" hidden></div>
      <a class="link-quiet" href="${esc(landingUrl)}">Página do clube</a>
    </section>
  </div>
</main>

<footer><span class="foot">${esc(academy.slug)}.academias.pt</span></footer>

<script>
(function () {
  var supabaseUrl = ${jsonForScript(supabaseUrl)};
  var anonKey = ${jsonForScript(supabaseAnonKey)};
  var slug = ${jsonForScript(academy.slug)};
  var consoleUrl = ${jsonForScript(consoleUrl)};
  var familyUrl = ${jsonForScript(familyUrl)};
  var KEY = 'academia.reposicao';

  var stepForm = document.getElementById('step-form');
  var stepDead = document.getElementById('step-dead');
  var stepDone = document.getElementById('step-done');
  var form = document.getElementById('reset-form');
  var submit = document.getElementById('reset-submit');
  var errorBox = document.getElementById('reset-error');
  var go = document.getElementById('done-go');
  var doneSub = document.getElementById('done-sub');
  var doneError = document.getElementById('done-error');

  function mostrar(qual) {
    stepForm.hidden = qual !== 'form';
    stepDead.hidden = qual !== 'dead';
    stepDone.hidden = qual !== 'done';
  }

  /*
    O token sai do endereco no instante em que e lido — nao fica no historico
    nem numa captura de ecra. Fica no armazenamento do separador, e so por uma
    razao: um F5 antes de guardar nao pode deitar o link fora.
  */
  var pedido = null;
  var hash = location.hash.charAt(0) === '#' ? location.hash.slice(1) : '';
  if (hash) {
    var params = new URLSearchParams(hash);
    if (params.get('t')) pedido = { t: params.get('t'), a: params.get('a') };
    history.replaceState(null, '', location.pathname + location.search);
    try { if (pedido) sessionStorage.setItem(KEY, JSON.stringify(pedido)); } catch (e) {}
  }
  if (!pedido) {
    try { pedido = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { pedido = null; }
  }
  function esquecer() { try { sessionStorage.removeItem(KEY); } catch (e) {} }

  if (!pedido || !pedido.t) { mostrar('dead'); return; }
  var origem = pedido.a === 'family' || pedido.a === 'invite' ? pedido.a : 'console';
  document.getElementById('password').focus();

  var sessao = null;

  function lerJson(r) {
    return r.json()
      .catch(function () { return {}; })
      .then(function (b) { return { ok: r.ok, status: r.status, body: b || {} }; });
  }

  function fail(box, button, label, message) {
    box.textContent = message;
    box.hidden = false;
    if (button) { button.disabled = false; button.textContent = label; }
  }

  /* O token do email por uma sessao. Uma vez so: um segundo "guardar" (a
     palavra-passe foi recusada por fraca) reaproveita a sessao que ja ha. */
  function trocarToken() {
    if (sessao) return Promise.resolve(sessao);
    return fetch(supabaseUrl + '/auth/v1/verify', {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'recovery', token_hash: pedido.t }),
    })
      .then(lerJson)
      .then(function (res) {
        if (!res.ok || !res.body.access_token) return null;
        sessao = res.body;
        return sessao;
      });
  }

  function traduzir(body) {
    var code = body.error_code || '';
    var msg = String(body.msg || body.message || body.error_description || '');
    if (code === 'same_password' || /different from the old/i.test(msg)) {
      return 'A palavra-passe nova tem de ser diferente da anterior.';
    }
    if (code === 'weak_password' || /weak|at least/i.test(msg)) {
      return 'Essa palavra-passe é fraca de mais. Experimenta uma mais longa, com letras e números.';
    }
    return 'Não foi possível guardar a palavra-passe. Tenta outra vez.';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorBox.hidden = true;

    var password = document.getElementById('password').value;
    var confirmacao = document.getElementById('password2').value;
    if (password.length < 8) {
      fail(errorBox, null, null, 'A palavra-passe tem de ter pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirmacao) {
      fail(errorBox, null, null, 'As duas palavras-passe não são iguais.');
      return;
    }

    submit.disabled = true;
    submit.textContent = 'A guardar…';

    trocarToken()
      .then(function (s) {
        if (!s) { esquecer(); mostrar('dead'); return; }
        return fetch(supabaseUrl + '/auth/v1/user', {
          method: 'PUT',
          headers: { apikey: anonKey, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password }),
        })
          .then(lerJson)
          .then(function (res) {
            if (!res.ok) { fail(errorBox, submit, 'Guardar palavra-passe', traduzir(res.body)); return; }
            esquecer();
            concluir();
          });
      })
      .catch(function () {
        fail(errorBox, submit, 'Guardar palavra-passe', 'Não foi possível contactar o servidor. Tenta outra vez.');
      });
  });

  function concluir() {
    mostrar('done');
    window.scrollTo(0, 0);

    if (origem === 'invite') {
      doneSub.textContent = 'Volta ao convite e escreve lá a palavra-passe nova para continuar.';
      /* A sessao desta troca nao vai ser usada — fecha-se ja, em vez de a
         deixar viva no Supabase ate expirar. */
      fetch(supabaseUrl + '/auth/v1/logout', {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: 'Bearer ' + sessao.access_token },
      }).catch(function () {});
      return;
    }

    doneSub.textContent = origem === 'family' ? 'Já podes usar a app.' : 'Já podes entrar na consola.';
    go.textContent = origem === 'family' ? 'Abrir a app' : 'Entrar na consola';
    go.hidden = false;
  }

  function trimSlash(url) {
    return url.charAt(url.length - 1) === '/' ? url.slice(0, -1) : url;
  }

  go.addEventListener('click', function () {
    doneError.hidden = true;

    /* A app: o mesmo formato de sessao que ela guarda, entregue no fragmento
       (ver adoptSessionFromUrl em apps/family/src/lib/session.ts). */
    if (origem === 'family') {
      var daApp = { accessToken: sessao.access_token, refreshToken: sessao.refresh_token };
      try {
        localStorage.setItem('academia.family.session', JSON.stringify(daApp));
        localStorage.setItem('academia.family.slug', slug);
      } catch (e) { /* segue no fragmento na mesma */ }
      location.href = familyUrl + '#s=' + encodeURIComponent(btoa(JSON.stringify(daApp)));
      return;
    }

    /* A consola: a mesma porta da landing — so entra quem e staff deste clube. */
    go.disabled = true;
    go.textContent = 'A entrar…';
    fetch('/auth/memberships', { headers: { Authorization: 'Bearer ' + sessao.access_token } })
      .then(lerJson)
      .then(function (res) {
        var meus = (res.body.academies || []).filter(function (a) { return a.slug === slug; });
        var daStaff = meus.filter(function (a) { return a.role !== 'GUARDIAN' && a.role !== 'ATHLETE'; });
        if (daStaff.length === 0) {
          fail(doneError, go, 'Entrar na consola', meus.length
            ? 'Esta conta é de família: entra pela aplicação do clube.'
            : 'A palavra-passe foi alterada, mas esta conta não tem acesso à consola deste clube.');
          return;
        }
        var session = { accessToken: sessao.access_token, refreshToken: sessao.refresh_token, academySlug: slug };
        try { localStorage.setItem('academia.session', JSON.stringify(session)); } catch (e) {}
        var sameOrigin = consoleUrl.charAt(0) === '/' || consoleUrl.indexOf(location.origin) === 0;
        location.href = sameOrigin
          ? consoleUrl
          : trimSlash(consoleUrl) + '/#s=' + encodeURIComponent(btoa(JSON.stringify(session)));
      })
      .catch(function () {
        fail(doneError, go, 'Entrar na consola', 'Não foi possível entrar. Vai à página do clube.');
      });
  });
})();
</script>
</body>
</html>`;
}

export function renderPasswordResetNotFound(): string {
  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Academia não encontrada</title>
<meta name="robots" content="noindex, nofollow" />
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f6f5f2; color: #1a1917;
    min-height: 100dvh; display: flex; align-items: center; justify-content: center; margin: 0; padding: 24px; }
  div { text-align: center; max-width: 320px; }
  p { color: #8a867c; font-size: 14px; }
</style>
</head>
<body>
  <div>
    <h1>Academia não encontrada</h1>
    <p>Este endereço não corresponde a nenhuma academia.</p>
  </div>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Um valor para dentro de um `<script>` — gémea da de `invite.template.ts` (VULN-004). */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

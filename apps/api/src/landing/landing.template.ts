/**
 * A landing page da academia.
 *
 * Não é uma página de marketing — é o que substitui a mensagem de WhatsApp com
 * uma referência MB perdida a meio de uma conversa. O link é o que a academia
 * envia aos pais; tem de ter OG tags a sério (por isso é HTML gerado no servidor,
 * não uma SPA — o preview do WhatsApp não executa JavaScript) e tem de fazer duas
 * coisas muito distintas sem as confundir:
 *
 *   1. Para um pai: instalar a app. É a única acção que interessa, por isso é a
 *      única em destaque.
 *   2. Para um treinador ou diretor: entrar na consola. Existe, mas fica pequeno
 *      e no fundo — um pai nunca deve sentir que "entrar" é para ele. Não há
 *      formulário de login aqui: a consola trata da autenticação, esta página só
 *      aponta para lá.
 *
 * `renderLanding` é uma função pura — sem Nest, sem Prisma — para se poder testar
 * e rever isoladamente. `landing.controller.ts` é a única coisa que sabe que isto
 * corre dentro de um pedido HTTP.
 */

export type AcademyBranding = {
  slug: string;
  name: string;
  shortName: string;
  /** Duas letras para a marca sem logótipo — o mesmo badge que a consola e a PWA usam. */
  mark: string;
  signalColor: string;
  logoUrl?: string;

  /* --- O que o clube escreveu para a página de adesão ---------------------
     Ausentes significa "usa o que o produto traz por omissão". Ver `Academy`. */
  membershipHeadline?: string;
  membershipIntro?: string;
  membershipPoints?: string[];
};

export type Platform = "ios" | "android" | "other";

/**
 * Telemóvel ou computador.
 *
 * Decide **qual das duas composições** a página usa, e a diferença não é só de
 * layout — é de prioridade. No telemóvel, o pai é quem chega, e a única acção que
 * interessa é instalar. No computador, quem chega é staff: um pai não vai gerir a
 * mensalidade do filho no portátil, e o "instalar app" ali seria um beco sem saída
 * (a PWA das famílias é para o telemóvel).
 *
 * Feito no servidor e não por media query porque muda o conteúdo, não a
 * apresentação. Uma media query obrigaria a mandar as duas para o browser e a
 * esconder uma — e a escondida continuaria a ser lida por leitores de ecrã.
 */
function isDesktop(userAgent: string): boolean {
  return !/iphone|ipad|ipod|android|mobile|tablet/i.test(userAgent);
}

/**
 * "Instalar" não é um botão universal: o iOS não tem `beforeinstallprompt`, só
 * "Partilhar → Adicionar ao ecrã principal" dentro do Safari. Decide-se no
 * servidor, a partir do User-Agent, para a pessoa nunca ver instruções erradas
 * — nem por um instante, como aconteceria se isto fosse decidido só no cliente.
 */
export function detectPlatform(userAgent: string): Platform {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "other";
}

/** Muitos links de WhatsApp abrem dentro do próprio WhatsApp, não no Safari — e
 *  "Adicionar ao ecrã principal" só existe no Safari a sério. */
function opensInAppBrowser(userAgent: string): boolean {
  return /fban|fbav|instagram|whatsapp|line\/|micromessenger/i.test(userAgent);
}

export function renderLanding(opts: {
  academy: AcademyBranding;
  platform: Platform;
  userAgent: string;
  pageUrl: string;
  familyUrl: string;
  consoleUrl: string;
  /** Onde autenticar. A `anonKey` é pública por desenho — é o que o browser usa. */
  supabaseUrl: string;
  supabaseAnonKey: string;
  /**
   * Chegou por um link de convite de família (`/familia/:token`).
   *
   * Isto decide a composição de computador com mais força do que o dispositivo:
   * um convite de família **é sempre** sobre um pai a instalar a app, mesmo que o
   * link tenha sido aberto num portátil — a caminho do telemóvel, colado num
   * email, ou só a testar. Sem esta distinção, esse pai caía no ecrã de login de
   * staff, que é o beco sem saída que esta página inteira existe para evitar.
   */
  hasFamilyInvite?: boolean;
}): string {
  const { academy, platform, pageUrl, familyUrl, consoleUrl, supabaseUrl, supabaseAnonKey } = opts;
  const inAppBrowser = opensInAppBrowser(opts.userAgent);
  const desktop = isDesktop(opts.userAgent);
  const familyInviteOnDesktop = desktop && Boolean(opts.hasFamilyInvite);
  const name = esc(academy.name);
  const shortName = esc(academy.shortName);
  const signal = /^#[0-9a-f]{6}$/i.test(academy.signalColor) ? academy.signalColor : "#0f6b62";

  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${name}</title>
<meta name="description" content="A aplicação oficial da ${name}. Treinos, pagamentos e o progresso do teu atleta, tudo num sítio só." />
<meta name="theme-color" content="${signal}" />

<meta property="og:type" content="website" />
<meta property="og:title" content="${name}" />
<meta property="og:description" content="Instala a aplicação oficial da ${name} — treinos, pagamentos e o progresso do teu atleta." />
<meta property="og:url" content="${esc(pageUrl)}" />
${academy.logoUrl ? `<meta property="og:image" content="${esc(academy.logoUrl)}" />` : ""}
<meta name="twitter:card" content="summary" />

<!--
  Sem estas duas linhas o browser não sabe que existe uma app aqui: oferece um
  atalho simples, que abre com a barra do browser à volta. É o manifest (mais o
  service worker registado abaixo) que faz o Chrome tratar isto como instalável e
  o display "standalone" do manifest que tira a moldura ao abrir.
  A PWA e a landing partilham origem de propósito, por isso partilham o manifest.
-->
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icon-192.png" />
<link rel="icon" href="/icon-192.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="${shortName}" />

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

<style>
  :root {
    --canvas: #f6f5f2;
    --surface: #ffffff;
    --sunken: #efede8;
    --line: #e5e2dc;
    --ink: #1a1917;
    --ink-2: #524f48;
    --ink-3: #8a867c;
    --signal: ${signal};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--canvas);
    color: var(--ink-2);
    font-family: "Instrument Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 20px 24px;
  }
  .card {
    width: 100%;
    max-width: 400px;
  }
  .mark {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: var(--signal);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 20px;
    margin: 0 auto 20px;
    letter-spacing: -0.01em;
  }
  .eyebrow {
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin: 0 0 6px;
  }
  h1 {
    text-align: center;
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--ink);
    margin: 0 0 8px;
  }
  .subtitle {
    text-align: center;
    font-size: 14px;
    line-height: 1.5;
    color: var(--ink-3);
    margin: 0 0 28px;
  }
  .panel {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 20px;
  }
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 48px;
    border-radius: 12px;
    background: var(--ink);
    color: #fff;
    font-weight: 600;
    font-size: 15px;
    text-decoration: none;
    width: 100%;
  }
  .btn { border: 0; font-family: inherit; cursor: pointer; }
  .btn:active { opacity: 0.85; }
  .btn:disabled { background: var(--ink-3); cursor: default; opacity: 0.6; }
  .steps {
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: step;
  }
  .steps li {
    counter-increment: step;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
    font-size: 13.5px;
    line-height: 1.45;
    color: var(--ink-2);
  }
  .steps li:last-child { border-bottom: 0; }
  .steps li::before {
    content: counter(step);
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: var(--sunken);
    color: var(--ink);
    font-size: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .steps strong { color: var(--ink); font-weight: 600; }
  .notice {
    margin-top: 14px;
    padding: 10px 12px;
    background: var(--sunken);
    border-radius: 10px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--ink-2);
  }
  footer {
    padding: 20px;
    text-align: center;
  }
  /* ---- Composição de computador: ecrã dividido ---------------------------- */
  body.desktop { display: block; }
  .split {
    display: grid;
    grid-template-columns: minmax(420px, 1fr) 1.15fr;
    min-height: 100dvh;
  }
  .split-form {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 48px 64px;
    background: var(--surface);
  }
  .split-form .inner { width: 100%; max-width: 360px; margin: 0 auto; }
  .split-form h1 { text-align: left; font-size: 28px; margin-bottom: 6px; }
  .split-form .subtitle { text-align: left; margin-bottom: 30px; }

  /*
   * O painel de marca. A cor é a do tenant — é o que torna esta página única por
   * clube sem precisar de nenhum ficheiro por academia. Cor sólida e não
   * gradiente: o gradiente é a escolha por omissão de toda a gente, e um campo
   * de cor chapada com tipografia grande tem mais presença e envelhece melhor.
   */
  .split-brand {
    position: relative;
    background: var(--signal);
    color: #fff;
    padding: 56px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  }
  .split-brand .academy-name {
    font-size: clamp(34px, 3.6vw, 52px);
    line-height: 1.05;
    font-weight: 600;
    letter-spacing: -0.03em;
    margin: 0;
    max-width: 11ch;
  }
  .split-brand .claim {
    margin: 18px 0 0;
    font-size: 16px;
    line-height: 1.5;
    opacity: 0.82;
    max-width: 34ch;
  }
  .split-brand .foot { font-size: 12.5px; opacity: 0.6; }
  /* Uma marca de água discreta, para o campo de cor não ficar chapado. */
  .split-brand::after {
    content: "";
    position: absolute;
    right: -110px; bottom: -140px;
    width: 460px; height: 460px;
    border-radius: 50%;
    background: rgba(255,255,255,0.07);
  }

  .install-aside {
    margin-top: 26px; padding-top: 20px; border-top: 1px solid var(--line);
    font-size: 13px; color: var(--ink-3); line-height: 1.5;
  }
  .install-aside a { color: var(--ink); font-weight: 600; }

  /* [hidden] perde para qualquer display: inline, por isso o display do modal
     tem de vir daqui — nunca de style="" no próprio elemento. */
  #install-modal:not([hidden]) { display: flex; }

  @media (max-width: 900px) {
    .split { grid-template-columns: 1fr; }
    .split-brand { display: none; }
    .split-form { padding: 36px 24px; }
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 22px 0 18px;
    color: var(--ink-3);
    font-size: 12px;
  }
  .divider::before, .divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--line);
  }
  label.field { display: block; margin-bottom: 10px; }
  label.field span {
    display: block;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--ink);
    margin-bottom: 5px;
  }
  .field input {
    width: 100%;
    height: 42px;
    padding: 0 11px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    font: inherit;
    font-size: 15px;
    color: var(--ink);
  }
  .field input:focus { outline: 2px solid var(--signal); outline-offset: 1px; border-color: transparent; }
  .btn-quiet {
    display: flex; align-items: center; justify-content: center;
    height: 46px; border-radius: 11px; width: 100%;
    background: var(--surface); border: 1px solid var(--line);
    color: var(--ink); font: inherit; font-weight: 600; font-size: 15px;
    cursor: pointer;
  }
  .btn-quiet:disabled { opacity: 0.55; cursor: default; }
  .error {
    margin-top: 10px;
    padding: 9px 11px;
    background: #fae9e7;
    color: #a82a20;
    border-radius: 9px;
    font-size: 12.5px;
    line-height: 1.45;
  }
  .staff-link {
    font-size: 12.5px;
    color: var(--ink-3);
    text-decoration: none;
  }
  .staff-link:hover { color: var(--ink-2); }
</style>
</head>
<body class="${desktop ? "desktop" : ""}">
${
  familyInviteOnDesktop
    ? renderDesktopFamilyInvite(academy, shortName, name, pageUrl)
    : desktop
      ? renderDesktop(academy, shortName, name)
      : renderMobile(academy, shortName, platform, inAppBrowser, familyUrl)
}

<script>
(function () {
  var appUrl = ${jsonForScript(familyUrl)};
  var consoleUrl = ${jsonForScript(consoleUrl)};
  var supabaseUrl = ${jsonForScript(supabaseUrl)};
  var anonKey = ${jsonForScript(supabaseAnonKey)};
  var slug = ${jsonForScript(academy.slug)};

  // Se esta página já está a correr como app instalada (aconteceu se o telemóvel
  // guardou a landing em vez da app — iOS antigo faz isso), não faz sentido pedir
  // para instalar outra vez: salta já para a aplicação, em ecrã inteiro.
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) { location.replace(appUrl); return; }

  // No computador o formulário está sempre visível: dá-lhe o foco de imediato.
  if (document.body.classList.contains('desktop')) {
    var first = document.getElementById('email');
    if (first) first.focus();
  }

  // O service worker é metade do critério de instalabilidade — sem ele o Chrome
  // não dispara 'beforeinstallprompt' e só oferece um atalho de browser.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }

  var desktop = document.body.classList.contains('desktop');
  var btn = document.getElementById('install');
  var note = document.getElementById('install-note');
  var manual = document.getElementById('install-manual');
  var prompt = null;
  var armed = false;

  window.addEventListener('beforeinstallprompt', function (e) {
    // Impede a mini-barra do Chrome: queremos o nosso botão a controlar o momento.
    e.preventDefault();
    prompt = e;
    armed = true;
    if (btn) btn.disabled = false;
    if (note) note.textContent = 'Fica no teu ecrã principal, como qualquer outra app.';
    if (manual) manual.hidden = true;
  });

  if (btn) {
    btn.addEventListener('click', function () {
      if (!prompt) return;
      prompt.prompt();
      prompt.userChoice.then(function (choice) {
        if (choice.outcome !== 'accepted') {
          if (note) note.textContent = 'A instalação foi cancelada. Podes tentar outra vez.';
          if (btn) btn.disabled = false;
        }
        prompt = null;
      });
      if (btn) btn.disabled = true;
    });
  }

  window.addEventListener('appinstalled', function () {
    // Sem "abrir app": a partir daqui a única porta é o ícone no ecrã principal.
    if (btn) { btn.textContent = 'Instalada'; btn.disabled = true; }
    if (note) note.textContent = 'Pronto. Abre a app pelo ícone no teu ecrã principal.';
    if (manual) manual.hidden = true;
    prompt = null;
  });

  // O Chrome não dispara 'beforeinstallprompt' se a app já estiver instalada, nem
  // em browsers que não suportam instalação. Ao fim de alguns segundos sem evento,
  // mostramos o caminho manual em vez de deixar um botão morto sem explicação.
  // No computador não há botão de instalar, por isso não há nada a explicar.
  if (!desktop) {
    setTimeout(function () {
      if (armed) return;
      if (note) note.textContent = 'Este browser não oferece instalação automática.';
      if (manual) manual.hidden = false;
    }, 3500);
  }

  /* ---------------------------------------------------------------------- */
  /* Entrada de staff                                                        */
  /* ---------------------------------------------------------------------- */

  var installPanel = document.getElementById('install-panel');
  var loginPanel = document.getElementById('login-panel');
  var showLogin = document.getElementById('show-login');
  var form = document.getElementById('login-form');
  var errorBox = document.getElementById('login-error');
  var submit = document.getElementById('login-submit');

  // Alternância entre instalar e entrar — só na composição de telemóvel, onde
  // os dois painéis disputam o mesmo espaço.
  if (showLogin && loginPanel && installPanel) {
    showLogin.addEventListener('click', function () {
      var opening = loginPanel.hidden;
      loginPanel.hidden = !opening;
      installPanel.hidden = opening;
      showLogin.textContent = opening
        ? '← Afinal quero instalar a app'
        : 'És treinador, diretor ou do departamento clínico? Entrar →';
      if (opening) document.getElementById('email').focus();
    });
  }

  // Copiar o link do convite — só existe na composição de computador com convite
  // de família; nas outras, os elementos não existem e este bloco não faz nada.
  var linkInput = document.getElementById('family-link');
  var linkCopy = document.getElementById('family-link-copy');
  var linkNote = document.getElementById('family-link-note');
  if (linkInput && linkCopy) {
    linkCopy.addEventListener('click', function () {
      var done = function () {
        linkCopy.textContent = 'Copiado';
        if (linkNote) linkNote.hidden = false;
        setTimeout(function () { linkCopy.textContent = 'Copiar link'; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(linkInput.value).then(done).catch(function () {
          linkInput.select();
        });
      } else {
        // Sem navigator.clipboard (contexto não seguro, navegador antigo):
        // seleccionar o texto é o que resta — a pessoa copia com Ctrl+C.
        linkInput.select();
      }
    });
  }

  // No computador, "como instalar" é uma explicação e não uma acção: a app das
  // famílias não se instala num portátil.
  var showInstall = document.getElementById('show-install');
  var installModal = document.getElementById('install-modal');
  var closeInstall = document.getElementById('close-install');
  if (showInstall && installModal) {
    showInstall.addEventListener('click', function (e) { e.preventDefault(); installModal.hidden = false; });
    closeInstall.addEventListener('click', function () { installModal.hidden = true; });
    installModal.addEventListener('click', function (e) { if (e.target === installModal) installModal.hidden = true; });
  }

  function trimSlash(url) {
    return url.charAt(url.length - 1) === '/' ? url.slice(0, -1) : url;
  }

  function fail(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    submit.disabled = false;
    submit.textContent = 'Entrar';
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorBox.hidden = true;
      submit.disabled = true;
      submit.textContent = 'A entrar…';

      var email = document.getElementById('email').value.trim();
      var password = document.getElementById('password').value;

      // Autenticação directa contra o Supabase: a password nunca passa pelo nosso
      // servidor, e é o Supabase que devolve o token assinado.
      fetch(supabaseUrl + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password }),
      })
        .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
        .then(function (res) {
          if (!res.ok) {
            fail(res.body.error_description || res.body.msg || 'E-mail ou palavra-passe incorrectos.');
            return;
          }

          // Ter sessão não chega: é preciso pertencer a **esta** academia. Quem
          // trabalha noutra não entra aqui só por ter conta válida.
          return fetch('/auth/memberships', {
            headers: { Authorization: 'Bearer ' + res.body.access_token },
          })
            .then(function (r) { return r.json(); })
            .then(function (me) {
              var here = (me.academies || []).filter(function (a) { return a.slug === slug; })[0];
              if (!here) {
                fail('Esta conta não tem acesso a esta academia.');
                return;
              }
              if (here.role === 'GUARDIAN' || here.role === 'ATHLETE') {
                fail('As famílias entram pela aplicação. Instala-a aqui em cima.');
                return;
              }

              var session = {
                accessToken: res.body.access_token,
                refreshToken: res.body.refresh_token,
                academySlug: slug,
              };

              /*
               * A consola lê a sessão daqui e não volta a pedir credenciais.
               *
               * localStorage e nao sessionStorage: o segundo e por separador, e com
               * ele um link para a ficha de um socio aberto em separador novo nascia
               * sem sessao e era mandado de volta para esta pagina. O custo esta
               * escrito no cabecalho de apps/console/src/lib/session.ts, e a
               * correccao definitiva e o cookie httpOnly de VULN-007.
               *
               * (Sem acentos nem crases: isto vive dentro de um template literal, e
               * uma crase aqui fecha a string a meio do ficheiro.)
               */
              try {
                localStorage.setItem('academia.session', JSON.stringify(session));
              } catch (err) { /* modo privado: segue no fragmento na mesma */ }

              /*
               * Entregar a sessão à consola.
               *
               * O sessionStorage é por origem. Em produção a consola vive neste
               * mesmo domínio e herda-a sozinha — a linha acima chega. Em
               * desenvolvimento está noutra porta, que é outra origem, e sem esta
               * entrega quem acabou de entrar era recebido por um segundo login.
               *
               * Vai no **fragmento**: não é enviado ao servidor, não aparece em
               * logs de acesso nem em cabeçalhos Referer. A consola apaga-o do URL
               * assim que o lê.
               */
              var sameOrigin = consoleUrl.indexOf(location.origin) === 0;
              location.href = sameOrigin
                ? consoleUrl
                : trimSlash(consoleUrl) + '/#s=' + encodeURIComponent(btoa(JSON.stringify(session)));
            });
        })
        .catch(function () { fail('Não foi possível contactar o servidor. Tenta outra vez.'); });
    });
  }
})();
</script>
</body>
</html>`;
}

/**
 * Computador: ecrã dividido, login em primeiro plano.
 *
 * Quem abre isto num portátil é staff. O convite para instalar a app fica como
 * nota de rodapé do formulário, porque a app das famílias é do telemóvel — pô-la
 * em destaque aqui seria mandar alguém para um beco.
 */
function renderDesktop(academy: AcademyBranding, shortName: string, name: string): string {
  return `  <div class="split">
    <section class="split-form">
      <div class="inner">
        <div class="mark" style="margin:0 0 26px">${esc(academy.mark)}</div>
        <h1>Entrar</h1>
        <p class="subtitle">Consola da ${name}</p>

        ${loginForm()}

        <p class="install-aside">
          És encarregado de educação? A tua área é a aplicação no telemóvel —
          <a href="#" id="show-install">como instalar</a>.
        </p>
      </div>
    </section>

    <aside class="split-brand">
      <div>
        <p class="eyebrow" style="text-align:left;color:rgba(255,255,255,0.7);margin-bottom:14px">
          ${esc(academy.slug)}.academias.pt
        </p>
        <h2 class="academy-name">${shortName}</h2>
        <p class="claim">
          Treinos, presenças, mensalidades e o percurso de cada atleta tudo num sítio só. A aplicação oficial da ${name}.
        </p>
      </div>

      <p class="foot">Uma academia, um endereço. Cada clube tem o seu.</p>
    </aside>
  </div>

  <!-- Instruções de instalação, escondidas até alguém as pedir no desktop. -->
  <div id="install-modal" hidden style="position:fixed;inset:0;background:rgba(26,25,23,0.35);align-items:center;justify-content:center;padding:24px">
    <div class="panel" style="max-width:420px;width:100%">
      <p class="eyebrow" style="text-align:left">Aplicação das famílias</p>
      <h2 style="font-size:19px;margin:2px 0 10px;color:var(--ink)">Instala no telemóvel</h2>
      <p class="subtitle" style="text-align:left;margin-bottom:16px">
        Abre <strong style="color:var(--ink)">${esc(academy.slug)}.academias.pt</strong> no telemóvel
        e segue as instruções. A app é feita para o telemóvel — no computador não há o que instalar.
      </p>
      <button class="btn-quiet" type="button" id="close-install">Fechar</button>
    </div>
  </div>`;
}

/**
 * Computador, mas com um convite de família na mão.
 *
 * ## Porque é que isto não é `renderDesktop`
 *
 * `renderDesktop` parte do princípio de que quem abriu o link é staff — é a
 * aposta certa para `clube.academias.pt` sozinho. Mas um convite de família
 * (`?convite=...`) já respondeu a essa pergunta: só um pai o recebe. Mostrar-lhe
 * um formulário de login sobre isso era ignorar a única coisa que já se sabe
 * sobre quem está a olhar para o ecrã.
 *
 * A acção aqui não é instalar — não se instala uma PWA de telemóvel num
 * computador — é **levar o link para o telemóvel**: copiar e colar numa
 * mensagem, ou abrir directamente se, afinal, isto está a correr num telemóvel
 * que o `User-Agent` não apanhou (acontece com alguns navegadores em modo
 * ambiente de trabalho).
 *
 * O login de staff continua acessível — reaproveita os mesmos `id`s
 * (`show-login`, `install-panel`, `login-panel`) que a versão de telemóvel usa,
 * por isso o alternar entre os dois já funciona sem JavaScript novo.
 */
function renderDesktopFamilyInvite(academy: AcademyBranding, shortName: string, name: string, pageUrl: string): string {
  return `  <div class="split">
    <section class="split-form">
      <div class="inner">
        <div class="mark" style="margin:0 0 26px">${esc(academy.mark)}</div>

        <div id="install-panel">
          <p class="eyebrow" style="text-align:left">Convite da família</p>
          <h1>Abre isto no teu telemóvel</h1>
          <p class="subtitle" style="text-align:left">
            A aplicação da ${name} é feita para o telemóvel. Copia o link e abre-o lá — numa mensagem a ti
            próprio, no WhatsApp, ou no email.
          </p>

          <div class="panel">
            <label class="field" style="margin-bottom:10px">
              <span>O teu link</span>
              <input type="text" id="family-link" value="${esc(pageUrl)}" readonly />
            </label>
            <button class="btn" type="button" id="family-link-copy">Copiar link</button>
            <div class="notice" id="family-link-note" hidden>Copiado. Já podes colá-lo no telemóvel.</div>
          </div>

          <ol class="steps" style="margin-top:22px">
            <li>Abre o link no teu telemóvel</li>
            <li>Instala a app da <strong>${shortName}</strong> a partir daí</li>
            <li>Dentro da app, cria conta e identifica o teu filho pelo NIF e data de nascimento</li>
          </ol>
        </div>

        <div class="panel" id="login-panel" hidden>
          ${loginForm()}
        </div>

        <p class="install-aside">
          <button type="button" class="staff-link" id="show-login" style="text-align:left;padding:0">
            És treinador, diretor ou do departamento clínico? Entrar →
          </button>
        </p>
      </div>
    </section>

    <aside class="split-brand">
      <div>
        <p class="eyebrow" style="text-align:left;color:rgba(255,255,255,0.7);margin-bottom:14px">
          ${esc(academy.slug)}.academias.pt
        </p>
        <h2 class="academy-name">${shortName}</h2>
        <p class="claim">
          Treinos, convocatórias, presenças e mensalidades — tudo o que precisas de saber sobre o teu filho, na
          app oficial da ${name}.
        </p>
      </div>

      <p class="foot">Uma academia, um endereço. Cada clube tem o seu.</p>
    </aside>
  </div>`;
}

/**
 * Telemóvel: instalar primeiro, entrar depois.
 *
 * A ordem é a prioridade. Um pai abre isto e tem uma acção; o staff que entre pelo
 * telemóvel encontra o login a um toque, no fundo.
 */
function renderMobile(
  academy: AcademyBranding,
  shortName: string,
  platform: Platform,
  inAppBrowser: boolean,
  familyUrl: string,
): string {
  return `  <main>
    <div class="card">
      <div class="mark" aria-hidden="true">${esc(academy.mark)}</div>
      <p class="eyebrow">Instalar aplicação</p>
      <h1>${shortName}</h1>
      <p class="subtitle">Treinos, pagamentos e o progresso do teu atleta — tudo num sítio só.</p>

      <div class="panel" id="install-panel">
        ${renderInstall(platform, inAppBrowser, familyUrl)}
      </div>

      <div class="panel" id="login-panel" hidden>
        ${loginForm()}
      </div>
    </div>
  </main>

  <footer>
    <button type="button" class="staff-link" id="show-login">
      És treinador, diretor ou do departamento clínico? Entrar →
    </button>
  </footer>`;
}

/** O mesmo formulário nas duas composições — uma só implementação a manter. */
function loginForm(): string {
  return `<form id="login-form" novalidate>
          <label class="field">
            <span>E-mail</span>
            <input type="email" id="email" autocomplete="username" required />
          </label>
          <label class="field">
            <span>Palavra-passe</span>
            <input type="password" id="password" autocomplete="current-password" required />
          </label>
          <button class="btn" type="submit" id="login-submit" style="margin-top:14px">Entrar</button>
          <div id="login-error" class="error" hidden></div>
        </form>`;
}

function renderInstall(platform: Platform, inAppBrowser: boolean, familyUrl: string): string {
  if (inAppBrowser) {
    return `
      <p class="subtitle" style="margin-bottom:0">
        Este link abriu dentro de outra aplicação. Toca no menu (⋮ ou •••) e escolhe
        <strong style="color:var(--ink)">"Abrir no navegador"</strong> para poderes instalar.
      </p>`;
  }

  if (platform === "ios") {
    // O iOS não tem `beforeinstallprompt` — nenhum botão consegue instalar por si.
    // A única via é o menu Partilhar do Safari, por isso não fingimos um botão
    // que não funcionaria: mostramos os passos reais.
    return `
      <ol class="steps">
        <li>Toca no ícone de <strong>Partilhar</strong> na barra do Safari</li>
        <li>Escolhe <strong>"Adicionar ao ecrã principal"</strong></li>
        <li>Toca em <strong>"Adicionar"</strong> — a app fica no teu ecrã</li>
      </ol>
      <div class="notice">Tens de estar no Safari para veres esta opção — não funciona noutro navegador no iPhone.</div>`;
  }

  // Deliberadamente um <button>, não um <a href>: não existe forma de "abrir no
  // browser" a partir daqui. A app dos pais é para ser instalada e aberta a partir
  // do ecrã principal — e a própria PWA recusa-se a correr fora do modo instalado
  // (ver apps/family/src/StandaloneGate.tsx), por isso um link seria uma porta
  // para lado nenhum.
  return `
    <button class="btn" id="install" type="button" disabled>Instalar app</button>
    <div class="notice" id="install-note">A preparar a instalação…</div>
    <div class="notice" id="install-manual" hidden>
      Se o botão não ficar disponível, abre o menu <strong>⋮</strong> do Chrome e escolhe
      <strong>"Instalar aplicação"</strong>. Se já a instalaste, abre-a pelo ícone no ecrã principal.
    </div>`;
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
 * `JSON.stringify` seguro para dentro de um `<script>` — escapa `</script>` e os
 * separadores de linha Unicode. Ver a versão gémea em `invite.template.ts` para o
 * porquê. Duplicado de propósito: os dois templates não devem depender um do outro.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

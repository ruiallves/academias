import type { AcademyBranding } from "./landing.template";

/**
 * "Faz-te sócio" — a página pública de inscrição.
 *
 * HTML gerado no servidor, como a landing e pelas mesmas razões: o link viaja por
 * WhatsApp e por redes sociais, e um preview sem OG tags é um link que ninguém
 * abre. Também não há aqui nada que justifique carregar uma SPA — é um formulário.
 *
 * ## O formulário é longo. Não há como o encurtar.
 *
 * São os dados que uma direção precisa para emitir um cartão e passar um recibo, e
 * é por isso que **todos** os campos são obrigatórios: um formulário com metade
 * opcional produz fichas por preencher, e alguém acaba ao telefone a pedir o NIF
 * que faltava. O que se pode fazer — e está feito — é dividi-lo em três blocos com
 * nome, para quem preenche saber sempre onde está e quanto falta.
 *
 * ## A escolha da categoria vem primeiro
 *
 * Antes de qualquer campo. Escolher o tipo de sócio é a única decisão da página;
 * tudo o resto é transcrição de um cartão de cidadão. Pô-la no fim, depois de
 * quinze campos, seria pedir a decisão a quem já está cansado — e é a decisão que
 * determina quanto a pessoa vai pagar.
 */

export type PublicTier = {
  id: string;
  name: string;
  description: string | null;
  benefits: string[];
  feeCents: number | null;
  period: "MONTHLY" | "QUARTERLY" | "ANNUAL" | "ONCE";
  minAge: number | null;
  maxAge: number | null;
};

const PERIOD_LABEL: Record<PublicTier["period"], string> = {
  MONTHLY: "/mês",
  QUARTERLY: "/trimestre",
  ANNUAL: "/ano",
  ONCE: "uma vez",
};

export function renderMembershipPage(opts: {
  academy: AcademyBranding;
  tiers: PublicTier[];
  pageUrl: string;
  apiOrigin: string;
}): string {
  const { academy, tiers, pageUrl, apiOrigin } = opts;
  const title = `Faz-te sócio do ${academy.shortName}`;
  const description = `Inscrição de sócio do ${academy.name}. Escolhe a categoria e preenche os teus dados.`;

  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="theme-color" content="${esc(academy.signalColor)}" />

<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(pageUrl)}" />

<style>
  :root {
    --signal: ${esc(academy.signalColor)};
    --canvas: #f6f5f2;
    --surface: #ffffff;
    --sunken: #efede8;
    --line: #e5e2dc;
    --line-strong: #d3cfc6;
    --ink: #1a1917;
    --ink-2: #524f48;
    --ink-3: #8a867c;
    --ink-4: #ada89d;
    --risk: #a82a20;
    --ok: #1f7a45;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--canvas); color: var(--ink-2);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 15px; line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 0 20px 80px; }

  header.top { display: flex; align-items: center; gap: 12px; padding: 24px 0 32px; }
  .mark {
    width: 38px; height: 38px; border-radius: 11px; background: var(--signal); color: #fff;
    display: grid; place-items: center; font-weight: 700; font-size: 14px; flex: none;
  }
  .mark img { width: 100%; height: 100%; object-fit: cover; border-radius: 11px; }
  .top b { display: block; color: var(--ink); font-size: 15px; }
  .top span { display: block; color: var(--ink-3); font-size: 12.5px; }

  h1 { margin: 0 0 8px; font-size: 34px; line-height: 1.1; letter-spacing: -0.03em; color: var(--ink); font-weight: 600; }
  .lede { margin: 0 0 28px; color: var(--ink-2); max-width: 46ch; }

  fieldset { border: 0; margin: 0 0 24px; padding: 0; }
  legend { padding: 0; margin-bottom: 4px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); font-weight: 600; }
  .req { color: var(--ink-4); font-size: 12.5px; margin: 0 0 14px; }

  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 20px; }

  .grid { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; }
  .grid .full { grid-column: 1 / -1; }
  @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } .grid .full { grid-column: auto; } }

  label { display: block; }
  label > span { display: block; font-size: 12.5px; font-weight: 600; color: var(--ink); margin-bottom: 5px; }
  input[type=text], input[type=email], input[type=date], input[type=tel], select {
    width: 100%; height: 42px; padding: 0 11px; font: inherit; font-size: 15px;
    color: var(--ink); background: var(--surface);
    border: 1px solid var(--line-strong); border-radius: 8px; appearance: none;
  }
  input:focus, select:focus { outline: 2px solid var(--signal); outline-offset: -1px; border-color: var(--signal); }
  input[aria-invalid="true"] { border-color: var(--risk); }

  /* O código postal são dois campos porque são dois números com significados
     diferentes — e porque um separador impresso ensina o formato sem instruções. */
  .cp { display: flex; align-items: center; gap: 8px; }
  .cp input { text-align: center; }
  .cp .dash { color: var(--ink-4); }
  .cp .four { flex: 1 1 0; }
  .cp .three { flex: 0 0 78px; }

  .tel { display: flex; gap: 8px; }
  .tel select { flex: 0 0 106px; }
  .tel input { flex: 1 1 0; }

  /* --- Categorias ---------------------------------------------------------- */

  .tiers { display: grid; gap: 10px; }
  .tier { position: relative; }
  .tier input { position: absolute; inset: 0; opacity: 0; cursor: pointer; margin: 0; }
  .tier label, .tier .face {
    display: block; border: 1px solid var(--line-strong); border-radius: 12px;
    padding: 16px 18px; background: var(--surface); cursor: pointer;
  }
  .tier input:checked + .face { border-color: var(--signal); box-shadow: inset 0 0 0 1px var(--signal); }
  .tier input:focus-visible + .face { outline: 2px solid var(--signal); outline-offset: 2px; }
  .tier .row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; }
  .tier .name { font-weight: 600; color: var(--ink); font-size: 16px; }
  .tier .price { font-weight: 600; color: var(--signal); white-space: nowrap; }
  .tier .price small { color: var(--ink-3); font-weight: 500; }
  .tier .desc { margin: 4px 0 0; font-size: 13.5px; color: var(--ink-3); }
  .tier ul { margin: 10px 0 0; padding-left: 18px; font-size: 13px; color: var(--ink-2); }
  .tier li { margin-bottom: 2px; }
  .tier .age { display: inline-block; margin-top: 8px; font-size: 12px; color: var(--ink-3); background: var(--sunken); padding: 2px 8px; border-radius: 999px; }

  /* --- Consentimentos ------------------------------------------------------ */

  .check { display: flex; gap: 11px; align-items: flex-start; padding: 11px 0; border-bottom: 1px solid var(--line); }
  .check:last-child { border-bottom: 0; }
  .check input { width: 19px; height: 19px; flex: none; margin: 1px 0 0; accent-color: var(--signal); }
  .check span { font-size: 13.5px; color: var(--ink-2); }
  .check a { color: var(--signal); }
  .check .must { color: var(--ink); font-weight: 500; }

  /* --- Acção --------------------------------------------------------------- */

  button[type=submit] {
    width: 100%; height: 50px; margin-top: 8px; font: inherit; font-size: 16px; font-weight: 600;
    color: #fff; background: var(--ink); border: 0; border-radius: 10px; cursor: pointer;
  }
  button[type=submit]:disabled { background: var(--ink-4); cursor: not-allowed; }

  .error { margin-top: 12px; padding: 11px 14px; border-radius: 9px; background: #fae9e7; color: var(--risk); font-size: 13.5px; }
  .error:empty { display: none; }

  /* --- Depois de enviar ---------------------------------------------------- */

  #done { display: none; text-align: center; padding: 60px 0; }
  #done .tick { width: 56px; height: 56px; border-radius: 50%; background: #e6f2e9; color: var(--ok);
    display: grid; place-items: center; margin: 0 auto 18px; font-size: 26px; }
  #done h2 { margin: 0 0 8px; font-size: 26px; color: var(--ink); letter-spacing: -0.02em; }
  #done p { margin: 0 auto; max-width: 40ch; color: var(--ink-3); }

  footer { margin-top: 36px; text-align: center; color: var(--ink-4); font-size: 12.5px; }
</style>
</head>
<body>
<div class="wrap">

  <header class="top">
    <div class="mark">${academy.logoUrl ? `<img src="${esc(academy.logoUrl)}" alt="" />` : esc(academy.mark)}</div>
    <div>
      <b>${esc(academy.shortName)}</b>
      <span>Inscrição de sócio</span>
    </div>
  </header>

  <main id="form-wrap">
    <h1>Faz-te sócio</h1>
    <p class="lede">
      Escolhe a categoria, preenche os teus dados e a direção do ${esc(academy.shortName)}
      trata do resto. Recebes o número de sócio quando a inscrição for aprovada.
    </p>

    <form id="f" novalidate>

      ${tiers.length > 0 ? renderTiers(tiers) : ""}

      <fieldset>
        <legend>Os teus dados</legend>
        <p class="req">Todos os campos são obrigatórios.</p>

        <div class="panel grid">
          <label class="full"><span>Nome completo</span>
            <input type="text" name="name" autocomplete="name" required minlength="3" />
          </label>

          <label><span>E-mail</span>
            <input type="email" name="email" autocomplete="email" required />
          </label>

          <label><span>Data de nascimento</span>
            <input type="date" name="birthdate" autocomplete="bday" required />
          </label>

          <label class="full"><span>País</span>
            <select name="country">
              <option value="PT" selected>Portugal</option>
              <option value="ES">Espanha</option>
              <option value="FR">França</option>
              <option value="GB">Reino Unido</option>
              <option value="CH">Suíça</option>
              <option value="LU">Luxemburgo</option>
              <option value="BR">Brasil</option>
              <option value="OT">Outro</option>
            </select>
          </label>

          <label class="full"><span>Morada</span>
            <input type="text" name="address" autocomplete="street-address" required minlength="3" />
          </label>

          <label><span>Código postal</span>
            <span class="cp">
              <input class="four" type="text" name="cp4" inputmode="numeric" maxlength="4" placeholder="0000" required />
              <span class="dash">–</span>
              <input class="three" type="text" name="cp3" inputmode="numeric" maxlength="3" placeholder="000" required />
            </span>
          </label>

          <label><span>Cidade</span>
            <input type="text" name="city" autocomplete="address-level2" required minlength="2" />
          </label>

          <label class="full"><span>Telemóvel</span>
            <span class="tel">
              <select name="phoneCountry" aria-label="Indicativo">
                <option value="+351" selected>+351</option>
                <option value="+34">+34</option>
                <option value="+33">+33</option>
                <option value="+44">+44</option>
                <option value="+41">+41</option>
                <option value="+352">+352</option>
                <option value="+55">+55</option>
              </select>
              <input type="tel" name="phone" autocomplete="tel-national" inputmode="tel" required />
            </span>
          </label>

          <label><span>Sexo</span>
            <select name="sex">
              <option value="FEMALE">Feminino</option>
              <option value="MALE">Masculino</option>
              <option value="UNSPECIFIED" selected>Prefiro não dizer</option>
            </select>
          </label>

          <label><span>Tipo de documento</span>
            <select name="documentKind">
              <option value="CC" selected>Cartão de cidadão</option>
              <option value="PASSPORT">Passaporte</option>
              <option value="RESIDENCE">Título de residência</option>
              <option value="OTHER">Outro</option>
            </select>
          </label>

          <label><span>N.º de documento</span>
            <input type="text" name="documentNumber" required minlength="4" />
          </label>

          <label><span>N.º de contribuinte</span>
            <input type="text" name="taxId" inputmode="numeric" maxlength="9" placeholder="000000000" required />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Autorizações</legend>
        <div class="panel">
          <label class="check">
            <input type="checkbox" name="acceptTerms" required />
            <span class="must">Concordo com os <a href="#termos">termos e condições</a>.</span>
          </label>
          <label class="check">
            <input type="checkbox" name="partnerComms" />
            <span>Autorizo que o ${esc(academy.shortName)} me envie comunicações comerciais dos parceiros oficiais.</span>
          </label>
          <label class="check">
            <input type="checkbox" name="partnerData" />
            <span>Autorizo a partilha dos meus dados com os parceiros oficiais do ${esc(academy.shortName)} para envio de comunicações comerciais.</span>
          </label>
        </div>
      </fieldset>

      <button type="submit" id="submit">Enviar inscrição</button>
      <div class="error" id="err" role="alert"></div>
    </form>
  </main>

  <div id="done">
    <div class="tick">✓</div>
    <h2 id="done-title">Inscrição enviada</h2>
    <p>
      A direção do ${esc(academy.shortName)} vai analisá-la. Recebes o número de sócio
      por e-mail assim que for aprovada.
    </p>
  </div>

  <footer>${esc(academy.name)}</footer>
</div>

<script>
(function () {
  var API = ${jsonForScript(apiOrigin)};
  var SLUG = ${jsonForScript(academy.slug)};

  var form = document.getElementById("f");
  var btn = document.getElementById("submit");
  var err = document.getElementById("err");

  // O código postal avança sozinho para o segundo campo. É o único automatismo
  // da página: quem escreve "1234" espera que o cursor salte, e não saltar
  // obriga a tirar a mão do teclado a meio de um número.
  var cp4 = form.cp4, cp3 = form.cp3;
  cp4.addEventListener("input", function () {
    cp4.value = cp4.value.replace(/\\D/g, "");
    if (cp4.value.length === 4) cp3.focus();
  });
  cp3.addEventListener("input", function () { cp3.value = cp3.value.replace(/\\D/g, ""); });
  form.taxId.addEventListener("input", function () { form.taxId.value = form.taxId.value.replace(/\\D/g, ""); });

  function fail(message, field) {
    err.textContent = message;
    if (field) { field.setAttribute("aria-invalid", "true"); field.focus(); }
    btn.disabled = false;
    btn.textContent = "Enviar inscrição";
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    err.textContent = "";
    [].forEach.call(form.querySelectorAll("[aria-invalid]"), function (el) { el.removeAttribute("aria-invalid"); });

    var tier = form.querySelector('input[name=tierId]:checked');

    // Validação no cliente para dar a resposta no sítio certo — mas o servidor
    // valida tudo outra vez. Esta metade é conveniência; a que conta é a de lá.
    if (!form.name.value.trim() || form.name.value.trim().length < 3) return fail("Escreve o nome completo.", form.name);
    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(form.email.value)) return fail("O e-mail não parece válido.", form.email);
    if (!form.birthdate.value) return fail("Falta a data de nascimento.", form.birthdate);
    if (!form.address.value.trim()) return fail("Falta a morada.", form.address);
    if (cp4.value.length !== 4 || cp3.value.length !== 3) return fail("O código postal tem o formato 0000-000.", cp4);
    if (!form.city.value.trim()) return fail("Falta a cidade.", form.city);
    if (!/^[0-9\\s]{6,15}$/.test(form.phone.value)) return fail("O telemóvel não parece válido.", form.phone);
    if (!form.documentNumber.value.trim()) return fail("Falta o número do documento.", form.documentNumber);
    if (!/^[0-9]{9}$/.test(form.taxId.value)) return fail("O contribuinte tem nove dígitos.", form.taxId);
    if (!form.acceptTerms.checked) return fail("É preciso aceitar os termos e condições.", form.acceptTerms);

    btn.disabled = true;
    btn.textContent = "A enviar…";

    fetch(API + "/api/clubes/" + encodeURIComponent(SLUG) + "/socios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tierId: tier ? tier.value : undefined,
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        birthdate: form.birthdate.value,
        country: form.country.value === "OT" ? "PT" : form.country.value,
        address: form.address.value.trim(),
        postalCode: cp4.value + "-" + cp3.value,
        city: form.city.value.trim(),
        phoneCountry: form.phoneCountry.value,
        phone: form.phone.value.trim(),
        sex: form.sex.value,
        documentKind: form.documentKind.value,
        documentNumber: form.documentNumber.value.trim(),
        taxId: form.taxId.value,
        acceptTerms: true,
        partnerComms: form.partnerComms.checked,
        partnerData: form.partnerData.checked
      })
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok) {
          var m = res.body && res.body.message;
          return fail(Array.isArray(m) ? m[0] : (m || "Não foi possível enviar a inscrição."));
        }
        document.getElementById("form-wrap").style.display = "none";
        var done = document.getElementById("done");
        if (res.body && res.body.name) {
          document.getElementById("done-title").textContent = "Obrigado, " + res.body.name;
        }
        done.style.display = "block";
        window.scrollTo(0, 0);
      })
      .catch(function () { fail("Falhou a ligação. Tenta outra vez."); });
  });
})();
</script>
</body>
</html>`;
}

/* -------------------------------------------------------------------------- */

function renderTiers(tiers: PublicTier[]): string {
  return `
      <fieldset>
        <legend>Categoria de sócio</legend>
        <p class="req">Escolhe a que te serve. Podes mudar mais tarde falando com o clube.</p>
        <div class="tiers">
          ${tiers
            .map(
              (t, i) => `
          <div class="tier">
            <input type="radio" name="tierId" id="t-${esc(t.id)}" value="${esc(t.id)}" ${i === 0 ? "checked" : ""} />
            <div class="face">
              <div class="row">
                <span class="name">${esc(t.name)}</span>
                <span class="price">${
                  t.feeCents === null
                    ? '<small>a definir</small>'
                    : `${money(t.feeCents)} <small>${PERIOD_LABEL[t.period]}</small>`
                }</span>
              </div>
              ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ""}
              ${
                t.benefits.length
                  ? `<ul>${t.benefits.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`
                  : ""
              }
              ${ageLabel(t) ? `<span class="age">${esc(ageLabel(t)!)}</span>` : ""}
            </div>
          </div>`,
            )
            .join("")}
        </div>
      </fieldset>`;
}

function ageLabel(t: PublicTier): string | null {
  if (t.minAge != null && t.maxAge != null) return `dos ${t.minAge} aos ${t.maxAge} anos`;
  if (t.minAge != null) return `a partir dos ${t.minAge} anos`;
  if (t.maxAge != null) return `até aos ${t.maxAge} anos`;
  return null;
}

function money(cents: number): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", minimumFractionDigits: 0 }).format(
    cents / 100,
  );
}

/** Gémeo do de `landing.template.ts`. Ver VULN-004. */
function esc(s: string): string {
  return String(s).replace(/[<>&"']/g, (c) => {
    return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] ?? c;
  });
}

/**
 * Um valor para dentro de um `<script>`.
 *
 * `JSON.stringify` sozinho não chega: uma string com `</script>` fecha o bloco e
 * o resto vira HTML. Escapar `< > &` para `\\uXXXX` fecha isso. Ver VULN-004.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

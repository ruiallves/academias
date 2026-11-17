/**
 * A app está sempre na versão que o servidor serve, sem apagar o que a pessoa
 * está a escrever.
 *
 * ## O problema, tal como apareceu
 *
 * Duas pessoas do mesmo clube, o mesmo ecrã de "Entregar equipamento", e
 * comportamentos diferentes. Nenhuma delas tinha nada de errado na conta: uma
 * estava na versão de hoje e a outra na que tinha aberto há dias e nunca mais
 * fechou. Um separador aberto (ou uma app instalada no telemóvel, que no iOS
 * fica viva semanas) mantém em memória o JavaScript com que arrancou, e nada o
 * obriga a ir ver se há outro.
 *
 * Isto é pior do que uma avaria: é um produto que se comporta de duas maneiras
 * ao mesmo tempo, e quem dá apoio anda a caçar fantasmas — já aconteceu aqui.
 *
 * ## Como se descobre
 *
 * Cada build escreve um `version.json` ao lado do `index.html` e assina o
 * próprio bundle com o mesmo identificador (ver `scripts/vite-versao.mjs`). A
 * app pergunta pela versão do servidor **sem cache** em quatro momentos: ao
 * arrancar, quando o ecrã volta a estar à frente, quando a rede volta, e de
 * quinze em quinze minutos.
 *
 * ## Quando se recarrega
 *
 * Recarregar é a única saída honesta: um aviso "há uma versão nova, carrega
 * aqui" deixa a escolha a quem não tem como saber o que está a perder. Mas
 * recarregar **mal se descobre** apagava o formulário que alguém estivesse a
 * preencher no momento do deploy. Por isso recarrega-se no primeiro momento
 * seguro:
 *
 *  - **Ao arrancar**, já. A pessoa acabou de entrar e não há nada a perder.
 *  - **Ao voltar à app** depois de um minuto fora: é como abri-la outra vez.
 *  - **Ao sair da app** (outra app, ecrã bloqueado, outro separador), sem
 *    ninguém ver.
 *  - **Ao mudar de página**: em vez da navegação dentro da app, uma carga
 *    completa já para a página de destino. Por fora é igual a um toque normal.
 *
 * Nenhum destes acontece com trabalho por gravar (ver `haTrabalhoPorGravar`).
 * Passadas 24 horas com a versão nova à espera, ao sair da app recarrega-se na
 * mesma: alguém dias numa versão velha é o problema de onde isto partiu.
 *
 * ## O service worker
 *
 * A app da família é uma PWA, e o service worker guarda o `index.html` em
 * cache. Recarregar com o service worker antigo ao comando devolve o HTML
 * velho: a app "recarrega" e continua velha. Era isso que punha a faixa
 * "Actualizar" nos telemóveis a cada versão: o `update()` acaba quando o
 * service worker novo está descarregado, não quando toma conta da página, e a
 * recarga ia logo a seguir. Agora, mal se descobre a versão nova, pede-se o
 * service worker novo e espera-se pelo `controllerchange` (com `skipWaiting` e
 * `clientsClaim`, do `autoUpdate`). A recarga só fica disponível depois disso.
 *
 * ## O que impede um ciclo de recargas
 *
 * O identificador pelo qual já se recarregou fica no `sessionStorage`. Se, já
 * recarregada, a app continuar a ver uma versão diferente — um proxy a servir
 * HTML velho, um service worker preso —, não volta a recarregar: chama
 * `aoFicarVelha`, e quem a chamou mostra o aviso. Uma app a recarregar em ciclo
 * é pior do que uma app velha.
 */

/** O que o `version.json` de cada app tem. */
export type VersaoServida = { build: string };

export type VigiarVersaoOpcoes = {
  /**
   * O identificador com que **este** bundle foi compilado. Vem do `define` do
   * plugin (`__BUILD_ID__`).
   */
  atual: string;
  /**
   * Onde está o `version.json`. É o `base` da app: `/consola/`, `/app/`, `/`.
   * Em desenvolvimento não existe, e a vigilância desliga-se sozinha.
   */
  base: string;
  /**
   * Chamada quando há versão nova e a recarga não a resolveu. Por omissão
   * mostra a faixa de `avisoDeVersaoVelha`.
   */
  aoFicarVelha?: (novo: string) => void;
  /** De quanto em quanto tempo se pergunta, em milissegundos. */
  intervaloMs?: number;
};

const QUINZE_MINUTOS = 15 * 60 * 1000;
/** Duas perguntas seguidas não valem a pena: o utilizador troca de janela dez vezes por minuto. */
const ESPERA_MINIMA_MS = 30 * 1000;
/** Fora da app durante este tempo, voltar conta como abri-la de novo. */
const FORA_QUE_CONTA_MS = 60 * 1000;
/** O máximo que se espera pelo service worker novo antes de recarregar na mesma. */
const ESPERA_DO_SW_MS = 15 * 1000;
/** Ao fim disto com versão nova à espera, recarrega-se ao sair da app, haja o que houver. */
const TECTO_MS = 24 * 60 * 60 * 1000;

type Origem = "arranque" | "voltar" | "rede" | "relogio";

/* ── Trabalho por gravar ─────────────────────────────────────────────────── */

/** Escreveu-se num campo desde a última mudança de página. */
let escreveu = false;
/** Ecrãs que pediram para não recarregar enquanto estão abertos (ver `adiarRecarga`). */
let retencoes = 0;

/**
 * Um ecrã que não pode ser recarregado enquanto está aberto, mesmo sem campos
 * por gravar (o jogo ao vivo, por exemplo). Devolve a função que o liberta;
 * num componente React: `useEffect(() => adiarRecarga(), [])`.
 */
export function adiarRecarga(): () => void {
  retencoes += 1;
  let libertado = false;
  return () => {
    if (libertado) return;
    libertado = true;
    retencoes -= 1;
  };
}

/** Campos onde escrever não é trabalho que se perca: caixas de procura. */
function ignoravel(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return true;
  if (alvo.closest("[data-versao-ignorar]")) return true;
  if (alvo instanceof HTMLInputElement) {
    const tipo = alvo.type;
    if (tipo === "search") return true;
    if (alvo.getAttribute("role") === "combobox") return true;
  }
  return false;
}

/**
 * Há alguma coisa no ecrã que uma recarga apagaria?
 *
 * Detecção geral, para não ter de mexer em cada formulário: escreveu-se num
 * campo desde a última mudança de página, há uma janela aberta (quase todos os
 * formulários da consola vivem numa), ou um ecrã pediu explicitamente.
 */
function haTrabalhoPorGravar(): boolean {
  if (escreveu || retencoes > 0) return true;
  /* Os menus que abrem por cima (navegação, notificações) levam `data-versao-ignorar`: não guardam nada. */
  const janela = 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
  return Array.from(document.querySelectorAll(janela)).some((el) => !el.closest("[data-versao-ignorar]"));
}

/* ── Service worker ──────────────────────────────────────────────────────── */

const esperar = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Põe o service worker novo ao comando da página antes de recarregar.
 *
 * Sem service worker (consola, plataforma) não há nada a fazer. Com ele, pede-se
 * o novo e espera-se que tome conta (`controllerchange`). Se não houver nenhum a
 * instalar depois do `update()`, o que está já é o da versão nova (o browser
 * também os procura sozinho). O tecto de espera impede que um service worker
 * avariado deixe a app velha para sempre: recarrega-se na mesma, e o guarda do
 * `sessionStorage` trata do resto.
 */
async function prepararServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
  try {
    const mudou = new Promise<void>((resolve) =>
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }),
    );
    const registos = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registos.map((reg) => reg.update()));
    const aCaminho = registos.some((reg) => reg.installing || reg.waiting);
    if (!aCaminho) return;
    await Promise.race([mudou, esperar(ESPERA_DO_SW_MS)]);
  } catch {
    /* Ignorado de propósito: a recarga a seguir é o que interessa. */
  }
}

/* ── Vigilância ──────────────────────────────────────────────────────────── */

export function vigiarVersao({
  atual,
  base,
  aoFicarVelha = avisoDeVersaoVelha,
  intervaloMs = QUINZE_MINUTOS,
}: VigiarVersaoOpcoes): () => void {
  /*
   * Sem identificador não há nada a comparar.
   *
   * É o caso do `vite dev`, onde o HMR já faz este trabalho e não existe
   * `version.json` nenhum para pedir.
   */
  if (!atual || atual === "dev") return () => undefined;

  const chave = "academias:recarregada-para";
  let ultimaPergunta = 0;
  let aPerguntar = false;
  /** A versão nova, já com o service worker pronto, à espera de um momento seguro. */
  let pronta: { build: string; desde: number } | null = null;
  let saiuEm: number | null = null;
  /**
   * Voltou-se à app depois de um minuto fora e ainda não se decidiu nada.
   *
   * É uma bandeira, e não um argumento de `perguntar`, porque o `focus` e o
   * `visibilitychange` chegam juntos e só um deles chega a perguntar: seja qual
   * for, é ele que a vê.
   */
  let regressoLongo = false;
  let aRecarregar = false;

  /**
   * Recarrega para a versão nova, ou mostra o aviso se já se tentou.
   *
   * `destino` é a página para onde a pessoa ia, quando a recarga substitui uma
   * mudança de página. Devolve `false` quando não recarregou.
   */
  const recarregar = (destino?: string): boolean => {
    if (!pronta || aRecarregar) return false;
    let jaTentou = false;
    try {
      jaTentou = sessionStorage.getItem(chave) === pronta.build;
    } catch {
      /* Sem `sessionStorage` (janela privada, armazenamento bloqueado) recarrega-se uma vez. */
    }
    if (jaTentou) {
      aoFicarVelha?.(pronta.build);
      pronta = null;
      return false;
    }
    try {
      sessionStorage.setItem(chave, pronta.build);
    } catch {
      /* Paciência: o pior caso é uma recarga a mais. */
    }
    aRecarregar = true;
    if (destino) window.location.assign(destino);
    else window.location.reload();
    return true;
  };

  const seSeguro = (destino?: string): boolean => (haTrabalhoPorGravar() ? false : recarregar(destino));

  const perguntar = async (origem: Origem): Promise<void> => {
    if (aPerguntar || aRecarregar) return;
    const agora = Date.now();
    if (origem === "voltar" && agora - ultimaPergunta < ESPERA_MINIMA_MS && !pronta && !regressoLongo) return;
    ultimaPergunta = agora;
    aPerguntar = true;
    try {
      if (!pronta) {
        /*
         * `cache: "no-store"` e um parâmetro sempre diferente.
         *
         * O cabeçalho chega para o browser; o parâmetro é para o que estiver pelo
         * meio (um proxy, um service worker de outra app na mesma origem) e que
         * possa responder do bolso sem falar com o servidor.
         */
        const r = await fetch(`${base}version.json?t=${agora}`, { cache: "no-store" });
        if (!r.ok) return;
        const servida = (await r.json()) as VersaoServida | null;
        const novo = servida?.build;
        if (!novo || novo === atual) return;
        await prepararServiceWorker();
        pronta = { build: novo, desde: Date.now() };
      }

      if (origem === "arranque" || regressoLongo) {
        regressoLongo = false;
        seSeguro();
      }
      /* Nos outros casos fica à espera: sair da app ou mudar de página. */
    } catch {
      /* Sem rede não há versão nova para descobrir. Tenta-se na próxima. */
    } finally {
      aPerguntar = false;
    }
  };

  const aoMudarVisibilidade = () => {
    if (document.visibilityState === "hidden") {
      saiuEm = Date.now();
      regressoLongo = false;
      if (!pronta) return;
      /* A pessoa não está a ver: o melhor momento. Ao fim de 24 horas, mesmo com trabalho a meio. */
      if (Date.now() - pronta.desde >= TECTO_MS) recarregar();
      else seSeguro();
      return;
    }
    regressoLongo = saiuEm !== null && Date.now() - saiuEm >= FORA_QUE_CONTA_MS;
    saiuEm = null;
    void perguntar("voltar");
  };
  const aoFocar = () => void perguntar("voltar");
  const aoLigar = () => void perguntar("rede");

  /* Escrever num campo é trabalho que uma recarga apagaria. */
  const aoEscrever = (e: Event) => {
    if (!ignoravel(e.target)) escreveu = true;
  };

  /*
   * Mudar de página com a versão nova pronta: carga completa para o destino.
   *
   * Apanha-se no `history.pushState`, por onde passam os `<Link>` e o
   * `navigate()` do react-router. Sem o `pushState`, o router lê o endereço,
   * vê o mesmo, e não desenha nada: a página fica como estava até chegar a
   * nova. O `replaceState` fica de fora de propósito: é o que os filtros e as
   * pesquisas usam para mudar a query a cada tecla.
   *
   * Com trabalho por gravar, a navegação segue normal e a página nova começa
   * limpa; a recarga fica para a mudança seguinte.
   */
  const pushStateOriginal = history.pushState;
  const pushStateVigiado: History["pushState"] = function (this: History, data, unused, url) {
    if (pronta && url != null) {
      try {
        const destino = new URL(String(url), window.location.href);
        if (destino.origin === window.location.origin && seSeguro(destino.href)) return;
      } catch {
        /* Endereço que não se percebe: navega-se normalmente. */
      }
    }
    escreveu = false;
    return pushStateOriginal.call(this, data, unused, url);
  };
  history.pushState = pushStateVigiado;
  const aoVoltarAtras = () => {
    escreveu = false;
  };

  document.addEventListener("visibilitychange", aoMudarVisibilidade);
  window.addEventListener("focus", aoFocar);
  window.addEventListener("online", aoLigar);
  window.addEventListener("popstate", aoVoltarAtras);
  document.addEventListener("input", aoEscrever, true);
  document.addEventListener("change", aoEscrever, true);
  const relogio = window.setInterval(() => void perguntar("relogio"), intervaloMs);

  /* À entrada, sem esperar: é o momento em que uma app velha se apanha mais barato. */
  void perguntar("arranque");

  return () => {
    document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    window.removeEventListener("focus", aoFocar);
    window.removeEventListener("online", aoLigar);
    window.removeEventListener("popstate", aoVoltarAtras);
    document.removeEventListener("input", aoEscrever, true);
    document.removeEventListener("change", aoEscrever, true);
    window.clearInterval(relogio);
    if (history.pushState === pushStateVigiado) history.pushState = pushStateOriginal;
  };
}

/**
 * A faixa de último recurso.
 *
 * Só aparece quando a app **já** recarregou por esta versão e continua a ver
 * outra no servidor: um service worker preso, um proxy a servir HTML velho, uma
 * app instalada que não larga o que tem. Nesse caso não se insiste na recarga
 * automática (seria um ciclo), diz-se à pessoa o que se passa e dá-se-lhe o
 * botão. Escrita sem React de propósito: tem de funcionar mesmo que a aplicação
 * não tenha montado.
 */
export function avisoDeVersaoVelha(): void {
  const id = "academias-versao-velha";
  if (document.getElementById(id)) return;

  const faixa = document.createElement("div");
  faixa.id = id;
  faixa.setAttribute("role", "status");
  faixa.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:16px",
    "transform:translateX(-50%)",
    "z-index:2147483647",
    "display:flex",
    "align-items:center",
    "gap:12px",
    /*
     * `width:max-content` — senão a faixa parte-se, uma palavra por linha, no
     * telemóvel.
     *
     * Uma caixa `position:fixed` com só o `left` definido (sem `right`) calcula a
     * largura automática contra o espaço da margem esquerda até ao fim do ecrã —
     * ~50vw com o `left:50%`. Num telemóvel isso esmaga a faixa a meia largura, o
     * texto encolhe até à palavra mais comprida e cada palavra cai numa linha.
     * `max-content` dá-lhe a largura de uma linha do conteúdo; o `max-width`
     * continua a ser o tecto em ecrãs mesmo estreitos.
     */
    "width:max-content",
    "max-width:calc(100vw - 32px)",
    "padding:10px 12px 10px 16px",
    "border-radius:999px",
    "background:#1a1917",
    "color:#fff",
    "font:500 14px/1.3 system-ui,sans-serif",
    "box-shadow:0 8px 30px rgba(0,0,0,.28)",
  ].join(";");

  const texto = document.createElement("span");
  // A frase é curta e é para ficar numa linha — sem depender de estilos herdados.
  texto.style.whiteSpace = "nowrap";
  texto.textContent = "Há uma versão nova desta app.";
  const botao = document.createElement("button");
  botao.type = "button";
  botao.textContent = "Actualizar";
  botao.style.cssText = [
    "flex:none",
    "border:0",
    "border-radius:999px",
    "padding:7px 14px",
    "background:#fff",
    "color:#1a1917",
    "font:600 14px/1 system-ui,sans-serif",
  ].join(";");
  botao.onclick = () => {
    /*
     * Aqui limpa-se tudo o que pode estar a segurar a versão velha: as caches do
     * service worker e o próprio registo. É mais violento do que a recarga
     * automática, e é de propósito — chegar a esta faixa significa que a recarga
     * normal não bastou.
     */
    void (async () => {
      try {
        if ("caches" in window) {
          const nomes = await caches.keys();
          await Promise.all(nomes.map((n) => caches.delete(n)));
        }
        if ("serviceWorker" in navigator) {
          const registos = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registos.map((reg) => reg.unregister()));
        }
      } catch {
        /* Ignorado: a recarga a seguir é o que interessa. */
      }
      window.location.reload();
    })();
  };

  faixa.append(texto, botao);
  document.body.append(faixa);
}

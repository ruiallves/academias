/**
 * A app está sempre na versão que o servidor serve.
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
 * ## Como se garante
 *
 * Cada build escreve um `version.json` ao lado do `index.html` e assina o
 * próprio bundle com o mesmo identificador (ver `plugin-versao.ts`). A app
 * pergunta pela versão do servidor **sem cache** em quatro momentos: ao
 * arrancar, quando o ecrã volta a estar à frente, quando a rede volta, e de
 * quinze em quinze minutos. Se o servidor tiver outra, recarrega.
 *
 * Recarregar é a única saída honesta. Um aviso "há uma versão nova, carrega
 * aqui" deixa a escolha a quem não tem como saber o que está a perder, e foi
 * exactamente essa escolha que deixou uma pessoa a trabalhar numa versão de há
 * uma semana.
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

  const perguntar = async (forcar = false): Promise<void> => {
    if (aPerguntar) return;
    const agora = Date.now();
    if (!forcar && agora - ultimaPergunta < ESPERA_MINIMA_MS) return;
    ultimaPergunta = agora;
    aPerguntar = true;
    try {
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

      /* Já se recarregou por esta versão e continua diferente: não insistir. */
      let jaTentou = false;
      try {
        jaTentou = sessionStorage.getItem(chave) === novo;
      } catch {
        /* Sem `sessionStorage` (janela privada, armazenamento bloqueado) recarrega-se uma vez. */
      }
      if (jaTentou) {
        aoFicarVelha?.(novo);
        return;
      }
      try {
        sessionStorage.setItem(chave, novo);
      } catch {
        /* Paciência: o pior caso é uma recarga a mais. */
      }

      /*
       * O service worker primeiro.
       *
       * Numa PWA, recarregar sem tirar o service worker antigo da frente
       * devolve o mesmo HTML que já estava em cache — a app "recarrega" e
       * continua velha. `update()` vai buscar o novo e o `autoUpdate` do
       * vite-plugin-pwa assume o controlo; `reload()` a seguir chega ao HTML
       * novo. Falhar aqui não impede a recarga.
       */
      if ("serviceWorker" in navigator) {
        try {
          const registos = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registos.map((reg) => reg.update()));
        } catch {
          /* Ignorado de propósito: a recarga a seguir é o que interessa. */
        }
      }

      window.location.reload();
    } catch {
      /* Sem rede não há versão nova para descobrir. Tenta-se na próxima. */
    } finally {
      aPerguntar = false;
    }
  };

  const aoVoltar = () => {
    if (document.visibilityState === "visible") void perguntar();
  };
  const aoLigar = () => void perguntar(true);

  document.addEventListener("visibilitychange", aoVoltar);
  window.addEventListener("focus", aoVoltar);
  window.addEventListener("online", aoLigar);
  const relogio = window.setInterval(() => void perguntar(true), intervaloMs);

  /* À entrada, sem esperar: é o momento em que uma app velha se apanha mais barato. */
  void perguntar(true);

  return () => {
    document.removeEventListener("visibilitychange", aoVoltar);
    window.removeEventListener("focus", aoVoltar);
    window.removeEventListener("online", aoLigar);
    window.clearInterval(relogio);
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

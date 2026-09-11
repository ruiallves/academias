import { useEffect } from "react";

/**
 * Manter o que está no ecrã igual ao que está no servidor.
 *
 * ## O que acontecia
 *
 * A app lia tudo **uma vez**, no arranque, e mais nada. Um treinador convocava
 * um atleta e o pai continuava a ver a agenda de antes — para a ver mudar tinha
 * de fechar a app e voltar a abrir. Não era um atraso: era um ecrã congelado no
 * instante em que foi aberto, que podia ter sido de manhã.
 *
 * ## Os três momentos em que se relê
 *
 *  1. **Ao voltar ao ecrã.** É o mais importante numa app de telemóvel: entre
 *     olhar para a app e olhar outra vez passaram-se minutos ou horas, e é
 *     exactamente aí que a informação envelheceu.
 *  2. **De minuto a minuto, com o ecrã à vista.** Para quem fica com a app
 *     aberta — a ver se o treino foi cancelado, à espera da convocatória.
 *  3. **Quando chega um push.** O service worker avisa as janelas abertas (ver
 *     `push-sw.js`), e a lista muda ao mesmo tempo que a notificação aparece,
 *     sem ninguém lhe tocar.
 *
 * ## E o que **não** se faz
 *
 * Nada disto bloqueia o ecrã. Não há splash, não há "a carregar", e uma
 * releitura que falhe deixa tudo como estava (ver o `catch` de `load`). O peso
 * também é travado: uma releitura de cada vez, e nunca duas em menos de dez
 * segundos — trocar de app duas vezes seguidas não dispara dois arranques, que
 * é a diferença entre uma app que se sente viva e uma que se sente lenta.
 */

/** Com o ecrã à vista, de quanto em quanto tempo se relê. */
const INTERVALO = 60_000;

/** O mínimo entre duas releituras. Trava as rajadas de `visibilitychange`. */
const MINIMO = 10_000;

export function useFresco(recarregar: (() => Promise<unknown>) | null) {
  useEffect(() => {
    if (!recarregar) return;

    let vivo = true;
    let aCorrer = false;
    /* Acabou de carregar — a primeira releitura é daqui a um minuto, não já. */
    let ultima = Date.now();

    const reler = (jaJa = false) => {
      if (!vivo || aCorrer) return;
      if (document.visibilityState !== "visible") return;
      if (!jaJa && Date.now() - ultima < MINIMO) return;

      aCorrer = true;
      void Promise.resolve(recarregar())
        .catch(() => {
          /* Silêncio de propósito: o ecrã fica com o que tinha. */
        })
        .finally(() => {
          aCorrer = false;
          // O relógio conta a partir do **fim**: numa rede lenta, contar do
          // início encavalitava releituras.
          ultima = Date.now();
        });
    };

    const aoVoltar = () => reler();
    /*
     * Um push com a app aberta relê já — é o que a torna imediata. `jaJa`
     * salta o mínimo: se o servidor teve o trabalho de empurrar, houve mesmo
     * novidade, e esperar dez segundos para a mostrar não faz sentido nenhum.
     */
    const doServiceWorker = (e: MessageEvent) => {
      if ((e.data as { tipo?: string } | null)?.tipo === "academia:push") reler(true);
    };

    const relogio = setInterval(() => reler(), INTERVALO);
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    navigator.serviceWorker?.addEventListener("message", doServiceWorker);

    return () => {
      vivo = false;
      clearInterval(relogio);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
      navigator.serviceWorker?.removeEventListener("message", doServiceWorker);
    };
  }, [recarregar]);
}

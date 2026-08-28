import { useEffect } from "react";
import { apiPost } from "@/lib/http";

/**
 * O sinal de vida da app aberta. Gémeo do da consola.
 *
 * A plataforma mostra quantas pessoas cada clube tem online, e conta-o a partir
 * dos pedidos que o servidor recebe. Esta app abre, carrega tudo de uma vez, e
 * depois fica calada — um pai a ver a agenda do filho durante cinco minutos não
 * gera pedido nenhum nesse tempo.
 *
 * Só bate com o ecrã à vista. Numa app de telemóvel isso importa mais do que na
 * consola: uma PWA em segundo plano fica lá durante dias, e contá-la
 * transformava "famílias a usar a app" em "famílias que a instalaram uma vez" —
 * que é precisamente a distinção que este produto anda a tentar medir.
 *
 * Falha em silêncio, de propósito: a rede de um telemóvel cai a toda a hora, e
 * isto não é informação para o pai.
 */

const INTERVALO = 45_000;

export function usePresence(activo: boolean) {
  useEffect(() => {
    if (!activo) return;

    let vivo = true;
    const bater = () => {
      if (!vivo || document.visibilityState !== "visible") return;
      void apiPost("/api/presence").catch(() => {});
    };

    bater();
    const relogio = setInterval(bater, INTERVALO);
    document.addEventListener("visibilitychange", bater);

    return () => {
      vivo = false;
      clearInterval(relogio);
      document.removeEventListener("visibilitychange", bater);
    };
  }, [activo]);
}

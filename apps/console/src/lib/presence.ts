import { useEffect } from "react";
import { apiPost } from "@/lib/http";

/**
 * O sinal de vida do separador aberto.
 *
 * ## Porque é que é preciso
 *
 * A plataforma passou a mostrar quantas pessoas cada clube tem online. O servidor
 * conta isso a partir dos pedidos que recebe — e nem esta consola nem a app da
 * família fazem sondagens de espécie nenhuma: abrem, carregam o arranque, e
 * depois ficam caladas. Quem passa dez minutos a preencher uma ficha de jogo não
 * gera pedido nenhum nesse tempo, e desaparecia da contagem enquanto estava,
 * literalmente, a olhar para o produto.
 *
 * ## Só com o separador à vista
 *
 * Um separador esquecido numa janela minimizada não é uma pessoa online — é uma
 * pessoa que se foi embora e não fechou nada. Contá-lo inflacionava justamente o
 * número que se quer honesto, e num clube com dez pessoas isso é a diferença
 * entre "usam" e "abriram uma vez".
 *
 * Por isso o relógio só corre com o separador visível, e ao voltar a ficar
 * visível bate imediatamente em vez de esperar pelo próximo intervalo: quem
 * regressa quer aparecer já, não dentro de quarenta e cinco segundos.
 *
 * ## Se falhar, cala-se
 *
 * Um erro aqui não é um erro para ninguém. A rede caiu, a sessão expirou, o
 * servidor reiniciou — em todos os casos a resposta certa é não aparecer na
 * contagem e não incomodar quem está a trabalhar com um aviso sobre uma
 * funcionalidade que não é dele.
 */

/** De quanto em quanto tempo se avisa que ainda cá está. */
const INTERVALO = 45_000;

export function usePresence(activo: boolean) {
  useEffect(() => {
    if (!activo) return;

    let vivo = true;
    const bater = () => {
      if (!vivo || document.visibilityState !== "visible") return;
      void apiPost("/api/presence", {}).catch(() => {});
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

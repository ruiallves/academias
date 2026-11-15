import { useEffect, useState } from "react";

/**
 * Uma lista comprida desenha-se em duas vezes: o que cabe no ecrã, já; o
 * resto, logo a seguir.
 *
 * ## Porquê
 *
 * Abrir as Notificações com cinquenta avisos demorava 160 ms a desenhar num
 * processador quatro vezes mais lento (um telemóvel médio): cinquenta cartões
 * com ícone, título e corpo são perto de mil elementos a nascer de uma vez. E
 * esse desenho corre **dentro** da transição de ecrã (ver `lib/navegacao.tsx`):
 * o deslize só começa quando ele acaba, e 160 ms de nada a mexer lê-se como
 * um engasgo ao tocar no sino.
 *
 * Só os primeiros doze cabem no ecrã. Desenham-se esses, o deslize começa, e
 * os outros entram quando a animação já acabou, por baixo do que se vê, sem
 * ninguém dar por isso. Quem faz scroll logo a seguir já os encontra lá.
 *
 * A lista inteira volta a contar como "nova" se trocar de identidade (uma
 * releitura do servidor): aí já está tudo montado e não vale a pena cortar.
 */
export function usePorPartes<T>(itens: T[], primeiras = 12): T[] {
  const [tudo, setTudo] = useState(itens.length <= primeiras);

  useEffect(() => {
    if (tudo || itens.length <= primeiras) return;
    /*
     * Depois do deslize de entrada (320 ms), com folga, e só quando o
     * telemóvel estiver livre: montar o resto são mais de 100 ms de trabalho
     * num processador lento, e a meio de um scroll isso era um engasgo.
     */
    let idle: number | null = null;
    const t = setTimeout(() => {
      if (typeof requestIdleCallback === "function") idle = requestIdleCallback(() => setTudo(true), { timeout: 800 });
      else setTudo(true);
    }, 400);
    return () => {
      clearTimeout(t);
      if (idle !== null) cancelIdleCallback(idle);
    };
  }, [tudo, itens.length, primeiras]);

  return tudo ? itens : itens.slice(0, primeiras);
}

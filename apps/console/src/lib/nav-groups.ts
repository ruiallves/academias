import { useCallback, useState } from "react";

/**
 * Que grupos do menu estão abertos.
 *
 * ## Porque é que os grupos fecham
 *
 * O menu tinha vinte destinos sempre à vista. Quem trabalha nas mensalidades não
 * precisa de ver "Prospects", "Observações" e "Pedidos" o dia inteiro, e num
 * portátil de 1366×768 essa lista chegava a não caber — foi por isso que a
 * densidade da barra tem quatro degraus de `@media (max-height)` a apertar tudo.
 *
 * Fechar um grupo ganha mais espaço do que qualquer desses degraus, e ganha-o
 * onde a pessoa quer: os grupos que ela não usa.
 *
 * ## Os dois que abrem por omissão
 *
 * **Pessoas** e **Operação** — quem cá está e o que se faz com eles. É o dia de
 * qualquer clube, e é o que se procura ao abrir a consola. O resto abre-se quando
 * for preciso e fica aberto, porque a escolha é lembrada.
 */
const ABERTOS_POR_OMISSAO = ["Pessoas", "Operação", "Área técnica"];

const CHAVE = "academia.nav.grupos";

/**
 * Lê a escolha de quem está a usar este browser.
 *
 * Falha em silêncio para o valor por omissão: uma janela privada, um browser com
 * o armazenamento bloqueado ou uma chave escrita à mão que deixou de ser JSON não
 * podem impedir o menu de aparecer. É uma preferência, não um dado.
 */
function ler(): string[] {
  try {
    const guardado = localStorage.getItem(CHAVE);
    if (!guardado) return ABERTOS_POR_OMISSAO;
    const lista: unknown = JSON.parse(guardado);
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === "string") : ABERTOS_POR_OMISSAO;
  } catch {
    return ABERTOS_POR_OMISSAO;
  }
}

function escrever(abertos: string[]): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(abertos));
  } catch {
    /* Sem armazenamento, a escolha vale para esta sessão e mais nada. */
  }
}

export function useNavGroups() {
  const [abertos, setAbertos] = useState<string[]>(ler);

  const alternar = useCallback((label: string) => {
    setAbertos((actuais) => {
      const proximos = actuais.includes(label)
        ? actuais.filter((x) => x !== label)
        : [...actuais, label];
      escrever(proximos);
      return proximos;
    });
  }, []);

  /*
   * Um grupo sem rótulo está sempre aberto.
   *
   * É o primeiro bloco — a Visão geral — que não tem cabeçalho e por isso não
   * teria por onde se reabrir. Sem esta linha, seria possível fechá-lo e ficar
   * sem forma de lá voltar pelo menu.
   */
  const estaAberto = useCallback(
    (label?: string) => !label || abertos.includes(label),
    [abertos],
  );

  return { estaAberto, alternar };
}

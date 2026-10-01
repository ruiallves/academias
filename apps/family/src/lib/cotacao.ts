import { useEffect, useState } from "react";
import { apiGet } from "@/lib/http";

/**
 * O que o clube decidiu sobre pagar pela app, e quanto fica cada método.
 *
 * Duas perguntas que a app faz ao servidor antes de mostrar um botão de pagar:
 *
 *  - **o clube aceita pagamentos pela app?** Se não, a app di-lo em vez de
 *    mostrar o botão;
 *  - **a taxa é de quem paga?** Se sim, cada método mostra a sua taxa e o total,
 *    antes de alguém escolher.
 *
 * A conta não se faz aqui. A comissão da euPago incide sobre o que se cobra, e
 * o que se cobra inclui a própria comissão: a fórmula vive no servidor
 * (`billing/taxa-do-pagador.ts`), que é também quem cobra. Uma cópia dela no
 * telemóvel era um dia a app prometer 20,27 € e a referência sair com 20,28 €.
 *
 * O que aqui se mostra é **só para mostrar**: o valor que se paga é calculado
 * outra vez no servidor ao iniciar o pagamento, e é esse que a app passa a
 * mostrar depois.
 */
export type LinhaDaCotacao = { method: string; label: string; surchargeCents: number; totalCents: number };

export type Cotacao = {
  /** Falso quando o clube desligou os pagamentos pela app. */
  enabled: boolean;
  /** A comissão é somada ao valor e paga por quem paga. */
  feesOnPayer: boolean;
  methods: LinhaDaCotacao[];
};

/**
 * A cotação para uma lista de valores (um por pagamento), ou `null` enquanto
 * não chega — e se não chegar.
 *
 * Uma falha aqui não bloqueia nada: sem cotação a app comporta-se como sempre,
 * e o servidor continua a recusar o que tiver de recusar e a cobrar o que tiver
 * de cobrar.
 */
export function useCotacao(caminho: "/billing/cotacao" | "/api/socio/cotacao", valores: number[]): Cotacao | null {
  const [cotacao, setCotacao] = useState<Cotacao | null>(null);
  const chave = valores.join(",");

  useEffect(() => {
    let vivo = true;
    setCotacao(null);
    apiGet<Cotacao>(`${caminho}${chave ? `?cents=${chave}` : ""}`)
      .then((c) => {
        if (vivo) setCotacao(c);
      })
      .catch(() => {
        if (vivo) setCotacao(null);
      });
    return () => {
      vivo = false;
    };
  }, [caminho, chave]);

  return cotacao;
}

/**
 * O clube aceita pagamentos pela app? `null` enquanto não se sabe.
 *
 * Quem pergunta tem de esperar pela resposta antes de mostrar um botão de
 * pagar: mostrá-lo primeiro e tirá-lo depois era deixar o pai tocar em algo que
 * o servidor ia recusar. A última resposta fica guardada por clube, para que a
 * segunda visita já abra certa, e é sempre confirmada com o servidor.
 *
 * Uma falha sem resposta guardada conta como "aceita": o servidor continua a
 * recusar o que tiver de recusar.
 */
export function useAceitaPagamentos(clube: string): { aceita: boolean | null; feesOnPayer: boolean } {
  const chave = `academias.pagamentos.aceita.${clube}`;
  const guardado = (): boolean | null => {
    try {
      const v = localStorage.getItem(chave);
      return v === "1" ? true : v === "0" ? false : null;
    } catch {
      return null;
    }
  };
  const [aceita, setAceita] = useState<boolean | null>(guardado);
  const [feesOnPayer, setFeesOnPayer] = useState(false);

  useEffect(() => {
    let vivo = true;
    setAceita(guardado());
    apiGet<Cotacao>("/billing/cotacao")
      .then((c) => {
        if (!vivo) return;
        const sim = c.enabled !== false;
        setAceita(sim);
        setFeesOnPayer(c.feesOnPayer === true);
        try {
          localStorage.setItem(chave, sim ? "1" : "0");
        } catch {
          /* sem armazenamento, pergunta-se outra vez na próxima */
        }
      })
      .catch(() => {
        if (vivo) setAceita((a) => a ?? true);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  return { aceita, feesOnPayer };
}

/** A linha de um método numa cotação, se a cotação a tiver. */
export const doMetodo = (c: Cotacao | null, method: string): LinhaDaCotacao | undefined =>
  c?.methods.find((m) => m.method === method);

/** O texto do aviso, igual nos dois lados da app. */
export const PAGAMENTOS_DESATIVADOS =
  "Os pagamentos pela app estão desativados neste clube. Fala com o clube para saber como pagar.";

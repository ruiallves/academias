import { useEffect, useState } from "react";
import { ChevronDown } from "@/lib/icons";
import { euros } from "@/lib/finance";
import { cx } from "@/components/primitives";
import { detalheDoPagador, detalhePorMetodo, loadEupagoFees, useEupagoFees } from "@/lib/eupago-fees";
import { useStore } from "@/lib/store";

/**
 * Quanto a família paga, e quanto o clube recebe.
 *
 * ## Porque é que isto aparece por baixo de cada preço
 *
 * Porque um clube que escreve "40 €" no campo da mensalidade está a decidir
 * duas coisas e só vê uma. A outra — que o pagamento online tem comissão e que
 * o que entra na conta do clube é menos — só aparecia no extracto da euPago, um
 * mês depois, e é aí que a direcção descobre que as contas não batem certo.
 *
 * Dizer os dois números no momento em que o preço se decide é a diferença entre
 * uma decisão informada e uma surpresa. Se o clube quiser que lhe entrem 40 €
 * limpos, é aqui que percebe que tem de pedir 41.
 *
 * ## Os dois sentidos da conta
 *
 * Por omissão, o valor escrito é **o que a família paga**, e o intervalo é o que
 * o clube recebe. Quando o clube põe a comissão por conta de quem paga
 * (`academy.feesOnPayer`, nas Definições), a frase vira-se ao contrário: o valor
 * escrito é **o que o clube recebe**, e o intervalo é o que a família paga. É o
 * mesmo campo e o mesmo número a querer dizer outra coisa, e por isso a linha
 * di-lo sempre por extenso.
 *
 * ## Sete métodos, não dois
 *
 * A app da família oferece MB Way, Multibanco, cartão, Apple Pay, Google Pay,
 * débito directo e PaySafeCard — e a euPago cobra preços muito diferentes por
 * cada um. A primeira versão disto punha os métodos todos numa linha corrida, o
 * que dava para dois e era ilegível a partir do terceiro.
 *
 * Ficou em duas camadas: **o intervalo** sempre à vista, porque é o que decide
 * o preço; **a tabela por método** a um clique, porque é o que decide qual dos
 * botões o clube quer promover — e às vezes qual quer desligar.
 *
 * **Nasce sempre fechada.** Chegou a guardar a escolha entre campos, e estava
 * errado por duas razões: numa lista de equipas a preferência abria a tabela em
 * todas as linhas de uma vez, e mesmo num formulário o que decide o preço é o
 * intervalo — o detalhe é uma consulta pontual, não o estado normal do ecrã. Um
 * clique é barato; um ecrã que abre cheio de tabelas que ninguém pediu não é.
 *
 * ## Quando não aparece
 *
 * Sem valor escrito, sem tabela de taxas (rede em baixo), quando o pagamento
 * não é online, ou quando o clube desligou os pagamentos pela app — aí ninguém
 * paga comissão nenhuma. Uma estimativa inventada seria pior do que o silêncio.
 */

export function CustoDoPagamento({
  amountCents,
  /**
   * Só faz sentido onde o pagamento é mesmo online. Uma quota que o clube cobra
   * ao balcão não tem comissão nenhuma, e dizer que tem seria mentir.
   */
  online = true,
  className,
}: {
  amountCents: number | null;
  online?: boolean;
  className?: string;
}) {
  const { tabela } = useEupagoFees();
  const { academy } = useStore();
  /* Fechada de origem, e local a cada campo — abrir uma não abre as outras. */
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    void loadEupagoFees();
  }, []);

  if (!online || !amountCents || amountCents <= 0 || !tabela) return null;

  if (!academy.paymentsEnabled) {
    return (
      <p className={cx("mt-1.5 text-[11px] leading-relaxed text-ink-3", className)}>
        Pagamentos pela app desativados: este valor paga-se ao clube, sem comissão.
      </p>
    );
  }

  const botao = (
    <button
      type="button"
      onClick={() => setAberto((a) => !a)}
      aria-expanded={aberto}
      className="inline-flex items-center gap-0.5 align-baseline font-medium text-ink-3 underline-offset-2 hover:text-ink hover:underline"
    >
      por método
      <ChevronDown className={cx("size-3 transition-transform duration-150", aberto && "rotate-180")} strokeWidth={2} />
    </button>
  );

  /* ---- A comissão é de quem paga: o valor escrito é o que o clube recebe. ---- */
  if (academy.feesOnPayer) {
    const p = detalheDoPagador(amountCents, tabela);
    if (!p) return null;
    const igual = p.minCents === p.maxCents;

    return (
      <div className={cx("mt-1.5 text-[11px] leading-relaxed", className)}>
        <p className="text-ink-2">
          O clube recebe <span className="font-semibold text-ink">{euros(amountCents)}</span>
          {" · "}quem paga pela app paga{" "}
          <span className="font-semibold text-ink">
            {igual ? euros(p.minCents) : `${euros(p.minCents)} a ${euros(p.maxCents)}`}
          </span>{" "}
          {botao}
        </p>

        {aberto && (
          /* Do mais barato para o mais caro para quem paga. */
          <table className="mt-1.5 w-full tabular">
            <tbody>
              {p.porMetodo.map((m) => (
                <tr key={m.label} className="text-ink-3">
                  <td className="py-px pr-2">{m.label}</td>
                  <td className="py-px pr-2 text-right text-ink-4">+{euros(m.surchargeCents)}</td>
                  <td className="py-px text-right font-medium text-ink-2">{euros(m.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {aberto && (
          <p className="mt-1 text-ink-4">
            Taxa da euPago, com IVA, paga por quem paga · {tabela.source}. Pago ao clube em mão, é só o valor.
          </p>
        )}
      </div>
    );
  }

  /* ---- Por omissão: o valor escrito é o que a família paga. ---- */
  const r = detalhePorMetodo(amountCents, tabela);
  if (!r) return null;

  const igual = r.minCents === r.maxCents;

  return (
    <div className={cx("mt-1.5 text-[11px] leading-relaxed", className)}>
      <p className="text-ink-2">
        Paga <span className="font-semibold text-ink">{euros(amountCents)}</span>
        {" · "}o clube recebe{" "}
        <span className="font-semibold text-ink">
          {igual ? euros(r.minCents) : `${euros(r.minCents)} a ${euros(r.maxCents)}`}
        </span>
        {" "}
        {botao}
      </p>

      {aberto && (
        /*
          Ordenado pelo que sobra ao clube, e não pelo nome.
          É a pergunta que se faz a olhar para isto — "qual me sai mais caro?" —
          e a resposta fica na última linha, sem ninguém ter de comparar sete
          números espalhados.
        */
        <table className="mt-1.5 w-full tabular">
          <tbody>
            {r.porMetodo.map((m) => (
              <tr key={m.label} className="text-ink-3">
                <td className="py-px pr-2">{m.label}</td>
                <td className="py-px pr-2 text-right text-ink-4">−{euros(m.feeCents)}</td>
                <td className="py-px text-right font-medium text-ink-2">{euros(m.netCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {aberto && <p className="mt-1 text-ink-4">Comissão euPago, com IVA · {tabela.source}</p>}
    </div>
  );
}

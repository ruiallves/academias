import { Link } from "react-router-dom";
import { Pill } from "@/components/primitives";
import { useStore } from "@/lib/store";

/**
 * As duas decisões do clube sobre pagar pela app, ditas em pequeno.
 *
 * Aparece por baixo do título das Mensalidades e do livro de sócios, que são os
 * dois ecrãs onde se escrevem valores e se espera dinheiro. Sem isto, um clube
 * com os pagamentos desligados via uma tabela de mensalidades por pagar sem
 * saber porque é que ninguém pagava pela app; e um clube com a comissão por
 * conta de quem paga lia "20 €" sem saber se era o que a família paga ou o que
 * o clube recebe.
 *
 * Não aparece quando o clube está como nasce: pagamentos ligados e a comissão
 * por conta do clube. Um aviso que está sempre lá deixa de ser lido.
 */
export function AvisoDePagamentos({ quem = "famílias" }: { quem?: "famílias" | "sócios" }) {
  const { academy } = useStore();
  if (academy.paymentsEnabled && !academy.feesOnPayer) return null;

  return (
    <p className="-mt-2 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-3">
      {!academy.paymentsEnabled && (
        <>
          <Pill tone="warn">pagamentos desativados</Pill>
          <span>
            {quem === "sócios" ? "Os sócios" : "As famílias"} não podem pagar pela app. Os valores continuam a
            configurar-se e a marcar-se à mão.
          </span>
        </>
      )}
      {academy.paymentsEnabled && academy.feesOnPayer && (
        <>
          <Pill tone="signal">taxa paga por quem paga</Pill>
          <span>Os valores são o que o clube recebe. Quem paga pela app paga o valor mais a taxa do método.</span>
        </>
      )}
      <Link to="/definicoes?secao=mensalidades" className="font-medium text-ink-2 hover:text-ink hover:underline">
        Mudar
      </Link>
    </p>
  );
}

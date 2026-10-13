import { useEffect, useState } from "react";
import { Shirt } from "lucide-react";
import { apiGet } from "@/lib/http";

/** `pagamento` nulo: sem pagamento. Ausente num servidor antigo. */
type Peca = {
  id: string;
  item: string;
  variant: string;
  quantity: number;
  assignedAt: string;
  pagamento?: { estado: "porPagar" | "pago"; valorCents: number | null } | null;
};

const euros = (c: number) => (c / 100).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

/**
 * O equipamento que o atleta tem com ele: o que o clube entregou e ainda não
 * voltou. Para a família saber o que está em casa, e o que devolver no fim da
 * época.
 *
 * Cada peça diz se está paga ou por pagar, e quanto. "Por pagar" aqui não é
 * necessariamente uma cobrança nos Pagamentos: o clube pode só deixar a nota
 * (ver `definirPagamento` na API), e é por isso que se diz aqui.
 *
 * Carrega-se sozinho e só aparece quando há alguma coisa, como as notas da
 * escola: um bloco vazio na ficha de todos os atletas de um clube que nem usa o
 * inventário seria ruído. Um erro a ler também o esconde: isto é informação a
 * mais, não pode partir a ficha.
 */
export function Equipamento({ childId }: { childId: string }) {
  const [pecas, setPecas] = useState<Peca[] | null>(null);

  useEffect(() => {
    let vivo = true;
    apiGet<Peca[]>(`/api/inventory/familia/${childId}`)
      .then((r) => vivo && setPecas(r))
      .catch(() => vivo && setPecas([]));
    return () => {
      vivo = false;
    };
  }, [childId]);

  if (!pecas || pecas.length === 0) return null;

  return (
    <section>
      <h2 className="mb-1 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Equipamento</h2>
      <ul className="overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)]">
        {pecas.map((p) => (
          <li key={p.id} className="flex items-center gap-3 border-b border-line p-4 last:border-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2">
              <Shirt className="size-[18px]" strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold text-ink">{p.item}</span>
              <span className="block truncate text-meta text-ink-3">
                {[
                  `Tamanho ${p.variant}`,
                  p.quantity > 1 ? `${p.quantity} unidades` : null,
                  `entregue a ${new Date(p.assignedAt).toLocaleDateString("pt-PT", { day: "numeric", month: "short", year: "numeric" })}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            {p.pagamento && (
              <span
                className={
                  "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap " +
                  (p.pagamento.estado === "pago" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")
                }
              >
                {p.pagamento.estado === "pago" ? "Pago" : "Por pagar"}
                {p.pagamento.valorCents ? ` · ${euros(p.pagamento.valorCents)}` : ""}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

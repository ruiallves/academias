import { cx } from "@/components/primitives";
import { METODOS, type MetodoManual } from "@/components/finance/MetodoDePagamento";
import { CircleCheck, Shirt, Smartphone, TriangleAlert } from "@/lib/icons";
import { guardiansOf } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { money } from "@/lib/format";
import type { ModoDePagamento, PagamentoDaEntrega, PagamentoPedido } from "@/lib/inventory";

/**
 * O pagamento de uma entrega de equipamento, como se escolhe.
 *
 * O mesmo cartão ao entregar e ao editar (\`DeliverDialog\`, \`EditAssignmentDialog\`).
 * Três escolhas no seletor, porque são as três perguntas de quem está ao balcão:
 * não se paga, fica por pagar, ou já pagou. "Por pagar" tem uma segunda
 * pergunta, num interruptor: se vai também para os Pagamentos da app (onde a
 * família recebe uma notificação e paga lá) ou se fica só no Equipamento, como
 * uma nota de que falta pagar. Ver \`definirPagamento\` na API.
 */
export type ValorDoPagamento = {
  /** O que o seletor mostra. \`app\` é "por pagar" com o interruptor ligado. */
  modo: ModoDePagamento;
  /** Em euros, como se escreve ("12,50"). */
  valor: string;
  metodo: MetodoManual | null;
};

export const PAGAMENTO_VAZIO: ValorDoPagamento = { modo: "nenhum", valor: "", metodo: null };

/** O valor do formulário a partir do estado guardado de uma entrega. */
export function valorDe(p: PagamentoDaEntrega | undefined): ValorDoPagamento {
  if (!p || p.estado === "nenhum" || p.estado === "anulado") return PAGAMENTO_VAZIO;
  return {
    modo: p.estado,
    valor: p.valorCents ? (p.valorCents / 100).toFixed(2).replace(".", ",") : "",
    metodo: (p.metodo as MetodoManual | null) ?? null,
  };
}

export const centsDe = (v: ValorDoPagamento) => Math.round(Number(v.valor.replace(/\s/g, "").replace(",", ".")) * 100);

/** O resto do pagamento, sem o valor: pago precisa de método. Para a entrega de vários artigos. */
export const pagamentoSemValorValido = (v: ValorDoPagamento) => v.modo !== "pago" || v.metodo !== null;

/** Pronto a gravar? Com cobrança, precisa de valor; pago precisa de método. */
export function pagamentoValido(v: ValorDoPagamento): boolean {
  if (v.modo === "nenhum") return true;
  const c = centsDe(v);
  return Number.isFinite(c) && c > 0 && (v.modo !== "pago" || v.metodo !== null);
}

export function pedidoDe(v: ValorDoPagamento): PagamentoPedido {
  if (v.modo === "nenhum") return { modo: "nenhum" };
  return { modo: v.modo, priceCents: centsDe(v), ...(v.modo === "pago" && v.metodo ? { method: v.metodo } : {}) };
}

/** A pastilha do estado, nas listas e na ficha. */
export function PagamentoPill({ p }: { p: PagamentoDaEntrega | undefined }) {
  if (!p || p.estado === "nenhum") return null;
  const valor = p.valorCents ? money(p.valorCents) : "";
  const [rotulo, classe] =
    p.estado === "pago"
      ? ["Pago", "bg-ok-soft text-ok"]
      : p.estado === "app"
        ? ["Por pagar · na app", "bg-warn-soft text-warn"]
        : p.estado === "porPagar"
          ? ["Por pagar", "bg-warn-soft text-warn"]
          : ["Anulado", "bg-sunken text-ink-3"];
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", classe)}>
      {rotulo}
      {valor && <span className="font-medium tabular opacity-80">{valor}</span>}
    </span>
  );
}

export function PagamentoDaEntregaField({
  value,
  onChange,
  primeiroNome,
  athleteId,
  semValor,
}: {
  value: ValorDoPagamento;
  onChange: (v: ValorDoPagamento) => void;
  /** Para a frase "Vai para a app do encarregado de Tomás". */
  primeiroNome?: string;
  /** Para avisar quando ainda não há encarregado com a app. */
  athleteId?: string;
  /**
   * Sem o campo do valor: na entrega de vários artigos o valor escreve-se em
   * cada linha, e aqui decide-se só o resto (por pagar ou pago, o método, a app).
   */
  semValor?: boolean;
}) {
  const { session } = useSession();
  /*
   * Sem family:read a lista de encarregados vem vazia, e o aviso de "não tem
   * encarregado" seria falso. Nesse caso não se diz nada.
   */
  const encarregados = athleteId && can(session, "family:read") ? guardiansOf(athleteId) : null;
  const de = primeiroNome ? ` de ${primeiroNome}` : "";
  const aviso =
    value.modo !== "app" || !encarregados
      ? null
      : encarregados.length === 0
        ? `${primeiroNome ?? "O atleta"} ainda não tem encarregado. Quando tiver e instalar a app, recebe lá o pedido de pagamento na mesma.`
        : encarregados.every((g) => !g.appInstalled)
          ? `O encarregado${de} não tem a app. Quando instalar, vai receber o pedido por lá na mesma.`
          : null;
  const porPagar = value.modo === "porPagar" || value.modo === "app";
  const escolha: "nenhum" | "porPagar" | "pago" = porPagar ? "porPagar" : value.modo === "pago" ? "pago" : "nenhum";
  const set = (parcial: Partial<ValorDoPagamento>) => onChange({ ...value, ...parcial });

  return (
    <section className="overflow-hidden rounded-[12px] border border-line">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-2.5">
        <span className="text-meta font-medium text-ink-2">Pagamento</span>
        <div role="radiogroup" aria-label="Pagamento" className="flex rounded-[var(--radius-control)] bg-sunken p-0.5">
          {(
            [
              ["nenhum", "Sem pagamento"],
              ["porPagar", "Por pagar"],
              ["pago", "Pago"],
            ] as const
          ).map(([v, rotulo]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={escolha === v}
              onClick={() => set({ modo: v === "porPagar" ? (value.modo === "app" ? "app" : "porPagar") : v })}
              className={cx(
                "rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
                escolha === v ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-3 hover:text-ink",
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>

      {escolha !== "nenhum" && (
        <div className="space-y-3 border-t border-line bg-sunken/40 px-3.5 py-3.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className={cx("relative w-[150px]", semValor && "hidden")}>
              <input
                inputMode="decimal"
                value={value.valor}
                onChange={(e) => set({ valor: e.target.value.replace(/[^\d.,]/g, "") })}
                placeholder="0,00"
                aria-label="Valor em euros"
                className="h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface pr-9 pl-3 text-[20px] font-semibold text-ink tabular placeholder:font-normal placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-body font-medium text-ink-3">€</span>
            </div>
            <p className="flex min-w-0 flex-1 items-start gap-2 text-meta leading-relaxed text-ink-2">
              {escolha === "pago" ? (
                <>
                  <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-ok" strokeWidth={1.75} />
                  <span>Entra nas Contas do clube, com o método escolhido.</span>
                </>
              ) : value.modo === "app" ? (
                <>
                  <Smartphone className="mt-0.5 size-3.5 shrink-0 text-signal-ink" strokeWidth={1.75} />
                  <span>
                    Vai para os Pagamentos da app do encarregado{de}, com notificação. Quando pagar, fica pago sozinho.
                  </span>
                </>
              ) : (
                <>
                  <Shirt className="mt-0.5 size-3.5 shrink-0 text-warn" strokeWidth={1.75} />
                  <span>Fica no Equipamento da app como por pagar, até ser pago. Não aparece nos Pagamentos.</span>
                </>
              )}
            </p>
          </div>

          {porPagar && (
            <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-surface px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-meta font-medium text-ink">Enviar para os Pagamentos da app</span>
                <span className="block text-[12px] leading-snug text-ink-3">
                  O encarregado recebe uma notificação e pode pagar pela app.
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={value.modo === "app"}
                aria-label="Enviar para os Pagamentos da app"
                onClick={() => set({ modo: value.modo === "app" ? "porPagar" : "app" })}
                className={cx(
                  "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-[120ms]",
                  value.modo === "app" ? "bg-signal-strong" : "bg-line-strong",
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    "absolute top-0.5 size-5 rounded-full bg-white ring-1 ring-black/10 transition-[left] duration-[120ms]",
                    value.modo === "app" ? "left-[18px]" : "left-0.5",
                  )}
                />
              </button>
            </div>
          )}

          {aviso && (
            <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-warn-soft px-3 py-2.5 text-meta leading-relaxed text-warn">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
              <span>{aviso}</span>
            </p>
          )}

          {escolha === "pago" && (
            <div role="radiogroup" aria-label="Método de pagamento" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {METODOS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={value.metodo === m.value}
                  onClick={() => set({ metodo: m.value })}
                  className={cx(
                    "flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] border bg-surface px-2 text-meta font-medium transition-colors duration-[120ms]",
                    value.metodo === m.value ? "border-signal-strong text-ink ring-1 ring-signal-strong" : "border-line text-ink-2 hover:border-line-strong",
                  )}
                >
                  <span className="flex h-5 items-center [&_img]:h-4">{m.marca}</span>
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

import { useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { Empty, Panel, PanelHead, Pill } from "@/components/primitives";
import { apiDelete, apiPost } from "@/lib/http";
import { eurosExact, shortDate } from "@/lib/format";
import { useApi } from "@/lib/query";

type Periodo = {
  chave: string;
  noticeId: string | null;
  periodStart: string;
  periodEnd: string;
  dueOn: string | null;
  amountCents: number;
  enviado: boolean;
  paidAt: string | null;
  paidNote: string | null;
  paidBy: string | null;
};

type Mensalidades = {
  condicoes: {
    planName: string;
    billingPeriod: "MONTHLY" | "ANNUAL";
    amountCents: number;
    assinadas: boolean;
    startsOn: string;
  } | null;
  periodos: Periodo[];
};

/**
 * O que o clube nos paga, na ficha dele, e o botão de dar como recebido.
 *
 * Os pagamentos da plataforma são registados à mão: chega a transferência, e
 * marca-se o período como recebido. Aparecem os avisos que já saíram e também
 * os períodos que ainda não têm aviso (o que está a correr e o seguinte), para
 * se poder registar um pagamento adiantado ou de um clube que ainda não assinou
 * as condições. Contam as condições assinadas, ou as que estão por assinar.
 *
 * Marcar escreve o ganho nas Contas; desmarcar tira-o.
 */
export function MensalidadesDaPlataformaPanel({ academyId }: { academyId: string }) {
  const q = useApi<Mensalidades>(`/contas/clubes/${academyId}/mensalidades`);
  const [busy, setBusy] = useState<string | null>(null);

  if (q.loading && !q.data) return <Panel><div className="h-[120px] animate-pulse" /></Panel>;
  if (!q.data) return null;

  const { condicoes, periodos } = q.data;
  const hoje = new Date().toISOString().slice(0, 10);

  async function alternar(p: Periodo) {
    if (busy) return;
    setBusy(p.chave);
    try {
      if (p.paidAt && p.noticeId) await apiDelete(`/contas/mensalidades/${p.noticeId}/pago`);
      else if (p.noticeId) await apiPost(`/contas/mensalidades/${p.noticeId}/pago`, {});
      else await apiPost(`/contas/clubes/${academyId}/mensalidades`, { periodStart: p.chave });
      q.reload();
    } finally {
      setBusy(null);
    }
  }

  const hint = condicoes
    ? `${eurosExact(condicoes.amountCents)} ${condicoes.billingPeriod === "ANNUAL" ? "por ano" : "por mês"}${
        condicoes.assinadas ? "" : " · condições por assinar"
      }`
    : undefined;

  return (
    <Panel>
      <PanelHead title="Mensalidade da plataforma" hint={hint} />
      {!condicoes && periodos.length === 0 ? (
        <Empty
          title="Sem condições emitidas"
          detail="Os pagamentos aparecem aqui depois de se emitirem as condições do clube."
        />
      ) : (
        <ul>
          {periodos.map((p) => {
            const aCorrer = !p.paidAt && p.periodStart.slice(0, 10) <= hoje && p.periodEnd.slice(0, 10) >= hoje;
            const futuro = p.periodStart.slice(0, 10) > hoje;
            const vencido = !p.paidAt && p.dueOn !== null && p.dueOn.slice(0, 10) < hoje;
            return (
              <li key={p.chave} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-ink">
                    {shortDate(p.periodStart)} a {shortDate(p.periodEnd)}
                  </span>
                  <span className="block text-[11px] text-ink-4">
                    {p.paidAt
                      ? `recebido a ${shortDate(p.paidAt)}${p.paidBy ? ` · ${p.paidBy}` : ""}`
                      : p.enviado
                        ? `aviso enviado · limite ${shortDate(p.dueOn)}`
                        : futuro
                          ? "próximo período"
                          : aCorrer
                            ? "período a correr"
                            : "sem aviso enviado"}
                  </span>
                </span>
                {p.paidAt ? (
                  <Pill tone="ok">Recebido</Pill>
                ) : vencido ? (
                  <Pill tone="risk">Vencido</Pill>
                ) : (
                  <Pill tone={futuro || aCorrer ? "neutral" : "warn"}>Por receber</Pill>
                )}
                <span className="shrink-0 text-body text-ink tabular">{eurosExact(p.amountCents)}</span>
                <button type="button" className="ctl-ghost shrink-0" disabled={busy !== null} onClick={() => void alternar(p)}>
                  {p.paidAt ? (
                    <>
                      <Undo2 className="size-3.5" strokeWidth={1.75} />
                      Desmarcar
                    </>
                  ) : (
                    <>
                      <Check className="size-3.5" strokeWidth={2} />
                      {busy === p.chave ? "A registar…" : "Recebido"}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

import { useState } from "react";
import { Check, Minus, Plus, Settings2, Undo2 } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { DefinicoesDialog, GastoFixoDialog, MovimentoDialog, emCentimos } from "@/components/ContasDialogs";
import { Numeros, Segmented } from "@/components/comercial/ui";
import { apiDelete, apiPost } from "@/lib/http";
import { euros, eurosExact, shortDate } from "@/lib/format";
import { useApi } from "@/lib/query";
import { ChartHero, SaldoChart } from "@/components/chart/Chart";
import type { ContasResumo, GastoFixo, MensalidadeDoClube, Previsao, Transacao } from "@/lib/types";

/**
 * As contas do negócio.
 *
 * ## O que esta página responde, por ordem
 *
 * 1. **Este mês fechou a ganhar ou a perder?** É a linha de cima.
 * 2. **O que aí vem.** A previsão mês a mês, só com os clubes que já existem.
 * 3. **Quem nos deve.** As mensalidades dos clubes, com "Por pagar" aberto à
 *    partida: é a lista que se trabalha. As pagas e todas estão a um clique.
 * 4. **O que entrou e saiu**: os movimentos, com o valor pago e o valor sem IVA
 *    lado a lado, e os gastos fixos.
 *
 * ## Dois números, sempre ditos
 *
 * Os totais (saldo, previsão, gastos por mês) são **sem IVA**: é o que fica
 * depois de o entregar ao Estado, e é com isso que se pagam os custos. Cada
 * mensalidade e cada movimento mostram o **valor pago**, com IVA, e por baixo o
 * valor sem IVA. A página diz qual é qual em cada sítio, para não haver um
 * número que se lê de duas maneiras.
 */
export default function Contas() {
  const [sim, setSim] = useState({ ligada: false, novos: "2", valor: "29,99" });
  const q = sim.ligada ? `&novosPorMes=${Number(sim.novos) || 0}&valorNovoCents=${emCentimos(sim.valor)}` : "";
  const [estado, setEstado] = useState<"por-pagar" | "pagos" | "todos">("por-pagar");
  const [tipo, setTipo] = useState<"todos" | "INCOME" | "EXPENSE">("todos");

  const resumo = useApi<ContasResumo>("/contas/resumo");
  const previsao = useApi<Previsao>(`/contas/previsao?meses=12${q}`);
  const movimentos = useApi<Transacao[]>(`/contas/movimentos?limite=60${tipo === "todos" ? "" : `&tipo=${tipo}`}`);
  const fixos = useApi<GastoFixo[]>("/contas/fixos");
  const mensalidades = useApi<MensalidadeDoClube[]>(`/contas/mensalidades?limite=100&estado=${estado}`);

  const [movimento, setMovimento] = useState<{ t: Transacao | null; tipo: "INCOME" | "EXPENSE" } | null>(null);
  const [fixo, setFixo] = useState<{ g: GastoFixo | null } | null>(null);
  const [definicoes, setDefinicoes] = useState(false);

  const recarregar = () => {
    resumo.reload();
    previsao.reload();
    movimentos.reload();
    fixos.reload();
    mensalidades.reload();
  };

  const r = resumo.data;
  const ivaMensalidades = r
    ? r.settings.subscriptionVatIncluded
      ? `Preços dos clubes com IVA incluído (${r.settings.subscriptionVatRate} %)`
      : `Preços dos clubes sem IVA: soma-se ${r.settings.subscriptionVatRate} % ao receber`
    : null;

  return (
    <>
      <PageHeader title="Contas" subtitle="O que entra, o que sai e o que aí vem. Os totais estão sem IVA; cada pagamento mostra o valor pago, com IVA.">
        <button type="button" className="ctl-ghost" onClick={() => setDefinicoes(true)}>
          <Settings2 className="size-3.5" strokeWidth={1.75} />
          Definições
        </button>
        <button type="button" className="ctl-ghost" onClick={() => setMovimento({ t: null, tipo: "EXPENSE" })}>
          <Minus className="size-3.5" strokeWidth={2} />
          Registar gasto
        </button>
        <button type="button" className="ctl-primary" onClick={() => setMovimento({ t: null, tipo: "INCOME" })}>
          <Plus className="size-3.5" strokeWidth={2} />
          Registar ganho
        </button>
      </PageHeader>

      <div className="space-y-3">
        <Numeros
          items={[
            {
              label: "Saldo deste mês, sem IVA",
              value: r ? euros(r.mes.saldoLiquidoCents) : "—",
              note: r ? `Entrou ${euros(r.mes.ganhosLiquidosCents)}, saiu ${euros(r.mes.gastosLiquidosCents)}` : undefined,
            },
            {
              label: "Saldo do ano, sem IVA",
              value: r ? euros(r.ano.saldoLiquidoCents) : "—",
              note: r ? `Entrou ${euros(r.ano.ganhosLiquidosCents)}, saiu ${euros(r.ano.gastosLiquidosCents)}` : undefined,
            },
            {
              label: "Gastos fixos por mês, sem IVA",
              value: previsao.data ? euros(previsao.data.fixos.porMesCents) : "—",
              note: "Os anuais contam 1/12 em cada mês",
            },
            {
              label: "Os clubes devem-nos",
              value: r ? eurosExact(r.porReceber.cents) : "—",
              note: r
                ? r.porReceber.count === 0
                  ? "Nada em aberto"
                  : `${r.porReceber.count} ${r.porReceber.count === 1 ? "mensalidade" : "mensalidades"}, ${r.porReceber.vencidas} fora do prazo`
                : undefined,
            },
          ]}
        />

        {/* -------------------------------------------- as mensalidades dos clubes */}
        <Panel>
          <PanelHead title="Mensalidades dos clubes" hint={ivaMensalidades ?? undefined} />
          <div className="border-b border-line px-5">
            <Segmented
              value={estado}
              onChange={setEstado}
              options={[
                { id: "por-pagar", label: "Por pagar", count: r?.porReceber.count },
                { id: "pagos", label: "Pagas" },
                { id: "todos", label: "Todas" },
              ]}
            />
          </div>
          {mensalidades.data && mensalidades.data.length > 0 ? (
            <ul className="divide-y divide-line">
              {mensalidades.data.map((m) => (
                <Mensalidade key={m.id} m={m} vatRate={r?.settings.subscriptionVatRate ?? 23} incluido={r?.settings.subscriptionVatIncluded ?? true} onChanged={recarregar} />
              ))}
            </ul>
          ) : mensalidades.data ? (
            <div className="px-5 py-8">
              <Empty
                title={estado === "por-pagar" ? "Nenhum clube nos deve nada" : estado === "pagos" ? "Ainda nenhuma mensalidade paga" : "Ainda não há mensalidades emitidas"}
                detail={
                  estado === "por-pagar"
                    ? "As mensalidades saem sozinhas no dia do mês em que cada clube assinou, e aparecem aqui até serem pagas."
                    : undefined
                }
              />
            </div>
          ) : (
            <div className="px-5 py-8 text-center text-meta text-ink-3">{mensalidades.error ?? "A carregar…"}</div>
          )}
          <p className="border-t border-line px-5 py-2.5 text-[11px] text-ink-4">
            Os pagamentos por MB WAY ou Multibanco marcam-se sozinhos. As transferências marcam-se aqui com "Marcar como paga", e o valor entra nos movimentos.
          </p>
        </Panel>

        {/* ------------------------------------------------------ a previsão */}
        <Panel>
          <PanelHead
            title="Os próximos 12 meses, sem IVA"
            hint={previsao.data ? `com os ${previsao.data.clubes} ${previsao.data.clubes === 1 ? "clube que paga" : "clubes que pagam"} hoje` : undefined}
          >
            <label className="flex cursor-pointer items-center gap-2 text-meta text-ink-2">
              <input type="checkbox" checked={sim.ligada} onChange={(e) => setSim((s) => ({ ...s, ligada: e.target.checked }))} />
              Simular clubes novos
            </label>
            {sim.ligada && (
              <span className="flex items-center gap-1.5 text-meta text-ink-3">
                <input
                  className="h-7 w-12 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-center text-meta text-ink outline-none focus:border-signal"
                  value={sim.novos}
                  onChange={(e) => setSim((s) => ({ ...s, novos: e.target.value }))}
                  inputMode="numeric"
                />
                por mês a
                <input
                  className="h-7 w-20 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-center text-meta text-ink outline-none focus:border-signal"
                  value={sim.valor}
                  onChange={(e) => setSim((s) => ({ ...s, valor: e.target.value }))}
                  inputMode="decimal"
                />
                €
              </span>
            )}
          </PanelHead>

          {previsao.data ? (
            <Grafico previsao={previsao.data} simulando={sim.ligada} />
          ) : (
            <div className="px-5 py-10 text-center text-meta text-ink-3">{previsao.error ?? "A carregar…"}</div>
          )}
        </Panel>

        <div className="grid gap-3 lg:grid-cols-2">
          {/* -------------------------------------------------- os movimentos */}
          <Panel>
            <PanelHead title="Movimentos" hint="valor pago, com IVA" />
            <div className="border-b border-line px-5">
              <Segmented
                value={tipo}
                onChange={setTipo}
                options={[
                  { id: "todos", label: "Todos" },
                  { id: "INCOME", label: "Entradas" },
                  { id: "EXPENSE", label: "Saídas" },
                ]}
              />
            </div>
            {movimentos.data && movimentos.data.length > 0 ? (
              <ul className="divide-y divide-line">
                {movimentos.data.map((t) => (
                  <Movimento key={t.id} t={t} onOpen={() => !t.noticeId && !t.salesPayout && setMovimento({ t, tipo: t.kind })} />
                ))}
              </ul>
            ) : (
              <div className="px-5 py-8">
                <Empty title="Sem movimentos" detail="Os pagamentos dos clubes entram sozinhos quando uma mensalidade fica paga." />
              </div>
            )}
          </Panel>

          {/* ------------------------------------------------- os gastos fixos */}
          <Panel>
            <PanelHead title="Gastos fixos" hint="valor com IVA, a cada mês ou ano">
              <button type="button" className="ctl-ghost" onClick={() => setFixo({ g: null })}>
                <Plus className="size-3.5" strokeWidth={2} />
                Novo
              </button>
            </PanelHead>
            {fixos.data && fixos.data.length > 0 ? (
              <ul className="divide-y divide-line">
                {fixos.data.map((g) => (
                  <li key={g.id} className="flex items-center gap-3 px-5 py-2.5">
                    <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => setFixo({ g })}>
                      <span className="block truncate text-body font-medium text-ink">{g.description}</span>
                      <span className="block text-meta text-ink-3">
                        {g.recurrence === "MONTHLY" ? `Todos os meses, ao dia ${g.dayOfMonth}` : `Uma vez por ano, em ${MES_LONGO[(g.month ?? 1) - 1]}`}
                        {g.category ? ` · ${g.category}` : ""}
                        {g.isActive ? "" : " · desligado"}
                      </span>
                    </button>
                    <span className="shrink-0 text-right">
                      <span className="block text-body text-ink tabular">{eurosExact(g.amountCents)}</span>
                      <span className="block text-[11px] text-ink-4 tabular">{semIva(g.amountCents, g.vatRate)}</span>
                    </span>
                    <button
                      type="button"
                      className="ctl-ghost shrink-0"
                      title="Passa o valor deste mês para os movimentos, como pago"
                      onClick={async () => {
                        await apiPost(`/contas/fixos/${g.id}/lancar`, {});
                        recarregar();
                      }}
                    >
                      Já paguei
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-5 py-8">
                <Empty title="Sem gastos fixos" detail="Servidores, contabilidade, domínios. É daqui que sai a previsão." />
              </div>
            )}
            <p className="border-t border-line px-5 py-2.5 text-[11px] text-ink-4">
              A previsão já conta com estes gastos. "Já paguei" passa o deste mês para os movimentos, para o saldo do mês ficar certo.
            </p>
          </Panel>
        </div>
      </div>

      {movimento && (
        <MovimentoDialog movimento={movimento.t} tipoInicial={movimento.tipo} onClose={() => setMovimento(null)} onSaved={recarregar} />
      )}
      {fixo && <GastoFixoDialog gasto={fixo.g} onClose={() => setFixo(null)} onSaved={recarregar} />}
      {definicoes && r && (
        <DefinicoesDialog
          vatRate={r.settings.subscriptionVatRate}
          vatIncluded={r.settings.subscriptionVatIncluded}
          openingBalanceCents={r.settings.openingBalanceCents}
          onClose={() => setDefinicoes(false)}
          onSaved={recarregar}
        />
      )}
    </>
  );
}

const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MES_LONGO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const mesLabel = (chave: string) => {
  const [ano, mes] = chave.split("-").map(Number);
  return `${MES_CURTO[mes - 1]} ${String(ano).slice(2)}`;
};

/** "sem IVA 16,25 €" ou "sem IVA" quando a taxa é zero. */
function semIva(cents: number, taxa: number): string {
  if (!taxa) return "sem IVA";
  return `${eurosExact(Math.round(cents / (1 + taxa / 100)))} sem IVA`;
}

/** "novembro" ou "1 nov 2026 a 31 out 2027" (anual). */
function periodoDaMensalidade(inicio: string, fim: string, anual: boolean): string {
  if (anual) return `ano de ${shortDate(inicio)} a ${shortDate(fim)}`;
  const d = new Date(inicio);
  return `${MES_LONGO[d.getMonth()]} ${d.getFullYear()} (${d.getDate()}/${d.getMonth() + 1} a ${new Date(fim).getDate()}/${new Date(fim).getMonth() + 1})`;
}

function diasAte(iso: string): number {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - hoje.getTime()) / 86_400_000);
}

/**
 * A previsão, desenhada: para onde vai o dinheiro.
 *
 * Uma linha do saldo acumulado: verde acima de zero, vermelho abaixo, e o mês em
 * que atravessa vê-se sem ler número nenhum.
 */
function Grafico({ previsao, simulando }: { previsao: Previsao; simulando: boolean }) {
  const meses = previsao.meses;
  const fim = meses[meses.length - 1];
  const viraEm = meses.find((m) => m.acumuladoCents >= 0 && m.saldoCents > 0);

  return (
    <>
      <ChartHero
        valor={euros(fim?.acumuladoCents ?? 0)}
        unidade={`somado até ${mesLabel(fim?.mes ?? "")}`}
        delta={{
          texto: viraEm ? `fica positivo em ${mesLabel(viraEm.mes)}` : "ainda negativo no fim dos 12 meses",
          bom: viraEm ? true : false,
        }}
      />

      <SaldoChart
        height={220}
        formato={euros}
        formatoEixo={euros}
        dados={meses.map((m) => ({
          key: m.mes,
          label: mesLabel(m.mes),
          value: m.acumuladoCents,
          detalhe: `${euros(m.acumuladoCents)} somado · ${m.saldoCents >= 0 ? "+" : ""}${euros(m.saldoCents)} no mês`,
        }))}
      />

      <p className="px-5 pt-3 pb-1 text-meta leading-relaxed text-ink-3">
        A linha soma, mês a mês, o que os clubes vão pagar (pelos contratos de hoje) menos os gastos fixos. Tudo sem IVA.
        {previsao.cobreEm ? (
          <>
            {" "}
            A receita passa a cobrir os gastos em <b className="text-ink">{mesLabel(previsao.cobreEm)}</b>.
          </>
        ) : (
          " Com os clubes de hoje, a receita ainda não cobre os gastos dentro de um ano."
        )}
        {simulando && " A simulação já está somada: são clubes que ainda não existem."}
      </p>

      <div className="overflow-x-auto px-5 pb-4">
        <table className="w-full min-w-[520px] border-collapse text-meta">
          <thead>
            <tr className="text-ink-3">
              <th className="py-2 text-left font-medium">Mês</th>
              <th className="py-2 text-right font-medium">Entra dos clubes</th>
              {simulando && <th className="py-2 text-right font-medium">Simulado</th>}
              <th className="py-2 text-right font-medium">Gastos fixos</th>
              <th className="py-2 text-right font-medium">Saldo do mês</th>
              <th className="py-2 text-right font-medium">Somado</th>
            </tr>
          </thead>
          <tbody>
            {previsao.meses.map((m) => (
              <tr key={m.mes} className="border-t border-line text-ink-2">
                <td className="py-1.5">{mesLabel(m.mes)}</td>
                <td className="py-1.5 text-right tabular">{euros(m.receitaCents)}</td>
                {simulando && <td className="py-1.5 text-right tabular text-ink-3">{euros(m.receitaSimuladaCents)}</td>}
                <td className="py-1.5 text-right tabular">{euros(m.gastosCents)}</td>
                <td className={cx("py-1.5 text-right font-medium tabular", m.saldoCents < 0 ? "text-risk" : "text-ink")}>{euros(m.saldoCents)}</td>
                <td className={cx("py-1.5 text-right tabular", m.acumuladoCents < 0 ? "text-risk" : "text-ink-2")}>{euros(m.acumuladoCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const METODO: Record<string, string> = { MBWAY: "MB WAY", MULTIBANCO: "Multibanco", MANUAL: "transferência, marcada à mão" };

/** Uma mensalidade de um clube: de que mês é, o estado, o valor e o botão. */
function Mensalidade({ m, vatRate, incluido, onChanged }: { m: MensalidadeDoClube; vatRate: number; incluido: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const dias = diasAte(m.dueOn);
  const vencida = !m.paidAt && dias < 0;
  const pago = incluido ? m.amountCents : Math.round(m.amountCents * (1 + vatRate / 100));

  async function alternar() {
    if (busy) return;
    if (m.paidAt && !confirm(`Desfazer o pagamento de ${m.academy.name}? Sai dos movimentos.`)) return;
    setBusy(true);
    try {
      if (m.paidAt) await apiDelete(`/contas/mensalidades/${m.id}/pago`);
      else await apiPost(`/contas/mensalidades/${m.id}/pago`, {});
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const estado = m.paidAt
    ? `Paga a ${shortDate(m.paidAt)}${m.paidMethod ? ` por ${METODO[m.paidMethod] ?? m.paidMethod}` : ""}`
    : vencida
      ? `Venceu a ${shortDate(m.dueOn)}, há ${-dias} ${dias === -1 ? "dia" : "dias"}${m.remindersSent ? ` · ${m.remindersSent} ${m.remindersSent === 1 ? "lembrete enviado" : "lembretes enviados"}` : ""}`
      : dias === 0
        ? "Vence hoje"
        : `Vence a ${shortDate(m.dueOn)}, daqui a ${dias} ${dias === 1 ? "dia" : "dias"}`;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-ink">{m.academy.name}</span>
        <span className="block text-meta text-ink-3">
          Mensalidade de {periodoDaMensalidade(m.periodStart, m.periodEnd, m.billingPeriod === "ANNUAL")} · {m.planName}
        </span>
        <span className={cx("block text-meta", m.paidAt ? "text-ink-3" : vencida ? "text-risk" : "text-ink-2")}>{estado}</span>
      </span>
      {m.paidAt ? <Pill tone="ok">Paga</Pill> : vencida ? <Pill tone="risk">Fora do prazo</Pill> : <Pill tone="warn">Por pagar</Pill>}
      <span className="w-[104px] shrink-0 text-right">
        <span className="block text-body font-medium text-ink tabular">{eurosExact(pago)}</span>
        <span className="block text-[11px] text-ink-4 tabular">{semIva(pago, vatRate)}</span>
      </span>
      <button type="button" className={cx("shrink-0 cursor-pointer", m.paidAt ? "ctl-ghost" : "ctl-outline")} disabled={busy} onClick={() => void alternar()}>
        {m.paidAt ? (
          <>
            <Undo2 className="size-3.5" strokeWidth={1.75} />
            Desfazer
          </>
        ) : (
          <>
            <Check className="size-3.5" strokeWidth={2} />
            Marcar como paga
          </>
        )}
      </button>
    </li>
  );
}

/** Um movimento: o que foi, de onde veio, e os dois valores. */
function Movimento({ t, onOpen }: { t: Transacao; onOpen: () => void }) {
  const origem = t.notice
    ? `mensalidade de ${t.notice.billingPeriod === "ANNUAL" ? "um ano" : MES_LONGO[new Date(t.notice.periodStart).getMonth()]}, entra sozinha`
    : t.salesPayout
      ? "mês do comercial aprovado"
      : t.recurring
        ? "gasto fixo"
        : "registado à mão";
  const editavel = !t.noticeId && !t.salesPayout;
  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      <button type="button" className={cx("min-w-0 flex-1 text-left", editavel && "cursor-pointer")} onClick={onOpen} title={editavel ? "Editar" : "Corrige-se na origem"}>
        <span className="block truncate text-body font-medium text-ink">{t.description}</span>
        <span className="block truncate text-meta text-ink-3">
          {shortDate(t.occurredAt)} · {origem}
          {t.category ? ` · ${t.category}` : ""}
          {t.status === "PENDING" ? " · ainda não pago" : ""}
        </span>
      </button>
      <span className="shrink-0 text-right">
        <span className={cx("block text-body font-medium tabular", t.kind === "INCOME" ? "text-ok" : "text-ink")}>
          {t.kind === "INCOME" ? "+" : "−"}
          {eurosExact(t.amountCents)}
        </span>
        <span className="block text-[11px] text-ink-4 tabular">{semIva(t.amountCents, t.vatRate)}</span>
      </span>
    </li>
  );
}

import { useState } from "react";
import { Check, Minus, Plus, Settings2, Undo2 } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Metric, MetricRow, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { DefinicoesDialog, GastoFixoDialog, MovimentoDialog, emCentimos } from "@/components/ContasDialogs";
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
 * 2. **O que aí vem.** A previsão mês a mês, só com os clubes que já existem: a
 *    receita de cada contrato no dia em que cai, menos os gastos fixos. O mês em
 *    que o contratado passa a cobrir os custos aparece dito por palavras, porque
 *    é a única data que interessa mesmo.
 * 3. **O que está por receber.** As mensalidades emitidas que ninguém pagou.
 * 4. **O que se lança à mão**: gastos fixos e movimentos avulsos.
 *
 * ## Contratado e simulado nunca se misturam
 *
 * A simulação ("e se entrarem dois clubes por mês?") soma barras de outra cor e
 * vem sempre identificada. Um gráfico que junta o assinado com o desejado é um
 * gráfico que se acredita duas vezes: a primeira por engano, a segunda porque já
 * se tinha acreditado.
 *
 * ## Tudo a líquido
 *
 * Os totais desta página são sem IVA. É o que fica depois de o entregar, e é com
 * isso que se pagam os servidores. O valor com IVA está em cada movimento.
 */
export default function Contas() {
  const [sim, setSim] = useState({ ligada: false, novos: "2", valor: "39,90" });
  const q = sim.ligada ? `&novosPorMes=${Number(sim.novos) || 0}&valorNovoCents=${emCentimos(sim.valor)}` : "";

  const resumo = useApi<ContasResumo>("/contas/resumo");
  const previsao = useApi<Previsao>(`/contas/previsao?meses=12${q}`);
  const movimentos = useApi<Transacao[]>("/contas/movimentos?limite=40");
  const fixos = useApi<GastoFixo[]>("/contas/fixos");
  const mensalidades = useApi<MensalidadeDoClube[]>("/contas/mensalidades?limite=40");

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

  return (
    <>
      <PageHeader title="Contas" subtitle="O que entra, o que sai, e o que aí vem.">
        <button type="button" className="ctl-ghost" onClick={() => setDefinicoes(true)}>
          <Settings2 className="size-3.5" strokeWidth={1.75} />
          Definições
        </button>
        <button type="button" className="ctl-ghost" onClick={() => setMovimento({ t: null, tipo: "EXPENSE" })}>
          <Minus className="size-3.5" strokeWidth={2} />
          Gasto
        </button>
        <button type="button" className="ctl-primary" onClick={() => setMovimento({ t: null, tipo: "INCOME" })}>
          <Plus className="size-3.5" strokeWidth={2} />
          Ganho
        </button>
      </PageHeader>

      <div className="space-y-3">
        <MetricRow>
          <Metric
            label="Este mês"
            value={r ? euros(r.mes.saldoLiquidoCents) : "—"}
            note={r ? `${euros(r.mes.ganhosLiquidosCents)} a entrar · ${euros(r.mes.gastosLiquidosCents)} a sair` : undefined}
          />
          <Metric
            label="Este ano"
            value={r ? euros(r.ano.saldoLiquidoCents) : "—"}
            note={r ? `${euros(r.ano.ganhosLiquidosCents)} de receita líquida` : undefined}
          />
          <Metric
            label="Gastos fixos"
            value={previsao.data ? euros(previsao.data.fixos.porMesCents) : "—"}
            note="por mês, com os anuais diluídos"
          />
          <Metric
            label="Por receber"
            value={r ? euros(r.porReceber.cents) : "—"}
            note={r ? `${r.porReceber.count} mensalidades · ${r.porReceber.vencidas} vencidas` : undefined}
          />
        </MetricRow>

        {/* ------------------------------------------------------ a previsão */}
        <Panel>
          <PanelHead
            title="Os próximos 12 meses"
            hint={previsao.data ? `${previsao.data.clubes} ${previsao.data.clubes === 1 ? "clube contratado" : "clubes contratados"}` : undefined}
          >
            <label className="flex items-center gap-2 text-meta text-ink-2">
              <input
                type="checkbox"
                checked={sim.ligada}
                onChange={(e) => setSim((s) => ({ ...s, ligada: e.target.checked }))}
              />
              Simular
            </label>
            {sim.ligada && (
              <span className="flex items-center gap-1.5 text-meta text-ink-3">
                <input
                  className="h-7 w-12 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-center text-meta text-ink outline-none focus:border-signal"
                  value={sim.novos}
                  onChange={(e) => setSim((s) => ({ ...s, novos: e.target.value }))}
                  inputMode="numeric"
                />
                clubes novos por mês a
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

        {/* -------------------------------------------- as mensalidades dos clubes */}
        <Panel>
          <PanelHead title="Mensalidades dos clubes" hint="o que já foi emitido" />
          {mensalidades.data && mensalidades.data.length > 0 ? (
            <ul className="divide-y divide-line">
              {mensalidades.data.map((m) => (
                <Mensalidade key={m.id} m={m} onChanged={recarregar} />
              ))}
            </ul>
          ) : (
            <div className="px-5 py-8">
              <Empty
                title="Ainda não há mensalidades emitidas"
                detail="Saem sozinhas no dia do mês em que cada clube assinou as condições."
              />
            </div>
          )}
        </Panel>

        <div className="grid gap-3 lg:grid-cols-2">
          {/* ------------------------------------------------- os gastos fixos */}
          <Panel>
            <PanelHead title="Gastos fixos" hint={fixos.data ? `${fixos.data.length}` : undefined}>
              <button type="button" className="ctl-ghost" onClick={() => setFixo({ g: null })}>
                <Plus className="size-3.5" strokeWidth={2} />
                Novo
              </button>
            </PanelHead>
            {fixos.data && fixos.data.length > 0 ? (
              <ul className="divide-y divide-line">
                {fixos.data.map((g) => (
                  <li key={g.id} className="flex items-center gap-3 px-5 py-2.5">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setFixo({ g })}>
                      <span className="block truncate text-body font-medium text-ink">{g.description}</span>
                      <span className="block text-meta text-ink-3">
                        {g.recurrence === "MONTHLY" ? `todo o dia ${g.dayOfMonth}` : `uma vez por ano, em ${MES_CURTO[(g.month ?? 1) - 1]}`}
                        {g.category ? ` · ${g.category}` : ""}
                        {g.isActive ? "" : " · desligado"}
                      </span>
                    </button>
                    <span className="shrink-0 text-body text-ink tabular">{eurosExact(g.amountCents)}</span>
                    <button
                      type="button"
                      className="ctl-ghost shrink-0"
                      title="Lançar este mês"
                      onClick={async () => {
                        await apiPost(`/contas/fixos/${g.id}/lancar`, {});
                        recarregar();
                      }}
                    >
                      Lançar
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-5 py-8">
                <Empty title="Sem gastos fixos" detail="Servidores, contabilidade, domínios. É daqui que sai a previsão." />
              </div>
            )}
          </Panel>

          {/* -------------------------------------------------- os movimentos */}
          <Panel>
            <PanelHead title="Movimentos" hint="os mais recentes" />
            {movimentos.data && movimentos.data.length > 0 ? (
              <ul className="divide-y divide-line">
                {movimentos.data.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => !t.noticeId && setMovimento({ t, tipo: t.kind })}
                    >
                      <span className="block truncate text-body font-medium text-ink">{t.description}</span>
                      <span className="block truncate text-meta text-ink-3">
                        {shortDate(t.occurredAt)}
                        {t.category ? ` · ${t.category}` : ""}
                        {t.status === "PENDING" ? " · previsto" : ""}
                      </span>
                    </button>
                    <span
                      className={cx(
                        "shrink-0 text-body tabular",
                        t.kind === "INCOME" ? "text-ok" : "text-ink",
                      )}
                    >
                      {t.kind === "INCOME" ? "+" : "−"}
                      {eurosExact(t.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-5 py-8">
                <Empty title="Sem movimentos" detail="Os ganhos dos clubes entram sozinhos quando marcas uma mensalidade como paga." />
              </div>
            )}
          </Panel>
        </div>
      </div>

      {movimento && (
        <MovimentoDialog
          movimento={movimento.t}
          tipoInicial={movimento.tipo}
          onClose={() => setMovimento(null)}
          onSaved={recarregar}
        />
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
const mesLabel = (chave: string) => {
  const [ano, mes] = chave.split("-").map(Number);
  return `${MES_CURTO[mes - 1]} ${String(ano).slice(2)}`;
};

/**
 * A previsão, desenhada: para onde vai o dinheiro.
 *
 * ## Porque é uma linha e não barras
 *
 * A pergunta desta página não é "quanto entra em Março" — isso está na tabela.
 * É **quando é que isto passa a dar**. Uma linha do saldo acumulado responde de
 * uma vez: verde acima de zero, vermelho abaixo, e o mês em que atravessa vê-se
 * sem ler número nenhum. As barras de receita ao lado de uma linha de gastos
 * obrigavam a fazer a subtracção de cabeça, mês a mês.
 *
 * O acumulado é a soma dos saldos mensais desde hoje — o buraco que se abre até
 * a receita chegar, e quanto falta para o tapar.
 */
function Grafico({ previsao, simulando }: { previsao: Previsao; simulando: boolean }) {
  const meses = previsao.meses;
  const fim = meses[meses.length - 1];
  const viraEm = meses.find((m) => m.acumuladoCents >= 0 && m.saldoCents > 0);

  return (
    <>
      <ChartHero
        valor={euros(fim?.acumuladoCents ?? 0)}
        unidade={`acumulado até ${mesLabel(fim?.mes ?? "")}`}
        delta={{
          texto: viraEm
            ? `o acumulado passa a positivo em ${mesLabel(viraEm.mes)}`
            : "o acumulado ainda é negativo no fim do período",
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
          detalhe: `${euros(m.acumuladoCents)} acumulado · ${m.saldoCents >= 0 ? "+" : ""}${euros(m.saldoCents)} no mês`,
        }))}
      />

      <p className="px-5 pt-3 pb-1 text-meta leading-relaxed text-ink-3">
        A linha é o saldo somado desde hoje: o que entra dos contratos menos os gastos fixos.
        {previsao.cobreEm ? (
          <>
            {" "}
            A receita passa a cobrir os gastos em <b className="text-ink">{mesLabel(previsao.cobreEm)}</b>.
          </>
        ) : (
          " Com os clubes de hoje, a receita ainda não cobre os gastos dentro de um ano."
        )}
        {simulando && " A simulação já está somada à linha — são clubes sem contrato por trás."}
      </p>

      <div className="overflow-x-auto px-5 pb-4">
        <table className="w-full min-w-[520px] border-collapse text-meta">
          <thead>
            <tr className="text-ink-3">
              <th className="py-2 text-left font-medium">Mês</th>
              <th className="py-2 text-right font-medium">Receita</th>
              {simulando && <th className="py-2 text-right font-medium">Simulada</th>}
              <th className="py-2 text-right font-medium">Gastos</th>
              <th className="py-2 text-right font-medium">Saldo</th>
              <th className="py-2 text-right font-medium">Acumulado</th>
            </tr>
          </thead>
          <tbody>
            {previsao.meses.map((m) => (
              <tr key={m.mes} className="border-t border-line text-ink-2">
                <td className="py-1.5">{mesLabel(m.mes)}</td>
                <td className="py-1.5 text-right tabular">{euros(m.receitaCents)}</td>
                {simulando && <td className="py-1.5 text-right tabular text-ink-3">{euros(m.receitaSimuladaCents)}</td>}
                <td className="py-1.5 text-right tabular">{euros(m.gastosCents)}</td>
                <td className={cx("py-1.5 text-right font-medium tabular", m.saldoCents < 0 ? "text-risk" : "text-ink")}>
                  {euros(m.saldoCents)}
                </td>
                <td className={cx("py-1.5 text-right tabular", m.acumuladoCents < 0 ? "text-risk" : "text-ink-2")}>
                  {euros(m.acumuladoCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Uma mensalidade de um clube, com o botão de marcar o recebimento. */
function Mensalidade({ m, onChanged }: { m: MensalidadeDoClube; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const vencida = !m.paidAt && new Date(m.dueOn) < new Date();

  async function alternar() {
    if (busy) return;
    setBusy(true);
    try {
      if (m.paidAt) await apiDelete(`/contas/mensalidades/${m.id}/pago`);
      else await apiPost(`/contas/mensalidades/${m.id}/pago`, {});
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-ink">{m.academy.name}</span>
        <span className="block text-meta text-ink-3">
          {shortDate(m.periodStart)} a {shortDate(m.periodEnd)} · {m.planName}
          {m.paidAt ? ` · pago a ${shortDate(m.paidAt)}` : ` · limite ${shortDate(m.dueOn)}`}
        </span>
      </span>
      {m.paidAt ? <Pill tone="ok">Paga</Pill> : vencida ? <Pill tone="risk">Vencida</Pill> : <Pill tone="warn">Por pagar</Pill>}
      <span className="shrink-0 text-body text-ink tabular">{eurosExact(m.amountCents)}</span>
      <button type="button" className="ctl-ghost shrink-0" disabled={busy} onClick={() => void alternar()}>
        {m.paidAt ? (
          <>
            <Undo2 className="size-3.5" strokeWidth={1.75} />
            Desmarcar
          </>
        ) : (
          <>
            <Check className="size-3.5" strokeWidth={2} />
            Recebida
          </>
        )}
      </button>
    </li>
  );
}

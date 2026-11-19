import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Empty, Loading, Panel, PanelHead, SelectField, cx } from "@/components/primitives";
import { BarrasDuplas, BarrasOrdenadas, ChartEmpty, LARANJA, SaldoChart, Sparkline, VERDE } from "@/components/chart/Chart";
import { TransactionDialog } from "@/components/finance/TransactionDialog";
import { ChargeFamilyDialog } from "@/components/finance/ChargeFamilyDialog";
import { Vencimentos } from "@/routes/finance/Vencimentos";
import Movements from "@/routes/finance/Movements";
import Budget from "@/routes/finance/Budget";
import {
  ArrowRight,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Plus,
  Send,
  Settings,
  TriangleAlert,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { exportarContasExcel, exportarContasPdf, saldoPorMes } from "@/lib/contas-export";
import {
  STATUS_LABEL,
  euros,
  eurosComSinal,
  eurosCurtos,
  getBudgets,
  getFolha,
  getOverview,
  getSettings,
  listTransactions,
  mesCurto,
  mesLongo,
  updateSettings,
  type Atencao,
  type FinanceKind,
  type FinanceSettings,
  type Overview,
  type UpcomingRow,
} from "@/lib/finance";

/**
 * Contas — o dinheiro do clube, numa página.
 *
 * ## Quatro separadores, uma pergunta cada
 *
 * - **Visão geral**: quanto temos, o que entrou e saiu, para onde vai, e o que
 *   precisa de atenção. Cinco segundos, sem abrir mais nada.
 * - **Movimentos**: o extracto, filtrável e exportável.
 * - **Vencimentos**: quem o clube paga e o que falta pagar.
 * - **Orçamento**: o tecto de cada categoria contra o gasto da época.
 *
 * Eram três páginas (painel, movimentos, orçamento) e os vencimentos não
 * existiam. Passou a ser uma página com separadores, como o Inventário: o
 * separador fica no endereço (`?vista=movimentos`) e os endereços antigos
 * continuam a abrir no sítio certo.
 *
 * ## A visão geral, por ordem
 *
 * O saldo é o herói: um número grande, e a variação do mês por baixo. Ao lado,
 * três cartões com o mês (receitas, despesas, resultado), cada um com a linha
 * dos últimos meses e a comparação com o mês anterior. Depois, só quando
 * existe, a lista do que precisa de atenção. Depois os gráficos, sobre o
 * período que se escolheu (6, 12 ou 24 meses): receitas e despesas lado a lado,
 * e o saldo no fim de cada mês. Por fim, em que se gastou e recebeu por
 * categoria, a previsão, os vencimentos e o orçamento em resumo, e o que vem aí.
 *
 * Referências: a fila de números com tendência e o "o que precisa de atenção"
 * primeiro vêm dos painéis da Ramp e do Brex (as excepções à frente, a análise
 * um nível abaixo); as barras ordenadas por categoria em vez de um gráfico
 * circular e a linha do saldo que muda de cor no zero seguem as regras do
 * motor de gráficos (`components/chart/Chart.tsx`).
 */

type Vista = "geral" | "movimentos" | "vencimentos" | "orcamento";
const VISTAS: Vista[] = ["geral", "movimentos", "vencimentos", "orcamento"];
const PERIODOS = [6, 12, 24] as const;

export default function Finance() {
  const { session } = useSession();
  const podeEscrever = can(session, "finance:write");
  const [params, setParams] = useSearchParams();

  const pedida = params.get("vista") as Vista | null;
  const vista: Vista = pedida && VISTAS.includes(pedida) ? pedida : "geral";
  const mesesPedidos = Number(params.get("meses"));
  const meses = (PERIODOS as readonly number[]).includes(mesesPedidos) ? mesesPedidos : 6;

  const [data, setData] = useState<Overview | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [registar, setRegistar] = useState<FinanceKind | null>(null);
  const [cobrar, setCobrar] = useState(false);
  const [definicoes, setDefinicoes] = useState(false);
  const [aExportar, setAExportar] = useState(false);
  const [erroExportar, setErroExportar] = useState<string | null>(null);

  async function carregar(n = meses) {
    setErro(null);
    try {
      setData(await getOverview({ meses: n }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar as contas.");
    }
  }

  useEffect(() => {
    void carregar(meses);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meses]);

  /** Muda de separador. Os filtros de um separador não fazem sentido no outro, excepto o período. */
  const irPara = (v: Vista, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    if (v !== "geral") p.set("vista", v);
    if (meses !== 6) p.set("meses", String(meses));
    for (const [k, val] of Object.entries(extra)) p.set(k, val);
    setParams(p, { replace: true });
  };

  const mudarPeriodo = (n: number) => {
    const p = new URLSearchParams(params);
    if (n === 6) p.delete("meses");
    else p.set("meses", String(n));
    setParams(p, { replace: true });
  };

  /**
   * O relatório: o que a página mostra, para o período escolhido. Os
   * movimentos do período, a folha e o orçamento vão-se buscar na altura —
   * são as três coisas que o painel não traz inteiras.
   */
  async function exportar(formato: "xlsx" | "pdf") {
    if (!data || aExportar) return;
    setAExportar(true);
    setErroExportar(null);
    try {
      const de = data.monthly[0]?.month ?? data.mesAtual ?? "";
      const ate = data.monthly[data.monthly.length - 1]?.month ?? de;
      const [movimentos, folha, orcamento] = await Promise.all([
        listTransactions({ from: `${de}-01T00:00:00.000Z`, to: `${fimDoMes(ate)}T23:59:59.999Z` }),
        getFolha().catch(() => null),
        getBudgets().catch(() => null),
      ]);
      const dados = {
        overview: data,
        movimentos,
        folha,
        orcamento: orcamento ? { epoca: orcamento.season.label, rows: orcamento.rows } : null,
        periodo: { de, ate },
      };
      if (formato === "xlsx") await exportarContasExcel(dados);
      else await exportarContasPdf(dados);
    } catch (e) {
      setErroExportar(e instanceof Error ? e.message : "Não foi possível exportar.");
    } finally {
      setAExportar(false);
    }
  }

  if (erro) return <Empty title="Contas" detail={erro} icon={TriangleAlert} />;
  if (!data) return <Loading />;

  const vazio = data.saldo === 0 && data.monthly.every((m) => m.income === 0 && m.expense === 0) && !(data.vencimentos?.pessoas);
  const porPagar = (data.vencimentos?.porPagarEsteMes.n ?? 0) + (data.vencimentos?.emAtraso.n ?? 0);

  return (
    <>
      <PageHeader title="Contas" subtitle="O dinheiro do clube: o que entrou, o que saiu, e o que vem aí.">
        <MenuExportar aExportar={aExportar} onEscolher={(f) => void exportar(f)} />
        {podeEscrever && (
          <>
            {/*
              Cobrar a uma família é outra coisa e por isso é outro botão: um
              movimento regista o que já se sabe, isto **pede** dinheiro a
              alguém e faz tocar um telemóvel.
            */}
            <button type="button" className="ctl-outline" onClick={() => setCobrar(true)}>
              <Send className="size-3.5" strokeWidth={1.75} />
              Cobrar a uma família
            </button>
            <button type="button" className="ctl-primary" onClick={() => setRegistar("EXPENSE")}>
              <Plus className="size-3.5" strokeWidth={2} />
              Novo movimento
            </button>
          </>
        )}
      </PageHeader>

      {erroExportar && <p className="mb-3 text-meta text-risk">{erroExportar}</p>}

      <div className="mb-3 overflow-x-auto">
        <div className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-sunken p-1" role="tablist" aria-label="Vistas das contas">
          {(
            [
              ["geral", "Visão geral", null],
              ["movimentos", "Movimentos", null],
              ["vencimentos", "Vencimentos", porPagar > 0 ? porPagar : null],
              ["orcamento", "Orçamento", data.orcamento && data.orcamento.acima > 0 ? data.orcamento.acima : null],
            ] as const
          ).map(([k, rotulo, n]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={vista === k}
              onClick={() => irPara(k)}
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-meta font-semibold whitespace-nowrap transition-colors duration-[120ms]",
                vista === k ? "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.06)]" : "text-ink-3 hover:text-ink-2",
              )}
            >
              {rotulo}
              {n !== null && <span className="text-warn tabular">{n}</span>}
            </button>
          ))}
        </div>
      </div>

      {vista === "geral" &&
        (vazio ? (
          <Panel>
            <Empty
              title="As contas começam aqui"
              detail="Regista a primeira receita ou despesa, define o saldo inicial nas definições, ou o vencimento de quem o clube paga. As mensalidades pagas entram sozinhas."
              icon={Wallet}
            >
              {podeEscrever && (
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" className="ctl-outline" onClick={() => setDefinicoes(true)}>
                    Saldo inicial
                  </button>
                  <button type="button" className="ctl-primary" onClick={() => setRegistar("EXPENSE")}>
                    Registar movimento
                  </button>
                </div>
              )}
            </Empty>
          </Panel>
        ) : (
          <VisaoGeral
            data={data}
            meses={meses}
            onPeriodo={mudarPeriodo}
            podeEscrever={podeEscrever}
            onDefinicoes={() => setDefinicoes(true)}
            irPara={irPara}
          />
        ))}
      {vista === "movimentos" && <Movements embutido onChange={() => void carregar()} />}
      {vista === "vencimentos" && <Vencimentos podeEscrever={podeEscrever} onChange={() => void carregar()} />}
      {vista === "orcamento" && <Budget embutido />}

      {registar && (
        <TransactionDialog
          kind={registar}
          onClose={() => setRegistar(null)}
          onDone={() => {
            setRegistar(null);
            void carregar();
          }}
        />
      )}
      {definicoes && (
        <SettingsDialog
          onClose={() => setDefinicoes(false)}
          onDone={() => {
            setDefinicoes(false);
            void carregar();
          }}
        />
      )}
      {cobrar && (
        <ChargeFamilyDialog
          onClose={() => setCobrar(false)}
          onDone={() => {
            setCobrar(false);
            void carregar();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Visão geral                                                                 */
/* -------------------------------------------------------------------------- */

function VisaoGeral({
  data,
  meses,
  onPeriodo,
  podeEscrever,
  onDefinicoes,
  irPara,
}: {
  data: Overview;
  meses: number;
  onPeriodo: (n: number) => void;
  podeEscrever: boolean;
  onDefinicoes: () => void;
  irPara: (v: Vista, extra?: Record<string, string>) => void;
}) {
  const [horizonte, setHorizonte] = useState(30);
  const [lado, setLado] = useState<FinanceKind>("EXPENSE");

  const previsao = data.forecast.find((f) => f.days === horizonte) ?? data.forecast[0];
  const saldoProjetado = data.saldo + previsao.income - previsao.expense;
  const aGanhar = data.resultadoMes >= 0;

  const n = data.monthly.length;
  const anterior = n >= 2 ? data.monthly[n - 2] : null;
  const saldos = useMemo(() => saldoPorMes(data), [data]);
  const comAno = meses > 6;

  const categorias = data.porCategoria.filter((c) => c.kind === lado);
  const atencao = data.atencao ?? [];

  return (
    <>
      {/* O saldo, e o mês em três cartões com tendência. */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)]">
        <Panel>
          <div className="flex h-full flex-col justify-between px-5 py-4">
            <div className="flex items-center gap-1.5 text-meta text-ink-3">
              <Wallet className="size-3.5" strokeWidth={1.75} />
              Saldo atual
              {podeEscrever && (
                <button
                  type="button"
                  onClick={onDefinicoes}
                  className="ml-1 flex size-6 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink-2"
                  aria-label="Definições das contas"
                  title="Saldo inicial e fontes automáticas"
                >
                  <Settings className="size-3.5" strokeWidth={1.75} />
                </button>
              )}
            </div>
            <div className={cx("mt-3 text-[40px] leading-none font-semibold tracking-[-0.03em]", data.saldo < 0 ? "text-risk" : "text-ink")}>
              {euros(data.saldo)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
              <span className={cx("flex items-center gap-1 font-medium", aGanhar ? "text-ok" : "text-risk")}>
                {aGanhar ? <TrendingUp className="size-3.5" strokeWidth={1.75} /> : <TrendingDown className="size-3.5" strokeWidth={1.75} />}
                {eurosComSinal(data.resultadoMes)} este mês
              </span>
              <span className="text-ink-4">
                {saldoProjetado >= data.saldo ? "sobe" : "desce"} para <span className="font-medium text-ink-2 tabular">{euros(saldoProjetado)}</span> em {previsao.days} dias
              </span>
            </div>
          </div>
        </Panel>

        <div className="grid gap-3 sm:grid-cols-3">
          <Indicador
            rotulo="Receitas este mês"
            valor={euros(data.receitasMes)}
            serie={data.monthly.map((m) => m.income)}
            cor={VERDE}
            delta={variacao(data.receitasMes, anterior?.income)}
            nota={
              [
                data.mensalidadesMes > 0 ? `${eurosCurtos(data.mensalidadesMes)} de mensalidades` : null,
                (data.quotasMes ?? 0) > 0 ? `${eurosCurtos(data.quotasMes ?? 0)} de quotas` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "sem mensalidades nem quotas"
            }
          />
          <Indicador
            rotulo="Despesas este mês"
            valor={euros(data.despesasMes)}
            serie={data.monthly.map((m) => m.expense)}
            cor={LARANJA}
            delta={variacao(data.despesasMes, anterior?.expense)}
            bomQuandoDesce
            nota={previsao.expense > 0 ? `${eurosCurtos(previsao.expense)} previstas em ${previsao.days} dias` : "nada previsto"}
          />
          <Indicador
            rotulo="Resultado do mês"
            valor={eurosComSinal(data.resultadoMes)}
            serie={data.monthly.map((m) => m.income - m.expense)}
            cor="var(--color-ink-3)"
            tom={aGanhar ? "ok" : "risk"}
            nota={anterior ? `${eurosComSinal(anterior.income - anterior.expense)} em ${mesLongo(anterior.month).split(" de ")[0]}` : "primeiro mês com dados"}
          />
        </div>
      </div>

      {atencao.length > 0 && <PrecisaDeAtencao itens={atencao} irPara={irPara} />}

      {/* O período manda nos gráficos e no "por categoria", de uma vez. */}
      <div className="mt-5 mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-panel text-ink">
          Os últimos {meses} meses
          <span className="ml-2 text-meta font-normal text-ink-3">
            {mesCurto(data.monthly[0]?.month ?? "", true)} a {mesCurto(data.monthly[n - 1]?.month ?? "", true)}
          </span>
        </h2>
        <div className="inline-flex items-center gap-px rounded-[var(--radius-control)] bg-sunken p-0.5" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={meses === p}
              onClick={() => onPeriodo(p)}
              className={cx(
                "h-7 rounded-[6px] px-2.5 text-meta font-semibold transition-colors duration-[120ms]",
                meses === p ? "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.06)]" : "text-ink-3 hover:text-ink-2",
              )}
            >
              {p} meses
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHead title="Receitas e despesas" hint="por mês · mensalidades e quotas no mês em que foram pagas" />
          <div className="pt-3">
            <BarrasDuplas
              dados={data.monthly.map((m) => ({ key: m.month, label: mesCurto(m.month, comAno), a: m.income, b: m.expense }))}
              rotuloA="Receitas"
              rotuloB="Despesas"
              formato={euros}
              formatoEixo={eurosCurtos}
              height={240}
              resumo={(p) => (
                <span className="flex items-center justify-between gap-2">
                  <span className="font-normal text-surface/80">Resultado</span>
                  {eurosComSinal(p.a - p.b)}
                </span>
              )}
            />
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Saldo" hint="no fim de cada mês" />
          <div className="pt-3">
            {saldos.length < 2 ? (
              <ChartEmpty height={240} />
            ) : (
              <SaldoChart
                dados={data.monthly.map((m, i) => ({
                  key: m.month,
                  label: mesCurto(m.month, comAno),
                  value: saldos[i],
                  detalhe: (
                    <>
                      <span className="block">{euros(saldos[i])}</span>
                      <span className="block font-normal text-surface/70">{eurosComSinal(m.income - m.expense)} no mês</span>
                    </>
                  ),
                }))}
                formato={euros}
                formatoEixo={eurosCurtos}
                height={240}
              />
            )}
          </div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        {/* Em que se gastou e de onde veio: barras ordenadas, uma cor. */}
        <Panel>
          <PanelHead title="Por categoria" hint={`${meses} meses`}>
            <div className="inline-flex items-center gap-px rounded-[var(--radius-control)] bg-sunken p-0.5" role="group" aria-label="Receitas ou despesas">
              {(
                [
                  ["EXPENSE", "Despesas"],
                  ["INCOME", "Receitas"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={lado === k}
                  onClick={() => setLado(k)}
                  className={cx(
                    "h-7 rounded-[6px] px-2.5 text-meta font-semibold transition-colors duration-[120ms]",
                    lado === k ? "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.06)]" : "text-ink-3 hover:text-ink-2",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </PanelHead>
          <div className="px-5 py-4">
            {categorias.length === 0 ? (
              <Empty title={lado === "EXPENSE" ? "Sem despesas no período" : "Sem receitas no período"} icon={Wallet} compact />
            ) : (
              <BarrasOrdenadas linhas={categorias.map((c) => ({ label: c.label, value: c.amountCents }))} cor={lado === "EXPENSE" ? LARANJA : VERDE} formato={euros} max={7} />
            )}
          </div>
        </Panel>

        {/* A previsão: o que o saldo será se o previsto acontecer. */}
        <Panel>
          <PanelHead title="Previsão">
            <SelectField
              size="sm"
              value={String(previsao.days)}
              onChange={(v) => setHorizonte(Number(v))}
              options={[
                { value: "30", label: "30 dias" },
                { value: "90", label: "90 dias" },
                { value: "180", label: "6 meses" },
                { value: "365", label: "12 meses" },
              ]}
            />
          </PanelHead>
          <dl className="space-y-2.5 px-5 py-4">
            <Linha rotulo="Saldo atual" valor={euros(data.saldo)} />
            <Linha rotulo="Receitas previstas" valor={`+${euros(previsao.income)}`} tom="ok" />
            <Linha rotulo="Despesas previstas" valor={`−${euros(previsao.expense)}`} tom="risk" />
            <div className="flex items-baseline justify-between border-t border-line pt-2.5">
              <dt className="text-body font-semibold text-ink">Saldo projetado</dt>
              <dd className={cx("text-[20px] font-semibold tracking-[-0.02em] tabular", saldoProjetado < 0 && "text-risk")}>{euros(saldoProjetado)}</dd>
            </div>
          </dl>
          <p className="border-t border-line px-5 py-2.5 text-meta leading-relaxed text-ink-3">
            O previsto não é saldo: só o que acontece mexe no número de cima. Os vencimentos por pagar contam aqui, no dia em que vencem.
          </p>
        </Panel>

        <div className="grid gap-3">
          {/* Os vencimentos e o orçamento, em resumo: cada um abre o seu separador. */}
          <Panel>
            <PanelHead title="Vencimentos">
              <button type="button" className="ctl-ghost" onClick={() => irPara("vencimentos")}>
                Ver <ArrowRight className="size-3.5" strokeWidth={1.75} />
              </button>
            </PanelHead>
            {data.vencimentos && data.vencimentos.pessoas > 0 ? (
              <div className="px-5 py-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-[22px] leading-none font-semibold tracking-[-0.02em] text-ink">{euros(data.vencimentos.folhaMensal)}</span>
                  <span className="text-meta text-ink-3">
                    por mês · {data.vencimentos.pessoas} {data.vencimentos.pessoas === 1 ? "pessoa" : "pessoas"}
                  </span>
                </div>
                <Barra
                  partes={[
                    { valor: data.vencimentos.pagoEsteMes.amountCents, cor: "bg-ok", rotulo: "pago" },
                    { valor: data.vencimentos.porPagarEsteMes.amountCents, cor: "bg-warn", rotulo: "por pagar" },
                  ]}
                  total={data.vencimentos.folhaMensal}
                />
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-3">
                  <span>
                    <span className="font-medium text-ink-2 tabular">{data.vencimentos.pagoEsteMes.n}</span> {data.vencimentos.pagoEsteMes.n === 1 ? "pago" : "pagos"} este mês
                  </span>
                  <span className={data.vencimentos.porPagarEsteMes.n > 0 ? "text-warn" : undefined}>
                    <span className="font-medium tabular">{data.vencimentos.porPagarEsteMes.n}</span> por pagar
                  </span>
                  {data.vencimentos.emAtraso.n > 0 && (
                    <span className="text-risk">
                      <span className="font-medium tabular">{data.vencimentos.emAtraso.n}</span> {data.vencimentos.emAtraso.n === 1 ? "mês em atraso" : "meses em atraso"}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="px-5 py-4 text-meta leading-relaxed text-ink-3">
                Ainda sem vencimentos definidos. Treinadores, staff e atletas pagos pelo clube entram aqui, e cada mês pago cai nas despesas.
              </p>
            )}
          </Panel>

          <Panel>
            <PanelHead title="Orçamento" hint={data.orcamento ? `época ${data.orcamento.epoca}` : undefined}>
              <button type="button" className="ctl-ghost" onClick={() => irPara("orcamento")}>
                Ver <ArrowRight className="size-3.5" strokeWidth={1.75} />
              </button>
            </PanelHead>
            {data.orcamento && data.orcamento.budgetCents > 0 ? (
              <div className="px-5 py-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-[22px] leading-none font-semibold tracking-[-0.02em] text-ink">{euros(data.orcamento.spentCents)}</span>
                  <span className="text-meta text-ink-3">de {euros(data.orcamento.budgetCents)} orçados</span>
                </div>
                <Barra
                  partes={[
                    {
                      valor: Math.min(data.orcamento.spentCents, data.orcamento.budgetCents),
                      cor: data.orcamento.spentCents > data.orcamento.budgetCents ? "bg-risk" : data.orcamento.spentCents / data.orcamento.budgetCents > 0.85 ? "bg-warn" : "bg-signal",
                      rotulo: "gasto",
                    },
                  ]}
                  total={data.orcamento.budgetCents}
                />
                <p className={cx("mt-2 text-meta", data.orcamento.acima > 0 ? "text-risk" : "text-ink-3")}>
                  {data.orcamento.acima > 0
                    ? `${data.orcamento.acima} ${data.orcamento.acima === 1 ? "categoria acima do tecto" : "categorias acima do tecto"}`
                    : `${Math.round((data.orcamento.spentCents / data.orcamento.budgetCents) * 100)}% do orçamento gasto · ${data.orcamento.categorias} ${data.orcamento.categorias === 1 ? "categoria" : "categorias"}`}
                </p>
              </div>
            ) : (
              <p className="px-5 py-4 text-meta leading-relaxed text-ink-3">
                {data.orcamento ? `A época ${data.orcamento.epoca} ainda não tem orçamento. ` : ""}Um tecto por categoria de despesa, e o gasto da época contra ele.
              </p>
            )}
          </Panel>
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <ProximosPanel titulo="Próximas despesas" rows={data.proximasDespesas} sinal="−" tone="text-risk" irPara={irPara} />
        <ProximosPanel titulo="Receitas previstas" rows={data.proximasReceitas} sinal="+" tone="text-ok" irPara={irPara} />
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Peças                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Um número do mês com a linha dos últimos meses ao lado e a comparação com o
 * mês anterior. A comparação só aparece quando o mês anterior teve valor: uma
 * percentagem sobre zero não é informação.
 */
function Indicador({
  rotulo,
  valor,
  serie,
  cor,
  delta,
  bomQuandoDesce,
  tom,
  nota,
}: {
  rotulo: string;
  valor: string;
  serie: number[];
  cor: string;
  delta?: number | null;
  bomQuandoDesce?: boolean;
  tom?: "ok" | "risk";
  nota?: string;
}) {
  const sobe = (delta ?? 0) >= 0;
  const bom = bomQuandoDesce ? !sobe : sobe;
  return (
    <div className="panel flex flex-col justify-between gap-3 p-4">
      <div className="text-meta text-ink-3">{rotulo}</div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={cx("text-[22px] leading-none font-semibold tracking-[-0.02em]", tom === "ok" ? "text-ok" : tom === "risk" ? "text-risk" : "text-ink")}>{valor}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {delta !== null && delta !== undefined && (
              <span
                className={cx(
                  "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular",
                  bom ? "bg-ok-soft text-ok" : "bg-risk-soft text-risk",
                )}
                title="Em relação ao mês anterior"
              >
                {sobe ? <TrendingUp className="size-3" strokeWidth={2} /> : <TrendingDown className="size-3" strokeWidth={2} />}
                {Math.abs(delta).toLocaleString("pt-PT", { maximumFractionDigits: 0 })}%
              </span>
            )}
            {nota && <span className="truncate text-meta text-ink-4">{nota}</span>}
          </div>
        </div>
        <div className="h-8 w-20 shrink-0">
          <Sparkline valores={serie} cor={cor} height={32} />
        </div>
      </div>
    </div>
  );
}

/** A variação em percentagem face ao mês anterior; nula quando não há com que comparar. */
function variacao(atual: number, anterior: number | undefined): number | null {
  if (!anterior || anterior <= 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

/**
 * O que está fora do sítio, primeiro.
 *
 * Só aparece quando há alguma coisa: vencimentos em atraso ou por pagar,
 * movimentos previstos com a data passada, categorias acima do orçamento, um
 * saldo que fica negativo a 30 dias. Cada linha leva ao sítio onde se resolve.
 */
function PrecisaDeAtencao({ itens, irPara }: { itens: Atencao[]; irPara: (v: Vista, extra?: Record<string, string>) => void }) {
  return (
    <Panel className="mt-3">
      <PanelHead title="Precisa de atenção" hint={`${itens.length} ${itens.length === 1 ? "assunto" : "assuntos"}`} />
      <ul className="divide-y divide-line">
        {itens.map((a, i) => {
          const { texto, detalhe, tom, vista, extra } = descrever(a);
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => irPara(vista, extra)}
                className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-sunken/60"
              >
                <span className={cx("size-2 shrink-0 rounded-full", tom === "risk" ? "bg-risk" : "bg-warn")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-ink">{texto}</span>
                  {detalhe && <span className="block truncate text-meta text-ink-3">{detalhe}</span>}
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function descrever(a: Atencao): { texto: string; detalhe?: string; tom: "risk" | "warn"; vista: Vista; extra?: Record<string, string> } {
  switch (a.tipo) {
    case "vencimentos-atraso":
      return {
        texto: `${a.n} ${a.n === 1 ? "mês de vencimento em atraso" : "meses de vencimento em atraso"} · ${euros(a.amountCents)}`,
        detalhe: "Meses anteriores que ficaram por pagar.",
        tom: "risk",
        vista: "vencimentos",
      };
    case "vencimentos-mes":
      return {
        texto: `${a.n} ${a.n === 1 ? "pessoa por pagar este mês" : "pessoas por pagar este mês"} · ${euros(a.amountCents)}`,
        detalhe: "Vencimentos deste mês ainda sem pagamento registado.",
        tom: "warn",
        vista: "vencimentos",
      };
    case "previstos-vencidos":
      return {
        texto: `${a.n} ${a.n === 1 ? "movimento previsto com a data passada" : "movimentos previstos com a data passada"}`,
        detalhe: [a.amountCents > 0 ? `${euros(a.amountCents)} de despesas` : null, a.receitasCents > 0 ? `${euros(a.receitasCents)} de receitas` : null]
          .filter(Boolean)
          .join(" · ")
          .concat(" por confirmar ou cancelar."),
        tom: "warn",
        vista: "movimentos",
        extra: { estado: "PLANNED" },
      };
    case "orcamento":
      return {
        texto: `${a.categorias.length} ${a.categorias.length === 1 ? "categoria acima do orçamento" : "categorias acima do orçamento"} da época ${a.epoca}`,
        detalhe: a.categorias.map((c) => `${c.label} ${euros(c.spentCents - c.budgetCents)} acima`).join(" · "),
        tom: "risk",
        vista: "orcamento",
      };
    case "saldo-projetado":
      return {
        texto: `O saldo fica negativo nos próximos 30 dias: ${euros(a.amountCents)}`,
        detalhe: "Com as despesas e receitas previstas até lá.",
        tom: "risk",
        vista: "movimentos",
        extra: { estado: "PLANNED" },
      };
  }
}

function Linha({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: "ok" | "risk" }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-body text-ink-2">{rotulo}</dt>
      <dd className={cx("text-body font-medium tabular", tom === "ok" ? "text-ok" : tom === "risk" ? "text-risk" : "text-ink")}>{valor}</dd>
    </div>
  );
}

/** Uma barra fina de partes de um todo, sem texto: os números estão ao lado. */
function Barra({ partes, total }: { partes: { valor: number; cor: string; rotulo: string }[]; total: number }) {
  const base = Math.max(total, partes.reduce((s, p) => s + p.valor, 0), 1);
  return (
    <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
      {partes
        .filter((p) => p.valor > 0)
        .map((p) => (
          <span key={p.rotulo} className={cx("h-full rounded-full", p.cor)} style={{ width: `${(p.valor / base) * 100}%` }} title={p.rotulo} />
        ))}
    </div>
  );
}

function ProximosPanel({
  titulo,
  rows,
  sinal,
  tone,
  irPara,
}: {
  titulo: string;
  rows: UpcomingRow[];
  sinal: string;
  tone: string;
  irPara: (v: Vista, extra?: Record<string, string>) => void;
}) {
  return (
    <Panel>
      <PanelHead title={titulo}>
        <button type="button" className="ctl-ghost" onClick={() => irPara("movimentos", { estado: "PLANNED" })}>
          Ver todas
        </button>
      </PanelHead>
      {rows.length === 0 ? (
        <Empty title="Nada previsto" detail="Os movimentos previstos aparecem aqui, com a data." icon={Wallet} compact />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const vencimento = r.id.startsWith("salary_");
            return (
              <li key={r.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink">{r.description}</span>
                  <span className="block truncate text-meta text-ink-3">
                    {shortDate(new Date(r.occurredAt))}
                    {r.eventLabel ? ` · ${r.eventLabel}` : r.category ? ` · ${r.category}` : ""}
                    {r.status === "PENDING" ? ` · ${STATUS_LABEL.PENDING}` : ""}
                  </span>
                </span>
                {vencimento && (
                  <button type="button" className="ctl-ghost h-7 text-meta" onClick={() => irPara("vencimentos")}>
                    Pagar
                  </button>
                )}
                <span className={cx("shrink-0 text-body font-semibold tabular", tone)}>
                  {sinal}
                  {euros(r.amountCents)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/**
 * O relatório, em Excel ou em PDF. Um botão com duas saídas: o Excel para
 * quem quer continuar a fazer contas, o PDF para quem só quer ler.
 */
function MenuExportar({ aExportar, onEscolher }: { aExportar: boolean; onEscolher: (f: "xlsx" | "pdf") => void }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  return (
    <div ref={ref} className="relative">
      <button type="button" className="ctl-ghost" onClick={() => setAberto((a) => !a)} disabled={aExportar} aria-haspopup="menu" aria-expanded={aberto}>
        <Download className="size-3.5" strokeWidth={1.75} />
        {aExportar ? "A exportar…" : "Exportar"}
        <ChevronDown className="size-3.5" strokeWidth={1.75} />
      </button>
      {aberto && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-60 rounded-[var(--radius-panel)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
          <Opcao
            icon={<FileSpreadsheet className="size-4 text-ink-3" strokeWidth={1.75} />}
            titulo="Relatório em Excel"
            detalhe="Resumo, meses, categorias, movimentos, vencimentos e orçamento, em folhas."
            onClick={() => {
              setAberto(false);
              onEscolher("xlsx");
            }}
          />
          <Opcao
            icon={<FileText className="size-4 text-ink-3" strokeWidth={1.75} />}
            titulo="Relatório em PDF"
            detalhe="As mesmas tabelas, prontas a ler e a enviar."
            onClick={() => {
              setAberto(false);
              onEscolher("pdf");
            }}
          />
        </div>
      )}
    </div>
  );
}

function Opcao({ icon, titulo, detalhe, onClick }: { icon: ReactNode; titulo: string; detalhe: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-start gap-2.5 rounded-[7px] px-2.5 py-2 text-left hover:bg-sunken">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-body font-medium text-ink">{titulo}</span>
        <span className="block text-meta leading-snug text-ink-3">{detalhe}</span>
      </span>
    </button>
  );
}

/** `AAAA-MM-DD` do último dia de um mês `AAAA-MM`. */
function fimDoMes(chave: string): string {
  const [a, m] = chave.split("-").map(Number);
  const dia = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${chave}-${String(dia).padStart(2, "0")}`;
}

/**
 * O ponto de partida do saldo, e o que conta para ele.
 *
 * O interruptor das mensalidades diz explicitamente que desligar não cancela
 * pagamento nenhum: decide só se a fonte automática conta neste módulo.
 */
function SettingsDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [s, setS] = useState<FinanceSettings | null>(null);
  const [saldo, setSaldo] = useState("");
  const [desde, setDesde] = useState("");
  const [comFees, setComFees] = useState(true);
  const [comQuotas, setComQuotas] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((r) => {
        setS(r);
        setSaldo((r.initialBalanceCents / 100).toFixed(2).replace(".", ","));
        setDesde(r.initialBalanceAt ? r.initialBalanceAt.slice(0, 10) : "");
        setComFees(r.includeFees);
        setComQuotas(r.includeQuotas);
      })
      .catch(() => setErro("Não foi possível carregar as definições."));
  }, []);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cents = Math.round(Number(saldo.trim().replace(/\s/g, "").replace(",", ".")) * 100);
    if (!Number.isFinite(cents)) {
      setErro("O saldo inicial não é um valor válido.");
      return;
    }
    setBusy(true);
    setErro(null);
    try {
      await updateSettings({ initialBalanceCents: cents, initialBalanceAt: desde, includeFees: comFees, includeQuotas: comQuotas });
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="definicoes-contas"
      title="Definições das contas"
      subtitle="O ponto de partida do saldo, e o que conta para ele"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="form-definicoes" className="ctl-primary" disabled={busy || !s}>
            {busy ? "A guardar…" : "Guardar"}
          </button>
        </>
      }
    >
      <form id="form-definicoes" onSubmit={submeter} className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Saldo inicial (€)">
            <input value={saldo} onChange={(e) => setSaldo(e.target.value)} inputMode="decimal" className={cx(dialogInputClass, "text-right tabular")} />
          </DialogField>
          <DialogField label="A contar desde" hint="vazio = desde sempre">
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={dialogInputClass} />
          </DialogField>
        </div>

        <p className="text-meta leading-relaxed text-ink-3">O que aconteceu antes desta data está dentro do saldo inicial e não se conta duas vezes.</p>

        <label className="flex cursor-pointer items-start gap-2.5 border-t border-line pt-4">
          <input type="checkbox" checked={comFees} onChange={(e) => setComFees(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-signal)]" />
          <span className="text-body text-ink-2">
            Considerar as mensalidades e cobranças pagas no saldo
            <span className="block text-meta leading-relaxed text-ink-4">
              As mensalidades e as cobranças avulsas (equipamento, inscrições) confirmadas entram sozinhas como receita. Desligar não apaga nem
              cancela nenhum pagamento, só deixa de as contar aqui.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2.5">
          <input type="checkbox" checked={comQuotas} onChange={(e) => setComQuotas(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-signal)]" />
          <span className="text-body text-ink-2">
            Considerar as quotas de sócios pagas no saldo
            <span className="block text-meta leading-relaxed text-ink-4">As quotas confirmadas entram sozinhas como receita, como as mensalidades.</span>
          </span>
        </label>

        {erro && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}
      </form>
    </Dialog>
  );
}

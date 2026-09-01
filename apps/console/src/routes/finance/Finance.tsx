import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Empty, Loading, Panel, PanelHead, SelectField, cx } from "@/components/primitives";
import { TransactionDialog } from "@/components/finance/TransactionDialog";
import { Minus, Plus, Settings, TriangleAlert, TrendingDown, TrendingUp, Wallet } from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import {
  STATUS_LABEL,
  euros,
  eurosComSinal,
  getOverview,
  getSettings,
  updateSettings,
  type FinanceKind,
  type FinanceSettings,
  type Overview,
  type UpcomingRow,
} from "@/lib/finance";

/**
 * Contas — o painel.
 *
 * A página responde, por esta ordem, às perguntas de quem a abre: quanto temos,
 * quanto entrou e saiu este mês, estamos a ganhar ou a perder, e o que vem aí.
 * Cinco segundos, sem abrir mais nada — o resto (movimentos, orçamento) está a
 * um clique.
 *
 * ## O saldo é o herói
 *
 * Um número grande, e a variação do mês por baixo. Não compete com os cartões:
 * é a resposta à primeira pergunta, e as outras quatro vêm depois.
 */
export default function Finance() {
  const { session } = useSession();
  const podeEscrever = can(session, "finance:write");

  const [data, setData] = useState<Overview | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [horizonte, setHorizonte] = useState(30);
  const [registar, setRegistar] = useState<FinanceKind | null>(null);
  const [definicoes, setDefinicoes] = useState(false);

  async function carregar() {
    setErro(null);
    try {
      setData(await getOverview());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar as contas.");
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  if (erro) return <Empty title="Contas" detail={erro} icon={TriangleAlert} />;
  if (!data) return <Loading />;

  /*
   * Trocar de horizonte é mudar de vista, não fazer outra pergunta.
   *
   * O servidor manda os quatro horizontes na mesma resposta, por isso o
   * selector troca no próprio ecrã. Ia buscar o painel inteiro outra vez —
   * saldo, série de seis meses, categorias, tudo — para mexer em duas somas, e
   * quem escolhia "90 dias" ficava segundos à espera a olhar para números que
   * não iam mudar.
   */
  const previsao = data.forecast.find((f) => f.days === horizonte) ?? {
    days: data.horizonDays,
    income: data.receitasPrevistas,
    expense: data.despesasPrevistas,
  };
  const saldoProjetado = data.saldo + previsao.income - previsao.expense;

  const aGanhar = data.resultadoMes >= 0;
  const vazio = data.saldo === 0 && data.monthly.every((m) => m.income === 0 && m.expense === 0);

  return (
    <>
      <PageHeader title="Contas" subtitle="O dinheiro do clube: o que entrou, o que saiu, e o que vem aí.">
        <Link to="/contas/orcamento" className="ctl-ghost">
          Planear Orçamento
        </Link>
        <Link to="/contas/movimentos" className="ctl-outline">
          Movimentos
        </Link>
        {podeEscrever && (
          <>
            <button type="button" className="ctl-outline" onClick={() => setRegistar("EXPENSE")}>
              <Minus className="size-3.5" strokeWidth={2} />
              Despesa
            </button>
            <button type="button" className="ctl-primary" onClick={() => setRegistar("INCOME")}>
              <Plus className="size-3.5" strokeWidth={2} />
              Receita
            </button>
          </>
        )}
      </PageHeader>

      {/* O saldo — o número que responde à primeira pergunta. */}
      <Panel className="mb-3">
        <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-4">
          <div>
            <div className="flex items-center gap-1.5 text-meta text-ink-3">
              <Wallet className="size-3.5" strokeWidth={1.75} />
              Saldo atual
              {podeEscrever && (
                <button
                  type="button"
                  onClick={() => setDefinicoes(true)}
                  className="ml-1 flex size-6 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink-2"
                  aria-label="Definições das contas"
                  title="Saldo inicial e fontes automáticas"
                >
                  <Settings className="size-3.5" strokeWidth={1.75} />
                </button>
              )}
            </div>
            <div className={cx("mt-1 text-[34px] leading-none font-semibold tracking-[-0.03em] tabular", data.saldo < 0 && "text-risk")}>
              {euros(data.saldo)}
            </div>
            <div className={cx("mt-1.5 flex items-center gap-1.5 text-meta font-medium", aGanhar ? "text-ok" : "text-risk")}>
              {aGanhar ? <TrendingUp className="size-3.5" strokeWidth={1.75} /> : <TrendingDown className="size-3.5" strokeWidth={1.75} />}
              {eurosComSinal(data.resultadoMes)} este mês
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-10 gap-y-3 sm:grid-cols-4">
            {(
              [
                ["Receitas este mês", euros(data.receitasMes), data.mensalidadesMes > 0 ? `${euros(data.mensalidadesMes)} de mensalidades` : null],
                ["Despesas este mês", euros(data.despesasMes), null],
                ["Receitas previstas", euros(previsao.income), `próximos ${previsao.days} dias`],
                ["Despesas previstas", euros(previsao.expense), `próximos ${previsao.days} dias`],
              ] as const
            ).map(([l, v, nota]) => (
              <div key={l}>
                <dt className="text-meta text-ink-3">{l}</dt>
                <dd className="mt-0.5 text-[18px] font-semibold tracking-[-0.02em] tabular">{v}</dd>
                {nota && <dd className="text-[11px] text-ink-4">{nota}</dd>}
              </div>
            ))}
          </dl>
        </div>
      </Panel>

      {vazio ? (
        <Empty
          title="As contas começam aqui"
          detail="Regista a primeira receita ou despesa — ou define o saldo inicial do clube nas definições ao lado do saldo. As mensalidades pagas entram sozinhas."
          icon={Wallet}
        >
          {podeEscrever && (
            <button type="button" className="ctl-primary" onClick={() => setRegistar("EXPENSE")}>
              Registar movimento
            </button>
          )}
        </Empty>
      ) : (
        <>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {/* A evolução — seis meses de entradas e saídas, lado a lado. */}
            <Panel>
              <PanelHead title="Receitas e despesas" hint="últimos 6 meses" />
              <MonthlyChart monthly={data.monthly} />
            </Panel>

            {/* A previsão: o que o saldo será se o previsto acontecer. */}
            <Panel>
              <PanelHead title="Previsão">
                <SelectField
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
                <div className="flex items-baseline justify-between">
                  <dt className="text-body text-ink-2">Saldo atual</dt>
                  <dd className="text-body font-medium tabular">{euros(data.saldo)}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-body text-ink-2">Receitas previstas</dt>
                  <dd className="text-body font-medium text-ok tabular">+{euros(previsao.income)}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-body text-ink-2">Despesas previstas</dt>
                  <dd className="text-body font-medium text-risk tabular">−{euros(previsao.expense)}</dd>
                </div>
                <div className="flex items-baseline justify-between border-t border-line pt-2.5">
                  <dt className="text-body font-semibold text-ink">Saldo projetado</dt>
                  <dd className={cx("text-[20px] font-semibold tracking-[-0.02em] tabular", saldoProjetado < 0 && "text-risk")}>
                    {euros(saldoProjetado)}
                  </dd>
                </div>
              </dl>
              <p className="border-t border-line px-5 py-2.5 text-meta leading-relaxed text-ink-3">
                O previsto não é saldo: só o que acontece mexe no número de cima. Confirma cada movimento quando for
                pago ou recebido.
              </p>
            </Panel>
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-3">
            <ProximosPanel titulo="Próximas despesas" rows={data.proximasDespesas} sinal="−" tone="text-risk" />
            <ProximosPanel titulo="Receitas previstas" rows={data.proximasReceitas} sinal="+" tone="text-ok" />

            {/* Em que se está a gastar — o mês por categoria, em barras. */}
            <Panel>
              <PanelHead title="Este mês, por categoria" />
              {data.porCategoria.length === 0 ? (
                <Empty title="Sem movimentos este mês" icon={Wallet} compact />
              ) : (
                <ul className="space-y-2.5 px-5 py-4">
                  {data.porCategoria.slice(0, 7).map((c) => {
                    const max = Math.max(...data.porCategoria.map((x) => x.amountCents));
                    return (
                      <li key={`${c.kind}-${c.label}`}>
                        <div className="flex items-baseline justify-between text-meta">
                          <span className="font-medium text-ink">{c.label}</span>
                          <span className={cx("tabular", c.kind === "INCOME" ? "text-ok" : "text-ink-2")}>
                            {c.kind === "INCOME" ? "+" : "−"}
                            {euros(c.amountCents)}
                          </span>
                        </div>
                        <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-sunken">
                          <span
                            className={cx("block h-full rounded-full", c.kind === "INCOME" ? "bg-ok" : "bg-risk/70")}
                            style={{ width: `${Math.max(4, (c.amountCents / max) * 100)}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}

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
    </>
  );
}

/* -------------------------------------------------------------------------- */

function ProximosPanel({ titulo, rows, sinal, tone }: { titulo: string; rows: UpcomingRow[]; sinal: string; tone: string }) {
  return (
    <Panel>
      <PanelHead title={titulo}>
        <Link to="/contas/movimentos?estado=PLANNED" className="ctl-ghost">
          Ver todas
        </Link>
      </PanelHead>
      {rows.length === 0 ? (
        <Empty title="Nada previsto" detail="Os movimentos previstos aparecem aqui, com a data." icon={Wallet} compact />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">{r.description}</span>
                <span className="block truncate text-meta text-ink-3">
                  {shortDate(new Date(r.occurredAt))}
                  {r.eventLabel ? ` · ${r.eventLabel}` : r.category ? ` · ${r.category}` : ""}
                  {r.status === "PENDING" ? ` · ${STATUS_LABEL.PENDING}` : ""}
                </span>
              </span>
              <span className={cx("shrink-0 text-body font-semibold tabular", tone)}>
                {sinal}
                {euros(r.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * A evolução mensal, em barras SVG desenhadas à mão.
 *
 * Sem biblioteca de gráficos: são doze rectângulos, e a consola não carrega
 * cem kilobytes para os desenhar. Verde para dentro, vermelho para fora, lado
 * a lado por mês — a comparação que interessa é a de cada par.
 */
function MonthlyChart({ monthly }: { monthly: { month: string; income: number; expense: number }[] }) {
  const max = Math.max(1, ...monthly.flatMap((m) => [m.income, m.expense]));
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  return (
    <div className="px-5 py-4">
      <div className="flex items-end justify-between gap-2" style={{ height: 180 }}>
        {monthly.map((m) => {
          const hIn = Math.round((m.income / max) * 150);
          const hOut = Math.round((m.expense / max) * 150);
          const [ano, mes] = m.month.split("-");
          return (
            <div key={m.month} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full items-end justify-center gap-1" style={{ height: 150 }}>
                <span
                  title={`Receitas: ${euros(m.income)}`}
                  className="w-full max-w-[26px] rounded-t-[4px] bg-ok/80"
                  style={{ height: Math.max(m.income > 0 ? 3 : 0, hIn) }}
                />
                <span
                  title={`Despesas: ${euros(m.expense)}`}
                  className="w-full max-w-[26px] rounded-t-[4px] bg-risk/60"
                  style={{ height: Math.max(m.expense > 0 ? 3 : 0, hOut) }}
                />
              </div>
              <span className="text-[11px] text-ink-3">
                {MESES[Number(mes) - 1]}
                <span className="hidden text-ink-4 sm:inline"> {ano.slice(2)}</span>
              </span>
              <span className={cx("text-[11px] font-medium tabular", m.income - m.expense >= 0 ? "text-ok" : "text-risk")}>
                {eurosComSinal(m.income - m.expense)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-4 border-t border-line pt-2.5 text-meta text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-ok/80" /> Receitas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-risk/60" /> Despesas
        </span>
      </div>
    </div>
  );
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
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((r) => {
        setS(r);
        setSaldo((r.initialBalanceCents / 100).toFixed(2).replace(".", ","));
        setDesde(r.initialBalanceAt ? r.initialBalanceAt.slice(0, 10) : "");
        setComFees(r.includeFees);
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
      await updateSettings({ initialBalanceCents: cents, initialBalanceAt: desde, includeFees: comFees });
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
            <input
              value={saldo}
              onChange={(e) => setSaldo(e.target.value)}
              inputMode="decimal"
              className={cx(dialogInputClass, "text-right tabular")}
            />
          </DialogField>
          <DialogField label="A contar desde" hint="vazio = desde sempre">
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={dialogInputClass} />
          </DialogField>
        </div>

        <p className="text-meta leading-relaxed text-ink-3">
          O que aconteceu antes desta data está dentro do saldo inicial — não se conta duas vezes.
        </p>

        <label className="flex cursor-pointer items-start gap-2.5 border-t border-line pt-4">
          <input
            type="checkbox"
            checked={comFees}
            onChange={(e) => setComFees(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-signal)]"
          />
          <span className="text-body text-ink-2">
            Considerar as mensalidades pagas no saldo
            <span className="block text-meta leading-relaxed text-ink-4">
              As mensalidades confirmadas entram sozinhas como receita. Desligar não apaga nem cancela nenhum
              pagamento — só deixa de as contar aqui.
            </span>
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

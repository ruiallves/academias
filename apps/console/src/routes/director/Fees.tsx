import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CustoDoPagamento } from "@/components/finance/CustoDoPagamento";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Dialog, DialogField } from "@/components/Dialog";
import { type Column, cx, DataTable, Empty, ListaDeEscolha, Metric, MetricRow, Monogram, Panel, Pill, SelectField } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Select, Toolbar } from "@/components/filters";
import { NewFeeDialog } from "@/components/finance/NewFeeDialog";
import { PrecoDoAtleta } from "@/components/finance/PrecoDoAtleta";
import { BillingCalendarDialog } from "@/components/finance/BillingCalendarDialog";
import { MetodoDePagamentoDialog, type MetodoManual } from "@/components/finance/MetodoDePagamento";
import { CalendarDays, Check, ChevronDown, ChevronRight, CircleCheck, Download, Loader2, Plus, Search, Send, Settings, Trash2, TriangleAlert, Users, Wallet } from "@/lib/icons";
import {
  academy,
  arrears,
  athleteById,
  availablePeriods,
  guardiansOf,
  currentPeriod,
  mesCobrado,
  proximoPeriodoCobrado,
  listAllFees,
  listAthletes,
  listFees,
  listTeams,
  teamById,
  today,
  naEquipa,
} from "@/lib/api";
import { apiDelete, apiPatch, apiPost } from "@/lib/http";
import { reloadAcademy, reloadFees, useStore } from "@/lib/store";
import { money, percent, periodLabel, relativeDays, shortDate, shortName } from "@/lib/format";
import { exportFees, nomeDoFicheiro } from "@/lib/fees-export";
import { can } from "@/lib/permissions";
import type { Fee, FeeStatus } from "@/data/types";
import { useSession } from "@/session";

/**
 * O estado de uma mensalidade, dito como quem o lê.
 *
 * "Pendente" era o rótulo de `pending` e dizia a coisa errada: em português,
 * um pagamento pendente é um pagamento **a decorrer** — e essa é exactamente a
 * descrição de `processing`, o estado que existe enquanto a euPago não confirma.
 * Dois estados diferentes com o mesmo nome, e o mais comum dos dois a usar o
 * nome do outro.
 *
 * "Não pago" não tem essa ambiguidade: ninguém pagou, e o prazo ainda não
 * passou. Passado o prazo, "Vencido". São três palavras que a direcção já usa
 * ao telefone com as famílias.
 */
const STATUS_LABEL: Record<FeeStatus, string> = {
  paid: "Pago",
  processing: "A confirmar",
  pending: "Não pago",
  overdue: "Vencido",
  void: "Anulada",
};

const STATUS_TONE = { paid: "ok", processing: "signal", pending: "warn", overdue: "risk", void: "neutral" } as const;

/** As mesmas cores do `Pill` partilhado — aqui à parte porque o rótulo do estado
 * passa a ser o próprio botão (texto + seta juntos), não um `<Pill>` por dentro. */
const TONE_CLASS: Record<(typeof STATUS_TONE)[keyof typeof STATUS_TONE], string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  risk: "bg-risk-soft text-risk",
  neutral: "bg-sunken text-ink-2",
  signal: "bg-signal-soft text-signal-ink",
};

/**
 * As três decisões que a direção pode tomar à mão sobre uma mensalidade, e o estado
 * (`ChargeStatus`) que cada uma grava. "A confirmar" e "Vencido" não são opções —
 * são derivados (do pagamento em curso, da data), não escolhas.
 */
const MANUAL_OPTIONS = [
  { value: "SETTLED", label: "Marcar como paga", tone: "ok" as const },
  { value: "OPEN", label: "Marcar por pagar", tone: "warn" as const },
  { value: "VOID", label: "Anular", tone: "neutral" as const },
];

/** Qual das opções manuais corresponde ao estado atual — para a assinalar no menu. */
function currentTarget(status: FeeStatus): string {
  if (status === "paid") return "SETTLED";
  if (status === "void") return "VOID";
  return "OPEN";
}

const ALL = "all" as const;

export default function Fees() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");

  /*
   * Subscrever o armazém — a página inteira sai de lá.
   *
   * `availablePeriods()`, `listAllFees()`, `listFees()` e `arrears()` lêem
   * arrays ao nível do módulo em `lib/api.ts`, que o `reloadAcademy()`
   * substitui. Ler não subscreve: sem esta linha, a página só se redesenhava
   * quando alguma outra coisa a obrigasse — um estado local a mudar por acaso —
   * e o que dependesse só do armazém ficava a mostrar o que já não é verdade.
   *
   * Não se usa o valor devolvido de propósito: o que se quer é a subscrição.
   * Quem lê os dados são as funções acima, que já sabem o âmbito de quem
   * pergunta.
   */
  useStore();

  const estado = (params.get("estado") ?? "todos") as FeeStatus | "todos";
  const setEstado = (v: FeeStatus | "todos") => {
    const next = new URLSearchParams(params);
    v === "todos" ? next.delete("estado") : next.set("estado", v);
    setParams(next, { replace: true });
  };

  /*
   * A equipa vive no endereço, como o estado.
   *
   * "Manda-me as mensalidades do Sub-19" passa a ser um link que se cola numa
   * mensagem, e o botão de voltar desfaz o filtro. Guardar isto em estado local
   * dava a mesma vista com um endereço que não a sabia descrever.
   */
  const equipa = params.get("equipa") ?? ALL;
  const setEquipa = (v: string) => {
    const next = new URLSearchParams(params);
    v === ALL ? next.delete("equipa") : next.set("equipa", v);
    setParams(next, { replace: true });
  };

  // A dívida vencida vem de "?estado=overdue" a partir de "Precisa de atenção" —
  // e uma dívida antiga pode estar num mês que já não é o corrente. Por isso, se
  // se chega aqui a filtrar vencidas, o período abre em "Todos" para não escondê-la.
  /*
   * Num mês que o clube não cobra, a página abre em "Todos os períodos".
   *
   * Abria sempre no mês corrente — e em Agosto, num clube que desligou Agosto,
   * abria numa tabela vazia com "Agosto de 2026" escrito no selector, que é
   * exactamente o mês que não devia aparecer.
   */
  const [period, setPeriod] = useState<string>(
    estado === "overdue" || !mesCobrado(currentPeriod) ? ALL : currentPeriod,
  );

  const periods = availablePeriods();
  const debt = arrears(session);

  const rows: Fee[] = period === ALL ? listAllFees(session) : listFees(session, period);
  const teams = listTeams(session);

  /*
   * As linhas do período, já no escalão escolhido.
   *
   * É daqui que sai tudo o que a página mostra — a tabela, as contagens dos
   * separadores e as métricas de cima. Sem este passo comum, filtrar por equipa
   * dava uma tabela do Sub-19 com o total facturado da academia inteira por
   * cima, e o número grande é o que se lê primeiro.
   */
  const noEscopo = useMemo(
    () => (equipa === ALL ? rows : rows.filter((f) => { const a = athleteById(f.athleteId); return a ? naEquipa(a, equipa) : false; })),
    [rows, equipa],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const order: Record<FeeStatus, number> = { overdue: 0, pending: 1, processing: 2, paid: 3, void: 4 };
    return noEscopo
      .filter((f) => (estado === "todos" ? true : f.status === estado))
      .filter((f) => (q ? (athleteById(f.athleteId)?.name ?? "").toLowerCase().includes(q) : true))
      .sort(
        (a, b) =>
          order[a.status] - order[b.status] ||
          b.period.localeCompare(a.period) ||
          a.dueDate.localeCompare(b.dueDate),
      );
  }, [noEscopo, estado, query]);

  /*
   * As métricas contam o que está em vista.
   *
   * Era `feeSummary(session, period)` — a academia inteira daquele mês — e
   * `summariseAll` só no caso de "todos os períodos". São a mesma conta sobre
   * listas diferentes; com o filtro de equipa a existir, a lista certa é sempre
   * a que está no ecrã, e por isso passa a haver um caminho só.
   */
  const scopedSummary = summariseAll(noEscopo);
  const label = period === ALL ? "todos os períodos" : periodLabel(period);

  // A direção acerta o estado à mão — dinheiro em mão, uma bolsa, uma correção.
  const mayEditFees = can(session, "billing:write");
  const [pricesOpen, setPricesOpen] = useState(false);
  /*
   * O período de cobrança (dia de vencimento e meses cobrados). Vivia nas
   * Definições; está aqui porque é aqui que se vê o efeito. Grava na base as
   * definições do clube, por isso pede `settings:write`, como o servidor.
   */
  const [calendarioOpen, setCalendarioOpen] = useState(false);
  const mayCalendar = can(session, "settings:write");
  const [athletePricesOpen, setAthletePricesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  /*
   * Depois de gravar um preço ou lançar mensalidades. A tabela vem do `store`,
   * que quem grava já recarregou; não há mais nada nesta página a avisar.
   */
  const onFeeSaved = useCallback(() => undefined, []);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [reminderResult, setReminderResult] = useState<string | null>(null);
  /**
   * Lançar uma mensalidade à mão.
   *
   * Ao lado da emissão do mês, que trabalha sobre o plantel a partir dos
   * planos: isto é para o atleta sem preço, o mês fora do calendário do clube,
   * e o acerto de quem entrou a meio da época. Ver `NewFeeDialog`.
   */
  const [lancarOpen, setLancarOpen] = useState(false);

  async function sendReminders() {
    setSendingReminders(true);
    setReminderResult(null);
    try {
      const res = await apiPost<{ sent: number; athletes: number; overdue: number }>("/api/charges/reminders", {});
      setReminderResult(
        res.sent > 0
          ? `Lembrete enviado a ${res.athletes} ${res.athletes === 1 ? "família" : "famílias"}.`
          : res.overdue > 0
            // Há dívida, mas ninguém por avisar de novo — já se avisou hoje, e
            // reenviar não fazia o pagamento chegar mais depressa.
            ? "Já foram todos avisados hoje — o próximo lembrete só sai amanhã."
            : "Sem mensalidades vencidas.",
      );
    } catch (err) {
      setReminderResult(err instanceof Error ? err.message : "Não foi possível enviar os lembretes.");
    } finally {
      setSendingReminders(false);
    }
  }

  const allColumns: Column<Fee>[] = [
    {
      key: "athlete",
      header: "Atleta",
      render: (f) => {
        const a = athleteById(f.athleteId);
        return (
          <div className="flex items-center gap-2.5">
            <Monogram name={a?.name ?? "?"} photoUrl={a?.photoUrl} />
            <div className="min-w-0">
              <div className="truncate font-medium text-ink">{shortName(a?.name ?? "—")}</div>
              <div className="text-meta text-ink-3">{teamById(a?.teamId ?? "")?.name}</div>
            </div>
          </div>
        );
      },
    },
    // Só faz sentido quando se misturam períodos — dentro de um único mês seria
    // uma coluna a repetir o mesmo valor em todas as linhas.
    {
      key: "period",
      header: "Período",
      hideBelow: "sm",
      /*
        A coluna diz o mês numa mensalidade e o que se cobrou numa avulsa.
        Sem isto, duas linhas do mesmo atleta no mesmo mês liam-se como uma
        mensalidade repetida — e a primeira reacção de quem visse isso seria
        apagar uma delas.
      */
      render: (f) =>
        f.extra ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-ink">{f.title ?? "Cobrança"}</span>
            <Pill>{periodLabel(f.period)}</Pill>
          </span>
        ) : (
          <span className="text-ink-2">{periodLabel(f.period)}</span>
        ),
    },
    {
      key: "due",
      header: "Vencimento",
      hideBelow: "sm",
      render: (f) => {
        const d = new Date(f.dueDate);
        const late = f.status === "overdue";
        return <span className={late ? "font-medium text-risk" : "text-ink-3"}>{relativeDays(d, today)}</span>;
      },
    },
    {
      /*
        Como e quando foi paga, numa coluna: o método em cima, o dia por baixo.

        O dia é o do pagamento. Num pagamento online é o que a euPago
        confirmou; num marcado à mão é o dia em que se mudou o estado.

        Uma mudança feita à mão diz quem a fez ("Marcada por", "Anulada por",
        "Reaberta por"), aqui e não noutra coluna: é a resposta a "como se sabe
        que isto está assim?", que é a pergunta desta coluna.
      */
      key: "method",
      header: "Pagamento",
      hideBelow: "lg",
      render: (f) =>
        f.status === "paid" && (f.method || f.paidAt) ? (
          <div className="leading-tight">
            <div className="text-ink-2">{f.method ?? "Paga"}</div>
            {f.paidAt && <div className="mt-0.5 text-[11px] text-ink-4">{shortDate(new Date(f.paidAt))}</div>}
            {f.paidBy && <div className="mt-0.5 text-[11px] text-ink-3">Por {f.paidBy}</div>}
            {f.changedAt && <div className="mt-0.5 text-[11px] text-ink-3">Marcada por {f.changedBy ?? "alguém que já saiu"}</div>}
            {f.paymentId && (
              <div className="mt-0.5 select-all break-all font-mono text-[10px] text-ink-4" title="Assim aparece no backoffice da euPago">
                {f.paymentId}
              </div>
            )}
          </div>
        ) : f.changedAt ? (
          <div className="leading-tight">
            <div className="text-ink-2">
              {f.status === "void" ? "Anulada" : "Reaberta"} por {f.changedBy ?? "alguém que já saiu"}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-4">{shortDate(new Date(f.changedAt))}</div>
          </div>
        ) : f.reference ? (
          <span className="font-mono text-meta text-ink-3">{f.reference}</span>
        ) : (
          <span className="text-ink-4">—</span>
        ),
    },
    {
      key: "status",
      header: "Estado",
      render: (f) =>
        mayEditFees ? (
          <FeeStatusControl fee={f} />
        ) : (
          <Pill tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Pill>
        ),
    },
    {
      key: "amount",
      header: "Valor",
      align: "right",
      width: "112px",
      render: (f) => <span className="font-medium text-ink tabular">{money(f.amountCents)}</span>,
    },
  ];

  const columns = allColumns.filter((c) => c.key !== "period" || period === ALL);

  return (
    <>
      <PageHeader
        eyebrow={capitalize(label)}
        title="Mensalidades"
        subtitle="O estado de cada mensalidade é confirmado pelo webhook da euPago, nunca pelo navegador."
      >
        {/*
          Exportar. Desactivado enquanto não houver mensalidade nenhuma — um
          ficheiro vazio não é uma exportação, é uma pergunta sem resposta.
        */}
        <button
          type="button"
          className="ctl-outline"
          onClick={() => setExportOpen(true)}
          disabled={periods.length === 0}
          title={periods.length === 0 ? "Ainda não há mensalidades para exportar" : undefined}
        >
          <Download className="size-3.5" strokeWidth={1.75} />
          Exportar
        </button>
        {mayCalendar && (
          <button type="button" className="ctl-outline" onClick={() => setCalendarioOpen(true)}>
            <CalendarDays className="size-3.5" strokeWidth={1.75} />
            Período de cobrança
          </button>
        )}
        {mayEditFees && (
          <>
            <button type="button" className="ctl-outline" onClick={() => setLancarOpen(true)}>
              <Plus className="size-3.5" strokeWidth={2} />
              Lançar mensalidade
            </button>
            <button type="button" className="ctl-outline" onClick={() => setPricesOpen(true)}>
              <Settings className="size-3.5" strokeWidth={1.75} />
              Preços por equipa
            </button>
            <button type="button" className="ctl-outline" onClick={() => setAthletePricesOpen(true)}>
              <Users className="size-3.5" strokeWidth={1.75} />
              Preço por atleta
            </button>
          </>
        )}
        <button
          type="button"
          className="ctl-primary"
          onClick={() => void sendReminders()}
          disabled={sendingReminders || debt.count === 0}
          title={debt.count === 0 ? "Sem mensalidades vencidas" : undefined}
        >
          <Send className="size-3.5" strokeWidth={1.75} />
          {sendingReminders ? "A enviar…" : "Enviar lembretes"}
          {debt.count > 0 && !sendingReminders && (
            <span className="ml-0.5 rounded-full bg-white/15 px-1.5 text-[11px] tabular">{debt.count}</span>
          )}
        </button>
      </PageHeader>

      <div className="space-y-3">
        {reminderResult && (
          <p className="flex items-center gap-2 rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-2.5 text-meta text-ink-2">
            <Send className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
            {reminderResult}
          </p>
        )}

        {/* Dívida real: soma todos os períodos, sempre — independente do filtro
            abaixo, porque uma mensalidade de março não deixa de ser dinheiro em
            falta só porque se está a olhar para agosto. */}
        {debt.count > 0 && (
          <button
            type="button"
            onClick={() => {
              setPeriod(ALL);
              setEstado("overdue");
            }}
            className="flex w-full items-center gap-3 rounded-[var(--radius-panel)] border border-risk/25 bg-risk-soft px-4 py-3 text-left transition-colors duration-[120ms] hover:border-risk/40"
          >
            <TriangleAlert className="size-4 shrink-0 text-risk" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 text-body text-risk">
              <strong className="font-semibold">{money(debt.cents)}</strong> em dívida no total, em{" "}
              <strong className="font-semibold">{debt.count}</strong> mensalidades de {debt.athletes}{" "}
              {debt.athletes === 1 ? "família" : "famílias"}
              {debt.chronic > 0 && (
                <>
                  {" "}
                  · <strong className="font-semibold">{debt.chronic}</strong> com mais de um mês em atraso
                </>
              )}
            </span>
            <span className="shrink-0 text-meta font-medium text-risk underline">Ver tudo</span>
          </button>
        )}

        <MetricRow>
          <Metric label="Facturado" value={money(scopedSummary.billedCents, { compact: true })} note={`${scopedSummary.total} mensalidades · ${label}`} />
          <Metric
            label="Cobrado"
            value={money(scopedSummary.collectedCents, { compact: true })}
            icon={Wallet}
            note={`${percent(scopedSummary.billedCents ? scopedSummary.collectedCents / scopedSummary.billedCents : 0)} do período`}
          />
          <Metric label="Por cobrar" value={money(scopedSummary.billedCents - scopedSummary.collectedCents, { compact: true })} note={`${scopedSummary.pending + scopedSummary.processing} em curso`} />
          <Metric label="Vencido, total" value={money(debt.cents, { compact: true })} note="todos os períodos" />
        </MetricRow>

        <Panel>
          <Toolbar>
            <Select
              label="Período"
              value={period}
              onChange={setPeriod}
              options={[
                { value: ALL, label: "Todos os períodos" },
                ...periods.map((p) => ({ value: p, label: periodLabel(p) })),
              ]}
            />
            {/*
              Só com mais do que uma equipa. Num clube com um escalão só, este
              selector tem uma opção a fingir que é uma escolha.
            */}
            {teams.length > 1 && (
              <Select
                label="Equipa"
                value={equipa}
                onChange={setEquipa}
                options={[
                  { value: ALL, label: "Todas as equipas" },
                  ...teams.map((t) => ({ value: t.id, label: t.name })),
                ]}
              />
            )}
            <Segmented
              value={estado}
              onChange={setEstado}
              options={[
                { value: "todos", label: "Todas", count: noEscopo.length },
                { value: "overdue", label: "Vencidas", count: noEscopo.filter((f) => f.status === "overdue").length },
                { value: "pending", label: "Não pagas", count: noEscopo.filter((f) => f.status === "pending").length },
                { value: "processing", label: "A confirmar", count: noEscopo.filter((f) => f.status === "processing").length },
                { value: "paid", label: "Pagas", count: noEscopo.filter((f) => f.status === "paid").length },
              ]}
            />
            <SearchInput value={query} onChange={setQuery} placeholder="Procurar atleta…" />
            <ResultCount n={filtered.length} noun={["mensalidade", "mensalidades"]} />
          </Toolbar>

          <DataTable
            columns={columns}
            rows={filtered}
            keyOf={(f) => f.id}
            to={(f) => `/atletas/${f.athleteId}`}
            empty={
              estado === "overdue" ? (
                <Empty icon={CircleCheck} tone="ok" title="Nada vencido" detail={`Sem mensalidades vencidas em ${label}.`} />
              ) : (
                <Empty title="Sem mensalidades neste filtro" />
              )
            }
          />
        </Panel>

      </div>

      {exportOpen && (
        <ExportFeesDialog session={session} periods={periods} onClose={() => setExportOpen(false)} />
      )}
      {lancarOpen && (
        <NewFeeDialog
          onClose={() => setLancarOpen(false)}
          onDone={() => {
            setLancarOpen(false);
            onFeeSaved();
          }}
        />
      )}

      {calendarioOpen && (
        <BillingCalendarDialog onSaved={onFeeSaved} onClose={() => setCalendarioOpen(false)} />
      )}

      {pricesOpen && (
        <TeamFeesDialog session={session} onSaved={onFeeSaved} onClose={() => setPricesOpen(false)} />
      )}
      {athletePricesOpen && (
        <AthleteFeesDialog session={session} onSaved={onFeeSaved} onClose={() => setAthletePricesOpen(false)} />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/** A partir de quando o preço acabado de definir passa a ser cobrado. */
type AplicarEm = "atual" | "proximo";

/**
 * A pergunta que faltava: cobrar já este mês, ou só a partir do próximo?
 *
 * ## Porque é que não pode ser uma decisão nossa
 *
 * Definir um preço emite, no mesmo gesto, a mensalidade do mês corrente. Para
 * quem inscreve um atleta a meio da época é exactamente o que se quer. Para quem
 * está a montar o clube em Agosto e só começa a cobrar em Setembro é o contrário:
 * fica com um mês inteiro de mensalidades emitidas sem querer, e o desfazer é
 * anulá-las uma a uma.
 *
 * Nós não temos como saber qual dos dois é — é o calendário do clube, não um
 * detalhe técnico. Por isso pergunta-se.
 *
 * ## Porque é que está em cima e não num aviso ao gravar
 *
 * Porque os preços gravam-se ao sair do campo. Uma confirmação por cada campo
 * seriam sete janelas seguidas para quem está a preencher sete equipas. Em cima e
 * antes da lista, lê-se uma vez e vale para tudo o que se escrever a seguir.
 */
function ApplyFromChoice({
  value,
  onChange,
}: {
  value: AplicarEm;
  onChange: (v: AplicarEm) => void;
}) {
  /*
   * Nunca um mês que o clube não cobra.
   *
   * "Já em Agosto" num clube que desligou Agosto não emite nada, e dizê-lo
   * como opção é pôr o mês à vista. Nesse caso só há uma resposta, e diz-se
   * qual é o próximo mês cobrado — que pode não ser o seguinte.
   */
  const correnteCobrado = mesCobrado(currentPeriod);
  const opcoes: { value: AplicarEm; label: string; hint: string }[] = [
    ...(correnteCobrado
      ? [{ value: "atual" as const, label: `Já em ${periodLabel(currentPeriod)}`, hint: "emite as mensalidades deste mês" }]
      : []),
    {
      value: "proximo",
      label: `${correnteCobrado ? "Só a partir de" : "A partir de"} ${periodLabel(proximoPeriodoCobrado(currentPeriod))}`,
      hint: correnteCobrado ? "este mês não é cobrado" : "o próximo mês em que o clube cobra",
    },
  ];

  return (
    <div className="border-b border-line bg-sunken/40 px-5 py-3.5">
      <span className="mb-2 block text-meta font-medium text-ink">A partir de quando se cobra</span>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {opcoes.map((o) => (
          <label
            key={o.value}
            className={cx(
              "flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2 transition-colors duration-[120ms]",
              value === o.value ? "border-signal-line bg-signal-soft/40" : "border-line bg-surface hover:bg-sunken",
            )}
          >
            <input
              type="radio"
              name="aplicar-em"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="mt-0.5 accent-[var(--color-signal)]"
            />
            <span className="min-w-0">
              <span className="block text-body text-ink">{o.label}</span>
              <span className="block text-meta text-ink-3">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}


/* -------------------------------------------------------------------------- */

/** Os estados que se podem exportar de uma vez — o que a tesouraria pede. */
const EXPORT_FILTROS = [
  { value: "todas", label: "Todas", inclui: () => true },
  {
    value: "por-cobrar",
    label: "Por cobrar",
    inclui: (s: FeeStatus) => s === "pending" || s === "processing" || s === "overdue",
  },
  { value: "overdue", label: "Só vencidas", inclui: (s: FeeStatus) => s === "overdue" },
  { value: "paid", label: "Só pagas", inclui: (s: FeeStatus) => s === "paid" },
] as const;

type ExportFiltro = (typeof EXPORT_FILTROS)[number]["value"];

/**
 * Exportar mensalidades para Excel.
 *
 * ## Porque é que o intervalo é em meses e não em dias
 *
 * Uma mensalidade não tem dia: tem um **período**, `2026-08`. Um selector ao dia
 * obrigava a traduzir "de 14 de Março a 2 de Junho" para meses, e ninguém pensa
 * assim sobre mensalidades — pensa "de Janeiro a Agosto". Por isso o intervalo é
 * de mês a mês: dois campos, e mais nada.
 *
 * Os meses oferecidos são os que **têm** mensalidades: oferecer um mês vazio era
 * oferecer um ficheiro vazio.
 */
function ExportFeesDialog({
  session,
  periods,
  onClose,
}: {
  session: ReturnType<typeof useSession>["session"];
  /** Os períodos com mensalidades, do mais recente para trás. */
  periods: string[];
  onClose: () => void;
}) {
  // Do mais antigo para o mais recente — é a ordem de um intervalo.
  const ordenados = useMemo(() => [...periods].sort(), [periods]);
  const ultimo = ordenados[ordenados.length - 1];
  const inicial = ordenados.includes(currentPeriod) ? currentPeriod : ultimo;

  const [from, setFrom] = useState(inicial);
  const [to, setTo] = useState(inicial);
  const [filtro, setFiltro] = useState<ExportFiltro>("todas");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Escolhido ao contrário, vale à mesma: trocar em silêncio é melhor do que uma
  // mensagem de erro sobre uma coisa que se percebe na mesma.
  const de = from <= to ? from : to;
  const ate = from <= to ? to : from;

  const incluiEstado = EXPORT_FILTROS.find((f) => f.value === filtro) ?? EXPORT_FILTROS[0];
  const linhas = useMemo(
    () =>
      listAllFees(session)
        .filter((f) => f.period >= de && f.period <= ate)
        .filter((f) => incluiEstado.inclui(f.status))
        .sort(
          (a, b) =>
            a.period.localeCompare(b.period) ||
            (athleteById(a.athleteId)?.name ?? "").localeCompare(athleteById(b.athleteId)?.name ?? ""),
        ),
    [session, de, ate, incluiEstado],
  );

  const totalCents = linhas.reduce((n, f) => n + f.amountCents, 0);
  const meses = ordenados.filter((p) => p >= de && p <= ate).length;
  const nome = nomeDoFicheiro({ from: de, to: ate, statusLabel: incluiEstado.label });

  async function exportar() {
    setBusy(true);
    setErro(null);
    try {
      await exportFees(
        linhas.map((fee) => {
          const atleta = athleteById(fee.athleteId);
          const encarregados = guardiansOf(fee.athleteId);
          return {
            fee,
            athlete: atleta?.name ?? "—",
            team: teamById(atleta?.teamId ?? "")?.name ?? "Sem equipa",
            guardians: encarregados.map((g) => g.name).join(", "),
            // Um contacto por linha, não três: quem vai ligar precisa de um
            // número, e o do encarregado é o que costuma atender.
            contact: encarregados.map((g) => g.phone || g.email).find(Boolean) ?? "",
          };
        }),
        { from: de, to: ate, statusLabel: incluiEstado.label },
      );
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar o ficheiro.");
    } finally {
      setBusy(false);
    }
  }

  const opcoesDeMes = [...ordenados].reverse().map((p) => ({ value: p, label: periodLabel(p) }));

  return (
    <Dialog
      labelledBy="exportar-mensalidades"
      title="Exportar mensalidades"
      subtitle="Um ficheiro Excel com uma linha por mensalidade, mais uma folha de resumo."
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="ctl-primary"
            disabled={busy || linhas.length === 0}
            onClick={() => void exportar()}
          >
            {busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
                A gerar…
              </>
            ) : (
              <>
                <Download className="size-3.5" strokeWidth={1.75} />
                Exportar {linhas.length > 0 ? linhas.length : ""}
              </>
            )}
          </button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        {/*
          Dois campos, e mais nada.

          Havia por cima uma fila de atalhos — "Este mês", "Época", "Tudo" — e
          num clube com poucos meses de histórico caíam todos no mesmo intervalo:
          três botões acesos ao mesmo tempo, a dizerem que estavam escolhidos
          três intervalos diferentes. Um estado impossível é pior do que um
          atalho a menos, e escolher dois meses numa lista já é um gesto curto.
        */}
        <div className="grid grid-cols-2 gap-3">
          <DialogField label="De">
            <SelectField className="w-full" aria-label="Mês inicial" value={from} onChange={setFrom} options={opcoesDeMes} />
          </DialogField>
          <DialogField label="Até" hint={meses > 1 ? `${meses} meses` : undefined}>
            <SelectField className="w-full" aria-label="Mês final" value={to} onChange={setTo} options={opcoesDeMes} />
          </DialogField>
        </div>

        <DialogField label="Estado">
          <SelectField
            className="w-full"
            aria-label="Estado das mensalidades a exportar"
            value={filtro}
            onChange={setFiltro}
            options={EXPORT_FILTROS.map((f) => ({ value: f.value, label: f.label }))}
          />
        </DialogField>

        {/*
          O que vai sair, antes de sair. Um ficheiro que se abre e vem vazio — ou
          com o dobro do esperado — é uma viagem ao Excel para descobrir o que já
          se podia saber aqui.
        */}
        <div className="rounded-[var(--radius-control)] border border-line bg-sunken/40 px-3 py-2.5">
          <div className="text-body font-medium text-ink">
            {linhas.length} {linhas.length === 1 ? "mensalidade" : "mensalidades"} · {money(totalCents)}
          </div>
          <div className="mt-0.5 text-meta text-ink-3">
            {de === ate ? periodLabel(de) : `${periodLabel(de)} a ${periodLabel(ate)}`}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-ink-4" title={nome}>
            {nome}
          </div>
        </div>

        {erro && <p className="text-meta text-risk">{erro}</p>}
      </div>
    </Dialog>
  );
}

/**
 * Preços por equipa — o valor por omissão que cada atleta paga.
 *
 * Ajustar aqui é em lote: muda o preço de todos os atletas da equipa que não
 * tenham um ajuste individual (esse continua a sobrepor-se). Quem precisa de um
 * valor diferente para um atleta em concreto — bolsa, desconto de irmãos — faz
 * isso na ficha do atleta, separador Mensalidades, e não aqui.
 */
function TeamFeesDialog({
  session,
  onSaved,
  onClose,
}: {
  session: ReturnType<typeof useSession>["session"];
  /** Um preço ficou gravado — a página lá fora tem de reler o que mudou. */
  onSaved: () => void;
  onClose: () => void;
}) {
  const todas = listTeams(session);
  const [aplicarEm, setAplicarEm] = useState<AplicarEm>(mesCobrado(currentPeriod) ? "atual" : "proximo");

  /*
   * Um separador por modalidade, quando há mais do que uma.
   *
   * Um atleta que joga futebol e futsal paga a soma dos dois preços, e cada
   * modalidade tem os seus: separá-las é o que deixa configurar o futsal sem
   * andar à procura dele no meio das equipas de futebol. Com uma modalidade só,
   * um separador "Futebol" ao lado de "Todas" não separava nada — a mesma regra
   * da página das Equipas.
   */
  const modalidades = academy.sports.filter((sp) => todas.some((t) => t.sportId === sp.id));
  const [modalidade, setModalidade] = useState<string>("todas");
  const teams = modalidade === "todas" ? todas : todas.filter((t) => t.sportId === modalidade);
  const varias = modalidades.length > 1;
  const nomeDaModalidade = (id: string) => academy.sports.find((sp) => sp.id === id)?.name ?? "";

  /*
   * O "Concluído" espera pelo que ficou a meio.
   *
   * Os preços gravam-se ao sair do campo, e carregar no Concluído é exactamente
   * o gesto que faz o campo perder o foco. Ou seja: o clique disparava a
   * gravação **e** fechava o diálogo, no mesmo instante. O pedido seguia para o
   * servidor, mas o diálogo já tinha desaparecido — quem lá estava não via nada
   * e ficava sem saber se o preço tinha ficado registado. Se falhasse, ninguém
   * ficava a saber.
   *
   * Agora conta-se o que está em voo. Com o contador a zero fecha na hora, que é
   * o caso de quem só veio ver. Com alguma coisa a caminho, o botão mostra que
   * está à espera e o diálogo só sai quando o servidor responder.
   *
   * O contador é um `ref` e não estado: o `blur` e o `click` acontecem no mesmo
   * gesto, e ler estado do React a meio de um lote de actualizações dava zero
   * quando já havia uma gravação a começar. O estado ao lado existe só para
   * redesenhar o botão.
   */
  const emVoo = useRef(new Set<string>());
  const falhados = useRef(new Set<string>());
  const [aGravar, setAGravar] = useState(0);
  const [aFechar, setAFechar] = useState(false);

  function marcar(teamId: string, activo: boolean, falhou?: boolean) {
    if (activo) {
      emVoo.current.add(teamId);
      falhados.current.delete(teamId);
    } else {
      emVoo.current.delete(teamId);
      if (falhou) falhados.current.add(teamId);
    }
    setAGravar(emVoo.current.size);
  }

  /*
   * Fecha quando o último pedido aterrar — mas só se todos tiverem corrido bem.
   *
   * Fechar com um preço por gravar era pior do que o problema original: o
   * diálogo desaparecia, a borda vermelha ia com ele, e o clube ficava a pensar
   * que tinha mudado um preço que não mudou. Falhando algum, o botão volta a
   * "Concluído" e o campo em falta fica à vista, com a sua borda.
   */
  useEffect(() => {
    if (!aFechar || aGravar > 0) return;
    if (falhados.current.size > 0) setAFechar(false);
    else onClose();
  }, [aFechar, aGravar, onClose]);

  function concluir() {
    if (emVoo.current.size === 0) onClose();
    else setAFechar(true);
  }

  return (
    <Dialog
      labelledBy="precos-por-equipa"
      title="Preços por equipa"
      subtitle="O preço de cada equipa. Quem joga em duas modalidades paga a soma, e o ajuste individual de um atleta sobrepõe-se ao da equipa."
      onClose={concluir}
      width={480}
      footer={
        <button type="button" onClick={concluir} disabled={aFechar} className="ctl-primary">
          {aFechar ? (
            <>
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
              A guardar…
            </>
          ) : (
            "Concluído"
          )}
        </button>
      }
    >
      {todas.length === 0 ? (
        <div className="px-5 py-10">
          <Empty title="Sem equipas ainda" />
        </div>
      ) : (
        <>
          <ApplyFromChoice value={aplicarEm} onChange={setAplicarEm} />
          {varias && (
            <div className="border-b border-line px-5 py-2.5">
              <Segmented
                label="Modalidade"
                value={modalidade}
                onChange={setModalidade}
                options={[
                  { value: "todas", label: "Todas", count: todas.length },
                  ...modalidades.map((sp) => ({
                    value: sp.id,
                    label: sp.name,
                    count: todas.filter((t) => t.sportId === sp.id).length,
                  })),
                ]}
              />
            </div>
          )}
          <ul>
            {teams.map((t) => (
              <li key={t.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium text-ink">{t.name}</div>
                  <div className="text-meta text-ink-3">
                    {/* Em "Todas", a modalidade diz a que separador pertence. */}
                    {varias && modalidade === "todas" && `${nomeDaModalidade(t.sportId)} · `}
                    {t.athleteIds.length} {t.athleteIds.length === 1 ? "atleta" : "atletas"}
                  </div>
                </div>
                <TeamFeeInput
                  teamId={t.id}
                  amountCents={t.feeCents}
                  aplicarEm={aplicarEm}
                  onBusy={marcar}
                  onSaved={onSaved}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}

/**
 * O valor em edição inline — euros, não cêntimos, porque é assim que a direção
 * pensa no preço. Sem preço ainda, mostra-se vazio com uma indicação, nunca "0,00 €"
 * a fingir que alguém já decidiu que é grátis.
 */
function TeamFeeInput({
  teamId,
  amountCents,
  aplicarEm,
  onBusy,
  onSaved,
}: {
  teamId: string;
  amountCents: number | null;
  /** A escolha feita no topo do diálogo — vai com cada gravação. */
  aplicarEm: AplicarEm;
  /** Diz ao diálogo que este campo está a gravar — é o que segura o "Concluído". */
  onBusy?: (teamId: string, activo: boolean, falhou?: boolean) => void;
  /** Gravou: a página lá fora relê as mensalidades em falta. */
  onSaved?: () => void;
}) {
  const [value, setValue] = useState(amountCents !== null ? (amountCents / 100).toFixed(2) : "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // O valor guardado muda de baixo para cima (outra pessoa editou, ou a nossa
  // própria gravação recarregou a academia) — segue-se, a não ser que haja algo
  // por gravar neste campo neste preciso instante.
  useEffect(() => {
    if (!busy) setValue(amountCents !== null ? (amountCents / 100).toFixed(2) : "");
  }, [amountCents, busy]);

  async function commit() {
    const trimmed = value.trim().replace(",", ".");
    const cents = Math.round(Number(trimmed) * 100);

    /*
     * O que não é um número volta ao que estava, em vez de ficar no ecrã.
     *
     * "35 €", "quarenta", um campo vazio — não são erros de que valha a pena
     * falar, são gestos a meio. O que era mau era deixá-los escritos: o campo
     * ficava com texto que nunca foi gravado e parecia que sim.
     */
    if (!trimmed || !Number.isFinite(cents)) {
      setValue(amountCents !== null ? (amountCents / 100).toFixed(2) : "");
      setErro(null);
      return;
    }
    if (cents === amountCents) {
      setErro(null);
      return;
    }

    setBusy(true);
    onBusy?.(teamId, true);
    setErro(null);
    let falhou = false;
    try {
      await apiPatch(`/api/teams/${teamId}/fee`, { amountCents: cents, aplicarEm });
      await reloadAcademy();
      onSaved?.();
    } catch (e) {
      falhou = true;
      /*
       * A razão, e não só a borda vermelha.
       *
       * Isto era um `catch {}` que acendia uma borda e deitava fora o que o
       * servidor tinha dito. Um clube em produção ficou preso a tentar mudar um
       * preço sem nenhuma forma de saber porquê — e a razão era simples: o
       * campo vem preenchido com "60.00", quem escreve sem seleccionar primeiro
       * fica com "3560.00", e 3560 € passa o tecto de 1000 €. A mensagem existia
       * desde sempre no servidor; só não chegava a ninguém.
       */
      setErro(e instanceof Error ? e.message : "Não foi possível guardar este preço.");
    } finally {
      setBusy(false);
      onBusy?.(teamId, false, falhou);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="flex items-center gap-1.5">
        <span className={cx("text-body", value ? "text-ink-3" : "text-ink-4")}>€</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          placeholder="por configurar"
          disabled={busy}
          /*
           * Seleccionar tudo ao entrar no campo.
           *
           * É a correcção do bug, e não a mensagem de erro. O campo chega
           * preenchido com o preço actual, e um preço não se edita — troca-se.
           * Sem isto, quem clicava e escrevia "35" ficava com "3560.00" (recusado
           * pelo servidor) ou com "60.0035" (que arredonda para o mesmo valor e
           * não gravava nada, em silêncio). Seleccionado, escrever substitui, que
           * é o que a pessoa quis fazer desde o início.
           */
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          aria-invalid={erro !== null}
          className={cx(
            "h-8 w-28 rounded-[var(--radius-control)] border bg-surface px-2 text-right text-body tabular focus:outline-none",
            erro ? "border-risk" : "border-line focus:border-line-strong",
          )}
        />
      </label>
      {erro && (
        <span role="alert" className="max-w-[220px] text-right text-meta leading-snug text-risk">
          {erro}
        </span>
      )}
      {/* Largura fixa para a tabela caber: o nome da equipa trunca para lha dar. */}
      <CustoDoPagamento amountCents={paraCentimosDoPreco(value)} className="w-[248px] text-right" />
    </div>
  );
}

/**
 * O valor escrito no campo, em cêntimos — só para a linha de custo.
 *
 * Não valida nada: quem valida é o `commit`, contra o servidor. Aqui só se quer
 * saber se já há número suficiente para fazer a conta enquanto a pessoa escreve.
 */
function paraCentimosDoPreco(v: string): number | null {
  const n = Number(v.trim().replace(/\s/g, "").replace("€", "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/**
 * Preço por atleta: escolhe-se um atleta e define-se o valor em cada modalidade
 * que ele pratica.
 *
 * ## Um atleta de cada vez
 *
 * Aplicava o mesmo valor a vários atletas escolhidos juntos (irmãos, um grupo
 * com o mesmo acordo). Com o preço por modalidade isso deixou de fazer sentido:
 * um valor não quer dizer nada sem se saber de que modalidade é, e três atletas
 * escolhidos juntos podem praticar modalidades diferentes. O servidor também já
 * não o aceita.
 *
 * Escolhido o atleta, o que aparece é o mesmo que a ficha dele mostra, no
 * separador Mensalidades (`PrecoDoAtleta`): uma linha por modalidade, e a soma.
 */
function AthleteFeesDialog({
  session,
  onSaved,
  onClose,
}: {
  session: ReturnType<typeof useSession>["session"];
  /** Gravou: a página lá fora relê as mensalidades em falta. */
  onSaved: () => void;
  onClose: () => void;
}) {
  const athletes = listAthletes(session);
  const [aplicarEm, setAplicarEm] = useState<AplicarEm>(mesCobrado(currentPeriod) ? "atual" : "proximo");
  const [query, setQuery] = useState("");
  const [escolhido, setEscolhido] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const visible = q ? athletes.filter((a) => a.name.toLowerCase().includes(q)) : athletes;
  const atleta = escolhido ? athleteById(escolhido) : undefined;

  return (
    <Dialog
      labelledBy="preco-por-atleta"
      title="Preço por atleta"
      subtitle={
        atleta
          ? atleta.name
          : "Escolhe o atleta. O valor define-se em cada modalidade que ele pratica e sobrepõe-se ao preço da equipa."
      }
      onClose={onClose}
      width={480}
      footer={
        <>
          {atleta && (
            <button type="button" onClick={() => setEscolhido(null)} className="ctl-ghost mr-auto">
              Escolher outro atleta
            </button>
          )}
          <button type="button" onClick={onClose} className="ctl-primary">
            Concluído
          </button>
        </>
      }
    >
      <ApplyFromChoice value={aplicarEm} onChange={setAplicarEm} />

      {atleta ? (
        <div className="px-5 py-5">
          <PrecoDoAtleta athleteId={atleta.id} mayConfigure aplicarEm={aplicarEm} onSaved={onSaved} />
        </div>
      ) : (
        <>
          <div className="border-b border-line p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Procurar atleta…"
                autoFocus
                className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pr-3 pl-8 text-body text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
              />
            </div>
          </div>

          <ListaDeEscolha className="max-h-[340px] overflow-y-auto">
            {visible.length === 0 ? (
              <li className="px-5 py-8 text-center text-meta text-ink-4">Ninguém com esse nome.</li>
            ) : (
              visible.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setEscolhido(a.id)}
                    className="flex w-full items-center gap-2.5 border-b border-line px-4 py-2.5 text-left transition-colors duration-[120ms] last:border-0 hover:bg-sunken"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-ink">{a.name}</span>
                      <span className="block truncate text-meta text-ink-3">{teamById(a.teamId)?.name ?? "Sem equipa"}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-4" strokeWidth={1.75} />
                  </button>
                </li>
              ))
            )}
          </ListaDeEscolha>
        </>
      )}
    </Dialog>
  );
}

/**
 * O estado de uma mensalidade, editável pela direção.
 *
 * O Pill continua a dizer tudo — "Vencido", "A confirmar", "Anulada" —, mas passa a
 * ser um gatilho: um clique abre as três decisões manuais. O menu vive num **portal**
 * (em `document.body`) porque a tabela recorta o que transborda; sem isso, um menu
 * aberto na última linha ficava cortado por baixo.
 */
/** Altura aproximada do menu — três opções fixas, sempre o mesmo tamanho. */
const STATUS_MENU_HEIGHT = 160;

function FeeStatusControl({ fee }: { fee: Fee }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /*
   * Apagar, e o que correu mal.
   *
   * O erro não existia: uma mudança de estado que falhasse ficava calada. Com
   * apagar isso não serve — o servidor recusa as pagas online e as que têm uma
   * referência viva, e a razão tem de chegar a quem carregou.
   */
  const [aApagar, setAApagar] = useState(false);
  /** A perguntar como foi paga, antes de a marcar como paga. */
  const [aPagar, setAPagar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const target = currentTarget(fee.status);

  useEffect(() => {
    if (!open) return;
    // Scroll ou redimensionar fecha o menu — não vale a pena persegui-lo pela página.
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    // A linha inteira navega para a ficha do atleta — sem isto, abrir o menu de
    // estado levava também para lá, a meio do clique. `preventDefault` também,
    // para nenhum comportamento por omissão do botão escapar ao `stopPropagation`.
    e.preventDefault();
    e.stopPropagation();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.max(8, r.right - 180);
      const spaceBelow = window.innerHeight - r.bottom;
      // Cabe por baixo? Abre por baixo. Senão, e se couber por cima, abre por
      // cima — é a última linha da tabela que mais precisa disto, cortada ao
      // fundo do ecrã sempre que o menu insistia em abrir para baixo.
      if (spaceBelow >= STATUS_MENU_HEIGHT + 8 || r.top < STATUS_MENU_HEIGHT + 8) {
        setPos({ top: r.bottom + 4, left });
      } else {
        setPos({ bottom: window.innerHeight - r.top + 4, left });
      }
    }
    setOpen((v) => !v);
  };

  async function choose(e: React.MouseEvent, value: string) {
    // Mesma razão do `toggle`: um portal continua a ser filho da linha na árvore
    // React (mesmo vivendo fisicamente em `document.body`), e o clique borbulha
    // até ao `onClick` da linha se não se parar aqui.
    e.stopPropagation();
    setOpen(false);
    if (value === target || busy) return;
    // Marcar como paga pergunta primeiro como foi paga. Ver `MetodoDePagamentoDialog`.
    if (value === "SETTLED") {
      setAPagar(true);
      return;
    }
    await gravar(value);
  }

  async function gravar(value: string, method?: MetodoManual) {
    setBusy(true);
    setErro(null);
    try {
      await apiPatch(`/api/charges/${fee.id}/status`, { status: value, ...(method ? { method } : {}) });
      setAPagar(false);
      await reloadFees();
    } catch (err) {
      setAPagar(false);
      setErro(err instanceof Error ? err.message : "Não foi possível mudar o estado.");
    } finally {
      setBusy(false);
    }
  }

  async function apagar() {
    if (busy) return;
    setBusy(true);
    setErro(null);
    try {
      await apiDelete(`/api/charges/${fee.id}`);
      setAApagar(false);
      await reloadFees();
    } catch (err) {
      setAApagar(false);
      setErro(err instanceof Error ? err.message : "Não foi possível apagar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        onMouseDown={(e) => e.stopPropagation()}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Alterar estado"
        className={cx(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-tight font-semibold transition-opacity duration-[120ms] hover:opacity-75 disabled:opacity-50",
          TONE_CLASS[STATUS_TONE[fee.status]],
        )}
      >
        {STATUS_LABEL[fee.status]}
        <ChevronDown className="size-3" strokeWidth={2.5} />
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
              aria-hidden
            />
            <div
              role="menu"
              style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
              className="fixed z-50 w-[180px] rounded-[var(--radius-panel)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
            >
              {MANUAL_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="menuitem"
                  onClick={(e) => void choose(e, o.value)}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-body transition-colors duration-[120ms] hover:bg-sunken",
                    o.value === target ? "text-ink" : "text-ink-2",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-signal-ink">
                    {o.value === target && <Check className="size-3.5" strokeWidth={2.5} />}
                  </span>
                  <span className="flex-1">{o.label}</span>
                </button>
              ))}
              <div className="my-1 border-t border-line" />
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  setAApagar(true);
                }}
                className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-body text-risk transition-colors duration-[120ms] hover:bg-risk-soft"
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <Trash2 className="size-3.5" strokeWidth={1.9} />
                </span>
                <span className="flex-1">Apagar</span>
              </button>
            </div>
          </>,
          document.body,
        )}

      {/*
        A pergunta e o erro, num portal e com a propagação parada.

        O controlo vive dentro de uma linha que navega para a ficha do atleta ao
        clicar; um portal continua a ser filho dela na árvore React, e um clique
        em "Cancelar" levava também para lá. O `div` de fora pára isso.
      */}
      {(aApagar || aPagar || erro) &&
        createPortal(
          <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            {aPagar && (
              <MetodoDePagamentoDialog
                titulo={`${shortName(athleteById(fee.athleteId)?.name ?? "")} · ${
                  fee.extra ? (fee.title ?? "Cobrança") : periodLabel(fee.period)
                } · ${money(fee.amountCents)}`}
                busy={busy}
                onConfirm={(m) => void gravar("SETTLED", m)}
                onClose={() => setAPagar(false)}
              />
            )}
            {aApagar && (
              <Dialog
                title="Apagar mensalidade?"
                icon={<Trash2 className="size-4" strokeWidth={1.75} />}
                onClose={() => setAApagar(false)}
                width={420}
                labelledBy="apagar-mensalidade"
                footer={
                  <div className="flex w-full items-center justify-end gap-2">
                    <button type="button" className="ctl-ghost" onClick={() => setAApagar(false)} disabled={busy}>
                      Cancelar
                    </button>
                    <button type="button" className="ctl-risk" onClick={() => void apagar()} disabled={busy}>
                      <Trash2 className="size-3.5" strokeWidth={1.9} />
                      {busy ? "A apagar…" : "Apagar"}
                    </button>
                  </div>
                }
              >
                <p className="p-5 text-body leading-relaxed text-ink-2">
                  Apagar{" "}
                  <strong className="font-medium text-ink">
                    {fee.extra ? (fee.title ?? "esta cobrança") : `a mensalidade de ${periodLabel(fee.period)}`}
                  </strong>{" "}
                  ({money(fee.amountCents)})? Não há como voltar atrás.
                </p>
              </Dialog>
            )}
            {erro && !aApagar && (
              <Dialog
                title="Não foi possível"
                icon={<TriangleAlert className="size-4" strokeWidth={1.75} />}
                onClose={() => setErro(null)}
                width={420}
                labelledBy="erro-mensalidade"
                footer={
                  <button type="button" className="ctl-outline" onClick={() => setErro(null)}>
                    Fechar
                  </button>
                }
              >
                <p className="p-5 text-body leading-relaxed text-ink-2">{erro}</p>
              </Dialog>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * As métricas de cima, sobre as linhas em vista.
 *
 * As anuladas ficam de fora: não se vão cobrar, e contá-las no facturado punha
 * dinheiro em "Por cobrar" que nunca vai entrar.
 */
function summariseAll(todas: Fee[]) {
  const rows = todas.filter((f) => f.status !== "void");
  const sum = (pred: (f: Fee) => boolean) => rows.filter(pred).reduce((n, f) => n + f.amountCents, 0);
  return {
    total: rows.length,
    paid: rows.filter((f) => f.status === "paid").length,
    pending: rows.filter((f) => f.status === "pending").length,
    processing: rows.filter((f) => f.status === "processing").length,
    overdue: rows.filter((f) => f.status === "overdue").length,
    billedCents: sum(() => true),
    collectedCents: sum((f) => f.status === "paid"),
    overdueCents: sum((f) => f.status === "overdue"),
  };
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

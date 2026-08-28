import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Dialog, DialogField } from "@/components/Dialog";
import { DataTable, Empty, Metric, MetricRow, Monogram, Panel, PanelHead, Pill, SelectField, cx, type Column } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Select, Toolbar } from "@/components/filters";
import { CalendarDays, Check, ChevronDown, CircleCheck, Download, Loader2, Search, Send, Settings, TriangleAlert, Users, Wallet } from "@/lib/icons";
import {
  arrears,
  athleteById,
  availablePeriods,
  guardiansOf,
  currentPeriod,
  listAllFees,
  listAthletes,
  listFees,
  listTeams,
  teamById,
  today,
} from "@/lib/api";
import { apiGet, apiPatch, apiPost, apiPut } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { money, percent, periodLabel, relativeDays, shortName } from "@/lib/format";
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
  const [period, setPeriod] = useState<string>(estado === "overdue" ? ALL : currentPeriod);

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
    () => (equipa === ALL ? rows : rows.filter((f) => (athleteById(f.athleteId)?.teamId ?? "") === equipa)),
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
  const [athletePricesOpen, setAthletePricesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  /*
   * Sobe de um a cada preço gravado.
   *
   * A tabela em cima vem do `store` e o `reloadAcademy()` já a punha certa. O
   * painel de baixo — `MissingCharges` — é que tem leitura própria
   * (`/api/charges/em-falta`) e só a fazia ao montar: definia-se o preço, o
   * servidor emitia as mensalidades, e a lista continuava a dizer que aqueles
   * atletas não tinham nenhuma. Só um F5 a arrumava, e um F5 para ver o efeito
   * do que se acabou de fazer é a interface a admitir que não está a olhar.
   */
  const [feesVersion, setFeesVersion] = useState(0);
  const onFeeSaved = useCallback(() => setFeesVersion((v) => v + 1), []);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [reminderResult, setReminderResult] = useState<string | null>(null);

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
      render: (f) => <span className="text-ink-2">{periodLabel(f.period)}</span>,
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
      key: "method",
      header: "Método",
      hideBelow: "lg",
      render: (f) =>
        f.method ? (
          <span className="text-ink-2">{f.method}</span>
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
        {mayEditFees && (
          <>
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

        {/*
          Porque é que falta alguém.
          Vive por baixo da tabela e não dentro dela: são atletas **sem**
          mensalidade, e uma tabela de mensalidades não os pode conter. Ver
          `MissingCharges`.
        */}
        <MissingCharges
          period={period}
          mayWrite={mayEditFees}
          onOpenPrices={() => setPricesOpen(true)}
          version={feesVersion}
        />
      </div>

      {exportOpen && (
        <ExportFeesDialog session={session} periods={periods} onClose={() => setExportOpen(false)} />
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

type MissingReason = "fora-do-mes" | "sem-preco" | "por-gerar";

type MissingCharges = {
  period: string;
  cobraEsteMes: boolean;
  atletas: { athleteId: string; name: string; teamId: string | null; reason: MissingReason }[];
};

/**
 * Quem não tem mensalidade neste mês — e porquê.
 *
 * ## A ausência que ninguém conseguia explicar
 *
 * Esta página lê `Charge`. Um atleta sem cobrança simplesmente não aparece, e o
 * ecrã dizia "Sem mensalidades neste filtro" — a mesma frase para três coisas
 * completamente diferentes: o mês não se cobra, falta o preço, ou falta emitir.
 *
 * Foi exactamente assim que se perdeu uma tarde: atleta inscrito, preço da equipa
 * definido, e nada em Mensalidades. Não havia bug — o calendário de cobrança do
 * clube não incluía Agosto, e nenhum ecrã o dizia.
 *
 * Cada motivo tem uma acção diferente, e é isso que este painel mostra: o mês
 * fechado manda-te às Definições, o preço em falta ao diálogo de preços, e a
 * cobrança por emitir resolve-se aqui mesmo.
 */
function MissingCharges({
  period,
  mayWrite,
  onOpenPrices,
  version,
}: {
  /** O período em causa. Em "Todos os períodos" a pergunta é sobre o mês corrente. */
  period: string;
  mayWrite: boolean;
  onOpenPrices: () => void;
  /**
   * Sobe sempre que um preço é gravado noutro sítio da página.
   *
   * Este painel não lê do `store` — pergunta ao servidor quem ficou de fora — e
   * por isso nada o obrigava a voltar a perguntar. Definir um preço emite
   * mensalidades, e sem isto a lista ficava a mentir até alguém recarregar.
   */
  version: number;
}) {
  const alvo = period === ALL ? currentPeriod : period;
  const [data, setData] = useState<MissingCharges | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setData(await apiGet<MissingCharges>("/api/charges/em-falta", { periodo: alvo }));
      setErro(null);
    } catch (e) {
      // Um treinador sem `billing:read` nunca chega aqui; qualquer outra falha
      // não pode partir a página — o painel simplesmente não aparece.
      setData(null);
      setErro(e instanceof Error ? e.message : null);
    }
    // `version` não se usa aqui dentro: entra nas dependências de propósito, para
    // que gravar um preço volte a correr esta leitura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo, version]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function gerar() {
    setBusy(true);
    try {
      await apiPost(`/api/charges/gerar?periodo=${alvo}`, {});
      await reloadAcademy();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar as mensalidades.");
    } finally {
      setBusy(false);
    }
  }

  if (!data || data.atletas.length === 0) return null;

  const label = periodLabel(alvo);
  const porGerar = data.atletas.filter((a) => a.reason === "por-gerar");
  const semPreco = data.atletas.filter((a) => a.reason === "sem-preco");
  /*
   * Os que têm alguma coisa a fazer.
   *
   * `fora-do-mes` não é um problema de ninguém: é o calendário do clube. Quem
   * se inscreveu **neste** mês não entra aqui — esses são cobrados à mesma, por
   * isso chegam como `por-gerar`. Ver `gerarCobrancas` na API.
   */
  const accionaveis = data.atletas.filter((a) => a.reason !== "fora-do-mes");
  const foraDoMes = data.atletas.length - accionaveis.length;

  /*
   * O mês fechado é uma resposta só, não uma lista.
   *
   * Quando não há nada a fazer — o clube não cobra este mês e ninguém se
   * inscreveu nele — listar trinta nomes com o mesmo motivo é ruído. Uma frase
   * e o caminho para a mudar.
   */
  if (accionaveis.length === 0) {
    return (
      <Panel>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-3">
            <CalendarDays className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-body font-medium text-ink">O clube não cobra {label}</div>
            <div className="text-meta text-ink-3">
              Por isso não há mensalidades neste mês — nem para os {data.atletas.length} atletas activos. Não é
              dívida por pagar: é um mês fora do calendário de cobrança.
            </div>
          </div>
          <Link to="/definicoes" className="ctl-outline shrink-0">
            <Settings className="size-3.5" strokeWidth={1.75} />
            Ver calendário
          </Link>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHead
        title={`Sem mensalidade em ${label}`}
        hint={`${accionaveis.length} ${accionaveis.length === 1 ? "atleta" : "atletas"}`}
      >
        {mayWrite && porGerar.length > 0 && (
          <button type="button" className="ctl-primary" disabled={busy} onClick={() => void gerar()}>
            {busy ? "A gerar…" : `Emitir ${porGerar.length}`}
          </button>
        )}
        {mayWrite && semPreco.length > 0 && porGerar.length === 0 && (
          <button type="button" className="ctl-outline" onClick={onOpenPrices}>
            Definir preços
          </button>
        )}
      </PanelHead>

      <ul>
        {accionaveis.map((a) => (
          <li key={a.athleteId} className="flex items-center gap-3 border-b border-line px-5 py-2.5 last:border-b-0">
            <Monogram name={a.name} size="sm" />
            <Link to={`/atletas/${a.athleteId}`} className="min-w-0 flex-1 truncate text-body text-ink hover:underline">
              {a.name}
            </Link>
            <span className="shrink-0 text-meta text-ink-4">{teamById(a.teamId ?? "")?.name ?? "sem equipa"}</span>
            {a.reason === "sem-preco" ? (
              <Pill tone="warn">preço por configurar</Pill>
            ) : (
              <Pill tone="neutral">por emitir</Pill>
            )}
          </li>
        ))}
      </ul>

      {foraDoMes > 0 && (
        // O resto do plantel não tem mensalidade porque o mês não se cobra —
        // dito uma vez, em rodapé, para não repetir o mesmo motivo trinta vezes.
        <p className="border-t border-line px-5 py-2.5 text-meta text-ink-3">
          Os outros {foraDoMes} atletas activos não têm mensalidade porque o clube não cobra {label}.{" "}
          <Link to="/definicoes" className="font-medium text-ink hover:underline">
            Ver calendário
          </Link>
        </p>
      )}

      {erro && <p className="border-t border-line px-5 py-3 text-meta text-risk">{erro}</p>}
    </Panel>
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
  const opcoes: { value: AplicarEm; label: string; hint: string }[] = [
    { value: "atual", label: `Já em ${periodLabel(currentPeriod)}`, hint: "emite as mensalidades deste mês" },
    { value: "proximo", label: `Só a partir de ${periodLabel(nextPeriod(currentPeriod))}`, hint: "este mês não é cobrado" },
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
              value === o.value ? "border-signal bg-signal-soft/40" : "border-line bg-surface hover:bg-sunken",
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

/** O mês a seguir a este. Dezembro passa a Janeiro — gémeo de `periodoSeguinte` no servidor. */
function nextPeriod(period: string): string {
  const ano = Number(period.slice(0, 4));
  const mes = Number(period.slice(5, 7));
  return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, "0")}`;
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
  const teams = listTeams(session);
  const [aplicarEm, setAplicarEm] = useState<AplicarEm>("atual");

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
      subtitle="O preço por omissão de cada atleta — o ajuste individual, na ficha do atleta, sobrepõe-se."
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
      {teams.length === 0 ? (
        <div className="px-5 py-10">
          <Empty title="Sem equipas ainda" />
        </div>
      ) : (
        <>
          <ApplyFromChoice value={aplicarEm} onChange={setAplicarEm} />
          <ul>
            {teams.map((t) => (
              <li key={t.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium text-ink">{t.name}</div>
                  <div className="text-meta text-ink-3">
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
    </div>
  );
}

/**
 * Preço por atleta — o mesmo ajuste individual de sempre, aplicado a vários
 * atletas escolhidos de uma vez.
 *
 * Existe para o caso em que um valor diferente não pertence a uma equipa
 * inteira nem a um atleta só: uma bolsa que abrange três irmãos, um acordo
 * pontual com um grupo. Cada atleta escolhido passa a ter o mesmo ajuste
 * individual de `PUT /api/athletes/:id/fee` — sobrepõe-se ao preço da equipa, e
 * fica assim até alguém o reverter na ficha do próprio atleta.
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
  const [aplicarEm, setAplicarEm] = useState<AplicarEm>("atual");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const visible = q ? athletes.filter((a) => a.name.toLowerCase().includes(q)) : athletes;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  async function apply() {
    const cents = Math.round(Number(amount.trim().replace(",", ".")) * 100);
    if (selected.size === 0) {
      setError("Escolhe pelo menos um atleta.");
      return;
    }
    if (!Number.isFinite(cents) || cents < 100) {
      setError("Indica um valor válido, de pelo menos 1 €.");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      await apiPut("/api/athletes/fee", { athleteIds: [...selected], amountCents: cents, aplicarEm });
      await reloadAcademy();
      onSaved();
      setResult(
        `Ajustados ${selected.size} ${selected.size === 1 ? "atleta" : "atletas"}` +
          (aplicarEm === "atual"
            ? `, com a mensalidade de ${periodLabel(currentPeriod)} emitida.`
            : `. A cobrança começa em ${periodLabel(nextPeriod(currentPeriod))}.`),
      );
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="preco-por-atleta"
      title="Preço por atleta"
      subtitle="Um ajuste individual, aplicado a vários atletas de uma vez — sobrepõe-se ao preço da equipa."
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Fechar
          </button>
          <button type="button" onClick={() => void apply()} disabled={busy} className="ctl-primary">
            {busy ? "A aplicar…" : `Aplicar a ${selected.size || ""} ${selected.size === 1 ? "atleta" : "atletas"}`.trim()}
          </button>
        </>
      }
    >
      <ApplyFromChoice value={aplicarEm} onChange={setAplicarEm} />

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

      <ul className="max-h-[300px] overflow-y-auto">
        {visible.length === 0 ? (
          <li className="px-5 py-8 text-center text-meta text-ink-4">Ninguém com esse nome.</li>
        ) : (
          visible.map((a) => {
            const on = selected.has(a.id);
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => toggle(a.id)}
                  aria-pressed={on}
                  className={cx(
                    "flex w-full items-center gap-2.5 border-b border-line px-4 py-2.5 text-left transition-colors duration-[120ms] last:border-0",
                    on ? "bg-signal-soft/60" : "hover:bg-sunken",
                  )}
                >
                  <span
                    className={cx(
                      "flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-[120ms]",
                      on ? "border-transparent bg-signal-strong text-signal-on" : "border-line-strong",
                    )}
                  >
                    {on && <Check className="size-3.5" strokeWidth={2.5} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-ink">{a.name}</span>
                    <span className="block truncate text-meta text-ink-3">{teamById(a.teamId)?.name ?? "—"}</span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      <div className="border-t border-line p-4">
        <label className="mb-1.5 block text-meta font-medium text-ink-3">Valor individual, por mês</label>
        <div className="flex items-center gap-2">
          <span className="text-body text-ink-3">€</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            className="h-9 w-32 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body tabular focus:border-line-strong focus:outline-none"
          />
        </div>
        {error && <p className="mt-2 text-meta text-risk">{error}</p>}
        {result && <p className="mt-2 text-meta text-ok">{result}</p>}
      </div>
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
const STATUS_MENU_HEIGHT = 120;

function FeeStatusControl({ fee }: { fee: Fee }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      await apiPatch(`/api/charges/${fee.id}/status`, { status: value });
      await reloadAcademy();
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
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function summariseAll(rows: Fee[]) {
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

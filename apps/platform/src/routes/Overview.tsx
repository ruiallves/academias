import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Metric, MetricRow, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { ChurnChart, GrowthChart } from "@/components/Charts";
import { euros } from "@/lib/format";
import { useApi } from "@/lib/query";
import type { Alert, Overview as OverviewData, SeriesPoint } from "@/lib/types";

/**
 * A página de entrada.
 *
 * **Primeiro o que exige acção, depois o que descreve o estado.** É a decisão que
 * define esta página, e é o oposto do que uma dashboard costuma fazer: uma grelha
 * de cartões obriga quem entra a procurar o problema no meio dos números; uma lista
 * de alertas entrega-o.
 *
 * Se não houver nada a fazer, a lista diz isso em duas linhas e sai da frente — o
 * espaço passa a ser dos números. Um painel que grita todos os dias deixa de ser
 * lido ao fim de uma semana.
 */
export default function Overview() {
  const overview = useApi<OverviewData>("/overview");
  const series = useApi<SeriesPoint[]>("/series?months=12");

  if (overview.loading) return <Skeleton />;
  if (overview.error) return <Failed message={overview.error} onRetry={overview.reload} />;

  const d = overview.data!;
  const { academies: a, people, revenue } = d;

  return (
    <>
      <PageHeader title="Visão geral" subtitle="Como vai o negócio, e o que precisa de ti hoje." />

      <div className="space-y-3">
        <Attention alerts={d.alerts} />

        <MetricRow>
          <Metric
            label="MRR"
            value={euros(revenue.mrrCents)}
            note={`${euros(revenue.arrCents)} por ano`}
          />
          <Metric
            label="Academias a pagar"
            value={String(a.active)}
            note={`${a.trial} em avaliação · ${a.setup} a montar`}
            trend={{ value: a.newThisMonth }}
          />
          <Metric
            label="Cancelaram este mês"
            value={String(a.churnThisMonth)}
            note={a.churnThisMonth === 0 ? "nenhuma — bom mês" : "vale um telefonema"}
            trend={{ value: a.churnThisMonth, good: "down" }}
          />
          <Metric
            label="Utilização"
            value={d.usage === null ? "—" : `${d.usage}%`}
            note="registaram presenças esta semana"
          />
        </MetricRow>

        <div className="grid gap-3 xl:grid-cols-2">
          <Panel>
            <PanelHead title="Crescimento" hint="academias activas, 12 meses" />
            <GrowthChart data={series.data ?? []} />
          </Panel>

          <Panel>
            <PanelHead title="Entradas e saídas" hint="por mês" />
            <ChurnChart data={series.data ?? []} />
          </Panel>
        </div>

        <MetricRow>
          <Metric label="Atletas" value={String(people.athletes)} note="em todas as academias" />
          <Metric label="Famílias" value={String(people.guardians)} note="encarregados com conta" />
          <Metric label="Staff" value={String(people.staff)} note="treinadores, direção, clínico" />
          <Metric label="Academias" value={String(a.total)} note={`${a.cancelled} canceladas`} />
        </MetricRow>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O que precisa de atenção.
 *
 * Cada linha é clicável e leva à academia em causa. Um alerta que obriga a
 * procurar de quem se trata é meio alerta.
 */
function Attention({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return (
      <Panel className="flex items-center gap-3 px-5 py-3.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#e6f2e9] text-[#1f7a45]">✓</span>
        <div className="min-w-0">
          <div className="text-body font-medium text-ink">Nada a precisar de atenção</div>
          <div className="text-meta text-ink-3">Sem trials a acabar, pagamentos falhados ou clientes parados.</div>
        </div>
      </Panel>
    );
  }

  const risk = alerts.filter((x) => x.severity === "risk").length;

  return (
    <Panel>
      <PanelHead title="Precisa de atenção" hint={`${alerts.length} ${alerts.length === 1 ? "item" : "itens"}`}>
        {risk > 0 && <Pill tone="risk">{risk} urgente{risk === 1 ? "" : "s"}</Pill>}
      </PanelHead>

      <ul>
        {alerts.map((x) => (
          <li key={x.id}>
            <Link
              to={`/academias?destaque=${x.academyId}`}
              className="group flex items-start gap-3 border-b border-line px-5 py-3 transition-colors duration-[120ms] last:border-b-0 hover:bg-sunken/60"
            >
              <AlertTriangle
                className={cx("mt-0.5 size-4 shrink-0", x.severity === "risk" ? "text-[#a82a20]" : "text-[#b8860b]")}
                strokeWidth={1.75}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-body font-medium text-ink">{x.title}</span>
                  <span className="text-meta text-ink-3">{x.academyName}</span>
                </div>
                <div className="mt-0.5 text-meta leading-relaxed text-ink-3">{x.detail}</div>
              </div>
              <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-ink-4 transition-transform duration-[120ms] group-hover:translate-x-0.5" strokeWidth={1.75} />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function Skeleton() {
  return (
    <>
      <PageHeader title="Visão geral" />
      <div className="space-y-3">
        {[64, 92, 220].map((h, i) => (
          <div key={i} className="panel animate-pulse bg-sunken/40" style={{ height: h }} />
        ))}
      </div>
    </>
  );
}

export function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Panel>
      <Empty title="Não foi possível carregar" detail={message} />
      <div className="flex justify-center pb-8">
        <button type="button" onClick={onRetry} className="ctl-outline">
          Tentar outra vez
        </button>
      </div>
    </Panel>
  );
}

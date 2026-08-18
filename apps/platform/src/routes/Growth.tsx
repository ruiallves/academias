import { PageHeader } from "@/components/Shell";
import { Metric, MetricRow, Panel, PanelHead } from "@/components/primitives";
import { ChurnChart, GrowthChart } from "@/components/Charts";
import { Failed } from "./Overview";
import { euros } from "@/lib/format";
import { useApi } from "@/lib/query";
import type { Overview, SeriesPoint } from "@/lib/types";

/**
 * Crescimento.
 *
 * O que aqui está não é accionável — é para perceber, não para agir. Por isso vive
 * longe da Visão geral: misturar "o que tenho de fazer hoje" com "como vai o
 * negócio a doze meses" faz com que nenhuma das duas perguntas seja bem respondida.
 */
export default function Growth() {
  const series = useApi<SeriesPoint[]>("/series?months=24");
  const overview = useApi<Overview>("/overview");

  if (series.error) return <Failed message={series.error} onRetry={series.reload} />;

  const d = overview.data;
  const points = series.data ?? [];
  const net = points.reduce((n, p) => n + p.new_academies - p.cancelled, 0);
  const totalNew = points.reduce((n, p) => n + p.new_academies, 0);

  return (
    <>
      <PageHeader title="Crescimento" subtitle="Dois anos de história, sem interpretação pelo meio." />

      <div className="space-y-3">
        <MetricRow>
          <Metric label="MRR" value={d ? euros(d.revenue.mrrCents) : "—"} note="receita recorrente mensal" />
          <Metric label="ARR" value={d ? euros(d.revenue.arrCents) : "—"} note="a doze meses" />
          <Metric label="Entradas líquidas" value={`${net > 0 ? "+" : ""}${net}`} note="em 24 meses" />
          <Metric
            label="Retenção"
            value={totalNew > 0 ? `${Math.round((net / totalNew) * 100)}%` : "—"}
            note="das que entraram, quantas ficaram"
          />
        </MetricRow>

        <Panel>
          <PanelHead title="Academias activas" hint="24 meses" />
          <GrowthChart data={points} height={240} />
        </Panel>

        <Panel>
          <PanelHead title="Entradas e saídas" hint="por mês" />
          <ChurnChart data={points} height={240} />
        </Panel>
      </div>
    </>
  );
}

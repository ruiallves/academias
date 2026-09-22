/**
 * Os gráficos do painel.
 *
 * Cada um escolhe a forma pela pergunta que responde, e o desenho vem todo de
 * `components/chart/Chart.tsx`: grelha fina, eixo com números redondos, cursor
 * que encontra o mês, e um tooltip que diz o valor. Aqui só se decide **o que**
 * se mostra e **como se lê**.
 *
 * ## Linha ou barras
 *
 * - **Linha com área** quando a série é contínua e o que interessa é a
 *   tendência: o número de academias activas existe em todos os dias do mês, e
 *   ligar dois meses não inventa nada.
 * - **Barras** quando cada período é uma unidade fechada e contada: as pessoas
 *   que trabalharam **naquela** semana, as folhas de presenças **daquele** mês.
 *   Uma linha entre duas semanas inventaria os dias do meio.
 */

import { monthLabel, weekLabel } from "@/lib/format";
import { AreaChart, BarChart, ChartEmpty, ChartHero, DivergingBars } from "@/components/chart/Chart";
import type { ActivityPoint, SeriesPoint } from "@/lib/types";

const inteiro = (v: number) => new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 0 }).format(v);

/* -------------------------------------------------------------------------- */

/** Academias activas ao longo do tempo. */
export function GrowthChart({ data, height = 200 }: { data: SeriesPoint[]; height?: number }) {
  if (data.length === 0) return <ChartEmpty height={height} />;

  const ultimo = data[data.length - 1].active_end;
  const primeiro = data[0].active_end;
  const delta = ultimo - primeiro;

  return (
    <div>
      <ChartHero
        valor={inteiro(ultimo)}
        unidade={ultimo === 1 ? "academia activa" : "academias activas"}
        delta={
          delta === 0
            ? { texto: "sem variação no período", bom: null }
            : { texto: `${delta > 0 ? "+" : ""}${delta} no período`, bom: delta > 0 }
        }
      />
      <AreaChart
        height={height}
        formato={(v) => `${inteiro(v)} ${v === 1 ? "academia" : "academias"}`}
        formatoEixo={inteiro}
        dados={data.map((d) => ({
          key: d.month,
          label: monthLabel(d.month),
          value: d.active_end,
        }))}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Trabalho feito por semana, em toda a plataforma.
 *
 * A barra são **pessoas** — o número que diz se o produto está vivo. As acções e
 * as academias dizem-se no tooltip, porque são a explicação do número, não uma
 * segunda escala para o mesmo eixo.
 */
export function PlatformActivityChart({ data, height = 200 }: { data: ActivityPoint[]; height?: number }) {
  if (data.length === 0) return <ChartEmpty height={height} />;

  const ultima = data[data.length - 1];
  const anterior = data[data.length - 2];
  const delta = anterior ? ultima.people - anterior.people : 0;

  return (
    <div>
      <ChartHero
        valor={inteiro(ultima.people)}
        unidade={`${ultima.people === 1 ? "pessoa" : "pessoas"} esta semana`}
        delta={
          anterior
            ? delta === 0
              ? { texto: "igual à semana anterior", bom: null }
              : { texto: `${delta > 0 ? "+" : ""}${delta} face à semana anterior`, bom: delta > 0 }
            : undefined
        }
      />
      <BarChart
        height={height}
        formatoEixo={inteiro}
        dados={data.map((d) => ({
          key: d.week,
          label: weekLabel(d.week),
          value: d.people,
          detalhe: `${inteiro(d.people)} ${d.people === 1 ? "pessoa" : "pessoas"} · ${inteiro(d.actions)} ${
            d.actions === 1 ? "acção" : "acções"
          } · ${inteiro(d.academies)} ${d.academies === 1 ? "academia" : "academias"}`,
        }))}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Novas e canceladas por mês, nos dois sentidos da mesma linha do zero.
 *
 * Duas séries, logo com legenda: a cor nunca pode ser a única forma de saber
 * qual é qual.
 */
export function ChurnChart({ data, height = 200 }: { data: SeriesPoint[]; height?: number }) {
  if (data.length === 0) return <ChartEmpty height={height} />;

  const totalNew = data.reduce((n, d) => n + d.new_academies, 0);
  const totalOut = data.reduce((n, d) => n + d.cancelled, 0);
  const liquido = totalNew - totalOut;

  return (
    <div>
      <ChartHero
        valor={`${liquido > 0 ? "+" : ""}${inteiro(liquido)}`}
        unidade="líquido no período"
        delta={{ texto: `${totalNew} entraram · ${totalOut} saíram`, bom: null }}
      />
      <DivergingBars
        height={height}
        acima="Entraram"
        abaixo="Saíram"
        formato={inteiro}
        dados={data.map((d) => ({
          key: d.month,
          label: monthLabel(d.month),
          acima: d.new_academies,
          abaixo: d.cancelled,
        }))}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Presenças registadas por semana, na ficha de uma academia.
 *
 * A escala é o máximo das oito semanas e não um número fixo: o que interessa é a
 * forma — se caiu, se parou — e um clube de trinta treinos por semana e outro de
 * três lêem-se os dois no mesmo espaço.
 */
export function ActivityChart({
  data,
  height = 170,
}: {
  data: { week: string; sessions: number }[];
  height?: number;
}) {
  if (data.length === 0) return <ChartEmpty height={height} />;

  const vazio = data.every((d) => d.sessions === 0);
  const total = data.reduce((n, d) => n + d.sessions, 0);

  return (
    <div className="pb-2">
      <ChartHero
        valor={inteiro(total)}
        unidade={total === 1 ? "folha fechada em 8 semanas" : "folhas fechadas em 8 semanas"}
      />
      <BarChart
        height={height}
        formatoEixo={inteiro}
        dados={data.map((d) => ({
          key: d.week,
          label: weekLabel(d.week),
          value: d.sessions,
          detalhe: `${inteiro(d.sessions)} ${d.sessions === 1 ? "folha" : "folhas"} na semana de ${weekLabel(d.week)}`,
        }))}
      />
      {vazio && (
        <p className="px-5 pt-1 text-meta leading-relaxed text-ink-3">
          Nenhuma folha de presenças fechada em oito semanas. É o sinal mais forte de que este clube deixou de usar
          o produto.
        </p>
      )}
    </div>
  );
}

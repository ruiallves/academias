/**
 * Os gráficos do painel.
 *
 * Escritos em SVG à mão, e não com uma biblioteca. Não é teimosia: são dois
 * gráficos, ambos simples, e a alternativa era trazer 50 kB de código com o seu
 * próprio sistema de temas, de escalas e de tooltips — que depois é preciso
 * dobrar para se parecer com o resto do produto. Aqui herdam os tokens
 * directamente e não há nada a dobrar.
 *
 * ## O que estes gráficos recusam
 *
 * Sem eixos decorativos, sem grelhas de fundo densas, sem legendas a repetir o que
 * o título já diz. Um gráfico de painel é lido em dois segundos por alguém que
 * quer saber se a linha sobe — tudo o que não serve essa leitura está a atrapalhar.
 */

import { monthLabel, weekLabel } from "@/lib/format";
import { cx } from "@/components/primitives";
import type { ActivityPoint, SeriesPoint } from "@/lib/types";

const SIGNAL = "var(--color-signal)";

/* ---------------------------------------------------------------------------- */

/**
 * A barra, e mais nada.
 *
 * ## Porque é que todos os gráficos daqui são isto
 *
 * Porque a alternativa estava partida. O de crescimento era uma área em SVG com
 * `preserveAspectRatio="none"`: o marcador do último ponto era um `<circle>` que
 * o esticão do viewBox transformava num triângulo, meio dele fora da moldura. O
 * de actividade tinha uma linha por cima das barras que fugia do painel e
 * atravessava a página.
 *
 * Os dois tinham a mesma origem: coordenadas em SVG a fingir que sabem onde
 * acaba a caixa. Isto são `<div>`s numa linha `flex`, com altura em
 * percentagem — não há coordenada nenhuma para escapar, e o navegador é que
 * decide onde a caixa acaba.
 *
 * ## O que se lê
 *
 * A forma. A escala é o máximo do período e nunca um número fixo, porque a
 * pergunta é "subiu ou desceu", não "quantos exactamente" — esse número está por
 * cima, em texto, que é onde os números se lêem.
 */
function Bars({
  data,
  height,
}: {
  data: { key: string; label: string; value: number; title: string }[];
  height: number;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);

  /* Primeiro, meio e último. Doze rótulos em 400px viram uma mancha cinzenta. */
  const meio = Math.floor((data.length - 1) / 2);

  return (
    <>
      <div className="flex items-end gap-1.5 px-5 pt-3" style={{ height }}>
        {data.map((d) => (
          <div key={d.key} className="flex h-full min-w-0 flex-1 items-end" title={d.title}>
            <div
              className="w-full rounded-t-[3px]"
              style={{
                // Um mínimo visível para o zero: uma barra sem altura nenhuma
                // deixa um buraco no eixo, e um buraco lê-se como dados em falta
                // em vez de como um zero.
                height: `${Math.max((d.value / max) * 100, d.value > 0 ? 4 : 2)}%`,
                background: d.value > 0 ? SIGNAL : "var(--color-line)",
              }}
            />
          </div>
        ))}
      </div>

      <div className="flex px-5 pt-2 pb-4">
        {data.map((d, i) => (
          <span key={d.key} className="flex-1 truncate text-center text-[10px] text-ink-4">
            {i === 0 || i === data.length - 1 || i === meio ? d.label : ""}
          </span>
        ))}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/** Academias activas ao longo do tempo. */
export function GrowthChart({ data, height = 180 }: { data: SeriesPoint[]; height?: number }) {
  if (data.length === 0) return <ChartEmpty height={height} />;

  const ultimo = data[data.length - 1].active_end;
  const primeiro = data[0].active_end;
  const delta = ultimo - primeiro;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 px-5 pt-4">
        <span className="text-[26px] leading-none font-semibold text-ink tabular">{ultimo}</span>
        <span className="text-meta text-ink-3">
          {ultimo === 1 ? "academia activa" : "academias activas"}
        </span>
        {delta !== 0 && (
          <span className={cx("text-meta tabular", delta > 0 ? "text-[#1f7a45]" : "text-[#b4453a]")}>
            {delta > 0 ? "+" : ""}
            {delta} no período
          </span>
        )}
      </div>

      <Bars
        height={height}
        data={data.map((d) => ({
          key: d.month,
          label: monthLabel(d.month),
          value: d.active_end,
          title: `${monthLabel(d.month)}: ${d.active_end} ${d.active_end === 1 ? "academia" : "academias"}`,
        }))}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Trabalho feito por semana, em toda a plataforma.
 *
 * ## O que substituiu, e porquê
 *
 * O gráfico de entradas e saídas. Com meia dúzia de clubes e nenhuma saída era
 * uma barra a zero repetida doze vezes — metade da página para dizer nada. É um
 * gráfico para quando houver rotação; hoje a pergunta é a anterior a essa: **as
 * pessoas estão a usar isto?**
 *
 * ## Uma série desenhada, duas contadas
 *
 * A barra são **pessoas** — é o número que decide se o produto está vivo. As
 * **acções** dizem-se por cima, em texto, e aparecem ao passar o rato em cada
 * semana.
 *
 * Chegaram a ser uma segunda linha sobre as barras. Era mais informação e um
 * gráfico pior: duas escalas diferentes na mesma caixa obrigam a explicar a
 * leitura antes de a fazer, e o painel é para se ler em dois segundos.
 */
export function PlatformActivityChart({ data, height = 180 }: { data: ActivityPoint[]; height?: number }) {
  if (data.length === 0) return <ChartEmpty height={height} />;

  const ultima = data[data.length - 1];
  const anterior = data[data.length - 2];
  const delta = anterior ? ultima.people - anterior.people : 0;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-5 pt-4">
        <span className="text-[26px] leading-none font-semibold text-ink tabular">{ultima.people}</span>
        <span className="text-meta text-ink-3">
          {ultima.people === 1 ? "pessoa" : "pessoas"} esta semana · {ultima.actions}{" "}
          {ultima.actions === 1 ? "acção" : "acções"} em {ultima.academies}{" "}
          {ultima.academies === 1 ? "academia" : "academias"}
        </span>
        {delta !== 0 && (
          <span className={cx("text-meta tabular", delta > 0 ? "text-[#1f7a45]" : "text-[#b4453a]")}>
            {delta > 0 ? "+" : ""}
            {delta} face à semana anterior
          </span>
        )}
      </div>

      <Bars
        height={height}
        data={data.map((d) => ({
          key: d.week,
          label: weekLabel(d.week),
          value: d.people,
          title: `Semana de ${weekLabel(d.week)}: ${d.people} ${d.people === 1 ? "pessoa" : "pessoas"}, ${d.actions} ${
            d.actions === 1 ? "acção" : "acções"
          }, ${d.academies} ${d.academies === 1 ? "academia" : "academias"}`,
        }))}
      />
    </div>
  );
}


/* ---------------------------------------------------------------------------- */

/**
 * Novas e canceladas por mês — barras nos dois sentidos do mesmo eixo.
 *
 * Empilhar seria mais compacto e mentiria: entradas e saídas são grandezas
 * opostas, e vê-las a crescer para lados contrários é a leitura certa. A linha do
 * zero é o que separa um mês bom de um mau, e por isso é a única linha desenhada.
 */
export function ChurnChart({ data, height = 180 }: { data: SeriesPoint[]; height?: number }) {
  if (data.length === 0) return <ChartEmpty height={height} />;

  const max = Math.max(...data.map((d) => Math.max(d.new_academies, d.cancelled)), 1);
  const totalNew = data.reduce((n, d) => n + d.new_academies, 0);
  const totalOut = data.reduce((n, d) => n + d.cancelled, 0);

  return (
    <div>
      <div className="flex items-baseline gap-2.5 px-5 pt-4">
        <span className="text-[26px] leading-none font-semibold text-ink tabular">
          {totalNew > 0 ? "+" : ""}
          {totalNew - totalOut}
        </span>
        <span className="text-meta text-ink-3">
          líquido · {totalNew} entraram, {totalOut} saíram
        </span>
      </div>

      <div className="flex items-stretch gap-1 px-5 pt-3" style={{ height }}>
        {data.map((d) => (
          <div key={d.month} className="flex flex-1 flex-col justify-center" title={`${monthLabel(d.month)}: +${d.new_academies} / −${d.cancelled}`}>
            <div className="flex flex-1 flex-col justify-end">
              <div
                className="rounded-t-[2px]"
                style={{ height: `${(d.new_academies / max) * 100}%`, background: SIGNAL, minHeight: d.new_academies > 0 ? 2 : 0 }}
              />
            </div>
            <div className="h-px bg-line-strong" />
            <div className="flex flex-1 flex-col justify-start">
              <div
                className="rounded-b-[2px] bg-[#d9776c]"
                style={{ height: `${(d.cancelled / max) * 100}%`, minHeight: d.cancelled > 0 ? 2 : 0 }}
              />
            </div>
          </div>
        ))}
      </div>

      <MonthAxis data={data} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Os meses, por baixo do gráfico.
 *
 * Só o primeiro, o último e um do meio quando há muitos: doze rótulos de três
 * letras em 400px viram uma mancha cinzenta que ninguém lê.
 */
function MonthAxis({ data }: { data: SeriesPoint[] }) {
  const show = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);
  return (
    <div className="flex px-5 pt-2 pb-4">
      {data.map((d, i) => (
        <span key={d.month} className="flex-1 text-center text-[10px] text-ink-4">
          {show.has(i) ? monthLabel(d.month) : ""}
        </span>
      ))}
    </div>
  );
}

/**
 * Presenças registadas por semana — barras.
 *
 * Barras e não linha: cada semana é uma unidade fechada, e o que se lê é "houve
 * ou não houve", não uma tendência contínua. Uma linha entre duas semanas
 * inventa os dias do meio.
 *
 * A escala é o máximo das oito semanas e não um número fixo: o que interessa é a
 * **forma** — se caiu, se parou — e um clube de trinta treinos por semana e outro
 * de três lêem-se os dois no mesmo espaço.
 */
export function ActivityChart({
  data,
  height = 150,
}: {
  data: { week: string; sessions: number }[];
  height?: number;
}) {
  if (data.length === 0) return <ChartEmpty height={height} />;

  const max = Math.max(...data.map((d) => d.sessions), 1);
  const vazio = data.every((d) => d.sessions === 0);

  return (
    <div className="px-5 pt-4 pb-3">
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((d) => {
          const altura = Math.round((d.sessions / max) * 100);
          return (
            <div key={d.week} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <span className="text-[11px] text-ink-4 tabular">{d.sessions || ""}</span>
              <div className="flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t-[3px]"
                  style={{
                    height: `${Math.max(altura, d.sessions > 0 ? 4 : 2)}%`,
                    background: d.sessions > 0 ? SIGNAL : "var(--color-line)",
                  }}
                  title={`Semana de ${semana(d.week)}: ${d.sessions} ${d.sessions === 1 ? "folha" : "folhas"}`}
                />
              </div>
              <span className="w-full truncate text-center text-[10px] text-ink-4">{semana(d.week)}</span>
            </div>
          );
        })}
      </div>
      {vazio && (
        <p className="mt-2 text-meta text-ink-3">
          Nenhuma folha de presenças fechada em oito semanas. É o sinal mais forte de que este clube deixou de usar
          o produto.
        </p>
      )}
    </div>
  );
}

/**
 * O mesmo rótulo do gráfico da plataforma, com o nome que este ficheiro já usava.
 *
 * A versão anterior partia a cadeia pelos hífenes e assumia que o terceiro
 * pedaço era só o dia. Aqui era verdade — este `week` nasce de um
 * `toISOString().slice(0, 10)` — mas o do gráfico da plataforma vinha do Postgres
 * como timestamp, e a mesma linha copiada dava `NaN/8` no eixo. Uma definição só,
 * em `lib/format`, e o problema deixa de poder acontecer duas vezes.
 */
const semana = weekLabel;

function ChartEmpty({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center px-5 text-meta text-ink-4" style={{ height: height + 60 }}>
      Ainda não há histórico suficiente.
    </div>
  );
}

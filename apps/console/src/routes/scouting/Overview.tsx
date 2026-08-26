import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { ArrowRight, Binoculars, Eye } from "@/lib/icons";
import {
  CONTEXT_LABEL,
  RECOMMENDATION_LABEL,
  STAGE_LABEL,
  getOverview,
  sinceLabel,
  type Overview as Data,
  type Stage,
} from "@/lib/scouting";

/**
 * A sala de operações do departamento.
 *
 * Não é uma parede de KPIs. São as três perguntas que um responsável de scouting
 * faz ao abrir isto, pela ordem em que as faz:
 *
 *  1. **Quem espera por uma decisão minha?** — a lista accionável, no topo. Cada
 *     linha é um facto com um verbo, na mesma gramática do "Precisa de atenção"
 *     que a direção já conhece.
 *  2. **Que forma tem o funil?** — o corredor, uma régua horizontal com um
 *     segmento por estado e largura proporcional. É a alternativa ao Kanban: dá a
 *     forma de relance, sem nove colunas a rolar e sem arrastar cartões, que é um
 *     gesto que ninguém faz num portátil a meio de um jogo.
 *  3. **Quem está a arrefecer?** — porque o modo normal de perder um miúdo não é
 *     decidir mal, é não decidir nada durante dois meses.
 */
export default function ScoutingOverview() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOverview()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível carregar."));
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Scouting"
        title="Visão geral"
        subtitle={data ? `${data.total} prospectos acompanhados` : undefined}
      >
        <Link to="/scouting/prospects" className="ctl-primary">
          Ver prospectos
        </Link>
      </PageHeader>

      {error && (
        <Panel>
          <div className="px-5 py-10">
            <Empty title="Não foi possível carregar" detail={error} />
          </div>
        </Panel>
      )}

      {!data && !error && (
        <Panel>
          <Loading />
        </Panel>
      )}

      {data && (
        <div className="space-y-3">
          <Panel>
            <PanelHead
              title="Precisa de decisão"
              hint={data.awaitingDecision.length ? `${data.awaitingDecision.length}` : undefined}
            />
            {data.awaitingDecision.length === 0 ? (
              <div className="px-5 py-10">
                <Empty
                  tone="ok"
                  title="Nada à espera de ti"
                  detail="Ninguém está em trial à espera de uma decisão."
                />
              </div>
            ) : (
              <ul>
                {data.awaitingDecision.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/scouting/prospects/${p.id}`}
                      className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 transition-colors duration-[120ms] last:border-b-0 hover:bg-sunken/50"
                    >
                      <StageDot stage={p.stage} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-ink">{p.name}</span>
                        <span className="block truncate text-meta text-ink-3">
                          {STAGE_LABEL[p.stage]}
                          {p.position && ` · ${p.position}`}
                          {" · "}
                          {p.observations} {p.observations === 1 ? "observação" : "observações"}
                          {" · visto "}
                          {sinceLabel(p.lastObservedAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-meta text-ink-4">{p.owner ?? "sem responsável"}</span>
                      <ArrowRight className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHead title="O funil" hint="clica para filtrar a lista" />
            <Corridor stages={data.stages} total={data.total} />
          </Panel>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel>
              <PanelHead
                title="A arrefecer"
                hint={data.goingCold.length ? "mais de 30 dias sem observação" : undefined}
              />
              {data.goingCold.length === 0 ? (
                <div className="px-5 py-10">
                  <Empty tone="ok" title="Ninguém esquecido" detail="Todos os dossiês activos foram vistos no último mês." />
                </div>
              ) : (
                <ul>
                  {data.goingCold.map((p) => (
                    <li key={p.id}>
                      <Link
                        to={`/scouting/prospects/${p.id}`}
                        className="flex items-center gap-3 border-b border-line px-5 py-2.5 transition-colors duration-[120ms] last:border-b-0 hover:bg-sunken/50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body text-ink">{p.name}</span>
                          <span className="block truncate text-meta text-ink-3">{STAGE_LABEL[p.stage]}</span>
                        </span>
                        <Pill tone="warn">{sinceLabel(p.lastObservedAt)}</Pill>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel>
              <PanelHead title="Atividade dos scouts" hint="últimas observações" />
              {data.activity.length === 0 ? (
                <div className="px-5 py-10">
                  <Empty
                    icon={Eye}
                    title="Ainda sem observações"
                    detail="Aparecem aqui assim que alguém registar uma ida ao campo."
                  />
                </div>
              ) : (
                <ul className="px-5 py-1.5">
                  {data.activity.map((a) => (
                    <li key={a.id} className="flex items-center gap-2.5 border-b border-line py-2.5 last:border-0">
                      <Eye className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
                      <span className="min-w-0 flex-1">
                        <Link
                          to={`/scouting/prospects/${a.prospectId}`}
                          className="block truncate text-body text-ink hover:underline"
                        >
                          {a.prospectName}
                        </Link>
                        <span className="block truncate text-meta text-ink-3">
                          {a.scout ?? "scout removido"} · {CONTEXT_LABEL[a.context]} ·{" "}
                          {RECOMMENDATION_LABEL[a.recommendation].toLowerCase()}
                        </span>
                      </span>
                      <span className="shrink-0 text-meta text-ink-4">{sinceLabel(a.observedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O corredor.
 *
 * Uma barra por estado, largura proporcional à contagem, na ordem do funil. Lê-se
 * a forma — onde é que os dossiês encalham — sem contar números, e clicar leva à
 * lista já filtrada.
 *
 * A cor não é categórica: é **uma** cor, a da academia, com opacidade a crescer ao
 * longo do funil. Nove matizes distintas seriam nove coisas para decorar; a
 * progressão diz "mais adiantado" sem exigir legenda. "Não avançar" fica de fora
 * da barra, à parte — não é um passo do funil, é a saída dele.
 */
function Corridor({ stages, total }: { stages: { stage: Stage; count: number }[]; total: number }) {
  const active = stages.filter((s) => s.stage !== "REJECTED");
  const rejected = stages.find((s) => s.stage === "REJECTED");
  const sum = active.reduce((n, s) => n + s.count, 0);

  if (total === 0) {
    return (
      <div className="px-5 py-10">
        <Empty
          icon={Binoculars}
          title="Ainda não há prospectos"
          detail="O primeiro nome que alguém trouxer de um torneio começa aqui."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex h-9 w-full overflow-hidden rounded-[var(--radius-control)] border border-line">
        {active.map((s, i) => {
          if (s.count === 0) return null;
          return (
            <Link
              key={s.stage}
              to={`/scouting/prospects?estado=${s.stage}`}
              title={`${STAGE_LABEL[s.stage]} · ${s.count}`}
              style={{
                width: `${(s.count / Math.max(1, sum)) * 100}%`,
                background: `color-mix(in oklab, var(--color-signal) ${25 + i * 14}%, white)`,
              }}
              className="flex items-center justify-center border-r border-white/70 text-[11px] font-semibold text-ink transition-opacity duration-[120ms] last:border-r-0 hover:opacity-80"
            >
              {s.count}
            </Link>
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {active.map((s, i) => (
          <li key={s.stage} className="flex items-center gap-1.5">
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: `color-mix(in oklab, var(--color-signal) ${25 + i * 14}%, white)` }}
            />
            <Link
              to={`/scouting/prospects?estado=${s.stage}`}
              className={cx("text-meta hover:underline", s.count ? "text-ink-2" : "text-ink-4")}
            >
              {STAGE_LABEL[s.stage]} <span className="tabular">{s.count}</span>
            </Link>
          </li>
        ))}
        {/*
          Descartados à direita, na mesma linha — não por baixo.

          `ml-auto` empurra-o para o fim da linha do funil em vez de o deixar
          cair para o fundo da caixa. A separação é intencional: descartado não é
          uma etapa do funil, é a saída dele, e ler-se afastado dos outros diz
          isso sem precisar de uma legenda.
        */}
        {rejected && rejected.count > 0 && (
          <li className="flex items-center gap-1.5 sm:ml-auto">
            <span className="size-2.5 shrink-0 rounded-[3px] border border-line-strong" />
            <Link to="/scouting/prospects?estado=REJECTED" className="text-meta text-ink-4 hover:underline">
              Descartados <span className="tabular">{rejected.count}</span>
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Um ponto que diz onde no funil, sem escrever o nome do estado outra vez. */
function StageDot({ stage }: { stage: Stage }) {
  const path: Stage[] = ["DISCOVERED", "WATCHING", "OBSERVED", "TRIAL", "RECRUITED"];
  const i = Math.max(0, path.indexOf(stage));
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full"
      style={{ background: `color-mix(in oklab, var(--color-signal) ${25 + i * 14}%, white)` }}
    />
  );
}

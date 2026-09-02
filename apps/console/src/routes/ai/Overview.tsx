import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Bar, DataTable, Empty, Loading, Metric, MetricRow, Panel, PanelHead, PanelLink, Pill } from "@/components/primitives";
import { Brain, Film, Plus, Sparkle, TriangleAlert } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { shortDate } from "@/lib/format";
import {
  aiDashboard,
  confidenceTone,
  pct,
  STATUS_LABEL,
  STATUS_TONE,
  type AiDashboard,
  type AnalysisRow,
} from "@/lib/ai";

/**
 * Visão AI — a sala de operações da Academias AI.
 *
 * ## O que este ecrã é
 *
 * A resposta a três perguntas, por esta ordem: *há alguma coisa à minha
 * espera?* (revisões), *como vão as análises?* (processamento), *o que é que a
 * IA aprendeu?* (insights). O trabalho accionável vem primeiro, como na visão
 * geral da direção.
 *
 * ## O que este ecrã nunca faz
 *
 * Inventar. Um insight sem dados não aparece; uma análise com confiança baixa
 * di-lo no número, não o esconde. O vazio é uma mensagem honesta — "ainda não
 * há análises" — e não um gráfico de demonstração.
 */
export default function AiOverview() {
  const { session } = useSession();
  const [data, setData] = useState<AiDashboard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    aiDashboard().then(setData).catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <>
        <PageHeader eyebrow="Academias AI" title="Visão AI" />
        <Panel>
          <Empty icon={TriangleAlert} title="Não foi possível carregar" detail="Tenta outra vez daqui a pouco." />
        </Panel>
      </>
    );
  }
  if (!data) return <Loading />;

  const mayWrite = can(session, "ai:write");
  const activeInsights = data.insights.length;

  return (
    <>
      <PageHeader
        eyebrow="Academias AI"
        title="Visão AI"
        subtitle="Vídeo → dados → conhecimento. Cada jogo analisado alimenta o clube."
      >
        {mayWrite && (
          <Link to="/ai/analises/nova" className="ctl-primary gap-1.5">
            <Plus className="size-4" strokeWidth={2} />
            Nova análise
          </Link>
        )}
      </PageHeader>

      <MetricRow>
        <Metric label="Em processamento" value={String(data.counts.processing)} icon={Brain} note="na fila ou a correr" />
        <Metric
          label="Precisam de revisão"
          value={String(data.counts.review)}
          icon={TriangleAlert}
          note={data.counts.review > 0 ? "a IA pede confirmação" : "nada à tua espera"}
        />
        <Metric label="Concluídas" value={String(data.counts.completed)} icon={Film} note="prontas a consultar" />
        <Metric label="Insights ativos" value={String(activeInsights)} icon={Sparkle} note="derivados dos jogos" />
      </MetricRow>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
        <Panel>
          <PanelHead title="Análises recentes" hint={data.recent.length > 0 ? `${data.recent.length} mais recentes` : undefined} />
          <AnalysesTable rows={data.recent} mayWrite={mayWrite} />
          {data.recent.length > 0 && <PanelLink to="/ai/analises">Ver todas</PanelLink>}
        </Panel>

        <Panel className="self-start">
          <PanelHead title="AI Insights" hint="derivados, nunca inventados" />
          {data.insights.length === 0 ? (
            <Empty
              icon={Sparkle}
              title="Ainda não há insights"
              detail="Nascem dos dados das análises concluídas — e só quando a confiança chega. Nenhum número aqui será inventado."
              compact
            />
          ) : (
            <ul className="divide-y divide-line">
              {data.insights.map((i) => (
                <li key={i.id} className="px-5 py-3.5">
                  <p className="text-body leading-relaxed text-ink">{i.text}</p>
                  <div className="mt-1.5 flex items-center gap-2 text-meta text-ink-3">
                    {i.athleteName && <span>{i.athleteName}</span>}
                    {i.teamName && <span>{i.teamName}</span>}
                    <Pill tone={confidenceTone(i.confidence)}>{pct(i.confidence)}</Pill>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {data.insights.length > 0 && <PanelLink to="/ai/insights">Ver todos</PanelLink>}
        </Panel>
      </div>
    </>
  );
}

/** A tabela de análises — partilhada com a lista completa (`Analyses.tsx`). */
export function AnalysesTable({ rows, mayWrite }: { rows: AnalysisRow[]; mayWrite: boolean }) {
  return (
    <DataTable
      rows={rows}
      keyOf={(a) => a.id}
      to={(a) => `/ai/analises/${a.id}`}
      empty={
        <Empty
          icon={Film}
          title="Ainda não há análises"
          detail="Cria a primeira: escolhe o jogo, confirma o plantel e carrega o vídeo. O processamento corre sozinho — podes fechar a consola."
        >
          {mayWrite && (
            <Link to="/ai/analises/nova" className="ctl-outline gap-1">
              <Plus className="size-3.5" strokeWidth={2} />
              Nova análise
            </Link>
          )}
        </Empty>
      }
      columns={[
        {
          key: "title",
          header: "Análise",
          render: (a) => (
            <div className="min-w-0">
              <div className="truncate font-medium text-ink">{a.title}</div>
              <div className="truncate text-meta text-ink-3">
                {a.teamName}
                {a.playedOn ? ` · ${shortDate(new Date(a.playedOn))}` : ""}
              </div>
            </div>
          ),
        },
        {
          key: "status",
          header: "Estado",
          width: "160px",
          render: (a) => (
            <div className="flex flex-col gap-1.5">
              <Pill tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Pill>
              {(a.status === "PROCESSING" || a.status === "QUEUED") && <Bar value={a.progress / 100} />}
            </div>
          ),
        },
        {
          key: "review",
          header: "Revisão",
          align: "right",
          width: "100px",
          hideBelow: "sm",
          render: (a) =>
            a.reviewCount > 0 ? (
              <Pill tone="warn">{a.reviewCount} {a.reviewCount === 1 ? "item" : "itens"}</Pill>
            ) : (
              <span className="text-meta text-ink-4">—</span>
            ),
        },
        {
          key: "confidence",
          header: "Confiança",
          align: "right",
          width: "110px",
          hideBelow: "md",
          render: (a) => {
            const c = overallConfidence(a);
            if (c === null) return <span className="text-meta text-ink-4">—</span>;
            // Classes estáticas: um `text-${tone}` dinâmico nunca entraria no CSS.
            const cor = { ok: "text-ok", warn: "text-warn", risk: "text-risk" }[confidenceTone(c)];
            return <span className={`font-semibold tabular ${cor}`}>{pct(c)}</span>;
          },
        },
      ]}
    />
  );
}

/**
 * Um número só para a linha da tabela: a **menor** confiança entre as dimensões
 * medidas. A média esconderia o elo fraco — e o elo fraco é precisamente o que
 * quem vai confiar nos números precisa de saber.
 */
export function overallConfidence(a: AnalysisRow): number | null {
  const c = a.confidence;
  if (!c) return null;
  const values: number[] = [];
  for (const v of Object.values(c)) {
    if (typeof v === "number") values.push(v);
  }
  return values.length ? Math.min(...values) : null;
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading, Panel, PanelHead, Pill } from "@/components/primitives";
import { Sparkle, X } from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { confidenceTone, dismissInsight, listInsights, pct, type Insight } from "@/lib/ai";

/**
 * Insights — a única camada da Academias AI onde há interpretação.
 *
 * Cada frase aqui nasceu de números com confiança suficiente, e os números vêm
 * agarrados (`data`) para serem auditáveis. Um insight dispensado não volta —
 * dispensar também é informação, e um dia treina o que vale a pena dizer.
 */
export default function AiInsights() {
  const { session } = useSession();
  const [rows, setRows] = useState<Insight[] | null>(null);
  const mayWrite = can(session, "ai:write");

  useEffect(() => {
    listInsights().then(setRows).catch(() => setRows([]));
  }, []);

  if (!rows) return <Loading />;

  const dismiss = async (id: string) => {
    await dismissInsight(id);
    setRows((prev) => prev?.filter((i) => i.id !== id) ?? null);
  };

  return (
    <>
      <PageHeader
        eyebrow="Academias AI"
        title="Insights"
        subtitle="Derivados dos jogos analisados — sempre com os números por trás."
      />

      <Panel>
        <PanelHead title="Ativos" hint={rows.length > 0 ? String(rows.length) : undefined} />
        {rows.length === 0 ? (
          <Empty
            icon={Sparkle}
            title="Ainda não há insights"
            detail="Nascem das análises concluídas, e só quando os dados têm confiança suficiente. É por isso que este ecrã começa vazio — nenhuma frase aqui será inventada."
          >
            <Link to="/ai/analises/nova" className="ctl-outline">
              Criar a primeira análise
            </Link>
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((i) => (
              <li key={i.id} className="flex items-start gap-3 px-5 py-4">
                <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
                  <Sparkle className="size-3.5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body leading-relaxed text-ink">{i.text}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-3">
                    {i.athleteName && <span>{i.athleteName}</span>}
                    {i.teamName && <span>{i.teamName}</span>}
                    <span>{shortDate(new Date(i.createdAt))}</span>
                    <Pill tone={confidenceTone(i.confidence)}>confiança {pct(i.confidence)}</Pill>
                    {i.analysisId && (
                      <Link to={`/ai/analises/${i.analysisId}`} className="text-signal-ink hover:underline">
                        Ver análise
                      </Link>
                    )}
                  </div>
                </div>
                {mayWrite && (
                  <button
                    type="button"
                    className="ctl-ghost shrink-0"
                    title="Dispensar este insight"
                    onClick={() => dismiss(i.id)}
                  >
                    <X className="size-4" strokeWidth={1.75} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

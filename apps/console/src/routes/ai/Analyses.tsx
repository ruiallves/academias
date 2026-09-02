import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Loading, Panel } from "@/components/primitives";
import { Plus } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { listAnalyses, type AnalysisRow } from "@/lib/ai";
import { AnalysesTable } from "./Overview";

/** Todas as análises — a lista completa por trás do "Ver todas" da Visão AI. */
export default function Analyses() {
  const { session } = useSession();
  const [rows, setRows] = useState<AnalysisRow[] | null>(null);

  useEffect(() => {
    listAnalyses().then(setRows).catch(() => setRows([]));
  }, []);

  if (!rows) return <Loading />;

  const mayWrite = can(session, "ai:write");

  return (
    <>
      <PageHeader
        eyebrow="Academias AI"
        title="Análises"
        subtitle="Cada jogo analisado: estado, revisões pendentes e confiança."
      >
        {mayWrite && (
          <Link to="/ai/analises/nova" className="ctl-primary gap-1.5">
            <Plus className="size-4" strokeWidth={2} />
            Nova análise
          </Link>
        )}
      </PageHeader>

      <Panel>
        <AnalysesTable rows={rows} mayWrite={mayWrite} />
      </Panel>
    </>
  );
}

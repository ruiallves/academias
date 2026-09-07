import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading, Panel } from "@/components/primitives";
import { Plus, TriangleAlert } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { listAnalyses, type AnalysisRow } from "@/lib/ai";
import { AnalysesTable } from "./Overview";

/** Todas as análises — a lista completa por trás do "Ver todas" da Visão AI. */
export default function Analyses() {
  const { session } = useSession();
  const [rows, setRows] = useState<AnalysisRow[] | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);

  /*
    Uma falha do servidor não é uma lista vazia.

    Isto era `.catch(() => setRows([]))`, e a lista vazia desenha "ainda não há
    nada" — a mensagem exactamente errada quando o que houve foi um 500. É o
    mesmo princípio que manda em toda a área: o vazio é uma afirmação, e só se
    faz quando é verdade.
  */
  const carregar = useCallback(() => {
    setFalhou(null);
    listAnalyses()
      .then(setRows)
      .catch((e: unknown) => setFalhou(e instanceof Error ? e.message : "Não foi possível carregar."));
  }, []);

  useEffect(carregar, [carregar]);

  if (!rows) {
    if (!falhou) return <Loading />;
    return (
      <Panel>
        <Empty icon={TriangleAlert} title="Não foi possível carregar" detail={falhou}>
          <button type="button" className="ctl-outline" onClick={carregar}>
            Tentar outra vez
          </button>
        </Empty>
      </Panel>
    );
  }

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

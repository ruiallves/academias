import { PageHeader } from "@/components/Shell";
import { Empty, Panel, Pill } from "@/components/primitives";
import { Failed } from "./Overview";
import { useApi } from "@/lib/query";
import type { AuditEntry } from "@/lib/types";

/**
 * O registo do que fazemos.
 *
 * Append-only: não há endpoint que apague uma entrada, e não deve haver. Um
 * registo que se pode limpar não é um registo — é uma sugestão.
 *
 * Sem filtro para esconder linhas de propósito. O dia em que se puder filtrar
 * acessos de suporte para fora do ecrã é o dia em que deixam de ser auditáveis.
 */
const LABEL: Record<string, string> = {
  "academy.create": "Criou academia",
  "invite.send": "Enviou convite",
  "support.start": "Entrou em modo de suporte",
  "subscription.change": "Alterou subscrição",
};

export default function Audit() {
  const { data, loading, error, reload } = useApi<AuditEntry[]>("/audit?limit=200");

  if (error) return <Failed message={error} onRetry={reload} />;

  return (
    <>
      <PageHeader title="Registo" subtitle="Tudo o que fazemos nas academias dos clientes fica aqui." />

      <Panel>
        {loading ? (
          <div className="h-[320px] animate-pulse bg-sunken/40" />
        ) : (data?.length ?? 0) === 0 ? (
          <Empty title="Sem registos" detail="Ainda não houve nenhuma operação na plataforma." />
        ) : (
          <ul>
            {data!.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-5 py-3 last:border-b-0">
                <span className="w-[130px] shrink-0 text-meta text-ink-4 tabular">
                  {new Date(e.createdAt).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>

                <span className="text-body font-medium text-ink">{LABEL[e.action] ?? e.action}</span>

                {e.detail?.slug != null && (
                  <span className="font-mono text-meta text-ink-3">{String(e.detail.slug)}</span>
                )}

                {e.action.startsWith("support.") && <Pill tone="warn">suporte</Pill>}

                <span className="ml-auto text-meta text-ink-3">{e.admin?.name ?? "—"}</span>
                {e.ip && <span className="font-mono text-[11px] text-ink-4">{e.ip}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

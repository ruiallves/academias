import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Loading, Monogram, Panel, Pill, cx, type Column } from "@/components/primitives";
import { SearchInput } from "@/components/filters";
import { Binoculars, Plus } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { NewProspectDialog } from "@/components/NewProspectDialog";
import {
  STAGE_LABEL,
  STAGE_ORDER,
  ageOf,
  listProspects,
  sinceLabel,
  type ProspectRow,
  type Stage,
} from "@/lib/scouting";

/**
 * A lista de trabalho do departamento.
 *
 * Ordenada pelo funil e, dentro de cada estado, por quem foi visto há mais tempo —
 * porque a pergunta que esta página responde não é "quem é o melhor?" (isso é a
 * comparação, e chega na fase seguinte) mas "de quem é que me esqueci?".
 *
 * O filtro por estado vive no endereço (`?estado=`), e não em estado local: é
 * assim que o corredor da visão geral consegue trazer alguém directamente para
 * aqui já filtrado, e que um scout pode guardar o link de "os meus trials".
 */
export default function Prospects() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const stage = (params.get("estado") as Stage | null) ?? null;

  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ProspectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setError(null);
    listProspects({ ...(stage ? { stage } : {}), ...(q.trim() ? { q: q.trim() } : {}) })
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível carregar."));
  }, [stage, q]);

  // Um instante de espera antes de perguntar ao servidor: sem isto, escrever
  // "Gonçalo" são sete pedidos, e o último pode chegar antes do penúltimo.
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const columns: Column<ProspectRow>[] = [
    {
      key: "name",
      header: "Prospecto",
      render: (p) => (
        <div className="flex items-center gap-2.5">
          <Monogram name={p.name} />
          <div className="min-w-0">
            <Link to={`/scouting/prospects/${p.id}`} className="block truncate text-body font-medium text-ink hover:underline">
              {p.name}
            </Link>
            <div className="truncate text-meta text-ink-3">
              {ageOf(p.birthdate)} anos
              {p.position && ` · ${p.position}`}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "club",
      header: "Clube actual",
      render: (p) => (
        <div className="min-w-0">
          <div className="truncate text-body text-ink-2">{p.currentClub ?? "—"}</div>
          {p.currentTeam && <div className="truncate text-meta text-ink-3">{p.currentTeam}</div>}
        </div>
      ),
    },
    {
      key: "stage",
      header: "Estado",
      render: (p) => <StagePill stage={p.stage} />,
    },
    {
      key: "seen",
      header: "Última observação",
      render: (p) => (
        <span className={cx("text-body", p.lastObservedAt ? "text-ink-2" : "text-ink-4")}>
          {sinceLabel(p.lastObservedAt)}
          <span className="text-meta text-ink-4">
            {" · "}
            {p.observations}
          </span>
        </span>
      ),
    },
    {
      key: "owner",
      header: "Responsável",
      render: (p) => <span className="text-body text-ink-3">{p.owner ?? "—"}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Scouting"
        title="Prospects"
        subtitle={rows ? `${rows.length} ${rows.length === 1 ? "prospecto" : "prospectos"}` : undefined}
      >
        <SearchInput value={q} onChange={setQ} placeholder="Procurar por nome" />
        {can(session, "scouting:write") && (
          <button type="button" className="ctl-primary" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" strokeWidth={2} />
            Novo prospecto
          </button>
        )}
      </PageHeader>

      {/* O funil como filtro. Um separador por estado é mais legível do que um
          menu, e mostra de passagem que estados existem. */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <FilterChip active={stage === null} onClick={() => setParams({})}>
          Todos
        </FilterChip>
        {STAGE_ORDER.map((s) => (
          <FilterChip key={s} active={stage === s} onClick={() => setParams({ estado: s })}>
            {STAGE_LABEL[s]}
          </FilterChip>
        ))}
      </div>

      <Panel>
        {error ? (
          <div>
            <Empty title="Não foi possível carregar" detail={error} />
          </div>
        ) : !rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <div>
            <Empty
              icon={Binoculars}
              title={stage ? `Ninguém em "${STAGE_LABEL[stage]}"` : "Ainda não há prospectos"}
              detail={
                stage
                  ? "Muda de estado ou limpa o filtro."
                  : "O primeiro nome que alguém trouxer de um torneio começa aqui."
              }
            />
          </div>
        ) : (
          <DataTable rows={rows} columns={columns} keyOf={(p) => p.id} />
        )}
      </Panel>

      {creating && (
        <NewProspectDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

export function StagePill({ stage }: { stage: Stage }) {
  // Recrutado é sucesso, dispensado é fim — as duas únicas semânticas do funil.
  // Tudo pelo meio é identidade, não estado, e usa a cor da academia.
  const tone = stage === "RECRUITED" ? "ok" : stage === "REJECTED" ? "neutral" : "signal";
  return <Pill tone={tone}>{STAGE_LABEL[stage]}</Pill>;
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
        active ? "border-transparent bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
      )}
    >
      {children}
    </button>
  );
}

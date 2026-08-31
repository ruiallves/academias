import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Loading, Panel, Pill, SelectField } from "@/components/primitives";
import { DeliverDialog } from "@/components/inventory/DeliverDialog";
import { ReturnDialog } from "@/components/inventory/ReturnDialog";
import { ArrowLeft, PackageOpen, Search, TriangleAlert, Undo2 } from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { listTeams } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { ASSIGNMENT_LABEL, listAssignments, listItems, type Assignment } from "@/lib/inventory";

/**
 * Equipamento atribuído — quem tem o quê.
 *
 * Abre no que **ainda está por devolver**, que é a pergunta que se faz a esta
 * lista: em Junho, quando se recolhe o material, é isto que se imprime. O
 * histórico completo — devolvido, danificado, perdido — está a um filtro de
 * distância, e é onde se responde a "quanto se perdeu esta época".
 */
export default function Deliveries() {
  const { session } = useSession();
  const podeEscrever = can(session, "inventory:write");
  const equipas = listTeams(session);

  const [rows, setRows] = useState<Assignment[] | null>(null);
  const [artigos, setArtigos] = useState<{ id: string; name: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [estado, setEstado] = useState("ACTIVE");
  const [equipa, setEquipa] = useState("");
  const [artigo, setArtigo] = useState("");
  const [q, setQ] = useState("");
  const [entregar, setEntregar] = useState(false);
  const [devolver, setDevolver] = useState<Assignment | null>(null);

  async function carregar() {
    setErro(null);
    try {
      setRows(await listAssignments({ status: estado }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar as entregas.");
    }
  }

  useEffect(() => {
    void carregar();
  }, [estado]);

  useEffect(() => {
    listItems()
      .then((i) => setArtigos(i.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => setArtigos([]));
  }, []);

  const filtrados = useMemo(() => {
    const termo = fold(q);
    return (rows ?? []).filter((a) => {
      if (equipa && a.teamId !== equipa) return false;
      if (artigo && a.itemId !== artigo) return false;
      if (termo && !fold(`${a.athleteName} ${a.itemName}`).includes(termo)) return false;
      return true;
    });
  }, [rows, q, equipa, artigo]);

  if (erro) return <Empty title="Equipamento atribuído" detail={erro} icon={TriangleAlert} />;
  if (!rows) return <Loading />;

  return (
    <>
      {/*
        A volta ao painel.

        A ficha do artigo já voltava aqui; daqui não se voltava a lado nenhum
        senão pelo menu — e quem entra em "Ver artigos" a partir do painel espera
        o caminho de volta no sítio onde o deixou.
      */}
      <Link
        to="/inventario"
        className="mb-3 inline-flex items-center gap-1.5 text-meta font-medium text-ink-3 hover:text-ink"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} />
        Inventário
      </Link>

      <PageHeader
        eyebrow="Inventário"
        title="Equipamento atribuído"
        subtitle="O que está com os atletas, e o que já voltou."
      >
        {podeEscrever && (
          <button type="button" className="ctl-primary" onClick={() => setEntregar(true)}>
            <PackageOpen className="size-3.5" strokeWidth={1.75} />
            Entregar equipamento
          </button>
        )}
      </PageHeader>

      <Panel className="mb-3">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Procurar atleta ou artigo…"
              className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pl-8 text-body text-ink placeholder:text-ink-4"
            />
          </div>
          <SelectField
            value={equipa}
            onChange={setEquipa}
            options={[{ value: "", label: "Todas as equipas" }, ...equipas.map((t) => ({ value: t.id, label: t.name }))]}
          />
          <SelectField
            value={artigo}
            onChange={setArtigo}
            options={[{ value: "", label: "Todos os artigos" }, ...artigos.map((a) => ({ value: a.id, label: a.name }))]}
          />
          <SelectField
            value={estado}
            onChange={setEstado}
            options={[
              { value: "ACTIVE", label: "Por devolver" },
              { value: "RETURNED", label: "Devolvido" },
              { value: "DAMAGED", label: "Danificado" },
              { value: "LOST", label: "Perdido" },
              { value: "all", label: "Tudo" },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <DataTable
          rows={filtrados}
          keyOf={(a) => a.id}
          empty={
            <Empty
              title={estado === "ACTIVE" ? "Nada por devolver" : "Sem registos"}
              detail={
                estado === "ACTIVE"
                  ? "Todo o equipamento entregue já voltou — ou ainda não se entregou nada."
                  : "Nenhuma entrega neste estado."
              }
              icon={PackageOpen}
            />
          }
          columns={[
            {
              key: "atleta",
              header: "Atleta",
              render: (a) => (
                <span className="min-w-0">
                  <Link
                    to={`/atletas/${a.athleteId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate font-medium text-ink hover:underline"
                  >
                    {a.athleteName}
                  </Link>
                  <span className="block truncate text-meta text-ink-3">{a.teamName ?? "Sem equipa"}</span>
                </span>
              ),
            },
            {
              key: "artigo",
              header: "Artigo",
              render: (a) => (
                <span className="min-w-0">
                  <span className="block truncate text-ink">{a.itemName}</span>
                  <span className="block truncate text-meta text-ink-3">{a.variantLabel}</span>
                </span>
              ),
            },
            { key: "qtd", header: "Qtd.", align: "right", render: (a) => <span className="tabular">{a.quantity}</span> },
            {
              key: "data",
              header: "Entregue",
              hideBelow: "sm",
              render: (a) => (
                <span className="text-ink-2">
                  {shortDate(new Date(a.assignedAt))}
                  {a.assignedBy && <span className="block text-meta text-ink-3">{a.assignedBy}</span>}
                </span>
              ),
            },
            {
              key: "estado",
              header: "Estado",
              render: (a) => (
                <Pill tone={a.status === "ACTIVE" ? "signal" : a.status === "RETURNED" ? "ok" : "risk"}>
                  {ASSIGNMENT_LABEL[a.status]}
                </Pill>
              ),
            },
            {
              key: "accao",
              header: "",
              align: "right",
              render: (a) =>
                podeEscrever && a.status === "ACTIVE" ? (
                  <button
                    type="button"
                    className="ctl-ghost h-7 text-meta"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDevolver(a);
                    }}
                  >
                    <Undo2 className="size-3.5" strokeWidth={1.75} />
                    Devolver
                  </button>
                ) : a.returnedAt ? (
                  <span className="text-meta text-ink-4">{shortDate(new Date(a.returnedAt))}</span>
                ) : null,
            },
          ]}
        />
      </Panel>

      {entregar && (
        <DeliverDialog
          onClose={() => setEntregar(false)}
          onDone={() => void carregar()}
        />
      )}

      {devolver && (
        <ReturnDialog
          assignment={devolver}
          onClose={() => setDevolver(null)}
          onDone={() => {
            setDevolver(null);
            void carregar();
          }}
        />
      )}
    </>
  );
}

function fold(v: string): string {
  return v.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}

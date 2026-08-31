import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Loading, Metric, MetricRow, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { DeliverDialog } from "@/components/inventory/DeliverDialog";
import { Boxes, PackageOpen, TriangleAlert } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { shortDate, time } from "@/lib/format";
import {
  MOVEMENT_LABEL,
  MOVEMENT_SIGN,
  STATUS_LABEL,
  STATUS_TONE,
  getOverview,
  listItems,
  listMovements,
  type Item,
  type Movement,
  type Overview,
} from "@/lib/inventory";

/**
 * O armazém, em três perguntas.
 *
 * "Quanto temos?", "o que está a acabar?" e "o que aconteceu hoje?". É a ordem
 * por que quem gere o material olha para isto — e a razão de a página abrir com
 * números e não com a lista completa de artigos, que vive na página ao lado.
 *
 * ## A entrega está no topo
 *
 * O botão de entregar é a acção mais repetida do módulo, muitas vezes feita ao
 * balcão com o atleta à frente. Fica no cabeçalho, à distância de um toque em
 * qualquer ecrã, em vez de dentro da ficha de um artigo — quem entrega começa
 * pela pessoa, não pelo artigo.
 */
export default function Inventory() {
  const { session } = useSession();
  const podeEscrever = can(session, "inventory:write");

  const [overview, setOverview] = useState<Overview | null>(null);
  const [baixos, setBaixos] = useState<Item[] | null>(null);
  const [movimentos, setMovimentos] = useState<Movement[] | null>(null);
  const [entregar, setEntregar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    setErro(null);
    try {
      const [o, itens, movs] = await Promise.all([getOverview(), listItems(), listMovements()]);
      setOverview(o);
      // O que precisa de atenção primeiro: esgotado antes de baixo.
      setBaixos(
        itens
          .filter((i) => i.status !== "ok")
          .sort((a, b) => (a.status === "out" ? -1 : 1) - (b.status === "out" ? -1 : 1)),
      );
      setMovimentos(movs.slice(0, 12));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o inventário.");
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  if (erro) return <Empty title="Inventário" detail={erro} icon={TriangleAlert} />;
  if (!overview || !baixos || !movimentos) return <Loading />;

  const vazio = overview.artigos === 0;

  return (
    <>
      <PageHeader title="Inventário" subtitle="Gerir equipamentos, materiais e atribuições do clube.">
        <Link to="/inventario/artigos" className="ctl-outline">
          Ver artigos
        </Link>
        {podeEscrever && !vazio && (
          <button type="button" className="ctl-primary" onClick={() => setEntregar(true)}>
            <PackageOpen className="size-3.5" strokeWidth={1.75} />
            Entregar equipamento
          </button>
        )}
      </PageHeader>

      {vazio ? (
        <Empty
          title="O armazém ainda está vazio"
          detail="Regista o primeiro artigo — uma t-shirt, um jogo de coletes, as bolas — com os tamanhos que o clube tem. O stock, as entregas e o histórico começam aí."
          icon={Boxes}
        >
          {podeEscrever && (
            <Link to="/inventario/artigos" className="ctl-primary">
              Adicionar artigo
            </Link>
          )}
        </Empty>
      ) : (
        <>
          <MetricRow>
            <Metric label="Artigos" value={String(overview.artigos)} icon={Boxes} />
            <Metric label="Unidades em stock" value={fmt(overview.unidades)} note="o que o clube tem" />
            <Metric label="Disponíveis" value={fmt(overview.disponiveis)} note="prontas a entregar" />
            <Metric label="Atribuídas" value={fmt(overview.atribuidas)} note="com atletas" />
            <Metric
              label="Stock baixo"
              value={String(overview.stockBaixo)}
              note={overview.stockBaixo ? "tamanhos a repor" : "nada por repor"}
              icon={overview.stockBaixo ? TriangleAlert : undefined}
            />
          </MetricRow>

          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <Panel>
              <PanelHead
                title="A repor"
                hint={baixos.length ? `${baixos.length} ${baixos.length === 1 ? "artigo" : "artigos"}` : "tudo em ordem"}
              >
                <Link to="/inventario/artigos?estado=low" className="ctl-ghost">
                  Ver todos
                </Link>
              </PanelHead>
              <DataTable
                rows={baixos.slice(0, 8)}
                keyOf={(i) => i.id}
                to={(i) => `/inventario/artigos/${i.id}`}
                empty={
                  <Empty
                    title="Nada a repor"
                    detail="Nenhum tamanho está abaixo do mínimo definido."
                    icon={Boxes}
                    compact
                  />
                }
                columns={[
                  {
                    key: "nome",
                    header: "Artigo",
                    render: (i) => (
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{i.name}</span>
                        <span className="block truncate text-meta text-ink-3">
                          {/* Os tamanhos em falta, que é o que se vai comprar. */}
                          {i.variants
                            .filter((v) => v.status !== "ok")
                            .map((v) => `${v.label} · ${v.available}`)
                            .join("  ·  ")}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "estado",
                    header: "Estado",
                    align: "right",
                    render: (i) => <Pill tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Pill>,
                  },
                ]}
              />
            </Panel>

            <Panel>
              <PanelHead title="Últimos movimentos" hint="quem mexeu, e no quê" />
              {movimentos.length === 0 ? (
                <Empty title="Ainda sem movimentos" detail="Dá entrada de stock ou entrega equipamento." icon={Boxes} compact />
              ) : (
                <ul className="divide-y divide-line">
                  {movimentos.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 px-5 py-2.5">
                      <span
                        className={cx(
                          "w-10 shrink-0 text-right text-body font-semibold tabular",
                          MOVEMENT_SIGN[m.type] === "+" ? "text-ok" : MOVEMENT_SIGN[m.type] === "−" ? "text-risk" : "text-ink-3",
                        )}
                      >
                        {MOVEMENT_SIGN[m.type]}
                        {m.quantity}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body text-ink">
                          {m.itemName} <span className="text-ink-3">· {m.variantLabel}</span>
                        </span>
                        <span className="block truncate text-meta text-ink-3">
                          {MOVEMENT_LABEL[m.type]}
                          {m.athleteName ? ` · ${m.athleteName}` : ""}
                          {m.by ? ` · ${m.by}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-meta text-ink-4 tabular">{quando(m.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}

      {entregar && (
        <DeliverDialog
          onClose={() => setEntregar(false)}
          onDone={() => {
            setEntregar(false);
            void carregar();
          }}
        />
      )}
    </>
  );
}

/** `12 out · 16:42` — a data e a hora que o histórico precisa, numa linha. */
function quando(iso: string): string {
  const d = new Date(iso);
  return `${shortDate(d)} · ${time(d)}`;
}

/** 1284 → "1 284". Espaço fino, como o resto dos números da consola. */
function fmt(n: number): string {
  return new Intl.NumberFormat("pt-PT").format(n);
}

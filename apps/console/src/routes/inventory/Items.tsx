import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Loading, Panel, Pill, SelectField, cx } from "@/components/primitives";
import { ImportItemsDialog } from "@/components/inventory/ImportItemsDialog";
import { NewItemDialog } from "@/components/inventory/NewItemDialog";
import { ArrowLeft, Boxes, Plus, Search, TriangleAlert, Upload } from "@/lib/icons";
import { useActiveCatalog } from "@/lib/catalogs";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { STATUS_LABEL, STATUS_TONE, listItems, type Item, type StockStatus } from "@/lib/inventory";

/**
 * A lista de artigos.
 *
 * ## Uma linha por artigo, não por tamanho
 *
 * Seis linhas de "T-shirt Aquecimento" não são uma lista, são um problema de
 * leitura. Cada linha soma os tamanhos e mostra o estado do **pior** deles: um
 * artigo com o M esgotado não está "disponível", por muitos XXL que tenha.
 * O detalhe por tamanho está a um clique.
 *
 * ## Os filtros vivem no endereço
 *
 * `?estado=low` chega do painel — "6 artigos com stock baixo" leva à lista já
 * filtrada. Uma lista que se filtra e não se pode partilhar por link obriga a
 * explicar por palavras onde está o problema.
 */
export default function Items() {
  const { session } = useSession();
  const podeEscrever = can(session, "inventory:write");
  const categorias = useActiveCatalog("inventoryCategories");

  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<Item[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [importar, setImportar] = useState(false);
  const [q, setQ] = useState("");

  const categoria = params.get("categoria") ?? "";
  const estado = (params.get("estado") ?? "") as StockStatus | "";
  const tamanho = params.get("tamanho") ?? "";

  async function carregar() {
    setErro(null);
    try {
      setRows(await listItems());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar os artigos.");
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  /** Os tamanhos que existem no clube — para o filtro não inventar opções. */
  const tamanhos = useMemo(() => {
    const set = new Set<string>();
    for (const i of rows ?? []) for (const v of i.variants) set.add(v.label);
    return [...set].sort((a, b) => a.localeCompare(b, "pt"));
  }, [rows]);

  const filtrados = useMemo(() => {
    const termo = fold(q);
    return (rows ?? []).filter((i) => {
      if (categoria && i.category?.id !== categoria) return false;
      if (estado && i.status !== estado) return false;
      if (tamanho && !i.variants.some((v) => v.label === tamanho)) return false;
      if (termo && !fold(`${i.name} ${i.sku ?? ""} ${i.brand ?? ""}`).includes(termo)) return false;
      return true;
    });
  }, [rows, q, categoria, estado, tamanho]);

  const mexer = (chave: string, valor: string) => {
    const p = new URLSearchParams(params);
    if (valor) p.set(chave, valor);
    else p.delete(chave);
    setParams(p, { replace: true });
  };

  if (erro) return <Empty title="Artigos" detail={erro} icon={TriangleAlert} />;
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
        title="Artigos"
        subtitle="Tudo o que o clube tem em armazém, com o stock de cada tamanho."
      >
        {podeEscrever && (
          <>
            <button type="button" className="ctl-outline" onClick={() => setImportar(true)}>
              <Upload className="size-3.5" strokeWidth={1.75} />
              Importar
            </button>
            <button type="button" className="ctl-primary" onClick={() => setNovo(true)}>
              <Plus className="size-3.5" strokeWidth={1.75} />
              Adicionar artigo
            </button>
          </>
        )}
      </PageHeader>

      <Panel className="mb-3">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Procurar artigo, referência ou marca…"
              className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pl-8 text-body text-ink placeholder:text-ink-4"
            />
          </div>
          <SelectField
            value={categoria}
            onChange={(v) => mexer("categoria", v)}
            options={[{ value: "", label: "Todas as categorias" }, ...categorias.map((c) => ({ value: c.id, label: c.label }))]}
          />
          {tamanhos.length > 0 && (
            <SelectField
              value={tamanho}
              onChange={(v) => mexer("tamanho", v)}
              options={[{ value: "", label: "Todos os tamanhos" }, ...tamanhos.map((t) => ({ value: t, label: t }))]}
            />
          )}
          <SelectField
            value={estado}
            onChange={(v) => mexer("estado", v)}
            options={[
              { value: "", label: "Todos os estados" },
              { value: "ok", label: "Disponível" },
              { value: "low", label: "Stock baixo" },
              { value: "out", label: "Esgotado" },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <DataTable
          rows={filtrados}
          keyOf={(i) => i.id}
          to={(i) => `/inventario/artigos/${i.id}`}
          empty={
            rows.length === 0 ? (
              <Empty
                title="Ainda não há artigos"
                detail="Regista o primeiro — uma t-shirt, um jogo de coletes, as bolas."
                icon={Boxes}
              />
            ) : (
              <Empty title="Nada com esses filtros" detail="Tenta outra categoria, tamanho ou estado." icon={Search} />
            )
          }
          columns={[
            {
              key: "artigo",
              header: "Artigo",
              render: (i) => (
                <span className="flex min-w-0 items-center gap-2.5">
                  {/* A fotografia, quando existe: num armazém reconhece-se pela
                      imagem antes de se ler o nome. */}
                  {i.thumbnail ? (
                    <img
                      src={i.thumbnail}
                      alt=""
                      loading="lazy"
                      className="size-8 shrink-0 rounded-[6px] border border-line object-cover"
                    />
                  ) : (
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-sunken text-ink-4">
                      <Boxes className="size-4" strokeWidth={1.5} />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{i.name}</span>
                    <span className="block truncate text-meta text-ink-3">
                      {[i.brand, i.sku].filter(Boolean).join(" · ") || i.category?.label || "—"}
                    </span>
                  </span>
                </span>
              ),
            },
            {
              key: "categoria",
              header: "Categoria",
              hideBelow: "lg",
              render: (i) => <span className="text-ink-2">{i.category?.label ?? "—"}</span>,
            },
            {
              key: "tamanhos",
              header: "Tamanhos",
              hideBelow: "md",
              render: (i) => (
                <span className="flex flex-wrap gap-1">
                  {i.variants.slice(0, 6).map((v) => (
                    <span
                      key={v.id}
                      title={`${v.available} disponíveis de ${v.total}`}
                      className={cx(
                        "rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular",
                        v.status === "out"
                          ? "bg-risk-soft text-risk"
                          : v.status === "low"
                            ? "bg-warn-soft text-warn"
                            : "bg-sunken text-ink-2",
                      )}
                    >
                      {v.label} {v.available}
                    </span>
                  ))}
                  {i.variants.length > 6 && <span className="text-meta text-ink-4">+{i.variants.length - 6}</span>}
                </span>
              ),
            },
            { key: "total", header: "Stock", align: "right", render: (i) => <span className="tabular">{i.total}</span> },
            {
              key: "disp",
              header: "Disponível",
              align: "right",
              render: (i) => <span className="tabular font-medium text-ink">{i.available}</span>,
            },
            {
              key: "atrib",
              header: "Atribuído",
              align: "right",
              hideBelow: "sm",
              render: (i) => <span className="tabular text-ink-2">{i.assigned}</span>,
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

      {importar && (
        <ImportItemsDialog
          onClose={() => setImportar(false)}
          onDone={() => void carregar()}
        />
      )}

      {novo && (
        <NewItemDialog
          onClose={() => setNovo(false)}
          onDone={() => {
            setNovo(false);
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

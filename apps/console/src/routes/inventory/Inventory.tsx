import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Loading, Monogram, Panel, SelectField, cx } from "@/components/primitives";
import { DeliverDialog } from "@/components/inventory/DeliverDialog";
import { ReturnDialog } from "@/components/inventory/ReturnDialog";
import { EditAssignmentDialog } from "@/components/inventory/EditAssignmentDialog";
import { ImportItemsDialog } from "@/components/inventory/ImportItemsDialog";
import { NewItemDialog } from "@/components/inventory/NewItemDialog";
import { PagamentoPill } from "@/components/inventory/PagamentoDaEntrega";
import { StockDialog } from "@/components/inventory/StockDialog";
import { EstadoDoStock, Miniatura, Sinal, TamanhosCompactos } from "@/components/inventory/Prateleira";
import { Boxes, LayoutGrid, List, PackageOpen, Plus, Search, TriangleAlert, Undo2, Upload } from "@/lib/icons";
import { useActiveCatalog } from "@/lib/catalogs";
import { athleteById, listTeams, naEquipa } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { longDate, money, shortDate, time } from "@/lib/format";
import {
  ASSIGNMENT_LABEL,
  MOVEMENT_LABEL,
  getOverview,
  listAssignments,
  listItems,
  listMovements,
  type Assignment,
  type Item,
  type Movement,
  type Overview,
  type Variant,
} from "@/lib/inventory";

/**
 * O Inventário, numa página.
 *
 * Eram três páginas (um painel de números, a lista de artigos e as entregas) e
 * a das entregas nem tinha caminho que lá levasse. Agora é um sítio só, com um
 * resumo por cima e quatro vistas, cada uma a responder a uma pergunta:
 *
 * - **Artigos**: o que o clube tem, em cartões com fotografia e os tamanhos à vista;
 * - **Com atletas**: quem tem o quê, agrupado por atleta (é assim que se recolhe);
 * - **A repor**: os tamanhos abaixo do mínimo, com o "Dar entrada" na linha;
 * - **Movimentos**: o que aconteceu, dia a dia.
 *
 * A vista e os filtros vivem no endereço (`?vista=atletas&equipa=…`), para se
 * poder mandar o link de uma lista já filtrada.
 *
 * Referências: a grelha com fotografia vem do Sortly, os tamanhos lado a lado da
 * ficha de variantes da Shopify, o "quem tem o quê" do GearLocker e os
 * separadores com contagem do Linear.
 */

type Vista = "artigos" | "atletas" | "repor" | "movimentos";
const VISTAS: Vista[] = ["artigos", "atletas", "repor", "movimentos"];
type Mexer = (chave: string | Record<string, string>, valor?: string) => void;

/** O filtro dos artigos sem tipo, que também têm de se poder encontrar. */
const SEM_TIPO = "sem-tipo";

/**
 * Os tipos (categorias de material) que têm artigos, pela ordem do catálogo do
 * clube; um tipo que já saiu do catálogo mas ainda tem artigos entra no fim.
 */
function tiposDosArtigos(itens: Item[], catalogo: { id: string; label: string }[]): { id: string; label: string }[] {
  const usados = new Map<string, string>();
  let semTipo = false;
  for (const i of itens) {
    if (i.category) usados.set(i.category.id, i.category.label);
    else semTipo = true;
  }
  const ordem = catalogo.filter((c) => usados.has(c.id)).map((c) => ({ id: c.id, label: c.label }));
  const fora = [...usados].filter(([id]) => !ordem.some((c) => c.id === id)).map(([id, label]) => ({ id, label }));
  return [...ordem, ...fora, ...(semTipo ? [{ id: SEM_TIPO, label: "Sem tipo" }] : [])];
}

export default function Inventory() {
  const { session } = useSession();
  const podeEscrever = can(session, "inventory:write");
  const [params, setParams] = useSearchParams();

  // `?estado=low` era o atalho antigo para os artigos a repor.
  const pedida = params.get("vista") as Vista | null;
  const vista: Vista = pedida && VISTAS.includes(pedida) ? pedida : params.get("estado") === "low" ? "repor" : "artigos";

  const [overview, setOverview] = useState<Overview | null>(null);
  const [itens, setItens] = useState<Item[] | null>(null);
  const [movimentos, setMovimentos] = useState<Movement[] | null>(null);
  const [ativos, setAtivos] = useState<Assignment[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [entregar, setEntregar] = useState(false);
  const [novo, setNovo] = useState(false);
  const [importar, setImportar] = useState(false);

  async function carregar() {
    setErro(null);
    try {
      const [o, i, m, a] = await Promise.all([
        getOverview(),
        listItems(),
        listMovements(),
        listAssignments({ status: "ACTIVE" }),
      ]);
      setOverview(o);
      setItens(i);
      setMovimentos(m);
      setAtivos(a);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o inventário.");
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  /** Muda de vista e larga os filtros da anterior, que não fazem sentido na nova. */
  const irPara = (v: Vista, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    if (v !== "artigos") p.set("vista", v);
    for (const [k, val] of Object.entries(extra)) p.set(k, val);
    setParams(p, { replace: true });
  };

  /** Muda um filtro (ou vários de uma vez, para o "Limpar filtros") no endereço. */
  const mexer: Mexer = (chave, valor = "") => {
    const p = new URLSearchParams(params);
    if (vista === "repor" || vista === "artigos") p.delete("estado");
    const mudancas = typeof chave === "string" ? { [chave]: valor } : chave;
    for (const [k, v] of Object.entries(mudancas)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };

  /** Os tamanhos abaixo do mínimo: esgotados primeiro, depois os que faltam mais. */
  const repor = useMemo(() => {
    const out: { item: Item; v: Variant }[] = [];
    for (const item of itens ?? []) for (const v of item.variants) if (v.status !== "ok") out.push({ item, v });
    return out.sort(
      (a, b) =>
        (a.v.status === "out" ? 0 : 1) - (b.v.status === "out" ? 0 : 1) ||
        b.v.minimumStock - b.v.available - (a.v.minimumStock - a.v.available),
    );
  }, [itens]);

  const atletasComMaterial = useMemo(() => new Set((ativos ?? []).map((a) => a.athleteId)).size, [ativos]);

  if (erro) return <Empty title="Inventário" detail={erro} icon={TriangleAlert} />;
  if (!overview || !itens || !movimentos || !ativos) return <Loading />;

  const vazio = itens.length === 0;

  return (
    <>
      <PageHeader title="Inventário" subtitle="O material do clube: o que está no armazém e o que está com os atletas.">
        {podeEscrever && (
          <>
            <button type="button" className="ctl-ghost" onClick={() => setImportar(true)}>
              <Upload className="size-3.5" strokeWidth={1.75} />
              Importar
            </button>
            {!vazio && (
              <button type="button" className="ctl-outline" onClick={() => setEntregar(true)}>
                <PackageOpen className="size-3.5" strokeWidth={1.75} />
                Entregar artigo
              </button>
            )}
            {/* Adicionar fica à direita e a preto: é o botão principal da página. */}
            <button type="button" className="ctl-primary" onClick={() => setNovo(true)}>
              <Plus className="size-3.5" strokeWidth={1.75} />
              Adicionar artigo
            </button>
          </>
        )}
      </PageHeader>

      {vazio ? (
        <Panel>
          <Empty
            title="O armazém ainda está vazio"
            detail="Regista o primeiro artigo (uma t-shirt, um jogo de coletes, as bolas) com os tamanhos que o clube tem, ou importa a folha do material de uma vez."
            icon={Boxes}
          >
            {podeEscrever && (
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className="ctl-outline" onClick={() => setImportar(true)}>
                  <Upload className="size-3.5" strokeWidth={1.75} />
                  Importar folha
                </button>
                <button type="button" className="ctl-primary" onClick={() => setNovo(true)}>
                  <Plus className="size-3.5" strokeWidth={1.75} />
                  Adicionar artigo
                </button>
              </div>
            )}
          </Empty>
        </Panel>
      ) : (
        <>
          <Resumo overview={overview} repor={repor.length} onVer={irPara} />

          <div className="mt-5 mb-3 overflow-x-auto">
            <div className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-sunken p-1" role="tablist" aria-label="Vistas do inventário">
              {(
                [
                  ["artigos", "Artigos", itens.length],
                  ["atletas", "Com atletas", atletasComMaterial],
                  ["repor", "A repor", repor.length],
                  ["movimentos", "Movimentos", null],
                ] as const
              ).map(([k, rotulo, n]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={vista === k}
                  onClick={() => irPara(k)}
                  className={cx(
                    "inline-flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-meta font-semibold whitespace-nowrap transition-colors duration-[120ms]",
                    vista === k ? "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.06)]" : "text-ink-3 hover:text-ink-2",
                  )}
                >
                  {rotulo}
                  {n !== null && (
                    <span className={cx("tabular", k === "repor" && n > 0 ? "text-warn" : "text-ink-4")}>{n}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {vista === "artigos" && <VistaArtigos itens={itens} params={params} mexer={mexer} />}
          {vista === "atletas" && (
            <VistaAtletas ativos={ativos} itens={itens} params={params} mexer={mexer} podeEscrever={podeEscrever} onChange={() => void carregar()} />
          )}
          {vista === "repor" && <VistaRepor linhas={repor} podeEscrever={podeEscrever} onChange={() => void carregar()} />}
          {vista === "movimentos" && <VistaMovimentos movimentos={movimentos} />}
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
      {importar && <ImportItemsDialog onClose={() => setImportar(false)} onDone={() => void carregar()} />}
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

/* -------------------------------------------------------------------------- */
/* Resumo                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * O armazém numa barra: o que está na prateleira e o que está com os atletas,
 * na proporção certa. Substitui as quatro caixas de números, que diziam a
 * mesma coisa duas vezes e não levavam a lado nenhum. Aqui cada número abre a
 * vista onde se trata dele.
 */
function Resumo({
  overview,
  repor,
  onVer,
}: {
  overview: Overview;
  repor: number;
  onVer: (v: Vista, extra?: Record<string, string>) => void;
}) {
  const total = Math.max(1, overview.disponiveis + overview.atribuidas);
  const pDisp = (overview.disponiveis / total) * 100;
  const pAtr = (overview.atribuidas / total) * 100;
  const baixas = overview.danificadas + overview.perdidas;

  return (
    <Panel className="p-5 max-sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="text-meta text-ink-3">Prontas a entregar</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-metric text-ink tabular">{fmt(overview.disponiveis)}</span>
            <span className="text-body text-ink-3">de {fmt(overview.unidades)} unidades</span>
          </p>
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <Numero rotulo="Com atletas" valor={fmt(overview.atribuidas)} onClick={() => onVer("atletas")} />
          <Numero
            rotulo="A repor"
            valor={String(repor)}
            nota={repor === 1 ? "tamanho" : "tamanhos"}
            tom={repor > 0 ? "warn" : undefined}
            onClick={() => onVer("repor")}
          />
          {baixas > 0 && (
            <Numero
              rotulo="Baixas"
              valor={String(baixas)}
              nota={`${overview.danificadas} danificadas · ${overview.perdidas} perdidas`}
              onClick={() => onVer("atletas", { estado: "all" })}
            />
          )}
        </dl>
      </div>

      <div className="mt-5 flex h-2 gap-0.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
        {pDisp > 0 && <span className="h-full rounded-full bg-ink" style={{ width: `${pDisp}%` }} />}
        {pAtr > 0 && <span className="h-full rounded-full bg-signal" style={{ width: `${pAtr}%` }} />}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-meta text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-ink" />
          Na prateleira <span className="font-medium text-ink-2 tabular">{fmt(overview.disponiveis)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-signal" />
          Com atletas <span className="font-medium text-ink-2 tabular">{fmt(overview.atribuidas)}</span>
        </span>
      </div>
    </Panel>
  );
}

function Numero({
  rotulo,
  valor,
  nota,
  tom,
  onClick,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  tom?: "warn";
  onClick: () => void;
}) {
  return (
    <div>
      <dt className="text-meta text-ink-3">{rotulo}</dt>
      <dd>
        <button
          type="button"
          onClick={onClick}
          className="group mt-0.5 inline-flex items-baseline gap-1.5 rounded-[4px] text-left"
        >
          <span className={cx("text-[20px] leading-tight font-semibold tabular group-hover:underline", tom === "warn" ? "text-warn" : "text-ink")}>
            {valor}
          </span>
          {nota && <span className="text-meta text-ink-3">{nota}</span>}
        </button>
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Artigos                                                                     */
/* -------------------------------------------------------------------------- */

const CHAVE_DO_MODO = "inventario.modo";

function lerModo(): "grelha" | "lista" {
  try {
    return localStorage.getItem(CHAVE_DO_MODO) === "lista" ? "lista" : "grelha";
  } catch {
    return "grelha";
  }
}

function VistaArtigos({
  itens,
  params,
  mexer,
}: {
  itens: Item[];
  params: URLSearchParams;
  mexer: Mexer;
}) {
  const categorias = useActiveCatalog("inventoryCategories");
  const [q, setQ] = useState("");
  const [modo, setModo] = useState<"grelha" | "lista">(lerModo);

  const categoria = params.get("categoria") ?? "";
  const tamanho = params.get("tamanho") ?? "";
  const estado = params.get("stock") ?? "";
  const marca = params.get("marca") ?? "";
  const algumFiltro = Boolean(q || categoria || tamanho || estado || marca);

  const mudarModo = (m: "grelha" | "lista") => {
    setModo(m);
    try {
      localStorage.setItem(CHAVE_DO_MODO, m);
    } catch {
      /* Sem armazenamento, fica só nesta visita. */
    }
  };

  /** Os tipos com artigos, pela ordem do catálogo do clube, e quantos tem cada um. */
  const tipos = useMemo(() => tiposDosArtigos(itens, categorias), [itens, categorias]);

  /** Tudo menos o tipo: a contagem de cada tipo responde aos outros filtros. */
  const semTipo = useMemo(() => {
    const termo = fold(q);
    return itens.filter((i) => {
      if (tamanho && !i.variants.some((v) => v.label === tamanho)) return false;
      if (estado && i.status !== estado) return false;
      if (marca && (i.brand ?? "") !== marca) return false;
      if (termo && !fold(`${i.name} ${i.sku ?? ""} ${i.brand ?? ""} ${i.category?.label ?? ""}`).includes(termo)) return false;
      return true;
    });
  }, [itens, q, tamanho, estado, marca]);

  const filtrados = useMemo(
    () => (categoria ? semTipo.filter((i) => (i.category?.id ?? SEM_TIPO) === categoria) : semTipo),
    [semTipo, categoria],
  );

  const tamanhos = useMemo(() => {
    const set = new Set<string>();
    for (const i of itens) for (const v of i.variants) set.add(v.label);
    return [...set].sort((a, b) => a.localeCompare(b, "pt", { numeric: true }));
  }, [itens]);

  const marcas = useMemo(
    () => [...new Set(itens.map((i) => i.brand?.trim()).filter((b): b is string => Boolean(b)))].sort((a, b) => a.localeCompare(b, "pt")),
    [itens],
  );

  const limpar = () => {
    setQ("");
    mexer({ categoria: "", tamanho: "", stock: "", marca: "" });
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CampoDeProcura value={q} onChange={setQ} placeholder="Procurar artigo, referência ou marca…" />
        {/* Cada tipo diz quantos artigos tem com os outros filtros aplicados. */}
        {tipos.length > 1 && (
          <SelectField
            aria-label="Tipo de material"
            value={categoria}
            onChange={(v) => mexer("categoria", v)}
            options={[
              { value: "", label: `Todos os tipos (${semTipo.length})` },
              ...tipos.map((t) => ({
                value: t.id,
                label: `${t.label} (${semTipo.filter((i) => (i.category?.id ?? SEM_TIPO) === t.id).length})`,
              })),
            ]}
          />
        )}
        {tamanhos.length > 1 && (
          <SelectField
            aria-label="Tamanho"
            value={tamanho}
            onChange={(v) => mexer("tamanho", v)}
            options={[{ value: "", label: "Todos os tamanhos" }, ...tamanhos.map((t) => ({ value: t, label: `Tamanho ${t}` }))]}
          />
        )}
        <SelectField
          aria-label="Estado do stock"
          value={estado}
          onChange={(v) => mexer("stock", v)}
          options={[
            { value: "", label: "Qualquer estado" },
            { value: "ok", label: "Disponível" },
            { value: "low", label: "Stock baixo" },
            { value: "out", label: "Esgotado" },
          ]}
        />
        {marcas.length > 1 && (
          <SelectField
            aria-label="Marca"
            value={marca}
            onChange={(v) => mexer("marca", v)}
            options={[{ value: "", label: "Todas as marcas" }, ...marcas.map((m) => ({ value: m, label: m }))]}
          />
        )}
        {algumFiltro && (
          <button type="button" className="ctl-ghost text-ink-3" onClick={limpar}>
            Limpar filtros
          </button>
        )}
        <div className="ml-auto inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-line bg-surface p-0.5">
          {(
            [
              ["grelha", "Grelha", LayoutGrid],
              ["lista", "Lista", List],
            ] as const
          ).map(([m, rotulo, Icone]) => (
            <button
              key={m}
              type="button"
              aria-label={rotulo}
              title={rotulo}
              aria-pressed={modo === m}
              onClick={() => mudarModo(m)}
              className={cx(
                "flex size-8 items-center justify-center rounded-[6px] transition-colors duration-[120ms]",
                modo === m ? "bg-sunken text-ink" : "text-ink-4 hover:text-ink-2",
              )}
            >
              <Icone className="size-4" strokeWidth={1.75} />
            </button>
          ))}
        </div>
      </div>

      {filtrados.length === 0 ? (
        <Panel>
          <Empty title="Nada com esses filtros" detail="Tenta outra palavra, categoria ou tamanho." icon={Search} compact />
        </Panel>
      ) : modo === "grelha" ? (
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,232px),1fr))]">
          {filtrados.map((i) => (
            <li key={i.id} className="min-w-0">
              <CartaoDoArtigo item={i} />
            </li>
          ))}
        </ul>
      ) : (
        <Panel>
          <DataTable
            rows={filtrados}
            keyOf={(i) => i.id}
            to={(i) => `/inventario/artigos/${i.id}`}
            columns={[
              {
                key: "artigo",
                header: "Artigo",
                primary: true,
                render: (i) => (
                  <span className="flex min-w-0 items-center gap-3">
                    <Miniatura src={i.thumbnail} className="size-9" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{i.name}</span>
                      <span className="block truncate text-meta text-ink-3">
                        {[i.category?.label, i.brand, i.sku].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                  </span>
                ),
              },
              {
                key: "tamanhos",
                header: "Disponíveis por tamanho",
                hideBelow: "md",
                render: (i) => <TamanhosCompactos variants={i.variants} max={7} />,
              },
              {
                key: "disp",
                header: "Prontas",
                align: "right",
                render: (i) => (
                  <span className="tabular">
                    <span className="font-medium text-ink">{i.available}</span>
                    <span className="text-ink-4"> / {i.total}</span>
                  </span>
                ),
              },
              {
                key: "atrib",
                header: "Com atletas",
                align: "right",
                hideBelow: "sm",
                render: (i) => <span className="tabular text-ink-2">{i.assigned}</span>,
              },
              { key: "estado", header: "Estado", align: "right", render: (i) => <EstadoDoStock status={i.status} /> },
            ]}
          />
        </Panel>
      )}
    </>
  );
}

/**
 * Um artigo em cartão: a fotografia, o nome e os tamanhos. Num armazém
 * reconhece-se a peça pela imagem antes de se ler o nome.
 */
function CartaoDoArtigo({ item }: { item: Item }) {
  return (
    <Link
      to={`/inventario/artigos/${item.id}`}
      className="panel group flex h-full flex-col overflow-hidden transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-[0_4px_14px_rgb(26_25_23/0.06)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <div className="aspect-[16/10] overflow-hidden border-b border-line bg-sunken">
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <span className="flex size-full items-center justify-center">
            <Miniatura className="size-14 bg-surface" />
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-ink">{item.name}</p>
          <p className="truncate text-meta text-ink-3">
            {[item.category?.label, item.brand].filter(Boolean).join(" · ") || "Sem categoria"}
          </p>
        </div>
        <TamanhosCompactos variants={item.variants} />
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-2.5 text-meta">
          <span className="text-ink-3">
            <span className="font-semibold text-ink tabular">{item.available}</span> prontas de{" "}
            <span className="tabular">{item.total}</span>
          </span>
          <EstadoDoStock status={item.status} quieto />
        </div>
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Com atletas                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Quem tem o quê, agrupado por atleta.
 *
 * Uma linha por entrega obrigava a ler o nome do mesmo atleta quatro vezes. Em
 * Junho, quando se recolhe o material, a pergunta é "o que é que o Tomás tem
 * de devolver?", e a resposta é um bloco por pessoa.
 */
function VistaAtletas({
  ativos,
  itens,
  params,
  mexer,
  podeEscrever,
  onChange,
}: {
  ativos: Assignment[];
  itens: Item[];
  params: URLSearchParams;
  mexer: Mexer;
  podeEscrever: boolean;
  onChange: () => void;
}) {
  const { session } = useSession();
  const equipas = listTeams(session);
  const categorias = useActiveCatalog("inventoryCategories");

  const estado = params.get("estado") ?? "ACTIVE";
  const equipa = params.get("equipa") ?? "";
  // "Por pagar" junta o que se cobra só no equipamento e o que se cobra na app.
  const pagamento = params.get("pagamento") === "app" ? "porPagar" : (params.get("pagamento") ?? "");
  const tipo = params.get("categoria") ?? "";
  const artigo = params.get("artigo") ?? "";
  const [q, setQ] = useState("");
  const algumFiltro = Boolean(q || equipa || pagamento || tipo || artigo);

  /** O tipo de cada artigo, para filtrar as entregas por tipo de material. */
  const tipoDoArtigo = useMemo(() => new Map(itens.map((i) => [i.id, i.category?.id ?? SEM_TIPO])), [itens]);
  const tipos = useMemo(() => tiposDosArtigos(itens, categorias), [itens, categorias]);
  /** Os artigos do tipo escolhido, para a lista de artigos não oferecer o que o tipo já tirou. */
  const artigos = useMemo(
    () => itens.filter((i) => !tipo || (i.category?.id ?? SEM_TIPO) === tipo).sort((a, b) => a.name.localeCompare(b.name, "pt")),
    [itens, tipo],
  );

  const [outros, setOutros] = useState<Assignment[] | null>(null);
  const [devolver, setDevolver] = useState<Assignment | null>(null);
  const [editar, setEditar] = useState<Assignment | null>(null);

  // "Por devolver" já veio com a página; os outros estados pedem-se quando se escolhem.
  useEffect(() => {
    if (estado === "ACTIVE") return;
    setOutros(null);
    listAssignments({ status: estado })
      .then(setOutros)
      .catch(() => setOutros([]));
  }, [estado, ativos]);

  const rows = estado === "ACTIVE" ? ativos : outros;

  const filtrados = useMemo(() => {
    const termo = fold(q);
    return (rows ?? []).filter((a) => {
      if (equipa) {
        // Pelo atleta, que pode estar em várias equipas; sem ficha, pela equipa da entrega.
        const atleta = athleteById(a.athleteId);
        if (atleta ? !naEquipa(atleta, equipa) : a.teamId !== equipa) return false;
      }
      if (tipo && tipoDoArtigo.get(a.itemId) !== tipo) return false;
      if (artigo && a.itemId !== artigo) return false;
      if (pagamento) {
        const e = a.pagamento?.estado ?? "nenhum";
        if (pagamento === "porPagar" ? e !== "porPagar" && e !== "app" : e !== pagamento) return false;
      }
      if (termo && !fold(`${a.athleteName} ${a.teamName ?? ""} ${a.itemName} ${a.variantLabel}`).includes(termo)) return false;
      return true;
    });
  }, [rows, q, equipa, pagamento, tipo, artigo, tipoDoArtigo]);

  const grupos = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of filtrados) m.set(a.athleteId, [...(m.get(a.athleteId) ?? []), a]);
    return [...m.values()].sort((a, b) => a[0].athleteName.localeCompare(b[0].athleteName, "pt"));
  }, [filtrados]);

  const totais = useMemo(() => {
    const t = { porPagar: { n: 0, cents: 0 }, pago: { n: 0, cents: 0 } };
    for (const a of filtrados) {
      const e = a.pagamento?.estado;
      const v = a.pagamento?.valorCents ?? 0;
      if (e === "porPagar" || e === "app") {
        t.porPagar.n++;
        t.porPagar.cents += v;
      }
      if (e === "pago") {
        t.pago.n++;
        t.pago.cents += v;
      }
    }
    return t;
  }, [filtrados]);

  const pecas = filtrados.reduce((s, a) => s + a.quantity, 0);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CampoDeProcura value={q} onChange={setQ} placeholder="Procurar atleta, equipa ou artigo…" />
        <SelectField
          aria-label="Equipa"
          value={equipa}
          onChange={(v) => mexer("equipa", v)}
          options={[{ value: "", label: "Todas as equipas" }, ...equipas.map((t) => ({ value: t.id, label: t.name }))]}
        />
        {tipos.length > 1 && (
          <SelectField
            aria-label="Tipo de material"
            value={tipo}
            // Mudar de tipo larga o artigo, que pode já não ser desse tipo.
            onChange={(v) => mexer({ categoria: v, artigo: "" })}
            options={[{ value: "", label: "Todos os tipos" }, ...tipos.map((t) => ({ value: t.id, label: t.label }))]}
          />
        )}
        <SelectField
          aria-label="Artigo"
          value={artigo}
          onChange={(v) => mexer("artigo", v)}
          options={[{ value: "", label: "Todos os artigos" }, ...artigos.map((i) => ({ value: i.id, label: i.name }))]}
        />
        <SelectField
          aria-label="Pagamento"
          value={pagamento}
          onChange={(v) => mexer("pagamento", v)}
          options={[
            { value: "", label: "Qualquer pagamento" },
            { value: "porPagar", label: "Por pagar" },
            { value: "pago", label: "Pago" },
            { value: "nenhum", label: "Sem pagamento" },
          ]}
        />
        <SelectField
          aria-label="Estado"
          value={estado}
          onChange={(v) => mexer("estado", v === "ACTIVE" ? "" : v)}
          options={[
            { value: "ACTIVE", label: "Por devolver" },
            { value: "RETURNED", label: "Devolvido" },
            { value: "DAMAGED", label: "Danificado" },
            { value: "LOST", label: "Perdido" },
            { value: "all", label: "Tudo" },
          ]}
        />
      </div>

      {rows === null ? (
        <Loading size="panel" />
      ) : grupos.length === 0 ? (
        <Panel>
          <Empty
            title={estado === "ACTIVE" && !algumFiltro ? "Nada por devolver" : "Sem registos"}
            detail={
              estado === "ACTIVE" && !algumFiltro
                ? "Todo o equipamento entregue já voltou, ou ainda não se entregou nada."
                : "Nenhuma entrega com esses filtros."
            }
            icon={PackageOpen}
            compact
          />
        </Panel>
      ) : (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-3 max-sm:px-3.5">
            <p className="text-meta text-ink-3">
              <span className="font-medium text-ink-2 tabular">{grupos.length}</span> {grupos.length === 1 ? "atleta" : "atletas"} ·{" "}
              <span className="font-medium text-ink-2 tabular">{pecas}</span> {pecas === 1 ? "peça" : "peças"}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {(
                [
                  ["porPagar", "Por pagar", totais.porPagar, "bg-warn"],
                  ["pago", "Pago", totais.pago, "bg-ok"],
                ] as const
              )
                .filter(([, , t]) => t.n > 0)
                .map(([chave, rotulo, t, cor]) => (
                  <button
                    key={chave}
                    type="button"
                    aria-pressed={pagamento === chave}
                    onClick={() => mexer("pagamento", pagamento === chave ? "" : chave)}
                    className={cx(
                      "inline-flex items-center gap-1.5 rounded-[4px] text-meta text-ink-3 hover:text-ink",
                      pagamento === chave && "font-semibold text-ink underline underline-offset-4",
                    )}
                  >
                    <span className={cx("size-1.5 rounded-full", cor)} />
                    {rotulo}
                    <span className="font-medium text-ink-2 tabular">{money(t.cents)}</span>
                  </button>
                ))}
            </div>
          </div>

          <ul className="divide-y divide-line">
            {grupos.map((lista) => {
              const a0 = lista[0];
              const atleta = athleteById(a0.athleteId);
              return (
                <li
                  key={a0.athleteId}
                  className="grid gap-x-6 gap-y-2 px-5 py-3.5 max-sm:px-3.5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
                >
                  <div className="flex min-w-0 items-center gap-2.5 self-start md:pt-1">
                    <Monogram name={a0.athleteName} photoUrl={atleta?.photoUrl} />
                    <span className="min-w-0">
                      <Link to={`/atletas/${a0.athleteId}`} className="block truncate text-body font-medium text-ink hover:underline">
                        {a0.athleteName}
                      </Link>
                      <span className="block truncate text-meta text-ink-3">{a0.teamName ?? "Sem equipa"}</span>
                    </span>
                  </div>
                  <ul className="min-w-0">
                    {lista.map((a) => (
                      <li
                        key={a.id}
                        className={cx(
                          "group flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] px-2 py-1.5 -mx-2",
                          podeEscrever && "cursor-pointer hover:bg-sunken",
                        )}
                        onClick={podeEscrever ? () => setEditar(a) : undefined}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-body text-ink">
                            {a.itemName}
                            <span className="text-ink-3"> · {a.variantLabel}</span>
                            {a.quantity > 1 && <span className="text-ink-3 tabular"> ×{a.quantity}</span>}
                          </span>
                          <span className="ml-2 text-meta text-ink-4 whitespace-nowrap">
                            {a.status === "ACTIVE" ? "desde" : ASSIGNMENT_LABEL[a.status].toLowerCase()}{" "}
                            {shortDate(new Date(a.status === "ACTIVE" ? a.assignedAt : (a.returnedAt ?? a.assignedAt)))}
                          </span>
                        </span>
                        <PagamentoPill p={a.pagamento} />
                        {podeEscrever && a.status === "ACTIVE" && (
                          <button
                            type="button"
                            className="ctl-ghost h-7 text-meta text-ink-3 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDevolver(a);
                            }}
                          >
                            <Undo2 className="size-3.5" strokeWidth={1.75} />
                            Devolver
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {editar && (
        <EditAssignmentDialog
          assignment={editar}
          onClose={() => setEditar(null)}
          onDone={() => {
            setEditar(null);
            onChange();
          }}
          onDevolver={() => {
            setDevolver(editar);
            setEditar(null);
          }}
        />
      )}
      {devolver && (
        <ReturnDialog
          assignment={devolver}
          onClose={() => setDevolver(null)}
          onDone={() => {
            setDevolver(null);
            onChange();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* A repor                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Os tamanhos abaixo do mínimo, um por linha: é a lista de compras. O "Dar
 * entrada" abre já em "Chegou" com o que falta para chegar ao mínimo.
 */
function VistaRepor({
  linhas,
  podeEscrever,
  onChange,
}: {
  linhas: { item: Item; v: Variant }[];
  podeEscrever: boolean;
  onChange: () => void;
}) {
  const [entrada, setEntrada] = useState<{ item: Item; v: Variant } | null>(null);

  if (linhas.length === 0) {
    return (
      <Panel>
        <Empty title="Nada a repor" detail="Nenhum tamanho está abaixo do mínimo definido." icon={Boxes} tone="ok" compact />
      </Panel>
    );
  }

  return (
    <Panel>
      <ul className="divide-y divide-line">
        {linhas.map(({ item, v }) => {
          const faltam = Math.max(1, v.minimumStock - v.available);
          return (
            <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 max-sm:px-3.5">
              <Link to={`/inventario/artigos/${item.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Miniatura src={item.thumbnail} className="size-10" />
                <span className="min-w-0">
                  <span className="block truncate text-body font-medium text-ink hover:underline">
                    {item.name} <span className="font-normal text-ink-3">· {v.label}</span>
                  </span>
                  <span className="block truncate text-meta text-ink-3">
                    {v.available} {v.available === 1 ? "pronta" : "prontas"} · mínimo {v.minimumStock}
                    {v.assigned > 0 && ` · ${v.assigned} com atletas`}
                  </span>
                </span>
              </Link>
              <span className="ml-auto flex items-center gap-4">
                <span className={cx("text-meta font-medium whitespace-nowrap", v.status === "out" ? "text-risk" : "text-warn")}>
                  {v.status === "out" ? "Esgotado" : `Faltam ${faltam}`}
                </span>
                {podeEscrever && (
                  <button type="button" className="ctl-outline" onClick={() => setEntrada({ item, v })}>
                    <Plus className="size-3.5" strokeWidth={1.75} />
                    Dar entrada
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {entrada && (
        <StockDialog
          variant={entrada.v}
          itemName={entrada.item.name}
          inicial="ENTRY"
          quantidadeInicial={Math.max(1, entrada.v.minimumStock - entrada.v.available)}
          onClose={() => setEntrada(null)}
          onDone={() => {
            setEntrada(null);
            onChange();
          }}
        />
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Movimentos                                                                  */
/* -------------------------------------------------------------------------- */

/** O que aconteceu, agrupado por dia, do mais recente para trás. */
function VistaMovimentos({ movimentos }: { movimentos: Movement[] }) {
  const dias = useMemo(() => {
    const m = new Map<string, Movement[]>();
    for (const mov of movimentos) {
      const d = new Date(mov.at);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      m.set(k, [...(m.get(k) ?? []), mov]);
    }
    return [...m.values()];
  }, [movimentos]);

  if (movimentos.length === 0) {
    return (
      <Panel>
        <Empty title="Ainda sem movimentos" detail="Dá entrada de stock ou entrega equipamento." icon={Boxes} compact />
      </Panel>
    );
  }

  return (
    <Panel>
      {dias.map((lista) => (
        <section key={lista[0].id} className="border-b border-line last:border-b-0">
          <h3 className="bg-sunken/50 px-5 py-2 text-meta font-semibold text-ink-2 max-sm:px-3.5">{nomeDoDia(new Date(lista[0].at))}</h3>
          <ul className="divide-y divide-line">
            {lista.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-5 py-2.5 max-sm:px-3.5">
                <Sinal tipo={m.type} n={m.quantity} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink">
                    {m.itemId ? (
                      <Link to={`/inventario/artigos/${m.itemId}`} className="hover:underline">
                        {m.itemName}
                      </Link>
                    ) : (
                      m.itemName
                    )}{" "}
                    <span className="text-ink-3">· {m.variantLabel}</span>
                  </span>
                  <span className="block truncate text-meta text-ink-3">
                    {[MOVEMENT_LABEL[m.type], m.athleteName, m.reason, m.by].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-meta text-ink-4 tabular">{time(new Date(m.at))}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Panel>
  );
}

function nomeDoDia(d: Date): string {
  const hoje = new Date();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  const mesmo = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (mesmo(d, hoje)) return "Hoje";
  if (mesmo(d, ontem)) return "Ontem";
  return d.getFullYear() === hoje.getFullYear() ? longDate(d) : `${longDate(d)} de ${d.getFullYear()}`;
}

/* -------------------------------------------------------------------------- */

function CampoDeProcura({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }): ReactNode {
  return (
    <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pl-8 text-body text-ink placeholder:text-ink-4"
      />
    </div>
  );
}

/** 1284 → "1 284". */
function fmt(n: number): string {
  return new Intl.NumberFormat("pt-PT").format(n);
}

function fold(v: string): string {
  return v.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}

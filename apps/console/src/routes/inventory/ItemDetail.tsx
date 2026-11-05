import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Empty, Loading, Monogram, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Interruptor } from "@/components/definicoes/ui";
import { DeleteItemDialog } from "@/components/inventory/DeleteItemDialog";
import { EditItemDialog } from "@/components/inventory/EditItemDialog";
import { DeliverDialog } from "@/components/inventory/DeliverDialog";
import { ReturnDialog } from "@/components/inventory/ReturnDialog";
import { ItemPhotos } from "@/components/inventory/ItemPhotos";
import { PagamentoPill } from "@/components/inventory/PagamentoDaEntrega";
import { StockDialog } from "@/components/inventory/StockDialog";
import { BarraDoTamanho, EstadoDoStock, Miniatura, Sinal } from "@/components/inventory/Prateleira";
import { ArrowLeft, Boxes, ExternalLink, PackageOpen, Pencil, Plus, ShoppingBag, Trash2, TriangleAlert, Undo2 } from "@/lib/icons";
import { athleteById } from "@/lib/api";
import { shortDate, time } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { useStore } from "@/lib/store";
import { mostrarOk } from "@/lib/avisos";
import type { ProdutoDoSite } from "@/lib/website";
import {
  MOVEMENT_LABEL,
  addVariant,
  getItem,
  listAssignments,
  porAVendaNoSite,
  tirarDoSite,
  updateVariant,
  textoDoPreco,
  type Assignment,
  type ItemDetail as Data,
  type Variant,
} from "@/lib/inventory";

/**
 * A ficha de um artigo.
 *
 * Os tamanhos aparecem em mosaico, um quadrado por tamanho com o que está
 * pronto a entregar em grande e a barra a dizer quanto falta para o mínimo:
 * lê-se o armazém de relance, como numa prateleira. Tocar num tamanho mexe no
 * stock dele; o lápis muda o nome.
 *
 * Por baixo, quem tem este artigo agora e o histórico, em separadores. A
 * coluna da direita fica para o que se mexe pouco: fotografias, a loja do
 * site e a descrição.
 */
export default function ItemDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const store = useStore();
  const podeEscrever = can(session, "inventory:write");

  const [data, setData] = useState<Data | null>(null);
  const [comAtletas, setComAtletas] = useState<Assignment[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [separador, setSeparador] = useState<"atletas" | "historico">("atletas");
  const [mexer, setMexer] = useState<Variant | null>(null);
  const [novoTamanho, setNovoTamanho] = useState(false);
  const [tirar, setTirar] = useState(false);
  const [editar, setEditar] = useState(false);
  const [entregar, setEntregar] = useState(false);
  const [renomear, setRenomear] = useState<Variant | null>(null);
  const [devolver, setDevolver] = useState<Assignment | null>(null);

  async function carregar() {
    setErro(null);
    try {
      const [d, a] = await Promise.all([getItem(id), listAssignments({ itemId: id, status: "ACTIVE" }).catch(() => [])]);
      setData(d);
      setComAtletas(a);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível abrir o artigo.");
    }
  }

  useEffect(() => {
    void carregar();
  }, [id]);

  if (erro) return <Empty title="Artigo" detail={erro} icon={TriangleAlert} />;
  if (!data) return <Loading />;

  const detalhe = [data.brand, data.sku, data.priceCents ? `${textoDoPreco(data.priceCents)} €` : null].filter(Boolean);

  return (
    <>
      <Link to="/inventario" className="mb-3 inline-flex items-center gap-1.5 text-meta font-medium text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" strokeWidth={1.75} />
        Inventário
      </Link>

      <header className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Miniatura src={data.images[0]?.url} className="size-16 rounded-[12px] border border-line max-sm:size-12" />
        <div className="min-w-0 flex-1">
          <p className="text-meta text-ink-3">{data.category?.label ?? "Sem categoria"}</p>
          <h1 className="truncate text-page text-ink">{data.name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-ink-3">
            {detalhe.length > 0 && <span className="tabular">{detalhe.join(" · ")}</span>}
            <EstadoDoStock status={data.status} />
          </p>
        </div>
        {podeEscrever && (
          <div className="flex shrink-0 items-center gap-2 max-md:w-full">
            <button
              type="button"
              className="ctl-primary"
              onClick={() => setEntregar(true)}
              disabled={data.available <= 0}
              title={data.available <= 0 ? "Sem stock disponível para entregar" : undefined}
            >
              <PackageOpen className="size-3.5" strokeWidth={1.75} />
              Entregar
            </button>
            <button type="button" className="ctl-outline" onClick={() => setEditar(true)}>
              <Pencil className="size-3.5" strokeWidth={1.75} />
              Editar
            </button>
            {/* Tirar do armazém fica no fim e discreto: é a única acção sem volta. */}
            <button
              type="button"
              aria-label="Tirar do armazém"
              title="Arquivar ou apagar"
              className="ctl-ghost size-8 justify-center px-0 text-ink-4 hover:bg-risk-soft hover:text-risk"
              onClick={() => setTirar(true)}
            >
              <Trash2 className="size-4" strokeWidth={1.75} />
            </button>
          </div>
        )}
      </header>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <Panel>
            <PanelHead title="Tamanhos" hint={`${data.available} prontas de ${data.total} · ${data.assigned} com atletas`}>
              {podeEscrever && (
                <button type="button" className="ctl-ghost" onClick={() => setNovoTamanho(true)}>
                  <Plus className="size-3.5" strokeWidth={1.75} />
                  Tamanho
                </button>
              )}
            </PanelHead>
            {data.variants.length === 0 ? (
              <Empty title="Sem tamanhos" detail="Junta o primeiro." icon={Boxes} compact />
            ) : (
              <ul className="grid gap-2 p-4 max-sm:p-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,132px),1fr))]">
                {data.variants.map((v) => (
                  <li key={v.id} className="min-w-0">
                    <Mosaico v={v} podeEscrever={podeEscrever} onStock={() => setMexer(v)} onRenomear={() => setRenomear(v)} />
                  </li>
                ))}
              </ul>
            )}
            {podeEscrever && data.variants.length > 0 && (
              <p className="border-t border-line px-5 py-2.5 text-meta text-ink-3 max-sm:px-3.5">
                Toca num tamanho para dar entrada, dar saída ou corrigir a contagem. O traço na barra é o mínimo.
              </p>
            )}
          </Panel>

          <Panel>
            <div className="flex items-center gap-1 border-b border-line px-3 py-2" role="tablist" aria-label="Movimento do artigo">
              {(
                [
                  ["atletas", "Com atletas", comAtletas.length],
                  ["historico", "Histórico", data.movements.length],
                ] as const
              ).map(([k, rotulo, n]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={separador === k}
                  onClick={() => setSeparador(k)}
                  className={cx(
                    "inline-flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-meta font-semibold transition-colors duration-[120ms]",
                    separador === k ? "bg-sunken text-ink" : "text-ink-3 hover:text-ink-2",
                  )}
                >
                  {rotulo}
                  <span className="text-ink-4 tabular">{n}</span>
                </button>
              ))}
            </div>

            {separador === "atletas" ? (
              comAtletas.length === 0 ? (
                <Empty title="Ninguém tem este artigo" detail="O que se entrega aparece aqui até ser devolvido." icon={PackageOpen} compact />
              ) : (
                <ul className="divide-y divide-line">
                  {comAtletas.map((a) => (
                    <li key={a.id} className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 max-sm:px-3.5">
                      <Monogram name={a.athleteName} photoUrl={athleteById(a.athleteId)?.photoUrl} size="sm" />
                      <span className="min-w-0 flex-1">
                        <Link to={`/atletas/${a.athleteId}`} className="text-body font-medium text-ink hover:underline">
                          {a.athleteName}
                        </Link>
                        <span className="ml-2 text-meta text-ink-3">
                          {a.variantLabel}
                          {a.quantity > 1 && ` ×${a.quantity}`} · desde {shortDate(new Date(a.assignedAt))}
                        </span>
                      </span>
                      <PagamentoPill p={a.pagamento} />
                      {podeEscrever && (
                        <button
                          type="button"
                          className="ctl-ghost h-7 text-meta text-ink-3 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                          onClick={() => setDevolver(a)}
                        >
                          <Undo2 className="size-3.5" strokeWidth={1.75} />
                          Devolver
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )
            ) : data.movements.length === 0 ? (
              <Empty title="Sem movimentos" detail="O histórico começa na primeira entrada." icon={Boxes} compact />
            ) : (
              <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">
                {data.movements.map((m) => (
                  <li key={m.id} className="flex items-start gap-3 px-5 py-2.5 max-sm:px-3.5">
                    <Sinal tipo={m.type} n={m.quantity} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink">
                        {MOVEMENT_LABEL[m.type]} <span className="text-ink-3">· {m.variantLabel}</span>
                      </span>
                      <span className="block truncate text-meta text-ink-3">
                        {[m.athleteName, m.reason, m.by].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    <span className="shrink-0 text-meta text-ink-4 tabular">
                      {shortDate(new Date(m.at))} · {time(new Date(m.at))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-3">
          <ItemPhotos itemId={id} images={data.images} editable={podeEscrever} onChange={() => void carregar()} />

          {/* A loja do site: só com o site no plano (`site` vem nulo sem ele). */}
          {store.academy.websiteIncluido && data.site !== null && (
            <LojaDoSite item={data} site={data.site} podePublicar={can(session, "website:write")} onChange={() => void carregar()} />
          )}

          {data.description && (
            <Panel>
              <PanelHead title="Descrição" />
              <p className="px-5 py-4 text-body leading-relaxed text-ink-2">{data.description}</p>
            </Panel>
          )}
        </div>
      </div>

      {mexer && (
        <StockDialog
          variant={mexer}
          onClose={() => setMexer(null)}
          onDone={() => {
            setMexer(null);
            void carregar();
          }}
        />
      )}

      {entregar && (
        <DeliverDialog
          itemId={data.id}
          onClose={() => setEntregar(false)}
          onDone={() => {
            setEntregar(false);
            void carregar();
          }}
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

      {editar && (
        <EditItemDialog
          item={data}
          onClose={() => setEditar(false)}
          onDone={() => {
            setEditar(false);
            void carregar();
          }}
        />
      )}

      {renomear && (
        <EditVariantDialog
          variant={renomear}
          onClose={() => setRenomear(null)}
          onDone={() => {
            setRenomear(null);
            void carregar();
          }}
        />
      )}

      {tirar && (
        <DeleteItemDialog
          item={data}
          onClose={() => setTirar(false)}
          onArchived={() => navigate("/inventario")}
          onDeleted={() => navigate("/inventario")}
        />
      )}

      {novoTamanho && (
        <NewVariantDialog
          itemId={id}
          onClose={() => setNovoTamanho(false)}
          onDone={() => {
            setNovoTamanho(false);
            void carregar();
          }}
        />
      )}
    </>
  );
}

/**
 * Um tamanho em quadrado: o que está pronto em grande, o total ao lado, a
 * barra com o mínimo marcado. O quadrado inteiro abre o stock; o lápis, que
 * fica por cima, muda o nome. Mudar quantas há e mudar como se chama são
 * coisas diferentes, e cada uma tem o seu alvo.
 */
function Mosaico({
  v,
  podeEscrever,
  onStock,
  onRenomear,
}: {
  v: Variant;
  podeEscrever: boolean;
  onStock: () => void;
  onRenomear: () => void;
}) {
  const baixas = v.damaged + v.lost;
  return (
    <div
      className={cx(
        "group relative flex h-full flex-col gap-2 rounded-[10px] border p-3 transition-colors duration-[120ms]",
        v.status === "out" ? "border-risk/30 bg-risk-soft/40" : v.status === "low" ? "border-warn/30 bg-warn-soft/40" : "border-line",
        podeEscrever && "hover:border-line-strong",
      )}
    >
      {podeEscrever && (
        <button
          type="button"
          onClick={onStock}
          aria-label={`Mexer no stock do tamanho ${v.label}`}
          className="absolute inset-0 rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-body font-semibold text-ink">{v.label}</span>
        {podeEscrever && (
          <button
            type="button"
            aria-label={`Editar o tamanho ${v.label}`}
            onClick={onRenomear}
            className="relative z-10 -m-1 flex size-7 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink-2 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          >
            <Pencil className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>
      <p className="flex items-baseline gap-1">
        <span
          className={cx(
            "text-[24px] leading-none font-semibold tabular",
            v.status === "out" ? "text-risk" : v.status === "low" ? "text-warn" : "text-ink",
          )}
        >
          {v.available}
        </span>
        <span className="text-meta text-ink-3 tabular">de {v.total}</span>
      </p>
      <BarraDoTamanho v={v} />
      <p className="text-[11px] leading-snug text-ink-3">
        {v.assigned > 0 ? `${v.assigned} com atletas` : "nenhum com atletas"}
        {v.minimumStock > 0 && ` · mín. ${v.minimumStock}`}
        {baixas > 0 && <span className="block">{`${v.damaged} danificadas · ${v.lost} perdidas`}</span>}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A loja do site                                                               */
/* -------------------------------------------------------------------------- */

const euro = (v: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);

const CATEGORIAS_DA_LOJA = ["Equipamento", "Roupa", "Adeptos"];

/**
 * O artigo na loja do site do clube.
 *
 * É daqui que um artigo do armazém vai para a loja, e não da secção Loja do
 * Website: o produto fica preso ao artigo, e os tamanhos e o esgotado saem do
 * stock disponível em vez de se escreverem à mão. Pôr à venda, mudar o preço
 * e tirar são decisões de publicar, e pedem `website:write`; quem só tem o
 * inventário vê o estado e nada mais.
 */
function LojaDoSite({
  item,
  site,
  podePublicar,
  onChange,
}: {
  item: Data;
  site: NonNullable<Data["site"]>;
  podePublicar: boolean;
  onChange: () => void;
}) {
  const [editar, setEditar] = useState(false);
  const [tirar, setTirar] = useState(false);
  const [aMudarVisivel, setAMudarVisivel] = useState(false);
  const produto = site.aVenda ? site.produto : null;

  const mudarVisivel = async () => {
    if (!produto || aMudarVisivel) return;
    setAMudarVisivel(true);
    try {
      await porAVendaNoSite(item.id, { preco: produto.preco, visivel: !produto.visivel });
      onChange();
    } catch {
      // O erro já apareceu no cartão de erros.
    } finally {
      setAMudarVisivel(false);
    }
  };

  return (
    <Panel>
      <PanelHead title="Loja do site" hint={produto ? (produto.visivel ? "à venda" : "escondido") : "por vender"}>
        {produto && (
          <Link to="/website?secao=loja" className="ctl-ghost">
            <ShoppingBag className="size-3.5" strokeWidth={1.75} />
            Loja
            <ExternalLink className="size-3" strokeWidth={1.75} />
          </Link>
        )}
      </PanelHead>

      {!produto ? (
        <div className="space-y-3 px-5 py-4">
          <p className="text-body leading-relaxed text-ink-2">
            Este artigo não está na loja do site. À venda, os tamanhos e o esgotado saem do stock disponível de cada tamanho.
          </p>
          {podePublicar && (
            <button type="button" className="ctl-primary" onClick={() => setEditar(true)}>
              <ShoppingBag className="size-3.5" strokeWidth={1.75} />
              Pôr à venda no site
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3 px-5 py-4">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-meta">
            <dt className="text-ink-3">Preço</dt>
            <dd className="font-medium tabular text-ink">{euro(produto.preco)}</dd>
            <dt className="text-ink-3">Categoria</dt>
            <dd className="text-ink">{produto.categoria}</dd>
            <dt className="text-ink-3">Tamanhos</dt>
            <dd className="text-ink">{produto.tamanhos || "—"}</dd>
            {produto.esgotado && (
              <>
                <dt className="text-ink-3">Stock</dt>
                <dd>
                  <Pill tone="risk">Esgotado</Pill>
                </dd>
              </>
            )}
          </dl>
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-body text-ink">Visível na loja</span>
              <span className="block text-meta text-ink-3">Escondido, fica guardado mas não aparece no site.</span>
            </span>
            <Interruptor ligado={produto.visivel} onChange={() => void mudarVisivel()} disabled={!podePublicar || aMudarVisivel} label="Visível na loja do site" />
          </div>
          <p className="text-meta leading-relaxed text-ink-3">Os tamanhos e o esgotado saem do stock disponível de cada tamanho; mudam aqui no armazém, não na loja.</p>
          {podePublicar && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="ctl-outline" onClick={() => setEditar(true)}>
                <Pencil className="size-3.5" strokeWidth={1.75} />
                Editar
              </button>
              <button type="button" className="ctl-ghost text-risk" onClick={() => setTirar(true)}>
                <Trash2 className="size-3.5" strokeWidth={1.75} />
                Tirar do site
              </button>
            </div>
          )}
        </div>
      )}

      {editar && (
        <ProdutoDoSiteDialog
          item={item}
          produto={produto}
          onClose={() => setEditar(false)}
          onDone={() => {
            setEditar(false);
            onChange();
          }}
        />
      )}

      {tirar && (
        <ConfirmDialog
          title="Tirar da loja do site?"
          confirmLabel="Tirar do site"
          onClose={() => setTirar(false)}
          onConfirm={async () => {
            await tirarDoSite(item.id);
            mostrarOk("Artigo tirado da loja do site.");
            setTirar(false);
            onChange();
          }}
        >
          «{item.name}» sai da loja do site. O artigo e o stock ficam como estão no armazém. Para o esconder só por uns tempos, desliga o
          visível em vez de o tirar.
        </ConfirmDialog>
      )}
    </Panel>
  );
}

/** Pôr à venda, ou mudar o que já está: o preço, a categoria e a descrição. O nome é o do artigo. */
function ProdutoDoSiteDialog({
  item,
  produto,
  onClose,
  onDone,
}: {
  item: Data;
  produto: ProdutoDoSite | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [preco, setPreco] = useState(produto ? String(produto.preco).replace(".", ",") : "");
  const [categoria, setCategoria] = useState(produto?.categoria ?? CATEGORIAS_DA_LOJA[0]);
  // A descrição começa pela do artigo: é quase sempre a mesma frase.
  const [descricao, setDescricao] = useState(produto?.descricao ?? item.description ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valor = Number(preco.replace(",", "."));
  const valido = preco.trim() !== "" && Number.isFinite(valor) && valor >= 0;

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await porAVendaNoSite(item.id, {
        preco: Math.round(valor * 100) / 100,
        categoria,
        descricao: descricao.trim(),
        ...(produto ? { visivel: produto.visivel } : {}),
      });
      mostrarOk(produto ? "Produto guardado." : "Artigo à venda no site.");
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="produto-do-site"
      title={produto ? "Editar na loja do site" : "Pôr à venda no site"}
      subtitle={item.name}
      icon={<ShoppingBag className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="form-produto-do-site" className="ctl-primary" disabled={!valido || busy}>
            {busy ? "A guardar…" : produto ? "Guardar" : "Pôr à venda"}
          </button>
        </>
      }
    >
      <form id="form-produto-do-site" onSubmit={submeter} className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Preço (€)">
            <input inputMode="decimal" placeholder="39,90" value={preco} onChange={(e) => setPreco(e.target.value)} className={cx(dialogInputClass, "tabular")} autoFocus />
          </DialogField>
          <DialogField label="Categoria">
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={dialogInputClass}>
              {[...new Set([...CATEGORIAS_DA_LOJA, categoria])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </DialogField>
        </div>
        <DialogField label="Descrição" hint="o que o site mostra">
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} className={cx(dialogInputClass, "h-24 py-2")} />
        </DialogField>
        <p className="text-meta leading-relaxed text-ink-3">
          O nome e a primeira fotografia são os do artigo. Os tamanhos e o esgotado saem do stock disponível de cada tamanho.
        </p>
        {erro && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function NewVariantDialog({ itemId, onClose, onDone }: { itemId: string; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [minimo, setMinimo] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await addVariant(itemId, {
        label: label.trim(),
        quantity: Number(quantity) || 0,
        ...(minimo.trim() ? { minimumStock: Number(minimo) } : {}),
      });
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível juntar o tamanho.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="novo-tamanho"
      title="Novo tamanho"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-tamanho" className="ctl-primary" disabled={!label.trim() || busy}>
            {busy ? "A juntar…" : "Juntar"}
          </button>
        </>
      }
    >
      <form id="form-tamanho" onSubmit={submeter} className="space-y-4 p-5">
        <div className="grid grid-cols-3 gap-3">
          <DialogField label="Tamanho">
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={dialogInputClass} autoFocus />
          </DialogField>
          <DialogField label="Quantas há">
            <input
              type="number"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={cx(dialogInputClass, "tabular")}
            />
          </DialogField>
          <DialogField label="Mínimo">
            <input
              type="number"
              min={0}
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
              className={cx(dialogInputClass, "tabular")}
            />
          </DialogField>
        </div>

        {erro && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/**
 * Editar um tamanho: como se chama, o código e o mínimo dele.
 *
 * O mínimo em branco herda o do artigo — é o que quase todos os clubes querem,
 * e é por isso que a dica o diz em vez de o campo nascer preenchido com um
 * número que ninguém escolheu.
 *
 * As quantidades não estão aqui: são o outro diálogo, o que deixa movimento.
 */
function EditVariantDialog({ variant, onClose, onDone }: { variant: Variant; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState(variant.label);
  const [sku, setSku] = useState(variant.sku ?? "");
  const [minimo, setMinimo] = useState(variant.ownMinimum === null ? "" : String(variant.ownMinimum));
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await updateVariant(variant.id, {
        label: label.trim(),
        sku: sku.trim(),
        // Vazio volta a herdar o do artigo; um número fixa-o só neste tamanho.
        ...(minimo.trim() ? { minimumStock: Number(minimo) } : {}),
      });
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="editar-tamanho"
      title={`Editar ${variant.label}`}
      subtitle={`${variant.total} unidades · ${variant.assigned} com atletas`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="form-editar-tamanho" className="ctl-primary" disabled={!label.trim() || busy}>
            {busy ? "A guardar…" : "Guardar"}
          </button>
        </>
      }
    >
      <form id="form-editar-tamanho" onSubmit={submeter} className="space-y-4 p-5">
        <div className="grid grid-cols-3 gap-3">
          <DialogField label="Tamanho">
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={dialogInputClass} autoFocus />
          </DialogField>
          <DialogField label="Referência" hint="opcional">
            <input value={sku} onChange={(e) => setSku(e.target.value)} className={dialogInputClass} />
          </DialogField>
          <DialogField label="Mínimo" hint="vazio = o do artigo">
            <input
              type="number"
              min={0}
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
              placeholder={String(variant.minimumStock)}
              className={cx(dialogInputClass, "tabular")}
            />
          </DialogField>
        </div>

        <p className="text-meta leading-relaxed text-ink-3">
          As quantidades mexem-se clicando na linha — cada entrada, saída ou contagem fica no histórico.
        </p>

        {erro && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}
      </form>
    </Dialog>
  );
}

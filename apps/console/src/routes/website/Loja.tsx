import { useState } from "react";
import { Pencil, Plus, ShoppingBag, Trash2, PackageOpen } from "@/lib/icons";
import { Empty, cx } from "@/components/primitives";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Interruptor } from "@/components/definicoes/ui";
import { useStore } from "@/lib/store";
import { gravarSite, novoId, useSite, type ProdutoDoSite } from "@/lib/website";
import { mostrarOk } from "@/lib/avisos";

const euro = (v: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);

const CATEGORIAS = ["Equipamento", "Roupa", "Adeptos"];

/**
 * A loja do site: produtos com foto, preço e tamanhos; visível ou não; esgotado.
 *
 * As encomendas chegam com o pagamento (euPago, pelo canal do clube) e com a
 * API: até lá a lista delas diz isso, em vez de fingir que está vazia.
 */
export function Loja() {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);
  const [aberto, setAberto] = useState<ProdutoDoSite | "novo" | null>(null);
  const [apagar, setApagar] = useState<ProdutoDoSite | null>(null);

  const mudar = (id: string, f: (p: ProdutoDoSite) => ProdutoDoSite) =>
    gravarSite(slug, (s) => ({ ...s, produtos: s.produtos.map((p) => (p.id === id ? f(p) : p)) }));

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-panel text-ink">Produtos</h3>
          <button type="button" className="ctl-primary" onClick={() => setAberto("novo")}>
            <Plus className="size-4" strokeWidth={2} />
            Novo produto
          </button>
        </div>

        {site.produtos.length === 0 ? (
          <Empty icon={ShoppingBag} title="A loja está vazia" detail="Os produtos visíveis aparecem na loja do site e na página de início." />
        ) : (
          <ul className="overflow-hidden rounded-[12px] border border-line bg-surface">
            {site.produtos.map((p) => (
              <li key={p.id} className={cx("flex items-center gap-3 border-b border-line px-3 py-3 last:border-b-0 sm:gap-4 sm:px-4", !p.visivel && "opacity-60")}>
                <div className="h-14 w-12 shrink-0 overflow-hidden rounded-[8px] bg-sunken">
                  {p.imagem && <img src={p.imagem} alt="" className="size-full object-cover" loading="lazy" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-meta text-ink-3">
                    {p.categoria}
                    {p.esgotado && <span className="rounded-full bg-risk-soft px-1.5 py-px text-[11px] font-medium text-risk">Esgotado</span>}
                    {!p.visivel && <span className="rounded-full bg-sunken px-1.5 py-px text-[11px] font-medium text-ink-3">Escondido</span>}
                  </p>
                  <p className="truncate text-body font-medium text-ink">{p.nome}</p>
                  {p.tamanhos && <p className="truncate text-meta text-ink-4">{p.tamanhos}</p>}
                </div>
                <span className="shrink-0 text-body font-medium tabular-nums text-ink">{euro(p.preco)}</span>
                <Interruptor ligado={p.visivel} onChange={() => mudar(p.id, (x) => ({ ...x, visivel: !x.visivel }))} label={`Mostrar ${p.nome} no site`} />
                <button type="button" onClick={() => setAberto(p)} aria-label="Editar" className="ctl-ghost size-9 shrink-0 justify-center px-0">
                  <Pencil className="size-4" strokeWidth={1.75} />
                </button>
                <button type="button" onClick={() => setApagar(p)} aria-label="Apagar" className="ctl-ghost size-9 shrink-0 justify-center px-0 text-risk">
                  <Trash2 className="size-4" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-4 text-panel text-ink">Encomendas</h3>
        <Empty
          icon={PackageOpen}
          title="As encomendas chegam com o pagamento"
          detail="Quando a loja receber pagamentos (MB WAY, Multibanco e cartão, pelo canal euPago do clube), cada encomenda aparece aqui para preparar e entregar."
          compact
        />
      </div>

      {aberto && (
        <EditarProduto
          inicial={aberto === "novo" ? null : aberto}
          onClose={() => setAberto(null)}
          onGuardar={(p) => {
            gravarSite(slug, (s) => ({
              ...s,
              produtos: s.produtos.some((x) => x.id === p.id) ? s.produtos.map((x) => (x.id === p.id ? p : x)) : [...s.produtos, p],
            }));
            mostrarOk("Produto guardado.");
            setAberto(null);
          }}
        />
      )}

      {apagar && (
        <ConfirmDialog
          title="Apagar o produto?"
          onClose={() => setApagar(null)}
          onConfirm={() => {
            gravarSite(slug, (s) => ({ ...s, produtos: s.produtos.filter((x) => x.id !== apagar.id) }));
            mostrarOk("Produto apagado.");
            setApagar(null);
          }}
        >
          «{apagar.nome}» sai da loja. Para o tirar só por uns tempos, desliga-o em vez de o apagar.
        </ConfirmDialog>
      )}
    </div>
  );
}

function EditarProduto({
  inicial,
  onClose,
  onGuardar,
}: {
  inicial: ProdutoDoSite | null;
  onClose: () => void;
  onGuardar: (p: ProdutoDoSite) => void;
}) {
  const [p, setP] = useState<ProdutoDoSite>(
    inicial ?? { id: novoId(), nome: "", categoria: "Equipamento", preco: 0, imagem: "", descricao: "", tamanhos: "", esgotado: false, visivel: true },
  );
  const [preco, setPreco] = useState(inicial ? String(inicial.preco).replace(".", ",") : "");
  const valor = Number(preco.replace(",", "."));
  const pronto = p.nome.trim() && preco.trim() && Number.isFinite(valor) && valor >= 0;

  return (
    <Dialog
      title={inicial ? "Editar produto" : "Novo produto"}
      icon={<ShoppingBag className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!pronto} onClick={() => onGuardar({ ...p, nome: p.nome.trim(), preco: Math.round(valor * 100) / 100 })}>
            Guardar
          </button>
        </>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <DialogField label="Nome">
          <input className={dialogInputClass} value={p.nome} onChange={(e) => setP({ ...p, nome: e.target.value })} autoFocus />
        </DialogField>
        <div className="grid gap-4 sm:grid-cols-2">
          <DialogField label="Categoria">
            <select className={dialogInputClass} value={p.categoria} onChange={(e) => setP({ ...p, categoria: e.target.value })}>
              {[...new Set([...CATEGORIAS, p.categoria])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </DialogField>
          <DialogField label="Preço (€)">
            <input className={dialogInputClass} inputMode="decimal" placeholder="39,90" value={preco} onChange={(e) => setPreco(e.target.value)} />
          </DialogField>
        </div>
        <DialogField label="Tamanhos" hint="Separados por vírgulas. Vazio num produto sem tamanhos.">
          <input className={dialogInputClass} placeholder="S, M, L, XL" value={p.tamanhos} onChange={(e) => setP({ ...p, tamanhos: e.target.value })} />
        </DialogField>
        <DialogField label="Descrição">
          <textarea className={cx(dialogInputClass, "h-24 py-2")} value={p.descricao} onChange={(e) => setP({ ...p, descricao: e.target.value })} />
        </DialogField>
        <DialogField label="Foto (endereço)" hint="O carregamento de fotos chega com a API do site.">
          <input className={dialogInputClass} type="url" placeholder="https://…" value={p.imagem} onChange={(e) => setP({ ...p, imagem: e.target.value })} />
        </DialogField>
        <div className="flex items-center justify-between gap-3 rounded-[8px] border border-line px-3 py-2.5">
          <span className="text-body text-ink">Esgotado</span>
          <Interruptor ligado={p.esgotado} onChange={() => setP({ ...p, esgotado: !p.esgotado })} label="Esgotado" />
        </div>
      </div>
    </Dialog>
  );
}

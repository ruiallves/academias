import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Boxes, ImagePlus, Package, PackageOpen, Pencil, Plus, ShoppingBag, Trash2, Truck } from "@/lib/icons";
import { Empty, cx } from "@/components/primitives";
import { Segmented } from "@/components/filters";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Interruptor } from "@/components/definicoes/ui";
import { useStore } from "@/lib/store";
import { apagarProduto, guardarConfig, guardarProduto, motivoSemVendas, useSite, type LojaConfig, type ProdutoDoSite } from "@/lib/website";
import { mostrarOk } from "@/lib/avisos";
import { CampoDeImagem } from "./CampoDeImagem";
import { Encomendas } from "./Encomendas";

const euro = (v: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);

const CATEGORIAS = ["Equipamento", "Roupa", "Adeptos"];

type Vista = "produtos" | "encomendas" | "entrega";

/**
 * A loja do site, em três vistas: os produtos (foto, galeria, preço, tamanhos
 * e stock; visível ou não), as encomendas (para preparar, entregar, anular e
 * reembolsar), e a entrega (levantamento no clube, envio pelo correio e o
 * aviso da loja). A vista fica no endereço (`?vista=encomendas`), que é para
 * onde o email de uma encomenda nova aponta.
 */
export function Loja() {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);
  const [params, setParams] = useSearchParams();
  const vista: Vista = params.get("vista") === "encomendas" ? "encomendas" : params.get("vista") === "entrega" ? "entrega" : "produtos";
  const irPara = (v: Vista) => {
    const p = new URLSearchParams(params);
    if (v === "produtos") p.delete("vista");
    else p.set("vista", v);
    setParams(p);
  };

  const semVendas = motivoSemVendas(site);
  const vende = !semVendas && (site.loja.levantamento.ativo || site.loja.envio.ativo);

  return (
    <div className="space-y-6">
      <Segmented
        value={vista}
        onChange={irPara}
        label="Partes da loja"
        options={[
          { value: "produtos" as const, label: "Produtos", count: site.produtos.length },
          { value: "encomendas" as const, label: "Encomendas", count: site.encomendasPorTratar || undefined, icon: PackageOpen },
          { value: "entrega" as const, label: "Entrega", icon: Truck },
        ]}
      />

      {!vende && (
        <p className="flex items-start gap-2 rounded-[10px] border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-meta leading-relaxed text-warn">
          <ShoppingBag className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <span>
            <strong className="font-semibold">A loja está em catálogo: ainda não vende online.</strong>{" "}
            {semVendas ? `${semVendas} ` : "Precisa de uma forma de entrega ligada, na vista Entrega. "}
            Até lá, os botões do site levam aos contactos.
          </span>
        </p>
      )}

      {vista === "produtos" && <Produtos />}
      {vista === "encomendas" && <Encomendas />}
      {vista === "entrega" && <Entrega loja={site.loja} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Produtos                                                                     */
/* -------------------------------------------------------------------------- */

function Produtos() {
  const store = useStore();
  const site = useSite(store.academy.slug);
  const [aberto, setAberto] = useState<ProdutoDoSite | "novo" | null>(null);
  const [apagar, setApagar] = useState<ProdutoDoSite | null>(null);

  const mudar = (p: ProdutoDoSite, f: (p: ProdutoDoSite) => ProdutoDoSite) => void guardarProduto(f(p)).catch(() => undefined);

  /** "S 3 · M 0 · L sem contagem", ou nada num produto do inventário ou sem contagens. */
  const resumoDoStock = (p: ProdutoDoSite) => {
    if (p.artigoId) return null;
    const tamanhos = p.tamanhos.split(",").map((s) => s.trim()).filter(Boolean);
    const chaves = tamanhos.length ? tamanhos : [""];
    const partes = chaves.filter((t) => t in p.stock).map((t) => (t ? `${t} ${p.stock[t]}` : `${p.stock[t]} em stock`));
    return partes.length ? partes.join(" · ") : null;
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-panel text-ink">Produtos</h3>
        <button type="button" className="ctl-primary" onClick={() => setAberto("novo")}>
          <Plus className="size-4" strokeWidth={2} />
          Novo produto
        </button>
      </div>

      {site.produtos.length === 0 ? (
        <Empty icon={ShoppingBag} title="A loja está vazia" detail="Os produtos visíveis aparecem na loja do site e na página de início. Um artigo do Inventário põe-se à venda na ficha dele." />
      ) : (
        <ul className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {site.produtos.map((p) => {
            const stock = resumoDoStock(p);
            return (
              <li key={p.id} className={cx("flex items-center gap-3 border-b border-line px-3 py-3 last:border-b-0 sm:gap-4 sm:px-4", !p.visivel && "opacity-60")}>
                <div className="h-14 w-12 shrink-0 overflow-hidden rounded-[8px] bg-sunken">
                  {p.imagem && <img src={p.imagem} alt="" className="size-full object-cover" loading="lazy" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-meta text-ink-3">
                    {p.categoria}
                    {/* Vendido a partir do Inventário: o stock manda nos tamanhos e no esgotado, e a ficha do artigo é onde se mexe. */}
                    {p.artigoId && (
                      <Link
                        to={`/inventario/artigos/${p.artigoId}`}
                        className="inline-flex items-center gap-1 rounded-full bg-signal-soft px-1.5 py-px text-[11px] font-medium text-signal-ink hover:underline"
                        title="Abrir o artigo no Inventário"
                      >
                        <Boxes className="size-3" strokeWidth={1.75} />
                        Do inventário
                      </Link>
                    )}
                    {p.esgotado && <span className="rounded-full bg-risk-soft px-1.5 py-px text-[11px] font-medium text-risk">Esgotado</span>}
                    {!p.visivel && <span className="rounded-full bg-sunken px-1.5 py-px text-[11px] font-medium text-ink-3">Escondido</span>}
                    {p.imagens.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px]">
                        <ImagePlus className="size-3" strokeWidth={1.75} />
                        {p.imagens.length + 1} fotos
                      </span>
                    )}
                  </p>
                  <p className="truncate text-body font-medium text-ink">{p.nome}</p>
                  {(stock || p.tamanhos) && <p className="truncate text-meta text-ink-4">{stock ?? p.tamanhos}</p>}
                </div>
                <span className="shrink-0 text-body font-medium tabular-nums text-ink">{euro(p.preco)}</span>
                <Interruptor ligado={p.visivel} onChange={() => mudar(p, (x) => ({ ...x, visivel: !x.visivel }))} label={`Mostrar ${p.nome} no site`} />
                <button type="button" onClick={() => setAberto(p)} aria-label="Editar" className="ctl-ghost size-9 shrink-0 justify-center px-0">
                  <Pencil className="size-4" strokeWidth={1.75} />
                </button>
                <button type="button" onClick={() => setApagar(p)} aria-label="Apagar" className="ctl-ghost size-9 shrink-0 justify-center px-0 text-risk">
                  <Trash2 className="size-4" strokeWidth={1.75} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {aberto && (
        <EditarProduto
          inicial={aberto === "novo" ? null : aberto}
          onClose={() => setAberto(null)}
          onGuardar={async (p) => {
            await guardarProduto(p);
            mostrarOk("Produto guardado.");
            setAberto(null);
          }}
        />
      )}

      {apagar && (
        <ConfirmDialog
          title="Apagar o produto?"
          onClose={() => setApagar(null)}
          onConfirm={async () => {
            await apagarProduto(apagar.id);
            mostrarOk("Produto apagado.");
            setApagar(null);
          }}
        >
          «{apagar.nome}» sai da loja. As encomendas já feitas ficam como estão. Para o tirar só por uns tempos, desliga-o em vez de o apagar.
        </ConfirmDialog>
      )}
    </div>
  );
}

const MAX_GALERIA = 8;

function EditarProduto({ inicial, onClose, onGuardar }: { inicial: ProdutoDoSite | null; onClose: () => void; onGuardar: (p: ProdutoDoSite) => Promise<void> }) {
  const [p, setP] = useState<ProdutoDoSite>(
    inicial ?? { id: "", nome: "", categoria: "Equipamento", preco: 0, imagem: "", imagens: [], descricao: "", tamanhos: "", esgotado: false, visivel: true, stock: {}, artigoId: null },
  );
  const [preco, setPreco] = useState(inicial ? String(inicial.preco).replace(".", ",") : "");
  const valor = Number(preco.replace(",", "."));
  const pronto = p.nome.trim() && preco.trim() && Number.isFinite(valor) && valor >= 0;
  const [aGravar, setAGravar] = useState(false);
  /*
   * Um produto do Inventário: o nome é o do artigo e os tamanhos, o esgotado e
   * o stock saem do artigo. A API ignora-os ao editar; aqui ficam só de leitura
   * para ninguém escrever o que não vai ficar.
   */
  const doInventario = p.artigoId !== null;
  const tamanhos = p.tamanhos.split(",").map((s) => s.trim()).filter(Boolean);
  const chavesDeStock = tamanhos.length ? tamanhos : [""];

  const guardar = async () => {
    setAGravar(true);
    try {
      await onGuardar({ ...p, nome: p.nome.trim(), preco: Math.round(valor * 100) / 100 });
    } catch {
      // O erro já apareceu no cartão de erros; o diálogo fica aberto com o que se escreveu.
    } finally {
      setAGravar(false);
    }
  };

  const mudarStock = (tamanho: string, texto: string) => {
    const stock = { ...p.stock };
    const limpo = texto.replace(/\D/g, "");
    if (limpo === "") delete stock[tamanho];
    else stock[tamanho] = Math.min(1_000_000, Number(limpo));
    setP({ ...p, stock });
  };

  return (
    <Dialog
      title={inicial ? "Editar produto" : "Novo produto"}
      icon={<ShoppingBag className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={600}
      footer={
        <>
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!pronto || aGravar} onClick={() => void guardar()}>
            Guardar
          </button>
        </>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <DialogField label="Nome" hint={doInventario ? "é o do artigo" : undefined}>
          <input className={dialogInputClass} value={p.nome} onChange={(e) => setP({ ...p, nome: e.target.value })} autoFocus={!doInventario} readOnly={doInventario} disabled={doInventario} />
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
        <DialogField label="Tamanhos" hint={doInventario ? "Os tamanhos, o esgotado e o stock vêm do artigo" : "Separados por vírgulas. Vazio num produto sem tamanhos."}>
          <input className={dialogInputClass} placeholder="S, M, L, XL" value={p.tamanhos} onChange={(e) => setP({ ...p, tamanhos: e.target.value })} disabled={doInventario} />
        </DialogField>

        {!doInventario && (
          <div className="rounded-[8px] border border-line px-3 py-2.5">
            <p className="text-body text-ink">Stock</p>
            <p className="mt-0.5 text-meta leading-relaxed text-ink-3">
              Quantos há de cada {tamanhos.length ? "tamanho" : "unidade"}. Vazio = vende-se sem contagem. Desce sozinho quando uma encomenda é paga; a zero, o tamanho aparece esgotado no site.
            </p>
            <div className={cx("mt-2.5 grid gap-2", tamanhos.length > 1 && "grid-cols-2 sm:grid-cols-3")}>
              {chavesDeStock.map((t) => (
                <label key={t || "unico"} className="flex items-center gap-2 text-meta text-ink-2">
                  {t && <span className="w-12 shrink-0 truncate font-medium text-ink">{t}</span>}
                  <input
                    className={cx(dialogInputClass, "tabular-nums")}
                    inputMode="numeric"
                    placeholder="sem contagem"
                    aria-label={t ? `Stock do tamanho ${t}` : "Stock"}
                    value={t in p.stock ? String(p.stock[t]) : ""}
                    onChange={(e) => mudarStock(t, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        <DialogField label="Descrição">
          <textarea className={cx(dialogInputClass, "h-24 py-2")} value={p.descricao} onChange={(e) => setP({ ...p, descricao: e.target.value })} />
        </DialogField>
        <CampoDeImagem valor={p.imagem} onMudar={(imagem) => setP({ ...p, imagem })} max={1200} proporcao="aspect-[9/11] max-w-[220px]" rotulo="Fotografia principal" />
        <Galeria imagens={p.imagens} onMudar={(imagens) => setP({ ...p, imagens })} />

        {!doInventario && (
          <div className="flex items-center justify-between gap-3 rounded-[8px] border border-line px-3 py-2.5">
            <div>
              <span className="text-body text-ink">Esgotado</span>
              <p className="text-meta text-ink-3">Tira tudo de venda, seja qual for o stock.</p>
            </div>
            <Interruptor ligado={p.esgotado} onChange={() => setP({ ...p, esgotado: !p.esgotado })} label="Esgotado" />
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** As outras fotografias, a seguir à principal: até oito, cada uma com o seu campo. */
function Galeria({ imagens, onMudar }: { imagens: string[]; onMudar: (imagens: string[]) => void }) {
  const [aJuntar, setAJuntar] = useState(false);
  return (
    <div>
      <p className="mb-1.5 text-meta font-medium text-ink-2">Mais fotografias {imagens.length > 0 && <span className="text-ink-4">· {imagens.length} de {MAX_GALERIA}</span>}</p>
      <div className="flex flex-wrap gap-2">
        {imagens.map((img, i) => (
          <div key={img + i} className="relative aspect-[9/11] w-[88px] overflow-hidden rounded-[8px] border border-line bg-sunken">
            <img src={img} alt="" className="size-full object-cover" />
            <button
              type="button"
              aria-label={`Tirar a fotografia ${i + 2}`}
              onClick={() => onMudar(imagens.filter((_, k) => k !== i))}
              className="absolute bottom-1 right-1 grid size-8 place-items-center rounded-[6px] bg-surface/90 text-risk shadow-sm"
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        ))}
        {imagens.length < MAX_GALERIA && !aJuntar && (
          <button type="button" onClick={() => setAJuntar(true)} className="flex aspect-[9/11] w-[88px] flex-col items-center justify-center gap-1 rounded-[8px] border border-dashed border-line-strong text-meta text-ink-3 hover:border-ink-3 hover:text-ink">
            <ImagePlus className="size-4" strokeWidth={1.75} />
            Juntar
          </button>
        )}
      </div>
      {aJuntar && (
        <div className="mt-2 max-w-[220px]">
          <CampoDeImagem
            valor=""
            rotulo="Nova fotografia"
            max={1200}
            proporcao="aspect-[9/11]"
            onMudar={(url) => {
              if (url) onMudar([...imagens, url]);
              setAJuntar(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Entrega                                                                      */
/* -------------------------------------------------------------------------- */

const paraEuros = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));
const deEuros = (s: string): number | null => {
  const n = Number(s.replace(",", "."));
  return s.trim() === "" || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;
};

/**
 * Como o clube entrega. Grava ao fim de meio segundo sem mexer, como o resto
 * da configuração do site (`guardarConfig`). Sem nenhuma das duas ligadas a
 * loja não vende.
 */
function Entrega({ loja }: { loja: LojaConfig }) {
  const gravar = (patch: Partial<LojaConfig>) => void guardarConfig({ loja: { ...loja, ...patch } });
  const [preco, setPreco] = useState(paraEuros(loja.envio.preco));
  const [gratis, setGratis] = useState(paraEuros(loja.envio.gratisAPartirDe));

  return (
    <div className="space-y-4">
      <section className="rounded-[12px] border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Package className="mt-0.5 size-5 shrink-0 text-ink-3" strokeWidth={1.75} />
            <div>
              <h3 className="text-panel text-ink">Levantamento no clube</h3>
              <p className="mt-0.5 text-meta leading-relaxed text-ink-3">Quem compra levanta na sede, no bar, onde disseres. Sem custos. Marcas a encomenda como pronta e a pessoa recebe o aviso.</p>
            </div>
          </div>
          <Interruptor ligado={loja.levantamento.ativo} onChange={() => gravar({ levantamento: { ...loja.levantamento, ativo: !loja.levantamento.ativo } })} label="Levantamento no clube" />
        </div>
        {loja.levantamento.ativo && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <DialogField label="Onde" hint="aparece no site e no email">
              <input className={dialogInputClass} maxLength={160} placeholder="Sede do clube, junto ao estádio" value={loja.levantamento.local} onChange={(e) => gravar({ levantamento: { ...loja.levantamento, local: e.target.value } })} />
            </DialogField>
            <DialogField label="Nota" hint="horário, a quem pedir">
              <input className={dialogInputClass} maxLength={300} placeholder="Dias de treino, das 18h às 21h" value={loja.levantamento.nota} onChange={(e) => gravar({ levantamento: { ...loja.levantamento, nota: e.target.value } })} />
            </DialogField>
          </div>
        )}
      </section>

      <section className="rounded-[12px] border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Truck className="mt-0.5 size-5 shrink-0 text-ink-3" strokeWidth={1.75} />
            <div>
              <h3 className="text-panel text-ink">Envio pelo correio</h3>
              <p className="mt-0.5 text-meta leading-relaxed text-ink-3">Quem compra escreve a morada e paga o envio. Marcas a encomenda como enviada (com o código dos correios, se quiseres) e a pessoa recebe o aviso.</p>
            </div>
          </div>
          <Interruptor ligado={loja.envio.ativo} onChange={() => gravar({ envio: { ...loja.envio, ativo: !loja.envio.ativo } })} label="Envio pelo correio" />
        </div>
        {loja.envio.ativo && (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <DialogField label="Preço do envio (€)">
              <input
                className={cx(dialogInputClass, "tabular-nums")}
                inputMode="decimal"
                placeholder="4,50"
                value={preco}
                onChange={(e) => {
                  setPreco(e.target.value);
                  const v = deEuros(e.target.value);
                  if (v !== null) gravar({ envio: { ...loja.envio, preco: v } });
                }}
              />
            </DialogField>
            <DialogField label="Grátis a partir de (€)" hint="vazio = nunca">
              <input
                className={cx(dialogInputClass, "tabular-nums")}
                inputMode="decimal"
                placeholder="60"
                value={gratis}
                onChange={(e) => {
                  setGratis(e.target.value);
                  gravar({ envio: { ...loja.envio, gratisAPartirDe: deEuros(e.target.value) } });
                }}
              />
            </DialogField>
            <DialogField label="Nota" hint="prazo, onde envias">
              <input className={dialogInputClass} maxLength={300} placeholder="Portugal continental, 3 a 5 dias" value={loja.envio.nota} onChange={(e) => gravar({ envio: { ...loja.envio, nota: e.target.value } })} />
            </DialogField>
          </div>
        )}
      </section>

      <section className="rounded-[12px] border border-line bg-surface p-4">
        <DialogField label="Aviso no topo da loja" hint="opcional">
          <input className={dialogInputClass} maxLength={200} placeholder="As encomendas de dezembro seguem até dia 20." value={loja.aviso} onChange={(e) => gravar({ aviso: e.target.value })} />
        </DialogField>
      </section>

      <p className="text-meta leading-relaxed text-ink-3">
        O dinheiro das encomendas entra na conta euPago do clube, como os bilhetes e as quotas. Os artigos ficam guardados 10 minutos à espera do pagamento; pago, o stock desce (no Inventário, com uma saída registada na encomenda). Os reembolsos fazem-se por fora e marcam-se na encomenda.
      </p>
    </div>
  );
}

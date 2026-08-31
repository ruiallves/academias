import { useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { SelectField, cx } from "@/components/primitives";
import { Plus, TriangleAlert, X } from "@/lib/icons";
import { useActiveCatalog } from "@/lib/catalogs";
import { createItem } from "@/lib/inventory";

/**
 * Registar um artigo.
 *
 * ## Os tamanhos entram aqui, com o stock de cada um
 *
 * Criar o artigo e depois ir a seis sítios pôr o stock de cada tamanho é o que
 * faz um inventário nunca chegar a ser preenchido. Quem está a registar tem a
 * pilha à frente e sabe quantas tem de cada — regista tudo de uma vez, e cada
 * quantidade entra no histórico como uma entrada de stock inicial.
 *
 * ## A referência escreve-se sozinha
 *
 * Quem regista material não inventa códigos, e um campo de referência em branco
 * fica em branco para sempre. Se não for escrita, o servidor gera-a a partir da
 * categoria — `ET-0001` para equipamento de treino — e cada tamanho herda-a com
 * o seu sufixo (`ET-0001-M`). É a convenção do retalho: lê-se ao telefone,
 * ordena-se sozinha, e diz de que família é o material.
 *
 * ## Um nome repetido é uma pergunta
 *
 * A mesma referência é o mesmo artigo e junta-se sem perguntar. O mesmo **nome**
 * sem referência tanto pode ser a t-shirt da época passada como a nova — e quem
 * está a registar é o único que sabe. Ver `createItem` no servidor.
 *
 * ## Os conjuntos de tamanhos são um atalho, não uma regra
 *
 * "XS…XXL" e "S…XL" cobrem quase todo o vestuário de um clube; um botão que os
 * preenche poupa doze toques. Continuam todos editáveis, e um artigo sem
 * tamanhos (uma bola, um kit médico) fica com a variante "Único" que o servidor
 * cria sozinho.
 */
const CONJUNTOS: { label: string; sizes: string[] }[] = [
  { label: "XS – XXL", sizes: ["XS", "S", "M", "L", "XL", "XXL"] },
  { label: "S – XL", sizes: ["S", "M", "L", "XL"] },
  { label: "Infantis", sizes: ["6", "8", "10", "12", "14", "16"] },
];

type Linha = { label: string; quantity: string };

export function NewItemDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const categorias = useActiveCatalog("inventoryCategories");

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sku, setSku] = useState("");
  const [brand, setBrand] = useState("");
  const [minimumStock, setMinimumStock] = useState("0");
  const [notes, setNotes] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** O artigo com o mesmo nome, quando o servidor pergunta o que fazer. */
  const [conflito, setConflito] = useState<{ id: string; name: string; sku: string | null } | null>(null);

  const valido = name.trim().length >= 2 && linhas.every((l) => l.label.trim());

  async function submeter(e: FormEvent, onConflict?: "merge" | "new") {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      const r = await createItem({
        name: name.trim(),
        categoryId: categoryId || undefined,
        sku: sku.trim() || undefined,
        brand: brand.trim() || undefined,
        minimumStock: Number(minimumStock) || 0,
        notes: notes.trim() || undefined,
        variants: linhas
          .filter((l) => l.label.trim())
          .map((l) => ({ label: l.label.trim(), quantity: Number(l.quantity) || 0 })),
        ...(onConflict ? { onConflict } : {}),
      });

      // Não é um erro: é o servidor a perguntar. Nada foi escrito.
      if (!r.ok) {
        setConflito(r.conflict);
        return;
      }
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível criar o artigo.");
    } finally {
      setBusy(false);
    }
  }

  const mexer = (i: number, campo: keyof Linha, valor: string) =>
    setLinhas((cur) => cur.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));

  return (
    <Dialog
      labelledBy="novo-artigo"
      title="Adicionar artigo"
      subtitle="O nome, os tamanhos e quantos há de cada"
      onClose={onClose}
      width={620}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-artigo" className="ctl-primary" disabled={!valido || busy}>
            {busy ? "A guardar…" : "Adicionar"}
          </button>
        </>
      }
    >
      <form id="form-artigo" onSubmit={(e) => void submeter(e)} className="space-y-4 p-5">
        {/*
          A pergunta do nome repetido.

          Substitui o formulário em vez de aparecer por baixo dele: são duas
          decisões diferentes, e mostrar as duas ao mesmo tempo faz com que quem
          está com pressa carregue no primeiro botão que vê.
        */}
        {conflito && (
          <div className="rounded-[var(--radius-control)] border border-warn/30 bg-warn-soft p-4">
            <p className="text-body font-medium text-ink">
              Já existe “{conflito.name}” no armazém{conflito.sku ? ` (${conflito.sku})` : ""}.
            </p>
            <p className="mt-1.5 text-meta leading-relaxed text-ink-3">
              É o mesmo artigo? Junta-se o stock ao que já lá está, tamanho a tamanho. Se for outro — a camisola de
              outra época, outra marca —, cria-se à parte com uma referência própria.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="ctl-primary"
                disabled={busy}
                onClick={(e) => void submeter(e as unknown as FormEvent, "merge")}
              >
                Juntar ao que existe
              </button>
              <button
                type="button"
                className="ctl-outline"
                disabled={busy}
                onClick={(e) => void submeter(e as unknown as FormEvent, "new")}
              >
                Criar artigo novo
              </button>
              <button type="button" className="ctl-ghost" onClick={() => setConflito(null)} disabled={busy}>
                Mudar o nome
              </button>
            </div>
          </div>
        )}

        <DialogField label="Nome">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="T-shirt de aquecimento"
            className={dialogInputClass}
            autoFocus
          />
        </DialogField>

        <DialogField label="Categoria" hint={categorias.length ? undefined : "nenhuma no catálogo"}>
          <SelectField
            className="w-full"
            value={categoryId}
            onChange={setCategoryId}
            options={[{ value: "", label: "Sem categoria" }, ...categorias.map((c) => ({ value: c.id, label: c.label }))]}
          />
        </DialogField>

        <div className="grid grid-cols-3 gap-3">
          <DialogField label="Marca" hint="opcional">
            <input value={brand} onChange={(e) => setBrand(e.target.value)} className={dialogInputClass} />
          </DialogField>
          <DialogField label="Referência" hint="gerada, se ficar vazia">
            <input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="ET-0001"
              className={dialogInputClass}
            />
          </DialogField>
          <DialogField label="Stock mínimo" hint="alerta abaixo disto">
            <input
              type="number"
              min={0}
              value={minimumStock}
              onChange={(e) => setMinimumStock(e.target.value)}
              className={cx(dialogInputClass, "tabular")}
            />
          </DialogField>
        </div>

        {/* Os tamanhos */}
        <div className="border-t border-line pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-meta font-medium text-ink">Tamanhos</span>
            <div className="flex flex-wrap gap-1.5">
              {CONJUNTOS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => setLinhas(c.sizes.map((s) => ({ label: s, quantity: "0" })))}
                  className="rounded-full bg-sunken px-2.5 py-1 text-meta font-medium text-ink-2 hover:text-ink"
                >
                  {c.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setLinhas((c) => [...c, { label: "", quantity: "0" }])}
                className="ctl-ghost h-7 text-meta"
              >
                <Plus className="size-3" strokeWidth={2} />
                Juntar
              </button>
            </div>
          </div>

          {linhas.length === 0 ? (
            <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/40 px-3 py-2.5 text-meta leading-relaxed text-ink-3">
              Sem tamanhos, o artigo fica com uma unidade de medida só — é o que se quer numa bola ou num kit médico.
              Escolhe um conjunto acima se for vestuário.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {linhas.map((l, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    value={l.label}
                    onChange={(e) => mexer(i, "label", e.target.value)}
                    placeholder="Tamanho"
                    className={cx(dialogInputClass, "w-24")}
                  />
                  <input
                    type="number"
                    min={0}
                    value={l.quantity}
                    onChange={(e) => mexer(i, "quantity", e.target.value)}
                    className={cx(dialogInputClass, "w-24 tabular")}
                  />
                  <span className="text-meta text-ink-3">unidades</span>
                  <button
                    type="button"
                    onClick={() => setLinhas((c) => c.filter((_, j) => j !== i))}
                    className="ml-auto flex size-7 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-risk"
                    aria-label={`Remover ${l.label || "tamanho"}`}
                  >
                    <X className="size-3.5" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogField label="Observações" hint="opcional">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={cx(dialogInputClass, "h-auto resize-y py-2 leading-relaxed")}
          />
        </DialogField>

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

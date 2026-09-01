import { useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { SelectField, cx } from "@/components/primitives";
import { TriangleAlert } from "@/lib/icons";
import { useActiveCatalog } from "@/lib/catalogs";
import { updateItem, type ItemDetail } from "@/lib/inventory";

/**
 * Corrigir a ficha de um artigo.
 *
 * ## O stock não está aqui
 *
 * Mexe-se tamanho a tamanho, na tabela ao lado, e cada alteração deixa um
 * movimento com um motivo. Um campo de quantidade neste formulário seria um
 * caminho para mudar números sem explicação — e o histórico deixava de valer,
 * porque passaria a haver duas maneiras de lá chegar e só uma a ser registada.
 *
 * ## A referência muda, e os tamanhos vão com ela
 *
 * Trocar `ET-0001` por outra coisa arrasta os tamanhos que a seguiam
 * (`ET-0001-M` → `ET-0009-M`); os que têm código escrito à mão ficam como
 * estão, porque esses são a etiqueta que alguém colou. O servidor trata disso
 * — ver `updateItem`.
 */
export function EditItemDialog({
  item,
  onClose,
  onDone,
}: {
  item: ItemDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const categorias = useActiveCatalog("inventoryCategories");

  const [name, setName] = useState(item.name);
  const [categoryId, setCategoryId] = useState(item.category?.id ?? "");
  const [sku, setSku] = useState(item.sku ?? "");
  const [brand, setBrand] = useState(item.brand ?? "");
  const [minimumStock, setMinimumStock] = useState(String(item.minimumStock));
  const [description, setDescription] = useState(item.description ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valido = name.trim().length >= 2;

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await updateItem(item.id, {
        name: name.trim(),
        categoryId,
        sku: sku.trim(),
        brand: brand.trim(),
        minimumStock: Number(minimumStock) || 0,
        description: description.trim(),
        notes: notes.trim(),
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
      labelledBy="editar-artigo"
      title="Editar artigo"
      subtitle={item.sku ?? undefined}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="form-editar-artigo" className="ctl-primary" disabled={!valido || busy}>
            {busy ? "A guardar…" : "Guardar"}
          </button>
        </>
      }
    >
      <form id="form-editar-artigo" onSubmit={submeter} className="space-y-4 p-5">
        <DialogField label="Nome">
          <input value={name} onChange={(e) => setName(e.target.value)} className={dialogInputClass} autoFocus />
        </DialogField>

        <DialogField label="Categoria">
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
          <DialogField label="Referência">
            <input value={sku} onChange={(e) => setSku(e.target.value)} className={dialogInputClass} />
          </DialogField>
          <DialogField label="Stock mínimo" hint="por tamanho">
            <input
              type="number"
              min={0}
              value={minimumStock}
              onChange={(e) => setMinimumStock(e.target.value)}
              className={cx(dialogInputClass, "tabular")}
            />
          </DialogField>
        </div>

        <DialogField label="Descrição" hint="opcional">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={cx(dialogInputClass, "h-auto resize-y py-2 leading-relaxed")}
          />
        </DialogField>

        <DialogField label="Observações" hint="internas">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={cx(dialogInputClass, "h-auto resize-y py-2 leading-relaxed")}
          />
        </DialogField>

        {/* O stock vive noutro sítio, e dizê-lo evita que alguém o procure aqui. */}
        <p className="border-t border-line pt-3 text-meta leading-relaxed text-ink-3">
          As quantidades mexem-se na tabela dos tamanhos — cada entrada, saída ou contagem fica no histórico com quem
          a fez.
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

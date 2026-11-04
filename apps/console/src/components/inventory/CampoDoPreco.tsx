import { dialogInputClass } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { centsDoPreco } from "@/lib/inventory";

/**
 * O preço base de um artigo, em euros, como se escreve ("12,50"). Vazio é
 * "sem preço". Usado ao criar e ao editar o artigo.
 */
export function CampoDoPreco({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const invalido = centsDoPreco(value) === undefined;
  return (
    <span className="relative block">
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        placeholder="Sem preço"
        aria-invalid={invalido}
        className={cx(dialogInputClass, "pr-6 tabular", invalido && "border-risk")}
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-meta text-ink-3">€</span>
    </span>
  );
}

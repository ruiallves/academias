import { useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { Trash2, TriangleAlert } from "@/lib/icons";
import { archiveItem, deleteItem, type ItemDetail } from "@/lib/inventory";

/**
 * Tirar um artigo do armazém — de duas maneiras.
 *
 * ## Arquivar e apagar respondem a perguntas diferentes
 *
 * **Arquivar** é o caminho normal: o artigo sai das listas e tudo o que
 * aconteceu com ele fica. Serve para o material que o clube deixou de usar mas
 * que já andou nas mãos de gente — e essas entregas são registo do que
 * aconteceu, não lixo.
 *
 * **Apagar** é para o que nunca devia ter existido: o artigo criado a testar, o
 * nome duplicado, a importação com a coluna errada. Aí o histórico não é
 * história — é ruído que suja as contagens para sempre.
 *
 * O diálogo mostra as duas com o mesmo peso e explica-as, em vez de esconder a
 * segunda atrás de um "avançado". Quem chega aqui sabe qual quer; o que não sabe
 * é qual é qual — e é isso que se resolve com palavras, não com hierarquia.
 *
 * ## O nome escrito à mão
 *
 * Só para apagar, e é a mesma prova de intenção do apagar de uma equipa. A
 * diferença entre as duas acções é que uma se desfaz e a outra não.
 */
export function DeleteItemDialog({
  item,
  onClose,
  onArchived,
  onDeleted,
}: {
  item: ItemDetail;
  onClose: () => void;
  onArchived: () => void;
  onDeleted: () => void;
}) {
  const [modo, setModo] = useState<"escolher" | "apagar">("escolher");
  const [nome, setNome] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const naRua = item.assigned;
  const confere = nome.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt") === item.name.toLocaleLowerCase("pt");

  async function arquivar() {
    if (busy) return;
    setBusy(true);
    setErro(null);
    try {
      await archiveItem(item.id);
      onArchived();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível arquivar.");
    } finally {
      setBusy(false);
    }
  }

  async function apagar(e: FormEvent) {
    e.preventDefault();
    if (!confere || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await deleteItem(item.id, nome.trim());
      onDeleted();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível apagar.");
    } finally {
      setBusy(false);
    }
  }

  const movimentos = item.movements.length;

  return (
    <Dialog
      labelledBy="apagar-artigo"
      title={modo === "apagar" ? "Apagar definitivamente" : "Tirar do armazém"}
      subtitle={item.name}
      icon={<Trash2 className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={520}
      footer={
        modo === "apagar" ? (
          <>
            <button type="button" onClick={() => setModo("escolher")} className="ctl-ghost" disabled={busy}>
              Voltar
            </button>
            <button
              type="submit"
              form="form-apagar"
              className={cx("ctl-primary", "bg-risk hover:bg-risk")}
              disabled={!confere || busy}
            >
              {busy ? "A apagar…" : "Apagar para sempre"}
            </button>
          </>
        ) : (
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
        )
      }
    >
      {modo === "escolher" ? (
        <div className="space-y-3 p-5">
          {naRua > 0 && (
            <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-warn-soft px-3 py-2.5 text-meta leading-relaxed text-warn">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
              Há {naRua} {naRua === 1 ? "unidade" : "unidades"} com atletas. Recebe-{naRua === 1 ? "a" : "as"} antes de
              tirar o artigo do armazém.
            </p>
          )}

          <button
            type="button"
            onClick={() => void arquivar()}
            disabled={busy || naRua > 0}
            className="w-full rounded-[var(--radius-control)] border border-line px-4 py-3 text-left transition-colors hover:border-ink-4 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="block text-body font-medium text-ink">Arquivar</span>
            <span className="mt-0.5 block text-meta leading-relaxed text-ink-3">
              Sai das listas e do que se pode entregar. O histórico fica: quem recebeu o quê, e quando, continua a
              poder consultar-se.
            </span>
          </button>

          <button
            type="button"
            onClick={() => setModo("apagar")}
            disabled={busy || naRua > 0}
            className="w-full rounded-[var(--radius-control)] border border-risk/30 px-4 py-3 text-left transition-colors hover:border-risk disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="block text-body font-medium text-risk">Apagar definitivamente</span>
            <span className="mt-0.5 block text-meta leading-relaxed text-ink-3">
              O artigo, os {item.variants.length} {item.variants.length === 1 ? "tamanho" : "tamanhos"} e{" "}
              {movimentos > 0 ? `os ${movimentos} movimentos` : "o histórico"} desaparecem. Para o que nunca devia ter
              existido — um teste, um nome duplicado, uma importação errada.
            </span>
          </button>

          {erro && (
            <p className="flex items-start gap-1.5 text-meta text-risk">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
              {erro}
            </p>
          )}
        </div>
      ) : (
        <form id="form-apagar" onSubmit={apagar} className="space-y-4 p-5">
          <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2.5 text-meta leading-relaxed text-risk">
            Isto não se desfaz. Desaparecem o artigo, {item.variants.length}{" "}
            {item.variants.length === 1 ? "tamanho" : "tamanhos"}, {movimentos}{" "}
            {movimentos === 1 ? "movimento" : "movimentos"} e as entregas já fechadas.
          </p>

          <DialogField label={`Escreve "${item.name}" para confirmar`}>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className={cx(dialogInputClass, nome && !confere && "border-risk")}
              autoFocus
              autoComplete="off"
            />
          </DialogField>

          {erro && (
            <p className="flex items-start gap-1.5 text-meta text-risk">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
              {erro}
            </p>
          )}
        </form>
      )}
    </Dialog>
  );
}

import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Download, Upload } from "@/lib/icons";
import { getCatalog } from "@/lib/catalogs";
import { importItems } from "@/lib/inventory";
import { OPTIONAL_COLUMNS, REQUIRED_COLUMNS, downloadTemplate, readInventorySheet, type ParsedSheet } from "@/lib/inventory-sheet";

/**
 * Importar o armazém que o clube já tinha.
 *
 * ## Ver antes de importar
 *
 * A folha é lida no browser e o que aparece é o que vai ser criado, com os erros
 * por linha ao lado. Ninguém carrega duzentos artigos às cegas — e um erro de
 * coluna descoberto depois custa uma limpeza à mão que este passo evita.
 *
 * ## Reimportar é inofensivo
 *
 * Um artigo que já existe não se duplica: junta-se-lhe os tamanhos novos e
 * ignoram-se os que já lá estão. A primeira importação nunca sai perfeita, e um
 * módulo em que a segunda tentativa duplica o armazém é um módulo que ninguém
 * volta a usar.
 */
export function ImportItemsDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ created: number; updated: number } | null>(null);

  const maus = sheet?.rows.filter((r) => r.errors.length > 0) ?? [];
  const bons = sheet?.rows.filter((r) => r.errors.length === 0) ?? [];

  async function escolher(file: File | undefined) {
    if (!file) return;
    setErro(null);
    setFeito(null);
    setFileName(file.name);
    try {
      setSheet(await readInventorySheet(file));
    } catch {
      setSheet(null);
      setErro("Não foi possível ler o ficheiro. É um .xlsx ou .csv?");
    }
  }

  async function enviar() {
    if (!sheet || maus.length > 0 || bons.length === 0 || busy) return;
    setBusy(true);
    setErro(null);
    try {
      const r = await importItems(bons.map((x) => x.row));
      if (!r.ok) {
        setErro(r.problems.map((p) => `Linha ${p.line}: ${p.reason}`).join(" · "));
        return;
      }
      setFeito({ created: r.created, updated: r.updated });
      setSheet(null);
      onDone();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setBusy(false);
    }
  }

  /** Quantos artigos distintos a folha traz — é o número que interessa. */
  const artigos = new Set(bons.map((b) => b.row.name.toLocaleLowerCase("pt"))).size;

  return (
    <Dialog
      labelledBy="importar-artigos"
      title="Importar artigos"
      subtitle="A folha do armazém, tal como está"
      onClose={onClose}
      width={640}
      footer={
        <>
          <button
            type="button"
            className="ctl-ghost mr-auto"
            onClick={() => downloadTemplate(getCatalog("inventoryCategories").map((c) => c.label))}
          >
            <Download className="size-3.5" strokeWidth={1.75} />
            Descarregar modelo
          </button>
          <button type="button" className="ctl-ghost" onClick={onClose}>
            {feito ? "Fechar" : "Cancelar"}
          </button>
          {!feito && (
            <button
              type="button"
              className="ctl-primary"
              disabled={busy || !sheet || maus.length > 0 || bons.length === 0}
              onClick={() => void enviar()}
            >
              {busy ? "A importar…" : artigos > 0 ? `Importar ${artigos} ${artigos === 1 ? "artigo" : "artigos"}` : "Importar"}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        {feito ? (
          <div className="rounded-[var(--radius-control)] border border-line bg-ok-soft/40 p-4">
            <p className="text-body font-medium text-ink">
              {feito.created} {feito.created === 1 ? "artigo criado" : "artigos criados"}
              {feito.updated > 0 && `, ${feito.updated} ${feito.updated === 1 ? "actualizado" : "actualizados"}`}.
            </p>
            <p className="mt-1 text-meta text-ink-3">
              O stock de cada tamanho entrou no histórico como entrada — podes vê-lo na ficha de cada artigo.
            </p>
          </div>
        ) : (
          <>
            <label className="block cursor-pointer rounded-[var(--radius-control)] border border-dashed border-line-strong px-5 py-8 text-center hover:border-ink-4">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={(e) => void escolher(e.target.files?.[0])}
              />
              <Upload className="mx-auto mb-2 size-5 text-ink-3" strokeWidth={1.75} />
              <span className="block text-body font-medium text-ink">{fileName || "Escolher a folha do armazém"}</span>
              <span className="mt-0.5 block text-meta text-ink-3">.xlsx, .xls ou .csv</span>
            </label>

            <p className="text-meta leading-relaxed text-ink-3">
              Uma linha por tamanho — linhas com o mesmo artigo juntam-se num artigo com vários tamanhos. Obrigatório:{" "}
              {REQUIRED_COLUMNS.join(", ")}. Opcionais: {OPTIONAL_COLUMNS.join(", ")}. Sem tamanho, o artigo fica com uma
              unidade só.
            </p>
          </>
        )}

        {sheet && sheet.missing.length > 0 && (
          <p className="text-meta text-risk">Faltam colunas na folha: {sheet.missing.join(", ")}.</p>
        )}

        {sheet && sheet.rows.length > 0 && (
          <div className="rounded-[var(--radius-control)] border border-line">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-meta">
              <span className="font-medium text-ink">{sheet.rows.length} linhas</span>
              <span className="text-ink-3">· {artigos} artigos</span>
              {maus.length > 0 ? (
                <span className="ml-auto text-risk">{maus.length} por corrigir</span>
              ) : (
                <span className="ml-auto text-ok">prontas a importar</span>
              )}
            </div>
            <ul className="max-h-[260px] overflow-y-auto">
              {(maus.length > 0 ? maus : sheet.rows).slice(0, 60).map((r) => (
                <li key={r.row.line} className="flex gap-3 border-b border-line px-3 py-2 last:border-0">
                  <span className="w-8 shrink-0 text-meta text-ink-4 tabular">{r.row.line}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink">
                      {r.row.name || "—"}
                      {r.row.size && <span className="text-ink-3"> · {r.row.size}</span>}
                      {r.row.quantity !== undefined && <span className="text-ink-3"> · {r.row.quantity}</span>}
                    </span>
                    {r.errors.length > 0 && <span className="block text-meta text-risk">{r.errors.join(" · ")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {erro && <p className="text-meta text-risk">{erro}</p>}
      </div>
    </Dialog>
  );
}

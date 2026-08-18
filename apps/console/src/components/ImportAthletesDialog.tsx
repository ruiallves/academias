import { useRef, useState } from "react";
import { Check, Download, FileSpreadsheet, TriangleAlert, Upload } from "@/lib/icons";
import { reloadAcademy } from "@/lib/store";
import { COLUMNS, downloadTemplate, importAthletes, parseFile, type ParseResult, type RowError } from "@/lib/import";
import { Dialog } from "./Dialog";
import { cx } from "./primitives";

/**
 * Importar atletas de um Excel.
 *
 * ## O fluxo é três passos, e o meio é o que importa
 *
 * 1. **Descarregar o modelo** — um `.xlsx` com as colunas certas, uma linha de
 *    exemplo, e a lista de equipas. Sem isto, cada academia inventava um formato.
 * 2. **Carregar o ficheiro preenchido** — e ver, *antes de gravar*, o que está bem
 *    e o que está mal, linha a linha. É o passo que evita descobrir um erro só
 *    depois de 90 atletas entrarem torto.
 * 3. **Confirmar** — só as linhas válidas seguem para o servidor, que revalida
 *    tudo (o cliente pode mentir; o servidor não confia nele).
 *
 * A pré-visualização não é cosmética: mostrar 3 erros com o número da linha e o
 * motivo poupa uma tarde de tentativa-e-erro contra o servidor.
 */
type Phase = "pick" | "review" | "done";

export function ImportAthletesDialog({ onClose }: { onClose: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; errors: RowError[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setParsing(true);
    setFileName(file.name);
    try {
      const p = await parseFile(file);
      setParsed(p);
      setPhase("review");
    } catch {
      setError("Não foi possível ler o ficheiro. É mesmo um Excel (.xlsx)?");
    } finally {
      setParsing(false);
    }
  }

  async function confirm() {
    if (!parsed?.valid.length) return;
    setImporting(true);
    setError(null);
    try {
      const res = await importAthletes(parsed.valid);
      // O servidor pode rejeitar linhas que o cliente deixou passar (uma corrida,
      // um duplicado criado entretanto). Junta-se o que ele reportou ao que já se
      // sabia — a verdade é a dele.
      setResult(res);
      setPhase("done");
      await reloadAcademy();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog
      labelledBy="importar-atletas"
      title="Importar atletas"
      subtitle={fileName || "de um ficheiro Excel"}
      onClose={onClose}
      width={620}
      footer={<Footer phase={phase} parsed={parsed} importing={importing} onClose={onClose} onConfirm={confirm} />}
    >
      <div className="p-5">
        {phase === "pick" && <Pick fileInput={fileInput} parsing={parsing} onFile={onFile} />}
        {phase === "review" && parsed && <Review parsed={parsed} />}
        {phase === "done" && result && <Done result={result} />}
        {error && (
          <p className="mt-4 rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta leading-relaxed text-risk">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function Pick({
  fileInput,
  parsing,
  onFile,
}: {
  fileInput: React.RefObject<HTMLInputElement | null>;
  parsing: boolean;
  onFile: (f: File) => void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div className="space-y-4">
      {/* Passo 1: o modelo. Em destaque porque é o que a maioria não sabe que existe. */}
      <div className="flex items-start gap-3 rounded-[var(--radius-panel)] border border-line bg-sunken/40 p-4">
        <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-signal" strokeWidth={1.5} />
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-ink">Começa pelo modelo</div>
          <p className="mt-0.5 text-meta leading-relaxed text-ink-3">
            Tem as colunas certas, uma linha de exemplo e a lista das tuas equipas. Preenche-o e volta aqui.
          </p>
          <button type="button" onClick={() => void downloadTemplate()} className="ctl-outline mt-2.5">
            <Download className="size-3.5" strokeWidth={1.75} />
            Descarregar modelo Excel
          </button>
        </div>
      </div>

      {/* Passo 2: o upload, com arrastar-e-largar. */}
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
        className={cx(
          "flex w-full flex-col items-center gap-2 rounded-[var(--radius-panel)] border border-dashed px-4 py-8 transition-colors duration-[120ms]",
          dragging ? "border-signal bg-signal-soft/40" : "border-line-strong hover:bg-sunken/40",
        )}
      >
        <Upload className="size-6 text-ink-3" strokeWidth={1.5} />
        <span className="text-body font-medium text-ink">
          {parsing ? "A ler o ficheiro…" : "Arrasta o ficheiro preenchido, ou clica para escolher"}
        </span>
        <span className="text-meta text-ink-4">.xlsx</span>
      </button>

      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />

      {/* As colunas, para quem não quer descarregar o modelo. */}
      <details className="text-meta text-ink-3">
        <summary className="cursor-pointer select-none py-1 font-medium text-ink-2">Que colunas tem de ter?</summary>
        <ul className="mt-1.5 space-y-1 pl-1">
          {COLUMNS.map((c) => (
            <li key={c.key} className="flex items-baseline gap-2">
              <span className="font-medium text-ink">{c.header}</span>
              {c.required ? <span className="text-[10px] text-risk">obrigatória</span> : <span className="text-[10px] text-ink-4">opcional</span>}
              <span className="text-ink-4">ex.: {c.example}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Review({ parsed }: { parsed: ParseResult }) {
  if (parsed.missingColumns.length) {
    return (
      <div className="rounded-[var(--radius-panel)] border border-risk/30 bg-risk-soft/50 p-4">
        <div className="flex items-center gap-2 text-body font-medium text-risk">
          <TriangleAlert className="size-4" strokeWidth={1.75} />
          Faltam colunas obrigatórias
        </div>
        <p className="mt-1.5 text-meta leading-relaxed text-ink-2">
          O ficheiro não tem: <strong className="text-ink">{parsed.missingColumns.join(", ")}</strong>. Descarrega o
          modelo e usa esse — os nomes das colunas têm de ser exactamente iguais.
        </p>
      </div>
    );
  }

  const { valid, errors } = parsed;

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <Tally n={valid.length} label={valid.length === 1 ? "atleta pronto" : "atletas prontos"} tone="ok" />
        {errors.length > 0 && <Tally n={errors.length} label={errors.length === 1 ? "linha com erro" : "linhas com erro"} tone="risk" />}
      </div>

      {errors.length > 0 && (
        <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line">
          <div className="border-b border-line bg-sunken/50 px-3 py-2 text-meta font-medium text-ink-2">
            Estas linhas não vão ser importadas — corrige-as no ficheiro e volta a carregar
          </div>
          <ul className="max-h-52 overflow-y-auto">
            {errors.map((e, i) => (
              <li key={i} className="flex items-baseline gap-3 border-b border-line px-3 py-2 text-meta last:border-b-0">
                <span className="w-14 shrink-0 text-ink-4 tabular">Linha {e.line}</span>
                <span className="w-32 shrink-0 truncate font-medium text-ink">{e.name}</span>
                <span className="text-ink-3">{e.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {valid.length === 0 && errors.length === 0 && (
        <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta text-ink-2">
          O ficheiro está vazio — não há linhas para importar.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Done({ result }: { result: { created: number; errors: RowError[] } }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-[#e6f2e9]/40 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#e6f2e9] text-[#1f7a45]">
          <Check className="size-5" strokeWidth={2} />
        </span>
        <div>
          <div className="text-body font-medium text-ink">
            {result.created} {result.created === 1 ? "atleta inscrito" : "atletas inscritos"}
          </div>
          <div className="text-meta text-ink-3">Já aparecem na lista e nos plantéis das equipas.</div>
        </div>
      </div>

      {result.errors.length > 0 && (
        <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line">
          <div className="border-b border-line bg-sunken/50 px-3 py-2 text-meta font-medium text-ink-2">
            {result.errors.length} {result.errors.length === 1 ? "linha foi recusada pelo servidor" : "linhas foram recusadas pelo servidor"}
          </div>
          <ul className="max-h-40 overflow-y-auto">
            {result.errors.map((e, i) => (
              <li key={i} className="flex items-baseline gap-3 border-b border-line px-3 py-2 text-meta last:border-b-0">
                <span className="w-32 shrink-0 truncate font-medium text-ink">{e.name}</span>
                <span className="text-ink-3">{e.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Footer({
  phase,
  parsed,
  importing,
  onClose,
  onConfirm,
}: {
  phase: Phase;
  parsed: ParseResult | null;
  importing: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (phase === "done") {
    return (
      <button type="button" onClick={onClose} className="ctl-primary">
        Concluído
      </button>
    );
  }

  const canImport = phase === "review" && (parsed?.valid.length ?? 0) > 0 && !parsed?.missingColumns.length;

  return (
    <>
      <button type="button" onClick={onClose} className="ctl-ghost">
        Cancelar
      </button>
      {phase === "review" && (
        <button type="button" onClick={onConfirm} disabled={!canImport || importing} className="ctl-primary">
          {importing ? "A importar…" : `Importar ${parsed?.valid.length ?? 0}`}
        </button>
      )}
    </>
  );
}

function Tally({ n, label, tone }: { n: number; label: string; tone: "ok" | "risk" }) {
  return (
    <div className="flex-1 rounded-[var(--radius-panel)] border border-line px-4 py-3">
      <div className={cx("text-[22px] leading-none font-semibold tabular", tone === "ok" ? "text-[#1f7a45]" : "text-risk")}>{n}</div>
      <div className="mt-1 text-meta text-ink-3">{label}</div>
    </div>
  );
}

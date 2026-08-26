import { useRef, useState } from "react";
import { Check, Download, FileSpreadsheet, TriangleAlert, Upload } from "@/lib/icons";
import { academy, reloadAcademy, seasons as knownSeasons } from "@/lib/store";
import { defaultSeason, seasonOptions } from "@/lib/seasons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import {
  COLUMNS,
  createTeams,
  downloadTemplate,
  importAthletes,
  parseFile,
  planTeam,
  type NewTeamPlan,
  type ParseResult,
  type RowError,
} from "@/lib/import";
import { Dialog } from "./Dialog";
import { cx, SelectField } from "./primitives";

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
 *
 * ## As equipas que ainda não existem
 *
 * Uma equipa do ficheiro que a academia não tem **não é um erro**: é uma
 * pergunta. Quem está a montar o clube traz o plantel e as equipas na mesma
 * folha, e mandá-lo criar seis equipas à mão antes de poder importar era
 * mandá-lo fazer à mão o trabalho que o import existe para poupar.
 *
 * A revisão mostra-as, com a modalidade e o escalão já propostos a partir do
 * nome, e um interruptor para decidir. Desligado, as linhas dessas equipas
 * ficam de fora e contam-se como recusadas — nada entra sem alguém dizer que
 * sim.
 */
type Phase = "pick" | "review" | "done";

export function ImportAthletesDialog({ onClose }: { onClose: () => void }) {
  const { session } = useSession();
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; errors: RowError[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Criar as equipas em falta, e o que cada uma vai ser. Só existe se houver. */
  const [createNew, setCreateNew] = useState(true);
  const [plans, setPlans] = useState<NewTeamPlan[]>([]);

  /*
   * Porque é que não se pode criar as equipas em falta, quando não se pode.
   *
   * Três razões, e nenhuma é adivinhada no momento do erro: um treinador importa
   * atletas (`athlete:write` por omissão) mas não cria equipas; e uma equipa
   * precisa de modalidade e de escalão, que vêm dos catálogos. Sem isto o
   * interruptor prometia uma coisa que o servidor recusava com um 400 seco
   * depois de a pessoa já ter carregado em Importar.
   */
  /*
   * A época em que as equipas em falta nascem.
   *
   * `currentSeason` do store seria o óbvio, mas é vazio numa academia sem
   * épocas nenhumas — exactamente a academia que está a importar o plantel pela
   * primeira vez. O servidor recusa uma equipa sem época, e o erro chegaria só
   * depois de a pessoa carregar em Importar. `defaultSeason` nunca devolve vazio.
   */
  const season = defaultSeason(seasonOptions(knownSeasons));

  const blockReason: null | "permissao" | "modalidades" = !can(session, "team:write")
    ? "permissao"
    : academy.sports.length === 0
      ? "modalidades"
      : null;

  async function onFile(file: File) {
    setError(null);
    setParsing(true);
    setFileName(file.name);
    try {
      const p = await parseFile(file);
      setParsed(p);
      setPlans(p.newTeams.map((name) => planTeam(name)));
      setCreateNew(blockReason === null);
      setPhase("review");
    } catch {
      setError("Não foi possível ler o ficheiro. É mesmo um Excel (.xlsx)?");
    } finally {
      setParsing(false);
    }
  }

  async function confirm() {
    if (!parsed) return;
    setImporting(true);
    setError(null);
    try {
      let rows = parsed.valid;
      let teamErrors: { name: string; error: string }[] = [];

      /*
       * As equipas primeiro, os atletas depois.
       *
       * Só assim há um `teamId` para pôr nas linhas. Uma equipa que falhe não
       * derruba a importação: as linhas dela ficam sem id, são contadas como
       * recusadas no fim, e todos os outros atletas entram na mesma.
       */
      if (createNew && plans.length) {
        const { ids, failed } = await createTeams(plans, season);
        teamErrors = failed;
        rows = rows.map((r) => (r.teamId ? r : { ...r, teamId: ids.get(r.teamName.trim().toLowerCase()) }));
      }

      const semEquipa = rows.filter((r) => !r.teamId);
      const res = await importAthletes(rows);

      // O servidor pode rejeitar linhas que o cliente deixou passar (uma corrida,
      // um duplicado criado entretanto). Junta-se o que ele reportou ao que já se
      // sabia — a verdade é a dele.
      const porque = new Map(teamErrors.map((t) => [t.name.trim().toLowerCase(), t.error]));
      setResult({
        created: res.created,
        errors: [
          ...res.errors,
          ...semEquipa.map((r) => {
            const motivo = porque.get(r.teamName.trim().toLowerCase());
            return {
              line: r.line,
              name: r.name,
              error: motivo
                ? `A equipa "${r.teamName}" não foi criada: ${motivo}`
                : `A equipa "${r.teamName}" não foi criada`,
            };
          }),
        ],
      });
      setPhase("done");
      await reloadAcademy();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setImporting(false);
    }
  }

  /** Quantas linhas seguem mesmo: sem criar as equipas em falta, seguem menos. */
  const importable = parsed
    ? parsed.valid.filter((r) => r.teamId || (createNew && plans.length > 0)).length
    : 0;

  return (
    <Dialog
      labelledBy="importar-atletas"
      title="Importar atletas"
      subtitle={fileName || "de um ficheiro Excel"}
      onClose={onClose}
      width={620}
      footer={
        <Footer phase={phase} parsed={parsed} importable={importable} importing={importing} onClose={onClose} onConfirm={confirm} />
      }
    >
      <div className="p-5">
        {phase === "pick" && <Pick fileInput={fileInput} parsing={parsing} onFile={onFile} />}
        {phase === "review" && parsed && (
          <Review
            parsed={parsed}
            plans={plans}
            setPlans={setPlans}
            createNew={createNew}
            setCreateNew={setCreateNew}
            blockReason={blockReason}
            season={season}
            importable={importable}
          />
        )}
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

function Review({
  parsed,
  plans,
  setPlans,
  createNew,
  setCreateNew,
  blockReason,
  season,
  importable,
}: {
  parsed: ParseResult;
  plans: NewTeamPlan[];
  setPlans: (p: NewTeamPlan[]) => void;
  createNew: boolean;
  setCreateNew: (v: boolean) => void;
  blockReason: null | "permissao" | "modalidades";
  season: string;
  importable: number;
}) {
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
  const blocked = valid.length - importable;

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <Tally n={importable} label={importable === 1 ? "atleta pronto" : "atletas prontos"} tone="ok" />
        {errors.length + blocked > 0 && (
          <Tally
            n={errors.length + blocked}
            label={errors.length + blocked === 1 ? "linha de fora" : "linhas de fora"}
            tone="risk"
          />
        )}
      </div>

      {/*
        As equipas que ainda não existem.

        Antes disto, cada linha destas era um erro a dizer "Equipa X não existe
        nesta academia" — uma frase verdadeira que só servia para mandar a
        pessoa embora fazer trabalho à mão. Agora é uma pergunta, com a resposta
        já preenchida e editável.
      */}
      {plans.length > 0 && (
        <div
          className={cx(
            "overflow-hidden rounded-[var(--radius-panel)] border",
            createNew ? "border-signal/40 bg-signal-soft/25" : "border-line",
          )}
        >
          <div className="flex items-start gap-3 px-3 py-2.5">
            {blockReason === null ? (
              <input
                id="criar-equipas"
                type="checkbox"
                checked={createNew}
                onChange={(e) => setCreateNew(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-signal)]"
              />
            ) : (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-risk" strokeWidth={1.75} />
            )}
            <label htmlFor={blockReason === null ? "criar-equipas" : undefined} className="min-w-0 flex-1">
              <span className="block text-meta font-medium text-ink">
                {plans.length === 1
                  ? `A equipa "${plans[0].name}" ainda não existe`
                  : `${plans.length} equipas do ficheiro ainda não existem`}
              </span>
              <span className="mt-0.5 block text-meta leading-relaxed text-ink-3">
                {blockReason === null && (
                  <>
                    Criamo-las agora na época {season}, com o nome que está no ficheiro. Sem isto, os atletas destas
                    equipas ficam de fora.
                  </>
                )}
                {blockReason === "permissao" && (
                  <>
                    Não tens permissão para criar equipas, por isso os atletas destas ficam de fora. Pede à direção que
                    as crie — ou corrige os nomes no ficheiro.
                  </>
                )}
                {blockReason === "modalidades" && (
                  <>
                    A academia ainda não tem modalidades, e uma equipa precisa de uma. Cria-a nas Definições e volta a
                    carregar o ficheiro.
                  </>
                )}
              </span>
            </label>
          </div>

          {createNew && blockReason === null && (
            <ul className="border-t border-line/60">
              {plans.map((plan, i) => (
                <li key={plan.name} className="flex flex-wrap items-center gap-2 border-b border-line/60 px-3 py-2 last:border-b-0">
                  <span className="min-w-0 flex-1 truncate text-meta font-medium text-ink">{plan.name}</span>

                  {/* A idade proposta a partir do nome, editável. Sub- fixo,
                      como no diálogo de nova equipa — a mesma decisão, o mesmo
                      aspecto. */}
                  <span className="flex h-8 items-center rounded-[var(--radius-control)] border border-line bg-surface px-2 focus-within:border-signal">
                    <span aria-hidden className="select-none text-meta text-ink-3">
                      Sub-
                    </span>
                    <input
                      value={String(plan.maxAge)}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(/\D/g, "").slice(0, 2));
                        setPlans(plans.map((p, idx) => (idx === i ? { ...p, maxAge: n } : p)));
                      }}
                      inputMode="numeric"
                      aria-label={`Idade máxima de ${plan.name}`}
                      className="w-8 min-w-0 bg-transparent text-meta text-ink outline-none"
                    />
                  </span>
                  <SelectField
                    className="w-[124px]"
                    value={plan.sportId}
                    onChange={(v) => setPlans(plans.map((p, idx) => (idx === i ? { ...p, sportId: v } : p)))}
                    options={academy.sports.map((s) => ({ value: s.id, label: s.name }))}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
  importable,
  importing,
  onClose,
  onConfirm,
}: {
  phase: Phase;
  parsed: ParseResult | null;
  importable: number;
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

  const canImport = phase === "review" && importable > 0 && !parsed?.missingColumns.length;

  return (
    <>
      <button type="button" onClick={onClose} className="ctl-ghost">
        Cancelar
      </button>
      {phase === "review" && (
        <button type="button" onClick={onConfirm} disabled={!canImport || importing} className="ctl-primary">
          {importing ? "A importar…" : `Importar ${importable}`}
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

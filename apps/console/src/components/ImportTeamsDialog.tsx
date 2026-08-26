import { useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { Check, Upload } from "@/lib/icons";
import { useStore } from "@/lib/store";
import {
  TEAM_COLUMNS,
  downloadTeamTemplate,
  importTeams,
  parseTeamFile,
  type TeamParseResult,
  type TeamRowError,
} from "@/lib/team-import";

/**
 * Importar equipas de um ficheiro.
 *
 * Gémeo do `ImportAthletesDialog`, e de propósito: quem já importou atletas
 * reconhece este ecrã sem o reler. Três momentos — escolher o ficheiro, ver o que
 * vai entrar, confirmar — e o resultado linha a linha no fim.
 *
 * O ficheiro é lido **no browser**. Nada sai daqui antes de a pessoa ver o que vai
 * acontecer, que é o que distingue uma importação de um carregamento às cegas.
 */
export function ImportTeamsDialog({ onClose }: { onClose: () => void }) {
  const { academy } = useStore();
  const input = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<TeamParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; errors: TeamRowError[] } | null>(null);

  async function escolher(file: File) {
    setErro(null);
    setDone(null);
    try {
      setParsed(await parseTeamFile(file));
    } catch {
      setErro("Não foi possível ler o ficheiro. Confirma que é um .xlsx ou .csv.");
    }
  }

  async function confirmar() {
    if (!parsed || parsed.rows.length === 0) return;
    setBusy(true);
    setErro(null);
    try {
      const r = await importTeams(parsed.rows);
      setDone({
        created: r.created,
        errors: r.errors.map((e) => ({ line: e.row, name: e.name, error: e.error })),
      });
      setParsed(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="importar-equipas"
      title="Importar equipas"
      subtitle={academy.name}
      onClose={onClose}
      width={560}
      footer={
        done ? (
          <button type="button" onClick={onClose} className="ctl-primary">
            Concluído
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} className="ctl-ghost">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void confirmar()}
              className="ctl-primary"
              disabled={busy || !parsed || parsed.rows.length === 0}
            >
              {busy ? "A importar…" : parsed ? `Importar ${parsed.rows.length}` : "Importar"}
            </button>
          </>
        )
      }
    >
      <div className="space-y-4 p-5">
        {done ? (
          <>
            <div className="flex items-center gap-2.5 rounded-[var(--radius-control)] bg-ok-soft px-3.5 py-3">
              <Check className="size-4 shrink-0 text-ok" strokeWidth={2.25} />
              <span className="text-body text-ink">
                {done.created} {done.created === 1 ? "equipa criada" : "equipas criadas"}.
              </span>
            </div>
            {done.errors.length > 0 && <Falhas errors={done.errors} titulo="Estas ficaram de fora" />}
          </>
        ) : (
          <>
            {/* --- O modelo ------------------------------------------------- */}
            <div className="rounded-[var(--radius-control)] border border-line p-3.5">
              <p className="text-body font-medium text-ink">Não tens o ficheiro?</p>
              <p className="mt-1 text-meta leading-relaxed text-ink-3">
                Descarrega o modelo — traz as colunas certas e a lista das modalidades do clube, para não haver dúvida
                sobre como as escrever.
              </p>
              <button
                type="button"
                onClick={() =>
                  downloadTeamTemplate(
                    academy.name,
                    academy.sports.map((s) => s.name),
                  )
                }
                className="ctl-outline mt-2.5"
              >
                Descarregar modelo
              </button>
            </div>

            {/* --- As colunas ----------------------------------------------- */}
            <div>
              <span className="mb-1.5 block text-meta font-medium text-ink">Colunas</span>
              <ul className="space-y-1">
                {TEAM_COLUMNS.map((c) => (
                  <li key={c.key} className="flex items-baseline gap-2 text-meta">
                    <span className="font-medium text-ink">{c.header}</span>
                    <span className="text-ink-4">
                      {c.required ? "obrigatória" : "opcional"} · ex.: {c.example}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* --- O ficheiro ----------------------------------------------- */}
            <div>
              <button type="button" onClick={() => input.current?.click()} className="ctl-outline w-full justify-center">
                <Upload className="size-3.5" strokeWidth={1.75} />
                Escolher ficheiro
              </button>
              <input
                ref={input}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void escolher(f);
                  e.target.value = "";
                }}
              />
            </div>

            {parsed && parsed.missingColumns.length > 0 && (
              <p className="rounded-[var(--radius-control)] bg-risk-soft px-3.5 py-2.5 text-meta leading-relaxed text-risk">
                Faltam colunas obrigatórias: {parsed.missingColumns.join(", ")}.
              </p>
            )}

            {parsed && parsed.missingColumns.length === 0 && (
              <>
                <p className="text-body text-ink">
                  <strong className="font-medium">{parsed.rows.length}</strong>{" "}
                  {parsed.rows.length === 1 ? "equipa pronta" : "equipas prontas"} a importar.
                </p>
                {parsed.rows.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto rounded-[var(--radius-control)] border border-line">
                    {parsed.rows.map((r) => (
                      <li
                        key={r.name}
                        className="flex items-baseline gap-2 border-b border-line px-3 py-1.5 last:border-b-0"
                      >
                        <span className="text-body text-ink">{r.name}</span>
                        <span className="text-meta text-ink-4">
                          {r.sport} · {r.ageGroup}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {parsed.errors.length > 0 && <Falhas errors={parsed.errors} titulo="Linhas com problemas" />}
              </>
            )}
          </>
        )}

        {erro && (
          <p className="rounded-[var(--radius-control)] bg-risk-soft px-3.5 py-2.5 text-meta leading-relaxed text-risk">
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * As linhas que falharam, com o número da linha.
 *
 * O número é o que torna isto accionável: quem recebeu a folha por email abre-a,
 * vai à linha 12, e corrige. Sem ele, "modalidade desconhecida" obriga a procurar
 * qual das trinta é.
 */
function Falhas({ errors, titulo }: { errors: TeamRowError[]; titulo: string }) {
  return (
    <div>
      <span className="mb-1.5 block text-meta font-medium text-ink">{titulo}</span>
      <ul className="max-h-40 space-y-1 overflow-y-auto">
        {errors.map((e, i) => (
          <li key={`${e.line}-${i}`} className="flex items-baseline gap-2 text-meta">
            <span className="shrink-0 font-mono text-[11px] text-ink-4">L{e.line}</span>
            <span className="text-ink-2">{e.name}</span>
            <span className="text-risk">{e.error}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

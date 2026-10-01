import { useId, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { Check, Upload } from "@/lib/icons";
import { listStaff } from "@/lib/api";
import { usePendingInvites } from "@/lib/invites";
import { useRoles } from "@/lib/roles";
import { useStore } from "@/lib/store";
import {
  STAFF_COLUMNS,
  downloadStaffTemplate,
  importStaff,
  parseStaffFile,
  type StaffParseResult,
  type StaffRowError,
} from "@/lib/staff-import";

/**
 * Importar staff de um ficheiro.
 *
 * Gémeo do `ImportTeamsDialog`: escolher o ficheiro, ver o que vai entrar,
 * confirmar, e o resultado linha a linha no fim. O ficheiro é lido no browser e
 * nada sai daqui antes de a pessoa ver o que vai acontecer.
 *
 * ## Os convites, desligados por omissão
 *
 * Importar guarda as pessoas com o cargo e as equipas e **não manda email a
 * ninguém**, como na importação de atletas. Quem quiser mandar logo liga a
 * caixa; senão, envia depois na página do Staff, um a um ou todos de uma vez.
 */
export function ImportStaffDialog({ onClose }: { onClose: () => void }) {
  const { academy, teams } = useStore();
  const { roles } = useRoles();
  const invites = usePendingInvites();
  const input = useRef<HTMLInputElement>(null);
  const idEnviar = useId();

  const [parsed, setParsed] = useState<StaffParseResult | null>(null);
  const [enviar, setEnviar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; emailed: number; enviou: boolean; errors: StaffRowError[] } | null>(null);

  async function escolher(file: File) {
    setErro(null);
    setDone(null);
    try {
      setParsed(await parseStaffFile(file, { roles, teams, staff: listStaff(), invites }));
    } catch {
      setErro("Não foi possível ler o ficheiro. Confirma que é um .xlsx ou .csv.");
    }
  }

  async function confirmar() {
    if (!parsed || parsed.rows.length === 0) return;
    setBusy(true);
    setErro(null);
    try {
      const r = await importStaff(parsed.rows, enviar);
      setDone({ ...r, enviou: enviar });
      setParsed(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setBusy(false);
    }
  }

  const n = parsed?.rows.length ?? 0;

  return (
    <Dialog
      labelledBy="importar-staff"
      title="Importar staff"
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
            <button type="button" onClick={() => void confirmar()} className="ctl-primary" disabled={busy || n === 0}>
              {busy ? "A importar…" : parsed ? (enviar ? `Importar e convidar ${n}` : `Importar ${n}`) : "Importar"}
            </button>
          </>
        )
      }
    >
      <div className="space-y-4 p-5">
        {done ? (
          <>
            <div className="flex items-start gap-2.5 rounded-[var(--radius-control)] bg-ok-soft px-3.5 py-3">
              <Check className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={2.25} />
              <div className="text-body text-ink">
                {done.created} {done.created === 1 ? "pessoa adicionada" : "pessoas adicionadas"}.
                <p className="mt-0.5 text-meta text-ink-3">
                  {done.enviou
                    ? `${done.emailed} ${done.emailed === 1 ? "convite enviado" : "convites enviados"} por email.${
                        done.emailed < done.created ? " Os que não saíram ficam na lista, para reenviar." : ""
                      }`
                    : "Ninguém recebeu email. Estão em \"Por convidar\", na página do Staff, onde se enviam os convites."}
                </p>
              </div>
            </div>
            {done.errors.length > 0 && <Falhas errors={done.errors} titulo="Estas ficaram de fora" />}
          </>
        ) : (
          <>
            <div className="rounded-[var(--radius-control)] border border-line p-3.5">
              <p className="text-body font-medium text-ink">Não tens o ficheiro?</p>
              <p className="mt-1 text-meta leading-relaxed text-ink-3">
                Descarrega o modelo: traz as colunas certas e a lista dos cargos e das equipas do clube. A folha que o
                botão Exportar escreve também serve, tem as mesmas colunas.
              </p>
              <button type="button" onClick={() => downloadStaffTemplate(academy.name, roles, teams)} className="ctl-outline mt-2.5">
                Descarregar modelo
              </button>
            </div>

            <div>
              <span className="mb-1.5 block text-meta font-medium text-ink">Colunas</span>
              <ul className="space-y-1">
                {STAFF_COLUMNS.map((c) => (
                  <li key={c.key} className="flex items-baseline gap-2 text-meta">
                    <span className="font-medium text-ink">{c.header}</span>
                    <span className="text-ink-4">
                      {c.required ? "obrigatória" : "opcional"} · ex.: {c.example}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

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
                  <strong className="font-medium">{n}</strong> {n === 1 ? "pessoa pronta" : "pessoas prontas"} a importar.
                </p>
                {n > 0 && (
                  <ul className="max-h-40 overflow-y-auto rounded-[var(--radius-control)] border border-line">
                    {parsed.rows.map((r) => (
                      <li key={r.email} className="border-b border-line px-3 py-1.5 last:border-b-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-body text-ink">{r.name}</span>
                          <span className="truncate text-meta text-ink-4">{r.email}</span>
                        </div>
                        <div className="text-meta text-ink-3">
                          {r.roleName}
                          {r.teamNames.length > 0 ? ` · ${r.teamNames.join(", ")}` : " · sem equipas"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {parsed.errors.length > 0 && <Falhas errors={parsed.errors} titulo="Linhas com problemas" />}

                {n > 0 && (
                  <div className="rounded-[var(--radius-control)] border border-line p-3">
                    <div className="flex items-start gap-2.5">
                      <input
                        id={idEnviar}
                        type="checkbox"
                        checked={enviar}
                        onChange={(e) => setEnviar(e.target.checked)}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--color-signal)]"
                      />
                      <label htmlFor={idEnviar} className="min-w-0 cursor-pointer">
                        <span className="block text-body text-ink">Enviar já o convite por email</span>
                        <span className="block text-meta leading-relaxed text-ink-3">
                          {enviar
                            ? `${n === 1 ? "A pessoa recebe" : `As ${n} pessoas recebem`} agora o link para criar a conta, válido 7 dias.`
                            : "Ninguém recebe email agora. Ficam em \"Por convidar\" e envias quando quiseres."}
                        </span>
                      </label>
                    </div>
                  </div>
                )}
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

/** As linhas que falharam, com o número da linha, para se corrigirem na folha. */
function Falhas({ errors, titulo }: { errors: StaffRowError[]; titulo: string }) {
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

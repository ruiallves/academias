import { useMemo, useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { SelectField, cx } from "@/components/primitives";
import { Trash2, TriangleAlert } from "@/lib/icons";
import { listAthletes, listStaffActivo } from "@/lib/api";
import { useSession } from "@/session";
import { createSalary, deleteSalary, euros, updateSalary, type PeriodoDeVencimento } from "@/lib/finance";

/**
 * Definir ou corrigir o vencimento de uma pessoa.
 *
 * ## Dois modos, um formulário
 *
 * **Definir** (sem `periodo`) escolhe a pessoa, o valor e o mês a partir do
 * qual vale. Se a pessoa já tinha vencimento, o anterior fecha no mês antes:
 * é assim que "subiu em janeiro" fica escrito, e a ficha mostra os dois.
 *
 * **Corrigir** (com `periodo`) mexe num período já escrito — o valor estava
 * mal, o fim ficou por marcar. Aqui aparece também o apagar, para o período
 * que nunca devia ter existido; os meses já pagos ficam nos movimentos.
 *
 * ## O mês, não o dia
 *
 * O início e o fim pedem-se como mês (`<input type="month">`): um vencimento
 * vale meses inteiros, e pedir um dia convidava a escrever o dia do pagamento
 * no lugar errado. O dia do pagamento tem o seu campo, e só serve às previsões.
 */
export function SalarioDialog({
  pessoa,
  periodo,
  onClose,
  onDone,
}: {
  /** A pessoa já escolhida (vindo da ficha dela). Sem isto, escolhe-se aqui. */
  pessoa?: { tipo: "staff" | "atleta"; id: string; nome: string };
  /** Preenchido = corrigir este período, em vez de definir um novo. */
  periodo?: PeriodoDeVencimento;
  onClose: () => void;
  onDone: () => void;
}) {
  const { session } = useSession();
  const editar = periodo ?? null;

  const [tipo, setTipo] = useState<"staff" | "atleta">(pessoa?.tipo ?? "staff");
  const [quem, setQuem] = useState(pessoa?.id ?? "");
  const [valor, setValor] = useState(editar ? paraEuros(editar.amountCents) : "");
  const [desde, setDesde] = useState(editar ? editar.startsOn.slice(0, 7) : mesCorrente());
  const [ate, setAte] = useState(editar?.endsOn ? editar.endsOn.slice(0, 7) : "");
  const [dia, setDia] = useState(editar ? (editar.payDay ? String(editar.payDay) : "") : "");
  const [notas, setNotas] = useState(editar?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aApagar, setAApagar] = useState(false);

  const staff = useMemo(() => listStaffActivo().slice().sort((a, b) => a.name.localeCompare(b.name, "pt")), []);
  const atletas = useMemo(
    () => listAthletes(session).filter((a) => a.status === "active").slice().sort((a, b) => a.name.localeCompare(b.name, "pt")),
    [session],
  );

  const cents = paraCentimos(valor);
  const valido = cents !== null && cents > 0 && /^\d{4}-\d{2}$/.test(desde) && (Boolean(editar) || Boolean(quem)) && (!ate || ate >= desde);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy || cents === null) return;
    setBusy(true);
    setErro(null);
    try {
      if (editar) {
        await updateSalary(editar.id, {
          amountCents: cents,
          startsOn: `${desde}-01`,
          endsOn: ate ? `${ate}-01` : "",
          payDay: dia ? Number(dia) : null,
          notes: notas,
        });
      } else {
        await createSalary({
          ...(tipo === "staff" ? { membershipId: quem } : { athleteId: quem }),
          amountCents: cents,
          startsOn: `${desde}-01`,
          payDay: dia ? Number(dia) : null,
          notes: notas.trim() || undefined,
        });
      }
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function apagar() {
    if (!editar || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await deleteSalary(editar.id);
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível apagar.");
      setBusy(false);
      setAApagar(false);
    }
  }

  const opcoesDePessoa =
    tipo === "staff"
      ? staff.map((m) => ({ value: m.id, label: m.title ? `${m.name} · ${m.title}` : m.name }))
      : atletas.map((a) => ({ value: a.id, label: a.name }));

  return (
    <Dialog
      labelledBy="vencimento"
      title={editar ? "Corrigir vencimento" : pessoa ? `Vencimento de ${pessoa.nome}` : "Definir vencimento"}
      subtitle={editar ? `${euros(editar.amountCents)} por mês desde ${mesPorExtenso(editar.startsOn.slice(0, 7))}` : undefined}
      onClose={onClose}
      width={520}
      footer={
        aApagar ? (
          <>
            <span className="mr-auto text-meta text-ink-2">Apagar este período? Os meses já pagos ficam nos movimentos.</span>
            <button type="button" onClick={() => setAApagar(false)} className="ctl-ghost" disabled={busy}>
              Não apagar
            </button>
            <button type="button" onClick={() => void apagar()} className="ctl-risk" disabled={busy}>
              {busy ? "A apagar…" : "Apagar"}
            </button>
          </>
        ) : (
          <>
            {editar && (
              <button type="button" onClick={() => setAApagar(true)} className="ctl-ghost mr-auto text-ink-3 hover:text-risk" disabled={busy}>
                <Trash2 className="size-3.5" strokeWidth={1.75} />
                Apagar
              </button>
            )}
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form="form-vencimento" className="ctl-primary" disabled={!valido || busy}>
              {busy ? "A guardar…" : editar ? "Guardar" : "Definir"}
            </button>
          </>
        )
      }
    >
      <form id="form-vencimento" onSubmit={submeter} className="space-y-4 p-5">
        {!editar && !pessoa && (
          <>
            <fieldset>
              <legend className="mb-1.5 text-meta font-medium text-ink">Quem</legend>
              <div className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-sunken p-1">
                {(
                  [
                    ["staff", "Staff"],
                    ["atleta", "Atleta"],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setTipo(v);
                      setQuem("");
                    }}
                    aria-pressed={tipo === v}
                    className={cx(
                      "h-8 rounded-[7px] px-3 text-meta font-semibold transition-colors duration-[120ms]",
                      tipo === v ? "bg-ink text-surface" : "text-ink-3 hover:bg-surface/60 hover:text-ink-2",
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </fieldset>
            <DialogField label={tipo === "staff" ? "Pessoa do staff" : "Atleta"}>
              <SelectField
                className="w-full"
                value={quem}
                onChange={setQuem}
                pesquisa
                options={[{ value: "", label: "Escolher…" }, ...opcoesDePessoa]}
              />
            </DialogField>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Valor por mês (€)">
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              placeholder="600,00"
              autoFocus
              className={cx(dialogInputClass, "text-right tabular", valor && cents === null && "border-risk")}
            />
          </DialogField>
          <DialogField label="Dia do pagamento" hint="para as previsões">
            <SelectField
              className="w-full"
              value={dia}
              onChange={setDia}
              options={[
                { value: "", label: "Último dia do mês" },
                ...Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `Dia ${i + 1}` })),
              ]}
            />
          </DialogField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <DialogField label={editar ? "Vale desde" : "Vale a partir de"}>
            <input type="month" value={desde} onChange={(e) => setDesde(e.target.value)} className={dialogInputClass} />
          </DialogField>
          {editar ? (
            <DialogField label="Até" hint="vazio = em vigor">
              <input type="month" value={ate} min={desde} onChange={(e) => setAte(e.target.value)} className={dialogInputClass} />
            </DialogField>
          ) : (
            <div className="self-end pb-2 text-meta leading-relaxed text-ink-3">
              Se já havia um vencimento, fecha no mês anterior a este.
            </div>
          )}
        </div>

        <DialogField label="Notas" hint="opcional">
          <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Contrato até junho, inclui subsídio de transporte…" className={dialogInputClass} />
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

function paraEuros(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function paraCentimos(v: string): number | null {
  const limpo = v.trim().replace(/\s/g, "").replace("€", "").replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function mesCorrente(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function mesPorExtenso(chave: string): string {
  const [a, m] = chave.split("-");
  return `${MESES[Number(m) - 1] ?? m} de ${a}`;
}

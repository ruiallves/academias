import { useState, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { apiDelete, apiPatch, apiPost } from "@/lib/http";
import { cx } from "./primitives";
import type { GastoFixo, Recurrence, Transacao } from "@/lib/types";

/**
 * Os dois formulários das contas: um movimento e um gasto fixo.
 *
 * ## Euros à entrada, cêntimos à saída
 *
 * Quem lança escreve "39,90" e não "3990". A conversão acontece aqui, num sítio
 * só, e aceita a vírgula portuguesa e o ponto: obrigar alguém a escrever o
 * separador "certo" é criar um erro que não existe fora do computador.
 *
 * ## O IVA é um botão, não um campo livre
 *
 * As taxas são quatro (23, 13, 6 e isento). Um campo aberto convidava a escrever
 * 21 ou 20 por engano, e o líquido de todo o mês saía errado por causa de uma
 * tecla.
 */

export const emCentimos = (texto: string): number => {
  const limpo = texto.replace(/\s|€/g, "").replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export const emEuros = (cents: number): string => (cents / 100).toFixed(2).replace(".", ",");

const hoje = () => new Date().toISOString().slice(0, 10);

const TAXAS = [23, 13, 6, 0];

function Dialogo({ titulo, hint, onClose, children }: { titulo: string; hint?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onMouseDown={onClose}>
      <div
        className="w-full max-w-lg rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="text-panel text-ink">{titulo}</h2>
            {hint && <p className="mt-0.5 text-meta text-ink-3">{hint}</p>}
          </div>
          <button type="button" onClick={onClose} className="ctl-ghost size-7 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-2 text-meta font-medium text-ink-2">
        {label}
        {hint && <span className="font-normal text-ink-4">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

const campoClass =
  "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-body text-ink outline-none focus:border-signal";

function Taxas({ valor, onChange }: { valor: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1.5">
      {TAXAS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={cx(
            "h-9 flex-1 rounded-[var(--radius-control)] border text-meta font-medium",
            valor === t ? "border-ink bg-ink text-surface" : "border-line text-ink-2",
          )}
        >
          {t === 0 ? "Isento" : `${t}%`}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Um movimento                                                                */
/* -------------------------------------------------------------------------- */

export function MovimentoDialog({
  movimento,
  tipoInicial,
  onClose,
  onSaved,
}: {
  movimento: Transacao | null;
  tipoInicial: "INCOME" | "EXPENSE";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState(movimento?.kind ?? tipoInicial);
  const [description, setDescription] = useState(movimento?.description ?? "");
  const [valor, setValor] = useState(movimento ? emEuros(movimento.amountCents) : "");
  const [vatRate, setVatRate] = useState(movimento?.vatRate ?? 23);
  const [occurredAt, setOccurredAt] = useState(movimento?.occurredAt.slice(0, 10) ?? hoje());
  const [category, setCategory] = useState(movimento?.category ?? "");
  const [counterparty, setCounterparty] = useState(movimento?.counterparty ?? "");
  const [notes, setNotes] = useState(movimento?.notes ?? "");
  const [previsto, setPrevisto] = useState(movimento?.status === "PENDING");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cents = emCentimos(valor);
    if (!description.trim() || cents <= 0) {
      setErro("Falta a descrição ou o valor.");
      return;
    }
    setBusy(true);
    setErro(null);
    try {
      const corpo = {
        kind,
        status: previsto ? "PENDING" : "COMPLETED",
        description: description.trim(),
        amountCents: cents,
        vatRate,
        occurredAt,
        category: category.trim() || undefined,
        counterparty: counterparty.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      if (movimento) await apiPatch(`/contas/movimentos/${movimento.id}`, corpo);
      else await apiPost("/contas/movimentos", corpo);
      onSaved();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  async function apagar() {
    if (!movimento || busy) return;
    setBusy(true);
    try {
      await apiDelete(`/contas/movimentos/${movimento.id}`);
      onSaved();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível apagar.");
      setBusy(false);
    }
  }

  return (
    <Dialogo
      titulo={movimento ? "Editar movimento" : kind === "INCOME" ? "Novo ganho" : "Novo gasto"}
      hint="O valor é com IVA. O líquido é o que conta na previsão."
      onClose={onClose}
    >
      <form onSubmit={submeter} className="space-y-3.5 px-5 py-4">
        <div className="flex gap-1.5">
          {(["EXPENSE", "INCOME"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cx(
                "h-9 flex-1 rounded-[var(--radius-control)] border text-meta font-medium",
                kind === k ? "border-ink bg-ink text-surface" : "border-line text-ink-2",
              )}
            >
              {k === "EXPENSE" ? "Gasto" : "Ganho"}
            </button>
          ))}
        </div>

        <Campo label="Descrição">
          <input className={campoClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Servidores Railway" />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Valor" hint="com IVA">
            <input className={campoClass} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="39,90" inputMode="decimal" />
          </Campo>
          <Campo label="Data">
            <input type="date" className={campoClass} value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </Campo>
        </div>

        <Campo label="IVA">
          <Taxas valor={vatRate} onChange={setVatRate} />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Categoria" hint="opcional">
            <input className={campoClass} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Infraestrutura" />
          </Campo>
          <Campo label={kind === "EXPENSE" ? "Fornecedor" : "Cliente"} hint="opcional">
            <input className={campoClass} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
          </Campo>
        </div>

        <Campo label="Notas" hint="opcional">
          <textarea className={cx(campoClass, "h-16 py-2")} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Campo>

        <label className="flex items-center gap-2.5 text-meta text-ink-2">
          <input type="checkbox" checked={previsto} onChange={(e) => setPrevisto(e.target.checked)} />
          Ainda não se moveu, é um previsto
        </label>

        {erro && <p className="text-meta text-risk">{erro}</p>}

        <div className="flex items-center gap-2 pt-1">
          {movimento && !movimento.noticeId && (
            <button type="button" onClick={apagar} className="ctl-ghost text-risk" disabled={busy}>
              Apagar
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" className="ctl-primary" disabled={busy}>
            {busy ? "A gravar…" : "Gravar"}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

/* -------------------------------------------------------------------------- */
/* Um gasto fixo                                                               */
/* -------------------------------------------------------------------------- */

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function GastoFixoDialog({ gasto, onClose, onSaved }: { gasto: GastoFixo | null; onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState(gasto?.description ?? "");
  const [valor, setValor] = useState(gasto ? emEuros(gasto.amountCents) : "");
  const [vatRate, setVatRate] = useState(gasto?.vatRate ?? 23);
  const [recurrence, setRecurrence] = useState<Recurrence>(gasto?.recurrence ?? "MONTHLY");
  const [dayOfMonth, setDayOfMonth] = useState(String(gasto?.dayOfMonth ?? 1));
  const [month, setMonth] = useState(String(gasto?.month ?? 1));
  const [category, setCategory] = useState(gasto?.category ?? "");
  const [counterparty, setCounterparty] = useState(gasto?.counterparty ?? "");
  const [startsOn, setStartsOn] = useState(gasto?.startsOn.slice(0, 10) ?? hoje());
  const [endsOn, setEndsOn] = useState(gasto?.endsOn?.slice(0, 10) ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cents = emCentimos(valor);
    if (!description.trim() || cents <= 0) {
      setErro("Falta a descrição ou o valor.");
      return;
    }
    setBusy(true);
    setErro(null);
    try {
      const corpo = {
        description: description.trim(),
        amountCents: cents,
        vatRate,
        recurrence,
        dayOfMonth: Math.min(Math.max(Number(dayOfMonth) || 1, 1), 28),
        month: recurrence === "ANNUAL" ? Number(month) || 1 : undefined,
        category: category.trim() || undefined,
        counterparty: counterparty.trim() || undefined,
        startsOn,
        endsOn: endsOn || undefined,
      };
      if (gasto) await apiPatch(`/contas/fixos/${gasto.id}`, corpo);
      else await apiPost("/contas/fixos", corpo);
      onSaved();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  async function apagar() {
    if (!gasto || busy) return;
    setBusy(true);
    try {
      await apiDelete(`/contas/fixos/${gasto.id}`);
      onSaved();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível apagar.");
      setBusy(false);
    }
  }

  return (
    <Dialogo
      titulo={gasto ? "Editar gasto fixo" : "Novo gasto fixo"}
      hint="Descrito uma vez, contado em todos os meses que lhe tocam."
      onClose={onClose}
    >
      <form onSubmit={submeter} className="space-y-3.5 px-5 py-4">
        <Campo label="Descrição">
          <input className={campoClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contabilidade" />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Valor" hint="com IVA">
            <input className={campoClass} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="75,00" inputMode="decimal" />
          </Campo>
          <Campo label="Periodicidade">
            <div className="flex gap-1.5">
              {(["MONTHLY", "ANNUAL"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRecurrence(r)}
                  className={cx(
                    "h-9 flex-1 rounded-[var(--radius-control)] border text-meta font-medium",
                    recurrence === r ? "border-ink bg-ink text-surface" : "border-line text-ink-2",
                  )}
                >
                  {r === "MONTHLY" ? "Mensal" : "Anual"}
                </button>
              ))}
            </div>
          </Campo>
        </div>

        <Campo label="IVA">
          <Taxas valor={vatRate} onChange={setVatRate} />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Dia do mês" hint="até 28">
            <input className={campoClass} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} inputMode="numeric" />
          </Campo>
          {recurrence === "ANNUAL" && (
            <Campo label="Mês">
              <select className={campoClass} value={month} onChange={(e) => setMonth(e.target.value)}>
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </Campo>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Desde">
            <input type="date" className={campoClass} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Campo>
          <Campo label="Até" hint="opcional">
            <input type="date" className={campoClass} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Campo>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Categoria" hint="opcional">
            <input className={campoClass} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Serviços" />
          </Campo>
          <Campo label="Fornecedor" hint="opcional">
            <input className={campoClass} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
          </Campo>
        </div>

        {erro && <p className="text-meta text-risk">{erro}</p>}

        <div className="flex items-center gap-2 pt-1">
          {gasto && (
            <button type="button" onClick={apagar} className="ctl-ghost text-risk" disabled={busy}>
              Apagar
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" className="ctl-primary" disabled={busy}>
            {busy ? "A gravar…" : "Gravar"}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

/* -------------------------------------------------------------------------- */
/* As definições das contas                                                    */
/* -------------------------------------------------------------------------- */

export function DefinicoesDialog({
  vatRate,
  vatIncluded,
  openingBalanceCents,
  onClose,
  onSaved,
}: {
  vatRate: number;
  vatIncluded: boolean;
  openingBalanceCents: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [taxa, setTaxa] = useState(vatRate);
  const [incluido, setIncluido] = useState(vatIncluded);
  const [abertura, setAbertura] = useState(emEuros(openingBalanceCents));
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErro(null);
    try {
      await apiPatch("/contas/definicoes", {
        subscriptionVatRate: taxa,
        subscriptionVatIncluded: incluido,
        openingBalanceCents: emCentimos(abertura),
      });
      onSaved();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível gravar.");
      setBusy(false);
    }
  }

  return (
    <Dialogo titulo="Definições das contas" hint="O IVA das mensalidades e o saldo de abertura." onClose={onClose}>
      <form onSubmit={submeter} className="space-y-3.5 px-5 py-4">
        <Campo label="IVA das mensalidades dos clubes">
          <Taxas valor={taxa} onChange={setTaxa} />
        </Campo>
        <label className="flex items-center gap-2.5 text-meta text-ink-2">
          <input type="checkbox" checked={incluido} onChange={(e) => setIncluido(e.target.checked)} />O preço combinado com o clube já inclui IVA
        </label>
        <Campo label="Saldo de abertura" hint="o que havia em caixa quando isto começou">
          <input className={campoClass} value={abertura} onChange={(e) => setAbertura(e.target.value)} inputMode="decimal" />
        </Campo>
        {erro && <p className="text-meta text-risk">{erro}</p>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" className="ctl-primary" disabled={busy}>
            {busy ? "A gravar…" : "Gravar"}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

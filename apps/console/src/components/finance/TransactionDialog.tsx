import { useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { SelectField, cx } from "@/components/primitives";
import { Repeat, TriangleAlert } from "@/lib/icons";
import { useActiveCatalog } from "@/lib/catalogs";
import { listTeams } from "@/lib/api";
import { useSession } from "@/session";
import { METHOD_LABEL, createTransaction, type FinanceKind } from "@/lib/finance";

/**
 * Registar uma receita ou uma despesa — o mesmo diálogo, porque são o mesmo
 * gesto com o sinal trocado, e dois formulários iguais divergem.
 *
 * ## O estado é a pergunta mais importante
 *
 * "Já aconteceu" ou "está previsto" decidem se o movimento mexe no saldo ou nas
 * previsões — e é a distinção que faz o saldo dizer a verdade. Por isso são as
 * duas primeiras pastilhas, não um selector escondido no fim.
 *
 * O valor escreve-se em euros e guarda-se em cêntimos: ninguém pensa em
 * cêntimos, e nenhuma conta do produto aceita floats.
 */
export function TransactionDialog({
  kind,
  eventLink,
  onClose,
  onDone,
}: {
  kind: FinanceKind;
  /** Quando se chega pelo calendário, o movimento já nasce ligado ao evento. */
  eventLink?: { matchId?: string; calendarEventId?: string; label: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const { session } = useSession();
  const receita = kind === "INCOME";
  const categorias = useActiveCatalog(receita ? "financeIncome" : "financeExpense");
  const equipas = listTeams(session);

  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(hoje());
  const [estado, setEstado] = useState<"COMPLETED" | "PLANNED">(eventLink ? "PLANNED" : "COMPLETED");
  const [fixa, setFixa] = useState(false);
  const [ate, setAte] = useState("");
  const [categoria, setCategoria] = useState("");
  const [metodo, setMetodo] = useState("");
  const [contraparte, setContraparte] = useState("");
  const [equipa, setEquipa] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cents = paraCentimos(valor);
  const meses = fixa && ate ? contarMeses(data, ate) : 0;
  const valido =
    descricao.trim().length >= 2 && cents !== null && cents > 0 && Boolean(data) && (!fixa || meses > 0);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await createTransaction({
        kind,
        // Uma série é sempre previsão: nenhum mês por vir já foi pago.
        status: fixa ? "PLANNED" : estado,
        ...(fixa ? { repeatMonthly: true, repeatUntil: ate } : {}),
        description: descricao.trim(),
        amountCents: cents,
        occurredAt: data,
        categoryId: categoria || undefined,
        method: metodo || undefined,
        counterparty: contraparte.trim() || undefined,
        teamId: equipa || undefined,
        notes: notas.trim() || undefined,
        ...(eventLink?.matchId ? { matchId: eventLink.matchId } : {}),
        ...(eventLink?.calendarEventId ? { calendarEventId: eventLink.calendarEventId } : {}),
      });
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível registar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="novo-movimento"
      title={receita ? "Nova receita" : "Nova despesa"}
      subtitle={eventLink ? eventLink.label : undefined}
      onClose={onClose}
      width={540}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="form-movimento" className="ctl-primary" disabled={!valido || busy}>
            {busy ? "A registar…" : fixa && meses > 0 ? `Registar ${meses} meses` : "Registar"}
          </button>
        </>
      }
    >
      <form id="form-movimento" onSubmit={submeter} className="space-y-4 p-5">
        {/* Já aconteceu, ou está previsto? É o que separa o saldo das previsões. */}
        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">Quando</legend>
          <div className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-sunken p-1">
            {(
              [
                ["COMPLETED", receita ? "Já recebida" : "Já paga"],
                ["PLANNED", "Prevista"],
              ] as const
            ).map(([v, l]) => {
              // Numa série, "já paga" não faz sentido: os meses ainda não
              // chegaram. Fica dito em vez de ser um botão que engana.
              const activo = fixa ? v === "PLANNED" : estado === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setEstado(v)}
                  disabled={fixa}
                  aria-pressed={activo}
                  className={cx(
                    "h-8 rounded-[7px] px-3 text-meta font-semibold transition-colors duration-[120ms]",
                    activo ? "bg-ink text-surface" : "text-ink-3 hover:bg-surface/60 hover:text-ink-2",
                    fixa && !activo && "opacity-40",
                  )}
                >
                  {l}
                </button>
              );
            })}
          </div>
          {fixa && <p className="mt-1.5 text-meta text-ink-3">Uma série é sempre previsão — cada mês confirma-se quando acontecer.</p>}
        </fieldset>

        <div className="grid grid-cols-[1fr_130px] gap-3">
          <DialogField label="Descrição">
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder={receita ? "Patrocínio Café Central" : "Autocarro para o jogo em Braga"}
              className={dialogInputClass}
              autoFocus
            />
          </DialogField>
          <DialogField label="Valor (€)">
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              placeholder="450,00"
              className={cx(dialogInputClass, "text-right tabular", valor && cents === null && "border-risk")}
            />
          </DialogField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <DialogField label={fixa ? "Primeiro mês" : estado === "PLANNED" ? "Data prevista" : "Data"}>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={dialogInputClass} />
          </DialogField>
          <DialogField label="Categoria">
            <SelectField
              className="w-full"
              value={categoria}
              onChange={setCategoria}
              options={[{ value: "", label: "Sem categoria" }, ...categorias.map((c) => ({ value: c.id, label: c.label }))]}
            />
          </DialogField>
        </div>

        {/*
          A despesa fixa — a renda do pavilhão, o seguro, o contrato do material.
          Fica ao pé da data porque é a data que ela repete, e não noutro passo:
          é a mesma despesa, dita uma vez em vez de doze.
        */}
        {!eventLink && (
          <div className="rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={fixa}
                onChange={(e) => {
                  setFixa(e.target.checked);
                  if (e.target.checked && !ate) setAte(maisUmAno(data));
                }}
                className="size-4 rounded-[4px] border-line accent-[var(--color-ink)]"
              />
              <span className="flex items-center gap-1.5 text-meta font-medium text-ink">
                <Repeat className="size-3.5 text-ink-3" strokeWidth={1.75} />
                {receita ? "Receita fixa mensal" : "Despesa fixa mensal"}
              </span>
            </label>

            {fixa && (
              <div className="mt-3 space-y-2">
                <DialogField label="Repete todos os meses até">
                  <input type="date" value={ate} min={data} onChange={(e) => setAte(e.target.value)} className={dialogInputClass} />
                </DialogField>
                <p className="text-meta text-ink-3">
                  {meses > 0
                    ? `Ficam ${meses} ${meses === 1 ? "mês previsto" : "meses previstos"}, um de cada vez — confirma cada um quando for ${receita ? "recebido" : "pago"}.`
                    : "O fim tem de ser depois do primeiro mês."}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Método" hint="opcional">
            <SelectField
              className="w-full"
              value={metodo}
              onChange={setMetodo}
              options={[
                { value: "", label: "—" },
                ...Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />
          </DialogField>
          <DialogField label={receita ? "De quem" : "Para quem"} hint="opcional">
            <input
              value={contraparte}
              onChange={(e) => setContraparte(e.target.value)}
              placeholder={receita ? "Câmara Municipal" : "Auto Viação Lda"}
              className={dialogInputClass}
            />
          </DialogField>
        </div>

        {!eventLink && (
          <DialogField label="Equipa" hint="opcional — para os custos por equipa">
            <SelectField
              className="w-full"
              value={equipa}
              onChange={setEquipa}
              options={[{ value: "", label: "Clube inteiro" }, ...equipas.map((t) => ({ value: t.id, label: t.name }))]}
            />
          </DialogField>
        )}

        <DialogField label="Notas" hint="opcional">
          <input value={notas} onChange={(e) => setNotas(e.target.value)} className={dialogInputClass} />
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

/**
 * "450", "450,50", "1 234,56" → cêntimos. Nulo quando não é um valor — e o
 * campo fica vermelho em vez de o formulário adivinhar.
 */
function paraCentimos(v: string): number | null {
  const limpo = v.trim().replace(/\s/g, "").replace("€", "").replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** O fim que se sugere a quem liga a repetição: um ano de contrato. */
function maisUmAno(desde: string): string {
  const d = new Date(desde || hoje());
  if (Number.isNaN(d.getTime())) return "";
  return new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

/**
 * Quantos meses ficam entre as duas datas, inclusive — a mesma conta que o
 * servidor faz, para o formulário poder dizer "ficam 12 meses previstos" antes
 * de gravar. O dia 31 encosta ao fim do mês curto em vez de o saltar: uma renda
 * de dia 31 não deixa de existir em Fevereiro.
 */
function contarMeses(desde: string, ate: string): number {
  const inicio = new Date(desde);
  const fim = new Date(ate);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || fim < inicio) return 0;

  const dia = inicio.getUTCDate();
  let n = 0;
  for (let i = 0; n < 60; i++) {
    const mes = inicio.getUTCMonth() + i;
    const ultimo = new Date(Date.UTC(inicio.getUTCFullYear(), mes + 1, 0)).getUTCDate();
    if (new Date(Date.UTC(inicio.getUTCFullYear(), mes, Math.min(dia, ultimo))) > fim) break;
    n++;
  }
  return n;
}

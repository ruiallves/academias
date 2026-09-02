import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pill, cx } from "@/components/primitives";
import { TransactionDialog } from "@/components/finance/TransactionDialog";
import { Check, Plus } from "@/lib/icons";
import { can, type Session } from "@/lib/permissions";
import {
  STATUS_LABEL,
  STATUS_TONE,
  euros,
  eurosComSinal,
  listTransactions,
  updateTransaction,
  type FinanceKind,
  type TransactionRow,
} from "@/lib/finance";

/**
 * O dinheiro de um evento, dentro da gaveta do calendário.
 *
 * Um jogo fora tem autocarro, arbitragem, lanche — e às vezes bilheteira. Quem
 * marca o evento é quem sabe os custos, por isso é aqui que eles se estimam: um
 * custo registado como **previsto** aparece sozinho nas despesas previstas das
 * Contas, ligado ao evento. Quando a fatura chega, confirma-se na linha —
 * previsto e realizado nunca se confundem.
 *
 * Só aparece a quem pode ver as Contas: o resto da gaveta é de todos, o
 * dinheiro não.
 */
export function EventFinance({
  session,
  link,
  eventLabel,
}: {
  session: Session;
  /** Exactamente um dos dois — jogos ligam-se pelo jogo, o resto pelo evento. */
  link: { matchId?: string; calendarEventId?: string };
  eventLabel: string;
}) {
  const podeEscrever = can(session, "finance:write");
  const [rows, setRows] = useState<TransactionRow[] | null>(null);
  const [registar, setRegistar] = useState<FinanceKind | null>(null);
  const [aMexer, setAMexer] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      setRows(await listTransactions(link));
    } catch {
      // A gaveta é de todos; se as contas não carregam, o painel só encolhe.
      setRows([]);
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.matchId, link.calendarEventId]);

  async function confirmar(t: TransactionRow) {
    if (aMexer) return;
    setAMexer(t.id);
    setErro(null);
    try {
      await updateTransaction(t.id, { status: "COMPLETED" });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível confirmar.");
    } finally {
      setAMexer(null);
    }
  }

  const ativos = (rows ?? []).filter((t) => t.status !== "CANCELLED");
  const saldo = ativos.reduce((s, t) => s + (t.kind === "INCOME" ? t.amountCents : -t.amountCents), 0);
  const porConfirmar = ativos.filter((t) => t.status === "PLANNED" || t.status === "PENDING").length;

  if (rows === null) return null;
  if (rows.length === 0 && !podeEscrever) return null;

  return (
    <div className="border-t border-line px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-panel text-ink">Financeiro</h3>
        {rows.length > 0 && (
          <span className={cx("text-meta font-semibold tabular", saldo < 0 ? "text-ink" : "text-ok")}>
            {eurosComSinal(saldo)}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="mb-3 text-meta text-ink-3">
          Sem custos nem receitas registados. Um custo previsto aparece logo nas despesas previstas das Contas.
        </p>
      ) : (
        <ul className="mb-3 space-y-1">
          {rows.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-[var(--radius-control)] bg-sunken/50 px-2.5 py-1.5">
              <span className="min-w-0 flex-1">
                <span
                  className={cx(
                    "block truncate text-body",
                    t.status === "CANCELLED" ? "text-ink-4 line-through" : "text-ink-2",
                  )}
                >
                  {t.description}
                </span>
              </span>
              <Pill tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Pill>
              <span
                className={cx(
                  "shrink-0 text-meta font-semibold tabular",
                  t.status === "CANCELLED" ? "text-ink-4 line-through" : t.kind === "INCOME" ? "text-ok" : "text-ink",
                )}
              >
                {t.kind === "INCOME" ? "+" : "−"}
                {euros(t.amountCents)}
              </span>
              {podeEscrever && (t.status === "PLANNED" || t.status === "PENDING") && (
                <button
                  type="button"
                  onClick={() => void confirmar(t)}
                  disabled={aMexer === t.id}
                  className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink-4 hover:bg-ok-soft hover:text-ok"
                  aria-label={t.kind === "INCOME" ? "Marcar como recebida" : "Marcar como paga"}
                  title={t.kind === "INCOME" ? "Marcar como recebida" : "Marcar como paga"}
                >
                  <Check className="size-3.5" strokeWidth={2} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {erro && <p className="mb-2 text-meta text-risk">{erro}</p>}

      {porConfirmar > 0 && (
        <p className="mb-3 text-meta text-ink-3">
          {porConfirmar === 1 ? "1 movimento previsto por confirmar" : `${porConfirmar} movimentos previstos por confirmar`} —
          confirma quando o dinheiro se mexer, ou trata disso nos{" "}
          <Link to="/contas/movimentos?estado=PLANNED" className="font-medium text-ink underline underline-offset-2">
            movimentos
          </Link>
          .
        </p>
      )}

      {podeEscrever && (
        <button
          type="button"
          className="ctl-outline w-full justify-center"
          onClick={() => setRegistar("EXPENSE")}
        >
          <Plus className="size-3.5" strokeWidth={2} />
          Movimento deste jogo
        </button>
      )}

      {registar && (
        <TransactionDialog
          kind={registar}
          eventLink={{ ...link, label: eventLabel }}
          onClose={() => setRegistar(null)}
          onDone={() => {
            setRegistar(null);
            void carregar();
          }}
        />
      )}
    </div>
  );
}

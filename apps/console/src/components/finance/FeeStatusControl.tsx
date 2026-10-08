import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { MetodoDePagamentoDialog, type MetodoManual } from "@/components/finance/MetodoDePagamento";
import { Check, ChevronDown, Trash2, TriangleAlert } from "@/lib/icons";
import { athleteById } from "@/lib/api";
import { apiDelete, apiPatch } from "@/lib/http";
import { reloadFees } from "@/lib/store";
import { money, periodLabel, shortName } from "@/lib/format";
import type { Fee, FeeStatus } from "@/data/types";

/*
 * O estado de uma mensalidade, clicável: marcar paga, por pagar, anular ou
 * apagar. Vivia dentro da página de Mensalidades; saiu para aqui para a ficha
 * do atleta usar o mesmo controlo, com as mesmas regras.
 */

/**
 * O estado de uma mensalidade, dito como quem o lê.
 *
 * "Pendente" era o rótulo de `pending` e dizia a coisa errada: em português,
 * um pagamento pendente é um pagamento **a decorrer** — e essa é exactamente a
 * descrição de `processing`, o estado que existe enquanto a euPago não confirma.
 * Dois estados diferentes com o mesmo nome, e o mais comum dos dois a usar o
 * nome do outro.
 *
 * "Não pago" não tem essa ambiguidade: ninguém pagou, e o prazo ainda não
 * passou. Passado o prazo, "Vencido". São três palavras que a direcção já usa
 * ao telefone com as famílias.
 */
export const STATUS_LABEL: Record<FeeStatus, string> = {
  paid: "Pago",
  processing: "A confirmar",
  pending: "Não pago",
  overdue: "Vencido",
  void: "Anulada",
};

export const STATUS_TONE = { paid: "ok", processing: "signal", pending: "warn", overdue: "risk", void: "neutral" } as const;

/** As mesmas cores do `Pill` partilhado — aqui à parte porque o rótulo do estado
 * passa a ser o próprio botão (texto + seta juntos), não um `<Pill>` por dentro. */
const TONE_CLASS: Record<(typeof STATUS_TONE)[keyof typeof STATUS_TONE], string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  risk: "bg-risk-soft text-risk",
  neutral: "bg-sunken text-ink-2",
  signal: "bg-signal-soft text-signal-ink",
};

/**
 * As três decisões que a direção pode tomar à mão sobre uma mensalidade, e o estado
 * (`ChargeStatus`) que cada uma grava. "A confirmar" e "Vencido" não são opções —
 * são derivados (do pagamento em curso, da data), não escolhas.
 */
const MANUAL_OPTIONS = [
  { value: "SETTLED", label: "Marcar como paga", tone: "ok" as const },
  { value: "OPEN", label: "Marcar por pagar", tone: "warn" as const },
  { value: "VOID", label: "Anular", tone: "neutral" as const },
];

/** Qual das opções manuais corresponde ao estado atual — para a assinalar no menu. */
function currentTarget(status: FeeStatus): string {
  if (status === "paid") return "SETTLED";
  if (status === "void") return "VOID";
  return "OPEN";
}

/**
 * O estado de uma mensalidade, editável pela direção.
 *
 * O Pill continua a dizer tudo — "Vencido", "A confirmar", "Anulada" —, mas passa a
 * ser um gatilho: um clique abre as três decisões manuais. O menu vive num **portal**
 * (em `document.body`) porque a tabela recorta o que transborda; sem isso, um menu
 * aberto na última linha ficava cortado por baixo.
 */
/** Altura aproximada do menu — três opções fixas, sempre o mesmo tamanho. */
const STATUS_MENU_HEIGHT = 160;

export function FeeStatusControl({ fee }: { fee: Fee }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /*
   * Apagar, e o que correu mal.
   *
   * O erro não existia: uma mudança de estado que falhasse ficava calada. Com
   * apagar isso não serve — o servidor recusa as pagas online e as que têm uma
   * referência viva, e a razão tem de chegar a quem carregou.
   */
  const [aApagar, setAApagar] = useState(false);
  /** A perguntar como foi paga, antes de a marcar como paga. */
  const [aPagar, setAPagar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const target = currentTarget(fee.status);

  useEffect(() => {
    if (!open) return;
    // Scroll ou redimensionar fecha o menu — não vale a pena persegui-lo pela página.
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    // A linha inteira navega para a ficha do atleta — sem isto, abrir o menu de
    // estado levava também para lá, a meio do clique. `preventDefault` também,
    // para nenhum comportamento por omissão do botão escapar ao `stopPropagation`.
    e.preventDefault();
    e.stopPropagation();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.max(8, r.right - 180);
      const spaceBelow = window.innerHeight - r.bottom;
      // Cabe por baixo? Abre por baixo. Senão, e se couber por cima, abre por
      // cima — é a última linha da tabela que mais precisa disto, cortada ao
      // fundo do ecrã sempre que o menu insistia em abrir para baixo.
      if (spaceBelow >= STATUS_MENU_HEIGHT + 8 || r.top < STATUS_MENU_HEIGHT + 8) {
        setPos({ top: r.bottom + 4, left });
      } else {
        setPos({ bottom: window.innerHeight - r.top + 4, left });
      }
    }
    setOpen((v) => !v);
  };

  async function choose(e: React.MouseEvent, value: string) {
    // Mesma razão do `toggle`: um portal continua a ser filho da linha na árvore
    // React (mesmo vivendo fisicamente em `document.body`), e o clique borbulha
    // até ao `onClick` da linha se não se parar aqui.
    e.stopPropagation();
    setOpen(false);
    if (value === target || busy) return;
    // Marcar como paga pergunta primeiro como foi paga. Ver `MetodoDePagamentoDialog`.
    if (value === "SETTLED") {
      setAPagar(true);
      return;
    }
    await gravar(value);
  }

  async function gravar(value: string, method?: MetodoManual) {
    setBusy(true);
    setErro(null);
    try {
      await apiPatch(`/api/charges/${fee.id}/status`, { status: value, ...(method ? { method } : {}) });
      setAPagar(false);
      await reloadFees();
    } catch (err) {
      setAPagar(false);
      setErro(err instanceof Error ? err.message : "Não foi possível mudar o estado.");
    } finally {
      setBusy(false);
    }
  }

  async function apagar() {
    if (busy) return;
    setBusy(true);
    setErro(null);
    try {
      await apiDelete(`/api/charges/${fee.id}`);
      setAApagar(false);
      await reloadFees();
    } catch (err) {
      setAApagar(false);
      setErro(err instanceof Error ? err.message : "Não foi possível apagar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        onMouseDown={(e) => e.stopPropagation()}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Alterar estado"
        className={cx(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-tight font-semibold transition-opacity duration-[120ms] hover:opacity-75 disabled:opacity-50",
          TONE_CLASS[STATUS_TONE[fee.status]],
        )}
      >
        {STATUS_LABEL[fee.status]}
        <ChevronDown className="size-3" strokeWidth={2.5} />
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
              aria-hidden
            />
            <div
              role="menu"
              style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
              className="fixed z-50 w-[180px] rounded-[var(--radius-panel)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
            >
              {MANUAL_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="menuitem"
                  onClick={(e) => void choose(e, o.value)}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-body transition-colors duration-[120ms] hover:bg-sunken",
                    o.value === target ? "text-ink" : "text-ink-2",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-signal-ink">
                    {o.value === target && <Check className="size-3.5" strokeWidth={2.5} />}
                  </span>
                  <span className="flex-1">{o.label}</span>
                </button>
              ))}
              <div className="my-1 border-t border-line" />
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  setAApagar(true);
                }}
                className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-body text-risk transition-colors duration-[120ms] hover:bg-risk-soft"
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <Trash2 className="size-3.5" strokeWidth={1.9} />
                </span>
                <span className="flex-1">Apagar</span>
              </button>
            </div>
          </>,
          document.body,
        )}

      {/*
        A pergunta e o erro, num portal e com a propagação parada.

        O controlo vive dentro de uma linha que navega para a ficha do atleta ao
        clicar; um portal continua a ser filho dela na árvore React, e um clique
        em "Cancelar" levava também para lá. O `div` de fora pára isso.
      */}
      {(aApagar || aPagar || erro) &&
        createPortal(
          <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            {aPagar && (
              <MetodoDePagamentoDialog
                titulo={`${shortName(athleteById(fee.athleteId)?.name ?? "")} · ${
                  fee.extra ? (fee.title ?? "Cobrança") : periodLabel(fee.period)
                } · ${money(fee.amountCents)}`}
                busy={busy}
                onConfirm={(m) => void gravar("SETTLED", m)}
                onClose={() => setAPagar(false)}
              />
            )}
            {aApagar && (
              <Dialog
                title="Apagar mensalidade?"
                icon={<Trash2 className="size-4" strokeWidth={1.75} />}
                onClose={() => setAApagar(false)}
                width={420}
                labelledBy="apagar-mensalidade"
                footer={
                  <div className="flex w-full items-center justify-end gap-2">
                    <button type="button" className="ctl-ghost" onClick={() => setAApagar(false)} disabled={busy}>
                      Cancelar
                    </button>
                    <button type="button" className="ctl-risk" onClick={() => void apagar()} disabled={busy}>
                      <Trash2 className="size-3.5" strokeWidth={1.9} />
                      {busy ? "A apagar…" : "Apagar"}
                    </button>
                  </div>
                }
              >
                <p className="p-5 text-body leading-relaxed text-ink-2">
                  Apagar{" "}
                  <strong className="font-medium text-ink">
                    {fee.extra ? (fee.title ?? "esta cobrança") : `a mensalidade de ${periodLabel(fee.period)}`}
                  </strong>{" "}
                  ({money(fee.amountCents)})? Não há como voltar atrás.
                </p>
              </Dialog>
            )}
            {erro && !aApagar && (
              <Dialog
                title="Não foi possível"
                icon={<TriangleAlert className="size-4" strokeWidth={1.75} />}
                onClose={() => setErro(null)}
                width={420}
                labelledBy="erro-mensalidade"
                footer={
                  <button type="button" className="ctl-outline" onClick={() => setErro(null)}>
                    Fechar
                  </button>
                }
              >
                <p className="p-5 text-body leading-relaxed text-ink-2">{erro}</p>
              </Dialog>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}


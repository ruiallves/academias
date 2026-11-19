import { useState } from "react";
import { cx } from "@/components/primitives";
import { CalendarDays, Hourglass, PackageCheck } from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { entregarGuardada, hojeISO, type Assignment } from "@/lib/inventory";

/**
 * O equipamento por entregar, nas listas.
 *
 * Uma peça por entregar é do atleta (pode até estar paga), mas ainda está no
 * clube. Nas listas lê-se pela pastilha âmbar e pelo botão "Entregar", que a
 * passa a entregue com um toque. As pastilhas do estado e do pagamento abrem o
 * "Editar", onde se muda tudo, para os dois lados. O "Não vai ser entregue"
 * fica lá: é raro, e devolve a peça ao stock.
 *
 * Os erros da API aparecem no cartão de avisos do canto (`lib/http`).
 */
export function BotaoEntregar({
  assignment,
  onDone,
  className,
}: {
  assignment: Pick<Assignment, "id" | "itemName">;
  onDone: () => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      aria-label={`Marcar ${assignment.itemName} como entregue`}
      className={cx("ctl-outline h-7 text-meta", className)}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          await entregarGuardada(assignment.id);
          onDone();
        } catch {
          /* O aviso já apareceu no canto. */
        } finally {
          setBusy(false);
        }
      }}
    >
      <PackageCheck className="size-3.5" strokeWidth={1.75} />
      {busy ? "A entregar…" : "Entregar"}
    </button>
  );
}

/**
 * O estado de uma peça que ainda é assunto, como pastilha: "Entregue" ou "Por
 * entregar". Com `onClick` é um botão: abre o editor, onde se muda.
 */
export function EstadoDaEntregaPill({ status, onClick }: { status: Assignment["status"]; onClick?: () => void }) {
  if (status !== "ACTIVE" && status !== "RESERVED") return null;
  const porEntregar = status === "RESERVED";
  const classe = cx(
    "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
    porEntregar ? "bg-warn-soft text-warn" : "bg-sunken text-ink-2",
    onClick && "cursor-pointer transition-[filter] hover:brightness-95",
  );
  const corpo = (
    <>
      {porEntregar ? <Hourglass className="size-3" strokeWidth={2} /> : <PackageCheck className="size-3" strokeWidth={2} />}
      {porEntregar ? "Por entregar" : "Entregue"}
    </>
  );
  if (!onClick) return <span className={classe}>{corpo}</span>;
  return (
    <button
      type="button"
      className={classe}
      title="Mudar"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {corpo}
    </button>
  );
}

/**
 * Como foi a entrega. Três respostas, porque são três situações diferentes ao
 * balcão (Rui, 19/11/2026):
 *
 * - **Entregue agora**: o atleta leva a peça neste momento;
 * - **Noutro dia**: foi entregue num dia que já passou, e só agora se regista
 *   (o kit da pré-época que nunca chegou a entrar no sistema);
 * - **Por entregar**: é dele mas fica no clube, guardada.
 */
export type EstadoDaEntrega = { modo: "agora" | "dia" | "porEntregar"; dia: string };

export const ENTREGUE_AGORA: EstadoDaEntrega = { modo: "agora", dia: "" };

/** Pronto a gravar? "Noutro dia" precisa de um dia que já aconteceu. */
export const entregaValida = (e: EstadoDaEntrega) =>
  e.modo !== "dia" || (/^\d{4}-\d{2}-\d{2}$/.test(e.dia) && e.dia <= hojeISO());

/**
 * O seletor da entrega: no "Entregar equipamento" e no "Editar equipamento".
 * O mesmo desenho do pagamento, que vem logo a seguir: são as duas perguntas
 * do balcão.
 *
 * `jaEntregue` é o editar de uma peça que já está com o atleta: aí "Entregue"
 * é uma opção só, com o dia gravado à vista para se corrigir.
 */
export function CampoDaEntrega({
  value,
  onChange,
  primeiroNome,
  jaEntregue = false,
}: {
  value: EstadoDaEntrega;
  onChange: (e: EstadoDaEntrega) => void;
  primeiroNome?: string;
  jaEntregue?: boolean;
}) {
  const opcoes: [EstadoDaEntrega["modo"], string][] = jaEntregue
    ? [
        ["dia", "Entregue"],
        ["porEntregar", "Por entregar"],
      ]
    : [
        ["agora", "Entregue agora"],
        ["dia", "Noutro dia"],
        ["porEntregar", "Por entregar"],
      ];

  return (
    <section className="overflow-hidden rounded-[12px] border border-line">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-2.5">
        <span className="text-meta font-medium text-ink-2">Entrega</span>
        <div role="radiogroup" aria-label="Entrega" className="flex rounded-[var(--radius-control)] bg-sunken p-0.5">
          {opcoes.map(([v, rotulo]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={value.modo === v}
              onClick={() => onChange({ modo: v, dia: v === "dia" ? value.dia : "" })}
              className={cx(
                "rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
                value.modo === v ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-3 hover:text-ink",
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>
      {value.modo === "dia" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line bg-sunken/40 px-3.5 py-3">
          <CalendarDays className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
          <label htmlFor="dia-da-entrega" className="min-w-0 flex-1 text-meta leading-relaxed text-ink-2">
            {jaEntregue ? "Entregue a" : `Em que dia ${primeiroNome ?? "o atleta"} levou o material?`}
          </label>
          <input
            id="dia-da-entrega"
            type="date"
            value={value.dia}
            max={hojeISO()}
            onChange={(e) => onChange({ modo: "dia", dia: e.target.value })}
            aria-invalid={!value.dia}
            className={cx(
              "h-9 rounded-[var(--radius-control)] border bg-surface px-2.5 text-body text-ink tabular focus:border-line-strong focus:outline-none",
              value.dia ? "border-line" : "border-warn",
            )}
          />
        </div>
      )}
      {value.modo === "porEntregar" && (
        <p className="flex items-start gap-2 border-t border-line bg-sunken/40 px-3.5 py-3 text-meta leading-relaxed text-ink-2">
          <Hourglass className="mt-0.5 size-3.5 shrink-0 text-warn" strokeWidth={1.75} />
          <span>
            Fica guardado para {primeiroNome ?? "o atleta"} e fora do stock disponível. Quando o levar, muda-se para Entregue
            aqui, na ficha do atleta ou no Inventário.
          </span>
        </p>
      )}
    </section>
  );
}

/** "desde 3 nov" ou "entregue a 3 nov": o que a linha diz sobre a data, pelo estado. */
export function quandoDaEntrega(a: Pick<Assignment, "status" | "assignedAt" | "returnedAt">): string {
  if (a.status === "RESERVED") return `por entregar desde ${shortDate(new Date(a.assignedAt))}`;
  if (a.status === "ACTIVE") return `entregue a ${shortDate(new Date(a.assignedAt))}`;
  return a.returnedAt ? shortDate(new Date(a.returnedAt)) : "—";
}

import { useState } from "react";
import { cx } from "@/components/primitives";
import { Hourglass, PackageCheck } from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { entregarGuardada, type Assignment } from "@/lib/inventory";

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
 * Entregue ou por entregar, num seletor: no "Entregar equipamento" (onde diz
 * "Entregue agora") e no "Editar entrega". O mesmo desenho do pagamento, que
 * vem logo a seguir: são as duas perguntas do balcão.
 */
export function CampoDaEntrega({
  value,
  onChange,
  primeiroNome,
  rotuloEntregue = "Entregue",
}: {
  value: boolean;
  onChange: (entregue: boolean) => void;
  primeiroNome?: string;
  rotuloEntregue?: string;
}) {
  return (
    <section className="overflow-hidden rounded-[12px] border border-line">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-2.5">
        <span className="text-meta font-medium text-ink-2">Entrega</span>
        <div role="radiogroup" aria-label="Entrega" className="flex rounded-[var(--radius-control)] bg-sunken p-0.5">
          {(
            [
              [true, rotuloEntregue],
              [false, "Por entregar"],
            ] as const
          ).map(([v, rotulo]) => (
            <button
              key={rotulo}
              type="button"
              role="radio"
              aria-checked={value === v}
              onClick={() => onChange(v)}
              className={cx(
                "rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
                value === v ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-3 hover:text-ink",
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>
      {!value && (
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

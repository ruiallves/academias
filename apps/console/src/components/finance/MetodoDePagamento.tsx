import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { Wallet } from "@/lib/icons";
import mbway from "@/assets/pagamentos/mbway.png";

/**
 * Os métodos de um pagamento registado à mão.
 *
 * Os mesmos três que o servidor aceita (`METODOS_MANUAIS`): o que um clube
 * recebe em mão ou ao balcão. Multibanco e os outros chegam pela euPago, com o
 * método que ela confirma.
 */
export type MetodoManual = "MBWAY" | "CASH" | "CARD";

/*
 * A marca do MB WAY é o logótipo oficial, o mesmo do site. Numerário e cartão
 * não têm marca: um emoji diz-o à primeira, sem parecer um ícone de biblioteca.
 */
export const METODOS: { value: MetodoManual; label: string; marca: ReactNode }[] = [
  {
    value: "MBWAY",
    label: "MB WAY",
    marca: <img src={mbway} alt="" aria-hidden className="h-5 w-auto select-none" draggable={false} />,
  },
  { value: "CASH", label: "Numerário", marca: <span aria-hidden className="text-[20px] leading-none">💶</span> },
  { value: "CARD", label: "Cartão", marca: <span aria-hidden className="text-[20px] leading-none">💳</span> },
];

/** Os três métodos, lado a lado. Nenhum vem escolhido: é uma pergunta, não um valor por omissão. */
export function EscolherMetodo({
  value,
  onChange,
}: {
  value: MetodoManual | null;
  onChange: (m: MetodoManual) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Método de pagamento" className="grid grid-cols-3 gap-2">
      {METODOS.map((m) => {
        const on = value === m.value;
        return (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(m.value)}
            /*
              O escolhido marca-se com o contorno, e não com o fundo escuro dos
              outros botões do diálogo: o logótipo do MB WAY tem o "MB" a
              preto, e sobre fundo escuro deixava de se ler.
            */
            className={cx(
              "flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-[var(--radius-control)] border bg-surface text-meta font-semibold transition-colors duration-[120ms]",
              on
                ? "border-ink text-ink ring-1 ring-ink"
                : "border-line text-ink-2 hover:border-line-strong hover:bg-sunken",
            )}
          >
            <span className="flex h-6 items-center">{m.marca}</span>
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A pergunta "como foi paga?", ao marcar uma mensalidade como paga na tabela.
 *
 * Antes gravava sempre numerário, calado. Uma mensalidade paga por MB WAY ao
 * treinador ficava registada como dinheiro, e a contabilidade do clube não
 * tinha como separar o que entrou em caixa do que entrou na conta.
 */
export function MetodoDePagamentoDialog({
  titulo,
  busy,
  onConfirm,
  onClose,
}: {
  titulo: string;
  busy?: boolean;
  onConfirm: (m: MetodoManual) => void;
  onClose: () => void;
}) {
  const [metodo, setMetodo] = useState<MetodoManual | null>(null);

  return (
    <Dialog
      labelledBy="metodo-pagamento"
      title="Como foi paga?"
      subtitle={titulo}
      icon={<Wallet className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => metodo && onConfirm(metodo)}
            className="ctl-primary"
            disabled={!metodo || busy}
          >
            {busy ? "A guardar…" : "Marcar como paga"}
          </button>
        </>
      }
    >
      <div className="space-y-2.5 p-5">
        <EscolherMetodo value={metodo} onChange={setMetodo} />
        <p className="text-meta text-ink-3">Fica registada como paga hoje.</p>
      </div>
    </Dialog>
  );
}

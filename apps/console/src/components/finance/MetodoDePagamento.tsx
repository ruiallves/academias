import { useId, useState, type ReactNode } from "react";
import { Dialog, dialogInputClass } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { Wallet } from "@/lib/icons";
import { periodLabel } from "@/lib/format";
import mbway from "@/assets/pagamentos/mbway.png";

/**
 * Os métodos de um pagamento registado à mão.
 *
 * Os mesmos quatro que o servidor aceita (`METODOS_MANUAIS`): o que um clube
 * recebe em mão, ao balcão ou por transferência para a conta dele. Multibanco e os outros chegam pela euPago, com o
 * método que ela confirma.
 */
export type MetodoManual = "MBWAY" | "CASH" | "CARD" | "TRANSFER";

/*
 * A marca do MB WAY é o logótipo oficial, o mesmo do site. Numerário, cartão e
 * transferência não têm marca: um emoji diz-o à primeira, sem parecer um ícone de biblioteca.
 */
export const METODOS: { value: MetodoManual; label: string; marca: ReactNode }[] = [
  {
    value: "MBWAY",
    label: "MB WAY",
    marca: <img src={mbway} alt="" aria-hidden className="h-5 w-auto select-none" draggable={false} />,
  },
  { value: "CASH", label: "Numerário", marca: <span aria-hidden className="text-[20px] leading-none">💶</span> },
  { value: "CARD", label: "Cartão", marca: <span aria-hidden className="text-[20px] leading-none">💳</span> },
  { value: "TRANSFER", label: "Transferência", marca: <span aria-hidden className="text-[20px] leading-none">🏦</span> },
];

/** Os quatro métodos, dois a dois. Nenhum vem escolhido: é uma pergunta, não um valor por omissão. */
export function EscolherMetodo({
  value,
  onChange,
}: {
  value: MetodoManual | null;
  onChange: (m: MetodoManual) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Método de pagamento" className="grid grid-cols-2 gap-2">
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

/* -------------------------------------------------------------------------- */
/* O dia do pagamento                                                          */
/* -------------------------------------------------------------------------- */

const dois = (n: number) => String(n).padStart(2, "0");

/** Hoje, `AAAA-MM-DD`, no relógio de quem está à consola. */
export function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/**
 * O dia por omissão de uma mensalidade paga à mão: dentro do mês dela.
 *
 * Um mês que já passou fica no dia de vencimento (quando devia ter sido paga;
 * se o vencimento cair fora do mês, o último dia do mês). O mês corrente, ou
 * um adiantado, fica hoje. A mesma regra do servidor (`dia-do-pagamento.ts`).
 */
export function diaPorOmissao(period: string, dueDate?: string): string {
  const hoje = hojeISO();
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m || period >= hoje.slice(0, 7)) return hoje;
  const venc = dueDate?.slice(0, 10);
  if (venc && venc.slice(0, 7) === period) return venc;
  const ultimo = new Date(Number(m[1]), Number(m[2]), 0).getDate();
  return `${period}-${dois(ultimo)}`;
}

/** Um dia que se pode gravar: bem escrito e não depois de hoje. */
export function diaValido(dia: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) && dia <= hojeISO() && dia >= "2000-01-01";
}

const nomeDoMes = (period: string) => periodLabel(period).toLocaleLowerCase("pt");

/**
 * A data do pagamento, com uma nota a dizer em que mês das Contas fica.
 *
 * As Contas contam as mensalidades no mês em que foram pagas. Antes a data era
 * sempre o dia do clique, e a mensalidade de julho registada em outubro
 * entrava em outubro mesmo tendo o dinheiro entrado em julho.
 *
 * `plural` quando são várias de uma vez.
 */
export function DataDoPagamento({
  value,
  onChange,
  plural,
}: {
  value: string;
  onChange: (dia: string) => void;
  plural?: boolean;
}) {
  const id = useId();
  const hoje = hojeISO();
  const valido = diaValido(value);
  const mesPago = value.slice(0, 7);

  return (
    <div>
      {/* O "Hoje" fica fora do <label>: um toque dentro dele ia parar ao campo. */}
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-meta font-medium text-ink">
          Data do pagamento
        </label>
        {value !== hoje && (
          <button
            type="button"
            onClick={() => onChange(hoje)}
            className="text-[11px] text-ink-3 underline underline-offset-2 transition-colors duration-[120ms] hover:text-ink"
          >
            Hoje
          </button>
        )}
      </div>
      <input
        id={id}
        type="date"
        value={value}
        max={hoje}
        required
        onChange={(e) => onChange(e.target.value)}
        className={cx(dialogInputClass, "tabular", value && !valido && "border-risk")}
      />
      <p className={cx("mt-1.5 text-meta leading-relaxed", valido ? "text-ink-3" : "text-risk")}>
        {!valido ? (
          value > hoje ? "O pagamento não pode ter uma data depois de hoje." : "Escolhe o dia em que o dinheiro entrou."
        ) : (
          <>
            {plural ? "Entram" : "Entra"} nas contas de{" "}
            <strong className="font-medium text-ink-2">{nomeDoMes(mesPago)}</strong>.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * A pergunta "como foi paga?", ao marcar uma mensalidade como paga na tabela.
 *
 * Antes gravava sempre numerário, calado. Uma mensalidade paga por MB WAY ao
 * treinador ficava registada como dinheiro, e a contabilidade do clube não
 * tinha como separar o que entrou em caixa do que entrou na conta.
 *
 * Pergunta também o dia, que começa no mês da mensalidade (`diaPorOmissao`).
 */
export function MetodoDePagamentoDialog({
  titulo,
  period,
  dueDate,
  busy,
  onConfirm,
  onClose,
}: {
  titulo: string;
  /** O mês da mensalidade, `AAAA-MM`: é dele que vem o dia por omissão. */
  period: string;
  dueDate?: string;
  busy?: boolean;
  onConfirm: (m: MetodoManual, dia: string) => void;
  onClose: () => void;
}) {
  const [metodo, setMetodo] = useState<MetodoManual | null>(null);
  const [dia, setDia] = useState(() => diaPorOmissao(period, dueDate));

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
            onClick={() => metodo && diaValido(dia) && onConfirm(metodo, dia)}
            className="ctl-primary"
            disabled={!metodo || !diaValido(dia) || busy}
          >
            {busy ? "A guardar…" : "Marcar como paga"}
          </button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <EscolherMetodo value={metodo} onChange={setMetodo} />
        <DataDoPagamento value={dia} onChange={setDia} />
      </div>
    </Dialog>
  );
}

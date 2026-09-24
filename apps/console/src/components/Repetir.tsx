import { useState } from "react";
import { DialogField, dialogInputClass } from "./Dialog";
import { cx } from "./primitives";

export type Frequencia = "DAILY" | "WEEKLY" | "MONTHLY";

/** O que o servidor recebe em `repeat`. A forma é a de `RepeatDto`, nos eventos e nas consultas. */
export type Repeticao = { freq: Frequencia; until: string; weekdays?: number[] };

/**
 * O estado da repetição, para quem tem o formulário.
 *
 * `weekdays` arranca com o dia da data escolhida — marcar "todas as terças"
 * quando já se escolheu uma terça é a repetição que noventa por cento das
 * pessoas quer, e assim não é preciso escolher nada.
 *
 * `repeat` só existe com a caixa ligada **e** uma data de fim: sem fim, a
 * repetição não vale e o pedido segue como um só.
 */
export function useRepeticao(date: string) {
  const [ligada, setLigada] = useState(false);
  const [freq, setFreq] = useState<Frequencia>("WEEKLY");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [until, setUntil] = useState("");

  const diaDaData = new Date(`${date}T00:00:00`).getDay();
  const diasEscolhidos = weekdays.length > 0 ? weekdays : [diaDaData];

  function toggleDia(d: number) {
    setWeekdays((xs) => {
      const base = xs.length > 0 ? xs : [diaDaData];
      return base.includes(d) ? base.filter((x) => x !== d) : [...base, d].sort();
    });
  }

  const repeat: Repeticao | undefined =
    ligada && until ? { freq, until, ...(freq === "WEEKLY" ? { weekdays: diasEscolhidos } : {}) } : undefined;

  return { ligada, setLigada, freq, setFreq, diasEscolhidos, toggleDia, until, setUntil, date, repeat };
}

/**
 * Repetir.
 *
 * Fechado por omissão — a maioria das marcações é uma só, e abrir o formulário
 * com isto à vista faz toda a gente decidir uma coisa que não queria decidir.
 *
 * Cada ocorrência fica um registo a sério: um treino repetido abre uma folha de
 * presenças por dia, uma consulta repetida é uma consulta por dia, e desmarcar a
 * quinta-feira em que choveu não mexe nas outras.
 */
export function Repetir({ r, dica }: { r: ReturnType<typeof useRepeticao>; dica: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line">
      <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5">
        <input
          type="checkbox"
          checked={r.ligada}
          onChange={(e) => r.setLigada(e.target.checked)}
          className="size-3.5 accent-[var(--color-signal)]"
        />
        <span className="text-body text-ink">Repetir</span>
        <span className="text-meta text-ink-3">{dica}</span>
      </label>

      {r.ligada && (
        <div className="space-y-3 border-t border-line p-3">
          <div className="flex gap-1.5">
            {([["DAILY", "Todos os dias"], ["WEEKLY", "Semanal"], ["MONTHLY", "Mensal"]] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => r.setFreq(v)}
                aria-pressed={r.freq === v}
                className={cx(
                  "rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium transition-colors",
                  r.freq === v ? "border-transparent bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {r.freq === "WEEKLY" && (
            <div>
              <span className="mb-1.5 block text-meta font-medium text-ink">Em que dias</span>
              <div className="flex gap-1">
                {["D", "S", "T", "Q", "Q", "S", "S"].map((letra, d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => r.toggleDia(d)}
                    aria-pressed={r.diasEscolhidos.includes(d)}
                    aria-label={["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][d]}
                    className={cx(
                      "size-7 rounded-full text-meta font-semibold transition-colors",
                      r.diasEscolhidos.includes(d) ? "bg-ink text-surface" : "bg-sunken text-ink-3 hover:text-ink",
                    )}
                  >
                    {letra}
                  </button>
                ))}
              </div>
            </div>
          )}

          <DialogField label="Até" hint="o último dia, incluído">
            <input
              type="date"
              value={r.until}
              min={r.date}
              onChange={(e) => r.setUntil(e.target.value)}
              className={dialogInputClass}
            />
          </DialogField>

          {!r.until && <p className="text-[11px] text-ink-4">Escolhe uma data de fim para a repetição valer.</p>}
        </div>
      )}
    </div>
  );
}

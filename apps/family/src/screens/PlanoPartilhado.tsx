import { useEffect, useState } from "react";
import { Dumbbell } from "lucide-react";
import { planoPartilhado, type PlanoPartilhado as Plano } from "@/lib/atleta";
import { Bar, cx } from "@/ui";

/**
 * O plano do treino, como o atleta o lê — dentro do ecrã do treino.
 *
 * Só aparece quando o treinador o partilhou (`planShared` no treino): antes
 * disso não há secção nenhuma, nem um "por partilhar" a insinuar que falta
 * qualquer coisa. O que chega é o que se lê num campo — o objectivo, o tipo
 * de sessão, os blocos por ordem com os minutos e o que é para fazer — sem o
 * desenho dos exercícios nem o balanço do treinador, que são trabalho dele.
 */
export function PlanoPartilhado({ sessionId }: { sessionId: string }) {
  const [plano, setPlano] = useState<Plano | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let vivo = true;
    setPlano(null);
    setErro(false);
    planoPartilhado(sessionId)
      .then((p) => vivo && setPlano(p))
      .catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
    };
  }, [sessionId]);

  // Um plano que não chega não deixa buraco: a secção simplesmente não existe.
  if (erro) return null;

  const total = plano?.blocks.reduce((n, b) => n + b.durationMin, 0) ?? 0;

  return (
    <section className="mt-3 overflow-hidden rounded-[var(--radius-xl)] bg-surface shadow-[var(--shadow-soft)]">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
          <Dumbbell className="size-[18px]" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Plano de treino</p>
          <p className="truncate text-body font-semibold text-ink">
            {plano ? (plano.objective ?? plano.sessionType ?? "O plano do treinador") : "A carregar…"}
          </p>
        </div>
        {plano && total > 0 && <span className="num shrink-0 text-meta font-semibold text-ink-3">{total} min</span>}
      </header>

      {plano && (
        <div className="px-4 py-3">
          {(plano.sessionType || plano.intensity !== null) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-3">
              {plano.sessionType && <span>{plano.sessionType}</span>}
              {plano.intensity !== null && (
                <span className="flex items-center gap-2">
                  Intensidade
                  <span className="w-16">
                    <Bar value={plano.intensity / 10} tone={plano.intensity >= 8 ? "warn" : "signal"} />
                  </span>
                  <span className="num">{plano.intensity}/10</span>
                </span>
              )}
            </div>
          )}

          {plano.objectives.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {plano.objectives.map((o) => (
                <li key={o} className="chip bg-sunken text-ink-2">
                  {o}
                </li>
              ))}
            </ul>
          )}

          {plano.material && (
            <p className="mt-2 text-meta text-ink-2">
              <span className="text-ink-3">Material · </span>
              {plano.material}
            </p>
          )}

          {plano.planNotes && (
            <p className="mt-2 whitespace-pre-wrap text-meta leading-relaxed text-ink-2">{plano.planNotes}</p>
          )}

          {plano.blocks.length > 0 && (
            <ol className="mt-3 space-y-2">
              {plano.blocks.map((b, i) => (
                <li key={b.id} className={cx("rounded-[var(--radius-md)] bg-sunken/70 p-3", i === 0 && "mt-0")}>
                  <div className="flex items-baseline gap-2">
                    <span className="num text-[12px] font-semibold text-ink-4">{String(i + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1 text-body font-semibold text-ink">{b.name}</span>
                    <span className="num shrink-0 text-meta font-semibold text-ink-3">{b.durationMin}'</span>
                  </div>
                  {(b.objective || b.exerciseName) && (
                    <p className="mt-1 text-meta leading-relaxed text-ink-2">
                      {b.objective ?? b.exerciseName}
                    </p>
                  )}
                  {(b.players !== null || b.space || b.intensity !== null) && (
                    <p className="mt-1 text-[12px] text-ink-3">
                      {[
                        b.players !== null ? `${b.players} jogadores` : null,
                        b.space,
                        b.intensity !== null ? `intensidade ${b.intensity}/10` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {b.notes && <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-3">{b.notes}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

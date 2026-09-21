import { useMemo } from "react";
import { cx } from "@/components/primitives";
import {
  addDays,
  cycleLength,
  daysBetween,
  defaultColor,
  microLabel,
  monthShort,
  rangeLabel,
  type Cycle,
} from "@/lib/cycles";

/**
 * A época de uma equipa numa linha: o macrociclo (a época), os
 * mesociclos, os microciclos e os jogos, com o dia de hoje marcado.
 *
 * É o "zoom para fora" do planeador: carregar num micro abre-o em baixo,
 * carregar num mesociclo edita-o. Não se desenham treinos aqui: a esta escala
 * seriam pontos sem leitura, e os treinos já têm o seu sítio logo abaixo.
 *
 * As posições são percentagens do intervalo, para a barra encher a largura que
 * houver. No telemóvel a barra tem uma largura mínima e rola na horizontal.
 */
export function SeasonBar({
  from,
  to,
  cycles,
  matchDays,
  today,
  selectedMicroId,
  viewFrom,
  viewTo,
  onPickDay,
  onPickMeso,
}: {
  from: string;
  to: string;
  cycles: Cycle[];
  matchDays: string[];
  today: string;
  selectedMicroId: string | null;
  /** O intervalo aberto em baixo, para o marcar quando não é um micro. */
  viewFrom: string;
  viewTo: string;
  onPickDay: (day: string) => void;
  onPickMeso: (meso: Cycle) => void;
}) {
  const total = daysBetween(from, to) + 1;
  const pos = (k: string) => (Math.min(Math.max(daysBetween(from, k), 0), total) / total) * 100;
  const span = (a: string, b: string) => {
    const a2 = a < from ? from : a;
    const b2 = b > to ? to : b;
    return { left: `${pos(a2)}%`, width: `${((daysBetween(a2, b2) + 1) / total) * 100}%` };
  };

  const meses = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    let k = `${from.slice(0, 7)}-01`;
    if (k < from) k = addDays(`${nextMonth(from.slice(0, 7))}-01`, 0);
    while (k <= to) {
      out.push({ key: k, label: monthShort(k) });
      k = `${nextMonth(k.slice(0, 7))}-01`;
    }
    return out;
  }, [from, to]);

  const mesos = cycles.filter((c) => c.level === "MESO" && c.endsOn >= from && c.startsOn <= to);
  const micros = cycles.filter((c) => c.level === "MICRO" && c.endsOn >= from && c.startsOn <= to);
  const noIntervalo = today >= from && today <= to;
  const vistaSemMicro = !selectedMicroId && viewTo >= from && viewFrom <= to;

  return (
    <div className="overflow-x-auto">
      <div className="relative px-5 pt-3 pb-4 max-md:min-w-[720px]">
        {/* Os meses */}
        <div className="relative h-5">
          {meses.map((m) => (
            <span
              key={m.key}
              className="absolute top-0 -translate-x-px border-l border-line pl-1.5 text-[11px] text-ink-4 uppercase"
              style={{ left: `${pos(m.key)}%` }}
            >
              {m.label}
            </span>
          ))}
        </div>

        {/* As fases */}
        <div className="relative mt-1 h-8">
          {mesos.length === 0 && (
            <div className="absolute inset-0 flex items-center rounded-[var(--radius-control)] border border-dashed border-line px-3 text-[11px] text-ink-4">
              Sem mesociclos. A época inteira é um só bloco.
            </div>
          )}
          {mesos.map((m, i) => {
            const cor = m.color ?? defaultColor(m.phase, i);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onPickMeso(m)}
                title={`${m.name ?? m.phase ?? "Fase"} · ${rangeLabel(m.startsOn, m.endsOn)}`}
                className="absolute top-0 flex h-8 items-center overflow-hidden rounded-[var(--radius-control)] px-2 text-left text-[11px] font-semibold text-ink transition-[filter] hover:brightness-95"
                style={{ ...span(m.startsOn, m.endsOn), background: `${cor}29`, boxShadow: `inset 3px 0 0 ${cor}` }}
              >
                <span className="truncate">{m.name ?? m.phase ?? "Fase"}</span>
              </button>
            );
          })}
        </div>

        {/* Os microciclos */}
        <div className="relative mt-1.5 h-6">
          {micros.map((m) => {
            const on = m.id === selectedMicroId;
            const comIntencao = Boolean(m.objective || m.focus.length);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onPickDay(m.startsOn)}
                title={`${microLabel(cycles, m)} · ${rangeLabel(m.startsOn, m.endsOn)} · ${cycleLength(m)} dias${m.objective ? ` · ${m.objective}` : ""}`}
                className={cx(
                  "absolute top-0 h-6 rounded-[4px] border-x border-surface transition-colors",
                  on ? "bg-ink" : comIntencao ? "bg-ink/25 hover:bg-ink/40" : "bg-ink/10 hover:bg-ink/25",
                )}
                style={span(m.startsOn, m.endsOn)}
                aria-label={`${microLabel(cycles, m)}, ${rangeLabel(m.startsOn, m.endsOn)}`}
                aria-pressed={on}
              />
            );
          })}
          {vistaSemMicro && (
            <span
              className="pointer-events-none absolute top-0 h-6 rounded-[4px] border-2 border-ink/35"
              style={span(viewFrom, viewTo)}
            />
          )}
          {micros.length === 0 && !vistaSemMicro && (
            <div className="absolute inset-0 flex items-center px-1 text-[11px] text-ink-4">Sem microciclos</div>
          )}
        </div>

        {/* Os jogos */}
        <div className="relative mt-1.5 h-3">
          {matchDays
            .filter((d) => d >= from && d <= to)
            .map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onPickDay(d)}
                title={`Jogo · ${rangeLabel(d, d)}`}
                aria-label={`Jogo a ${rangeLabel(d, d)}`}
                className="absolute top-0 size-2.5 -translate-x-1/2 rounded-full bg-signal ring-2 ring-surface"
                style={{ left: `${pos(d) + 50 / total}%` }}
              />
            ))}
        </div>

        {noIntervalo && (
          <span
            className="pointer-events-none absolute top-8 bottom-3 w-px bg-risk"
            style={{ left: `calc(20px + (100% - 40px) * ${(pos(today) + 50 / total) / 100})` }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

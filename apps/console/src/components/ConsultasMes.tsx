import { useState } from "react";
import { categoryColor, readableInk } from "@academia/ui/tokens";
import { dayKey, monthGrid } from "@/lib/calendar";
import { today } from "@/lib/api";
import { KIND_LABEL } from "@/lib/clinical";
import { shortName } from "@/lib/format";
import { Check, Clock, Plus, X } from "@/lib/icons";
import { useMobile } from "@/lib/viewport";
import { cx } from "./primitives";
import type { ClinicalEntry, ClinicalKind } from "@/data/types";

/** Uma consulta na grelha: a entrada do boletim e de quem é. */
export type ConsultaNoMes = { athleteId: string; athleteName: string; teamName: string; entry: ClinicalEntry };

/*
 * Cor = área, pela mesma paleta do calendário. Fixa por tipo e não pela ordem em
 * que aparecem: a fisioterapia tem de ter a mesma cor em Outubro e em Março.
 */
const INDICE: Record<ClinicalKind, number> = {
  physio: 5,
  nutrition: 6,
  psychology: 2,
  exam: 1,
  injury: 3,
  note: 4,
  consultation: 7,
};
/** Uma cor em três tons: o ponto, o fundo da pastilha e a letra que se lê nele. */
export type Cor = { base: string; soft: string; ink: string };

/** A cor de omissão de um `kind`, quando o clube não escolheu nenhuma. */
export const corDaArea = (k: ClinicalKind): Cor => categoryColor(INDICE[k]);

/** Os três tons de uma cor escolhida no seletor. O fundo é a cor muito aclarada. */
export function corDeHex(hex: string): Cor {
  const n = parseInt(hex.slice(1), 16);
  const clarear = (c: number) => Math.round(c + (255 - c) * 0.88);
  const soft = `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => clarear(c).toString(16).padStart(2, "0")).join("")}`;
  return { base: hex, soft, ink: readableInk(hex, soft) };
}

/** A cor de uma consulta: a do tipo do clube, se a tiver, senão a de omissão. */
export function corDaConsulta(e: ClinicalEntry, tipos: { id: string; color?: string }[]): Cor {
  const escolhida = e.typeId ? tipos.find((t) => t.id === e.typeId)?.color : undefined;
  return escolhida ? corDeHex(escolhida) : corDaArea(e.kind);
}

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const WEEKDAYS_SHORT = ["S", "T", "Q", "Q", "S", "S", "D"];

const porDia = (items: ConsultaNoMes[]) => {
  const map = new Map<string, ConsultaNoMes[]>();
  for (const c of items) map.set(c.entry.date, [...(map.get(c.entry.date) ?? []), c]);
  // Dentro do dia, pela hora; as que não têm hora (registos feitos) no fim.
  for (const list of map.values()) list.sort((a, b) => (a.entry.time ?? "99").localeCompare(b.entry.time ?? "99"));
  return map;
};

const agendada = (e: ClinicalEntry) => e.status === "scheduled";

/**
 * As consultas num mês.
 *
 * É a pergunta de quem gere a agenda clínica: "que dias tenho cheios e onde há
 * espaço?". A lista responde a "quem está a ser acompanhado", e fica a um clique.
 * A grelha é a do calendário (`monthGrid`, segunda a domingo, seis linhas) para
 * a mesma leitura servir nos dois sítios.
 *
 * Cor = área. O agendado leva a cor cheia; o que já foi registado fica esbatido,
 * para o olho ir primeiro ao que ainda está por acontecer.
 */
export function ConsultasMes({
  anchor,
  items,
  rotulo = (e) => KIND_LABEL[e.kind],
  cor = (e) => corDaArea(e.kind),
  onAdd,
  onSelect,
}: {
  anchor: Date;
  items: ConsultaNoMes[];
  /** A cor de cada consulta: a do tipo, escolhida nas Definições. */
  cor?: (e: ClinicalEntry) => Cor;
  /** O nome do tipo: o do catálogo do clube, quando a consulta o tem. */
  rotulo?: (e: ClinicalEntry) => string;
  onAdd?: (day: Date) => void;
  onSelect: (c: ConsultaNoMes) => void;
}) {
  const days = monthGrid(anchor);
  const byDay = porDia(items);
  const [expanded, setExpanded] = useState<string | null>(null);
  const mobile = useMobile();

  if (mobile) return <MesNoTelemovel anchor={anchor} days={days} byDay={byDay} rotulo={rotulo} corDe={cor} onAdd={onAdd} onSelect={onSelect} />;

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-line bg-sunken/60">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-3 py-2 text-meta font-medium text-ink-3">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const key = dayKey(day);
          const list = byDay.get(key) ?? [];
          const outside = day.getMonth() !== anchor.getMonth();
          const isToday = day.toDateString() === today.toDateString();
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          const open = expanded === key;
          const visible = open ? list : list.slice(0, 3);

          return (
            <div
              key={key}
              className={cx(
                "group relative min-h-[124px] min-w-0 border-r border-b border-line p-1.5",
                i % 7 === 6 && "border-r-0",
                i >= 35 && "border-b-0",
                outside && "bg-canvas/60",
                !outside && isWeekend && "bg-sunken/25",
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-1 px-1">
                <span
                  className={cx(
                    "text-meta font-semibold tabular",
                    isToday
                      ? "flex size-5 items-center justify-center rounded-full bg-signal-strong text-signal-on"
                      : outside
                        ? "text-ink-4"
                        : "text-ink-2",
                  )}
                >
                  {day.getDate()}
                </span>
                {onAdd && (
                  <button
                    type="button"
                    onClick={() => onAdd(day)}
                    aria-label={`Agendar a ${day.getDate()}`}
                    className="flex size-5 items-center justify-center rounded-[5px] text-ink-4 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 hover:bg-sunken hover:text-ink focus-visible:opacity-100"
                  >
                    <Plus className="size-3.5" strokeWidth={2} />
                  </button>
                )}
              </div>

              <div className="space-y-1">
                {visible.map((c) => (
                  <Pastilha key={c.entry.id} c={c} rotulo={rotulo(c.entry)} cor={cor(c.entry)} onClick={() => onSelect(c)} />
                ))}
                {list.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : key)}
                    className="w-full px-1 text-left text-[11px] font-medium text-ink-3 hover:text-ink"
                  >
                    {open ? "mostrar menos" : `+${list.length - 3} mais`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A resposta da família numa marca pequena, só quando se pediu confirmação:
 * visto verde, cruz vermelha, ou relógio enquanto ninguém respondeu.
 */
function MarcaDaResposta({ e }: { e: ClinicalEntry }) {
  if (!agendada(e) || !e.confirmationRequired) return null;
  if (e.reply === "confirmed") return <Check className="size-3 shrink-0 text-ok" strokeWidth={2.5} aria-label="Confirmada" />;
  if (e.reply === "declined") return <X className="size-3 shrink-0 text-risk" strokeWidth={2.5} aria-label="Não vai" />;
  return <Clock className="size-3 shrink-0 opacity-70" strokeWidth={2.25} aria-label="Por responder" />;
}

/** Hora e atleta; o tipo está na cor e o resto no `title`. */
function Pastilha({ c, rotulo, cor, onClick }: { c: ConsultaNoMes; rotulo: string; cor: Cor; onClick: () => void }) {
  const marcada = agendada(c.entry);
  const cancelada = c.entry.status === "cancelled";
  const titulo = [rotulo, c.entry.title, c.athleteName, c.entry.time, c.entry.location]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      className={cx(
        "flex w-full min-w-0 items-center gap-1.5 rounded-[5px] border px-1.5 py-1 text-left text-[11px] leading-tight transition-[filter] duration-[120ms] hover:brightness-[0.97]",
        marcada ? "border-transparent" : "border-line bg-surface text-ink-3",
        cancelada && "text-ink-4",
      )}
      style={marcada ? { background: cor.soft, color: cor.ink } : undefined}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: cor.base }} aria-hidden />
      {c.entry.time && <span className="shrink-0 font-mono tabular opacity-80">{c.entry.time}</span>}
      <span className={cx("min-w-0 flex-1 truncate font-medium", cancelada && "line-through")}>
        {shortName(c.athleteName)}
      </span>
      <MarcaDaResposta e={c.entry} />
    </button>
  );
}

/**
 * O mês no telemóvel: números e pontos na grelha, e a lista do dia tocado por
 * baixo — o mesmo desenho do calendário (`MonthGrid`).
 */
function MesNoTelemovel({
  anchor,
  days,
  byDay,
  rotulo,
  corDe,
  onAdd,
  onSelect,
}: {
  anchor: Date;
  days: Date[];
  byDay: Map<string, ConsultaNoMes[]>;
  rotulo: (e: ClinicalEntry) => string;
  corDe: (e: ClinicalEntry) => Cor;
  onAdd?: (day: Date) => void;
  onSelect: (c: ConsultaNoMes) => void;
}) {
  const [selected, setSelected] = useState<string>(() => {
    const noMes = today.getMonth() === anchor.getMonth() && today.getFullYear() === anchor.getFullYear();
    return dayKey(noMes ? today : new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  });
  const diaEscolhido = days.find((d) => dayKey(d) === selected) ?? days[0];
  const doDia = byDay.get(dayKey(diaEscolhido)) ?? [];

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-line bg-sunken/60">
        {WEEKDAYS_SHORT.map((d, i) => (
          <div key={i} className="py-1.5 text-center text-[11px] font-medium text-ink-3">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 border-b border-line">
        {days.map((day) => {
          const key = dayKey(day);
          const list = byDay.get(key) ?? [];
          const outside = day.getMonth() !== anchor.getMonth();
          const isToday = day.toDateString() === today.toDateString();
          const active = key === selected;
          const cores = [...new Set(list.map((c) => corDe(c.entry).base))];

          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(key)}
              aria-pressed={active}
              aria-label={`${day.getDate()}: ${list.length} consultas`}
              className={cx(
                "flex h-12 flex-col items-center justify-center gap-1 transition-colors duration-[120ms]",
                active && "bg-signal-soft",
                outside && "opacity-45",
              )}
            >
              <span
                className={cx(
                  "flex size-6 items-center justify-center rounded-full text-[13px] font-semibold tabular",
                  isToday ? "bg-signal-strong text-signal-on" : active ? "text-signal-ink" : "text-ink-2",
                )}
              >
                {day.getDate()}
              </span>
              <span className="flex h-1.5 items-center gap-0.5">
                {cores.slice(0, 3).map((c, i) => (
                  <span key={i} className="size-1.5 rounded-full" style={{ background: c }} aria-hidden />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="text-meta text-ink-3">
          <span className="font-medium text-ink">
            {diaEscolhido.getDate()} {diaEscolhido.toLocaleDateString("pt-PT", { month: "long" })}
          </span>
          {" · "}
          {doDia.length === 0 ? "sem consultas" : doDia.length === 1 ? "1 consulta" : `${doDia.length} consultas`}
        </div>
        {onAdd && (
          <button type="button" onClick={() => onAdd(diaEscolhido)} className="ctl-ghost h-8">
            <Plus className="size-3.5" strokeWidth={2} />
            Agendar
          </button>
        )}
      </div>

      {doDia.length > 0 && (
        <ul className="border-t border-line">
          {doDia.map((c) => (
            <li key={c.entry.id} className="border-b border-line last:border-0">
              <button type="button" onClick={() => onSelect(c)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-sunken/60">
                <span className="w-1 self-stretch rounded-full" style={{ background: corDe(c.entry).base }} aria-hidden />
                <span className="w-11 shrink-0 font-mono text-meta text-ink-3 tabular">{c.entry.time ?? "—"}</span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate text-body font-medium text-ink", c.entry.status === "cancelled" && "text-ink-4 line-through")}>
                    {shortName(c.athleteName)}
                  </span>
                  <span className="block truncate text-meta text-ink-3">
                    {[rotulo(c.entry), c.entry.title !== rotulo(c.entry) ? c.entry.title : null, c.entry.location]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <MarcaDaResposta e={c.entry} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

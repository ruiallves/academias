import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { PersonLink } from "@/components/PersonLink";
import { cx, Empty, Monogram, Panel, Pill } from "@/components/primitives";
import { Segmented } from "@/components/filters";
import { MonthGrid } from "@/components/MonthGrid";
import { NewEventDialog } from "@/components/NewEventDialog";
import { EventDetail } from "@/components/EventDetail";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "@/lib/icons";
import type { CategoricalColor } from "@academia/ui/tokens";
import { coachById, listTeams, today } from "@/lib/api";
import { KIND_LABEL, groupByDay, useEvents, useTeamColors, type CalendarEvent, type EventKind } from "@/lib/calendar";
import { dayShort, longDate, monthName, time } from "@/lib/format";
import { can, isAcademyWide } from "@/lib/permissions";
import { useSession } from "@/session";

type View = "agenda" | "mes";

/**
 * Os tipos que se podem pedir por endereço, em português — como o resto dos
 * atalhos da consola (`?painel=cargos`, `?falta=convocar`).
 */
const NOVO_POR_ENDERECO: Record<string, EventKind | undefined> = {
  jogo: "match",
  treino: "training",
  torneio: "tournament",
  outro: "other",
};

/**
 * Calendário, duas vistas.
 *
 * **Agenda** responde "o que se segue e falta alguma coisa?" — é a leitura do dia a
 * dia, densa, sem buracos brancos.
 * **Mês** responde "onde há espaço e como está distribuída a carga?" — é a vista de
 * planeamento, e por isso é ali que se cria um evento.
 *
 * Ter as duas não é indecisão: são perguntas diferentes e a mesma grelha não serve
 * bem as duas. O que **não** se duplica é a fonte de dados — `useEvents` alimenta
 * ambas, e a cor de escalão é a mesma nos dois sítios.
 */
export default function Calendar() {
  const { session } = useSession();
  // O mês é a vista de planeamento — é a que responde "onde há espaço?" antes de
  // se saber o que se procura, por isso é a que abre por omissão. A agenda serve
  // melhor uma pergunta já orientada ("o que se segue?"), e fica a um clique.
  const [view, setView] = useState<View>("mes");
  const [cursor, setCursor] = useState(today);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState<Date | null>(null);
  /** O tipo com que "Novo evento" abre — só quando se chega por `?novo=`. */
  const [composingKind, setComposingKind] = useState<EventKind | undefined>(undefined);
  /** E a equipa, quando quem manda para cá já a tinha escolhido (`?equipa=`). */
  const [composingTeam, setComposingTeam] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  
  /**
   * Clicar num evento abre a gaveta — **em todos os tipos**.
   *
   * Um jogo saltava daqui direito para a página dele. Era rápido para quem
   * queria a convocatória e mau para todos os outros: sair do calendário para
   * ver a que horas é e onde, e depois voltar. E fazia do jogo o único evento
   * do produto sem pré-visualização.
   *
   * Agora a gaveta é a resposta uniforme, e leva lá dentro o que o jogo tem de
   * seu — *Abrir jogo* e *Ver convocatória* (ver `EventDetail`). A regra de
   * **haver** página continua em `matchPagePath`, que é onde tem de estar: um
   * jogo semeado ou de outra equipa não a tem.
   */
  function abrir(e: CalendarEvent) {
    setSelectedId(e.id);
  }

  const teams = listTeams(session);
  const colors = useTeamColors(session);
  const editable = can(session, "calendar:write");

  /*
   * `/calendario?novo=jogo` abre já o diálogo, no tipo pedido.
   *
   * É a porta por onde a página de Jogos manda quem quer marcar um jogo: marcar
   * é do calendário — é lá que se vê o que já está ocupado — e ter um segundo
   * formulário na página de Jogos seria manter duas versões da mesma coisa.
   *
   * O parâmetro é limpo assim que abre. Sem isso, fechar o diálogo deixava o
   * endereço a dizer que ele estava aberto: recarregar a página ou voltar atrás
   * reabria-o, e ninguém percebia porquê.
   */
  const [params, setParams] = useSearchParams();
  const novo = params.get("novo");
  const equipa = params.get("equipa");
  useEffect(() => {
    if (!novo) return;
    setParams((atuais) => {
      const proximos = new URLSearchParams(atuais);
      proximos.delete("novo");
      proximos.delete("equipa");
      return proximos;
    }, { replace: true });
    if (!editable) return;
    setComposingKind(NOVO_POR_ENDERECO[novo]);
    setComposingTeam(equipa ?? undefined);
    setComposing(today);
  }, [novo, equipa, editable, setParams]);

  const [from, to] = useMemo<[Date, Date]>(() => {
    if (view === "mes") {
      // Uma folga de uma semana de cada lado cobre os dias de encosto da grelha.
      return [
        new Date(cursor.getFullYear(), cursor.getMonth(), -7),
        new Date(cursor.getFullYear(), cursor.getMonth() + 1, 14),
      ];
    }
    return [cursor, new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 13)];
  }, [view, cursor]);

  const all = useEvents(session, from, to);
  const events = all.filter((e) => !e.teamId || !hidden.has(e.teamId));
  // Deriva-se de `all`, não de `events`: se o painel já estava aberto e o
  // utilizador esconder o escalão na legenda, o evento não desaparece debaixo dele.
  const selected = all.find((e) => e.id === selectedId) ?? null;

  const step = (dir: 1 | -1) =>
    setCursor((c) =>
      view === "mes"
        ? new Date(c.getFullYear(), c.getMonth() + dir, 1)
        : new Date(c.getFullYear(), c.getMonth(), c.getDate() + dir * 14),
    );

  const toggleTeam = (id: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const label =
    view === "mes"
      ? `${capitalize(monthName(cursor))} de ${cursor.getFullYear()}`
      : `${longDate(from)} – ${longDate(to)}`;

  return (
    <>
      <PageHeader
        title="Calendário"
        subtitle={isAcademyWide(session) ? "Treinos, jogos e eventos da academia" : "Treinos e jogos das tuas equipas"}
      >
        {editable && (
          <button
            type="button"
            onClick={() => {
              setComposingKind(undefined);
              setComposingTeam(undefined);
              setComposing(today);
            }}
            className="ctl-primary"
          >
            <Plus className="size-3.5" strokeWidth={2} />
            Novo evento
          </button>
        )}
      </PageHeader>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => step(-1)} className="ctl-outline size-8 justify-center px-0" aria-label="Período anterior">
              <ChevronLeft className="size-4" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={() => setCursor(today)} className="ctl-outline">
              Hoje
            </button>
            <button type="button" onClick={() => step(1)} className="ctl-outline size-8 justify-center px-0" aria-label="Período seguinte">
              <ChevronRight className="size-4" strokeWidth={1.75} />
            </button>
            <h2 className="ml-1.5 text-panel text-ink">{label}</h2>
            <span className="text-meta text-ink-3 tabular">{events.length} eventos</span>
          </div>

          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "agenda", label: "Agenda" },
              { value: "mes", label: "Mês" },
            ]}
          />
        </div>

        {/* Legenda que também filtra. Uma legenda que só explica cores desperdiça
            uma linha; esta é a única forma de isolar um escalão no mês. */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
          {teams.map((t) => {
            const off = hidden.has(t.id);
            const c = colors.get(t.id)!;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTeam(t.id)}
                aria-pressed={!off}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors duration-[120ms]",
                  off ? "border-line bg-surface text-ink-4" : "border-transparent",
                )}
                style={off ? undefined : { background: c.soft, color: c.ink }}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: off ? "var(--color-ink-4)" : c.base }}
                  aria-hidden
                />
                {t.name}
              </button>
            );
          })}

          {hidden.size > 0 && (
            <button type="button" onClick={() => setHidden(new Set())} className="ctl-ghost ml-1 h-7">
              Mostrar todos
            </button>
          )}
        </div>

        {view === "mes" ? (
          <MonthGrid
            anchor={cursor}
            events={events}
            colors={colors}
            onAdd={(day) => editable && setComposing(day)}
            onSelect={abrir}
          />
        ) : (
          <AgendaList events={events} colors={colors} onSelect={abrir} />
        )}
      </Panel>

      {composing && (
        <NewEventDialog
          session={session}
          day={composing}
          kind={composingKind}
          teamId={composingTeam}
          onClose={() => {
            setComposing(null);
            setComposingKind(undefined);
            setComposingTeam(undefined);
          }}
        />
      )}

      {selected && (
        <EventDetail
          event={selected}
          session={session}
          color={selected.teamId ? colors.get(selected.teamId) : undefined}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Agenda. Coluna de data fixa à esquerda para o olho descer por uma régua, e os
 * dias sem nada não aparecem — um calendário de duas semanas com nove linhas vazias
 * ensina a não olhar para ele.
 */
function AgendaList({
  events,
  colors,
  onSelect,
}: {
  events: CalendarEvent[];
  colors: Map<string, CategoricalColor>;
  onSelect: (event: CalendarEvent) => void;
}) {
  const byDay = groupByDay(events);

  if (byDay.size === 0) {
    return (
      <div>
        <Empty icon={CalendarDays} title="Nada agendado" detail="Este período está livre para os escalões seleccionados." />
      </div>
    );
  }

  return (
    <ul>
      {[...byDay.entries()].map(([key, items]) => {
        const day = new Date(`${key}T00:00:00`);
        const isToday = day.toDateString() === today.toDateString();

        return (
          <li key={key} className="flex gap-4 border-b border-line px-5 py-3.5 last:border-0">
            <div className="w-14 shrink-0 pt-0.5">
              <div className={cx("text-meta font-semibold uppercase", isToday ? "text-signal-ink" : "text-ink-3")}>
                {dayShort(day)}
              </div>
              <div className={cx("text-[20px] leading-tight font-semibold tabular", isToday ? "text-signal-ink" : "text-ink")}>
                {day.getDate()}
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-1.5">
              {items.map((e) => {
                const coach = e.coachId ? coachById(e.coachId) : undefined;
                const coachName = e.coachName ?? coach?.name;
                const c = e.teamId ? colors.get(e.teamId) : undefined;

                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onSelect(e)}
                    className={cx(
                      "flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-control)] border px-3 py-2 text-left transition-colors duration-[120ms] hover:border-line-strong",
                      e.cancelled ? "border-line bg-sunken/50" : "border-line bg-surface",
                    )}
                  >
                    {/* Filete de cor do escalão — a mesma leitura que na grelha. */}
                    <span
                      className="h-5 w-[3px] shrink-0 rounded-full"
                      style={{ background: c?.base ?? "var(--color-ink-4)" }}
                      aria-hidden
                    />
                    <span className="w-24 shrink-0 font-mono text-meta text-ink-2 tabular">
                      {time(e.start)}–{time(e.end)}
                    </span>
                    <span className={cx("min-w-0 flex-1 truncate text-body font-medium", e.cancelled ? "text-ink-4 line-through" : "text-ink")}>
                      {e.title}
                    </span>
                    {e.kind !== "training" && <Pill tone="neutral">{KIND_LABEL[e.kind]}</Pill>}
                    <span className="shrink-0 text-meta text-ink-3">{e.venue}</span>

                    {e.cancelled ? (
                      <Pill>Cancelado</Pill>
                    ) : coach ? (
                      <span className="flex shrink-0 items-center gap-1.5">
                        <Monogram name={coachName!} size="sm" />
                        <PersonLink id={coach?.id} name={coachName} short className="text-meta text-ink-3" />
                      </span>
                    ) : e.alert === "unassigned" ? (
                      <Pill tone="risk">Sem treinador</Pill>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

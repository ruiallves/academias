import { Link } from "react-router-dom";
import { ArrowUpRight, Clock, MapPin, Sparkles, TriangleAlert, UserRound } from "lucide-react";
import { useChild } from "@/App";
import { appointments, guardian, notices, payments, today, trainings } from "@/data";
import { Avatar, Money, cx, dayShort, greeting, money, monthShort, time, whenLabel } from "@/ui";

/**
 * "O que preciso de saber hoje sobre o meu filho?"
 *
 * De cima para baixo por urgência, mas sem transformar cada item num cartão. A
 * página lê-se como uma linha do tempo pessoal: primeiro o dinheiro em falta (se
 * houver, é impossível de ignorar), depois o próximo treino em destaque, e o resto
 * do dia a escorrer por baixo, cada vez mais discreto.
 */
export default function Today() {
  const { child } = useChild();

  const mine = trainings.filter((t) => t.childId === child.id);
  const next = mine.find((t) => t.end >= today);
  const owed = payments.find((p) => p.childId === child.id && (p.status === "overdue" || p.status === "pending"));
  const childNotices = notices.filter((n) => n.forChild === child.id);
  const nextAppointment = appointments
    .filter((a) => a.childId === child.id && a.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
  const changed = mine.filter((t) => t.note && t.end >= today);

  let i = 0;

  return (
    <div className="space-y-6 pt-3">
      <header className="rise px-1" style={{ ["--i" as string]: i++ }}>
        <p className="text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
          {dayShort(today)} · {today.getDate()} {monthShort(today)}
        </p>
        <h1 className="mt-1 text-[30px] leading-[1.1] font-semibold tracking-[-0.03em] text-ink">
          {greeting(today)},<br />
          {guardian.firstName}.
        </h1>
      </header>

      {owed && (
        <div className="rise" style={{ ["--i" as string]: i++ }}>
          <PaymentDue amount={owed.amountCents} childName={child.firstName} overdue={owed.status === "overdue"} />
        </div>
      )}

      {next ? (
        <div className="rise" style={{ ["--i" as string]: i++ }}>
          <NextTraining training={next} />
        </div>
      ) : (
        <div className="rise surface p-6 text-center" style={{ ["--i" as string]: i++ }}>
          <p className="text-body font-semibold text-ink">Sem treinos marcados</p>
          <p className="mt-1 text-meta text-ink-3">Avisamos-te assim que a academia agendar o próximo.</p>
        </div>
      )}

      {/* Régua da semana — o resto do calendário num gesto de polegar. */}
      <section className="rise" style={{ ["--i" as string]: i++ }}>
        <div className="mb-3 flex items-center justify-between px-1">
          <h2 className="text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Esta semana</h2>
          <Link to="/agenda" className="inline-flex items-center gap-1 text-[13px] font-semibold text-signal-ink">
            Agenda <ArrowUpRight className="size-3.5" strokeWidth={2.25} />
          </Link>
        </div>
        <WeekRail />
      </section>

      {/* O que vem a seguir no dia, como uma linha do tempo discreta. */}
      {(changed.length > 0 || nextAppointment || childNotices.length > 0) && (
        <section className="rise space-y-1 px-1" style={{ ["--i" as string]: i++ }}>
          {changed.map((t) => (
            <TimelineRow
              key={t.id}
              accent="warn"
              icon={<TriangleAlert className="size-[18px]" strokeWidth={1.9} />}
              eyebrow={`${whenLabel(t.start, today)} · treino alterado`}
              title={child.team}
              detail={t.note!.text}
            />
          ))}

          {nextAppointment && (
            <TimelineRow
              accent="signal"
              icon={
                <span className="flex flex-col items-center leading-none">
                  <span className="text-[8px] font-bold uppercase">{monthShort(nextAppointment.date)}</span>
                  <span className="num text-[15px] font-bold">{nextAppointment.date.getDate()}</span>
                </span>
              }
              eyebrow={`${nextAppointment.kind} · ${whenLabel(nextAppointment.date, today)}`}
              title={nextAppointment.title}
              detail={`${nextAppointment.time} · ${nextAppointment.location}`}
              note={nextAppointment.note}
            />
          )}

          {childNotices.map((n) => (
            <Link key={n.id} to="/notificacoes" className="block">
              <TimelineRow
                accent="neutral"
                icon={<Sparkles className="size-[18px]" strokeWidth={1.9} />}
                eyebrow={`${n.from.split(" ")[0]} · ${whenLabel(n.at, today)}`}
                title={n.title}
                detail={n.body}
                clamp
              />
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagamento em falta — o elemento mais importante da app inteira               */
/* -------------------------------------------------------------------------- */

/**
 * Tinta escura, não vermelho a gritar: destaca-se da página clara sem parecer um
 * alarme de incêndio. O valor é enorme, e a acção é uma frase inteira — "Pagar
 * €40,00" —, não um "Pagar" que obriga a adivinhar quanto.
 */
function PaymentDue({ amount, childName, overdue }: { amount: number; childName: string; overdue: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-xl)] bg-ink p-5 text-white" style={{ boxShadow: "var(--shadow-float)" }}>
      <div className="mb-4 flex items-center gap-2">
        <span className={cx("size-2 rounded-full", overdue ? "bg-risk" : "bg-warn")} />
        <span className="text-[13px] font-semibold text-white/70">
          {overdue ? "Mensalidade vencida" : "Mensalidade por pagar"} · {childName}
        </span>
      </div>

      <Money cents={amount} size="xl" on />
      <p className="mt-1.5 text-[13px] text-white/55">Agosto · Academia Life Club</p>

      <Link to="/pagamentos" className="cta-brand mt-5 w-full">
        Pagar {money(amount)}
      </Link>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Próximo treino — o herói iluminado pela marca                                */
/* -------------------------------------------------------------------------- */

function NextTraining({ training }: { training: (typeof trainings)[number] }) {
  const { child } = useChild();

  return (
    <div className="brandlit relative overflow-hidden rounded-[var(--radius-xl)] p-5" style={{ boxShadow: "var(--shadow-float)" }}>
      <div className="mb-5 flex items-center justify-between">
        <span className="chip chip-glass uppercase">{whenLabel(training.start, today)}</span>
        <Avatar name={child.name} size={40} />
      </div>

      <p className="on-2 text-[13px] font-semibold tracking-[0.04em] uppercase">Próximo treino · {child.sport}</p>

      <div className="mt-1 flex items-end gap-3">
        <span className="num text-[52px] leading-[0.9] font-semibold">{time(training.start)}</span>
        <span className="on-2 mb-1.5 text-[17px] font-semibold">– {time(training.end)}</span>
      </div>

      <h3 className="mt-2 text-[19px] font-semibold tracking-[-0.01em]">{child.team}</h3>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/15 pt-4">
        <Fact icon={MapPin} label={training.venue} />
        <Fact icon={UserRound} label={child.coach} />
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label }: { icon: typeof Clock; label: string }) {
  return (
    <span className="on-1 inline-flex items-center gap-2 text-[14px] font-medium">
      <Icon className="on-3 size-[17px] shrink-0" strokeWidth={2} />
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Linha do tempo — informação secundária sem caixa                             */
/* -------------------------------------------------------------------------- */

function TimelineRow({
  accent,
  icon,
  eyebrow,
  title,
  detail,
  note,
  clamp,
}: {
  accent: "warn" | "signal" | "neutral";
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  detail: string;
  note?: string;
  clamp?: boolean;
}) {
  const badge = {
    warn: "bg-warn-soft text-warn",
    signal: "bg-signal-soft text-signal-ink",
    neutral: "bg-sunken text-ink-3",
  }[accent];

  return (
    <div className="flex items-start gap-3.5 rounded-[var(--radius-md)] px-2 py-3 active:bg-sunken/60">
      <span className={cx("mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[13px]", badge)}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold tracking-[0.02em] text-ink-3 uppercase">{eyebrow}</p>
        <p className="mt-0.5 text-body font-semibold text-ink">{title}</p>
        <p className={cx("mt-0.5 text-meta text-ink-2", clamp && "line-clamp-2")}>{detail}</p>
        {note && <p className="mt-1 text-meta font-medium text-warn">{note}</p>}
      </div>
    </div>
  );
}

/**
 * Sete dias que se arrastam com o polegar. O dia com treino ganha um ponto da cor
 * da marca; hoje fica em tinta cheia. Um calendário mensal apertado seria ilegível.
 */
function WeekRail() {
  const { child } = useChild();
  const days = Array.from({ length: 7 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {days.map((day) => {
        const items = trainings.filter((t) => t.childId === child.id && t.start.toDateString() === day.toDateString());
        const isToday = day.toDateString() === today.toDateString();
        const has = items.length > 0;

        return (
          <div
            key={day.toISOString()}
            className={cx(
              "flex h-[92px] w-[58px] shrink-0 flex-col items-center rounded-[var(--radius-md)] px-1 py-2.5 transition-colors",
              isToday ? "bg-ink text-white" : "bg-surface text-ink shadow-[var(--shadow-soft)]",
            )}
          >
            <span className={cx("text-[11px] font-semibold uppercase", isToday ? "text-white/60" : "text-ink-3")}>
              {dayShort(day)}
            </span>
            <span className="num mt-0.5 text-[19px] font-semibold">{day.getDate()}</span>
            <span className="mt-auto">
              {has ? (
                <span className="num text-[11px] font-bold" style={{ color: isToday ? "#fff" : "var(--color-signal)" }}>
                  {time(items[0].start)}
                </span>
              ) : (
                <span className={cx("block size-1 rounded-full", isToday ? "bg-white/30" : "bg-ink-4/30")} />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

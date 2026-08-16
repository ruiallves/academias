import { Link } from "react-router-dom";
import { ArrowRight, Clock, MapPin, TriangleAlert, UserRound } from "lucide-react";
import { useChild } from "@/App";
import { appointments, guardian, notices, payments, today, trainings } from "@/data";
import { Card, SectionTitle, Tag, cx, dayShort, greeting, money, time, whenLabel } from "@/ui";

/**
 * "O que acontece hoje?"
 *
 * É a única pergunta que este ecrã responde, e responde-a de cima para baixo por
 * urgência: o que tem de ser pago, o que é o próximo treino, o que mudou. Nada de
 * métricas — um pai não quer um dashboard do filho.
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

  return (
    <div className="space-y-5 pt-2">
      <h1 className="px-1 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">
        {greeting(today)}, {guardian.firstName}
      </h1>

      {/* Se há dinheiro em falta, é a primeira coisa. Nada é mais urgente. */}
      {owed && <PaymentDue amount={owed.amountCents} childName={child.firstName} overdue={owed.status === "overdue"} />}

      <section>
        <SectionTitle>Próximo treino</SectionTitle>
        {next ? <NextTraining training={next} /> : <NoTraining />}
      </section>

      {changed.length > 0 && (
        <section>
          <SectionTitle>Alterações</SectionTitle>
          <div className="space-y-2">
            {changed.map((t) => (
              <Card key={t.id} className="flex items-start gap-3 border-warn/25 bg-warn-soft/50 p-3.5">
                <TriangleAlert className="mt-0.5 size-[18px] shrink-0 text-warn" strokeWidth={1.75} />
                <div className="min-w-0">
                  <p className="text-body font-semibold text-ink">
                    {whenLabel(t.start, today)} · {child.team}
                  </p>
                  <p className="text-meta text-ink-2">{t.note!.text}</p>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle
          action={
            <Link to="/agenda" className="inline-flex items-center gap-1 text-meta font-semibold text-ink-3">
              Agenda <ArrowRight className="size-3.5" strokeWidth={2} />
            </Link>
          }
        >
          Próximos dias
        </SectionTitle>
        <WeekRail />
      </section>

      {nextAppointment && (
        <section>
          <SectionTitle>Marcado pela academia</SectionTitle>
          <Card className="flex items-start gap-3 p-4">
            <span className="flex size-10 shrink-0 flex-col items-center justify-center rounded-[10px] bg-signal-soft">
              <span className="text-[9px] font-semibold text-signal-ink uppercase">
                {nextAppointment.date.toLocaleDateString("pt-PT", { month: "short" }).replace(".", "")}
              </span>
              <span className="text-meta font-semibold text-signal-ink tabular">{nextAppointment.date.getDate()}</span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <Tag tone="signal">{nextAppointment.kind}</Tag>
                <span className="text-meta text-ink-3">{whenLabel(nextAppointment.date, today)}</span>
              </div>
              <p className="text-body font-semibold text-ink">{nextAppointment.title}</p>
              <p className="mt-0.5 text-meta text-ink-2">
                <span className="font-mono tabular">{nextAppointment.time}</span> · {nextAppointment.location}
              </p>
              {nextAppointment.note && <p className="mt-1.5 text-meta text-warn">{nextAppointment.note}</p>}
            </div>
          </Card>
        </section>
      )}

      {childNotices.length > 0 && (
        <section>
          <SectionTitle>Da academia</SectionTitle>
          <div className="space-y-2">
            {childNotices.map((n) => (
              <Card key={n.id} className="p-4">
                <div className="mb-1 flex items-center gap-2">
                  <Tag tone="signal">{n.from.split(" ")[0]}</Tag>
                  <span className="text-meta text-ink-3">{whenLabel(n.at, today)}</span>
                </div>
                <h3 className="mb-1 text-body font-semibold text-ink">{n.title}</h3>
                <p className="text-meta leading-relaxed text-ink-2">{n.body}</p>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O cartão de pagamento é a peça mais importante da app inteira.
 *
 * O valor é grande e o botão é uma frase completa — "Pagar €40,00" —, não um
 * "Pagar" genérico. É a diferença entre uma referência multibanco perdida num
 * grupo de WhatsApp e um gesto de dois toques.
 */
function PaymentDue({ amount, childName, overdue }: { amount: number; childName: string; overdue: boolean }) {
  return (
    <Card className={cx("overflow-hidden", overdue ? "border-risk/30" : "border-warn/30")}>
      <div className={cx("px-4 py-3", overdue ? "bg-risk-soft" : "bg-warn-soft")}>
        <div className="flex items-center gap-2">
          <span className={cx("size-2 rounded-full", overdue ? "bg-risk" : "bg-warn")} />
          <span className={cx("text-meta font-semibold", overdue ? "text-risk" : "text-warn")}>
            {overdue ? "Mensalidade vencida" : "Mensalidade por pagar"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-[30px] leading-none font-semibold tracking-[-0.02em] text-ink tabular">
            {money(amount)}
          </div>
          <p className="mt-1.5 text-meta text-ink-3">Agosto · {childName}</p>
        </div>
        <Link to="/pagamentos" className="tap-primary shrink-0">
          Pagar {money(amount)}
        </Link>
      </div>
    </Card>
  );
}

function NextTraining({ training }: { training: (typeof trainings)[number] }) {
  const { child } = useChild();

  return (
    <Card className="overflow-hidden">
      <div className="flex items-stretch">
        {/* Faixa de sinal: a marca da academia, sem gradientes. */}
        <div className="w-1 shrink-0" style={{ background: "var(--color-signal)" }} aria-hidden />

        <div className="min-w-0 flex-1 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Tag tone="signal">{whenLabel(training.start, today)}</Tag>
            <span className="text-meta text-ink-3">{child.sport}</span>
          </div>

          <h3 className="text-[20px] leading-tight font-semibold tracking-[-0.015em] text-ink">{child.team}</h3>

          <dl className="mt-3 space-y-2">
            <Fact icon={Clock} label={`${time(training.start)} – ${time(training.end)}`} />
            <Fact icon={MapPin} label={training.venue} />
            <Fact icon={UserRound} label={child.coach} />
          </dl>
        </div>
      </div>
    </Card>
  );
}

function Fact({ icon: Icon, label }: { icon: typeof Clock; label: string }) {
  return (
    <div className="flex items-center gap-2.5 text-body text-ink-2">
      <Icon className="size-[18px] shrink-0 text-ink-4" strokeWidth={1.75} />
      <span className="truncate">{label}</span>
    </div>
  );
}

function NoTraining() {
  return (
    <Card className="p-6 text-center">
      <p className="text-body font-semibold text-ink">Sem treinos marcados</p>
      <p className="mt-1 text-meta text-ink-3">Avisamos-te assim que a academia agendar o próximo.</p>
    </Card>
  );
}

/**
 * Carril horizontal de sete dias. Um calendário completo num ecrã de telemóvel é
 * ilegível; sete cartões que se arrastam com o polegar não são.
 */
function WeekRail() {
  const { child } = useChild();
  const days = Array.from({ length: 7 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {days.map((day) => {
        const items = trainings.filter(
          (t) => t.childId === child.id && t.start.toDateString() === day.toDateString(),
        );
        const isToday = day.toDateString() === today.toDateString();

        return (
          <div
            key={day.toISOString()}
            className={cx(
              "flex w-[86px] shrink-0 flex-col rounded-[12px] border p-2.5",
              isToday ? "border-signal/30 bg-signal-soft" : "border-line bg-surface",
            )}
          >
            <span className={cx("text-[11px] font-semibold uppercase", isToday ? "text-signal-ink" : "text-ink-3")}>
              {dayShort(day)}
            </span>
            <span className={cx("mb-2 text-[18px] leading-tight font-semibold tabular", isToday ? "text-signal-ink" : "text-ink")}>
              {day.getDate()}
            </span>

            {items.length === 0 ? (
              <span className="mt-auto text-[11px] text-ink-4">livre</span>
            ) : (
              items.map((t) => (
                <span key={t.id} className="mt-auto font-mono text-[12px] font-medium text-ink tabular">
                  {time(t.start)}
                </span>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

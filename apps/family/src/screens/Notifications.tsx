import { Link } from "react-router-dom";
import { CalendarClock, Megaphone, Stethoscope, Wallet, type LucideIcon } from "lucide-react";
import { appointments, children, notices, payments, today, trainings } from "@/data";
import { NotificationCard } from "@/NotificationCard";
import { cx, money, whenLabel } from "@/ui";

/**
 * Notificações.
 *
 * Não uma lista cinzenta e igual: cada tipo tem peso próprio. Uma mensalidade em
 * falta pesa mais e traz a acção junto; um aviso da academia é uma linha calma. A
 * hierarquia faz-se pela cor da marca do tipo e pelo destaque, não por gritar.
 *
 * Em baixo, ligar as notificações no telemóvel — a acção que faz tudo isto chegar
 * mesmo, e não só quando a app está aberta.
 */

type Notif = {
  id: string;
  at: Date;
  kind: "payment" | "change" | "notice" | "appointment";
  title: string;
  body: string;
  child: string;
  action?: { to: string; label: string };
  urgent?: boolean;
};

const firstNameOf = (id: string) => children.find((c) => c.id === id)?.firstName ?? "";

const ICON: Record<Notif["kind"], { icon: LucideIcon; cls: string }> = {
  payment: { icon: Wallet, cls: "bg-risk-soft text-risk" },
  change: { icon: CalendarClock, cls: "bg-warn-soft text-warn" },
  appointment: { icon: Stethoscope, cls: "bg-signal-soft text-signal-ink" },
  notice: { icon: Megaphone, cls: "bg-sunken text-ink-2" },
};

export default function Notifications() {
  const feed: Notif[] = [
    ...payments
      .filter((p) => p.status === "overdue" || p.status === "pending")
      .map<Notif>((p) => ({
        id: `pay-${p.id}`,
        at: p.dueDate,
        kind: "payment",
        title: p.status === "overdue" ? "Mensalidade vencida" : "Mensalidade por pagar",
        body: `${p.label} · ${money(p.amountCents)} — ${firstNameOf(p.childId)}`,
        child: firstNameOf(p.childId),
        action: { to: "/pagamentos", label: `Pagar ${money(p.amountCents)}` },
        urgent: p.status === "overdue",
      })),
    ...trainings
      .filter((t) => t.note && t.end >= today)
      .map<Notif>((t) => ({
        id: `chg-${t.id}`,
        at: t.start,
        kind: "change",
        title: "Treino alterado",
        body: t.note!.text,
        child: firstNameOf(t.childId),
      })),
    ...appointments
      .filter((a) => a.date >= today)
      .map<Notif>((a) => ({
        id: `apt-${a.id}`,
        at: a.date,
        kind: "appointment",
        title: `${a.kind} marcada`,
        body: `${a.title} · ${a.time} · ${a.location}`,
        child: firstNameOf(a.childId),
      })),
    ...notices.map<Notif>((n) => ({
      id: `not-${n.id}`,
      at: n.at,
      kind: "notice",
      title: n.title,
      body: n.body,
      child: firstNameOf(n.forChild),
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="space-y-6 pt-3">
      <h1 className="px-1 text-[30px] leading-tight font-semibold tracking-[-0.03em] text-ink">Notificações</h1>

      <ul className="space-y-2">
        {feed.map((n, i) => (
          <NotifRow key={n.id} n={n} i={i} />
        ))}
      </ul>

      <NotificationCard />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function NotifRow({ n, i }: { n: Notif; i: number }) {
  const { icon: Icon, cls } = ICON[n.kind];

  return (
    <li
      className={cx(
        "rise flex gap-3.5 rounded-[var(--radius-lg)] p-4",
        n.urgent ? "bg-surface ring-1 ring-risk/25 shadow-[var(--shadow-soft)]" : "bg-surface shadow-[var(--shadow-soft)]",
      )}
      style={{ ["--i" as string]: i }}
    >
      <span className={cx("flex size-11 shrink-0 items-center justify-center rounded-[14px]", cls)}>
        <Icon className="size-[21px]" strokeWidth={1.9} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="text-body font-semibold text-ink">{n.title}</p>
          <span className="ml-auto shrink-0 text-[12px] font-medium text-ink-4">{whenLabel(n.at, today)}</span>
        </div>
        <p className="mt-0.5 text-meta leading-relaxed text-ink-2">{n.body}</p>

        {n.action && (
          <Link to={n.action.to} className="mt-3 inline-flex h-9 items-center rounded-full bg-ink px-4 text-[13px] font-semibold text-white active:scale-[0.98]">
            {n.action.label}
          </Link>
        )}
      </div>
    </li>
  );
}

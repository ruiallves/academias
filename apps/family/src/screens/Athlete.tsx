import { ChevronRight, Download, LogOut, MessageSquare, ShieldCheck } from "lucide-react";
import { useChild } from "@/App";
import { academy, progress } from "@/data";
import { Avatar, Bar, Money, cx } from "@/ui";

/**
 * "Como está o meu filho?"
 *
 * Um perfil, não uma ficha administrativa. A assiduidade é um número grande, a
 * avaliação lê-se de relance, e a nota do treinador está em destaque e assinada —
 * é a diferença entre um relatório automático e alguém que conhece o miúdo.
 */
export default function Athlete() {
  const { child } = useChild();
  const p = progress[child.id];
  const rate = p.attended / p.total;
  const avg = p.skills.reduce((n, s) => n + s.score, 0) / p.skills.length;

  return (
    <div className="space-y-6 pt-3">
      {/* Cabeçalho de perfil */}
      <header className="flex flex-col items-center pt-2 text-center">
        <Avatar name={child.name} size={84} ring />
        <h1 className="mt-3 text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">{child.name}</h1>
        <p className="mt-0.5 text-meta text-ink-3">
          {child.team} · {child.coach}
        </p>
      </header>

      {/* Dois números lado a lado: presença e avaliação média. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[var(--radius-lg)] bg-surface p-4" style={{ boxShadow: "var(--shadow-soft)" }}>
          <p className="text-[12px] font-semibold tracking-[0.03em] text-ink-3 uppercase">Presença</p>
          <p className="num mt-1.5 text-[34px] font-semibold leading-none text-ink">{Math.round(rate * 100)}%</p>
          <div className="mt-3">
            <Bar value={rate} tone={rate >= 0.85 ? "ok" : rate >= 0.7 ? "signal" : "warn"} />
          </div>
          <p className="mt-2 text-[12px] text-ink-4">
            {p.attended} de {p.total} treinos
          </p>
        </div>

        <div className="rounded-[var(--radius-lg)] bg-surface p-4" style={{ boxShadow: "var(--shadow-soft)" }}>
          <p className="text-[12px] font-semibold tracking-[0.03em] text-ink-3 uppercase">Avaliação</p>
          <p className="num mt-1.5 text-[34px] font-semibold leading-none text-ink">
            {avg.toFixed(1)}
            <span className="text-[18px] text-ink-3"> /5</span>
          </p>
          <div className="mt-3 flex gap-1" aria-hidden>
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={cx("h-1.5 flex-1 rounded-full", n <= Math.round(avg) ? "bg-signal" : "bg-sunken")} />
            ))}
          </div>
          <p className="mt-2 text-[12px] text-ink-4">média do período</p>
        </div>
      </div>

      {/* Competências — barras finas, o número à direita. */}
      <section>
        <h2 className="mb-3 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Por competência</h2>
        <div className="space-y-3.5 px-1">
          {p.skills.map((s) => (
            <div key={s.name} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-body text-ink-2">{s.name}</span>
              <div className="flex-1">
                <Bar value={s.score / 5} tone="signal" />
              </div>
              <span className="num w-8 shrink-0 text-right text-body font-semibold text-ink">{s.score}.0</span>
            </div>
          ))}
        </div>
      </section>

      {/* A nota do treinador — o elemento com mais presença desta página. */}
      <section className="brandlit overflow-hidden rounded-[var(--radius-xl)] p-5" style={{ boxShadow: "var(--shadow-float)" }}>
        <p className="on-2 text-[13px] font-semibold tracking-[0.04em] uppercase">Nota do treinador</p>
        <p className="mt-3 text-[17px] leading-relaxed font-medium">{p.note}</p>
        <footer className="on-2 mt-4 flex items-center gap-2 border-t border-white/15 pt-3 text-[13px] font-semibold">
          <Avatar name={child.coach} size={24} />
          {child.coach}
        </footer>
      </section>

      {/* Inscrição — linhas soltas, sem caixa. */}
      <section>
        <h2 className="mb-1 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Inscrição</h2>
        <dl className="px-1">
          <Row label="Modalidade" value={child.sport} />
          <Row label="Escalão" value={child.team} />
          <Row label="Mensalidade" value={<Money cents={child.feeCents} size="md" />} sub="/ mês" />
          <Row label="Academia" value={academy.name} />
        </dl>
      </section>

      {/* Acções */}
      <div className="space-y-2">
        <ActionRow icon={MessageSquare} label="Falar com a academia" />
        <ActionRow icon={Download} label="Descarregar relatório do período" />
      </div>

      <button type="button" className="flex w-full items-center justify-center gap-2 py-3 text-body font-semibold text-ink-3 active:text-ink">
        <LogOut className="size-[18px]" strokeWidth={1.9} />
        Terminar sessão
      </button>

      <p className="flex items-center justify-center gap-1.5 pb-1 text-[12px] text-ink-4">
        <ShieldCheck className="size-3.5" strokeWidth={1.75} />
        Vês apenas os teus educandos.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Row({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-3.5 last:border-0">
      <dt className="text-body text-ink-3">{label}</dt>
      <dd className="flex items-baseline gap-1 text-right text-body font-semibold text-ink">
        {value}
        {sub && <span className="text-meta font-medium text-ink-4">{sub}</span>}
      </dd>
    </div>
  );
}

function ActionRow({ icon: Icon, label }: { icon: typeof MessageSquare; label: string }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] bg-surface p-4 text-left shadow-[var(--shadow-soft)] active:scale-[0.99]"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2">
        <Icon className="size-[18px]" strokeWidth={1.9} />
      </span>
      <span className="flex-1 text-body font-semibold text-ink">{label}</span>
      <ChevronRight className="size-5 shrink-0 text-ink-4" strokeWidth={2} />
    </button>
  );
}

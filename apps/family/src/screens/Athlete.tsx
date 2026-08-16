import { Download, LogOut, MessageSquare, UserRound } from "lucide-react";
import { useChild } from "@/App";
import { academy, progress } from "@/data";
import { Avatar, Bar, Card, SectionTitle, cx, money } from "@/ui";
import { NotificationCard } from "@/NotificationCard";

/**
 * "Como está o meu filho?"
 *
 * Presenças e uma leitura do treinador — não um gráfico de radar com sete eixos.
 * O que o pai quer saber cabe em duas frases; o resto é vaidade de produto.
 *
 * A nota do treinador está em destaque e assinada. É a diferença entre um relatório
 * automático e alguém que conhece o miúdo.
 */
export default function Athlete() {
  const { child } = useChild();
  const p = progress[child.id];
  const rate = p.attended / p.total;

  return (
    <div className="space-y-5 pt-2">
      <div className="flex items-center gap-3 px-1">
        <Avatar name={child.name} size={52} />
        <div className="min-w-0">
          <h1 className="truncate text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">{child.name}</h1>
          <p className="truncate text-meta text-ink-3">
            {child.team} · {child.coach}
          </p>
        </div>
      </div>

      <section>
        <SectionTitle>Presenças</SectionTitle>
        <Card className="p-4">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-[30px] leading-none font-semibold tracking-[-0.02em] text-ink tabular">
              {Math.round(rate * 100)}%
            </span>
            <span className="text-meta text-ink-3">
              {p.attended} de {p.total} treinos este período
            </span>
          </div>
          <Bar value={rate} tone={rate >= 0.85 ? "ok" : rate >= 0.7 ? "signal" : "warn"} />
        </Card>
      </section>

      <section>
        <SectionTitle>Avaliação do treinador</SectionTitle>
        <Card className="p-4">
          <ul className="space-y-3">
            {p.skills.map((s) => (
              <li key={s.name} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-body text-ink-2">{s.name}</span>
                <span className="flex gap-1" role="img" aria-label={`${s.score} de 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} className={cx("size-2 rounded-full", n <= s.score ? "bg-signal" : "bg-sunken")} />
                  ))}
                </span>
              </li>
            ))}
          </ul>

          <blockquote className="mt-4 border-t border-line pt-4">
            <p className="text-body leading-relaxed text-ink-2">{p.note}</p>
            <footer className="mt-2 text-meta text-ink-3">— {child.coach}, treinador</footer>
          </blockquote>
        </Card>
      </section>

      <section>
        <SectionTitle>Inscrição</SectionTitle>
        <Card>
          <dl className="px-4">
            <Row label="Modalidade" value={child.sport} />
            <Row label="Escalão" value={child.team} />
            <Row label="Mensalidade" value={`${money(child.feeCents)} / mês`} />
            <Row label="Academia" value={academy.name} />
          </dl>
        </Card>
      </section>

      <NotificationCard />

      <div className="space-y-2 pt-1">
        <button type="button" className="tap-quiet w-full">
          <MessageSquare className="size-[18px]" strokeWidth={1.75} />
          Falar com a academia
        </button>
        <button type="button" className="tap-quiet w-full">
          <Download className="size-[18px]" strokeWidth={1.75} />
          Descarregar relatório do período
        </button>
        <button type="button" className="tap-quiet w-full text-ink-3">
          <LogOut className="size-[18px]" strokeWidth={1.75} />
          Terminar sessão
        </button>
      </div>

      <p className="flex items-center justify-center gap-1.5 pt-2 pb-1 text-[12px] text-ink-4">
        <UserRound className="size-3.5" strokeWidth={1.75} />
        Vês apenas os teus educandos.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-3 last:border-0">
      <dt className="text-body text-ink-3">{label}</dt>
      <dd className="text-right text-body font-medium text-ink">{value}</dd>
    </div>
  );
}

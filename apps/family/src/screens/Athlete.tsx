import { useState } from "react";
import { ChevronRight, FileText, MessageSquare, X } from "lucide-react";
import { useChild } from "@/App";
import { useStore, type Evaluation, type Report } from "@/lib/store";
import { Avatar, Bar, Money, cx } from "@/ui";

/**
 * "Como está o meu filho?"
 *
 * Um perfil, não uma ficha administrativa. A assiduidade é um número grande,
 * derivado dos treinos que a academia já registou.
 *
 * A avaliação do treinador e os relatórios partilhados vivem aqui — é o que um pai
 * abre esta app para ver quando não há treino nem mensalidade para tratar.
 *
 * **Nada é inventado.** Só chegam avaliações publicadas e relatórios que a academia
 * decidiu partilhar; enquanto não houver, diz-se que não há. Um pai que veja
 * competências a fingir deixa de confiar em todos os outros números da app.
 */
export default function Athlete() {
  const { child } = useChild();
  const store = useStore();
  const [reading, setReading] = useState<Report | null>(null);

  // O período mais recente primeiro — o store já os ordenou por data de publicação.
  const evaluations = store.evaluations.filter((e) => e.childId === child.id);
  const evaluation = evaluations[0];
  const previous = evaluations[1];
  const reports = store.reports.filter((r) => r.childId === child.id);

  const att = store.attendance[child.id] ?? { attended: 0, total: 0 };
  const rate = att.total > 0 ? att.attended / att.total : null;

  const myMatches = store.matches.filter((m) => m.childId === child.id);
  const played = myMatches.filter((m) => m.calledUp && m.end < new Date()).length;

  return (
    <div className="space-y-6 pt-3">
      {/* Cabeçalho de perfil */}
      <header className="flex flex-col items-center pt-2 text-center">
        <Avatar name={child.name} photoUrl={child.photoUrl} size={84} ring />
        <h1 className="mt-3 text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">{child.name}</h1>
        <p className="mt-0.5 text-meta text-ink-3">
          {child.team} · {child.coach}
        </p>
        {child.availability !== "available" && (
          <span
            className={cx(
              "chip mt-2",
              child.availability === "out" ? "bg-risk-soft text-risk" : "bg-warn-soft text-warn",
            )}
          >
            {child.availability === "out" ? "De baixa clínica" : "Com limitações"}
          </span>
        )}
      </header>

      {/* Dois números lado a lado: presença e convocatórias. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[var(--radius-lg)] bg-surface p-4" style={{ boxShadow: "var(--shadow-soft)" }}>
          <p className="text-[12px] font-semibold tracking-[0.03em] text-ink-3 uppercase">Presença</p>
          {rate === null ? (
            <>
              <p className="num mt-1.5 text-[34px] leading-none font-semibold text-ink-4">—</p>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-4">
                Ainda não há treinos com presenças registadas.
              </p>
            </>
          ) : (
            <>
              <p className="num mt-1.5 text-[34px] leading-none font-semibold text-ink">{Math.round(rate * 100)}%</p>
              <div className="mt-3">
                <Bar value={rate} tone={rate >= 0.85 ? "ok" : rate >= 0.7 ? "signal" : "warn"} />
              </div>
              <p className="mt-2 text-[12px] text-ink-4">
                {att.attended} de {att.total} treinos
              </p>
            </>
          )}
        </div>

        <div className="rounded-[var(--radius-lg)] bg-surface p-4" style={{ boxShadow: "var(--shadow-soft)" }}>
          <p className="text-[12px] font-semibold tracking-[0.03em] text-ink-3 uppercase">Convocatórias</p>
          <p className="num mt-1.5 text-[34px] leading-none font-semibold text-ink">{played}</p>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-4">
            {played === 0 ? "Ainda nenhuma este período." : played === 1 ? "jogo convocado" : "jogos convocados"}
          </p>
        </div>
      </div>

      {evaluation ? (
        <EvaluationCard evaluation={evaluation} previous={previous} />
      ) : (
        <section className="rounded-[var(--radius-lg)] border border-dashed border-line bg-sunken/40 p-5 text-center">
          <p className="text-body font-semibold text-ink">Avaliação do treinador</p>
          <p className="mx-auto mt-1 max-w-[34ch] text-meta leading-relaxed text-ink-3">
            Ainda não há avaliações publicadas para {child.firstName}. Quando o treinador publicar uma, aparece
            aqui e recebes uma notificação.
          </p>
        </section>
      )}

      {/*
        Relatórios.
        
        Só os que a academia partilhou — os internos nunca saem de lá, e isso não é
        uma opção desta app: é o servidor que os não manda.
      */}
      {reports.length > 0 && (
        <section>
          <h2 className="mb-1 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Relatórios</h2>
          <ul className="overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)]">
            {reports.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setReading(r)}
                  className="flex w-full items-center gap-3 border-b border-line p-4 text-left last:border-0 active:bg-sunken"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2">
                    <FileText className="size-[18px]" strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold text-ink">{r.title}</span>
                    <span className="block truncate text-meta text-ink-3">
                      {[r.period, r.authorName].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-ink-4" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reading && <ReportSheet report={reading} onClose={() => setReading(null)} />}

      {/* Inscrição — linhas soltas, sem caixa. */}
      <section>
        <h2 className="mb-1 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Inscrição</h2>
        <dl className="px-1">
          {child.sport && <Row label="Modalidade" value={child.sport} />}
          <Row label="Escalão" value={child.team} />
          <Row label="Treinador" value={child.coach} />
          <Row
            label="Mensalidade"
            value={child.feeCents !== null ? <Money cents={child.feeCents} size="md" /> : <span className="text-ink-4">por configurar</span>}
            sub={child.feeCents !== null ? "/ mês" : undefined}
          />
          <Row label="Academia" value={store.academy.name} />
        </dl>
      </section>

      {/*
        Acções deste educando. A sessão e as definições da conta mudaram-se para o
        perfil (o avatar no canto): não são coisas do atleta, e um pai com dois
        filhos via "Terminar sessão" duas vezes, uma por cada ficha.
      */}
      <div className="space-y-2 pb-1">
        <ActionRow icon={MessageSquare} label="Falar com a academia" />
      </div>
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

/* -------------------------------------------------------------------------- */

/**
 * A avaliação do período.
 *
 * ## O que vem primeiro
 *
 * O que o treinador escreveu — não as barras. Um pai quer saber *como está o meu
 * filho*, e a resposta a isso é uma frase, não uma grelha. As competências vêm a
 * seguir, para quem quiser o detalhe, e a seta ao lado de cada uma diz o que
 * mudou desde a avaliação anterior.
 *
 * ## Porque é que não há média
 *
 * Porque uma média vira nota, e uma nota vira comparação entre miúdos no grupo de
 * WhatsApp dos pais. As competências dizem onde melhorar; um 3,4 não diz nada a
 * ninguém e magoa na mesma.
 */
function EvaluationCard({ evaluation, previous }: { evaluation: Evaluation; previous?: Evaluation }) {
  const skills = Object.keys(evaluation.scores);

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)]">
      <header className="border-b border-line px-4 pt-4 pb-3">
        <p className="text-[12px] font-semibold tracking-[0.03em] text-ink-3 uppercase">Avaliação do treinador</p>
        <p className="mt-0.5 text-body font-semibold text-ink">{evaluation.period}</p>
        <p className="text-meta text-ink-3">
          {evaluation.coachName}
          {evaluation.publishedAt && ` · ${evaluation.publishedAt.toLocaleDateString("pt-PT", { day: "numeric", month: "long" })}`}
        </p>
      </header>

      {(evaluation.strengths || evaluation.focus || evaluation.note) && (
        <div className="space-y-3 border-b border-line px-4 py-4">
          {evaluation.strengths && (
            <div>
              <p className="text-[12px] font-semibold tracking-[0.03em] text-ink-3 uppercase">O que está bem</p>
              <p className="mt-1 text-body leading-relaxed text-ink">{evaluation.strengths}</p>
            </div>
          )}
          {evaluation.focus && (
            <div>
              <p className="text-[12px] font-semibold tracking-[0.03em] text-ink-3 uppercase">A trabalhar</p>
              <p className="mt-1 text-body leading-relaxed text-ink">{evaluation.focus}</p>
            </div>
          )}
          {evaluation.note && <p className="text-body leading-relaxed text-ink-2">{evaluation.note}</p>}
        </div>
      )}

      <ul className="px-4 py-3">
        {skills.map((skill) => {
          const value = evaluation.scores[skill];
          const before = previous?.scores[skill];
          const delta = before === undefined ? 0 : value - before;

          return (
            <li key={skill} className="flex items-center gap-3 py-2">
              <span className="w-[92px] shrink-0 truncate text-meta text-ink-2">{skill}</span>
              <span className="flex-1">
                <Bar value={value / 5} tone={value >= 4 ? "ok" : value >= 3 ? "signal" : "warn"} />
              </span>
              <span className="num w-6 shrink-0 text-right text-body font-semibold text-ink">{value}</span>
              {/*
                A evolução, quando há com que comparar. Uma seta e um número — não
                uma percentagem, que numa escala de cinco pontos seria falsa
                precisão sobre a opinião de uma pessoa.
              */}
              <span
                className={cx(
                  "w-7 shrink-0 text-right text-[12px] font-semibold tabular",
                  delta > 0 ? "text-ok" : delta < 0 ? "text-warn" : "text-ink-4",
                )}
              >
                {before === undefined ? "" : delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "="}
              </span>
            </li>
          );
        })}
      </ul>

      {previous && (
        <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-4">
          Comparado com {previous.period}.
        </p>
      )}
    </section>
  );
}

/**
 * Ler um relatório.
 *
 * Uma folha que sobe por cima de tudo, e não uma página nova: o pai está a ler três
 * parágrafos sobre o filho, não a navegar. Fecha-se com o X ou com o fundo, e volta
 * exactamente ao sítio onde estava.
 */
function ReportSheet({ report, onClose }: { report: Report; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-ink/30"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88dvh] w-full overflow-y-auto rounded-t-[var(--radius-xl)] bg-canvas pb-[env(safe-area-inset-bottom)]"
      >
        <header className="sticky top-0 flex items-start gap-3 border-b border-line bg-canvas px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] leading-tight font-semibold text-ink">{report.title}</h2>
            <p className="mt-0.5 text-meta text-ink-3">
              {[report.period, report.authorName].filter(Boolean).join(" · ")}
              {report.publishedAt && ` · ${report.publishedAt.toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" })}`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-btn -mr-2 shrink-0" aria-label="Fechar">
            <X className="size-5" strokeWidth={2} />
          </button>
        </header>

        <div className="space-y-3 px-5 py-4">
          {/* Parágrafos separados por linhas em branco — é como o treinador escreve. */}
          {report.body.split(/\n\s*\n/).map((paragraph, i) => (
            <p key={i} className="text-body leading-relaxed text-ink">
              {paragraph}
            </p>
          ))}
        </div>

        {report.snapshot?.attendance && (
          <div className="mx-5 mb-6 rounded-[var(--radius-md)] bg-surface p-4 shadow-[var(--shadow-soft)]">
            <p className="text-[12px] font-semibold tracking-[0.03em] text-ink-3 uppercase">Nesta altura</p>
            <div className="mt-2 flex gap-6">
              <div>
                <p className="num text-[22px] leading-none font-semibold text-ink">
                  {report.snapshot.attendance.total > 0
                    ? `${Math.round((report.snapshot.attendance.attended / report.snapshot.attendance.total) * 100)}%`
                    : "—"}
                </p>
                <p className="mt-1 text-[12px] text-ink-4">presença</p>
              </div>
              <div>
                <p className="num text-[22px] leading-none font-semibold text-ink">{report.snapshot.matches ?? 0}</p>
                <p className="mt-1 text-[12px] text-ink-4">jogos</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

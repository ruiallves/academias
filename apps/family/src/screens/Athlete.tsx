import { ChevronRight, Download, MessageSquare } from "lucide-react";
import { useChild } from "@/App";
import { useStore } from "@/lib/store";
import { Avatar, Bar, Money, cx } from "@/ui";

/**
 * "Como está o meu filho?"
 *
 * Um perfil, não uma ficha administrativa. A assiduidade é um número grande,
 * derivado dos treinos que a academia já registou.
 *
 * **A avaliação do treinador ainda não tem endpoint** — e por isso não aparece
 * aqui um gráfico a fingir. Um pai que veja competências inventadas deixa de
 * confiar em todos os outros números da app; dizer "ainda não há" custa menos.
 */
export default function Athlete() {
  const { child } = useChild();
  const store = useStore();

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

      {/*
        A avaliação vive na consola do treinador e ainda não sai para a família.
        Um espaço reservado honesto vale mais do que um radar de competências
        inventado — e diz ao pai que isto está a caminho.
      */}
      <section className="rounded-[var(--radius-lg)] border border-dashed border-line bg-sunken/40 p-5 text-center">
        <p className="text-body font-semibold text-ink">Avaliação do treinador</p>
        <p className="mx-auto mt-1 max-w-[34ch] text-meta leading-relaxed text-ink-3">
          Ainda não há avaliações publicadas para {child.firstName}. Quando o treinador publicar uma, aparece
          aqui e recebes uma notificação.
        </p>
      </section>

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
        <ActionRow icon={Download} label="Descarregar relatório do período" />
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

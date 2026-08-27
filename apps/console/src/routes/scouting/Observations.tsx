import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { Eye, MapPin } from "@/lib/icons";
import {
  CONTEXT_LABEL,
  RECOMMENDATION_LABEL,
  listObservations,
  sinceLabel,
  type ObservationRow,
} from "@/lib/scouting";

/**
 * O trabalho feito.
 *
 * A única vista onde as observações se leem sem passar por um dossiê — responde a
 * "o que é que o departamento andou a fazer?", que é a pergunta de quem coordena e
 * não de quem observa.
 *
 * Ordenada pela data da observação e não pela de registo: um scout que só escreve
 * ao domingo à noite o que viu no sábado não deve aparecer como tendo trabalhado
 * ao domingo.
 */
export default function ScoutingObservations() {
  const [rows, setRows] = useState<ObservationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<string | null>("30");
  const [scoutId, setScoutId] = useState<string | null>(null);

  const load = useCallback(() => {
    listObservations({ ...(days ? { days } : {}), ...(scoutId ? { scoutId } : {}) })
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível carregar."));
  }, [days, scoutId]);

  useEffect(load, [load]);

  // Os scouts que aparecem no período — derivado dos dados, não de uma lista de
  // pessoas: quem não observou não tem por que aparecer num filtro.
  const scouts = [...new Map((rows ?? []).filter((r) => r.scoutId).map((r) => [r.scoutId!, r.scout!])).entries()];

  return (
    <>
      <PageHeader
        eyebrow="Scouting"
        title="Observações"
        subtitle={rows ? `${rows.length} no período` : undefined}
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {[
          { value: "7", label: "7 dias" },
          { value: "30", label: "30 dias" },
          { value: "90", label: "3 meses" },
          { value: null, label: "Tudo" },
        ].map((o) => (
          <Chip key={o.label} active={days === o.value} onClick={() => setDays(o.value)}>
            {o.label}
          </Chip>
        ))}

        {scouts.length > 1 && (
          <>
            <span className="mx-1 h-4 w-px bg-line" />
            <Chip active={scoutId === null} onClick={() => setScoutId(null)}>
              Todos
            </Chip>
            {scouts.map(([id, name]) => (
              <Chip key={id} active={scoutId === id} onClick={() => setScoutId(id)}>
                {name}
              </Chip>
            ))}
          </>
        )}
      </div>

      <Panel>
        <PanelHead title="Idas ao campo" hint={rows ? `${rows.length}` : undefined} />

        {error ? (
          <div>
            <Empty title="Não foi possível carregar" detail={error} />
          </div>
        ) : !rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <div>
            <Empty
              icon={Eye}
              title="Sem observações no período"
              detail="Alarga o intervalo, ou regista a primeira a partir da ficha de um prospecto."
            />
          </div>
        ) : (
          <ul>
            {rows.map((o) => (
              <li key={o.id} className="border-b border-line px-5 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/scouting/prospects/${o.prospect.id}`}
                    className="text-body font-medium text-ink hover:underline"
                  >
                    {o.prospect.name}
                  </Link>
                  {o.prospect.position && <span className="text-meta text-ink-3">{o.prospect.position}</span>}
                  <Pill tone="signal">{RECOMMENDATION_LABEL[o.recommendation]}</Pill>
                  <span className="ml-auto text-meta text-ink-4">{sinceLabel(o.observedAt)}</span>
                </div>

                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-3">
                  <span className="inline-flex items-center gap-1">
                    <Eye className="size-3.5" strokeWidth={1.75} />
                    {CONTEXT_LABEL[o.context]}
                  </span>
                  {o.opponent && <span>vs {o.opponent}</span>}
                  {o.competition && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5" strokeWidth={1.75} />
                      {o.competition}
                    </span>
                  )}
                  {o.minutesObserved && <span className="tabular">{o.minutesObserved}′ observados</span>}
                  <span className="text-ink-4">· {o.scout ?? "scout removido"}</span>
                </div>

                {(o.strengths.length > 0 || o.improvements.length > 0) && (
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {o.strengths.slice(0, 4).map((s) => (
                      <li key={`s-${s}`}>
                        <Pill tone="ok">{s}</Pill>
                      </li>
                    ))}
                    {o.improvements.slice(0, 3).map((s) => (
                      <li key={`i-${s}`}>
                        <Pill tone="warn">{s}</Pill>
                      </li>
                    ))}
                  </ul>
                )}

                {o.notes && <p className="mt-1.5 line-clamp-2 text-body text-ink-2">{o.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
        active ? "border-transparent bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
      )}
    >
      {children}
    </button>
  );
}

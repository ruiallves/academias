import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Segmented } from "@/components/filters";
import { Bar, Empty, Loading, Monogram, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { ArrowLeft, Binoculars, Clock, Eye, Film, Gauge, MapPin, Pencil, Plus } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { sportById } from "@/lib/api";
import { NewObservationDialog } from "@/components/NewObservationDialog";
import { ProspectVideos } from "@/components/ProspectVideos";
import { AddToShortlistDialog, FitPanel, RecruitDialog } from "@/components/ProspectPanels";
import { ProposeToRequestDialog, ProspectEditPanel } from "@/components/ProspectEditPanel";
import {
  CONTEXT_LABEL,
  RECOMMENDATION_LABEL,
  STAGE_LABEL,
  STAGE_ORDER,
  ageOf,
  getCriteria,
  getProspect,
  setStage,
  sinceLabel,
  stageColor,
  type Criterion,
  type Observation,
  type ProspectDetail as Data,
  type Stage,
} from "@/lib/scouting";

type Tab = "overview" | "observations" | "assessment" | "videos" | "history";

/**
 * O dossiê de um prospecto.
 *
 * Uma ferramenta de trabalho, não uma ficha administrativa. O cabeçalho responde a
 * "quem é e onde está" numa leitura; o resto está em separadores porque um scout
 * que vem registar uma observação e um director que vem decidir precisam de coisas
 * diferentes no mesmo dossiê.
 *
 * ## O funil é uma régua, não uma etiqueta
 *
 * O estado aparece como uma barra de passos por baixo do nome, e é aí que se muda.
 * Uma *pill* diria onde ele está; a régua diz **onde está no caminho** — que é a
 * informação que faz alguém perceber que há uma decisão por tomar.
 */
export default function ProspectDetail() {
  const { id = "" } = useParams();
  const { session } = useSession();
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<Data | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [observing, setObserving] = useState(false);
  const [shortlisting, setShortlisting] = useState(false);
  const [recruiting, setRecruiting] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    getProspect(id)
      .then((p) => {
        setData(p);
        return getCriteria(p.sportId).then(setCriteria);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível carregar."));
  }, [id]);

  useEffect(load, [load]);

  if (error) {
    return (
      <>
        <BackLink />
        <Panel>
          <div>
            <Empty title="Prospecto não encontrado" detail="Ou não pertence a esta academia." />
          </div>
        </Panel>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <BackLink />
        <Panel>
          <Loading />
        </Panel>
      </>
    );
  }

  const mayWrite = can(session, "scouting:write");
  const sport = sportById(data.sportId);

  const tabs: { value: Tab; label: string; icon: typeof Eye }[] = [
    { value: "overview", label: "Visão geral", icon: Binoculars },
    { value: "observations", label: "Observações", icon: Eye },
    { value: "assessment", label: "Avaliação", icon: Gauge },
    { value: "videos", label: "Vídeos", icon: Film },
    { value: "history", label: "Histórico", icon: Clock },
  ];

  return (
    <>
      <BackLink />

      <header className="mb-5 flex flex-wrap items-start gap-4">
        <Monogram name={data.name} size="lg" />

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {sport && <Pill tone="signal">{sport.name}</Pill>}
            <span className="text-meta text-ink-3">
              {ageOf(data.birthdate)} anos
              {data.position && ` · ${data.position}`}
            </span>
            {data.currentClub && <span className="text-meta text-ink-3">· {data.currentClub}</span>}
          </div>
          <h1 className="text-page text-ink">{data.name}</h1>
          <p className="mt-0.5 text-body text-ink-3">
            {data.observations.length} {data.observations.length === 1 ? "observação" : "observações"} · última{" "}
            {sinceLabel(data.lastObservedAt)}
            {data.owner && ` · ${data.owner}`}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {mayWrite && data.stage !== "RECRUITED" && (
            <>
              <button type="button" className="ctl-ghost" onClick={() => setProposing(true)}>
                Propor para pedido
              </button>
              <button type="button" className="ctl-ghost" onClick={() => setShortlisting(true)}>
                Pôr em shortlist
              </button>
            </>
          )}
          {/* Recrutar só aparece quando já houve trabalho feito: um botão de
              conversão ao lado de um dossiê sem uma única observação convida a
              inscrever alguém que ninguém viu. */}
          {mayWrite && !data.athleteId && data.observations.length > 0 && (
            <button type="button" className="ctl-ghost" onClick={() => setRecruiting(true)}>
              Recrutar
            </button>
          )}
          {data.athleteId && (
            <Link to={`/atletas/${data.athleteId}`} className="ctl-ghost">
              Ver ficha de atleta
            </Link>
          )}
          {mayWrite && (
            <button type="button" className="ctl-primary" onClick={() => setObserving(true)}>
              <Plus className="size-3.5" strokeWidth={2} />
              Registar observação
            </button>
          )}
        </div>
      </header>

      <StageRail stage={data.stage} mayWrite={mayWrite} onChange={(s) => void setStage(id, s).then(load)} />

      {/* Editar ao lado dos separadores, como na ficha do atleta — e a página
          troca de modo em vez de abrir uma janela por cima. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented value={tab} onChange={setTab} options={tabs} />
        {!editing && mayWrite && (
          <button type="button" className="ctl-ghost shrink-0" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" strokeWidth={1.75} />
            Editar
          </button>
        )}
      </div>

      {editing ? (
        <ProspectEditPanel
          prospect={data}
          onDone={() => {
            setEditing(false);
            load();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          {tab === "overview" && <OverviewTab data={data} mayWrite={mayWrite} onSaved={load} />}
          {tab === "observations" && <ObservationsTab data={data} criteria={criteria} />}
          {tab === "assessment" && <AssessmentTab data={data} criteria={criteria} />}
          {tab === "videos" && <ProspectVideos prospectId={data.id} session={session} />}
          {tab === "history" && <HistoryTab data={data} />}
        </>
      )}

      {proposing && (
        <ProposeToRequestDialog
          prospect={data}
          onClose={() => setProposing(false)}
          onDone={() => {
            setProposing(false);
            load();
          }}
        />
      )}

      {shortlisting && (
        <AddToShortlistDialog
          prospectId={data.id}
          onClose={() => setShortlisting(false)}
          onAdded={() => {
            setShortlisting(false);
            load();
          }}
        />
      )}

      {recruiting && (
        <RecruitDialog
          prospect={data}
          session={session}
          onClose={() => setRecruiting(false)}
          onRecruited={() => {
            setRecruiting(false);
            load();
          }}
        />
      )}

      {observing && (
        <NewObservationDialog
          prospect={data}
          criteria={criteria}
          onClose={() => setObserving(false)}
          onCreated={() => {
            setObserving(false);
            load();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A régua do funil.
 *
 * Os passos até "Recrutado", em linha, com o actual preenchido e os anteriores
 * marcados. Clicar move o dossiê — e a mudança fica no histórico com o nome de
 * quem a fez, que é o que separa uma decisão de um acidente.
 *
 * "Não avançar" está fora da régua, à direita: não é um passo do caminho, é a
 * saída dele. E é reversível — um miúdo dispensado aos 13 volta a interessar aos
 * 15, e o produto não finge que ele nunca existiu.
 */
function StageRail({
  stage,
  mayWrite,
  onChange,
}: {
  stage: Stage;
  mayWrite: boolean;
  onChange: (s: Stage) => void;
}) {
  const path: Stage[] = STAGE_ORDER.filter((s) => s !== "REJECTED");
  const current = path.indexOf(stage);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {path.map((s, i) => {
          const done = current >= 0 && i < current;
          const active = s === stage;
          return (
            <button
              key={s}
              type="button"
              disabled={!mayWrite}
              onClick={() => onChange(s)}
              className={cx(
                "rounded-[var(--radius-control)] px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
                active && "bg-ink text-surface",
                !active && done && "text-ink-2",
                !active && !done && "text-ink-4",
                mayWrite && !active && "hover:bg-sunken",
              )}
              /*
                Uma fase já cumprida acende com a **cor dessa fase**, muito
                diluída — e não com um tom da cor do clube. É a mesma tabela que
                o funil usa (`stageColor`), por isso o que aqui se vê a violeta é
                a mesma fatia violeta lá. Antes eram dois sistemas de cor a falar
                do mesmo, e num clube amarelo o "cumprido" era amarelo aqui e a
                fase era amarela lá também — indistinguíveis.
              */
              style={
                !active && done
                  ? { background: `color-mix(in oklab, ${stageColor(s)} 12%, white)` }
                  : undefined
              }
            >
              {STAGE_LABEL[s]}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={!mayWrite}
        onClick={() => onChange(stage === "REJECTED" ? "WATCHING" : "REJECTED")}
        className={cx(
          "shrink-0 rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
          stage === "REJECTED" ? "border-transparent bg-risk-soft text-risk" : "border-line text-ink-3 hover:border-line-strong",
        )}
      >
        {stage === "REJECTED" ? "Reabrir" : "Descartar"}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function OverviewTab({
  data,
  mayWrite,
  onSaved,
}: {
  data: Data;
  mayWrite: boolean;
  onSaved: () => void;
}) {
  const last = data.observations[0];

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel>
        <PanelHead title="Dossiê" />
        <dl className="px-5 py-1.5">
          <Row label="Data de nascimento" value={new Date(data.birthdate).toLocaleDateString("pt-PT")} />
          <Row label="Clube actual" value={data.currentClub ?? "—"} />
          <Row label="Equipa" value={data.currentTeam ?? "—"} />
          <Row label="Posição" value={data.position ?? "—"} />
          <Row
            label="Outras posições"
            value={data.secondaryPositions.length ? data.secondaryPositions.join(", ") : "—"}
          />
          <Row label="Como apareceu" value={data.discoveredVia ?? "—"} />
          <Row label="No scouting desde" value={new Date(data.discoveredAt).toLocaleDateString("pt-PT")} />
          <Row label="Responsável" value={data.owner ?? "sem responsável"} />
        </dl>
      </Panel>

      <Panel>
        <PanelHead title="Última observação" hint={last ? sinceLabel(last.observedAt) : undefined} />
        {!last ? (
          <div className="px-5 py-10">
            <Empty
              icon={Eye}
              title="Ainda ninguém o viu"
              detail="Um prospecto sem observações é um nome numa lista — regista a primeira ida ao campo."
            />
          </div>
        ) : (
          <div className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone="signal">{CONTEXT_LABEL[last.context]}</Pill>
              {last.opponent && <span className="text-meta text-ink-3">vs {last.opponent}</span>}
              {last.minutesObserved && <span className="text-meta text-ink-3">· {last.minutesObserved}′ vistos</span>}
            </div>

            {last.notes && <p className="text-body leading-relaxed text-ink-2">{last.notes}</p>}

            <Points strengths={last.strengths} improvements={last.improvements} />

            <div className="border-t border-line pt-3 text-meta text-ink-3">
              {last.scout ?? "scout removido"} recomenda:{" "}
              <strong className="font-medium text-ink">{RECOMMENDATION_LABEL[last.recommendation]}</strong>
            </div>
          </div>
        )}
      </Panel>

      <FitPanel prospect={data} mayWrite={mayWrite} onSaved={onSaved} />

      {data.shortlists.length > 0 && (
        <Panel>
          <PanelHead title="Shortlists" hint={`${data.shortlists.length}`} />
          <ul className="px-5 py-2">
            {data.shortlists.map((s) => (
              <li key={s.id} className="border-b border-line py-2.5 last:border-0">
                <Link to={`/scouting/shortlists/${s.shortlist.id}`} className="text-body text-ink hover:underline">
                  {s.shortlist.name}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {data.notes && (
        <Panel className="lg:col-span-2">
          <PanelHead title="Notas" />
          <p className="px-5 py-4 text-body leading-relaxed whitespace-pre-line text-ink-2">{data.notes}</p>
        </Panel>
      )}
    </div>
  );
}

function ObservationsTab({ data, criteria }: { data: Data; criteria: Criterion[] }) {
  if (data.observations.length === 0) {
    return (
      <Panel>
        <div>
          <Empty
            icon={Eye}
            title="Ainda sem observações"
            detail="Cada ida ao campo é uma observação. Nunca há uma avaliação única — é a lista que conta a história."
          />
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      {data.observations.map((o) => (
        <ObservationCard key={o.id} o={o} criteria={criteria} />
      ))}
    </div>
  );
}

function ObservationCard({ o, criteria }: { o: Observation; criteria: Criterion[] }) {
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const scored = o.ratings.map((r) => ({ ...r, criterion: byId.get(r.criterionId) })).filter((r) => r.criterion);

  return (
    <Panel>
      <PanelHead
        title={new Date(o.observedAt).toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" })}
        hint={o.scout ?? undefined}
      >
        <Pill tone="signal">{RECOMMENDATION_LABEL[o.recommendation]}</Pill>
      </PanelHead>

      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-3">
          <span className="inline-flex items-center gap-1">
            <Eye className="size-3.5" strokeWidth={1.75} />
            {CONTEXT_LABEL[o.context]}
          </span>
          {o.opponent && <span>vs {o.opponent}</span>}
          {o.competition && <span>· {o.competition}</span>}
          {o.venue && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" strokeWidth={1.75} />
              {o.venue}
            </span>
          )}
          {o.minutesObserved && <span className="tabular">· {o.minutesObserved}′ observados</span>}
          {o.positionObserved && <span>· jogou a {o.positionObserved}</span>}
        </div>

        {o.notes && <p className="text-body leading-relaxed text-ink-2">{o.notes}</p>}

        <Points strengths={o.strengths} improvements={o.improvements} />

        {scored.length > 0 && (
          <div className="grid gap-x-6 gap-y-1.5 border-t border-line pt-3 sm:grid-cols-2">
            {scored.map((r) => (
              <div key={r.criterionId} className="flex items-center gap-2.5">
                <span className="min-w-0 flex-1 truncate text-meta text-ink-3">{r.criterion!.name}</span>
                <span className="w-20 shrink-0">
                  <Bar value={r.score / 5} />
                </span>
                <span className="w-4 shrink-0 text-right text-meta font-semibold text-ink tabular">{r.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

/**
 * A avaliação agregada — **médias por critério, nunca um número único**.
 *
 * Não há "Overall 87". Um número só esconde que este miúdo é excelente a passar e
 * fraco no duelo, e é exactamente essa diferença que decide se ele serve para o
 * que a equipa precisa. A plataforma mostra as dimensões; quem decide é quem
 * decide.
 *
 * Um critério sem notas diz "sem dados" e não zero. Zero é uma avaliação; ausência
 * não é.
 */
function AssessmentTab({ data, criteria }: { data: Data; criteria: Criterion[] }) {
  if (criteria.length === 0) {
    return (
      <Panel>
        <div>
          <Empty
            title="Esta modalidade ainda não tem critérios"
            detail="O quadro de avaliação é configurável por modalidade — sem ele, as observações ficam só em texto."
          />
        </div>
      </Panel>
    );
  }

  const scores = new Map<string, number[]>();
  for (const o of data.observations) {
    for (const r of o.ratings) {
      scores.set(r.criterionId, [...(scores.get(r.criterionId) ?? []), r.score]);
    }
  }

  const groups = [...new Set(criteria.map((c) => c.group))];

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {groups.map((group) => (
        <Panel key={group}>
          <PanelHead title={group} />
          <ul className="px-5 py-2">
            {criteria
              .filter((c) => c.group === group)
              .map((c) => {
                const values = scores.get(c.id) ?? [];
                const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
                return (
                  <li key={c.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                    <span className="min-w-0 flex-1 truncate text-body text-ink-2">{c.name}</span>
                    {avg === null ? (
                      <span className="text-meta text-ink-4">sem dados</span>
                    ) : (
                      <>
                        <span className="w-24 shrink-0">
                          <Bar value={avg / 5} tone={avg >= 4 ? "ok" : avg >= 2.5 ? "signal" : "warn"} />
                        </span>
                        <span className="w-8 shrink-0 text-right text-body font-semibold text-ink tabular">
                          {avg.toFixed(1)}
                        </span>
                        <span className="w-10 shrink-0 text-right text-meta text-ink-4 tabular">
                          {values.length}×
                        </span>
                      </>
                    )}
                  </li>
                );
              })}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

function HistoryTab({ data }: { data: Data }) {
  if (data.events.length === 0) {
    return (
      <Panel>
        <div>
          <Empty title="Sem histórico" detail="Cada mudança de estado fica registada aqui." />
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHead title="Histórico" hint="quem decidiu o quê, e quando" />
      <ul className="px-5 py-1.5">
        {data.events.map((e) => (
          <li key={e.id} className="flex items-start gap-3 border-b border-line py-3 last:border-0">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-ink-4" />
            <div className="min-w-0 flex-1">
              <div className="text-body text-ink">{describe(e)}</div>
              {e.note && <div className="text-meta text-ink-3">{e.note}</div>}
              <div className="text-meta text-ink-4">
                {e.actor ?? "sistema"} · {new Date(e.at).toLocaleDateString("pt-PT")}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function describe(e: Data["events"][number]): string {
  if (e.kind === "created") return "Entrou no scouting";
  if (e.kind === "stage") {
    const from = e.from ? STAGE_LABEL[e.from as Stage] : "—";
    const to = e.to ? STAGE_LABEL[e.to as Stage] : "—";
    return `${from} → ${to}`;
  }
  if (e.kind === "observation") return "Nova observação registada";
  return e.kind;
}

/* -------------------------------------------------------------------------- */

/**
 * Fortes e a desenvolver, lado a lado.
 *
 * Nunca só os fortes: uma ficha que só elogia não ajuda ninguém a decidir, e um
 * scout que não escreve o que preocupa está a vender em vez de observar.
 */
function Points({ strengths, improvements }: { strengths: string[]; improvements: string[] }) {
  if (strengths.length === 0 && improvements.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <div className="mb-1.5 text-group text-ink-4 uppercase">Pontos fortes</div>
        {strengths.length === 0 ? (
          <span className="text-meta text-ink-4">—</span>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {strengths.map((s) => (
              <li key={s}>
                <Pill tone="ok">{s}</Pill>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="mb-1.5 text-group text-ink-4 uppercase">A desenvolver</div>
        {improvements.length === 0 ? (
          <span className="text-meta text-ink-4">—</span>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {improvements.map((s) => (
              <li key={s}>
                <Pill tone="warn">{s}</Pill>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line py-2.5 last:border-0">
      <dt className="min-w-0 flex-1 text-body text-ink-3">{label}</dt>
      <dd className="shrink-0 text-right text-body font-medium text-ink">{value}</dd>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/scouting/prospects"
      className="mb-3 inline-flex items-center gap-1.5 text-meta font-medium text-ink-3 hover:text-ink"
    >
      <ArrowLeft className="size-3.5" strokeWidth={1.75} />
      Prospects
    </Link>
  );
}

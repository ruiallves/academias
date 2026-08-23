import { Fragment, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Bar, Empty, Loading, Monogram, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { ArrowLeft, Binoculars, Plus, Trash2 } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { sportById } from "@/lib/api";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { StagePill } from "./Prospects";
import {
  RECOMMENDATION_LABEL,
  ageOf,
  compare,
  createShortlist,
  getFitDimensions,
  getShortlist,
  listShortlists,
  removeFromShortlist,
  sinceLabel,
  type Comparison,
  type FitDimension,
  type ShortlistDetail,
  type ShortlistRow,
} from "@/lib/scouting";

/**
 * As listas de trabalho.
 *
 * Uma shortlist é uma pergunta com nome: "quem é o lateral esquerdo do Sub-15 para
 * a próxima época?". O que a torna útil não é guardar nomes — é conseguir olhar
 * para os nomes lado a lado sem abrir nove fichas.
 */
export default function Shortlists() {
  const { session } = useSession();
  const [rows, setRows] = useState<ShortlistRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    listShortlists()
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível carregar."));
  }, []);

  useEffect(load, [load]);

  return (
    <>
      <PageHeader
        eyebrow="Scouting"
        title="Shortlists"
        subtitle={rows ? `${rows.length} ${rows.length === 1 ? "lista" : "listas"}` : undefined}
      >
        {can(session, "scouting:write") && (
          <button type="button" className="ctl-primary" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" strokeWidth={2} />
            Nova shortlist
          </button>
        )}
      </PageHeader>

      {error && (
        <Panel>
          <div className="px-5 py-10">
            <Empty title="Não foi possível carregar" detail={error} />
          </div>
        </Panel>
      )}

      {!rows && !error && (
        <Panel>
          <Loading />
        </Panel>
      )}

      {rows && rows.length === 0 && (
        <Panel>
          <div className="px-5 py-16">
            <Empty
              icon={Binoculars}
              title="Ainda não há shortlists"
              detail="Uma shortlist é uma pergunta com nome — “o lateral esquerdo do Sub-15 para a próxima época”."
            />
          </div>
        </Panel>
      )}

      {rows && rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <Link
              key={s.id}
              to={`/scouting/shortlists/${s.id}`}
              className="panel flex flex-col gap-2 p-4 transition-colors duration-[120ms] hover:border-line-strong"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-panel text-ink">{s.name}</span>
                <span className="shrink-0 text-metric text-ink tabular">{s.count}</span>
              </div>
              <div className="text-meta text-ink-3">
                {s.description ?? [s.ageGroup, s.profile].filter(Boolean).join(" · ") ?? ""}
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                {s.sportId && <Pill tone="signal">{sportById(s.sportId)?.name ?? "—"}</Pill>}
                {s.ageGroup && <Pill>{s.ageGroup}</Pill>}
                <span className="ml-auto text-meta text-ink-4">{s.createdBy ?? ""}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <NewShortlistDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function NewShortlistDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const [profile, setProfile] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length >= 2;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createShortlist({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(ageGroup.trim() ? { ageGroup: ageGroup.trim() } : {}),
        ...(profile.trim() ? { profile: profile.trim() } : {}),
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível criar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Nova shortlist"
      subtitle="Uma pergunta com nome"
      onClose={onClose}
      width={440}
      labelledBy="new-shortlist"
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? "A criar…" : "Criar"}
          </button>
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <DialogField label="Nome">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sub-13 · Defesa central"
            className={dialogInputClass}
          />
        </DialogField>
        <DialogField label="Descrição" hint="opcional">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Para a época 2027/28"
            className={dialogInputClass}
          />
        </DialogField>
        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Escalão" hint="opcional">
            <input value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)} className={dialogInputClass} />
          </DialogField>
          <DialogField label="Perfil" hint="opcional">
            <input value={profile} onChange={(e) => setProfile(e.target.value)} className={dialogInputClass} />
          </DialogField>
        </div>
        <p className="text-meta leading-relaxed text-ink-3">
          Os campos servem para descrever a lista, não para a preencher — quem entra é sempre escolha de
          uma pessoa.
        </p>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* A lista, e a comparação                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Uma shortlist aberta.
 *
 * Cada linha traz o que é preciso para decidir sem sair daqui: idade, posição,
 * clube, última observação, a recomendação mais recente e o encaixe. E,
 * seleccionando dois a quatro, a comparação abre por baixo — que é o momento em
 * que a lista deixa de ser um índice e passa a ser uma ferramenta.
 */
export function ShortlistDetail() {
  const { id = "" } = useParams();
  const { session } = useSession();
  const [data, setData] = useState<ShortlistDetail | null>(null);
  const [dimensions, setDimensions] = useState<FitDimension[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getShortlist(id)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível carregar."));
    void getFitDimensions().then(setDimensions);
  }, [id]);

  useEffect(load, [load]);

  // A comparação segue a selecção, e não um botão: escolher dois nomes **é** o
  // pedido. Um "Comparar" a seguir seria um passo que não decide nada.
  useEffect(() => {
    if (picked.length < 2) {
      setComparison(null);
      return;
    }
    let alive = true;
    void compare(picked)
      .then((c) => alive && setComparison(c))
      .catch(() => alive && setComparison(null));
    return () => {
      alive = false;
    };
  }, [picked]);

  const mayWrite = can(session, "scouting:write");

  if (error) {
    return (
      <>
        <Back />
        <Panel>
          <div className="px-5 py-16">
            <Empty title="Shortlist não encontrada" detail="Ou não pertence a esta academia." />
          </div>
        </Panel>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <Back />
        <Panel>
          <Loading />
        </Panel>
      </>
    );
  }

  function toggle(prospectId: string) {
    setPicked((p) =>
      p.includes(prospectId) ? p.filter((x) => x !== prospectId) : p.length >= 4 ? p : [...p, prospectId],
    );
  }

  return (
    <>
      <Back />

      <PageHeader
        eyebrow="Shortlist"
        title={data.name}
        subtitle={
          data.description ??
          [data.ageGroup, data.profile].filter(Boolean).join(" · ") ??
          `${data.entries.length} prospectos`
        }
      >
        {picked.length > 0 && (
          <button type="button" className="ctl-ghost" onClick={() => setPicked([])}>
            Limpar selecção ({picked.length})
          </button>
        )}
      </PageHeader>

      <Panel>
        <PanelHead
          title={`${data.entries.length} ${data.entries.length === 1 ? "prospecto" : "prospectos"}`}
          hint={picked.length < 2 ? "escolhe dois a quatro para comparar" : `${picked.length} escolhidos`}
        />

        {data.entries.length === 0 ? (
          <div className="px-5 py-16">
            <Empty
              title="Lista vazia"
              detail="Adiciona prospectos a partir da ficha de cada um, no separador Shortlists."
            />
          </div>
        ) : (
          <ul>
            {data.entries.map((e) => {
              const p = e.prospect;
              const on = picked.includes(p.id);
              return (
                <li
                  key={e.id}
                  className={cx(
                    "flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 last:border-b-0",
                    on && "bg-sunken/60",
                  )}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(p.id)}
                    className={cx(
                      "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-[120ms]",
                      on ? "border-transparent bg-signal" : "border-line-strong bg-surface",
                    )}
                  >
                    {on && <span className="size-1.5 rounded-[1px] bg-white" />}
                  </button>

                  <Monogram name={p.name} />

                  <span className="min-w-0 flex-1">
                    <Link
                      to={`/scouting/prospects/${p.id}`}
                      className="block truncate text-body font-medium text-ink hover:underline"
                    >
                      {p.name}
                    </Link>
                    <span className="block truncate text-meta text-ink-3">
                      {ageOf(p.birthdate)} anos
                      {p.position && ` · ${p.position}`}
                      {p.currentClub && ` · ${p.currentClub}`}
                    </span>
                  </span>

                  <StagePill stage={p.stage} />

                  <span className="hidden w-40 shrink-0 truncate text-meta text-ink-3 lg:block">
                    {p.lastRecommendation ? RECOMMENDATION_LABEL[p.lastRecommendation] : "sem observações"}
                  </span>

                  <span className="hidden w-24 shrink-0 text-right text-meta text-ink-4 sm:block">
                    {sinceLabel(p.lastObservedAt)}
                  </span>

                  {mayWrite && (
                    <button
                      type="button"
                      aria-label="Retirar da lista"
                      onClick={() => void removeFromShortlist(e.id).then(load)}
                      className="ctl-ghost size-8 shrink-0 justify-center px-0"
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {comparison && <ComparisonPanel data={comparison} dimensions={dimensions} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A comparação.
 *
 * Uma coluna por prospecto, uma linha por dimensão, barras na mesma escala.
 * **Sem "melhor: 87 vs 84"** — um número único esconderia exactamente o que faz a
 * decisão, que é um ser excelente a passar e fraco no duelo e o outro o contrário.
 *
 * Uma célula sem dados diz "sem dados". Zero é uma avaliação; ausência não é, e
 * pintá-la de zero faria um prospecto pouco observado parecer mau.
 */
function ComparisonPanel({ data, dimensions }: { data: Comparison; dimensions: FitDimension[] }) {
  const groups = [...new Set(data.criteria.map((c) => c.group))];
  const cols = data.prospects;

  return (
    <div className="mt-3">
      <Panel>
        <PanelHead title="Comparação" hint="mesma escala, dimensão a dimensão" />

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="border-b border-line bg-sunken/60">
                <th className="w-48 px-5 py-2 text-left text-meta font-medium text-ink-3">Dimensão</th>
                {cols.map((p) => (
                  <th key={p.id} className="px-4 py-2 text-left text-meta font-medium text-ink whitespace-nowrap">
                    <Link to={`/scouting/prospects/${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-[11px] font-normal text-ink-4">
                      {ageOf(p.birthdate)} anos{p.position && ` · ${p.position}`}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {dimensions.length > 0 && (
                <>
                  <tr className="border-b border-line bg-sunken/30">
                    <td colSpan={cols.length + 1} className="px-5 py-1.5 text-group text-ink-3 uppercase">
                      Fit com o clube
                    </td>
                  </tr>
                  {dimensions.map((d) => (
                    <tr key={d.id} className="border-b border-line">
                      <td className="px-5 py-2 text-ink-2">{d.name}</td>
                      {cols.map((p) => (
                        <td key={p.id} className="px-4 py-2">
                          <Cell value={p.fit[d.id]} max={100} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              )}

              {groups.map((group) => (
                <Fragment key={group}>
                  <tr className="border-b border-line bg-sunken/30">
                    <td colSpan={cols.length + 1} className="px-5 py-1.5 text-group text-ink-3 uppercase">
                      {group}
                    </td>
                  </tr>
                  {data.criteria
                    .filter((c) => c.group === group)
                    .map((c) => (
                      <tr key={c.id} className="border-b border-line last:border-0">
                        <td className="px-5 py-2 text-ink-2">{c.name}</td>
                        {cols.map((p) => (
                          <td key={p.id} className="px-4 py-2">
                            <Cell value={p.ratings[c.id]} max={5} />
                          </td>
                        ))}
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Cell({ value, max }: { value: number | null; max: number }) {
  if (value === null) return <span className="text-meta text-ink-4">sem dados</span>;
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0">
        <Bar value={value / max} tone={value / max >= 0.8 ? "ok" : value / max >= 0.5 ? "signal" : "warn"} />
      </span>
      <span className="w-8 shrink-0 text-right text-meta font-semibold text-ink tabular">
        {max === 100 ? `${Math.round(value)}%` : value.toFixed(1)}
      </span>
    </div>
  );
}

function Back() {
  return (
    <Link to="/scouting/shortlists" className="mb-3 inline-flex items-center gap-1.5 text-meta font-medium text-ink-3 hover:text-ink">
      <ArrowLeft className="size-3.5" strokeWidth={1.75} />
      Shortlists
    </Link>
  );
}

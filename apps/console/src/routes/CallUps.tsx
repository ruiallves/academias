import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { Empty, Metric, MetricRow, Monogram, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { ArrowUpRight, Check, Megaphone, Search, Trophy, Users } from "@/lib/icons";
import { teamById } from "@/lib/api";
import { useStore, type ApiMatch, type GuestCandidate } from "@/lib/store";
import {
  eligibleFor,
  fetchGuestPool,
  matchLabel,
  refresh,
  reopenCallUps,
  saveCallUps,
  setMaxCallUps,
  submitCallUps,
  upcomingMatches,
} from "@/lib/callups";
import { longDate, time } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";

/**
 * Convocatórias.
 *
 * ## O ecrã é o plantel, não um formulário
 *
 * Montar uma convocatória é escolher pessoas de uma lista que o treinador tem na
 * cabeça — por isso o ecrã mostra o plantel inteiro, com número de camisola e
 * posição, e escolhe-se tocando. Um selector de "adicionar atleta" obrigaria a
 * lembrar nomes; a lista deixa reconhecer.
 *
 * Quem não pode ir **aparece na mesma**, bloqueado e com o motivo. Escondê-lo
 * levava o treinador a pensar que o atleta tinha saído da equipa.
 *
 * ## Guardar e submeter
 *
 * São dois botões diferentes porque são duas coisas diferentes: guardar é livre,
 * submeter avisa as famílias. A diferença está dita no ecrã, não subentendida —
 * quem submete tem de saber que o telemóvel de doze pais vai tocar.
 */
export default function CallUps() {
  const store = useStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const upcoming = useMemo(() => upcomingMatches(), [store.matches]);
  const match = upcoming.find((m) => m.id === selectedId) ?? upcoming[0];

  // Se o jogo escolhido desaparecer da lista (foi jogado, foi apagado), volta ao
  // primeiro em vez de ficar num ecrã vazio sem explicação.
  useEffect(() => {
    if (selectedId && !upcoming.some((m) => m.id === selectedId)) setSelectedId(null);
  }, [selectedId, upcoming]);

  const porSubmeter = upcoming.filter((m) => !m.submitted).length;

  return (
    <>
      <PageHeader
        title="Convocatórias"
        subtitle="Escolhe quem vai a jogo. Ao submeter, as famílias são avisadas."
      />

      {upcoming.length === 0 ? (
        <Panel>
          <div>
            <Empty
              icon={Trophy}
              title="Nenhum jogo agendado"
              detail="Marca um jogo no calendário e ele aparece aqui para convocar."
            />
          </div>
        </Panel>
      ) : (
        <div className="space-y-3">
          <MetricRow>
            <Metric label="Jogos a chegar" value={String(upcoming.length)} icon={Trophy} note="por disputar" />
            <Metric
              label="Por submeter"
              value={String(porSubmeter)}
              icon={Megaphone}
              note={porSubmeter === 0 ? "está tudo enviado" : "as famílias ainda não sabem"}
            />
            <Metric
              label="Convocados"
              value={match ? String(match.calledUp.length) : "—"}
              icon={Users}
              note={match ? `de ${match.maxCallUps} lugares` : ""}
            />
          </MetricRow>

          <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
            <MatchList matches={upcoming} selectedId={match?.id} onSelect={setSelectedId} />
            {match && <Squad key={match.id} match={match} />}
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function MatchList({
  matches,
  selectedId,
  onSelect,
}: {
  matches: ApiMatch[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Panel className="h-fit">
      <PanelHead title="Próximos jogos" />
      <ul>
        {matches.map((m) => {
          const d = new Date(m.startsAt);
          const active = m.id === selectedId;
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelect(m.id)}
                className={cx(
                  "flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition-colors duration-[120ms] last:border-b-0",
                  active ? "bg-signal-soft" : "hover:bg-sunken",
                )}
              >
                <div className="w-11 shrink-0 rounded-[6px] border border-line bg-surface py-1 text-center">
                  <div className="text-[10px] font-semibold text-ink-3 uppercase">
                    {d.toLocaleDateString("pt-PT", { month: "short" }).replace(".", "")}
                  </div>
                  <div className="text-body font-semibold text-ink tabular">{d.getDate()}</div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className={cx("truncate text-body font-medium", active ? "text-signal-ink" : "text-ink")}>
                    {matchLabel(m)}
                  </div>
                  <div className="truncate text-meta text-ink-3">
                    {m.teamName} · <span className="font-mono tabular">{time(d)}</span>
                  </div>
                </div>

                {m.submitted ? (
                  <Pill tone="ok">enviada</Pill>
                ) : (
                  <Pill tone="warn">{m.calledUp.length || "—"}</Pill>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function Squad({ match }: { match: ApiMatch }) {
  const { session } = useSession();
  const roster = useMemo(() => eligibleFor(session, match), [session, match]);
  const ownIds = useMemo(() => new Set(roster.map((r) => r.athlete.id)), [roster]);

  const [picked, setPicked] = useState<Set<string>>(() => new Set(match.calledUp.map((c) => c.athleteId)));
  const [busy, setBusy] = useState<null | "save" | "submit" | "reopen">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /*
   * Candidatos de escalões inferiores — jogam para cima, nunca para baixo.
   *
   * Carregado à parte do plantel: é um pedido que atravessa o âmbito de propósito
   * (ver `MatchesService.guestPool`), e não faz sentido pagar esse custo para
   * jogos que ninguém vai reforçar. Vazio por omissão e sem erro visível quando
   * falha — a convocatória normal continua a funcionar sem convidados.
   *
   * `loadingGuests` existe porque o pedido não é instantâneo — atravessa o âmbito
   * de propósito e isso tem um custo real do lado do servidor. Sem este estado, a
   * secção aparecia do nada ao fim de um segundo ou dois, e quem estava a olhar
   * para o ecrã não percebia se faltava alguma coisa ou se a página tinha
   * simplesmente ficado ali parada. Um círculo a girar diz "estou a tratar disto"
   * desde o primeiro instante.
   */
  const [guests, setGuests] = useState<GuestCandidate[]>([]);
  const [loadingGuests, setLoadingGuests] = useState(true);
  useEffect(() => {
    let live = true;
    setLoadingGuests(true);
    fetchGuestPool(match.id)
      .then((pool) => live && setGuests(pool))
      .catch(() => live && setGuests([]))
      .finally(() => live && setLoadingGuests(false));
    return () => {
      live = false;
    };
  }, [match.id]);

  const locked = match.submitted;
  const cheio = picked.size >= match.maxCallUps;
  const team = teamById(match.teamId);
  // O treinador é quem monta a convocatória e melhor sabe quantos lugares precisa —
  // por isso o tecto abre-se com `calendar:write` (que ele tem), não `team:write`.
  // O servidor limita-o às suas equipas pelo âmbito.
  const mayConfigure = can(session, "calendar:write");

  function toggle(id: string, blocked: boolean) {
    if (locked || blocked) return;
    setSaved(false);
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < match.maxCallUps) next.add(id);
      return next;
    });
  }

  async function run(what: "save" | "submit" | "reopen") {
    setBusy(what);
    setError(null);
    try {
      if (what === "save") {
        await saveCallUps(match.id, [...picked]);
        setSaved(true);
      } else if (what === "submit") {
        await saveCallUps(match.id, [...picked]);
        await submitCallUps(match.id);
      } else {
        await reopenCallUps(match.id);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(null);
    }
  }

  const d = new Date(match.startsAt);

  return (
    <Panel>
      <PanelHead
        title={`${match.teamName} ${matchLabel(match)}`}
        hint={`${longDate(d)} · ${time(d)} · ${match.venue}`}
      >
        {match.submitted && <Pill tone="ok">convocatória enviada</Pill>}
      </PanelHead>

      {/* A contagem é a informação mais importante do ecrã e por isso está fixa no
          topo da lista, não perdida num canto. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <div className="flex items-baseline gap-1.5">
          <span className={cx("text-[22px] leading-none font-semibold tabular", cheio ? "text-signal-ink" : "text-ink")}>
            {picked.size}
          </span>
          <span className="text-meta text-ink-3">de {match.maxCallUps} convocados</span>
        </div>

        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-sunken">
          <div
            className="h-full rounded-full transition-[width] duration-200"
            style={{ width: `${(picked.size / match.maxCallUps) * 100}%`, background: "var(--color-signal)" }}
          />
        </div>

        {mayConfigure && !locked && (
          <MaxPicker teamId={match.teamId} current={match.maxCallUps} teamName={team?.name ?? match.teamName} />
        )}
      </div>

      <ul className="max-h-[440px] overflow-y-auto">
        {roster.map(({ athlete, blockedBy }) => {
          const on = picked.has(athlete.id);
          const disabled = locked || Boolean(blockedBy) || (!on && cheio);

          return (
            <li key={athlete.id}>
              <button
                type="button"
                onClick={() => toggle(athlete.id, Boolean(blockedBy))}
                disabled={disabled}
                aria-pressed={on}
                className={cx(
                  "flex w-full items-center gap-3 border-b border-line px-5 py-2.5 text-left transition-colors duration-[120ms] last:border-b-0",
                  on && "bg-signal-soft/60",
                  disabled ? "cursor-default" : "hover:bg-sunken",
                )}
              >
                <span
                  className={cx(
                    "flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-[120ms]",
                    on ? "border-transparent bg-signal-strong text-signal-on" : "border-line-strong",
                    blockedBy && "opacity-40",
                  )}
                >
                  {on && <Check className="size-3.5" strokeWidth={2.5} />}
                </span>

                <span className="w-6 shrink-0 text-right text-meta font-semibold text-ink-3 tabular">
                  {athlete.squadNumber ?? "—"}
                </span>

                <Monogram name={athlete.name} photoUrl={athlete.photoUrl} size="sm" />

                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate text-body", blockedBy ? "text-ink-4" : "font-medium text-ink")}>
                    {athlete.name}
                  </span>
                  {athlete.position && <span className="block truncate text-meta text-ink-3">{athlete.position}</span>}
                </span>

                {blockedBy && <Pill tone="risk">{blockedBy}</Pill>}
              </button>
            </li>
          );
        })}
      </ul>

      <GuestPicker
        guests={guests}
        loading={loadingGuests}
        picked={picked}
        ownIds={ownIds}
        maxCallUps={match.maxCallUps}
        locked={locked}
        onToggle={toggle}
      />

      {error && (
        <p className="border-t border-line bg-risk-soft px-5 py-2.5 text-meta leading-relaxed text-risk">{error}</p>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        {locked ? (
          <>
            <span className="text-meta text-ink-3">
              As famílias dos {match.calledUp.length} convocados foram avisadas.
            </span>
            <button
              type="button"
              onClick={() => void run("reopen")}
              disabled={busy !== null}
              className="ctl-outline ml-auto"
            >
              {busy === "reopen" ? "A reabrir…" : "Reabrir"}
            </button>
          </>
        ) : (
          <>
            {/*
              Dito antes de se carregar, e não depois. Submeter é irreversível do
              ponto de vista de quem recebe: o aviso já saiu para o telemóvel.
            */}
            <span className="text-meta text-ink-3">
              {saved ? "Guardado. As famílias ainda não foram avisadas." : "Guardar não avisa ninguém."}
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={() => void run("save")} disabled={busy !== null} className="ctl-outline">
                {busy === "save" ? "A guardar…" : "Guardar"}
              </button>
              <button
                type="button"
                onClick={() => void run("submit")}
                disabled={busy !== null || picked.size === 0}
                className="ctl-primary"
                title={picked.size === 0 ? "Escolhe pelo menos um atleta" : undefined}
              >
                <Megaphone className="size-3.5" strokeWidth={1.75} />
                {busy === "submit" ? "A enviar…" : `Submeter e avisar ${picked.size}`}
              </button>
            </div>
          </>
        )}
      </footer>
    </Panel>
  );
}

/**
 * Convidar de outro escalão.
 *
 * Vazio (`guests.length === 0`) quando a academia não segue o padrão "Sub-N" ou
 * não há escalão inferior no mesmo desporto — a secção nem aparece, em vez de
 * mostrar "sem candidatos" numa academia que nunca vai ter nenhum.
 *
 * ## Porque é que os convidados já escolhidos aparecem mesmo fechado
 *
 * Fechar a pesquisa não pode esconder quem já foi convocado — um treinador que
 * volta ao ecrã no dia seguinte tem de ver logo que emprestou um Sub-11, sem
 * precisar de reabrir a pesquisa para se lembrar.
 */
function GuestPicker({
  guests,
  loading,
  picked,
  ownIds,
  maxCallUps,
  locked,
  onToggle,
}: {
  guests: GuestCandidate[];
  loading: boolean;
  picked: Set<string>;
  ownIds: Set<string>;
  maxCallUps: number;
  locked: boolean;
  onToggle: (id: string, blocked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Enquanto não se sabe se há alguém para convidar, diz-se isso — em vez de
  // ficar calado e deixar a secção aparecer do nada uns segundos depois.
  if (loading) {
    return (
      <div className="flex items-center gap-2.5 border-t border-line px-5 py-3 text-meta text-ink-3">
        <span
          className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-line"
          style={{ borderTopColor: "var(--color-signal-line, var(--color-signal))" }}
          aria-hidden
        />
        A verificar escalões inferiores…
      </div>
    );
  }

  if (guests.length === 0) return null;

  const pickedGuests = guests.filter((g) => picked.has(g.id) && !ownIds.has(g.id));
  const cheio = picked.size >= maxCallUps;
  const q = query.trim().toLowerCase();
  const visible = open ? guests.filter((g) => !q || g.name.toLowerCase().includes(q)) : pickedGuests;

  return (
    <div className="border-t border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-5 py-2.5 text-left transition-colors duration-[120ms] hover:bg-sunken"
      >
        <ArrowUpRight className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
        <span className="text-meta font-medium text-ink">Convidar de outro escalão</span>
        {pickedGuests.length > 0 && <Pill tone="signal">{pickedGuests.length}</Pill>}
        <span className="ml-auto text-meta text-ink-4">{open ? "fechar" : "escolher"}</span>
      </button>

      {open && !locked && (
        <div className="border-t border-line px-5 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Procurar por nome…"
              autoFocus
              className="h-8 w-full rounded-[var(--radius-control)] bg-sunken pl-8 text-meta text-ink placeholder:text-ink-4 focus:bg-surface focus:ring-1 focus:ring-line-strong focus:outline-none"
            />
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        open && (
          <p className="px-5 pb-3 text-meta text-ink-4">Ninguém com esse nome nos escalões inferiores.</p>
        )
      ) : (
        <ul>
          {visible.map((g) => {
            const on = picked.has(g.id);
            const disabled = locked || g.blocked || (!on && cheio);

            return (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => onToggle(g.id, g.blocked)}
                  disabled={disabled}
                  aria-pressed={on}
                  className={cx(
                    "flex w-full items-center gap-3 border-b border-line px-5 py-2.5 text-left transition-colors duration-[120ms] last:border-b-0",
                    on && "bg-signal-soft/60",
                    disabled ? "cursor-default" : "hover:bg-sunken",
                  )}
                >
                  <span
                    className={cx(
                      "flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-[120ms]",
                      on ? "border-transparent bg-signal-strong text-signal-on" : "border-line-strong",
                      g.blocked && "opacity-40",
                    )}
                  >
                    {on && <Check className="size-3.5" strokeWidth={2.5} />}
                  </span>

                  <span className="w-6 shrink-0 text-right text-meta font-semibold text-ink-3 tabular">
                    {g.squadNumber ?? "—"}
                  </span>

                  <Monogram name={g.name} size="sm" />

                  <span className="min-w-0 flex-1">
                    <span className={cx("block truncate text-body", g.blocked ? "text-ink-4" : "font-medium text-ink")}>
                      {g.name}
                    </span>
                    {g.position && <span className="block truncate text-meta text-ink-3">{g.position}</span>}
                  </span>

                  {/* A equipa de origem fica sempre à vista — é o que distingue um
                      convidado de um erro de convocatória. */}
                  <Pill tone={g.blocked ? "risk" : "signal"}>{g.blocked ? "indisponível" : g.teamName}</Pill>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * O tecto de convocados da equipa.
 *
 * Vive aqui e não nas Definições porque é aqui que a pergunta aparece — quando o
 * treinador chega ao limite e precisa de mais um lugar. Obrigá-lo a atravessar a
 * aplicação para mudar um número era garantir que ninguém o mudava.
 */
function MaxPicker({ teamId, current, teamName }: { teamId: string; current: number; teamName: string }) {
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);

  async function commit(next: number) {
    if (next === current || next < 1 || next > 60) return;
    setBusy(true);
    try {
      await setMaxCallUps(teamId, next);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="ml-auto flex items-center gap-2 text-meta text-ink-3" title={`Máximo de convocados do ${teamName}`}>
      Máximo
      <input
        type="number"
        min={1}
        max={60}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(Number(e.target.value))}
        onBlur={() => void commit(value)}
        className="h-7 w-14 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-center text-body text-ink tabular focus:border-line-strong focus:outline-none"
      />
    </label>
  );
}

import { Link } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { categoryColor } from "@academia/ui/tokens";
import { KIND_LABEL, type EventKind } from "@/lib/calendar";
import { listTeams } from "@/lib/api";
import { apiPost } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { useActiveCatalog } from "@/lib/catalogs";
import { longDate } from "@/lib/format";
import { Settings, TriangleAlert } from "@/lib/icons";
import type { Session } from "@/lib/permissions";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx, SelectField } from "./primitives";

const KINDS: EventKind[] = ["training", "match", "tournament", "other"];

/**
 * Criar evento.
 *
 * Seis campos e nenhum obrigatório sem razão. O título preenche-se sozinho a partir
 * do tipo e do escalão — "Jogo · Sub-13 Futebol" — porque em nove de cada dez casos
 * é isso que a pessoa ia escrever, e continua editável para o décimo.
 *
 * Escolher "Toda a academia" tira a cor ao evento de propósito: a ausência de cor é
 * o que distingue um evento da casa de um evento de escalão.
 *
 * A própria opção só aparece a quem não tem equipas em `scope` — a mesma condição
 * que o servidor usa em `teamScopeFilter` para decidir "sem limite". `listTeams`
 * já restringe o selector às equipas de quem cria o evento, mas "toda a academia"
 * é outra coisa: um evento sem escalão, visível a toda a gente. Um treinador tem
 * sempre `scope.teamIds` preenchido — as suas equipas — e por isso nunca vê esta
 * opção; a direção e a coordenação, que veem a academia sem restrição, veem-na.
 */
export function NewEventDialog({
  session,
  day,
  onClose,
}: {
  session: Session;
  day: Date;
  onClose: () => void;
}) {
  const teams = listTeams(session);
  const venues = useActiveCatalog("venues");
  const dressingRooms = useActiveCatalog("dressingRooms");
  const mayTargetWholeAcademy = session.scope?.teamIds === undefined;

  const [kind, setKind] = useState<EventKind>("training");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(toInputDate(day));
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("19:30");
  const [venue, setVenue] = useState(venues[0]?.label ?? "");
  const [dressingRoom, setDressingRoom] = useState("");
  const [opponent, setOpponent] = useState("");
  const [isHome, setIsHome] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Um jogo é sempre de uma equipa e contra alguém.
   *
   * Por baixo, um jogo não é gravado como evento genérico mas como `Match` — a
   * tabela que guarda adversário, convocatória e resultado, e a mesma que o ecrã
   * de Convocatórias lê. Daí estes dois campos aparecerem só aqui: sem eles, o
   * servidor não teria como criar o jogo, e "toda a academia" não faz sentido
   * nenhum para um jogo.
   */
  const isMatch = kind === "match";

  /*
   * Um treino é sempre de uma equipa — como um jogo.
   *
   * Por baixo, um treino deixou de ser gravado como evento genérico e passou a ser
   * uma `TrainingSession`: a tabela que abre folha de presenças e a única que a
   * app da família lê. Essa tabela exige equipa, e com razão — um treino sem
   * plantel não tem quem faltar. "Toda a academia" continua a existir para
   * estágios e reuniões, onde faz sentido.
   */
  const needsTeam = isMatch || kind === "training";

  const teamName = teams.find((t) => t.id === teamId)?.name;
  const suggested = isMatch
    ? opponent.trim()
      ? `${isHome ? "vs" : "@"} ${opponent.trim()}`
      : `${KIND_LABEL[kind]} · ${teamName ?? ""}`
    : teamId
      ? `${KIND_LABEL[kind]} · ${teamName}`
      : `${KIND_LABEL[kind]} · toda a academia`;

  const valid = (!needsTeam || teamId !== "") && (!isMatch || opponent.trim() !== "");

  /*
   * O local de um jogo fora.
   *
   * `venue` é obrigatório no servidor, mas ninguém deve ser obrigado a saber como
   * se chama o recinto do adversário para poder marcar o jogo. Quem escrever,
   * fica com o que escreveu; quem deixar em branco fica com "Fora · Fafe", que é
   * o que um pai precisa de ler na agenda.
   */
  const awayVenuePlaceholder = opponent.trim() ? `Fora · ${opponent.trim()}` : "Campo do adversário";
  const effectiveVenue = isMatch && !isHome ? venue.trim() || awayVenuePlaceholder : venue;

  /*
   * A repetição.
   *
   * Fechada por omissão: a maioria dos eventos é um só, e um formulário que abre
   * com a repetição à vista faz toda a gente decidir uma coisa que não queria
   * decidir. Quem precisa carrega uma vez.
   *
   * `weekdays` arranca com o dia da data escolhida — marcar "todas as terças"
   * quando já se escolheu uma terça é a repetição que noventa por cento das
   * pessoas quer, e assim não é preciso escolher nada.
   */
  const [repetir, setRepetir] = useState(false);
  const [freq, setFreq] = useState<"DAILY" | "WEEKLY" | "MONTHLY">("WEEKLY");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [until, setUntil] = useState("");

  const diaDaData = new Date(`${date}T00:00:00`).getDay();
  const diasEscolhidos = weekdays.length > 0 ? weekdays : [diaDaData];

  function toggleDia(d: number) {
    setWeekdays((xs) => {
      const base = xs.length > 0 ? xs : [diaDaData];
      return base.includes(d) ? base.filter((x) => x !== d) : [...base, d].sort();
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !valid) return;
    const [y, m, d] = date.split("-").map(Number);
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);

    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/events", {
        // O enum da base é em maiúsculas; a consola trabalha em minúsculas.
        kind: kind.toUpperCase(),
        ...(teamId ? { teamId } : {}),
        title: title.trim() || suggested,
        startsAt: new Date(y, m - 1, d, sh, sm).toISOString(),
        endsAt: new Date(y, m - 1, d, eh, em).toISOString(),
        venue: effectiveVenue,
        ...(dressingRoom ? { dressingRoom } : {}),
        ...(isMatch ? { opponent: opponent.trim(), isHome } : {}),
        ...(repetir && until
          ? {
              repeat: {
                freq,
                until,
                ...(freq === "WEEKLY" ? { weekdays: diasEscolhidos } : {}),
              },
            }
          : {}),
      });
      await reloadAcademy();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível agendar o evento.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="novo-evento"
      title="Novo evento"
      subtitle={capitalize(longDate(new Date(`${date}T00:00:00`)))}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button
            type="submit"
            form="form-novo-evento"
            className="ctl-primary"
            // Sem locais no catálogo não se marca nada **em casa** — mas um jogo
            // fora não usa os nossos campos, e não tem porque ficar refém disso.
            disabled={(venues.length === 0 && !(isMatch && !isHome)) || busy || !valid}
            title={!valid ? "Um jogo precisa de escalão e adversário" : undefined}
          >
            {busy ? "A agendar…" : "Agendar"}
          </button>
        </>
      }
    >
      <form id="form-novo-evento" onSubmit={submit} className="space-y-4 p-5">
        {/*
          O tipo decide o que isto **é**, não como se filtra uma lista.

          Um jogo vai para outra tabela, ganha adversário e aparece nas
          convocatórias; um treino não. Por isso o seleccionado aqui é a tinta
          cheia e não o branco discreto dos filtros: escolher "Treino" sem dar
          por isso e só descobrir nas convocatórias é caro de mais para se
          resolver com um contraste subtil.
        */}
        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">Tipo</legend>
          <div className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-sunken p-1">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  // Vinha de "toda a academia" e passou a jogo ou treino: os dois
                  // são sempre de uma equipa, por isso escolhe-se a primeira em
                  // vez de deixar o formulário num estado que o servidor recusa.
                  if ((k === "match" || k === "training") && !teamId) setTeamId(teams[0]?.id ?? "");
                }}
                aria-pressed={kind === k}
                className={cx(
                  "h-8 rounded-[7px] px-3 text-meta font-semibold transition-colors duration-[120ms]",
                  kind === k ? "bg-ink text-surface" : "text-ink-3 hover:bg-surface/60 hover:text-ink-2",
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </fieldset>

        {/*
          O título diz "jogo", o tipo diz outra coisa.

          Não bloqueia — quem quiser mesmo chamar "Jogo de treino" a um treino
          tem esse direito. Mas três eventos seguidos criados como treino com
          "vs" no título são um sinal de que a pergunta vale a pena ser feita,
          uma vez, com a correcção a um toque de distância.
        */}
        {looksLikeMatch(title) && !isMatch && (
          <button
            type="button"
            onClick={() => {
              setKind("match");
              if (!teamId) setTeamId(teams[0]?.id ?? "");
            }}
            className="flex w-full items-center gap-2.5 rounded-[var(--radius-control)] border border-warn/30 bg-warn-soft px-3 py-2.5 text-left"
          >
            <TriangleAlert className="size-4 shrink-0 text-warn" strokeWidth={1.9} />
            <span className="min-w-0 flex-1 text-meta text-warn">
              Isto parece um jogo, mas o tipo é <strong className="font-semibold">{KIND_LABEL[kind]}</strong> — só
              um <strong className="font-semibold">Jogo</strong> aparece nas convocatórias.
            </span>
            <span className="shrink-0 text-meta font-semibold text-warn underline">Mudar</span>
          </button>
        )}

        <DialogField label="Escalão">
          <div className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{
                background: teamId
                  ? categoryColor(teams.findIndex((t) => t.id === teamId)).base
                  : "var(--color-ink-4)",
              }}
              aria-hidden
            />
            <SelectField
              className="flex-1"
              value={teamId}
              onChange={setTeamId}
              options={[
                ...teams.map((t) => ({ value: t.id, label: t.name })),
                // Nunca para um jogo nem para um treino — quem joga e quem treina
                // é uma equipa.
                ...(mayTargetWholeAcademy && !needsTeam ? [{ value: "", label: "Toda a academia (sem cor)" }] : []),
              ]}
            />
          </div>
        </DialogField>

        {/* Só um jogo tem adversário — e é ele que o torna convocável. */}
        {isMatch && (
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <DialogField label="Adversário">
              <input
                value={opponent}
                onChange={(e) => setOpponent(e.target.value)}
                placeholder="ex.: SC Vilarinho"
                className={dialogInputClass}
                required
              />
            </DialogField>

            <DialogField label="Onde">
              <div className="inline-flex h-9 items-center gap-px rounded-[var(--radius-control)] bg-sunken p-0.5">
                {[
                  { value: true, label: "Casa" },
                  { value: false, label: "Fora" },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => {
                      setIsHome(o.value);
                      // O local trocou de natureza: um campo nosso deixa de fazer
                      // sentido fora, e o texto livre de fora não é um campo
                      // nosso. Limpar evita levar "Campo 1" para um jogo em Fafe.
                      setVenue(o.value ? (venues[0]?.label ?? "") : "");
                    }}
                    aria-pressed={isHome === o.value}
                    className={cx(
                      "h-8 rounded-[6px] px-3 text-meta font-medium transition-colors duration-[120ms]",
                      isHome === o.value
                        ? "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.06)]"
                        : "text-ink-3 hover:text-ink-2",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </DialogField>
          </div>
        )}

        <DialogField label="Título" hint="opcional">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={suggested} className={dialogInputClass} />
        </DialogField>

        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
          <DialogField label="Data">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={dialogInputClass} required />
          </DialogField>
          <DialogField label="Início">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={dialogInputClass} required />
          </DialogField>
          <DialogField label="Fim">
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={dialogInputClass} required />
          </DialogField>
        </div>

        {/*
          Fora de casa, o campo não é nosso.

          O catálogo de locais são os campos da academia — oferecê-los para um
          jogo fora convidava a marcar "Campo 1" quando a equipa vai jogar a
          Fafe. Fora, o local é texto livre e **opcional**: quem souber o nome do
          recinto escreve-o, quem não souber fica com "Fora · Adversário", que já
          diz o essencial a um pai a ler a agenda.
        */}
        {isMatch && !isHome ? (
          <DialogField label="Local" hint="opcional">
            <input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder={awayVenuePlaceholder}
              className={dialogInputClass}
            />
          </DialogField>
        ) : (
          <DialogField
            label="Local"
            hint={
              <Link to="/definicoes?catalogo=venues" className="inline-flex items-center gap-1 text-ink-3 hover:text-ink">
                <Settings className="size-3" strokeWidth={1.75} />
                gerir locais
              </Link>
            }
          >
            {venues.length > 0 ? (
              <SelectField
                className="w-full"
                value={venue}
                onChange={setVenue}
                options={venues.map((v) => ({ value: v.label, label: v.label }))}
              />
            ) : (
              <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/50 px-2.5 py-2 text-meta text-ink-3">
                Ainda não há locais.{" "}
                <Link to="/definicoes?catalogo=venues" className="font-medium text-ink underline">
                  Criar o primeiro
                </Link>
              </p>
            )}
          </DialogField>
        )}

        {/*
          O balneário.

          Só para o que acontece em casa: num jogo fora, o balneário é o que o
          adversário der, e um campo aqui seria uma promessa que o clube não pode
          cumprir. Opcional sempre — uma academia que treina num campo sem
          balneários atribuídos não tem nada para escolher, e o campo desaparece
          em vez de pedir algo que não existe.
        */}
        {!(isMatch && !isHome) && dressingRooms.length > 0 && (
          <DialogField
            label="Balneário"
            hint={
              <Link
                to="/definicoes?catalogo=dressingRooms"
                className="inline-flex items-center gap-1 text-ink-3 hover:text-ink"
              >
                <Settings className="size-3" strokeWidth={1.75} />
                gerir balneários
              </Link>
            }
          >
            <SelectField
              className="w-full"
              value={dressingRoom}
              onChange={setDressingRoom}
              options={[
                { value: "", label: "Sem balneário atribuído" },
                ...dressingRooms.map((b) => ({ value: b.label, label: b.label })),
              ]}
            />
          </DialogField>
        )}

        {error && (
          <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{error}</p>
        )}

        {/*
          Repetir.

          Fechado por omissão — a maioria dos eventos é um só, e abrir o
          formulário com isto à vista faz toda a gente decidir uma coisa que não
          queria decidir.

          Cada ocorrência fica um evento a sério: um treino repetido abre uma
          folha de presenças por dia, e desmarcar a quinta-feira em que choveu não
          mexe nas outras. Ver `createEvent` no servidor.
        */}
        <div className="rounded-[var(--radius-control)] border border-line">
          <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5">
            <input
              type="checkbox"
              checked={repetir}
              onChange={(e) => setRepetir(e.target.checked)}
              className="size-3.5 accent-[var(--signal)]"
            />
            <span className="text-body text-ink">Repetir</span>
            <span className="text-meta text-ink-3">— marca a época toda de uma vez</span>
          </label>

          {repetir && (
            <div className="space-y-3 border-t border-line p-3">
              <div className="flex gap-1.5">
                {([["DAILY", "Todos os dias"], ["WEEKLY", "Semanal"], ["MONTHLY", "Mensal"]] as const).map(
                  ([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setFreq(v)}
                      aria-pressed={freq === v}
                      className={cx(
                        "rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium transition-colors",
                        freq === v
                          ? "border-transparent bg-ink text-surface"
                          : "border-line text-ink-2 hover:border-line-strong",
                      )}
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>

              {freq === "WEEKLY" && (
                <div>
                  <span className="mb-1.5 block text-meta font-medium text-ink">Em que dias</span>
                  <div className="flex gap-1">
                    {["D", "S", "T", "Q", "Q", "S", "S"].map((letra, d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDia(d)}
                        aria-pressed={diasEscolhidos.includes(d)}
                        aria-label={["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][d]}
                        className={cx(
                          "size-7 rounded-full text-meta font-semibold transition-colors",
                          diasEscolhidos.includes(d)
                            ? "bg-ink text-surface"
                            : "bg-sunken text-ink-3 hover:text-ink",
                        )}
                      >
                        {letra}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <DialogField label="Até" hint="o último dia, incluído">
                <input
                  type="date"
                  value={until}
                  min={date}
                  onChange={(e) => setUntil(e.target.value)}
                  className={dialogInputClass}
                />
              </DialogField>

              {!until && (
                <p className="text-[11px] text-ink-4">Escolhe uma data de fim para a repetição valer.</p>
              )}
            </div>
          )}
        </div>

      </form>
    </Dialog>
  );
}

function toInputDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * O título soa a jogo?
 *
 * "vs", "v.", "@" e a própria palavra "jogo" — as formas como um diretor escreve
 * um jogo à pressa. Os limites de palavra (`\b`) evitam apanhar "Revisão" por
 * causa do "vs" lá dentro.
 */
function looksLikeMatch(title: string): boolean {
  return /(\bvs\.?\b|\bv\.\s|@|\bjogo\b|\bderby\b|\btaça\b)/i.test(title);
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

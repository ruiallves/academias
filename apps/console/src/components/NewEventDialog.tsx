import { Link } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { categoryColor } from "@academia/ui/tokens";
import { KIND_LABEL, kindOfEventType, type EventKind } from "@/lib/calendar";
import { listTeams, teamById } from "@/lib/api";
import { apiPost } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { useActiveCatalog } from "@/lib/catalogs";
import { longDate } from "@/lib/format";
import { Settings } from "@/lib/icons";
import type { Session } from "@/lib/permissions";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { TokenPicker } from "./TokenPicker";
import { cx, SelectField } from "./primitives";

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
  kind: kindInicial,
  teamId: teamInicial,
  onClose,
}: {
  session: Session;
  day: Date;
  /**
   * O tipo com que o diálogo abre. Ausente é "treino", que é o que se marca mais
   * vezes — mas quem chega da página de Jogos já disse o que vem cá fazer, e
   * obrigá-lo a escolher "Jogo" outra vez seria perguntar duas vezes o mesmo.
   */
  kind?: EventKind;
  /**
   * A equipa com que abre. Quem vem do calendário de uma equipa já a escolheu —
   * e um treinador de três escalões que tivesse de a escolher outra vez estava a
   * responder a uma pergunta que já tinha respondido ao abrir aquela página.
   */
  teamId?: string;
  onClose: () => void;
}) {
  const teams = listTeams(session);
  const venues = useActiveCatalog("venues");
  const dressingRooms = useActiveCatalog("dressingRooms");
  /*
   * Os tipos de evento do clube.
   *
   * O catálogo existe nas Definições desde sempre — semeado com Treino, Jogo,
   * Torneio e Evento — e **não era lido por ninguém**: o diálogo tinha os quatro
   * escritos no código, e quem criasse "Estágio" ou "Reunião de pais" via-os nas
   * Definições e não os encontrava aqui. Agora a lista é a do clube, e o que se
   * grava é o tipo escolhido (ver `CalendarEvent.typeId`).
   */
  const eventTypes = useActiveCatalog("eventTypes");
  const mayTargetWholeAcademy = session.scope?.teamIds === undefined;

  /**
   * O tipo escolhido, por id do catálogo.
   *
   * O `kind` deixa de ser estado próprio e passa a **derivar** do tipo — eram
   * duas fontes para a mesma verdade, e a segunda ficava desactualizada à
   * primeira troca. Ver `kindOfEventType`.
   */
  const [typeId, setTypeId] = useState("");
  // A equipa pedida, se for uma das que esta pessoa pode usar. Um id de fora do
  // âmbito cai para a primeira — o servidor recusá-lo-ia na mesma.
  const [teamId, setTeamId] = useState(
    (teamInicial && teams.some((t) => t.id === teamInicial) ? teamInicial : teams[0]?.id) ?? "",
  );
  /*
   * O tipo escolhido, e o `kind` que dele sai.
   *
   * Enquanto o catálogo não chegar (vem por HTTP depois do arranque, como os
   * locais), `typeId` está vazio e cai-se no tipo pedido por quem abriu o
   * diálogo — "Jogo" para quem vem da página de Jogos. Assim que a lista
   * chegar, escolhe-se lá dentro o item que corresponde a esse pedido: é a
   * mesma armadilha que os locais já tinham (ver `venueDoCatalogo`), e a
   * solução é a mesma — derivar em vez de fixar no primeiro render.
   */
  const tipoEscolhido = eventTypes.find((t) => t.id === typeId) ?? null;
  const kindPedido = kindInicial ?? "training";
  const tipoEfectivo =
    tipoEscolhido ??
    eventTypes.find((t) => kindOfEventType(t.label) === kindPedido) ??
    eventTypes[0] ??
    null;
  const kind: EventKind = tipoEfectivo ? kindOfEventType(tipoEfectivo.label) : kindPedido;

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(toInputDate(day));
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("19:30");
  const [venue, setVenue] = useState(venues[0]?.label ?? "");
  /** Os balneários escolhidos. Vários, porque um clube leva duas equipas ao mesmo jogo. */
  const [balnearios, setBalnearios] = useState<string[]>([]);
  const [opponent, setOpponent] = useState("");
  const [isHome, setIsHome] = useState(true);
  const [competitionId, setCompetitionId] = useState("");

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
   * As provas da equipa escolhida.
   *
   * Trocar de equipa limpa a escolha — o campeonato do Sub-13 não é o do Sub-15,
   * e deixar lá o id anterior era gravar um jogo na prova errada ou levar com um
   * 400 do servidor sem perceber porquê.
   */
  const competicoesDaEquipa = teamId ? (teamById(teamId)?.competitions ?? []) : [];
  /*
   * A escolha segue a equipa.
   *
   * Trocar de equipa invalida a prova escolhida — o campeonato do Sub-13 não é o
   * do Sub-15 — e em vez de a limpar para vazio (que travava o botão sem dizer
   * porquê) cai na primeira prova da equipa nova. Numa equipa que nunca teve
   * outras, essa é "Amigável": o valor certo para a maioria dos jogos que se
   * marcam à mão.
   *
   * Durante o render, e de propósito: é uma correcção de estado derivado, não um
   * efeito. O React volta a chamar com o valor certo antes de pintar.
   */
  if (competicoesDaEquipa.length > 0 && !competicoesDaEquipa.some((c) => c.id === competitionId)) {
    setCompetitionId(competicoesDaEquipa[0].id);
  }

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

  const valid =
    (!needsTeam || teamId !== "") &&
    // Um jogo precisa de adversário **e** de prova — as duas coisas que a
    // convocatória vai imprimir.
    (!isMatch || (opponent.trim() !== "" && competitionId !== ""));

  /*
   * O local de um jogo fora.
   *
   * `venue` é obrigatório no servidor, mas ninguém deve ser obrigado a saber como
   * se chama o recinto do adversário para poder marcar o jogo. Quem escrever,
   * fica com o que escreveu; quem deixar em branco fica com "Fora · Fafe", que é
   * o que um pai precisa de ler na agenda.
   */
  const awayVenuePlaceholder = opponent.trim() ? `Fora · ${opponent.trim()}` : "Campo do adversário";

  /*
   * O local do catálogo, com rede.
   *
   * `useState(venues[0]?.label ?? "")` fixa o valor no **primeiro** render — e
   * os locais não estão lá nesse instante: chegam por HTTP depois do arranque
   * (ver `loadCatalogs`). Quem abrisse este diálogo cedo ficava com o estado a
   * `""` para sempre, enquanto o `<select>` mostrava "Campo 1" — o browser
   * mostra a primeira opção quando o valor não existe. Carregar em Agendar
   * mandava vazio, e o servidor respondia "venue must be longer than or equal
   * to 1 characters", em inglês e sobre um campo que estava visivelmente
   * preenchido.
   *
   * Derivar em vez de guardar resolve-o de raiz: o valor que se vê é sempre o
   * que existe na lista, e a lista pode chegar quando quiser. Fora de casa não
   * se aplica — ali o local é texto livre e o catálogo não manda.
   */
  const venueDoCatalogo = venues.some((v) => v.label === venue) ? venue : (venues[0]?.label ?? "");

  /*
   * Os balneários que valem mesmo.
   *
   * Filtrados pelo catálogo actual — um balneário arquivado entretanto não vai
   * numa marcação nova — e vazios num jogo fora, onde o balneário é o que o
   * adversário der. É a mesma rede do local, e pela mesma razão: o catálogo
   * chega depois do primeiro render.
   */
  const balneariosEfectivos =
    isMatch && !isHome ? [] : balnearios.filter((b) => dressingRooms.some((d) => d.label === b));
  const effectiveVenue = isMatch && !isHome ? venue.trim() || awayVenuePlaceholder : venueDoCatalogo;

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
        // A lista, e o singular por trás dela enquanto o servidor antigo
        // estiver em serviço — ver a migração `20260908120000`.
        dressingRooms: balneariosEfectivos,
        ...(balneariosEfectivos[0] ? { dressingRoom: balneariosEfectivos[0] } : {}),
        ...(tipoEfectivo ? { typeId: tipoEfectivo.id } : {}),
        ...(isMatch ? { opponent: opponent.trim(), isHome } : {}),
        ...(isMatch && competitionId ? { competitionId } : {}),
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
        {/*
          O tipo vem do catálogo do clube.

          Era um segmented com os quatro tipos escritos no código, e o catálogo
          "Tipos de evento" das Definições não era lido por ninguém: quem criasse
          "Estágio" via-o nas Definições e não o encontrava aqui. Agora a lista é
          a do clube — e passou a `<select>` porque um segmented com nove tipos
          não cabe, enquanto quatro botões cabiam.

          O que **não** mudou: os quatro tipos de sistema continuam a decidir a
          estrutura (um Jogo abre convocatória, um Treino abre presenças). Ver
          `kindOfEventType`.
        */}
        <DialogField
          label="Tipo"
          hint={
            <Link to="/definicoes?catalogo=eventTypes" className="inline-flex items-center gap-1 text-ink-3 hover:text-ink">
              <Settings className="size-3" strokeWidth={1.75} />
              gerir tipos
            </Link>
          }
        >
          {eventTypes.length > 0 ? (
            <SelectField
              className="w-full"
              value={tipoEfectivo?.id ?? ""}
              onChange={(id) => {
                setTypeId(id);
                const item = eventTypes.find((t) => t.id === id);
                const alvo = item ? kindOfEventType(item.label) : "other";
                // Um jogo e um treino são sempre de uma equipa: se vinha de
                // "não aplicável", escolhe-se a primeira em vez de deixar o
                // formulário num estado que o servidor recusa.
                if ((alvo === "match" || alvo === "training") && !teamId) setTeamId(teams[0]?.id ?? "");
              }}
              options={eventTypes.map((t) => ({ value: t.id, label: t.label }))}
            />
          ) : (
            <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/50 px-2.5 py-2 text-meta text-ink-3">
              Ainda não há tipos de evento.{" "}
              <Link to="/definicoes?catalogo=eventTypes" className="font-medium text-ink underline">
                Criar o primeiro
              </Link>
            </p>
          )}
        </DialogField>

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
                /*
                  "Não aplicável" antes das equipas, e não no fim.

                  Nem todo o evento tem escalão — uma reunião de pais, um
                  estágio da direcção, a assembleia geral. Chamava-se "Toda a
                  academia (sem cor)", que descrevia o efeito visual em vez de
                  responder à pergunta: o que a pessoa quer dizer é que aquele
                  campo não se aplica ali. Vem primeiro porque, num evento
                  destes, é a resposta certa — e escondê-la no fim de uma lista
                  de doze escalões fazia toda a gente escolher um escalão à toa.

                  Nunca para um jogo nem para um treino: quem joga e quem treina
                  é uma equipa, e o servidor recusa-o na mesma.
                */
                ...(mayTargetWholeAcademy && !needsTeam
                  ? [{ value: "", label: "Não aplicável" }]
                  : []),
                ...teams.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          </div>
        </DialogField>

        {/* Só um jogo tem adversário — e é ele que o torna convocável. */}
        {isMatch && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
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

        {/*
          A prova de um jogo — obrigatória.
          
          É a convocatória que a exige: herda-a do jogo e imprime-a, e um jogo
          sem prova obrigava quem exporta a escrevê-la à mão, que era o remendo
          que isto veio substituir. A pergunta tem sempre resposta porque toda a
          equipa nasce com **"Amigável"** — um jogo que não é de nenhuma prova é
          um amigável, e isso diz-se em vez de se deixar em branco.
          
          A lista é a **da equipa escolhida**, não o catálogo do clube: marcar um
          jogo do Sub-13 no campeonato de seniores é um erro de dedo que ninguém
          apanharia depois. O servidor recusa-o na mesma (ver `createSingleEvent`).
        */}
        {isMatch && (
          <DialogField label="Competição">
            {competicoesDaEquipa.length > 0 ? (
              <SelectField
                className="w-full"
                value={competitionId}
                onChange={setCompetitionId}
                options={competicoesDaEquipa.map((c) => ({ value: c.id, label: c.label }))}
              />
            ) : (
              /* Só acontece se alguém tiver removido todas as provas da equipa,
                 "Amigável" incluída. Diz-se onde se resolve, em vez de deixar
                 um selector vazio a bloquear o diálogo sem explicação. */
              <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/50 px-2.5 py-2 text-meta text-ink-3">
                Esta equipa não tem competições. Junta-as na ficha da equipa para poderes marcar jogos.
              </p>
            )}
          </DialogField>
        )}

        <DialogField label="Título" hint="opcional">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={suggested} className={dialogInputClass} />
        </DialogField>

        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
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
                value={venueDoCatalogo}
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
        {/*
          Os balneários — vários, com pesquisa.

          Foi por três desenhos até chegar aqui, e vale a pena o registo: um
          `<select>` de um só não dizia "dois balneários"; uma fila de chips
          dizia, mas com doze balneários ocupava meio diálogo e não havia como
          procurar; e, por estar dentro de um `DialogField` (que é um
          `<label>`), clicar na linha activava o primeiro botão — o balneário 1
          marcava-se sozinho. `TokenPicker` resolve os três de uma vez.

          Só para o que acontece em casa: num jogo fora o balneário é o que o
          adversário der, e um campo aqui seria uma promessa que o clube não
          pode cumprir. Desaparece por inteiro quando a academia não os gere —
          pedir algo que não existe é pior do que não perguntar.
        */}
        {!(isMatch && !isHome) && dressingRooms.length > 0 && (
          <TokenPicker
            label="Balneários"
            hint={
              <Link
                to="/definicoes?catalogo=dressingRooms"
                className="inline-flex items-center gap-1 text-ink-3 hover:text-ink"
              >
                <Settings className="size-3" strokeWidth={1.75} />
                gerir balneários
              </Link>
            }
            options={dressingRooms.map((b) => b.label)}
            selected={balnearios}
            onChange={setBalnearios}
            placeholder="Procurar balneário…"
            emptyLabel="Nenhum atribuído — escreve ou abre a lista para escolher."
          />
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
              className="size-3.5 accent-[var(--color-signal)]"
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

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

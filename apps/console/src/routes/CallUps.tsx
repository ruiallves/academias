import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { cx, Empty, ListaDeEscolha, Monogram, Panel, PanelHead, Pill, SelectField } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented } from "@/components/filters";
import { Lista } from "@/components/definicoes/ui";
import { EquipasRail } from "@/components/EquipasRail";
import { Spinner } from "@/components/Busy";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Clock,
  Download,
  History,
  Megaphone,
  Pencil,
  Plus,
  Search,
  Trophy,
} from "@/lib/icons";
import { athleteById, listTeams, teamById, numeroNaEquipa, posicaoNaEquipa } from "@/lib/api";
import { useTeamColors } from "@/lib/calendar";
import { aplicarLogistica, useStore, type ApiMatch, type GuestCandidate } from "@/lib/store";
import {
  eligibleFor,
  faixaDaEpoca,
  fetchGuestPool,
  fetchMatchesBetween,
  matchLabel,
  pastMatches,
  refresh,
  reopenCallUps,
  saveCallUps,
  setMaxCallUps,
  upcomingMatches,
  type FaixaDaEpoca,
} from "@/lib/callups";
import { SubmitCallUpDialog } from "@/components/SubmitCallUpDialog";
import { callUpReplies } from "@/lib/callups";
import { descarregarFolha, folhaDoJogo } from "@/lib/callup-export";
import { MatchStaffDialog } from "@/components/MatchStaff";
import { getMatch, retroPool, saveRetroSquad, type MatchDetail } from "@/lib/matches";
import type { SheetRow } from "@/lib/callup-sheet";
import { dayShort, longDate, monthName, shortDate, time } from "@/lib/format";
import { can, isAcademyWide } from "@/lib/permissions";
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
 *
 * ## O desenho do Planeamento e das Presenças
 *
 * O ecrã era uma lista dos próximos jogos de todas as equipas ao lado do
 * plantel do jogo escolhido. Com uma equipa, chegava. Com dez escalões e uma
 * época inteira de jogos passados, procurar "o jogo dos Sub-13 com o Fafe em
 * novembro" era rolar uma lista sem fim.
 *
 * Agora segue o desenho das outras páginas de trabalho:
 *
 *  - **As equipas ficam à esquerda.** A página abre em todas (o trabalho de
 *    convocar atravessa equipas), e um clique fica só com uma.
 *  - **Uma vista de cada vez**, por ordem de urgência: *Próximos* (o
 *    trabalho de todas as semanas), *Em atraso* (jogos que passaram sem
 *    convocatória) e *Histórico* (as convocatórias de cada jogo passado, com
 *    as respostas das famílias e quem jogou).
 *  - **O Histórico tem a época e a procura por adversário.** Uma época
 *    anterior lê-se, mas não se corrige.
 *  - **As listas agrupam-se por dia**, e o histórico por mês.
 *  - **Um jogo abre no lugar da lista**, com o caminho de volta. A vista, a
 *    equipa, a época e o jogo vivem no endereço.
 *
 * ## Registar o passado não avisa ninguém
 *
 * Um jogo que passou sem convocatória regista-se em "Em atraso" (ver
 * `RegistoDoPassado`). O servidor recusa submeter jogos começados, porque
 * submeter avisa as famílias de um jogo que já foi.
 */
type Vista = "proximos" | "atraso" | "historico";

export default function CallUps() {
  const { session } = useSession();
  const store = useStore();
  const oversight = isAcademyWide(session);
  const [params, setParams] = useSearchParams();
  const cores = useTeamColors(session);

  const equipas = listTeams(session);
  const teamParam = params.get("equipa");
  const teamId = teamParam && equipas.some((t) => t.id === teamParam) ? teamParam : "";
  const team = teamId ? teamById(teamId) : undefined;

  /*
   * A época do Histórico. "Em atraso" é sempre a época corrente: um jogo de há
   * duas épocas sem convocatória não é trabalho por fazer.
   */
  const epocas = store.seasons.length > 0 ? store.seasons : [store.season].filter(Boolean);
  const epocaParam = params.get("epoca");
  const epoca = epocaParam && epocas.includes(epocaParam) ? epocaParam : store.season;
  const epocaCorrente = epoca === store.season;
  const faixas = useMemo(() => {
    const atual = faixaDaEpoca(store.season, store.seasonRanges);
    return epoca === store.season ? [atual] : [atual, faixaDaEpoca(epoca, store.seasonRanges)];
  }, [epoca, store.season, store.seasonRanges]);
  const { passadosDe, aCarregar, recarregar } = useJogosPassados(store.matches, faixas);

  const daEquipa = useCallback((m: ApiMatch) => !teamId || m.teamId === teamId, [teamId]);
  const upcoming = useMemo(() => upcomingMatches().filter(daEquipa), [store.matches, daEquipa]);
  const emAtraso = useMemo(() => passadosDe(store.season).filter((m) => !m.submitted && daEquipa(m)), [passadosDe, store.season, daEquipa]);
  const historico = useMemo(() => passadosDe(epoca).filter((m) => m.submitted && daEquipa(m)), [passadosDe, epoca, daEquipa]);

  /* A procura do Histórico, pelo adversário ou pelo recinto. Não vai ao endereço: é um gesto, não um sítio. */
  const [procura, setProcura] = useState("");
  const termo = semAcentos(procura.trim());
  const historicoVisivel = useMemo(
    () => (termo ? historico.filter((m) => semAcentos(`${m.opponent} ${m.venue}`).includes(termo)) : historico),
    [historico, termo],
  );

  /*
   * `?jogo=<id>` abre já nesse jogo: é como a página do jogo manda para cá,
   * para ninguém ter de o procurar outra vez na lista. Sem `?vista=`, a vista
   * sai do jogo pedido: um link para um jogo passado abre onde ele está.
   */
  const jogoParam = params.get("jogo");
  const vistaParam = params.get("vista");
  const vista: Vista =
    vistaParam === "atraso" || vistaParam === "historico"
      ? vistaParam
      : !vistaParam && jogoParam && emAtraso.some((m) => m.id === jogoParam)
        ? "atraso"
        : !vistaParam && jogoParam && historico.some((m) => m.id === jogoParam)
          ? "historico"
          : "proximos";

  const lista = vista === "atraso" ? emAtraso : vista === "historico" ? historico : upcoming;
  const match = jogoParam ? lista.find((m) => m.id === jogoParam) : undefined;
  /* O jogo que se acabou de registar, para o Histórico o dizer. Ver `aoRegistar`. */
  const [acabado, setAcabado] = useState<string | null>(null);

  function mudar(muda: (p: URLSearchParams) => void, replace = false) {
    const p = new URLSearchParams(params);
    muda(p);
    setParams(p, { replace });
  }
  const escolherEquipa = (id: string) =>
    mudar((p) => {
      if (id) p.set("equipa", id);
      else p.delete("equipa");
      p.delete("jogo");
    }, true);
  const escolherEpoca = (label: string) =>
    mudar((p) => {
      if (label === store.season) p.delete("epoca");
      else p.set("epoca", label);
      p.delete("jogo");
    }, true);
  const irPara = (v: Vista) =>
    mudar((p) => {
      p.delete("jogo");
      if (v === "proximos") p.delete("vista");
      else p.set("vista", v);
    });
  const abrir = (id: string) => mudar((p) => p.set("jogo", id));
  const fechar = () => mudar((p) => p.delete("jogo"));

  /**
   * Depois de registar um jogo em atraso: o jogo passa para o Histórico, e o
   * ecrã vai com ele.
   *
   * Ficar na vista "Em atraso" fazia o jogo desaparecer no momento em que se
   * gravava. Quem acabou de gravar não via o que gravou, e não tinha forma de
   * saber se tinha ficado.
   */
  async function aoRegistar(id: string) {
    await recarregar();
    setAcabado(id);
    mudar((p) => {
      p.set("vista", "historico");
      p.delete("epoca");
      p.set("jogo", id);
    });
    // O resto da consola (o calendário, a ficha do atleta) lê a academia.
    void refresh().catch(() => {});
  }

  async function aoCorrigir() {
    await recarregar();
    void refresh().catch(() => {});
  }

  const porSubmeter = upcoming.filter((m) => !m.submitted).length;
  const atrasados = emAtraso.filter((m) => diasDesde(new Date(m.startsAt)) >= 7).length;
  const todasLabel = oversight ? "Todas as equipas" : "As minhas equipas";

  return (
    <>
      <PageHeader title="Convocatórias" subtitle="Escolhe quem vai a jogo. Ao submeter, as famílias são avisadas." />

      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-[212px_minmax(0,1fr)]">
        {/* ------------------------------------------------------------ as equipas */}
        <div className="min-w-0">
          {/* Em ecrãs estreitos, uma coluna de equipas empurrava a lista para fora do ecrã. */}
          <select
            value={teamId}
            onChange={(e) => escolherEquipa(e.target.value)}
            aria-label="Equipa"
            className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-body text-ink focus:border-ink-3 focus:outline-none lg:hidden"
          >
            <option value="">{todasLabel}</option>
            {equipas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <div className="max-lg:hidden lg:sticky lg:top-4">
            <EquipasRail equipas={equipas} teamId={teamId} todasLabel={todasLabel} cores={cores} onEscolher={escolherEquipa} />
          </div>
        </div>

        {/* -------------------------------------------------------- as convocatórias */}
        <section className="min-w-0">
          <header className="mb-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-4">{team ? "Equipa" : "Clube"}</p>
            <h2 className="mt-1 flex items-center gap-2.5 text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {team && <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: cores.get(team.id)?.base ?? "var(--color-line-strong)" }} />}
              <span className="truncate">{team?.name ?? todasLabel}</span>
            </h2>
          </header>

          {/* Os números, numa linha só. */}
          <Lista className="mb-5">
            <dl className="grid grid-cols-2 md:grid-cols-4">
              <Numero rotulo="Jogos a chegar" valor={String(upcoming.length)} nota="por disputar" />
              <Numero
                rotulo="Por submeter"
                valor={String(porSubmeter)}
                nota={porSubmeter === 0 ? "está tudo enviado" : "as famílias ainda não sabem"}
                tom={porSubmeter > 0 ? "warn" : undefined}
              />
              <Numero
                rotulo="Em atraso"
                valor={String(emAtraso.length)}
                nota={emAtraso.length === 0 ? "nenhum jogo sem convocatória" : atrasados > 0 ? `${atrasados} há mais de uma semana` : "jogos passados sem convocatória"}
                tom={atrasados > 0 ? "risk" : emAtraso.length > 0 ? "warn" : undefined}
              />
              <Numero rotulo="Histórico" valor={String(historico.length)} nota={`época ${epoca || "atual"}`} />
            </dl>
          </Lista>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Segmented<Vista>
              size="md"
              label="Vista"
              value={vista}
              onChange={irPara}
              options={[
                { value: "proximos", label: "Próximos", icon: CalendarDays, count: upcoming.length || undefined },
                { value: "atraso", label: "Em atraso", icon: Clock, count: emAtraso.length || undefined },
                { value: "historico", label: "Histórico", icon: History },
              ]}
            />
            {vista === "historico" && !match && (
              <>
                {epocas.length > 1 && (
                  <SelectField
                    size="sm"
                    aria-label="Época"
                    value={epoca}
                    onChange={escolherEpoca}
                    options={epocas.map((e) => ({ value: e, label: `Época ${e}` }))}
                  />
                )}
                <SearchInput value={procura} onChange={setProcura} placeholder="Adversário ou recinto…" />
                <ResultCount n={historicoVisivel.length} noun={["jogo", "jogos"]} />
              </>
            )}
          </div>

          {match ? (
            <div className="space-y-3">
              <button type="button" onClick={fechar} className="inline-flex h-9 items-center gap-1.5 text-meta font-medium text-ink-3 transition-colors hover:text-ink">
                <ArrowLeft className="size-3.5" strokeWidth={1.75} />
                {vista === "proximos" ? "Todos os próximos jogos" : vista === "atraso" ? "Todos os jogos em atraso" : "Todo o histórico"}
              </button>
              {vista === "proximos" ? (
                <Squad key={match.id} match={match} />
              ) : vista === "atraso" ? (
                <RegistoDoPassado key={match.id} match={match} onGravado={() => aoRegistar(match.id)} />
              ) : (
                <HistoricoDoJogo
                  key={match.id}
                  match={match}
                  acabadoDeRegistar={acabado === match.id}
                  podeCorrigir={epocaCorrente}
                  onCorrigido={aoCorrigir}
                />
              )}
            </div>
          ) : vista === "proximos" ? (
            <Proximos matches={upcoming} mostrarEquipa={!team} cores={cores} onAbrir={abrir} />
          ) : vista === "atraso" ? (
            <EmAtraso matches={emAtraso} aCarregar={aCarregar} mostrarEquipa={!team} cores={cores} onAbrir={abrir} />
          ) : (
            <Historico matches={historicoVisivel} aCarregar={aCarregar} aProcurar={termo !== ""} mostrarEquipa={!team} cores={cores} onAbrir={abrir} />
          )}
        </section>
      </div>
    </>
  );
}

/**
 * Os jogos passados, por época: os da academia mais os que ela não traz.
 *
 * ## Porque é que há um pedido a mais
 *
 * A academia só carrega os jogos dos últimos trinta dias (ver `listIn` na API),
 * e o histórico quer a época toda, e às vezes uma época anterior. Cada época
 * pede-se uma vez, e enquanto não chega, ou se falhar, fica o que a academia
 * já tem. O ecrã nunca espera por ela para mostrar o mês que passou.
 *
 * ## Quem ganha quando o mesmo jogo vem dos dois lados
 *
 * O pedido da época, porque é relido depois de cada registo feito aqui. A
 * academia entra para os jogos que começaram depois de o pedido sair: com a
 * página aberta desde manhã, o jogo das 11h já não está no pedido, e sem ela
 * desaparecia dos Próximos sem aparecer no Em atraso. Cada jogo fica na época
 * a que a data pertence.
 */
function useJogosPassados(daAcademia: ApiMatch[], faixas: FaixaDaEpoca[]) {
  const [porEpoca, setPorEpoca] = useState<Record<string, ApiMatch[]>>({});
  const [emCurso, setEmCurso] = useState(0);
  const pedidas = useRef(new Set<string>());
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const carregar = useCallback(async (f: FaixaDaEpoca) => {
    setEmCurso((n) => n + 1);
    try {
      const xs = await fetchMatchesBetween(f.from, f.to);
      if (vivo.current) setPorEpoca((prev) => ({ ...prev, [f.label]: xs }));
    } catch {
      /* Fica o que a academia trouxe. Ver o comentário da função. */
    } finally {
      if (vivo.current) setEmCurso((n) => n - 1);
    }
  }, []);

  useEffect(() => {
    for (const f of faixas) {
      if (pedidas.current.has(f.label)) continue;
      pedidas.current.add(f.label);
      void carregar(f);
    }
  }, [faixas, carregar]);

  const recarregar = useCallback(async () => {
    await Promise.all(faixas.map(carregar));
  }, [faixas, carregar]);

  const passadosDe = useCallback(
    (label: string) => {
      const f = faixas.find((x) => x.label === label);
      if (!f) return [];
      const porId = new Map<string, ApiMatch>();
      for (const m of daAcademia) porId.set(m.id, m);
      for (const m of porEpoca[label] ?? []) porId.set(m.id, m);
      return pastMatches([...porId.values()]).filter((m) => {
        const t = new Date(m.startsAt).getTime();
        return t >= f.from.getTime() && t <= f.to.getTime();
      });
    },
    [daAcademia, porEpoca, faixas],
  );

  return { passadosDe, aCarregar: emCurso > 0, recarregar };
}

/* -------------------------------------------------------------------------- */
/* Peças                                                                       */
/* -------------------------------------------------------------------------- */

type Cores = ReturnType<typeof useTeamColors>;

const diasDesde = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);
const chaveDoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const chaveDoMes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
/** Minúsculas e sem acentos, para a procura. */
const semAcentos = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "Hoje", "Ontem", "Amanhã", ou "sábado, 4 de outubro". */
function nomeDoDia(d: Date): string {
  const hoje = new Date();
  const k = chaveDoDia(d);
  if (k === chaveDoDia(hoje)) return "Hoje";
  if (k === chaveDoDia(new Date(hoje.getTime() - 86_400_000))) return "Ontem";
  if (k === chaveDoDia(new Date(hoje.getTime() + 86_400_000))) return "Amanhã";
  const texto = d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Os jogos agrupados, pela ordem em que chegam, por dia ou por mês. */
function agrupar(matches: ApiMatch[], por: "dia" | "mes"): { chave: string; data: Date; itens: ApiMatch[] }[] {
  const chave = por === "dia" ? chaveDoDia : chaveDoMes;
  const grupos: { chave: string; data: Date; itens: ApiMatch[] }[] = [];
  for (const m of matches) {
    const d = new Date(m.startsAt);
    const k = chave(d);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.chave === k) ultimo.itens.push(m);
    else grupos.push({ chave: k, data: d, itens: [m] });
  }
  return grupos;
}

/** Um número do resumo: o rótulo, o valor grande e uma nota. */
function Numero({ rotulo, valor, nota, tom }: { rotulo: string; valor: string; nota: string; tom?: "warn" | "risk" }) {
  return (
    <div className="min-w-0 border-line px-4 py-3.5 max-md:border-b max-md:odd:border-r max-md:[&:nth-last-child(-n+2)]:border-b-0 md:border-r md:last:border-r-0">
      <dt className="truncate text-meta text-ink-3">{rotulo}</dt>
      <dd className={cx("mt-1 text-[24px] leading-none font-semibold tracking-[-0.02em] tabular", tom === "risk" ? "text-risk" : tom === "warn" ? "text-warn" : "text-ink")}>
        {valor}
      </dd>
      <p className="mt-1.5 truncate text-[11px] text-ink-4">{nota}</p>
    </div>
  );
}

/** O título de um grupo, por cima das linhas desse grupo. */
function Titulo({ texto, nota }: { texto: string; nota?: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2 px-1">
      <h3 className="text-meta font-semibold text-ink">{texto}</h3>
      {nota && <span className="text-[11px] text-ink-4">{nota}</span>}
    </div>
  );
}

/** Um estado vazio dentro de uma lista. */
function Vazio({ icone: Icone, titulo, texto, ok }: { icone: typeof Clock; titulo: string; texto: string; ok?: boolean }) {
  return (
    <Lista className="px-6 py-12 text-center">
      <span className={cx("mx-auto flex size-11 items-center justify-center rounded-[12px]", ok ? "bg-ok-soft text-ok" : "bg-sunken text-ink-3")}>
        <Icone className="size-5" strokeWidth={1.75} />
      </span>
      <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.01em] text-ink">{titulo}</h3>
      <p className="mx-auto mt-1 max-w-[420px] text-meta leading-relaxed text-ink-3">{texto}</p>
    </Lista>
  );
}

/**
 * Uma linha de jogo, nas três listas. A linha inteira é o alvo de clique.
 *
 * O que muda entre listas é a célula da esquerda (a hora num grupo por dia, o
 * dia num grupo por mês) e o que fica à direita (`fim`).
 */
function LinhaDeJogo({
  match,
  quando,
  mostrarEquipa,
  cores,
  fim,
  onAbrir,
}: {
  match: ApiMatch;
  quando: "hora" | "dia";
  mostrarEquipa: boolean;
  cores: Cores;
  fim: ReactNode;
  onAbrir: (id: string) => void;
}) {
  const d = new Date(match.startsAt);
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => onAbrir(match.id)}
        className="group flex min-h-12 w-full items-center gap-3.5 px-4 py-3 text-left transition-colors duration-[120ms] hover:bg-sunken/50"
      >
        {quando === "hora" ? (
          <span className="w-12 shrink-0 font-mono text-body text-ink-2 tabular">{time(d)}</span>
        ) : (
          <span className="w-12 shrink-0 text-body text-ink-2 tabular">
            <span className="text-meta text-ink-4">{dayShort(d)} </span>
            {d.getDate()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            {mostrarEquipa && (
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: cores.get(match.teamId)?.base ?? "var(--color-line-strong)" }} />
            )}
            <span className="truncate text-body font-medium text-ink">
              {mostrarEquipa ? `${match.teamName} ${matchLabel(match)}` : matchLabel(match)}
            </span>
          </span>
          <div className="mt-0.5 truncate text-meta text-ink-3">
            {[match.competition?.label, `${match.venue} · ${match.isHome ? "em casa" : "fora"}`].filter(Boolean).join(" · ")}
          </div>
        </div>
        {fim}
        <ArrowRight className="size-3.5 shrink-0 text-ink-4 transition-transform duration-[120ms] group-hover:translate-x-0.5 group-hover:text-ink-2" strokeWidth={1.75} />
      </button>
    </li>
  );
}

/* ------------------------------------------------------------ Próximos */

function Proximos({ matches, mostrarEquipa, cores, onAbrir }: { matches: ApiMatch[]; mostrarEquipa: boolean; cores: Cores; onAbrir: (id: string) => void }) {
  if (matches.length === 0) {
    return <Vazio icone={Trophy} titulo="Nenhum jogo agendado" texto="Marca um jogo no calendário e ele aparece aqui para convocar." />;
  }
  return (
    <div className="space-y-5">
      {agrupar(matches, "dia").map((g) => (
        <div key={g.chave}>
          <Titulo texto={nomeDoDia(g.data)} />
          <Lista>
            <ul>
              {g.itens.map((m) => (
                <LinhaDeJogo key={m.id} match={m} quando="hora" mostrarEquipa={mostrarEquipa} cores={cores} onAbrir={onAbrir} fim={<EstadoNaLista match={m} />} />
              ))}
            </ul>
          </Lista>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- Em atraso */

/**
 * Do mais antigo para o mais recente, como as Presenças: o atraso está escrito
 * por extenso porque é isso que decide por onde começar.
 */
function EmAtraso({ matches, aCarregar, mostrarEquipa, cores, onAbrir }: { matches: ApiMatch[]; aCarregar: boolean; mostrarEquipa: boolean; cores: Cores; onAbrir: (id: string) => void }) {
  if (matches.length === 0) {
    if (aCarregar) return <Lista><Spinner /></Lista>;
    return <Vazio ok icone={CircleCheck} titulo="Nenhum jogo em atraso" texto="Todos os jogos desta época que já passaram têm convocatória." />;
  }
  const ordenados = [...matches].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return (
    <div className="space-y-5">
      {agrupar(ordenados, "dia").map((g) => {
        const dias = diasDesde(g.data);
        return (
          <div key={g.chave}>
            <Titulo texto={nomeDoDia(g.data)} nota={dias >= 2 ? `há ${dias} dias` : undefined} />
            <Lista>
              <ul>
                {g.itens.map((m) => (
                  <LinhaDeJogo
                    key={m.id}
                    match={m}
                    quando="hora"
                    mostrarEquipa={mostrarEquipa}
                    cores={cores}
                    onAbrir={onAbrir}
                    fim={
                      <>
                        <PlacarCurto match={m} />
                        {/* Um rascunho guardado antes do jogo já é meio caminho, e diz-se. */}
                        {m.calledUp.length > 0 && <Pill tone="warn">rascunho · {m.calledUp.length}</Pill>}
                        {dias >= 7 && <span className="shrink-0 text-meta font-medium text-risk max-md:hidden">em atraso</span>}
                        <span className="ctl-outline pointer-events-none shrink-0 group-hover:border-ink-3">
                          <ClipboardCheck className="size-3.5" strokeWidth={1.75} />
                          Registar
                        </span>
                      </>
                    }
                  />
                ))}
              </ul>
            </Lista>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- Histórico */

/** Do mais recente para o mais antigo, por mês: é assim que se procura "o jogo de novembro". */
function Historico({ matches, aCarregar, aProcurar, mostrarEquipa, cores, onAbrir }: { matches: ApiMatch[]; aCarregar: boolean; aProcurar: boolean; mostrarEquipa: boolean; cores: Cores; onAbrir: (id: string) => void }) {
  if (matches.length === 0) {
    if (aCarregar) return <Lista><Spinner /></Lista>;
    if (aProcurar) return <Vazio icone={Search} titulo="Nenhum jogo com esse nome" texto="Procura pelo adversário ou pelo recinto, como estão no calendário." />;
    return <Vazio icone={History} titulo="Ainda sem histórico" texto="Depois de cada jogo, a convocatória fica guardada aqui, com as respostas das famílias e quem jogou." />;
  }
  return (
    <div className="space-y-5">
      {agrupar(matches, "mes").map((g) => (
        <div key={g.chave}>
          <Titulo texto={`${monthName(g.data).charAt(0).toUpperCase()}${monthName(g.data).slice(1)} ${g.data.getFullYear()}`} nota={`${g.itens.length} ${g.itens.length === 1 ? "jogo" : "jogos"}`} />
          <Lista>
            <ul>
              {g.itens.map((m) => {
                const recusaram = m.calledUp.filter((c) => c.status === "DECLINED").length;
                return (
                  <LinhaDeJogo
                    key={m.id}
                    match={m}
                    quando="dia"
                    mostrarEquipa={mostrarEquipa}
                    cores={cores}
                    onAbrir={onAbrir}
                    fim={
                      <>
                        <PlacarCurto match={m} />
                        {recusaram > 0 && <Pill tone="risk">{recusaram} não {recusaram === 1 ? "foi" : "foram"}</Pill>}
                        <span className="w-[72px] shrink-0 text-right text-meta text-ink-3 tabular max-md:hidden">
                          {m.calledUp.length} conv.
                        </span>
                      </>
                    }
                  />
                );
              })}
            </ul>
          </Lista>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Squad({ match }: { match: ApiMatch }) {
  const { session } = useSession();
  // O emblema e a época, para a folha em PDF.
  const { academy, season } = useStore();
  const roster = useMemo(() => eligibleFor(session, match), [session, match]);
  const ownIds = useMemo(() => new Set(roster.map((r) => r.athlete.id)), [roster]);

  // Quem saiu do clube depois de entrar num rascunho fica de fora: já não está na
  // lista para se desmarcar, e o servidor recusava a gravação por causa dele.
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(match.calledUp.filter((c) => athleteById(c.athleteId)?.status !== "left").map((c) => c.athleteId)),
  );
  const [busy, setBusy] = useState<null | "save" | "submit" | "reopen">(null);
  /*
   * Submeter passa por um diálogo — o que pergunta a logística do dia (ponto de
   * encontro, horas) que a app da família vai mostrar. Ver `SubmitCallUpDialog`.
   *
   * A lista é **guardada antes** de o diálogo abrir: sem isso, quem mexesse na
   * selecção e submetesse enviava a lista anterior, e a diferença só aparecia
   * quando um pai recebesse o aviso do miúdo errado.
   */
  const [dialogo, setDialogo] = useState<null | "submeter" | "editar">(null);
  /* A equipa de trabalho do jogo — ver `MatchStaffDialog`. */
  const [equipa, setEquipa] = useState(false);
  /*
   * Escalar a equipa de trabalho é `attendance:write`, e não o que chega para
   * montar a convocatória (`calendar:write` também serve). O botão só aparece a
   * quem o servidor deixa gravar — um botão que abre e depois recusa é pior do
   * que não haver botão.
   */
  const mayStaff = can(session, "attendance:write");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [folha, setFolha] = useState(false);
  /*
   * Submetida, mas com a lista em memória ainda a antiga.
   *
   * Submeter marca o jogo como enviado na hora (`aplicarLogistica`), e os
   * convocados só chegam com a recarga da academia, em segundo plano. A folha
   * sai de `match.calledUp`: exportada nesse intervalo, imprimia a lista de
   * antes, com quem se acabou de tirar. Um clube recebeu assim um PDF com
   * jogadores que não tinha convocado. O botão espera pela lista confirmada.
   */
  const [aConfirmar, setAConfirmar] = useState(false);

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

  /*
   * A folha imprime `match.calledUp` — a lista submetida —, nunca `picked`.
   *
   * São a mesma coisa enquanto a convocatória estiver fechada, e é de propósito
   * que a folha lê a do servidor: é aquela que as famílias receberam no
   * telemóvel, e é por aquela que se assina no ponto de encontro. Uma folha
   * tirada de uma escolha em curso seria um documento a discordar do aviso que
   * já saiu — e alguém a assinar por um miúdo que ficou em casa.
   *
   * Ver a nota do botão: só há folha depois de submeter, e por isso `picked`
   * está trancado quando isto corre.
   */
  const sheetRows: SheetRow[] = useMemo(
    () =>
      match.calledUp.map((c) => {
        // O convidado de outro escalão pode não estar na lista de atletas de
        // quem imprime — o âmbito de um treinador acaba na equipa dele. Aí o
        // nome vem do lote de convidados deste jogo.
        const atleta = athleteById(c.athleteId);
        const guest = guests.find((g) => g.id === c.athleteId);

        return {
          // O número e a posição **nesta equipa**; um convidado de outro escalão
          // leva os da equipa de onde vem.
          squadNumber: (atleta ? numeroNaEquipa(atleta, match.teamId) : undefined) ?? guest?.squadNumber ?? atleta?.squadNumber ?? null,
          name: atleta?.name ?? guest?.name ?? "—",
          position: (atleta ? posicaoNaEquipa(atleta, match.teamId) : undefined) ?? guest?.position ?? atleta?.position ?? null,
          status: c.status === "CONFIRMED" || c.status === "DECLINED" ? c.status : "CALLED",
          guestFrom: c.isGuest ? (c.guestFromTeam ?? guest?.teamName ?? "outro escalão") : null,
        };
      }),
    [match.calledUp, guests],
  );


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

  async function run(what: "save" | "reopen") {
    setBusy(what);
    setError(null);
    try {
      if (what === "save") {
        await saveCallUps(match.id, [...picked]);
        setSaved(true);
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

  /**
   * Guardar a lista e abrir o diálogo da logística.
   *
   * A ordem importa: guarda-se **primeiro**. Quem tirou um lesionado e carregou
   * logo em Submeter estaria a enviar a lista anterior — e a diferença só
   * aparecia no telemóvel do pai errado.
   */
  /**
   * A folha, sem perguntar nada.
   *
   * O que o diálogo antigo perguntava vive agora no jogo, dito ao submeter — e
   * é o mesmo que a app da família mostra. Ver `descarregarFolha`.
   */
  async function exportar() {
    if (folha) return;
    setFolha(true);
    setError(null);
    try {
      /*
       * O jogo completo, e não o da lista.
       *
       * A lista de jogos não traz a equipa de trabalho (de propósito — ver
       * `listIn` no servidor), e a folha saía daqui sem massagista, sem
       * delegado e sem treinador a assinar, enquanto a mesma folha exportada da
       * página do jogo vinha completa. Um pedido a mais ao exportar, que é um
       * gesto de uma vez por jogo.
       */
      const detalhe = await getMatch(match.id);
      /*
       * A última guarda: a lista do servidor tem de ser a que vai ser impressa.
       * Se a recarga depois de submeter falhou, a de memória é a antiga, e a
       * folha não sai com ela.
       */
      const doServidor = new Set(detalhe.squad.map((s) => s.athleteId));
      const emMemoria = new Set(match.calledUp.map((c) => c.athleteId));
      if (doServidor.size !== emMemoria.size || [...doServidor].some((id) => !emMemoria.has(id))) {
        throw new Error("A lista de convocados mudou desde que a página carregou. Atualiza a página e exporta outra vez.");
      }
      // A resposta de cada família como está agora: quem recusou depois de a
      // página carregar já não sai na folha (ver `buildCallUpPdf`).
      const estado = new Map(detalhe.squad.map((s) => [s.athleteId, s.callUpStatus]));
      const rows = sheetRows.map((r, i) => ({ ...r, status: estado.get(match.calledUp[i].athleteId) ?? r.status }));
      await descarregarFolha({ match: folhaDoJogo(detalhe), rows, academy, season });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível gerar o PDF.");
    } finally {
      setFolha(false);
    }
  }

  async function abrirSubmissao() {
    setBusy("submit");
    setError(null);
    try {
      await saveCallUps(match.id, [...picked]);
      setDialogo("submeter");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível guardar a lista.");
    } finally {
      setBusy(null);
    }
  }

  const d = new Date(match.startsAt);

  /*
   * As respostas das famílias.
   *
   * `CALLED` é o estado de quem **não** respondeu, e não responder não é
   * recusar: quem foi convocado e nada disse conta como quem vai. Por isso
   * "por responder" só se conta como falta quando o clube pediu confirmação
   * neste jogo — nos outros é o estado normal, e apresentá-lo como buraco na
   * equipa era inventar um problema.
   */
  /*
   * As respostas vivas — sondadas enquanto esta convocatória está aberta.
   *
   * O que vem no `match` é do último carregamento da academia, e um pai que
   * confirme a seguir só aparecia se alguém recarregasse a página. Ver
   * `useRespostasVivas`.
   */
  const vivas = useRespostasVivas(match.id, locked);
  const linhas = vivas ?? match.calledUp;

  const respostas = useMemo(() => {
    const porAtleta = new Map(linhas.map((c) => [c.athleteId, c]));
    const recusaram = linhas.filter((c) => c.status === "DECLINED");
    const confirmaram = linhas.filter((c) => c.status === "CONFIRMED");
    return {
      porAtleta,
      confirmaram: confirmaram.length,
      recusaram,
      porResponder: linhas.length - confirmaram.length - recusaram.length,
    };
  }, [linhas]);

  return (
    <Panel>
      <PanelHead
        title={`${match.teamName} ${matchLabel(match)}`}
        hint={`${longDate(d)} · ${time(d)} · ${match.venue}`}
      >
        {match.submitted && <Pill tone="ok">convocatória enviada</Pill>}
        {/*
          A folha para levar para o campo — e só **depois de submeter**.

          Um rascunho ainda muda: sai a folha, entra um lesionado, e no ponto de
          encontro há um papel assinado que não bate certo com o aviso que as
          famílias receberam. Enquanto a lista não fecha, não há nada para levar
          para lado nenhum — o botão fica à vista, desligado, a dizer o que
          falta, em vez de aparecer do nada depois de se carregar em Submeter.
        */}
        <button
          type="button"
          onClick={() => void exportar()}
          disabled={!match.submitted || folha || aConfirmar}
          className="ctl-outline"
          title={
            !match.submitted
              ? "Submete a convocatória primeiro — a folha é da lista que as famílias receberam"
              : aConfirmar
                ? "A confirmar os convocados"
                : "PDF da convocatória, para assinar no ponto de encontro"
          }
        >
          <Download className="size-3.5" strokeWidth={1.75} />
          {folha ? "A gerar…" : aConfirmar ? "A confirmar convocados…" : "Exportar PDF"}
        </button>
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

      {locked && <Respostas match={match} respostas={respostas} aoVivo={vivas !== null} />}

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
                  {numeroNaEquipa(athlete, match.teamId) ?? "—"}
                </span>

                <Monogram name={athlete.name} photoUrl={athlete.photoUrl} size="sm" />

                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate text-body", blockedBy ? "text-ink-4" : "font-medium text-ink")}>
                    {athlete.name}
                  </span>
                  {posicaoNaEquipa(athlete, match.teamId) && (
                    <span className="block truncate text-meta text-ink-3">{posicaoNaEquipa(athlete, match.teamId)}</span>
                  )}
                </span>

                {blockedBy && <Pill tone="risk">{blockedBy}</Pill>}
                {locked && <Resposta linha={respostas.porAtleta.get(athlete.id)} pediuConfirmacao={match.confirmationRequired} />}
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
              {/* Quem foi avisado é quem responde por eles — ver `respondBy`. */}
              {match.respondBy === "ATHLETE"
                ? `Os ${match.calledUp.length} convocados foram avisados. Respondem eles.`
                : `As famílias dos ${match.calledUp.length} convocados foram avisadas.`}
            </span>
            {/*
              Corrigir a hora do encontro **sem** reabrir.

              Reabrir desfaz a convocatória, e ressubmeter avisa outra vez toda a
              gente de que foi convocada. Mudar uma hora não é isso — e enquanto
              este botão não existiu, era a única forma de o fazer.
            */}
            {/*
              A equipa de trabalho, ao lado dos detalhes.

              É o passo que vem a seguir a fechar a lista — quem vai de
              massagista, quem é o delegado — e sai na folha em PDF. Antes só se
              fazia na página do jogo, e ninguém ia lá depois de convocar.
            */}
            {mayStaff && (
              <button
                type="button"
                onClick={() => setEquipa(true)}
                disabled={busy !== null}
                className="ctl-outline ml-auto"
              >
                <Plus className="size-3.5" strokeWidth={2} />
                Equipa de trabalho
              </button>
            )}
            <button
              type="button"
              onClick={() => setDialogo("editar")}
              disabled={busy !== null}
              className={cx("ctl-outline", !mayStaff && "ml-auto")}
            >
              <Pencil className="size-3.5" strokeWidth={1.75} />
              Editar detalhes
            </button>
            <button
              type="button"
              onClick={() => void run("reopen")}
              disabled={busy !== null}
              className="ctl-ghost"
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
                onClick={() => void abrirSubmissao()}
                disabled={busy !== null || picked.size === 0}
                className="ctl-primary"
                title={picked.size === 0 ? "Escolhe pelo menos um atleta" : undefined}
              >
                <Megaphone className="size-3.5" strokeWidth={1.75} />
                {busy === "submit" ? "A guardar…" : `Submeter e avisar ${picked.size}`}
              </button>
            </div>
          </>
        )}
      </footer>

      {equipa && (
        <MatchStaffDialog
          matchId={match.id}
          subtitulo={`${match.teamName} ${matchLabel(match)} · ${longDate(d)}`}
          onClose={() => setEquipa(false)}
        />
      )}

      {dialogo && (
        <SubmitCallUpDialog
          match={{
            id: match.id,
            teamName: match.teamName,
            opponent: match.opponent,
            isHome: match.isHome,
            venue: match.venue,
            startsAt: match.startsAt,
            // O que já foi dito, para re-submeter não apagar nada.
            roundLabel: match.roundLabel,
            meetingPoint: match.meetingPoint,
            meetingAt: match.meetingAt,
            arrivalAt: match.arrivalAt,
            callUpNotes: match.callUpNotes,
            confirmationRequired: match.confirmationRequired,
            respondBy: match.respondBy,
          }}
          convocados={dialogo === "editar" ? match.calledUp.length : picked.size}
          modo={dialogo}
          onDone={(gravada) => {
            const submeteu = dialogo === "submeter";
            setDialogo(null);
            /*
              A hora nova entra no jogo em memória **agora**.

              Isto chamava `refresh()` e mais nada — uma recarga da academia
              inteira, que nesta ligação leva perto de dez segundos. Até ela
              chegar, o ecrã continuava a mostrar o que estava lá antes: quem
              reabria os detalhes via a hora velha e concluía que não tinha
              gravado. Tinha — faltava o ecrã saber. Ver `aplicarLogistica`.
            */
            aplicarLogistica(match.id, submeteu ? { ...gravada, submitted: true } : gravada);
            /*
              Submeter muda mais do que a logística: fecha a lista e passa a
              haver respostas de famílias para ler. Isso continua a vir do
              servidor — mas em segundo plano, porque o que o gesto acabou de
              mudar já está no ecrã.
            */
            if (submeteu) {
              // O PDF fica bloqueado até a lista confirmada chegar. Ver `aConfirmar`.
              setAConfirmar(true);
              refresh()
                .catch(() => setError("Não foi possível confirmar os convocados. Atualiza a página para exportar o PDF."))
                .finally(() => setAConfirmar(false));
            }
          }}
          onClose={() => setDialogo(null)}
        />
      )}
    </Panel>
  );
}

/**
 * O que a lista da esquerda diz de cada jogo.
 *
 * Antes dizia "enviada" e ficava por aí — e uma recusa, que é um buraco na
 * equipa, só se descobria abrindo o jogo. Quem tem seis convocatórias enviadas
 * não abre as seis à procura de problemas; precisa de as ver daqui.
 *
 * A ordem das leituras é a da urgência: uma recusa ganha a tudo, porque obriga
 * a chamar outro; a seguir vem a espera por confirmações, que é uma pergunta em
 * aberto; e só depois o "está tudo bem".
 */
function EstadoNaLista({ match }: { match: ApiMatch }) {
  if (!match.submitted) return <Pill tone="warn">{match.calledUp.length || "—"}</Pill>;

  const recusaram = match.calledUp.filter((c) => c.status === "DECLINED").length;
  if (recusaram > 0) return <Pill tone="risk">{recusaram} não {recusaram === 1 ? "vai" : "vão"}</Pill>;

  if (match.confirmationRequired) {
    const confirmaram = match.calledUp.filter((c) => c.status === "CONFIRMED").length;
    const tudo = confirmaram === match.calledUp.length;
    return (
      <Pill tone={tudo ? "ok" : "warn"}>
        {confirmaram}/{match.calledUp.length}
      </Pill>
    );
  }

  return <Pill tone="ok">enviada</Pill>;
}

/* -------------------------------------------------------------------------- */
/* As respostas das famílias                                                   */
/* -------------------------------------------------------------------------- */

type Respostas = {
  porAtleta: Map<string, LinhaResposta>;
  confirmaram: number;
  recusaram: LinhaResposta[];
  porResponder: number;
};

/**
 * Uma linha de convocado, venha ela do carregamento da academia ou da sondagem.
 *
 * As duas fontes dizem o mesmo sobre a resposta — estado, motivo, hora — e só a
 * primeira traz o resto (convidado, equipa de origem). O que este ecrã precisa
 * é da parte comum.
 */
type LinhaResposta = {
  athleteId: string;
  status: string;
  declineReason?: string | null;
  respondedAt?: string | null;
};

/**
 * As respostas das famílias, sondadas enquanto a convocatória está aberta.
 *
 * ## Porquê sondar, e não esperar
 *
 * O pai confirma no telemóvel e o treinador está a olhar para a lista no
 * computador. Sem isto, a confirmação só aparecia quando alguém carregasse em
 * F5 — e ninguém carrega em F5 numa página que já está aberta: fica a olhar
 * para uma lista que diz "sem resposta" sobre alguém que já respondeu.
 *
 * ## Doze segundos, e só com a página à frente
 *
 * `document.hidden` pára a sondagem quando o separador vai para trás: uma
 * consola esquecida aberta numa secretaria durante o fim-de-semana não tem de
 * estar a falar com o servidor. Volta a sondar — e sonda logo — quando a página
 * volta à frente, que é o momento em que alguém vai olhar para ela.
 *
 * Só corre com a convocatória **submetida**: antes disso não há respostas para
 * haver.
 *
 * Devolve `null` até à primeira resposta chegar, para quem chama poder usar o
 * que já tinha em vez de piscar uma lista vazia.
 */
function useRespostasVivas(matchId: string, activo: boolean): LinhaResposta[] | null {
  const [linhas, setLinhas] = useState<LinhaResposta[] | null>(null);

  useEffect(() => {
    if (!activo) {
      setLinhas(null);
      return;
    }

    let vivo = true;
    const sondar = async () => {
      if (document.hidden) return;
      try {
        const r = await callUpReplies(matchId);
        if (vivo) setLinhas(r.rows);
      } catch {
        /*
         * Uma sondagem que falha não diz nada ao utilizador: a página continua
         * a mostrar o que tinha, e a próxima volta daqui a doze segundos. Um
         * erro no ecrã por causa de um pedido de fundo é pior do que o atraso
         * que ele estava a evitar.
         */
      }
    };

    void sondar();
    const t = setInterval(() => void sondar(), 12_000);
    // Voltar ao separador não espera pela volta seguinte.
    const aoVoltar = () => {
      if (!document.hidden) void sondar();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      vivo = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [matchId, activo]);

  return linhas;
}

/**
 * Quem confirmou, quem não vai, e quem ainda não disse nada.
 *
 * ## Porque é que isto só aparece depois de submeter
 *
 * Porque antes disso não há nada para responder: a lista ainda está a ser
 * montada e as famílias não sabem dela. Mostrar "0 de 14 confirmaram" numa
 * convocatória por enviar era inventar uma espera que ainda não começou.
 *
 * ## Duas leituras diferentes do mesmo silêncio
 *
 * Quando o clube **pediu confirmação**, quem não respondeu é uma pergunta em
 * aberto e conta-se como tal — é justamente para isso que se liga o
 * interruptor. Quando não pediu, o silêncio é a resposta normal e quer dizer
 * "vai": aí a contagem some, e sobra o que interessa mesmo, que são as
 * recusas.
 *
 * ## As recusas trazem o motivo
 *
 * É por isso que o motivo é obrigatório do lado da família. Um treinador que lê
 * "o Tomás não vai" e tem de telefonar para saber porquê ficou com o mesmo
 * trabalho que tinha antes disto existir.
 */
function Respostas({
  match,
  respostas,
  aoVivo,
}: {
  match: ApiMatch;
  respostas: Respostas;
  /** A sondagem já respondeu ao menos uma vez. Ver `useRespostasVivas`. */
  aoVivo: boolean;
}) {
  const { confirmaram, recusaram, porResponder } = respostas;
  const pediu = match.confirmationRequired;

  return (
    <div className="border-b border-line bg-sunken/40 px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {pediu && (
          <Conta n={confirmaram} de={match.calledUp.length} label="confirmaram" tone={confirmaram > 0 ? "ok" : undefined} />
        )}
        <Conta n={recusaram.length} label={recusaram.length === 1 ? "não vai" : "não vão"} tone={recusaram.length > 0 ? "risk" : undefined} />
        {pediu && <Conta n={porResponder} label="sem resposta" />}

        {!pediu && (
          <span className="text-meta text-ink-3">
            Não pediste confirmação — quem não respondeu vai.
          </span>
        )}

        {/*
          Dizer que isto se actualiza sozinho evita a pergunta seguinte — "isto
          está actualizado?" — e evita o F5 que ela provoca.
        */}
        {aoVivo && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-meta text-ink-4">
            <span className="size-1.5 rounded-full bg-ok" aria-hidden />
            ao vivo
          </span>
        )}
      </div>

      {recusaram.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {recusaram.map((c) => (
            <li key={c.athleteId} className="flex flex-wrap items-baseline gap-x-2 text-meta">
              <span className="font-medium text-ink">{athleteById(c.athleteId)?.name ?? "Atleta"}</span>
              <span className="text-ink-2">{c.declineReason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Conta({ n, de, label, tone }: { n: number; de?: number; label: string; tone?: "ok" | "risk" }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={cx(
          "text-[18px] leading-none font-semibold tabular",
          tone === "ok" ? "text-ok" : tone === "risk" ? "text-risk" : "text-ink",
        )}
      >
        {n}
        {de !== undefined && <span className="text-meta font-normal text-ink-3"> de {de}</span>}
      </span>
      <span className="text-meta text-ink-3">{label}</span>
    </span>
  );
}

/**
 * O estado de uma linha do plantel, depois de a convocatória sair.
 *
 * Nada para quem não foi convocado — a linha já se lê pela caixa por marcar. E
 * nada para quem não respondeu num jogo sem confirmação pedida: aí o silêncio é
 * o estado normal, e um rótulo "sem resposta" em catorze linhas seguidas é
 * ruído que ensina a não olhar para nenhum.
 */
function Resposta({
  linha,
  pediuConfirmacao,
}: {
  linha: LinhaResposta | undefined;
  pediuConfirmacao: boolean;
}) {
  if (!linha) return null;
  if (linha.status === "DECLINED") return <Pill tone="risk">não vai</Pill>;
  if (linha.status === "CONFIRMED") return <Pill tone="ok">confirmou</Pill>;
  return pediuConfirmacao ? <Pill tone="warn">sem resposta</Pill> : null;
}

/* -------------------------------------------------------------------------- */

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
          <p className="px-5 pb-3 text-meta text-ink-4">Ninguém com esse nome noutros escalões.</p>
        )
      ) : (
        <ListaDeEscolha>
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

                  {/* Num amigável chama-se de qualquer escalão; o mais velho fica assinalado. */}
                  {g.aboveAge && !g.blocked && <Pill tone="warn">acima da idade</Pill>}

                  {/* A equipa de origem fica sempre à vista — é o que distingue um
                      convidado de um erro de convocatória. */}
                  <Pill tone={g.blocked ? "risk" : "signal"}>{g.blocked ? "indisponível" : g.teamName}</Pill>
                </button>
              </li>
            );
          })}
        </ListaDeEscolha>
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

/* ========================================================================== */
/* Jogos passados                                                             */
/* ========================================================================== */

/** "3–1" na linha da lista, ou "sem resultado" enquanto ninguém o escreveu. */
function PlacarCurto({ match }: { match: ApiMatch }) {
  if (match.ourScore === null || match.theirScore === null) {
    return <span className="shrink-0 text-meta text-ink-4 max-md:hidden">sem resultado</span>;
  }
  const tom = match.ourScore > match.theirScore ? "text-ok" : match.ourScore < match.theirScore ? "text-risk" : "text-ink-2";
  return (
    <span className={cx("shrink-0 text-body font-semibold tabular", tom)}>
      {match.ourScore}–{match.theirScore}
    </span>
  );
}

/** O resultado no cabeçalho do painel, com a palavra e não só a cor. */
function Resultado({ match }: { match: ApiMatch }) {
  if (match.ourScore === null || match.theirScore === null) return <Pill tone="neutral">sem resultado</Pill>;
  const ganhou = match.ourScore > match.theirScore;
  const perdeu = match.ourScore < match.theirScore;
  return (
    <Pill tone={ganhou ? "ok" : perdeu ? "risk" : "neutral"}>
      {ganhou ? "Vitória" : perdeu ? "Derrota" : "Empate"} {match.ourScore}–{match.theirScore}
    </Pill>
  );
}

/** Uma linha do plantel de um jogo passado, venha ela da equipa ou de um convite. */
type LinhaDoPlantel = {
  athleteId: string;
  name: string;
  position: string | null;
  numero: number | null;
  /** A equipa de onde veio, quando não é desta. */
  convidado: string | null;
};

/** O número **nesta** equipa, como o resto do ecrã o mostra. */
function numeroDe(athleteId: string, teamId: string): number | null {
  const a = athleteById(athleteId);
  return a ? (numeroNaEquipa(a, teamId) ?? a.squadNumber ?? null) : null;
}

/** Por número de camisola, como um treinador lê um plantel; sem número, por nome. */
const porNumero = (a: { numero: number | null; name: string }, b: { numero: number | null; name: string }) =>
  (a.numero ?? 99) - (b.numero ?? 99) || a.name.localeCompare(b.name, "pt");

/**
 * Registar a convocatória de um jogo que já passou, ou corrigir a de um jogo do
 * histórico.
 *
 * ## Não avisa ninguém
 *
 * Grava por `saveRetroSquad`, a mesma escrita do Pós-jogo na página do jogo. O
 * jogo já foi, e um aviso "o teu filho está convocado" para o sábado passado
 * só confundia uma família. O servidor recusa submeter jogos começados pela
 * mesma razão.
 *
 * ## Baixas e pausas não bloqueiam
 *
 * São verdades de hoje, e o jogo foi noutro dia: um miúdo que se lesionou ontem
 * jogou na mesma no fim-de-semana. A lista mostra o plantel todo, sem bloqueios.
 *
 * ## Quem já estava na lista
 *
 * Um rascunho guardado antes do jogo vem já marcado. Um convidado de outro
 * escalão não vem no plantel da equipa (`retroPool` só traz a equipa), e por
 * isso entra na lista à parte, com a equipa de onde veio. Sem isso, gravar
 * tirava-o da convocatória sem ninguém ter carregado no nome dele.
 */
function RegistoDoPassado({
  match,
  correcao = false,
  onGravado,
  onCancelar,
}: {
  match: ApiMatch;
  /** Corrigir uma convocatória do histórico, em vez de registar uma em atraso. */
  correcao?: boolean;
  onGravado: () => Promise<void>;
  onCancelar?: () => void;
}) {
  const { session } = useSession();
  /* A mesma permissão que o servidor pede para o registo (`assertCanRecord`). */
  const mayRecord = can(session, "attendance:write");
  const [linhas, setLinhas] = useState<LinhaDoPlantel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhidos, setEscolhidos] = useState<Set<string>>(() => new Set(match.calledUp.map((c) => c.athleteId)));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!mayRecord) return;
    let vivo = true;
    Promise.all([retroPool(match.id), getMatch(match.id)])
      .then(([pool, detalhe]) => {
        if (!vivo) return;
        const daEquipa: LinhaDoPlantel[] = pool.map((a) => ({
          athleteId: a.athleteId,
          name: a.name,
          position: a.position,
          numero: numeroDe(a.athleteId, match.teamId),
          convidado: null,
        }));
        const naEquipa = new Set(daEquipa.map((l) => l.athleteId));
        const deFora: LinhaDoPlantel[] = detalhe.squad
          .filter((s) => !naEquipa.has(s.athleteId))
          .map((s) => ({
            athleteId: s.athleteId,
            name: s.name,
            position: s.position,
            numero: numeroDe(s.athleteId, match.teamId),
            convidado: s.isGuest ? (s.guestFromTeam ?? "outro escalão") : null,
          }));
        setLinhas([...daEquipa.sort(porNumero), ...deFora.sort(porNumero)]);
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Não foi possível carregar o plantel."));
    return () => {
      vivo = false;
    };
  }, [match.id, match.teamId, mayRecord]);

  const d = new Date(match.startsAt);
  const titulo = `${match.teamName} ${matchLabel(match)}`;
  const quando = `${longDate(d)} · ${time(d)} · ${match.venue}`;

  if (!mayRecord) {
    return (
      <Panel>
        <PanelHead title={titulo} hint={quando}>
          <Resultado match={match} />
        </PanelHead>
        <Empty
          icon={ClipboardCheck}
          title="Sem permissão para registar"
          detail="Registar a convocatória de um jogo que já passou pede a permissão de registar presenças. Fala com a direção do clube."
        />
      </Panel>
    );
  }

  function toggle(id: string) {
    setEscolhidos((xs) => {
      const next = new Set(xs);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function gravar() {
    setBusy(true);
    setErro(null);
    try {
      await saveRetroSquad(match.id, [...escolhidos]);
      await onGravado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar a convocatória.");
    } finally {
      setBusy(false);
    }
  }

  const n = escolhidos.size;

  return (
    <Panel>
      <PanelHead title={titulo} hint={quando}>
        <Resultado match={match} />
      </PanelHead>

      {/*
        Dito antes de se carregar, como em Submeter, mas ao contrário: aqui o
        que importa saber é que **ninguém** recebe nada.
      */}
      <p className="border-b border-line bg-sunken/40 px-5 py-3 text-meta leading-relaxed text-ink-2">
        {correcao
          ? "Corrigir não avisa ninguém. Quem continua convocado mantém a resposta que deu. Quem tirares da lista sai também da ficha de jogo."
          : "O jogo já passou e ficou sem convocatória. Registá-la agora não avisa ninguém: fica no histórico de cada atleta e abre a ficha de jogo."}
      </p>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-5 py-3">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[22px] leading-none font-semibold text-ink tabular">{n}</span>
          <span className="text-meta text-ink-3">{n === 1 ? "convocado" : "convocados"}</span>
        </span>
        {/* Um registo não se trava pelo máximo: diz-se, e grava-se o que aconteceu. */}
        {n > match.maxCallUps && (
          <span className="text-meta text-ink-3">acima do máximo da equipa, que é {match.maxCallUps}</span>
        )}
      </div>

      {linhas === null && !erro ? (
        <Spinner />
      ) : linhas === null ? null : linhas.length === 0 ? (
        <Empty
          compact
          icon={ClipboardCheck}
          title="A equipa não tem atletas"
          detail="Junta atletas à equipa para registar quem foi a este jogo."
        />
      ) : (
        <ul className="max-h-[440px] overflow-y-auto">
          {linhas.map((l) => {
            const on = escolhidos.has(l.athleteId);
            return (
              <li key={l.athleteId}>
                <button
                  type="button"
                  onClick={() => toggle(l.athleteId)}
                  aria-pressed={on}
                  className={cx(
                    "flex min-h-11 w-full items-center gap-3 border-b border-line px-5 py-2.5 text-left transition-colors duration-[120ms] last:border-b-0",
                    on ? "bg-signal-soft/60" : "hover:bg-sunken",
                  )}
                >
                  <span
                    aria-hidden
                    className={cx(
                      "flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-[120ms]",
                      on ? "border-transparent bg-signal-strong text-signal-on" : "border-line-strong",
                    )}
                  >
                    {on && <Check className="size-3.5" strokeWidth={2.5} />}
                  </span>

                  <span className="w-6 shrink-0 text-right text-meta font-semibold text-ink-3 tabular">{l.numero ?? "—"}</span>

                  <Monogram name={l.name} photoUrl={athleteById(l.athleteId)?.photoUrl} size="sm" />

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-ink">{l.name}</span>
                    {l.position && <span className="block truncate text-meta text-ink-3">{l.position}</span>}
                  </span>

                  {l.convidado && <Pill tone="signal">{l.convidado}</Pill>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {erro && (
        <p role="alert" className="border-t border-line bg-risk-soft px-5 py-2.5 text-meta leading-relaxed text-risk">
          {erro}
        </p>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        <span className="text-meta text-ink-3">Não avisa ninguém.</span>
        <div className="ml-auto flex items-center gap-2">
          {onCancelar && (
            <button type="button" onClick={onCancelar} disabled={busy} className="ctl-ghost">
              Cancelar
            </button>
          )}
          <button
            type="button"
            onClick={() => void gravar()}
            disabled={busy || n === 0 || linhas === null}
            className="ctl-primary"
            title={n === 0 ? "Escolhe pelo menos um atleta" : undefined}
          >
            <ClipboardCheck className="size-3.5" strokeWidth={1.75} />
            {busy ? "A gravar…" : correcao ? "Guardar correção" : `Registar convocatória · ${n}`}
          </button>
        </div>
      </footer>
    </Panel>
  );
}

/**
 * A convocatória de um jogo que já passou, como ficou.
 *
 * ## O que se lê aqui
 *
 * Quem foi convocado, o que cada família respondeu antes do jogo, e quem jogou.
 * Até aqui eram três perguntas que obrigavam a abrir a página de cada jogo.
 *
 * ## Enviada ou registada
 *
 * Uma convocatória enviada antes do jogo avisou as famílias. Uma registada
 * depois não avisou ninguém. As duas ficam iguais na base (`callUpsClosedAt`),
 * e a diferença lê-se pela hora: fechada depois do apito é um registo.
 *
 * ## Corrigir, e não reabrir
 *
 * Corrigir abre `RegistoDoPassado` no mesmo painel. Não há "Reabrir" como nos
 * Próximos, porque reabrir e voltar a submeter avisava as famílias de um jogo
 * que já foi.
 */
function HistoricoDoJogo({
  match,
  acabadoDeRegistar,
  podeCorrigir,
  onCorrigido,
}: {
  match: ApiMatch;
  /** Veio agora da vista "Em atraso". Ver `aoRegistar`. */
  acabadoDeRegistar: boolean;
  /** Só a época corrente se corrige. Uma época fechada é arquivo. */
  podeCorrigir: boolean;
  onCorrigido: () => Promise<void>;
}) {
  const { session } = useSession();
  // O emblema e a época, para a folha em PDF.
  const { academy, season } = useStore();
  const mayRecord = can(session, "attendance:write") && podeCorrigir;
  const [detalhe, setDetalhe] = useState<MatchDetail | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [corrigir, setCorrigir] = useState(false);
  const [corrigido, setCorrigido] = useState(false);
  const [folha, setFolha] = useState(false);

  /*
   * A página do jogo, e não só a linha da lista: traz os nomes dos convidados
   * de outros escalões (que o âmbito de um treinador não alcança) e a ficha,
   * para se ver quem jogou.
   */
  const carregar = useCallback(async () => {
    try {
      setDetalhe(await getMatch(match.id));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o jogo.");
    }
  }, [match.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (corrigir) {
    return (
      <RegistoDoPassado
        match={match}
        correcao
        onCancelar={() => setCorrigir(false)}
        onGravado={async () => {
          await onCorrigido();
          await carregar();
          setCorrigir(false);
          setCorrigido(true);
        }}
      />
    );
  }

  const d = new Date(match.startsAt);
  const registadaDepois = match.submittedAt !== null && new Date(match.submittedAt).getTime() > d.getTime();
  const plantel = (detalhe?.squad ?? []).map((s) => ({ ...s, numero: numeroDe(s.athleteId, match.teamId) })).sort(porNumero);
  const convocados = detalhe ? plantel.length : match.calledUp.length;
  const recusaram = plantel.filter((s) => s.callUpStatus === "DECLINED");
  const confirmaram = plantel.filter((s) => s.callUpStatus === "CONFIRMED").length;
  const comFicha = plantel.some((s) => s.played);
  const jogaram = plantel.filter((s) => s.played).length;

  /**
   * A folha do jogo passado, para o arquivo do clube ou para a federação.
   *
   * Sai do plantel que esta página acabou de ler, pela mesma montagem dos
   * outros dois botões (`folhaDoJogo`). Quem disse que não ia fica de fora,
   * como em todas as folhas (ver `buildCallUpPdf`).
   */
  async function exportar() {
    if (folha || !detalhe) return;
    setFolha(true);
    setErro(null);
    try {
      const rows: SheetRow[] = plantel.map((s) => ({
        squadNumber: s.numero,
        name: s.name,
        position: s.position,
        status: s.callUpStatus,
        guestFrom: s.isGuest ? (s.guestFromTeam ?? "outro escalão") : null,
      }));
      await descarregarFolha({ match: folhaDoJogo(detalhe), rows, academy, season });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar o PDF.");
    } finally {
      setFolha(false);
    }
  }

  return (
    <Panel>
      <PanelHead title={`${match.teamName} ${matchLabel(match)}`} hint={`${longDate(d)} · ${time(d)} · ${match.venue}`}>
        <Resultado match={match} />
        <button
          type="button"
          onClick={() => void exportar()}
          disabled={!detalhe || folha}
          className="ctl-outline"
          title="PDF da convocatória deste jogo"
        >
          <Download className="size-3.5" strokeWidth={1.75} />
          {folha ? "A gerar…" : "Exportar PDF"}
        </button>
      </PanelHead>

      {(acabadoDeRegistar || corrigido) && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-ok-soft px-5 py-2.5 text-meta text-ok">
          <Check className="size-3.5 shrink-0" strokeWidth={2.5} />
          <span className="font-medium">
            {corrigido ? "Correção guardada." : "Convocatória registada."} Ninguém foi avisado.
          </span>
          {detalhe && !comFicha && (
            <Link to={`/jogos/${match.id}?aba=pos`} className="ml-auto font-medium underline-offset-2 hover:underline">
              Preencher a ficha de jogo
            </Link>
          )}
        </div>
      )}

      <div className="border-b border-line px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <Conta n={convocados} label={convocados === 1 ? "convocado" : "convocados"} />
          {match.confirmationRequired && detalhe && (
            <Conta n={confirmaram} de={convocados} label="confirmaram" tone={confirmaram > 0 ? "ok" : undefined} />
          )}
          {recusaram.length > 0 && (
            <Conta n={recusaram.length} label={recusaram.length === 1 ? "disse que não ia" : "disseram que não iam"} tone="risk" />
          )}
          {comFicha && <Conta n={jogaram} label="jogaram" />}
          <span className="text-meta text-ink-3 sm:ml-auto">
            {registadaDepois
              ? "Registada depois do jogo, sem avisos"
              : match.submittedAt
                ? `Enviada às famílias a ${shortDate(new Date(match.submittedAt))}`
                : "Enviada às famílias"}
          </span>
        </div>

        {/* O motivo de cada recusa, como nos Próximos: é o que se quer saber dela. */}
        {recusaram.length > 0 && (
          <ul className="mt-2.5 space-y-1">
            {recusaram.map((s) => (
              <li key={s.athleteId} className="flex flex-wrap items-baseline gap-x-2 text-meta">
                <span className="font-medium text-ink">{s.name}</span>
                <span className="text-ink-2">{match.calledUp.find((c) => c.athleteId === s.athleteId)?.declineReason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {detalhe === null && !erro ? (
        <Spinner />
      ) : (
        <ul className="max-h-[440px] overflow-y-auto">
          {plantel.map((s) => (
            <li key={s.athleteId} className="flex min-h-11 items-center gap-3 border-b border-line px-5 py-2.5 last:border-b-0">
              <span className="w-6 shrink-0 text-right text-meta font-semibold text-ink-3 tabular">{s.numero ?? "—"}</span>
              <Monogram name={s.name} photoUrl={athleteById(s.athleteId)?.photoUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">{s.name}</span>
                {(s.position || s.isGuest) && (
                  <span className="block truncate text-meta text-ink-3">
                    {[s.position, s.isGuest ? `de ${s.guestFromTeam ?? "outro escalão"}` : null].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
              {s.callUpStatus === "DECLINED" && <Pill tone="risk">não ia</Pill>}
              {s.callUpStatus === "CONFIRMED" && match.confirmationRequired && <Pill tone="ok">confirmou</Pill>}
              {/* Só com ficha: sem ela, "não jogou" em todas as linhas seria mentira. */}
              {comFicha && (
                <span className="shrink-0 text-meta whitespace-nowrap text-ink-3 tabular">
                  {s.played ? `${s.started ? "titular" : "entrou"} · ${s.minutes}'` : "não jogou"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {erro && (
        <p role="alert" className="border-t border-line bg-risk-soft px-5 py-2.5 text-meta leading-relaxed text-risk">
          {erro}
        </p>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        <Link to={`/jogos/${match.id}${detalhe && !comFicha ? "?aba=pos" : ""}`} className="ctl-outline">
          {detalhe && !comFicha ? "Preencher a ficha" : "Abrir o jogo"}
          <ChevronRight className="size-3.5" strokeWidth={2} />
        </Link>
        {mayRecord && (
          <button type="button" onClick={() => setCorrigir(true)} className="ctl-ghost ml-auto">
            <Pencil className="size-3.5" strokeWidth={1.75} />
            Corrigir convocatória
          </button>
        )}
      </footer>
    </Panel>
  );
}

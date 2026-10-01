import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useNavigationType, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Loading, Metric, MetricRow, Pill, cx } from "@/components/primitives";
import { Segmented } from "@/components/filters";
import { Lista, ListaTopo } from "@/components/definicoes/ui";
import { EquipasRail } from "@/components/EquipasRail";
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  History,
  Boxes,
  Pencil,
  Plus,
  Sparkle,
  Target,
  Trash2,
  Trophy,
} from "@/lib/icons";
import { academy, listSessions, listTeams, scopedTeamIds, sportById, teamById } from "@/lib/api";
import { useTeamColors } from "@/lib/calendar";
import { ensureCalendarRange, matches, seasonRanges, today, useStore } from "@/lib/store";
import { dayShort, relativeDays, time } from "@/lib/format";
import { can, isAcademyWide } from "@/lib/permissions";
import { categoriesFor } from "@/lib/sports";
import { useMobile } from "@/lib/viewport";
import { categoryByLabel, listPlans, loadLabel, minutesByCategory, sessionLoad, type PlanSummary } from "@/lib/training";
import {
  addDays,
  cycleLength,
  cycleOn,
  dayKey,
  deleteCycle,
  daysIn,
  defaultColor,
  keyToDate,
  listCycles,
  matchDayLabel,
  mesoOf,
  microLabel,
  mondayOf,
  monthShort,
  rangeLabel,
  viewAround,
  type Cycle,
} from "@/lib/cycles";
import type { TrainingSession } from "@/data/types";
import { useSession } from "@/session";
import { SeasonBar } from "./SeasonBar";
import { CycleDialog } from "./CycleDialogs";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { NewEventDialog } from "@/components/NewEventDialog";
import { ExportDialog } from "./ExportDialog";

type Vista = "micro" | "meso" | "epoca" | "treinos";

/** A última equipa aberta, para o Planeamento voltar a abrir onde se estava. */
const CHAVE_EQUIPA = "academias.planeamento.equipa";
/** O dia que estava aberto, para o botão de voltar devolver a mesma semana. */
const CHAVE_DIA = "academias.planeamento.dia";
function diaLembrado(): string | null {
  try {
    const k = sessionStorage.getItem(CHAVE_DIA);
    return k && /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : null;
  } catch {
    return null;
  }
}
function equipaLembrada(): string | null {
  try {
    return localStorage.getItem(CHAVE_EQUIPA);
  } catch {
    return null;
  }
}

/**
 * Planeamento: as equipas ao lado, e a semana, a época e os treinos de cada uma.
 *
 * ## O que mudou neste ecrã, e porquê
 *
 * A página abria em "Todas as equipas", com a equipa num seletor pequeno ao
 * canto. A periodização é por equipa, por isso quem abria o Planeamento não via
 * mesociclos em lado nenhum: só apareciam depois de escolher uma equipa, e nada
 * no ecrã dizia isso. E tudo o resto (a barra da época, os números, a semana, a
 * distribuição, os avisos e duas listas) vinha empilhado na mesma página.
 *
 * Agora, como nas Definições:
 *
 *  - **As equipas ficam à vista**, numa coluna à esquerda. A página abre numa
 *    equipa (a última aberta, ou a primeira) e não no clube inteiro.
 *  - **Uma vista de cada vez**: Semana (o trabalho do dia a dia), Época (os
 *    mesociclos e os microciclos) e Treinos (o que falta planear e o que já se
 *    fez). A vista e a equipa vivem no endereço, para se poder voltar atrás e
 *    partilhar a ligação.
 *  - **Criar um mesociclo está sempre a um clique**: no cabeçalho da equipa, na
 *    vista Época, e num convite na Semana enquanto a equipa não tem nenhum.
 *
 * ## Os treinos não pertencem ao ciclo por chave
 *
 * Um micro é um intervalo de dias. Os treinos e os jogos que lá caem são dele.
 * Por isso não há "associar treino", e marcar ou mover um treino no calendário
 * muda-o de micro sozinho. Ver `lib/cycles.ts`.
 *
 * ## Com todas as equipas
 *
 * A periodização é por equipa, e dez faixas de fases umas por cima das outras
 * não se leem. "Todas as equipas" é a semana do clube, sem a vista Época.
 */
export default function Trainings() {
  const { session } = useSession();
  useStore();
  const navigate = useNavigate();
  const mobile = useMobile();
  const [params, setParams] = useSearchParams();
  const cores = useTeamColors(session);

  const mayPlan = can(session, "training:write");
  // As equipas que esta pessoa acompanha: um treinador não abre o planeamento
  // de outro escalão, que o servidor também já não lhe devolve.
  const equipas = listTeams(session);
  const minhas = isAcademyWide(session) ? null : scopedTeamIds(session);

  /*
   * A equipa: a do endereço; sem endereço, a primeira do treinador, a última
   * que se abriu, ou a primeira da lista. "todas" é o clube inteiro, e só se
   * chega lá por escolha.
   */
  const teamParam = params.get("equipa");
  const existe = (id: string | null | undefined): id is string => Boolean(id) && equipas.some((t) => t.id === id);
  const teamId =
    teamParam === null
      ? ([minhas?.[0], equipaLembrada(), equipas[0]?.id].find(existe) ?? "")
      : existe(teamParam)
        ? teamParam
        : "";
  const team = teamId ? teamById(teamId) : undefined;
  const mayPlanTeam = mayPlan && Boolean(team) && (minhas === null || minhas.includes(teamId));

  const vistaParam = params.get("vista");
  const vista: Vista =
    vistaParam === "treinos" ? "treinos" : vistaParam === "epoca" && team ? "epoca" : vistaParam === "meso" && team ? "meso" : "micro";

  const hoje = dayKey(today);
  /*
   * O dia aberto. Ao voltar atrás (do plano de um treino, por exemplo), a
   * página reabre na semana em que se estava; a entrar pelo menu, abre em hoje.
   */
  const voltou = useNavigationType() === "POP";
  const [anchor, setAnchorState] = useState(() => (voltou && diaLembrado()) || hoje);
  const setAnchor = (k: string) => {
    setAnchorState(k);
    try {
      sessionStorage.setItem(CHAVE_DIA, k);
    } catch {
      /* sem armazenamento, voltar atrás abre em hoje */
    }
  };

  /*
   * Os ciclos, guardados por equipa.
   *
   * Trocar de equipa não pode desfocar a página nem mostrar um disco: a coluna
   * das equipas é para se saltar de uma para outra. Os ciclos de cada equipa
   * ficam guardados depois de lidos, e os das outras vão-se buscar em segundo
   * plano logo a seguir à primeira. Assim a troca é imediata.
   */
  const [ciclosPorEquipa, setCiclosPorEquipa] = useState<Map<string, Cycle[]>>(() => new Map());
  const cycles = useMemo(() => (teamId ? (ciclosPorEquipa.get(teamId) ?? []) : []), [ciclosPorEquipa, teamId]);
  const cyclesReady = !teamId || ciclosPorEquipa.has(teamId);
  const lerCiclos = useCallback(async (id: string) => {
    let lidos: Cycle[] = [];
    try {
      lidos = await listCycles(id);
    } catch {
      /* sem ciclos lidos, a equipa aparece por periodizar */
    }
    setCiclosPorEquipa((antes) => new Map(antes).set(id, lidos));
  }, []);
  const recarregarCiclos = useCallback(async () => {
    if (teamId) await lerCiclos(teamId);
  }, [teamId, lerCiclos]);
  useEffect(() => {
    void recarregarCiclos();
  }, [recarregarCiclos]);

  /* As outras equipas, uma a uma, depois de a aberta estar no ecrã. */
  const idsDasEquipas = equipas.map((t) => t.id).join(",");
  const jaAbriu = cyclesReady;
  useEffect(() => {
    if (!jaAbriu) return;
    let vivo = true;
    void (async () => {
      for (const id of idsDasEquipas.split(",").filter(Boolean)) {
        if (!vivo) return;
        if (id !== teamId) await lerCiclos(id);
      }
    })();
    return () => {
      vivo = false;
    };
    // Só uma vez por lista de equipas: a equipa aberta é relida pelo efeito de cima.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsDasEquipas, jaAbriu]);

  /* O intervalo aberto: o micro do dia escolhido, ou a semana dele. */
  const view = viewAround(teamId ? cycles : [], anchor);
  const days = daysIn(view.from, view.to);
  const fromDate = keyToDate(view.from);
  const toDate = new Date(keyToDate(view.to).getTime() + 86_400_000 - 1);

  /* Os planos do intervalo, acumulados à medida que se navega. */
  const [plans, setPlans] = useState<Map<string, PlanSummary> | null>(null);
  useEffect(() => {
    let vivo = true;
    void ensureCalendarRange(fromDate, toDate);
    const de = new Date(Math.min(fromDate.getTime(), today.getTime() - 30 * 86_400_000)).toISOString();
    const ate = new Date(Math.max(toDate.getTime(), today.getTime() + 14 * 86_400_000)).toISOString();
    listPlans(de, ate)
      .then((r) => vivo && setPlans((antes) => new Map([...(antes ?? new Map()), ...(r ?? []).map((p) => [p.sessionId, p] as const)])))
      .catch(() => vivo && setPlans((antes) => antes ?? new Map()));
    return () => {
      vivo = false;
    };
    // O intervalo muda por texto; as datas derivadas saem dele.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.from, view.to]);
  const planOf = plans ?? new Map<string, PlanSummary>();

  /*
   * A equipa escolhida, ou "as minhas" para um treinador: sem equipa escolhida,
   * o planeador mostra as equipas dele e não o clube inteiro. Quem vê a academia
   * toda (`minhas === null`) continua a ver tudo.
   */
  const daEquipa = <T extends { teamId: string }>(x: T) =>
    teamId ? x.teamId === teamId : minhas === null || minhas.includes(x.teamId);

  const viewSessions = listSessions(session, fromDate, toDate).filter((s) => s.status !== "cancelled" && daEquipa(s));
  const viewMatches = matches.filter((m) => {
    const d = new Date(m.startsAt);
    return d >= fromDate && d <= toDate && m.status !== "CANCELLED" && daEquipa(m);
  });

  /* Os dias de jogo da equipa, para as etiquetas MD e para a barra da época. */
  const matchDays = useMemo(
    () =>
      teamId
        ? [...new Set(matches.filter((m) => m.teamId === teamId && m.status !== "CANCELLED").map((m) => dayKey(new Date(m.startsAt))))].sort()
        : [],
    // `matches` é substituído, não mutado, quando o store muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teamId, matches],
  );

  /* A época da equipa: o macrociclo. Esticada até aos ciclos que saiam dela. */
  const epoca = useMemo(() => {
    if (!team) return null;
    const r = seasonRanges[team.season] ?? epocaPeloRotulo(team.season);
    if (!r) return null;
    const from = cycles.reduce((m, c) => (c.startsOn < m ? c.startsOn : m), r.startsOn);
    const to = cycles.reduce((m, c) => (c.endsOn > m ? c.endsOn : m), r.endsOn);
    return { from, to };
  }, [team, cycles]);

  const micro = view.micro;
  const meso = micro ? mesoOf(cycles, micro) : cycleOn(cycles, "MESO", view.from);
  const mesos = useMemo(() => cycles.filter((c) => c.level === "MESO").sort((x, y) => x.startsOn.localeCompare(y.startsOn)), [cycles]);
  const micros = useMemo(() => cycles.filter((c) => c.level === "MICRO").sort((x, y) => x.startsOn.localeCompare(y.startsOn)), [cycles]);

  /*
   * O Mesociclo e a Época olham para mais do que uma semana: os treinos e os
   * planos desse intervalo vêm quando a vista se abre.
   */
  const semTodas = !team && vista === "micro";
  const janelaDe = addDays(mondayOf(hoje), -8 * 7);
  const janelaAte = addDays(mondayOf(hoje), 5 * 7 - 1);
  const faixaDe = vista === "epoca" && epoca ? epoca.from : vista === "meso" && meso ? meso.startsOn : semTodas ? janelaDe : null;
  const faixaAte = vista === "epoca" && epoca ? epoca.to : vista === "meso" && meso ? meso.endsOn : semTodas ? janelaAte : null;
  useEffect(() => {
    if (!faixaDe || !faixaAte) return;
    let vivo = true;
    const de = keyToDate(faixaDe);
    const ate = new Date(keyToDate(faixaAte).getTime() + 86_400_000 - 1);
    void ensureCalendarRange(de, ate);
    listPlans(de.toISOString(), ate.toISOString())
      .then((r) => vivo && setPlans((antes) => new Map([...(antes ?? new Map()), ...(r ?? []).map((pl) => [pl.sessionId, pl] as const)])))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [faixaDe, faixaAte]);

  /* A carga e a distribuição do intervalo, somadas dos planos. */
  const soma = useMemo(() => resumir(viewSessions, planOf), [viewSessions, planOf]);

  const sessoesEntre = (from: string, to: string) =>
    listSessions(session, keyToDate(from), new Date(keyToDate(to).getTime() + 86_400_000 - 1)).filter((x) => x.status !== "cancelled" && daEquipa(x));
  /** As semanas (segunda a domingo) de um intervalo, cada uma com a sua carga. */
  const semanasEntre = (from: string, to: string): SemanaDeCarga[] => {
    const todas = sessoesEntre(from, to);
    const out: SemanaDeCarga[] = [];
    for (let k = mondayOf(from); k <= to; k = addDays(k, 7)) {
      const fim = addDays(k, 6);
      const mc = cycleOn(cycles, "MICRO", k);
      const ms = mc ? mesoOf(cycles, mc) : cycleOn(cycles, "MESO", k);
      const daSemana = todas.filter((x) => {
        const d = dayKey(new Date(x.start));
        return d >= k && d <= fim;
      });
      out.push({
        ...resumir(daSemana, planOf),
        from: k,
        to: fim,
        rotulo: mc ? microLabel(cycles, mc) : rangeLabel(k, fim),
        cor: ms ? (ms.color ?? defaultColor(ms.phase, mesos.indexOf(ms))) : null,
        mesoNome: ms ? (ms.name ?? ms.phase ?? null) : null,
      });
    }
    return out;
  };
  const semanasDaEpoca = vista === "epoca" && epoca ? semanasEntre(epoca.from, epoca.to) : [];
  const semanasDoMeso = vista === "meso" && meso ? semanasEntre(meso.startsOn, meso.endsOn) : [];
  const somaMeso = resumir(vista === "meso" && meso ? sessoesEntre(meso.startsOn, meso.endsOn) : [], planOf);
  /*
   * Com todas as equipas: a carga de cada uma, semana a semana, na janela de
   * oito semanas para trás e quatro para a frente.
   */
  const semanasDaJanela: { from: string; to: string }[] = [];
  const seriesDasEquipas: SerieDeEquipa[] = [];
  if (semTodas) {
    for (let k = janelaDe; k <= janelaAte; k = addDays(k, 7)) semanasDaJanela.push({ from: k, to: addDays(k, 6) });
    const todas = sessoesEntre(janelaDe, janelaAte);
    for (const t of equipas) {
      const dela = todas.filter((x) => x.teamId === t.id);
      if (minhas !== null && !minhas.includes(t.id)) continue;
      seriesDasEquipas.push({
        id: t.id,
        nome: t.name,
        cor: cores.get(t.id)?.base ?? "var(--color-ink-3)",
        semanas: semanasDaJanela.map((w) =>
          resumir(
            dela.filter((x) => {
              const d = dayKey(new Date(x.start));
              return d >= w.from && d <= w.to;
            }),
            planOf,
          ),
        ),
      });
    }
  }
  const indiceDoMeso = meso ? mesos.indexOf(meso) : -1;
  const mesoDeHoje = cycleOn(cycles, "MESO", hoje);
  /** Abrir um mesociclo: no dia de hoje se ele estiver a decorrer, senão no primeiro dia. */
  const irAoMeso = (m: Cycle) => setAnchor(hoje >= m.startsOn && hoje <= m.endsOn ? hoje : m.startsOn);
  /** Da Época para a vista de um mesociclo. */
  const abrirMeso = (m: Cycle) => {
    irAoMeso(m);
    const p = new URLSearchParams(params);
    p.set("vista", "meso");
    setParams(p);
  };
  /*
   * Apagar um mesociclo leva as semanas dele, todas. O servidor só leva as
   * vazias (para não perder o que se escreveu ao mexer em datas), por isso as
   * que têm objetivo, foco ou notas apagam-se aqui, uma a uma, antes dele. Os
   * treinos e os jogos não são de nenhum ciclo: ficam onde estão.
   */
  async function apagarMeso(m: Cycle) {
    for (const x of micros.filter((mc) => mesoOf(cycles, mc)?.id === m.id)) await deleteCycle(x.id);
    await deleteCycle(m.id);
    setAApagarMeso(null);
    await recarregarCiclos();
    const p = new URLSearchParams(params);
    p.set("vista", "epoca");
    setParams(p);
  }

  const unidade = micro ? "este micro" : "esta semana";

  /*
   * Alertas honestos: derivados só do que está planeado, e só quando há plano
   * suficiente para a ausência significar alguma coisa.
   */
  const alerts = useMemo(() => {
    const out: string[] = [];
    // O foco do micro contra o que está planeado: é a pergunta que o foco serve.
    if (micro && micro.focus.length > 0 && soma.planned >= 1) {
      const sem = micro.focus.filter((f) => !soma.byCategory.some((b) => b.label === f && b.minutes > 0));
      if (sem.length > 0) out.push(`O foco d${unidade} inclui ${sem.map((s) => s.toLowerCase()).join(", ")}, e ainda não há minutos planeados disso.`);
    }
    if (soma.planned >= 2) {
      /*
       * As categorias são as da modalidade que mais treina no intervalo: um
       * clube de basquetebol não leva um aviso sobre "bolas paradas".
       */
      const porModalidade = new Map<string | null, number>();
      for (const s of viewSessions) {
        const sportId = teamById(s.teamId)?.sportId ?? null;
        porModalidade.set(sportId, (porModalidade.get(sportId) ?? 0) + 1);
      }
      const dominante = [...porModalidade.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const zero = categoriesFor(dominante).filter(
        (c) => c.key !== "bp" && !soma.byCategory.some((b) => b.label === c.label && b.minutes > 0) && !micro?.focus.includes(c.label),
      );
      if (zero.length > 0 && zero.length <= 3) {
        out.push(`Sem minutos planeados de ${zero.map((z) => z.label.toLowerCase()).join(", ")} n${unidade}.`);
      }
      if (soma.score >= 80) out.push(`A carga média d${unidade} está muito alta. Vale a pena rever a véspera de jogo.`);
    }
    return out;
  }, [soma, viewSessions, micro, unidade]);

  /*
   * "A planear" é uma lista de trabalho: só o que é **meu** entra nela, e só
   * da equipa escolhida quando há uma.
   */
  const janela = listSessions(
    session,
    new Date(today.getTime() - 30 * 86_400_000),
    new Date(today.getTime() + 14 * 86_400_000),
  ).filter((s) => s.status !== "cancelled" && daEquipa(s));
  const upcoming = janela.filter((s) => (s.mine ?? true) && new Date(s.start) >= today).sort((a, b) => a.start.localeCompare(b.start));
  const recent = janela
    .filter((s) => (s.mine ?? true) && new Date(s.start) < today)
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, 10);
  const next = upcoming[0];

  /* Os diálogos. */
  const [dialogo, setDialogo] = useState<
    | { kind: "meso"; cycle?: Cycle; initial?: { startsOn: string; endsOn: string } }
    | { kind: "micro"; cycle?: Cycle; initial?: { startsOn: string; endsOn: string } }
    | null
  >(null);
  const [exportar, setExportar] = useState(false);
  /** O dia em que se está a marcar um evento, a partir de um cartão da semana. */
  const [novoEvento, setNovoEvento] = useState<string | null>(null);
  const [aApagarMeso, setAApagarMeso] = useState<Cycle | null>(null);
  const [subTreinos, setSubTreinos] = useState<"planear" | "realizados">("planear");

  function escolherEquipa(id: string) {
    const p = new URLSearchParams(params);
    p.set("equipa", id || "todas");
    // A Época é de uma equipa: no clube inteiro volta-se à semana.
    if (!id && p.get("vista") === "epoca") p.delete("vista");
    setParams(p, { replace: true });
    if (id) {
      try {
        localStorage.setItem(CHAVE_EQUIPA, id);
      } catch {
        /* sem armazenamento, a página abre na primeira equipa */
      }
    }
  }
  function irPara(v: Vista) {
    const p = new URLSearchParams(params);
    if (v === "micro") p.delete("vista");
    else p.set("vista", v);
    setParams(p);
  }
  /** Abrir um dia (ou um micro) na vista Microciclo. */
  function abrirDia(k: string) {
    setAnchor(k);
    irPara("micro");
  }
  /** Novo mesociclo: salta para a Época, que é onde ele vai aparecer, e abre o diálogo por cima. */
  const novoMeso = () => {
    if (vista !== "epoca") irPara("epoca");
    /*
     * As datas propostas nunca caem em cima de um mesociclo que já existe: se a
     * semana aberta já é de um, o novo começa na segunda a seguir ao último, e
     * encolhe se bater no seguinte. Cinco semanas, quando há espaço.
     */
    const livre = (de: string, ate: string) => !mesos.some((m) => m.startsOn <= ate && m.endsOn >= de);
    let de = mondayOf(view.from);
    if (!livre(de, addDays(de, 6))) de = mondayOf(addDays(mesos[mesos.length - 1].endsOn, 7));
    let semanas = 5;
    while (semanas > 1 && !livre(de, addDays(de, semanas * 7 - 1))) semanas -= 1;
    setDialogo({ kind: "meso", initial: { startsOn: de, endsOn: addDays(de, semanas * 7 - 1) } });
  };

  /*
   * O disco só na primeira abertura. Depois disso a página fica no ecrã: uma
   * equipa cujos ciclos ainda não chegaram mostra a semana dela e espera calada
   * pelo resto, sem convites a periodizar que desapareciam meio segundo depois.
   */
  if (plans === null || (!cyclesReady && ciclosPorEquipa.size === 0)) return <Loading />;

  const unplanned = upcoming.filter((s) => !planOf.get(s.id)).length;
  const temCiclos = cycles.length > 0;
  const cols = `repeat(${days.length}, minmax(0,1fr))`;
  const sport = team ? sportById(team.sportId) : undefined;
  const todasLabel = minhas === null ? "Todas as equipas" : "As minhas equipas";

  return (
    <>
      <PageHeader title="Planeamento" subtitle="A época, os mesociclos e a semana de treino de cada equipa.">
        {mayPlan && (
          <Link to={`/calendario?novo=treino${teamId ? `&equipa=${teamId}` : ""}`} className="ctl-primary">
            <Plus className="size-3.5" strokeWidth={2} />
            Marcar treino
          </Link>
        )}
      </PageHeader>

      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-[212px_minmax(0,1fr)]">
        {/* ------------------------------------------------------------ as equipas */}
        <div className="min-w-0">
          {/* Em ecrãs estreitos, uma coluna de equipas empurrava a semana para fora do ecrã. */}
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

        {/* ------------------------------------------------------------ a equipa */}
        <section className="min-w-0">
          <header className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-4">
                {team ? [`Época ${team.season}`, academy.sports.length > 1 ? sport?.name : null].filter(Boolean).join(" · ") : "Clube"}
              </p>
              <h2 className="mt-1 flex items-center gap-2.5 truncate text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                {team && <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: cores.get(team.id)?.base ?? "var(--color-line-strong)" }} />}
                <span className="truncate">{team?.name ?? todasLabel}</span>
              </h2>
            </div>
            {team && epoca && (
              <div className="flex shrink-0 items-center gap-2">
                {/* Exportar só lê: aparece a quem vê o Planeamento, mesmo sem poder mexer. */}
                <button type="button" className="ctl-ghost" onClick={() => setExportar(true)}>
                  <Download className="size-3.5" strokeWidth={1.75} />
                  Exportar
                </button>
                {/*
                  Dentro de um mesociclo, as ações são sobre ele: editar e apagar.
                  Criar outro faz-se na Época, que é onde se veem todos.
                */}
                {mayPlanTeam && vista === "meso" && meso ? (
                  <>
                    <button type="button" className="ctl-outline" onClick={() => setDialogo({ kind: "meso", cycle: meso })}>
                      <Pencil className="size-3.5" strokeWidth={1.75} />
                      Editar mesociclo
                    </button>
                    {/* Só o ícone: "Apagar mesociclo" por extenso pesava mais do que a ação merece. */}
                    <button
                      type="button"
                      className="ctl-ghost size-8 justify-center px-0 text-ink-3 hover:text-risk"
                      aria-label="Apagar mesociclo"
                      title="Apagar mesociclo"
                      onClick={() => setAApagarMeso(meso)}
                    >
                      <Trash2 className="size-4" strokeWidth={1.75} />
                    </button>
                  </>
                ) : (
                  mayPlanTeam && (
                    <button type="button" className="ctl-outline" onClick={novoMeso}>
                      <Plus className="size-3.5" strokeWidth={2} />
                      Novo mesociclo
                    </button>
                  )
                )}
              </div>
            )}
          </header>

          <div className="mb-5">
            <Segmented<Vista>
              size="md"
              label="Vista"
              value={vista}
              onChange={irPara}
              options={[
                { value: "micro", label: team ? "Microciclo" : "Semana", icon: CalendarDays },
                ...(team
                  ? [
                      { value: "meso" as const, label: "Mesociclo", icon: Boxes },
                      { value: "epoca" as const, label: "Época", icon: Target, count: mesos.length },
                    ]
                  : []),
                { value: "treinos", label: "Treinos", icon: ClipboardCheck, count: unplanned || undefined },
              ]}
            />
          </div>

          {/* ---------------------------------------------------------- Microciclo */}
          {vista === "micro" && (
            <div className="space-y-4">
              {/* Sem equipa, a periodização não existe: diz-se onde está. */}
              {!team && equipas.length > 0 && (
                <Nota>
                  A periodização é de cada equipa. Escolhe uma equipa para ver a época dela e criar mesociclos e microciclos.
                </Nota>
              )}

              {/* O convite a periodizar, enquanto a equipa não tem ciclos. */}
              {team && cyclesReady && !temCiclos && mayPlanTeam && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[12px] border border-line bg-surface px-4 py-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-signal-soft text-signal-ink">
                    <Target className="size-4" strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0 flex-1 basis-[260px]">
                    <div className="text-body font-medium text-ink">Queres periodizar a época?</div>
                    <p className="mt-0.5 text-meta leading-relaxed text-ink-3">
                      Cria os mesociclos da época: cada um traz logo as suas semanas, com objetivo e foco. Se não, continua a planear semana a semana.
                    </p>
                  </div>
                  <button type="button" className="ctl-primary" onClick={novoMeso}>
                    <Plus className="size-3.5" strokeWidth={2} />
                    Criar mesociclo
                  </button>
                </div>
              )}

              <Lista>
                <ListaTopo>
                  <div className="min-w-0">
                    {/* Onde esta semana cai na época: mesociclo e microciclo. */}
                    {team && (meso || micro) && (
                      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-ink-3">
                        {meso && (
                          <button type="button" onClick={() => irPara("epoca")} className="inline-flex items-center gap-1.5 hover:text-ink">
                            <span aria-hidden className="size-2 rounded-full" style={{ background: meso.color ?? defaultColor(meso.phase, mesos.indexOf(meso)) }} />
                            {meso.name ?? meso.phase ?? "Mesociclo"}
                          </button>
                        )}
                        {meso && micro && <ChevronRight className="size-3 text-ink-4" strokeWidth={1.75} />}
                        {micro && <span>{microLabel(cycles, micro)}</span>}
                      </div>
                    )}
                    <h3 className="text-panel text-ink">
                      {rangeLabel(view.from, view.to)}
                      {micro && cycleLength(micro) !== 7 && <span className="font-normal text-ink-3"> · {cycleLength(micro)} dias</span>}
                    </h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" className="ctl-ghost size-8 justify-center px-0" aria-label="Anterior" onClick={() => setAnchor(addDays(view.from, -1))}>
                      <ChevronLeft className="size-4" strokeWidth={1.75} />
                    </button>
                    {!(hoje >= view.from && hoje <= view.to) && (
                      <button type="button" className="ctl-outline h-8" onClick={() => setAnchor(hoje)}>
                        Hoje
                      </button>
                    )}
                    <button type="button" className="ctl-ghost size-8 justify-center px-0" aria-label="Seguinte" onClick={() => setAnchor(addDays(view.to, 1))}>
                      <ChevronRight className="size-4" strokeWidth={1.75} />
                    </button>
                  </div>
                </ListaTopo>

                {/* A intenção do micro, por cima dos dias. */}
                {team && micro && (
                  <IntencaoDoMicro micro={micro} sportId={team.sportId} mayEdit={mayPlanTeam} onEdit={() => setDialogo({ kind: "micro", cycle: micro })} />
                )}
                {team && !micro && mayPlanTeam && temCiclos && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                    <span className="text-meta text-ink-3">Estes dias não estão em nenhum microciclo.</span>
                    <button
                      type="button"
                      className="ctl-ghost h-7 text-meta"
                      onClick={() => setDialogo({ kind: "micro", initial: { startsOn: view.from, endsOn: view.to } })}
                    >
                      <Plus className="size-3.5" strokeWidth={2} />
                      Criar microciclo
                    </button>
                  </div>
                )}

                {/* Os dias: um cartão por dia, com ar entre eles. */}
                <div className="grid gap-2 p-3 max-md:grid-cols-1" style={mobile ? undefined : { gridTemplateColumns: cols }}>
                  {days.map((k) => {
                    const d = keyToDate(k);
                    const isToday = k === hoje;
                    const daySessions = viewSessions.filter((s) => dayKey(new Date(s.start)) === k).sort((a, b) => a.start.localeCompare(b.start));
                    const dayMatches = viewMatches.filter((m) => dayKey(new Date(m.startsAt)) === k);
                    const rest = daySessions.length === 0 && dayMatches.length === 0;
                    const md = teamId ? matchDayLabel(k, matchDays) : null;

                    return (
                      <div
                        key={k}
                        className={cx(
                          "min-w-0 rounded-[10px] border p-2",
                          isToday ? "border-signal-line bg-signal-soft/30" : "border-line bg-sunken/30",
                          !mobile && "min-h-36",
                        )}
                      >
                        <div className="mb-2 flex items-center gap-1.5 px-0.5">
                          <span className={cx("text-[11px] font-medium uppercase tracking-[0.06em]", isToday ? "text-signal-ink" : "text-ink-4")}>{dayShort(d)}</span>
                          <span className={cx("text-body font-semibold tabular", isToday ? "text-signal-ink" : "text-ink")}>{d.getDate()}</span>
                          {md && (
                            <span
                              className={cx(
                                "ml-auto rounded-[4px] px-1 text-[10px] font-semibold tabular",
                                md === "MD" ? "bg-signal-strong text-signal-on" : "bg-surface text-ink-3",
                              )}
                              title="Dia em relação ao jogo"
                            >
                              {md === "MD" ? "Jogo" : md}
                            </span>
                          )}
                          {/*
                            Marcar um evento neste dia, sem sair do Planeamento:
                            abre o diálogo do calendário, já no dia e na equipa.
                          */}
                          {mayPlan && (!team || mayPlanTeam) && (
                            <button
                              type="button"
                              onClick={() => setNovoEvento(k)}
                              aria-label={`Marcar evento a ${d.getDate()} de ${d.toLocaleDateString("pt-PT", { month: "long" })}`}
                              title="Marcar evento neste dia"
                              className={cx(
                                "flex size-6 shrink-0 items-center justify-center rounded-[6px] text-ink-3 transition-colors duration-[120ms] hover:bg-surface hover:text-ink",
                                !md && "ml-auto",
                              )}
                            >
                              <Plus className="size-3.5" strokeWidth={2} />
                            </button>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {dayMatches.map((m) => (
                            <Link
                              key={m.id}
                              to={`/jogos/${m.id}`}
                              className="flex items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-line-strong"
                            >
                              <Trophy className="size-3 shrink-0 text-ink-3" strokeWidth={1.75} />
                              <span className="truncate">
                                {m.isHome ? "vs" : "@"} {m.opponent}
                              </span>
                            </Link>
                          ))}
                          {daySessions.map((s) => {
                            const p = planOf.get(s.id);
                            const load = p ? sessionLoad(p.blocks, p.intensity) : null;
                            const color = categoryByLabel(p?.blocks.find((b) => b.category)?.category ?? p?.objective ?? undefined)?.color;
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => navigate(`/treinos/${s.id}`)}
                                className="block w-full rounded-[8px] border border-line bg-surface px-2 py-1.5 text-left transition-colors hover:border-line-strong"
                                style={color ? { borderLeft: `3px solid ${color.base}` } : undefined}
                              >
                                <div className="flex items-baseline justify-between gap-1">
                                  <span className="truncate text-[12px] font-semibold text-ink">{teamId ? "Treino" : (s.teamName ?? "Treino")}</span>
                                  <span className="shrink-0 text-[11px] text-ink-3 tabular">{time(new Date(s.start))}</span>
                                </div>
                                <div className={cx("mt-0.5 text-[11px]", p ? "text-ink-3" : "text-warn")}>
                                  {p ? `${load!.volume} min · ${load!.label}${p.objective ? ` · ${p.objective}` : ""}` : "Por planear"}
                                </div>
                              </button>
                            );
                          })}
                          {rest && <div className="px-0.5 text-[11px] text-ink-4">Descanso</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Lista>

              <Numeros
                soma={soma}
                onde={micro ? "neste microciclo" : "esta semana"}
                quarto={
                  <Metric
                    label="Próximo treino"
                    value={next ? time(new Date(next.start)) : "—"}
                    note={next ? `${next.teamName ?? ""} · ${relativeDays(new Date(next.start))}` : "nada marcado"}
                  />
                }
              />

              {/* Todas as equipas: a carga de cada escalão, para comparar. */}
              {!team && seriesDasEquipas.length > 0 && (
                <Lista>
                  <ListaTopo>
                    <h3 className="text-panel text-ink">Carga de treino por equipa</h3>
                    <span className="text-meta text-ink-3">as últimas 8 semanas e as próximas 4</span>
                  </ListaTopo>
                  <GraficoDasEquipas semanas={semanasDaJanela} series={seriesDasEquipas} hoje={hoje} />
                </Lista>
              )}

              <OQueSeTreina soma={soma} onde={micro ? "neste microciclo" : "nesta semana"} alerts={alerts} />
            </div>
          )}

          {/* ---------------------------------------------------------- Mesociclo */}
          {vista === "meso" && team && (
            <div className="space-y-4">
              {!cyclesReady ? null : mesos.length === 0 ? (
                <EpocaVazia nome={team.name} mayPlan={mayPlanTeam} onCriar={novoMeso} />
              ) : !meso ? (
                <>
                  <Nota>Os dias de {rangeLabel(view.from, view.to)} não caem em nenhum mesociclo. Escolhe o que queres ver.</Nota>
                  <Lista>
                    <ul>
                      {mesos.map((m, i) => (
                        <li key={m.id} className="border-b border-line last:border-b-0">
                          <button
                            type="button"
                            onClick={() => irAoMeso(m)}
                            className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-[120ms] hover:bg-sunken/50"
                          >
                            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: m.color ?? defaultColor(m.phase, i) }} />
                            <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{m.name ?? m.phase ?? "Mesociclo"}</span>
                            <span className="shrink-0 text-meta text-ink-3 tabular">{rangeLabel(m.startsOn, m.endsOn)}</span>
                            <ArrowRight className="size-3.5 shrink-0 text-ink-4 group-hover:text-ink-2" strokeWidth={1.75} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Lista>
                </>
              ) : (
                <>
                  {/* De um mesociclo para o outro, sem passar pela Época. */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-meta text-ink-3 tabular">
                      Mesociclo {indiceDoMeso + 1} de {mesos.length}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="ctl-ghost size-8 justify-center px-0 disabled:opacity-40"
                        aria-label="Mesociclo anterior"
                        disabled={indiceDoMeso <= 0}
                        onClick={() => irAoMeso(mesos[indiceDoMeso - 1])}
                      >
                        <ChevronLeft className="size-4" strokeWidth={1.75} />
                      </button>
                      {mesoDeHoje && mesoDeHoje.id !== meso.id && (
                        <button type="button" className="ctl-outline h-8" onClick={() => irAoMeso(mesoDeHoje)}>
                          Atual
                        </button>
                      )}
                      <button
                        type="button"
                        className="ctl-ghost size-8 justify-center px-0 disabled:opacity-40"
                        aria-label="Mesociclo seguinte"
                        disabled={indiceDoMeso >= mesos.length - 1}
                        onClick={() => irAoMeso(mesos[indiceDoMeso + 1])}
                      >
                        <ChevronRight className="size-4" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>

                  <Numeros
                    soma={somaMeso}
                    onde="neste mesociclo"
                    quarto={
                      <Metric
                        label="Semanas"
                        value={String(semanasDoMeso.length)}
                        note={
                          hoje > meso.endsOn
                            ? "já terminou"
                            : hoje < meso.startsOn
                              ? "ainda não começou"
                              : `vai na ${semanasDoMeso.filter((w) => w.from <= hoje).length}.ª`
                        }
                      />
                    }
                  />

                  <Lista>
                    <ListaTopo>
                      <h3 className="text-panel text-ink">Carga por semana</h3>
                      <span className="text-meta text-ink-3">as semanas deste mesociclo</span>
                    </ListaTopo>
                    <GraficoDeCarga semanas={semanasDoMeso} hoje={hoje} onAbrir={abrirDia} altura={220} />
                  </Lista>

                  <Mesociclo
                    meso={meso}
                    cor={meso.color ?? defaultColor(meso.phase, indiceDoMeso)}
                    micros={micros.filter((x) => mesoOf(cycles, x)?.id === meso.id)}
                    cycles={cycles}
                    hoje={hoje}
                    sportId={team.sportId}
                    onAbrir={abrirDia}
                  />

                  <OQueSeTreina
                    soma={somaMeso}
                    onde="neste mesociclo"
                    alerts={
                      meso.focus.length > 0 && somaMeso.planned >= 1
                        ? meso.focus
                            .filter((f) => !somaMeso.byCategory.some((x) => x.label === f && x.minutes > 0))
                            .map((f) => `O foco deste mesociclo inclui ${f.toLowerCase()}, e ainda não há minutos planeados disso.`)
                        : []
                    }
                  />
                </>
              )}
            </div>
          )}

          {/* ---------------------------------------------------------- Época */}
          {vista === "epoca" && team && (
            <div className="space-y-5">
              {!cyclesReady ? null : !temCiclos ? (
                <>
                  <EpocaVazia nome={team.name} mayPlan={mayPlanTeam} onCriar={novoMeso} />
                  {/* A carga da época inteira: o que já se treinou e o que está planeado para vir. */}
                  {epoca && cyclesReady && (
                    <Lista>
                      <ListaTopo>
                        <h3 className="text-panel text-ink">Carga de treino ao longo da época</h3>
                        <span className="text-meta text-ink-3">semana a semana · carrega numa semana para a abrir</span>
                      </ListaTopo>
                      <GraficoDeCarga semanas={semanasDaEpoca} hoje={hoje} onAbrir={abrirDia} />
                    </Lista>
                  )}
                </>
              ) : (
                <>
                  {epoca && (
                    <Lista>
                      <ListaTopo>
                        <h3 className="text-panel text-ink">A época numa linha</h3>
                        <span className="text-meta text-ink-3">carrega numa semana para a abrir</span>
                      </ListaTopo>
                      <SeasonBar
                        from={epoca.from}
                        to={epoca.to}
                        cycles={cycles}
                        matchDays={matchDays}
                        today={hoje}
                        selectedMicroId={micro?.id ?? null}
                        viewFrom={view.from}
                        viewTo={view.to}
                        onPickDay={abrirDia}
                        onPickMeso={abrirMeso}
                      />
                    </Lista>
                  )}

                  {/* A carga da época inteira: o que já se treinou e o que está planeado para vir. */}
                  {epoca && cyclesReady && (
                    <Lista>
                      <ListaTopo>
                        <h3 className="text-panel text-ink">Carga de treino ao longo da época</h3>
                        <span className="text-meta text-ink-3">semana a semana · carrega numa semana para a abrir</span>
                      </ListaTopo>
                      <GraficoDeCarga semanas={semanasDaEpoca} hoje={hoje} onAbrir={abrirDia} />
                    </Lista>
                  )}

                  <div>
                    <div className="mb-2.5 flex items-baseline justify-between gap-3">
                      <h3 className="text-panel text-ink">Mesociclos</h3>
                      <span className="text-meta text-ink-3 tabular">
                        {mesos.length} {mesos.length === 1 ? "mesociclo" : "mesociclos"} · {micros.length} {micros.length === 1 ? "semana" : "semanas"}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {mesos.map((m, i) => (
                        <Mesociclo
                          key={m.id}
                          meso={m}
                          cor={m.color ?? defaultColor(m.phase, i)}
                          micros={micros.filter((x) => mesoOf(cycles, x)?.id === m.id)}
                          cycles={cycles}
                          hoje={hoje}
                          sportId={team.sportId}
                          onAbrirMeso={() => abrirMeso(m)}
                          onAbrir={abrirDia}
                        />
                      ))}

                      {/* As semanas que ficaram fora de qualquer mesociclo. */}
                      {micros.some((x) => !mesoOf(cycles, x)) && (
                        <Mesociclo
                          meso={null}
                          cor="var(--color-line-strong)"
                          micros={micros.filter((x) => !mesoOf(cycles, x))}
                          cycles={cycles}
                          hoje={hoje}
                          sportId={team.sportId}
                          onAbrir={abrirDia}
                        />
                      )}
                    </div>

                    {mayPlanTeam && (
                      <button
                        type="button"
                        onClick={novoMeso}
                        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-line-strong text-meta font-medium text-ink-2 transition-colors duration-[120ms] hover:border-ink-3 hover:text-ink"
                      >
                        <Plus className="size-3.5" strokeWidth={2} />
                        Novo mesociclo
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ---------------------------------------------------------- Treinos */}
          {vista === "treinos" && (
            <div>
              {/* Os números, numa linha só, como nas Presenças. */}
              <Lista className="mb-5">
                <dl className="grid grid-cols-3">
                  <NumeroDoResumo rotulo="Por planear" valor={String(unplanned)} nota={unplanned ? "dos próximos 14 dias" : "está tudo planeado"} aviso={unplanned > 0} />
                  <NumeroDoResumo rotulo="Planeados" valor={String(upcoming.length - unplanned)} nota="prontos a treinar" />
                  <NumeroDoResumo rotulo="Realizados" valor={String(recent.length)} nota="os últimos, até 10" />
                </dl>
              </Lista>

              <div className="mb-4">
                <Segmented<"planear" | "realizados">
                  size="md"
                  label="Treinos"
                  value={subTreinos}
                  onChange={setSubTreinos}
                  options={[
                    { value: "planear", label: "A planear", icon: ClipboardCheck, count: unplanned || undefined },
                    { value: "realizados", label: "Realizados", icon: History },
                  ]}
                />
              </div>

              {subTreinos === "planear" ? (
                <TreinosPorDia
                  sessions={upcoming}
                  planOf={planOf}
                  cores={cores}
                  mostrarEquipa={!team}
                  vazio={{ titulo: "Não há treinos marcados", texto: "Marca-os no calendário: aparecem aqui prontos a planear." }}
                />
              ) : (
                <TreinosPorDia
                  sessions={recent}
                  planOf={planOf}
                  cores={cores}
                  mostrarEquipa={!team}
                  vazio={{ titulo: "Ainda sem treinos realizados", texto: "Os treinos já realizados aparecem aqui, com o plano que tiveram." }}
                />
              )}
            </div>
          )}
        </section>
      </div>

      {exportar && team && epoca && (
        <ExportDialog session={session} team={team} epoca={epoca} cycles={cycles} microAberto={micro} onClose={() => setExportar(false)} />
      )}
      {novoEvento && (
        <NewEventDialog session={session} day={keyToDate(novoEvento)} teamId={teamId || undefined} onClose={() => setNovoEvento(null)} />
      )}
      {aApagarMeso && (
        <ConfirmDialog title="Apagar este mesociclo?" onConfirm={() => apagarMeso(aApagarMeso)} onClose={() => setAApagarMeso(null)}>
          <p>
            <strong className="font-semibold text-ink">{aApagarMeso.name ?? aApagarMeso.phase ?? "Este mesociclo"}</strong> (
            {rangeLabel(aApagarMeso.startsOn, aApagarMeso.endsOn)}) deixa de existir, com os seus microciclos.
          </p>
          <p className="text-meta text-ink-3">
            Perdem-se o objetivo, o foco e as notas do mesociclo e de cada semana dele. Os treinos e os jogos ficam onde estão.
          </p>
        </ConfirmDialog>
      )}
      {dialogo && team && (dialogo.kind === "meso" || dialogo.kind === "micro") && (
        <CycleDialog
          level={dialogo.kind === "meso" ? "MESO" : "MICRO"}
          teamId={team.id}
          sportId={team.sportId}
          cycle={dialogo.cycle}
          initial={dialogo.initial}
          label={dialogo.cycle && dialogo.kind === "micro" ? microLabel(cycles, dialogo.cycle) : undefined}
          mesoCount={mesos.length}
          ocupados={mesos}
          onClose={() => setDialogo(null)}
          onSaved={() => {
            const criouMeso = dialogo.kind === "meso" && !dialogo.cycle;
            setDialogo(null);
            void recarregarCiclos();
            // Um mesociclo novo vê-se na Época: é lá que ele e as semanas dele aparecem.
            if (criouMeso) irPara("epoca");
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Os números de um intervalo                                                  */
/* -------------------------------------------------------------------------- */

type Resumo = ReturnType<typeof resumir>;

/** A carga e a distribuição de um conjunto de treinos, somadas dos planos. */
function resumir(sessions: TrainingSession[], planOf: Map<string, PlanSummary>) {
  const planned = sessions.filter((s) => planOf.get(s.id));
  const blocks = planned.flatMap((s) => planOf.get(s.id)!.blocks);
  const loads = planned.map((s) => {
    const p = planOf.get(s.id)!;
    return sessionLoad(p.blocks, p.intensity);
  });
  const score = loads.length ? Math.round(loads.reduce((a, l) => a + l.score, 0) / loads.length) : 0;
  return {
    treinos: sessions.length,
    planned: planned.length,
    volume: blocks.reduce((a, b) => a + b.durationMin, 0),
    score,
    /** Os minutos pesados pela intensidade: é a altura das barras no gráfico. */
    carga: Math.round(loads.reduce((a, l) => a + (l.volume * l.score) / 100, 0)),
    byCategory: minutesByCategory(blocks),
  };
}

/** Os quatro números de um microciclo ou de um mesociclo. */
function Numeros({ soma, onde, quarto }: { soma: Resumo; onde: string; quarto: ReactNode }) {
  return (
    <MetricRow>
      <Metric label={`Treinos ${onde}`} value={String(soma.treinos)} note={`${soma.planned} com plano`} />
      <Metric label="Volume planeado" value={String(soma.volume)} unit="min" note="soma dos blocos" />
      <Metric
        label="Carga média"
        value={soma.planned ? `${soma.score}` : "—"}
        unit={soma.planned ? "/100" : undefined}
        note={soma.planned ? sessionLoadNote(soma.score) : "sem planos ainda"}
      />
      {quarto}
    </MetricRow>
  );
}

/** Os minutos por objetivo, numa barra, com os avisos por baixo. */
function OQueSeTreina({ soma, onde, alerts = [] }: { soma: Resumo; onde: string; alerts?: string[] }) {
  return (
    <Lista>
      <ListaTopo>
        <h3 className="text-panel text-ink">O que se treina</h3>
        <span className="text-meta text-ink-3">minutos por objetivo, {onde}</span>
      </ListaTopo>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 px-4 py-4">
        {soma.volume > 0 ? (
          <>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-sunken">
              {soma.byCategory.map((c) => (
                <span
                  key={c.label}
                  title={`${c.label}: ${c.minutes} min`}
                  style={{ width: `${(c.minutes / soma.volume) * 100}%`, background: c.category?.color.base ?? "var(--color-ink-4)" }}
                />
              ))}
            </div>
            {soma.byCategory.slice(0, 8).map((c) => (
              <span key={c.label} className="inline-flex items-center gap-1.5 text-meta text-ink-2">
                <span className="size-2 rounded-full" style={{ background: c.category?.color.base ?? "var(--color-ink-4)" }} />
                {c.label}
                <span className="text-ink-4 tabular">
                  {c.minutes} min · {Math.round((c.minutes / soma.volume) * 100)}%
                </span>
              </span>
            ))}
          </>
        ) : (
          <span className="text-meta text-ink-4">A distribuição por objetivo aparece quando houver treinos planeados {onde}.</span>
        )}
      </div>
      {alerts.length > 0 && (
        <div className="space-y-1.5 border-t border-line px-4 py-3">
          {alerts.map((a) => (
            <div key={a} className="flex items-start gap-2 text-meta text-warn">
              <Sparkle className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
              {a}
            </div>
          ))}
        </div>
      )}
    </Lista>
  );
}

/* -------------------------------------------------------------------------- */
/* A carga, semana a semana                                                    */
/* -------------------------------------------------------------------------- */

type SemanaDeCarga = Resumo & {
  from: string;
  to: string;
  /** "Micro 05", ou as datas quando a semana não é de nenhum microciclo. */
  rotulo: string;
  /** A cor do mesociclo em que a semana cai. */
  cor: string | null;
  mesoNome: string | null;
};

/*
 * A cor de cada nível de carga. Fixa, e não a do clube: num clube vermelho, a
 * carga moderada apareceria com a cor do perigo.
 */
const COR_DA_CARGA = { Baixa: "#4c9f70", Moderada: "#d4a72c", Alta: "#e07b39", "Muito alta": "#c8402f" } as const;

type Medida = "carga" | "volume" | "score";
const MEDIDAS: { value: Medida; label: string; unidade: string }[] = [
  { value: "carga", label: "Carga", unidade: "" },
  { value: "volume", label: "Minutos", unidade: " min" },
  { value: "score", label: "Intensidade", unidade: "/100" },
];

/** Um tecto redondo para o eixo: 1, 2 ou 5 vezes uma potência de dez. */
function tectoRedondo(v: number): number {
  if (v <= 0) return 10;
  const base = 10 ** Math.floor(Math.log10(v));
  const f = v / base;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * base;
}

/**
 * Os troços de uma curva suave que passa por todos os pontos, um por intervalo.
 *
 * Interpolação monótona: a curva nunca sobe acima do ponto mais alto nem desce
 * abaixo do mais baixo entre dois pontos. Uma curva "bonita" que inventasse um
 * pico entre duas semanas mostrava uma carga que ninguém planeou.
 */
function trocosSuaves(pts: [number, number][]): string[] {
  const n = pts.length;
  if (n < 2) return [];
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      t[i] = (3 * a * m[i]) / h;
      t[i + 1] = (3 * b * m[i]) / h;
    }
  }
  const out: string[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    out.push(`C${x0 + dx[i] / 3} ${y0 + (t[i] * dx[i]) / 3} ${x1 - dx[i] / 3} ${y1 - (t[i + 1] * dx[i]) / 3} ${x1} ${y1}`);
  }
  return out;
}

/**
 * A carga de treino ao longo das semanas, numa linha.
 *
 * Um ponto por semana, ligados por uma curva. A linha cheia é o que já se
 * treinou; a tracejada é o que está planeado para vir, e lê-se como previsão. A
 * cor de cada ponto é o nível de carga da semana. A linha acaba na última
 * semana com treinos marcados: daí para a frente não há nada planeado, e uma
 * linha a zero diria que a equipa vai parar.
 *
 * Por trás, as faixas dos mesociclos, cada uma com a sua cor e o seu nome. O
 * rato (ou o foco) numa semana mostra os números dela; carregar abre-a.
 */
function GraficoDeCarga({
  semanas,
  hoje,
  onAbrir,
  altura = 260,
}: {
  semanas: SemanaDeCarga[];
  hoje: string;
  onAbrir: (day: string) => void;
  altura?: number;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(0);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLargura(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
    // A caixa só existe quando há o que desenhar: mede-se outra vez quando passa a haver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semanas.some((w) => w.treinos > 0)]);

  const [medida, setMedida] = useState<Medida>("carga");
  const [sobre, setSobre] = useState<number | null>(null);
  const gradiente = useId();

  const n = semanas.length;
  const ultima = semanas.reduce((u, w, i) => (w.treinos > 0 ? i : u), -1);
  const atual = semanas.findIndex((w) => hoje >= w.from && hoje <= w.to);

  if (ultima < 0) {
    return <p className="px-4 py-10 text-center text-meta text-ink-4">O gráfico aparece quando houver treinos marcados.</p>;
  }

  const M = { t: 30, r: 16, b: 28, l: 40 };
  const W = Math.max(largura, 320);
  const H = altura;
  const passo = n > 1 ? (W - M.l - M.r) / (n - 1) : 0;
  const x = (i: number) => (n > 1 ? M.l + i * passo : (M.l + W - M.r) / 2);
  const max = tectoRedondo(Math.max(...semanas.map((w) => w[medida])));
  const y = (v: number) => M.t + (1 - v / max) * (H - M.t - M.b);
  const chao = y(0);

  const pts = semanas.slice(0, ultima + 1).map((w, i) => [x(i), y(w[medida])] as [number, number]);
  // Até onde a linha é "já treinado": a semana de hoje, ou tudo, ou nada.
  const corte = atual >= 0 ? Math.min(atual, ultima) : hoje > semanas[n - 1].to ? ultima : 0;
  const trocos = trocosSuaves(pts);
  const caminho = (de: number, ate: number) => (ate > de ? `M${pts[de][0]} ${pts[de][1]}` + trocos.slice(de, ate).join("") : "");
  const area = (de: number, ate: number) => (ate > de ? `${caminho(de, ate)}L${pts[ate][0]} ${chao}L${pts[de][0]} ${chao}Z` : "");

  const comValor = semanas.slice(0, ultima + 1).filter((w) => w[medida] > 0);
  const media = comValor.length ? comValor.reduce((a, w) => a + w[medida], 0) / comValor.length : 0;

  // As faixas dos mesociclos: semanas seguidas do mesmo mesociclo.
  const faixas: { de: number; ate: number; nome: string; cor: string }[] = [];
  semanas.forEach((w, i) => {
    if (!w.mesoNome || !w.cor) return;
    const u = faixas[faixas.length - 1];
    if (u && u.nome === w.mesoNome && u.ate === i - 1) u.ate = i;
    else faixas.push({ de: i, ate: i, nome: w.mesoNome, cor: w.cor });
  });

  const s = sobre !== null ? semanas[sobre] : null;
  const poucas = n <= 14;

  return (
    <div className="px-4 pt-3.5 pb-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Segmented<Medida> label="O que o gráfico mostra" value={medida} onChange={setMedida} options={MEDIDAS.map(({ value, label }) => ({ value, label }))} />
        <span className="text-[11px] text-ink-4">
          {medida === "carga" ? "minutos planeados, pesados pela intensidade" : medida === "volume" ? "minutos planeados na semana" : "carga média dos treinos da semana"}
        </span>
      </div>

      <div ref={caixa} className="relative" style={{ height: H }}>
        {largura > 0 && (
          <svg width={W} height={H} className="block overflow-visible" role="img" aria-label="Carga de treino por semana">
            <defs>
              <linearGradient id={gradiente} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--color-signal)" stopOpacity="0.28" />
                <stop offset="1" stopColor="var(--color-signal)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Os mesociclos, por trás. */}
            {faixas.map((f) => {
              const x0 = Math.max(M.l, x(f.de) - passo / 2);
              const x1 = Math.min(W - M.r, x(f.ate) + passo / 2);
              return (
                <g key={`${f.nome}-${f.de}`}>
                  <rect x={x0} y={M.t - 16} width={Math.max(0, x1 - x0 - 2)} height={chao - M.t + 16} rx={6} fill={f.cor} opacity={0.07} />
                  <rect x={x0} y={M.t - 16} width={Math.max(0, x1 - x0 - 2)} height={2.5} rx={1.25} fill={f.cor} />
                  {x1 - x0 > 70 && (
                    <text x={x0 + 6} y={M.t - 3} fontSize={10} fontWeight={600} fill={f.cor}>
                      {f.nome.length > (x1 - x0) / 6.5 ? `${f.nome.slice(0, Math.floor((x1 - x0) / 6.5) - 1)}…` : f.nome}
                    </text>
                  )}
                </g>
              );
            })}

            {/* O eixo: zero, meio e o tecto. */}
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={M.l} x2={W - M.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--color-line)" strokeDasharray={f === 0 ? undefined : "3 4"} />
                <text x={M.l - 8} y={y(max * f) + 3.5} fontSize={10} textAnchor="end" fill="var(--color-ink-4)" className="tabular">
                  {Math.round(max * f)}
                </text>
              </g>
            ))}

            {/* Os meses, ou cada semana quando são poucas. */}
            {semanas.map((w, i) => {
              const mudou = i === 0 || w.from.slice(5, 7) !== semanas[i - 1].from.slice(5, 7);
              if (!poucas && !mudou) return null;
              return (
                <text key={w.from} x={x(i)} y={H - 8} fontSize={10} textAnchor={poucas ? "middle" : "start"} fill="var(--color-ink-4)">
                  {poucas ? w.rotulo.replace("Micro ", "M") : monthShort(w.from).toUpperCase()}
                </text>
              );
            })}

            {/* A média das semanas com treino. */}
            {media > 0 && (
              <g>
                <line x1={M.l} x2={W - M.r} y1={y(media)} y2={y(media)} stroke="var(--color-ink-3)" strokeOpacity={0.55} strokeDasharray="1 4" strokeLinecap="round" />
                <text x={W - M.r} y={y(media) - 5} fontSize={10} textAnchor="end" fill="var(--color-ink-3)">
                  média {Math.round(media)}
                </text>
              </g>
            )}

            {/* Hoje. */}
            {atual >= 0 && (
              <g>
                <line x1={x(atual)} x2={x(atual)} y1={M.t - 16} y2={chao} stroke="var(--color-ink)" strokeOpacity={0.35} />
                <text x={x(atual)} y={H - 8} fontSize={10} fontWeight={600} textAnchor="middle" fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth={4} paintOrder="stroke">
                  hoje
                </text>
              </g>
            )}

            {/* A área e a linha: cheia até hoje, tracejada daí para a frente. */}
            <path d={area(0, corte)} fill={`url(#${gradiente})`} />
            <path d={area(corte, ultima)} fill={`url(#${gradiente})`} opacity={0.4} />
            <path d={caminho(0, corte)} fill="none" stroke="var(--color-signal-line, var(--color-signal))" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            <path
              d={caminho(corte, ultima)}
              fill="none"
              stroke="var(--color-signal-line, var(--color-signal))"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray="2 6"
              opacity={0.85}
            />

            {/* Os pontos: a cor é o nível de carga da semana. */}
            {pts.map(([px, py], i) => {
              const w = semanas[i];
              const semPlano = w.planned === 0;
              const cor = semPlano ? "var(--color-ink-4)" : COR_DA_CARGA[loadLabel(w.score).label];
              const on = i === sobre;
              return (
                <circle
                  key={w.from}
                  cx={px}
                  cy={py}
                  r={on ? 6 : poucas ? 4.5 : 3.5}
                  fill={semPlano || i > corte ? "var(--color-surface)" : cor}
                  stroke={cor}
                  strokeWidth={semPlano || i > corte ? 2 : 1.5}
                  strokeDasharray={semPlano ? "2 2" : undefined}
                  style={{ transition: "r 120ms" }}
                />
              );
            })}

            {/* A guia da semana em foco. */}
            {sobre !== null && <line x1={x(sobre)} x2={x(sobre)} y1={M.t - 16} y2={chao} stroke="var(--color-ink-3)" strokeDasharray="3 3" pointerEvents="none" />}

            {/* Os alvos: uma coluna por semana, a altura toda. */}
            {semanas.map((w, i) => (
              <rect
                key={w.from}
                x={x(i) - Math.max(passo, 16) / 2}
                y={M.t - 16}
                width={Math.max(passo, 16)}
                height={chao - M.t + 16}
                fill="transparent"
                className="cursor-pointer outline-none"
                role="button"
                tabIndex={0}
                aria-label={`${w.rotulo}, ${rangeLabel(w.from, w.to)}: ${w.treinos} treinos, carga ${w.carga}`}
                onMouseEnter={() => setSobre(i)}
                onMouseLeave={() => setSobre(null)}
                onFocus={() => setSobre(i)}
                onBlur={() => setSobre(null)}
                onClick={() => onAbrir(w.from)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onAbrir(w.from);
                  }
                }}
              />
            ))}
          </svg>
        )}

        {/* Os números da semana em foco, ao lado da guia. */}
        {s && sobre !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-[208px] rounded-[10px] border border-line bg-surface px-3 py-2.5 shadow-[var(--shadow-pop)]"
            style={x(sobre) > W / 2 ? { right: W - x(sobre) + 12 } : { left: x(sobre) + 12 }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-meta font-semibold text-ink">{s.rotulo}</span>
              {sobre === atual && <span className="text-[10px] font-medium text-signal-ink">esta semana</span>}
            </div>
            <div className="text-[11px] text-ink-3 tabular">{rangeLabel(s.from, s.to)}</div>
            {s.mesoNome && <div className="truncate text-[11px] text-ink-3">{s.mesoNome}</div>}
            <dl className="mt-2 space-y-1 border-t border-line pt-2 text-[11px]">
              <LinhaDoBalao rotulo="Treinos" valor={`${s.treinos}${s.planned < s.treinos ? ` · ${s.treinos - s.planned} por planear` : ""}`} aviso={s.planned < s.treinos} />
              {s.planned > 0 ? (
                <>
                  <LinhaDoBalao rotulo="Carga" valor={String(s.carga)} forte={medida === "carga"} />
                  <LinhaDoBalao rotulo="Minutos" valor={`${s.volume} min`} forte={medida === "volume"} />
                  <LinhaDoBalao rotulo="Intensidade" valor={`${s.score}/100 · ${loadLabel(s.score).label.toLowerCase()}`} forte={medida === "score"} cor={COR_DA_CARGA[loadLabel(s.score).label]} />
                </>
              ) : (
                s.treinos > 0 && <p className="text-ink-4">Sem treinos planeados nesta semana.</p>
              )}
            </dl>
            <p className="mt-2 text-[10px] text-ink-4">{sobre > corte ? "Planeado para vir" : "Já treinado"} · carrega para abrir</p>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[11px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden>
            <line x1="1" x2="21" y1="3" y2="3" stroke="var(--color-signal-line, var(--color-signal))" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          já treinado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden>
            <line x1="1" x2="21" y1="3" y2="3" stroke="var(--color-signal-line, var(--color-signal))" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="2 6" />
          </svg>
          planeado para vir
        </span>
        {(Object.keys(COR_DA_CARGA) as (keyof typeof COR_DA_CARGA)[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: COR_DA_CARGA[k] }} />
            {k.toLowerCase()}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full border border-dashed border-ink-4" /> sem plano
        </span>
      </div>
    </div>
  );
}

type SerieDeEquipa = { id: string; nome: string; cor: string; semanas: Resumo[] };

/**
 * A carga de todas as equipas, semana a semana, numa linha por equipa.
 *
 * É a vista de quem coordena: ver de relance que escalão está a carregar mais,
 * e se algum ficou sem planos. Cada equipa leva a cor que tem no calendário. A
 * legenda liga e desliga equipas, para comparar duas ou três sem as outras
 * por cima.
 *
 * As semanas alternam de fundo, para se ler a que semana pertence cada ponto.
 * Depois da semana de hoje a linha passa a tracejada: é o que está planeado.
 */
function GraficoDasEquipas({
  semanas,
  series,
  hoje,
  altura = 280,
}: {
  semanas: { from: string; to: string }[];
  series: SerieDeEquipa[];
  hoje: string;
  altura?: number;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(0);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLargura(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [medida, setMedida] = useState<Medida>("carga");
  const [escondidas, setEscondidas] = useState<Set<string>>(() => new Set());
  const [sobre, setSobre] = useState<number | null>(null);

  const visiveis = series.filter((x) => !escondidas.has(x.id));
  const alternar = (id: string) =>
    setEscondidas((antes) => {
      const depois = new Set(antes);
      if (depois.has(id)) depois.delete(id);
      else depois.add(id);
      return depois;
    });

  const n = semanas.length;
  const atual = semanas.findIndex((w) => hoje >= w.from && hoje <= w.to);
  const M = { t: 12, r: 12, b: 26, l: 40 };
  const W = Math.max(largura, 320);
  const H = altura;
  const coluna = (W - M.l - M.r) / Math.max(n, 1);
  // Cada ponto fica ao meio da coluna da sua semana.
  const x = (i: number) => M.l + coluna * (i + 0.5);
  const max = tectoRedondo(Math.max(1, ...visiveis.flatMap((sr) => sr.semanas.map((w) => w[medida]))));
  const y = (v: number) => M.t + (1 - v / max) * (H - M.t - M.b);
  const chao = y(0);
  const corte = atual >= 0 ? atual : hoje > (semanas[n - 1]?.to ?? "") ? n - 1 : 0;
  const linha = (sr: SerieDeEquipa, de: number, ate: number) =>
    sr.semanas
      .slice(de, ate + 1)
      .map((w, i) => `${i === 0 ? "M" : "L"}${x(de + i)} ${y(w[medida])}`)
      .join("");

  const semDados = series.every((sr) => sr.semanas.every((w) => w.treinos === 0));
  const unidade = MEDIDAS.find((k) => k.value === medida)!.unidade;

  return (
    <div className="px-4 pt-3.5 pb-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented<Medida> label="O que o gráfico mostra" value={medida} onChange={setMedida} options={MEDIDAS.map(({ value, label }) => ({ value, label }))} />
        <span className="text-[11px] text-ink-4">
          {medida === "carga" ? "minutos planeados, pesados pela intensidade" : medida === "volume" ? "minutos planeados na semana" : "carga média dos treinos da semana"}
        </span>
      </div>

      <div ref={caixa} className="relative" style={{ height: H }}>
        {semDados ? (
          <p className="flex h-full items-center justify-center text-meta text-ink-4">O gráfico aparece quando houver treinos marcados nestas semanas.</p>
        ) : (
          largura > 0 && (
            <svg width={W} height={H} className="block overflow-visible" role="img" aria-label="Carga de treino de cada equipa, por semana">
              {/* As semanas, em faixas alternadas. */}
              {semanas.map((w, i) => (
                <rect
                  key={w.from}
                  x={M.l + coluna * i + 1}
                  y={M.t}
                  width={Math.max(0, coluna - 2)}
                  height={chao - M.t}
                  fill={i === atual ? "var(--color-signal-soft)" : "var(--color-sunken)"}
                  opacity={i === atual ? 0.9 : i % 2 === 0 ? 0.45 : 0.9}
                />
              ))}

              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <text key={f} x={M.l - 8} y={y(max * f) + 3.5} fontSize={10} textAnchor="end" fill="var(--color-ink-4)" className="tabular">
                  {Math.round(max * f)}
                </text>
              ))}

              {semanas.map((w, i) => (
                <text
                  key={w.from}
                  x={x(i)}
                  y={H - 8}
                  fontSize={10}
                  textAnchor="middle"
                  fontWeight={i === atual ? 600 : 400}
                  fill={i === atual ? "var(--color-ink)" : "var(--color-ink-4)"}
                >
                  {i === atual ? "esta semana" : `${Number(w.from.slice(8, 10))} ${monthShort(w.from)}`}
                </text>
              ))}

              {/* Uma linha por equipa: cheia até hoje, tracejada daí para a frente. */}
              {visiveis.map((sr) => (
                <g key={sr.id} fill="none" stroke={sr.cor} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                  <path d={linha(sr, 0, corte)} />
                  {corte < n - 1 && <path d={linha(sr, corte, n - 1)} strokeDasharray="1 6" />}
                  {sobre !== null && <circle cx={x(sobre)} cy={y(sr.semanas[sobre][medida])} r={4.5} fill="var(--color-surface)" />}
                </g>
              ))}

              {sobre !== null && <line x1={x(sobre)} x2={x(sobre)} y1={M.t} y2={chao} stroke="var(--color-ink-3)" strokeDasharray="3 3" pointerEvents="none" />}

              {semanas.map((w, i) => (
                <rect
                  key={w.from}
                  x={M.l + coluna * i}
                  y={M.t}
                  width={coluna}
                  height={chao - M.t}
                  fill="transparent"
                  onMouseEnter={() => setSobre(i)}
                  onMouseLeave={() => setSobre(null)}
                />
              ))}
            </svg>
          )
        )}

        {/* As equipas na semana em foco, da que mais carrega para a que menos. */}
        {sobre !== null && !semDados && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-[224px] rounded-[10px] border border-line bg-surface px-3 py-2.5 shadow-[var(--shadow-pop)]"
            style={x(sobre) > W / 2 ? { right: W - x(sobre) + 14 } : { left: x(sobre) + 14 }}
          >
            <div className="text-meta font-semibold text-ink">{rangeLabel(semanas[sobre].from, semanas[sobre].to)}</div>
            <div className="text-[10px] text-ink-4">{sobre > corte ? "planeado para vir" : sobre === atual ? "esta semana" : "já treinado"}</div>
            <dl className="mt-2 space-y-1 border-t border-line pt-2 text-[11px]">
              {[...visiveis]
                .sort((a, b) => b.semanas[sobre][medida] - a.semanas[sobre][medida])
                .map((sr) => {
                  const w = sr.semanas[sobre];
                  return (
                    <LinhaDoBalao
                      key={sr.id}
                      rotulo={sr.nome}
                      cor={sr.cor}
                      valor={w.planned > 0 ? `${w[medida]}${unidade}` : w.treinos > 0 ? "sem plano" : "—"}
                      aviso={w.planned === 0 && w.treinos > 0}
                    />
                  );
                })}
              {visiveis.length === 0 && <p className="text-ink-4">Nenhuma equipa ligada.</p>}
            </dl>
          </div>
        )}
      </div>

      {/* A legenda liga e desliga cada equipa. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
        {series.map((sr) => {
          const on = !escondidas.has(sr.id);
          return (
            <button
              key={sr.id}
              type="button"
              aria-pressed={on}
              onClick={() => alternar(sr.id)}
              className={cx(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors duration-[120ms]",
                on ? "border-line-strong text-ink" : "border-line text-ink-4 line-through decoration-ink-4/60",
              )}
            >
              <span className="size-2 rounded-full" style={{ background: on ? sr.cor : "var(--color-line-strong)" }} />
              {sr.nome}
            </button>
          );
        })}
        {series.length > 2 && (
          <button
            type="button"
            className="ml-auto text-[12px] font-medium text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            onClick={() => setEscondidas(escondidas.size > 0 ? new Set() : new Set(series.map((sr) => sr.id)))}
          >
            {escondidas.size > 0 ? "Mostrar todas" : "Esconder todas"}
          </button>
        )}
      </div>
    </div>
  );
}

function LinhaDoBalao({ rotulo, valor, forte, aviso, cor }: { rotulo: string; valor: string; forte?: boolean; aviso?: boolean; cor?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-ink-3">
        {cor && <span className="size-1.5 rounded-full" style={{ background: cor }} />}
        {rotulo}
      </dt>
      <dd className={cx("tabular", aviso ? "text-warn" : forte ? "font-semibold text-ink" : "text-ink-2")}>{valor}</dd>
    </div>
  );
}

/** Uma nota discreta, numa linha. */
function Nota({ children }: { children: ReactNode }) {
  return <p className="rounded-[12px] border border-line bg-surface px-4 py-3 text-meta leading-relaxed text-ink-3">{children}</p>;
}

/**
 * A Época de uma equipa que ainda não periodizou.
 *
 * Explica os três níveis antes de pedir o primeiro: quem nunca periodizou na
 * plataforma não sabe que criar um mesociclo traz as semanas atrás.
 */
function EpocaVazia({ nome, mayPlan, onCriar }: { nome: string; mayPlan: boolean; onCriar: () => void }) {
  const passos = [
    { titulo: "Época", texto: "O macrociclo. Já existe: é a época da equipa." },
    { titulo: "Mesociclos", texto: "As fases da época, de várias semanas: pré-época, competição, transição." },
    { titulo: "Microciclos", texto: "As semanas de cada mesociclo, cada uma com o seu objetivo e foco." },
  ];
  return (
    <Lista className="px-6 py-8">
      <div className="mx-auto max-w-[620px] text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-[12px] bg-signal-soft text-signal-ink">
          <Target className="size-5" strokeWidth={1.9} />
        </span>
        <h3 className="mt-4 text-[18px] font-semibold tracking-[-0.01em] text-ink">A época de {nome} ainda não está periodizada</h3>
        <p className="mt-1.5 text-body leading-relaxed text-ink-3">
          {mayPlan
            ? "Cria o primeiro mesociclo e as semanas dele aparecem logo, prontas a receber objetivo e foco."
            : "Quando o treinador criar os mesociclos, a época aparece aqui."}
        </p>
      </div>

      <ol className="mx-auto mt-7 grid max-w-[760px] gap-3 md:grid-cols-3">
        {passos.map((p, i) => (
          <li key={p.titulo} className="rounded-[10px] border border-line bg-sunken/40 px-4 py-3.5 text-left">
            <div className="flex items-center gap-2">
              <span className="flex size-5 items-center justify-center rounded-full bg-surface text-[11px] font-semibold text-ink-2 ring-1 ring-line">{i + 1}</span>
              <span className="text-body font-medium text-ink">{p.titulo}</span>
            </div>
            <p className="mt-1.5 text-meta leading-relaxed text-ink-3">{p.texto}</p>
          </li>
        ))}
      </ol>

      {mayPlan && (
        <div className="mt-7 flex justify-center">
          <button type="button" className="ctl-primary" onClick={onCriar}>
            <Plus className="size-3.5" strokeWidth={2} />
            Criar o primeiro mesociclo
          </button>
        </div>
      )}
    </Lista>
  );
}

/**
 * Um mesociclo e as suas semanas.
 *
 * A fase em cima, com a cor dela, as datas, o foco e o objetivo; por baixo, uma
 * linha por microciclo, que abre a semana. `meso` nulo é o grupo das semanas
 * que ficaram fora de qualquer mesociclo.
 */
function Mesociclo({
  meso,
  cor,
  micros,
  cycles,
  hoje,
  sportId,
  onAbrirMeso,
  onAbrir,
}: {
  meso: Cycle | null;
  cor: string;
  micros: Cycle[];
  cycles: Cycle[];
  hoje: string;
  sportId: string;
  /** Abrir a vista deste mesociclo. Sem isto (já lá estamos), o cartão não leva botão. */
  onAbrirMeso?: () => void;
  onAbrir: (day: string) => void;
}) {
  const categorias = categoriesFor(sportId);
  const aDecorrer = meso ? hoje >= meso.startsOn && hoje <= meso.endsOn : false;
  const ponto = (f: string) => categorias.find((x) => x.label === f)?.color.base ?? "var(--color-ink-4)";

  return (
    <Lista className="relative">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: cor }} />

      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3.5 pr-4 pl-5">
        <div className="min-w-0 flex-1 basis-[240px]">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
              {meso && onAbrirMeso ? (
                <button type="button" className="text-left hover:underline" onClick={onAbrirMeso}>
                  {meso.name ?? meso.phase ?? "Mesociclo"}
                </button>
              ) : meso ? (
                (meso.name ?? meso.phase ?? "Mesociclo")
              ) : (
                "Semanas soltas"
              )}
            </h4>
            {aDecorrer && <Pill tone="signal">A decorrer</Pill>}
          </div>
          <p className="mt-0.5 text-meta text-ink-3 tabular">
            {meso ? `${rangeLabel(meso.startsOn, meso.endsOn)} · ` : "Fora de qualquer mesociclo · "}
            {micros.length} {micros.length === 1 ? "semana" : "semanas"}
          </p>
          {meso?.objective && <p className="mt-2 text-body text-ink-2">{meso.objective}</p>}
          {meso && meso.focus.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {meso.focus.map((f) => (
                <span key={f} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-meta text-ink-2">
                  <span className="size-2 rounded-full" style={{ background: ponto(f) }} />
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
        {onAbrirMeso && (
          <button type="button" className="ctl-ghost h-8" onClick={onAbrirMeso}>
            Abrir
            <ArrowRight className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {micros.length > 0 && (
        <ul className="border-t border-line">
          {micros.map((x) => {
            const agora = hoje >= x.startsOn && hoje <= x.endsOn;
            return (
              <li key={x.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => onAbrir(x.startsOn)}
                  className={cx(
                    "group flex w-full items-center gap-3 py-2.5 pr-4 pl-5 text-left transition-colors duration-[120ms] hover:bg-sunken/50",
                    agora && "bg-signal-soft/30",
                  )}
                >
                  <span className={cx("w-[70px] shrink-0 text-meta font-semibold tabular", agora ? "text-signal-ink" : "text-ink")}>{microLabel(cycles, x)}</span>
                  <span className="w-[120px] shrink-0 text-meta text-ink-3 tabular max-md:hidden">{rangeLabel(x.startsOn, x.endsOn)}</span>
                  <span className={cx("min-w-0 flex-1 truncate text-body", x.objective ? "text-ink-2" : "text-ink-4")}>
                    {x.objective ?? "Sem objetivo definido"}
                  </span>
                  {x.focus.length > 0 && (
                    <span className="flex shrink-0 items-center gap-1 max-md:hidden" title={x.focus.join(", ")}>
                      {x.focus.slice(0, 4).map((f) => (
                        <span key={f} className="size-2 rounded-full" style={{ background: ponto(f) }} />
                      ))}
                    </span>
                  )}
                  {agora && <span className="shrink-0 text-[11px] font-medium text-signal-ink">esta semana</span>}
                  <ArrowRight className="size-3.5 shrink-0 text-ink-4 transition-transform duration-[120ms] group-hover:translate-x-0.5 group-hover:text-ink-2" strokeWidth={1.75} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Lista>
  );
}

/** O objetivo, o foco e as notas do micro, lidos de relance. */
function IntencaoDoMicro({ micro, sportId, mayEdit, onEdit }: { micro: Cycle; sportId: string; mayEdit: boolean; onEdit: () => void }) {
  const categorias = categoriesFor(sportId);
  const vazio = !micro.objective && micro.focus.length === 0 && !micro.notes;
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b border-line bg-sunken/40 px-5 py-3">
      <div className="min-w-0 flex-1 basis-[260px]">
        <div className="text-[11px] font-medium tracking-wide text-ink-4 uppercase">Objetivo</div>
        <div className={cx("mt-0.5 text-body", micro.objective ? "font-medium text-ink" : "text-ink-4")}>
          {micro.objective ?? (vazio ? "Sem objetivo definido" : "—")}
        </div>
        {micro.notes && <p className="mt-1 line-clamp-2 text-meta text-ink-3">{micro.notes}</p>}
      </div>
      {micro.focus.length > 0 && (
        <div className="min-w-0">
          <div className="text-[11px] font-medium tracking-wide text-ink-4 uppercase">Foco</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {micro.focus.map((f) => {
              const c = categorias.find((x) => x.label === f);
              return (
                <span key={f} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-meta text-ink-2">
                  <span className="size-2 rounded-full" style={{ background: c?.color.base ?? "var(--color-ink-4)" }} />
                  {f}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {mayEdit && (
        <button type="button" className="ctl-ghost h-7 self-center text-meta" onClick={onEdit}>
          <Pencil className="size-3.5" strokeWidth={1.75} />
          {vazio ? "Definir objetivo" : "Editar"}
        </button>
      )}
    </div>
  );
}

/** Um número do resumo dos treinos: o rótulo, o valor grande e uma nota. */
function NumeroDoResumo({ rotulo, valor, nota, aviso }: { rotulo: string; valor: string; nota: string; aviso?: boolean }) {
  return (
    <div className="min-w-0 border-r border-line px-4 py-3.5 last:border-r-0">
      <dt className="truncate text-meta text-ink-3">{rotulo}</dt>
      <dd className={cx("mt-1 text-[24px] leading-none font-semibold tracking-[-0.02em] tabular", aviso ? "text-warn" : "text-ink")}>{valor}</dd>
      <p className="mt-1.5 truncate text-[11px] text-ink-4">{nota}</p>
    </div>
  );
}

/** "Hoje", "Ontem", "Amanhã", ou "Quinta-feira, 2 de outubro". */
function nomeDoDia(d: Date): string {
  const k = dayKey(d);
  if (k === dayKey(today)) return "Hoje";
  if (k === dayKey(new Date(today.getTime() - 86_400_000))) return "Ontem";
  if (k === dayKey(new Date(today.getTime() + 86_400_000))) return "Amanhã";
  const texto = d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Os treinos, agrupados por dia, no desenho das Presenças.
 *
 * O dia escreve-se uma vez, por cima das linhas dele. Cada linha começa pela
 * hora, diz a equipa e o que está planeado, e acaba na carga (ou em "Por
 * planear"). A linha inteira abre o plano do treino.
 */
function TreinosPorDia({
  sessions,
  planOf,
  cores,
  mostrarEquipa,
  vazio,
}: {
  sessions: TrainingSession[];
  planOf: Map<string, PlanSummary>;
  cores: ReturnType<typeof useTeamColors>;
  mostrarEquipa: boolean;
  vazio: { titulo: string; texto: string };
}) {
  const navigate = useNavigate();

  if (sessions.length === 0) {
    return (
      <Lista className="px-6 py-12 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-[12px] bg-sunken text-ink-3">
          <ClipboardCheck className="size-5" strokeWidth={1.75} />
        </span>
        <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.01em] text-ink">{vazio.titulo}</h3>
        <p className="mx-auto mt-1 max-w-[420px] text-meta leading-relaxed text-ink-3">{vazio.texto}</p>
      </Lista>
    );
  }

  const grupos: { dia: string; data: Date; itens: TrainingSession[] }[] = [];
  for (const x of sessions) {
    const d = new Date(x.start);
    const k = dayKey(d);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === k) ultimo.itens.push(x);
    else grupos.push({ dia: k, data: d, itens: [x] });
  }

  return (
    <div className="space-y-5">
      {grupos.map((g) => (
        <div key={g.dia}>
          <div className="mb-2 flex items-baseline gap-2 px-1">
            <h3 className="text-meta font-semibold text-ink">{nomeDoDia(g.data)}</h3>
            {["Hoje", "Ontem", "Amanhã"].includes(nomeDoDia(g.data)) && (
              <span className="text-[11px] text-ink-4">
                {dayShort(g.data)} {g.data.getDate()}
              </span>
            )}
          </div>
          <Lista>
            <ul>
              {g.itens.map((x) => {
                const pl = planOf.get(x.id);
                const load = pl ? sessionLoad(pl.blocks, pl.intensity) : null;
                return (
                  <li key={x.id} className="border-b border-line last:border-b-0">
                    <button
                      type="button"
                      onClick={() => navigate(`/treinos/${x.id}`)}
                      className="group flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors duration-[120ms] hover:bg-sunken/50"
                    >
                      <span className="w-12 shrink-0 font-mono text-body text-ink-2 tabular">{time(new Date(x.start))}</span>
                      <div className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          {mostrarEquipa && (
                            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: cores.get(x.teamId)?.base ?? "var(--color-line-strong)" }} />
                          )}
                          <span className="truncate text-body font-medium text-ink">{mostrarEquipa ? (x.teamName ?? "Treino") : "Treino"}</span>
                        </span>
                        <div className="mt-0.5 truncate text-meta text-ink-3">
                          {pl ? [`${pl.blockCount} blocos`, `${load!.volume} min`, pl.objective].filter(Boolean).join(" · ") : x.venue}
                        </div>
                      </div>
                      {pl ? <Pill tone={load!.tone}>{load!.label}</Pill> : <Pill tone="warn">Por planear</Pill>}
                      <ArrowRight className="size-3.5 shrink-0 text-ink-4 transition-transform duration-[120ms] group-hover:translate-x-0.5 group-hover:text-ink-2" strokeWidth={1.75} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Lista>
        </div>
      ))}
    </div>
  );
}

function sessionLoadNote(score: number): string {
  if (score < 40) return "carga baixa";
  if (score < 60) return "carga moderada";
  if (score < 80) return "carga alta";
  return "carga muito alta";
}

/** Uma época sem datas na base: "2026/27" é de 1 de agosto a 31 de julho. */
function epocaPeloRotulo(label: string): { startsOn: string; endsOn: string } | null {
  const y = Number(label.slice(0, 4));
  if (!Number.isFinite(y) || y < 2000) return null;
  return { startsOn: `${y}-08-01`, endsOn: `${y + 1}-07-31` };
}

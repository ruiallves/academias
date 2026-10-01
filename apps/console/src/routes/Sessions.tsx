import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { PersonLink } from "@/components/PersonLink";
import { Bar, Monogram, Pill, cx } from "@/components/primitives";
import { Segmented } from "@/components/filters";
import { Lista } from "@/components/definicoes/ui";
import { EquipasRail } from "@/components/EquipasRail";
import { AttendanceDialog } from "@/components/AttendanceDialog";
import { ArrowRight, CalendarDays, CircleCheck, ClipboardCheck, Clock, History } from "@/lib/icons";
import { attendanceRate, coachById, listSessions, listTeams, teamById, today, unrecordedSessions } from "@/lib/api";
import { useAttendanceRecords } from "@/lib/attendance";
import { useTeamColors } from "@/lib/calendar";
import { dayShort, percent, time } from "@/lib/format";
import { can, isAcademyWide } from "@/lib/permissions";
import type { TrainingSession } from "@/data/types";
import { useSession } from "@/session";

type Vista = "registar" | "registados" | "seguir";

/**
 * Presenças.
 *
 * ## O que mudou neste ecrã, e porquê
 *
 * Tinha quatro números em caixas, a lista do que faltava registar e, lado a
 * lado, o histórico e os próximos treinos: três perguntas diferentes na mesma
 * página, de todas as equipas misturadas. Quem vinha registar um treino tinha
 * de o encontrar no meio do resto.
 *
 * Agora segue o desenho do Planeamento e das Definições:
 *
 *  - **As equipas ficam à esquerda.** A página abre em todas (o trabalho de
 *    registar atravessa equipas), e um clique fica só com uma.
 *  - **Uma vista de cada vez**, por ordem de urgência: *Por registar* (o
 *    trabalho), *Registados* (conferir e corrigir) e *A seguir* (o que vem aí).
 *    A vista e a equipa vivem no endereço.
 *  - **Os números numa linha só**, por cima das vistas, em vez de quatro caixas.
 *  - **As listas agrupam-se por dia**, com o dia escrito uma vez.
 *
 * ## Um treino sem registo não é um treino sem faltas
 *
 * A distinção atravessa o produto: uma lista de faltas vazia significa "estiveram
 * todos", `attendance` ausente significa "ninguém verificou". A primeira conta para
 * a assiduidade; a segunda aparece aqui como trabalho por fazer.
 */
export default function Sessions() {
  const { session } = useSession();
  const oversight = isAcademyWide(session);
  const [recording, setRecording] = useState<TrainingSession | null>(null);
  const [params, setParams] = useSearchParams();
  const cores = useTeamColors(session);

  // Subscrever o armazém faz a lista redesenhar-se assim que um registo é guardado.
  useAttendanceRecords();

  const equipas = listTeams(session);
  const teamParam = params.get("equipa");
  const teamId = teamParam && equipas.some((t) => t.id === teamParam) ? teamParam : "";
  const team = teamId ? teamById(teamId) : undefined;
  const daEquipa = (s: TrainingSession) => !teamId || s.teamId === teamId;

  const vistaParam = params.get("vista");
  const vista: Vista = vistaParam === "registados" || vistaParam === "seguir" ? vistaParam : "registar";

  const from = new Date(today.getTime() - 30 * 86_400_000);
  const to = new Date(today.getTime() + 14 * 86_400_000);
  const all = listSessions(session, from, to).filter(daEquipa);
  const pending = unrecordedSessions(session).filter(daEquipa);
  const rate = attendanceRate(session, 30, teamId || undefined);
  const mayRecord = can(session, "attendance:write");

  const { registados, proximos } = useMemo(() => {
    const done = all
      .filter((s) => s.attendance && s.status !== "cancelled")
      .sort((a, b) => b.start.localeCompare(a.start));
    const next = all
      .filter((s) => new Date(s.start) >= today && s.status !== "cancelled")
      .sort((a, b) => a.start.localeCompare(b.start));
    return { registados: done, proximos: next };
  }, [all]);

  const semana = all.filter((s) => {
    const d = new Date(s.start);
    return d >= new Date(today.getTime() - 7 * 86_400_000) && d <= today && s.status !== "cancelled";
  });

  function escolherEquipa(id: string) {
    const p = new URLSearchParams(params);
    if (id) p.set("equipa", id);
    else p.delete("equipa");
    setParams(p, { replace: true });
  }
  function irPara(v: Vista) {
    const p = new URLSearchParams(params);
    if (v === "registar") p.delete("vista");
    else p.set("vista", v);
    setParams(p);
  }

  const todasLabel = oversight ? "Todas as equipas" : "As minhas equipas";
  const atrasados = pending.filter((s) => diasDesde(new Date(s.start)) >= 7).length;

  return (
    <>
      <PageHeader
        title="Presenças"
        subtitle={
          oversight
            ? "Cada treino sem registo é um buraco no relatório do atleta."
            : "Regista no fim do treino: os pais veem no mesmo dia."
        }
      />

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

        {/* ------------------------------------------------------------ as presenças */}
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
              <Numero rotulo="Presença média" valor={rate !== null ? percent(rate) : "—"} nota="últimos 30 dias">
                {rate !== null && <Bar value={rate} tone={tomDaPresenca(rate)} />}
              </Numero>
              <Numero
                rotulo="Por registar"
                valor={String(pending.length)}
                nota={pending.length === 0 ? "está tudo em dia" : atrasados > 0 ? `${atrasados} há mais de uma semana` : "dos últimos dias"}
                tom={atrasados > 0 ? "risk" : pending.length > 0 ? "warn" : undefined}
              />
              <Numero rotulo="Treinos na semana" valor={String(semana.length)} nota="últimos 7 dias" />
              <Numero rotulo="A seguir" valor={String(proximos.length)} nota="próximos 14 dias" />
            </dl>
          </Lista>

          <div className="mb-4">
            <Segmented<Vista>
              size="md"
              label="Vista"
              value={vista}
              onChange={irPara}
              options={[
                { value: "registar", label: "Por registar", icon: ClipboardCheck, count: pending.length || undefined },
                { value: "registados", label: "Registados", icon: History },
                { value: "seguir", label: "A seguir", icon: CalendarDays },
              ]}
            />
          </div>

          {vista === "registar" && (
            <PorRegistar sessions={pending} mayRecord={mayRecord} onRecord={setRecording} mostrarEquipa={!team} cores={cores} />
          )}
          {vista === "registados" && (
            <Registados sessions={registados} onOpen={mayRecord ? setRecording : undefined} mostrarEquipa={!team} cores={cores} />
          )}
          {vista === "seguir" && <ASeguir sessions={proximos} mostrarEquipa={!team} cores={cores} />}
        </section>
      </div>

      {recording && <AttendanceDialog training={recording} session={session} onClose={() => setRecording(null)} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Peças                                                                       */
/* -------------------------------------------------------------------------- */

type Cores = ReturnType<typeof useTeamColors>;

const diasDesde = (d: Date) => Math.floor((today.getTime() - d.getTime()) / 86_400_000);
const tomDaPresenca = (r: number) => (r >= 0.85 ? "ok" : r >= 0.7 ? "signal" : "warn") as "ok" | "signal" | "warn";
const chaveDoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "Hoje", "Ontem", "Amanhã", ou "quinta-feira, 2 de outubro". */
function nomeDoDia(d: Date): string {
  const k = chaveDoDia(d);
  if (k === chaveDoDia(today)) return "Hoje";
  if (k === chaveDoDia(new Date(today.getTime() - 86_400_000))) return "Ontem";
  if (k === chaveDoDia(new Date(today.getTime() + 86_400_000))) return "Amanhã";
  const texto = d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** As sessões por dia, pela ordem em que chegam. */
function porDia(sessions: TrainingSession[]): { dia: string; data: Date; itens: TrainingSession[] }[] {
  const grupos: { dia: string; data: Date; itens: TrainingSession[] }[] = [];
  for (const s of sessions) {
    const d = new Date(s.start);
    const k = chaveDoDia(d);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === k) ultimo.itens.push(s);
    else grupos.push({ dia: k, data: d, itens: [s] });
  }
  return grupos;
}

/** Um número do resumo: o rótulo, o valor grande e uma nota. */
function Numero({
  rotulo,
  valor,
  nota,
  tom,
  children,
}: {
  rotulo: string;
  valor: string;
  nota: string;
  tom?: "warn" | "risk";
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 border-line px-4 py-3.5 max-md:border-b max-md:odd:border-r max-md:[&:nth-last-child(-n+2)]:border-b-0 md:border-r md:last:border-r-0">
      <dt className="truncate text-meta text-ink-3">{rotulo}</dt>
      <dd className={cx("mt-1 text-[24px] leading-none font-semibold tracking-[-0.02em] tabular", tom === "risk" ? "text-risk" : tom === "warn" ? "text-warn" : "text-ink")}>
        {valor}
      </dd>
      {children && <div className="mt-2 max-w-[120px]">{children}</div>}
      <p className="mt-1.5 truncate text-[11px] text-ink-4">{nota}</p>
    </div>
  );
}

/** O título de um dia, por cima das linhas desse dia. */
function Dia({ data, nota }: { data: Date; nota?: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2 px-1">
      <h3 className="text-meta font-semibold text-ink">{nomeDoDia(data)}</h3>
      {nota && <span className="text-[11px] text-ink-4">{nota}</span>}
    </div>
  );
}

/** A equipa de uma linha, com o ponto da cor que tem no calendário. */
function NomeDaEquipa({ teamId, cores, mostrar }: { teamId: string; cores: Cores; mostrar: boolean }) {
  const team = teamById(teamId);
  return (
    <span className="flex min-w-0 items-center gap-2">
      {mostrar && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: cores.get(teamId)?.base ?? "var(--color-line-strong)" }} />}
      <span className="truncate text-body font-medium text-ink">{team?.name ?? "Treino"}</span>
    </span>
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

/* -------------------------------------------------------------------------- */
/* Por registar — o trabalho                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A lista de tarefas, do mais antigo para o mais recente.
 *
 * A linha inteira é o alvo de clique. O atraso está escrito por extenso ("há 6
 * dias") porque é isso que decide por onde começar: um treino de ontem
 * lembra-se, um de há duas semanas já não. Fica vermelho a partir de uma semana.
 */
function PorRegistar({
  sessions,
  mayRecord,
  onRecord,
  mostrarEquipa,
  cores,
}: {
  sessions: TrainingSession[];
  mayRecord: boolean;
  onRecord: (s: TrainingSession) => void;
  mostrarEquipa: boolean;
  cores: Cores;
}) {
  if (sessions.length === 0) {
    return <Vazio ok icone={CircleCheck} titulo="Não há treinos por registar" texto="Tudo o que já aconteceu tem presenças lançadas." />;
  }

  const ordered = [...sessions].sort((a, b) => a.start.localeCompare(b.start));

  return (
    <div className="space-y-5">
      {porDia(ordered).map((g) => {
        const dias = diasDesde(g.data);
        return (
          <div key={g.dia}>
            <Dia data={g.data} nota={dias >= 2 ? `há ${dias} dias` : undefined} />
            <Lista>
              <ul>
                {g.itens.map((s) => {
                  const d = new Date(s.start);
                  const coachName = s.coachName ?? (s.coachId ? coachById(s.coachId)?.name : undefined);
                  const avisos = s.notices?.length ?? 0;

                  const linha = (
                    <>
                      <span className="w-12 shrink-0 font-mono text-body text-ink-2 tabular">{time(d)}</span>
                      <div className="min-w-0 flex-1">
                        <NomeDaEquipa teamId={s.teamId} cores={cores} mostrar={mostrarEquipa} />
                        <div className="mt-0.5 truncate text-meta text-ink-3">
                          {[s.venue, coachName?.split(" ")[0]].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      {/*
                        O que as famílias já disseram sobre este treino: um treino
                        com três avisos regista-se em metade do tempo.
                      */}
                      {avisos > 0 && <Pill tone="signal">{avisos === 1 ? "1 aviso de falta" : `${avisos} avisos de falta`}</Pill>}
                      {dias >= 7 && <span className="shrink-0 text-meta font-medium text-risk max-md:hidden">em atraso</span>}
                      {mayRecord && (
                        <span className="ctl-outline pointer-events-none shrink-0 group-hover:border-ink-3">
                          <ClipboardCheck className="size-3.5" strokeWidth={1.75} />
                          Registar
                        </span>
                      )}
                    </>
                  );

                  return (
                    <li key={s.id} className="border-b border-line last:border-b-0">
                      {mayRecord ? (
                        <button
                          type="button"
                          onClick={() => onRecord(s)}
                          className="group flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors duration-[120ms] hover:bg-sunken/50"
                        >
                          {linha}
                        </button>
                      ) : (
                        <div className="flex items-center gap-3.5 px-4 py-3">{linha}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Lista>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Registados — o histórico                                                    */
/* -------------------------------------------------------------------------- */

function Registados({
  sessions,
  onOpen,
  mostrarEquipa,
  cores,
}: {
  sessions: TrainingSession[];
  onOpen?: (s: TrainingSession) => void;
  mostrarEquipa: boolean;
  cores: Cores;
}) {
  if (sessions.length === 0) {
    return <Vazio icone={ClipboardCheck} titulo="Ainda sem registos" texto="Os treinos com presenças lançadas nos últimos 30 dias aparecem aqui." />;
  }

  return (
    <div className="space-y-5">
      {porDia(sessions).map((g) => (
        <div key={g.dia}>
          <Dia data={g.data} />
          <Lista>
            <ul>
              {g.itens.map((s) => {
                const d = new Date(s.start);
                const team = teamById(s.teamId);

                // O total vem do plantel, não do registo: guardamos faltas, e os
                // presentes são tudo o resto.
                const total = team?.athleteIds.length ?? 0;
                const faltas = s.attendance?.absences.filter((x) => x.kind !== "late").length ?? 0;
                const atrasos = s.attendance?.absences.filter((x) => x.kind === "late").length ?? 0;
                const presentes = Math.max(0, total - faltas);
                const r = total ? presentes / total : 0;

                const linha = (
                  <>
                    <span className="w-12 shrink-0 font-mono text-body text-ink-2 tabular">{time(d)}</span>
                    <div className="min-w-0 flex-1">
                      <NomeDaEquipa teamId={s.teamId} cores={cores} mostrar={mostrarEquipa} />
                      <div className="mt-0.5 truncate text-meta text-ink-3">
                        {faltas === 0 ? "Estiveram todos" : faltas === 1 ? "1 falta" : `${faltas} faltas`}
                        {atrasos > 0 && ` · ${atrasos === 1 ? "1 atraso" : `${atrasos} atrasos`}`}
                      </div>
                    </div>
                    <div className="flex w-[150px] shrink-0 items-center gap-2.5 max-md:w-[96px]">
                      <span className="flex-1 max-md:hidden">
                        <Bar value={r} tone={tomDaPresenca(r)} />
                      </span>
                      <span className="w-[86px] shrink-0 text-right text-meta text-ink-2 tabular">
                        {presentes}/{total}
                        <span className="text-ink-4"> · {percent(r)}</span>
                      </span>
                    </div>
                    {onOpen && (
                      <ArrowRight className="size-3.5 shrink-0 text-ink-4 transition-transform duration-[120ms] group-hover:translate-x-0.5 group-hover:text-ink-2" strokeWidth={1.75} />
                    )}
                  </>
                );

                return (
                  <li key={s.id} className="border-b border-line last:border-b-0">
                    {onOpen ? (
                      <button
                        type="button"
                        onClick={() => onOpen(s)}
                        title="Corrigir o registo"
                        className="group flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors duration-[120ms] hover:bg-sunken/50"
                      >
                        {linha}
                      </button>
                    ) : (
                      <div className="flex items-center gap-3.5 px-4 py-3">{linha}</div>
                    )}
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

/* -------------------------------------------------------------------------- */
/* A seguir                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Os próximos treinos.
 *
 * Sem ação nenhuma: não há nada a registar num treino que ainda não aconteceu.
 * Está aqui para responder a "o que vem aí". Um treino sem treinador atribuído
 * aparece marcado: é um problema que se resolve antes do dia, não depois.
 */
function ASeguir({ sessions, mostrarEquipa, cores }: { sessions: TrainingSession[]; mostrarEquipa: boolean; cores: Cores }) {
  if (sessions.length === 0) {
    return <Vazio icone={Clock} titulo="Sem treinos agendados" texto="Os treinos marcados para os próximos 14 dias aparecem aqui." />;
  }

  return (
    <div className="space-y-5">
      {porDia(sessions).map((g) => (
        <div key={g.dia}>
          <Dia data={g.data} nota={["Hoje", "Amanhã"].includes(nomeDoDia(g.data)) ? `${dayShort(g.data)} ${g.data.getDate()}` : undefined} />
          <Lista>
            <ul>
              {g.itens.map((s) => {
                const d = new Date(s.start);
                /*
                 * O nome vem com a sessão, e só se recorre à lista de staff para
                 * obter a ligação para a ficha. Um treinador não tem `staff:read`:
                 * essa lista chega-lhe vazia, e procurar lá primeiro dizia "sem
                 * treinador" nos treinos do próprio treinador que os estava a ver.
                 */
                const coach = s.coachId ? coachById(s.coachId) : undefined;
                const coachName = s.coachName ?? coach?.name;

                return (
                  <li key={s.id} className="flex items-center gap-3.5 border-b border-line px-4 py-3 last:border-b-0">
                    <span className="w-12 shrink-0 font-mono text-body text-ink-2 tabular">{time(d)}</span>
                    <div className="min-w-0 flex-1">
                      <NomeDaEquipa teamId={s.teamId} cores={cores} mostrar={mostrarEquipa} />
                      {s.venue && <div className="mt-0.5 truncate text-meta text-ink-3">{s.venue}</div>}
                    </div>
                    {coachName ? (
                      <span className="flex shrink-0 items-center gap-1.5">
                        <Monogram name={coachName} size="sm" />
                        <PersonLink id={coach?.id} name={coachName} short className="text-meta text-ink-3" />
                      </span>
                    ) : (
                      <Pill tone="risk">sem treinador</Pill>
                    )}
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

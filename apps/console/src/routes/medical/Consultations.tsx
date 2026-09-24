import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Metric, MetricRow, Monogram, Panel, Pill, type Column } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Toolbar } from "@/components/filters";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Plus, Stethoscope, X } from "@/lib/icons";
import { ClinicalEntryDialog } from "@/components/ClinicalEntryDialog";
import { ConsultasMes, corDaConsulta } from "@/components/ConsultasMes";
import { dayKey } from "@/lib/calendar";
import { useCatalog } from "@/lib/catalogs";
import { listAthletes, teamById, today } from "@/lib/api";
import { areaLabel, clinicalOf, isConsulta, isoToday, useClinicalRecords } from "@/lib/clinical";
import { monthName, relativeDays, shortDate, shortName } from "@/lib/format";
import { can, isAcademyWide } from "@/lib/permissions";
import { useSession } from "@/session";
import type { ClinicalEntry } from "@/data/types";

type Row = { athleteId: string; athleteName: string; teamName: string; entry: ClinicalEntry };
type Filter = "todas" | "agendadas" | "resposta" | "realizadas";
type View = "calendario" | "lista";

/** Uma consulta por acontecer — é o que "Agendar consulta" cria. */
const agendada = (e: ClinicalEntry) => e.status === "scheduled";
/** Pediu-se confirmação e quem responde ainda não disse nada. */
const semResposta = (e: ClinicalEntry) => agendada(e) && !!e.confirmationRequired && !e.reply;

/* A vista escolhida fica neste browser. Sem armazenamento (janela privada), abre no calendário. */
const VISTA = "consultas:vista";
const lerVista = (): View => {
  try {
    return localStorage.getItem(VISTA) === "lista" ? "lista" : "calendario";
  } catch {
    return "calendario";
  }
};

/**
 * Consultas: o que o departamento clínico marca e o que já deu.
 *
 * Existe separado de "Boletins" porque responde a outra pergunta: os boletins são
 * "quem está parado?", isto é "quem está a ser acompanhado e quando?". Os tipos
 * são os do clube (catálogo `consultationTypes`, nas Definições).
 *
 * Abre no calendário do mês; a lista fica a um clique. Clicar numa consulta abre
 * a página dela (`ConsultationDetail`), onde se escrevem as notas.
 */
export default function MedicalConsultations() {
  const { session } = useSession();
  const [filter, setFilter] = useState<Filter>("todas");
  const [query, setQuery] = useState("");
  /* `true` abre com a data de hoje; uma data é o dia escolhido no calendário. */
  const [composing, setComposing] = useState<string | true | null>(null);
  const [view, setViewState] = useState<View>(lerVista);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const navigate = useNavigate();
  const podeAgendar = can(session, "clinical:write");
  const tipos = useCatalog("consultationTypes");

  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VISTA, v);
    } catch {
      /* Sem armazenamento, a escolha vale até sair da página. */
    }
  };

  useClinicalRecords();

  const all = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const a of listAthletes(session)) {
      for (const entry of clinicalOf(a.id)) {
        /*
         * Tudo o que não é lesão nem nota solta, e tudo o que está agendado.
         * Quem agenda daqui tem de ver o que agendou, seja de que tipo for.
         */
        if (agendada(entry) || isConsulta(entry)) {
          out.push({ athleteId: a.id, athleteName: a.name, teamName: teamById(a.teamId)?.name ?? "", entry });
        }
      }
    }
    return out.sort((x, y) => y.entry.date.localeCompare(x.entry.date));
  }, [session]);

  const hoje = isoToday();
  const fimDaSemana = (() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 7);
    return dayKey(d);
  })();

  const counts = {
    todas: all.length,
    agendadas: all.filter((r) => agendada(r.entry) && r.entry.date >= hoje).length,
    semana: all.filter((r) => agendada(r.entry) && r.entry.date >= hoje && r.entry.date < fimDaSemana).length,
    resposta: all.filter((r) => semResposta(r.entry) && r.entry.date >= hoje).length,
    recusadas: all.filter((r) => agendada(r.entry) && r.entry.reply === "declined" && r.entry.date >= hoje).length,
    realizadas: all.filter((r) => r.entry.status === "done").length,
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((r) =>
        filter === "todas"
          ? true
          : filter === "agendadas"
            ? agendada(r.entry)
            : filter === "resposta"
              ? semResposta(r.entry)
              : r.entry.status === "done",
      )
      .filter((r) => (q ? r.athleteName.toLowerCase().includes(q) : true));
  }, [all, filter, query]);

  /* O mês à vista: a grelha mostra seis semanas, a contagem só as do mês. */
  const prefixoDoMes = dayKey(cursor).slice(0, 7);
  const doMes = rows.filter((r) => r.entry.date.startsWith(prefixoDoMes));
  const areasDoMes = [...new Map(doMes.map((r) => [areaLabel(r.entry, tipos), corDaConsulta(r.entry, tipos)])).entries()];
  const mudarMes = (dir: 1 | -1) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + dir, 1));
  const abrir = (r: Row) => navigate(`/clinico/consultas/${r.entry.id}`);

  const columns: Column<Row>[] = [
    {
      key: "athlete",
      header: "Atleta",
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Monogram name={r.athleteName} />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{shortName(r.athleteName)}</div>
            <div className="text-meta text-ink-3">{r.teamName}</div>
          </div>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Tipo",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <span className="size-2 shrink-0 rounded-full" style={{ background: corDaConsulta(r.entry, tipos).base }} aria-hidden />
          {areaLabel(r.entry, tipos)}
        </span>
      ),
    },
    {
      key: "title",
      header: "Consulta",
      hideBelow: "md",
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate text-ink">{r.entry.title}</div>
          {r.entry.location && <div className="truncate text-meta text-ink-3">{r.entry.location}</div>}
        </div>
      ),
    },
    {
      key: "state",
      header: "Estado",
      render: (r) => <EstadoDaConsulta entry={r.entry} />,
    },
    {
      key: "date",
      header: "Data",
      align: "right",
      render: (r) => (
        <div>
          <div className="text-meta text-ink-2 tabular">
            {shortDate(new Date(r.entry.date))}
            {r.entry.time ? ` · ${r.entry.time}` : ""}
          </div>
          <div className="text-[11px] text-ink-4">{relativeDays(new Date(r.entry.date), today)}</div>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Consultas"
        subtitle={
          isAcademyWide(session)
            ? "O que o departamento clínico marca e acompanha, em toda a academia."
            : "O que o departamento clínico marca e acompanha, dos teus atletas."
        }
      >
        {podeAgendar && (
          <button type="button" onClick={() => setComposing(true)} className="ctl-primary">
            <Plus className="size-3.5" strokeWidth={2} />
            Agendar consulta
          </button>
        )}
      </PageHeader>

      <div className="space-y-3">
        <MetricRow>
          <Metric label="Agendadas" value={String(counts.agendadas)} icon={CalendarDays} note="de hoje em diante" />
          <Metric label="Esta semana" value={String(counts.semana)} icon={Stethoscope} note="nos próximos 7 dias" />
          <Metric label="Por responder" value={String(counts.resposta)} icon={Clock} note="pediu-se confirmação" />
          <Metric label="Não vão" value={String(counts.recusadas)} icon={X} note="a família recusou" />
        </MetricRow>

        <Panel>
          <Toolbar>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: "todas", label: "Todas", count: counts.todas },
                { value: "agendadas", label: "Agendadas", count: all.filter((r) => agendada(r.entry)).length },
                { value: "resposta", label: "Por responder", count: all.filter((r) => semResposta(r.entry)).length },
                { value: "realizadas", label: "Realizadas", count: counts.realizadas },
              ]}
            />
            <SearchInput value={query} onChange={setQuery} placeholder="Procurar atleta…" />
            <ResultCount n={view === "lista" ? rows.length : doMes.length} noun={["consulta", "consultas"]} />
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "calendario", label: "Calendário" },
                { value: "lista", label: "Lista" },
              ]}
            />
          </Toolbar>

          {view === "calendario" ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => mudarMes(-1)} className="ctl-outline size-8 justify-center px-0" aria-label="Mês anterior">
                    <ChevronLeft className="size-4" strokeWidth={1.75} />
                  </button>
                  <button type="button" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))} className="ctl-outline">
                    Hoje
                  </button>
                  <button type="button" onClick={() => mudarMes(1)} className="ctl-outline size-8 justify-center px-0" aria-label="Mês seguinte">
                    <ChevronRight className="size-4" strokeWidth={1.75} />
                  </button>
                  <h2 className="ml-1.5 text-panel text-ink">
                    {capitalize(monthName(cursor))} de {cursor.getFullYear()}
                  </h2>
                </div>

                {/* A legenda das cores: uma por tipo, os que aparecem neste mês. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {areasDoMes.map(([rotulo, c]) => {
                    return (
                      <span
                        key={rotulo}
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium"
                        style={{ background: c.soft, color: c.ink }}
                      >
                        <span className="size-2 shrink-0 rounded-full" style={{ background: c.base }} aria-hidden />
                        {rotulo}
                      </span>
                    );
                  })}
                </div>
              </div>

              <ConsultasMes
                anchor={cursor}
                items={rows}
                rotulo={(e) => areaLabel(e, tipos)}
                cor={(e) => corDaConsulta(e, tipos)}
                onAdd={podeAgendar ? (day) => setComposing(dayKey(day)) : undefined}
                onSelect={abrir}
              />
            </>
          ) : (
            <DataTable
              columns={columns}
              rows={rows}
              keyOf={(r) => r.entry.id}
              to={(r) => `/clinico/consultas/${r.entry.id}`}
              empty={<Empty icon={Stethoscope} title="Sem consultas neste filtro" />}
            />
          )}
        </Panel>
      </div>

      {composing && (
        <ClinicalEntryDialog
          session={session}
          variant="consulta"
          defaultDate={composing === true ? undefined : composing}
          onClose={() => setComposing(null)}
        />
      )}
    </>
  );
}

/**
 * O estado de uma consulta numa pastilha: realizada, desmarcada, ou marcada com
 * a resposta da família quando se pediu confirmação.
 */
export function EstadoDaConsulta({ entry }: { entry: ClinicalEntry }) {
  if (entry.status === "done") return <Pill tone="ok">Realizada</Pill>;
  if (entry.status === "cancelled") return <Pill>Desmarcada</Pill>;
  if (entry.confirmationRequired) {
    if (entry.reply === "confirmed") return <Pill tone="ok">Confirmada</Pill>;
    if (entry.reply === "declined") return <Pill tone="risk">Não vai</Pill>;
    return <Pill tone="warn">Por responder</Pill>;
  }
  return <Pill tone="signal">Agendada</Pill>;
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

import { Link } from "react-router-dom";
import { useState } from "react";
import { PageHeader } from "@/components/Shell";
import { NewTeamDialog } from "@/components/NewTeamDialog";
import { ImportTeamsDialog } from "@/components/ImportTeamsDialog";
import { Bar, cx, Monogram, Panel, Pill } from "@/components/primitives";
import { ArrowRight, Plus, Upload } from "@/lib/icons";
import { attendanceRate, coachById, listAthletes, listTeams, sportById } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import type { Team } from "@/data/types";

const WEEKDAY = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * Equipas em grelha, não em tabela.
 *
 * Uma equipa não é uma linha de dados — é um horário, um treinador e um plantel.
 * Isso são três formas diferentes de informação e uma tabela obrigaria as três a
 * caber numa célula. É a excepção à regra "a tabela é o cavalo de batalha".
 */
export default function Teams() {
  const { session } = useSession();
  const teams = listTeams(session);
  const athletes = listAthletes(session);
  const mine = !can(session, "team:write");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  return (
    <>
      <PageHeader
        title="Equipas"
        subtitle={mine ? "As equipas de que és responsável" : `${teams.length} equipas activas na época 2026/27`}
      >
        {can(session, "team:write") && (
          <>
            {/* Importar antes de criar: um clube que está a arrancar traz as
                equipas de uma folha, e criar uma a uma é o caminho lento. */}
            <button type="button" onClick={() => setImporting(true)} className="ctl-outline">
              <Upload className="size-3.5" strokeWidth={1.75} />
              Importar
            </button>
            <button type="button" onClick={() => setCreating(true)} className="ctl-primary">
              <Plus className="size-3.5" strokeWidth={2} />
              Nova equipa
            </button>
          </>
        )}
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {teams.map((team) => (
          <TeamCard key={team.id} team={team} count={athletes.filter((a) => a.teamId === team.id).length} />
        ))}
      </div>

      {creating && <NewTeamDialog session={session} onClose={() => setCreating(false)} />}
      {importing && <ImportTeamsDialog onClose={() => setImporting(false)} />}
    </>
  );
}

function TeamCard({ team, count }: { team: Team; count: number }) {
  const { session } = useSession();
  const sport = sportById(team.sportId);
  const coaches = team.coachIds.map(coachById).filter(Boolean);
  const rate = attendanceRate(session, 30, team.id);

  return (
    <Panel className="group flex flex-col">
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5">
            <Pill tone="signal">{sport?.name}</Pill>
            <span className="text-meta text-ink-3">{team.ageGroup}</span>
          </div>
          <h3 className="truncate text-panel text-ink">{team.name}</h3>
        </div>
        <span className="shrink-0 text-right">
          <span className="block text-[22px] leading-none font-semibold text-ink tabular">{count}</span>
          <span className="block text-[11px] text-ink-3">atletas</span>
        </span>
      </div>

      {/* Horário — a informação que um treinador procura primeiro. */}
      <div className="flex flex-wrap gap-1.5 px-4 pb-3">
        {team.schedule.map((slot, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-[6px] border border-line bg-sunken/50 px-1.5 py-1 text-[11px] text-ink-2"
          >
            <span className="font-semibold text-ink">{WEEKDAY[slot.weekday]}</span>
            <span className="font-mono tabular">{slot.start}</span>
            <span className="text-ink-4">{slot.venue}</span>
          </span>
        ))}
      </div>

      {rate !== null && (
        <div className="flex items-center gap-2.5 px-4 pb-3">
          <span className="w-20 shrink-0 text-meta text-ink-3">Presenças</span>
          <Bar value={rate} tone={rate >= 0.85 ? "ok" : rate >= 0.7 ? "signal" : "warn"} />
          <span className="w-9 shrink-0 text-right text-meta font-semibold text-ink tabular">
            {Math.round(rate * 100)}%
          </span>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex -space-x-1.5">
            {coaches.map((c) => (
              <span key={c!.id} className="ring-2 ring-surface rounded-full">
                <Monogram name={c!.name} photoUrl={c!.photoUrl} size="sm" />
              </span>
            ))}
          </div>
          <span className="truncate text-meta text-ink-3">
            {coaches.map((c) => c!.name.split(" ")[0]).join(", ")}
          </span>
        </div>

        <Link
          to={`/equipas/${team.id}`}
          className={cx(
            "inline-flex items-center gap-1 text-meta font-medium text-ink-2 transition-colors duration-[120ms]",
            "hover:text-ink",
          )}
        >
          Abrir
          <ArrowRight className="size-3.5 transition-transform duration-[120ms] group-hover:translate-x-0.5" strokeWidth={1.75} />
        </Link>
      </div>
    </Panel>
  );
}

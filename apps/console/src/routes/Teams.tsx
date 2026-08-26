import { Link } from "react-router-dom";
import { useState } from "react";
import { PageHeader } from "@/components/Shell";
import { NewTeamDialog } from "@/components/NewTeamDialog";
import { ImportTeamsDialog } from "@/components/ImportTeamsDialog";
import { Empty, Monogram, Panel } from "@/components/primitives";
import { ArrowRight, Clock, Plus, Shield, Upload } from "@/lib/icons";
import { academy, attendanceRate, coachById, listAthletes, listTeams, sportById } from "@/lib/api";
import { useTeamColors } from "@/lib/calendar";
import type { CategoricalColor } from "@academia/ui/tokens";
import { currentSeason } from "@/lib/store";
import { teamAgeLabel } from "@/lib/team-age";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import type { Team } from "@/data/types";

/*
 * Três letras, sempre — em português as iniciais não chegam.
 *
 * A primeira versão disto abreviava dias múltiplos a uma letra para caberem
 * ("S·Q·S"), e isso é ilegível na nossa língua: Segunda, Sexta, Sábado e Domingo
 * partilham iniciais, e Quarta com Quinta também. "S·Q·S" tanto pode ser
 * Seg/Qua/Sex como Sáb/Qui/Sex. Três letras são inequívocas e continuam a caber.
 */
const WEEKDAY = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * Equipas em grelha, não em tabela.
 *
 * Uma equipa não é uma linha de dados — é um horário, um treinador e um plantel.
 * Isso são três formas diferentes de informação e uma tabela obrigaria as três a
 * caber numa célula. É a excepção à regra "a tabela é o cavalo de batalha".
 *
 * ## O que mudou nesta lista, e porquê
 *
 * Estava carregada. Cada cartão tinha, de uma vez: uma pastilha colorida com a
 * modalidade, o escalão, o nome, um número grande, três a quatro **caixas com
 * moldura** para o horário (cada uma com dia + hora + local), uma barra de
 * presenças com a palavra "Presenças" a ocupar um quinto da largura, e um rodapé
 * com avatares, nomes e um link "Abrir". Dezoito fragmentos de texto por cartão,
 * num ecrã que costuma mostrar oito cartões — e nenhum deles a dominar.
 *
 * O que se corrigiu:
 *
 *  - **O cartão inteiro é o alvo.** Era um `<Link>` de doze pixels no canto, com
 *    o resto do cartão inerte — a falha de usabilidade mais séria da página. Um
 *    cartão que parece clicável tem de ser clicável, todo ele.
 *  - **Uma faixa de cor à esquerda** substitui a pastilha da modalidade. A cor
 *    vem de `useTeamColors`, a mesma que o calendário já usa para esta equipa —
 *    por isso "a barra verde" é a mesma equipa nos dois ecrãs. E a modalidade só
 *    se escreve quando o clube tem **mais do que uma**: num clube só de futebol
 *    aquela pastilha era idêntica em todos os cartões, ou seja, ruído puro.
 *  - **O horário numa linha.** "Ter · Qui · 18:00 · Campo 1" em vez de três
 *    caixas com moldura. A moldura de cada caixa era mais pesada do que o texto
 *    lá dentro.
 *  - **As presenças perderam o rótulo.** Um anel fino ao lado da percentagem diz
 *    o mesmo que uma barra com a palavra "Presenças" à frente, e ocupa um terço.
 *  - **Uma hierarquia a sério.** O nome da equipa é o herói (18px, semibold); o
 *    resto desce para metadados. Antes o número de atletas competia com o nome.
 */
export default function Teams() {
  const { session } = useSession();
  const teams = listTeams(session);
  const athletes = listAthletes(session);
  const cores = useTeamColors(session);
  const mine = !can(session, "team:write");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  /*
   * A modalidade só se mostra quando há mais do que uma.
   *
   * Um clube só de futebol via "Futebol" escrito em todos os cartões — a mesma
   * palavra oito vezes não distingue nada, só enche. Com duas modalidades passa
   * a ser a diferença que interessa, e volta a aparecer.
   */
  const varias = academy.sports.length > 1;

  return (
    <>
      <PageHeader
        title="Equipas"
        /* A época vem do servidor. Estava escrita à mão — "2026/27" — e ia
           continuar a dizê-lo em 2029. */
        subtitle={
          mine
            ? "As equipas de que és responsável"
            : `${teams.length} ${teams.length === 1 ? "equipa activa" : "equipas activas"}${currentSeason ? ` na época ${currentSeason}` : ""}`
        }
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

      {teams.length === 0 ? (
        <Panel>
          <Empty
            icon={Shield}
            title={mine ? "Ainda não és responsável por nenhuma equipa" : "Ainda não há equipas"}
            detail={
              mine
                ? "Quando a direção te atribuir uma equipa, ela aparece aqui."
                : "Cria a primeira — é a partir dela que se organizam atletas, horários e convocatórias."
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              count={athletes.filter((a) => a.teamId === team.id).length}
              cor={cores.get(team.id)}
              mostrarModalidade={varias}
            />
          ))}
        </div>
      )}

      {creating && <NewTeamDialog onClose={() => setCreating(false)} />}
      {importing && <ImportTeamsDialog onClose={() => setImporting(false)} />}
    </>
  );
}

function TeamCard({
  team,
  count,
  cor,
  mostrarModalidade,
}: {
  team: Team;
  count: number;
  cor?: CategoricalColor;
  mostrarModalidade: boolean;
}) {
  const { session } = useSession();
  const sport = sportById(team.sportId);
  const coaches = team.coachIds.map(coachById).filter(Boolean);
  const rate = attendanceRate(session, 30, team.id);

  return (
    <Link
      to={`/equipas/${team.id}`}
      /*
        O cartão inteiro é o alvo — não um link de doze pixels no canto.
        `group` para a seta responder ao hover do cartão todo, e não só a si.
      */
      className="group relative block overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface transition-[border-color,box-shadow] duration-[140ms] hover:border-line-strong hover:shadow-[var(--shadow-pop)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-signal)]"
    >
      {/*
        A faixa de identidade.
        Mesma cor que o calendário dá a esta equipa (`useTeamColors`), por isso
        "a barra âmbar" é a mesma equipa nos dois ecrãs. Substituiu a pastilha da
        modalidade, que em clubes de uma modalidade era idêntica em todo o lado.
      */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: cor?.base ?? "var(--color-line)" }}
      />

      <div className="pl-[19px] pr-4 pt-4 pb-3.5">
        {/* --- Nome + plantel ------------------------------------------- */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[17px] leading-tight font-semibold tracking-[-0.01em] text-ink">
              {team.name}
            </h3>
            <p className="mt-1 truncate text-meta text-ink-3">
              {teamAgeLabel(team.maxAge)}
              {mostrarModalidade && sport?.name && ` · ${sport.name}`}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-[19px] leading-none font-semibold tabular text-ink">{count}</div>
            <div className="mt-0.5 text-[11px] text-ink-3">{count === 1 ? "atleta" : "atletas"}</div>
          </div>
        </div>

        {/* --- Horário, numa linha -------------------------------------- */}
        <div className="mt-3.5 min-h-5">
          {team.schedule.length > 0 ? (
            <p className="flex items-center gap-1.5 truncate text-meta text-ink-2">
              <Clock className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
              <span className="truncate">{resumoHorario(team.schedule)}</span>
            </p>
          ) : (
            <p className="text-meta text-ink-4">Sem horário definido</p>
          )}
        </div>
      </div>

      {/* --- Rodapé: quem treina, e como corre ------------------------- */}
      <div className="flex items-center gap-3 border-t border-line py-2.5 pl-[19px] pr-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {coaches.length > 0 ? (
            <>
              <div className="flex -space-x-1.5">
                {coaches.slice(0, 3).map((c) => (
                  <span key={c!.id} className="rounded-full ring-2 ring-surface">
                    <Monogram name={c!.name} photoUrl={c!.photoUrl} size="sm" />
                  </span>
                ))}
              </div>
              <span className="truncate text-meta text-ink-3">
                {coaches.map((c) => c!.name.split(" ")[0]).join(", ")}
              </span>
            </>
          ) : (
            /* Uma equipa sem treinador é um facto accionável, não um espaço em
               branco — a Visão geral conta-o em "Precisa de atenção". */
            <span className="text-meta text-warn">Sem treinador</span>
          )}
        </div>

        {rate !== null && <PresencaAnel rate={rate} />}

        <ArrowRight
          className="size-4 shrink-0 text-ink-4 transition-transform duration-[140ms] group-hover:translate-x-0.5 group-hover:text-ink-2"
          strokeWidth={1.75}
        />
      </div>
    </Link>
  );
}

/**
 * As presenças, num anel de 20px.
 *
 * Era uma barra horizontal com a palavra "Presenças" à frente — três elementos e
 * um quinto da largura do cartão para dizer um número de dois dígitos. O anel
 * mostra a proporção pela forma e o valor pelo texto ao lado, no espaço de um
 * ícone. O `title` diz o que é, para quem não deduzir do contexto.
 */
function PresencaAnel({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const cor = rate >= 0.85 ? "var(--color-ok)" : rate >= 0.7 ? "var(--color-signal)" : "var(--color-warn)";

  return (
    <span className="flex shrink-0 items-center gap-1.5" title={`${pct}% de presenças nos últimos 30 dias`}>
      <span
        className="relative flex size-5 items-center justify-center rounded-full"
        style={{ background: `conic-gradient(${cor} ${rate * 360}deg, var(--color-line) 0deg)` }}
        aria-hidden
      >
        <span className="size-[13px] rounded-full bg-surface" />
      </span>
      <span className="text-meta font-medium tabular text-ink-2">{pct}%</span>
    </span>
  );
}

/**
 * O horário numa frase.
 *
 * Eram três caixas com moldura, cada uma com dia + hora + local — nove
 * fragmentos para dizer "às terças e quintas, às seis, no Campo 1". Quando os
 * treinos partilham hora e local (o caso normal), agrupam-se: os dias juntam-se e
 * a hora diz-se uma vez. Quando não partilham, cada treino fica com a sua parte,
 * separadas por vírgula.
 */
function resumoHorario(schedule: Team["schedule"]): string {
  const porSitio = new Map<string, { dias: number[]; start: string; venue: string }>();

  for (const s of schedule) {
    const chave = `${s.start}|${s.venue}`;
    const existente = porSitio.get(chave);
    if (existente) existente.dias.push(s.weekday);
    else porSitio.set(chave, { dias: [s.weekday], start: s.start, venue: s.venue });
  }

  return [...porSitio.values()]
    .map((g) => {
      const dias = g.dias
        .sort((a, b) => a - b)
        .map((d) => WEEKDAY[d])
        .join("·");
      return [dias, g.start, g.venue].filter(Boolean).join(" · ");
    })
    .join("  |  ");
}

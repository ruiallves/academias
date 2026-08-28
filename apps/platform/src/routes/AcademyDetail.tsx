import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { ClubMark, Empty, Metric, MetricRow, Panel, PanelHead, Pill, Progress } from "@/components/primitives";
import { ActivityChart } from "@/components/Charts";
import { euros, shortDate, since } from "@/lib/format";
import { useApi } from "@/lib/query";
import { STATUS_LABEL, type AcademyDetail as Detail, type AcademyStatus } from "@/lib/types";

const TONE: Record<AcademyStatus, "neutral" | "ok" | "warn" | "risk" | "signal"> = {
  SETUP: "signal",
  TRIAL: "warn",
  ACTIVE: "ok",
  PAST_DUE: "risk",
  CANCELLED: "neutral",
};

/** Os papéis, ditos como quem os lê. O painel não fala em enums. */
const ROLE_LABEL: Record<string, string> = {
  OWNER: "Presidência",
  DIRECTOR: "Direção",
  COORDINATOR: "Coordenação",
  COACH: "Treinadores",
  MEDICAL: "Clínico",
  SCOUT: "Scouting",
  STAFF: "Operações",
};

/**
 * A ficha de um clube.
 *
 * ## A pergunta que a lista não responde
 *
 * A tabela das Academias existe para **comparar trinta**: uma linha cada, tudo
 * alinhado, o olho a correr por uma coluna. Esta página existe para **decidir
 * sobre um**: telefonar, ajudar a arrancar, ou propor um plano acima. São duas
 * perguntas diferentes, e por isso não são o mesmo ecrã com mais colunas.
 *
 * ## A ordem é a da conversa
 *
 * Primeiro quem lá está agora e quanta gente é o clube — é o que se quer saber
 * antes de ligar. Depois se as famílias entraram mesmo na app, que é a métrica
 * de adopção que separa um cliente que assinou de um cliente que usa. Depois a
 * actividade semana a semana, que é o preditor de renovação. Por fim as equipas e
 * a cobrança, que são o detalhe de quem já decidiu olhar com atenção.
 *
 * ## O que continua de fora
 *
 * Nomes de atletas, contactos, seja o que for de clínico. Isto são contagens — e
 * os nomes das equipas, que não são de ninguém. A fronteira é a mesma de
 * `docs/04-plataforma.md`, e não se atravessa por ser cómodo.
 */
export default function AcademyDetail() {
  const { id = "" } = useParams();
  const ficha = useApi<Detail>(`/academies/${id}`);

  if (ficha.loading) return <Skeleton />;
  if (ficha.error) return <Falhou message={ficha.error} onRetry={ficha.reload} />;

  const d = ficha.data!;
  const { people, app, online, billing } = d;
  const maiorEquipa = Math.max(1, ...d.teamsBreakdown.map((t) => t.athletes));

  return (
    <>
      <Link to="/academias" className="mb-3 inline-flex items-center gap-1.5 text-meta text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" strokeWidth={1.75} />
        Academias
      </Link>

      {/*
        O emblema ao lado do nome, como na lista. Numa plataforma com trinta
        clubes é por ele que se sabe, de relance, em qual se está.
      */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ClubMark name={d.name} logoUrl={d.logoUrl} color={d.signalColor} size={40} />
          <div className="min-w-0">
            <h1 className="truncate text-page text-ink">{d.name}</h1>
            <p className="mt-0.5 truncate font-mono text-[12px] text-ink-4">{d.slug}.academias.pt</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Pill tone={TONE[d.status]}>{STATUS_LABEL[d.status]}</Pill>
          <span className="text-meta text-ink-3">
            {d.plan ?? "Sem plano"}
            {d.subscriptionStatus === "ACTIVE" ? " · a pagar" : d.plan ? " · por activar" : ""}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {/*
          O contacto, antes dos números.

          É a primeira coisa que se procura nesta página: quem é a pessoa deste
          clube. O email é `mailto:` porque a acção que se segue a olhar para ele
          é escrever-lhe — e copiá-lo à mão de um painel é trabalho que o painel
          podia poupar.
        */}
        {d.contact && (
          <Panel>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold tracking-[0.06em] text-ink-4 uppercase">
                  Contacto inicial
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-body font-medium text-ink">{d.contact.name}</span>
                  {d.contact.title && <span className="text-meta text-ink-3">{d.contact.title}</span>}
                  {/*
                    Um convite por resgatar não é um contacto estabelecido: a
                    pessoa recebeu um email e pode nunca o ter aberto. Dizê-lo
                    aqui é a diferença entre um cliente a arrancar e um cliente
                    que ficou pelo caminho no primeiro passo.
                  */}
                  {!d.contact.accepted && <Pill tone="warn">convite por aceitar</Pill>}
                </div>
                <a
                  href={`mailto:${d.contact.email}`}
                  className="mt-0.5 inline-block truncate font-mono text-[12px] text-ink-3 hover:text-ink hover:underline"
                >
                  {d.contact.email}
                </a>
              </div>
              <span className="shrink-0 text-meta text-ink-4">desde {shortDate(d.contact.since)}</span>
            </div>
          </Panel>
        )}

        <MetricRow>
          <Metric
            label="Atletas"
            value={String(people.athletes)}
            note={people.athletesLeft > 0 ? `${people.athletesLeft} já saíram` : "inscritos"}
          />
          <Metric label="Equipas" value={String(people.teams)} note={`${people.coaches} treinadores`} />
          <Metric label="Staff" value={String(people.staff)} note="com conta activa" />
          <Metric label="Famílias" value={String(people.guardians)} note="encarregados com conta" />
        </MetricRow>

        <div className="grid gap-3 xl:grid-cols-2">
          {/*
            Adopção. É a métrica que separa um cliente que assinou de um cliente
            que usa: uma academia com trinta famílias e três apps instaladas está
            a usar metade do produto, e essa metade é a que se vê em casa.
          */}
          <Panel>
            <PanelHead title="A app das famílias" hint="quem já a tem a funcionar" />
            <div className="p-5">
              <div className="flex items-baseline gap-2">
                <span className="text-[26px] leading-none font-semibold text-ink tabular">{app.percent}%</span>
                <span className="text-meta text-ink-3">
                  {app.installed} de {app.total} {app.total === 1 ? "família" : "famílias"}
                </span>
              </div>
              <div className="mt-3">
                <Progress percent={app.percent} />
              </div>
              <p className="mt-2.5 text-meta leading-relaxed text-ink-3">
                Conta quem já abriu a app ou tem notificações ligadas. Abaixo de metade, vale uma chamada: o
                clube está a pagar por uma peça que as famílias não estão a usar.
              </p>
            </div>
          </Panel>

          {/* Quem lá está agora — a única leitura em tempo real do painel. */}
          <Panel>
            <PanelHead title="Online agora" hint="nos últimos dois minutos" />
            <div className="flex">
              <Metric label="Consola" value={String(online.staff)} note="staff do clube" />
              <Metric label="App" value={String(online.family)} note="famílias" />
              <Metric
                label="Última actividade"
                value={online.total > 0 ? "agora" : since(d.lastActivity ?? null)}
                note="folhas de presença fechadas"
              />
            </div>
          </Panel>
        </div>

        {/*
          O sinal de vida, semana a semana.

          Folhas de presença **fechadas** — não treinos marcados. Marcar é uma
          intenção; fechar a folha é alguém no campo com o telemóvel na mão. É o
          melhor preditor de renovação que este produto tem, e oito semanas
          chegam para ver uma queda antes de ela virar cancelamento.
        */}
        <Panel>
          <PanelHead title="Actividade" hint="presenças registadas, últimas 8 semanas" />
          <ActivityChart data={d.activity} />
        </Panel>

        <div className="grid gap-3 xl:grid-cols-2">
          <Panel>
            <PanelHead title="Equipas" hint={`${d.teamsBreakdown.length}`} />
            {d.teamsBreakdown.length === 0 ? (
              <Empty title="Ainda não há equipas" detail="O clube ainda não passou deste passo do arranque." />
            ) : (
              <ul className="p-5 pt-4">
                {d.teamsBreakdown.map((t) => (
                  <li key={t.id} className="mb-3 last:mb-0">
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="truncate text-body text-ink">{t.name}</span>
                      <span className="shrink-0 text-meta text-ink-3 tabular">
                        {t.athletes} {t.athletes === 1 ? "atleta" : "atletas"}
                        {t.coaches > 0 && <span className="text-ink-4"> · {t.coaches} treino</span>}
                      </span>
                    </div>
                    {/*
                      A barra é relativa à maior equipa e não ao total: o que se
                      lê aqui é a forma do clube — onde está o peso do plantel —
                      e não a percentagem de cada escalão.
                    */}
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round((t.athletes / maiorEquipa) * 100)}%`,
                          background: t.athletes === 0 ? "var(--color-line-strong)" : "var(--color-signal)",
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="space-y-3">
            <Panel>
              <PanelHead title="Staff" hint="por área" />
              {d.staffByRole.length === 0 ? (
                <Empty title="Ninguém ainda" detail="O clube não tem staff com conta activa." />
              ) : (
                <ul>
                  {d.staffByRole.map((r) => (
                    <li
                      key={r.role}
                      className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-2.5 last:border-b-0"
                    >
                      <span className="text-body text-ink-2">{ROLE_LABEL[r.role] ?? r.role}</span>
                      <span className="text-body font-medium text-ink tabular">{r.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/*
              A cobrança **do clube às famílias** — não a nossa.

              Interessa por uma razão: um clube que emite mensalidades todos os
              meses está agarrado ao produto de uma maneira que nenhuma outra
              métrica mostra. Quem parou de cobrar já saiu, só ainda não disse.
            */}
            <Panel>
              <PanelHead title="Mensalidades do clube" hint={billing.period} />
              <div className="flex">
                <Metric
                  label="Emitidas"
                  value={String(billing.issued)}
                  note={billing.periods > 0 ? `${billing.periods} ${billing.periods === 1 ? "mês" : "meses"} emitidos` : "nunca emitiu"}
                />
                <Metric label="Pagas" value={String(billing.paid)} note={`de ${billing.issued}`} />
                <Metric
                  label="Cobrado"
                  value={euros(billing.collectedCents)}
                  note={`de ${euros(billing.billedCents)}`}
                />
              </div>
            </Panel>
          </div>
        </div>

        <p className="px-1 text-[11px] text-ink-4">
          Clube criado a {shortDate(d.createdAt)}
          {d.trialEndsAt ? ` · avaliação até ${shortDate(d.trialEndsAt)}` : ""}
        </p>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function Skeleton() {
  return (
    <>
      <PageHeader title="A carregar…" />
      <div className="space-y-3">
        <div className="panel h-[92px] animate-pulse" />
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="panel h-[190px] animate-pulse" />
          <div className="panel h-[190px] animate-pulse" />
        </div>
      </div>
    </>
  );
}

function Falhou({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Panel>
      <div className="px-5 py-14 text-center">
        <p className="text-body font-medium text-ink">Não foi possível carregar a ficha</p>
        <p className="mt-1 text-meta text-ink-3">{message}</p>
        <button type="button" onClick={onRetry} className="ctl-outline mt-4">
          Tentar outra vez
        </button>
      </div>
    </Panel>
  );
}

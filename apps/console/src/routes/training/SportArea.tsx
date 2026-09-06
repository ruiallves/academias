import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, cx } from "@/components/primitives";
import { ArrowRight, Plus, TriangleAlert } from "@/lib/icons";
import { listTeams } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { MODULES, moduleOf, modulePath, sportAreaById, sportPath, type ModuleKey, type SportProfile } from "@/lib/sports";
import { EMPTY_SUMMARY, technicalSummary, type ModuleSummary, type TechnicalSummary } from "@/lib/training";
import { useSession } from "@/session";
import { SportAreaContext, useSportArea } from "./sport-area-context";
import Exercises from "./Exercises";
import ExerciseDetail from "./ExerciseDetail";
import GameModels, { GameModelDetail } from "./GameModels";
import SetPieces, { SetPieceDetail } from "./SetPieces";

/**
 * A Área técnica de uma modalidade — `/modalidades/:sportId`.
 *
 * ## O que isto é
 *
 * A rota que veste as três páginas da área técnica com a modalidade em que
 * estão. Resolve a modalidade pelo id, encontra-lhe o perfil (`lib/sports.ts`)
 * e põe os dois num contexto; as páginas por baixo — a biblioteca, os
 * sistemas, as situações — perguntam-lhe o que precisam: rótulos, vocabulário,
 * caminhos. Sem perfil não há área: a natação existe como modalidade, mas não
 * tem biblioteca de exercícios, e a rota di-lo em vez de mostrar um ecrã vazio.
 *
 * ## A entrada e os módulos
 *
 * A entrada (`SportHome`) é a capa da modalidade. Dentro de um módulo, uma
 * barra fina no topo (`SportBar`) diz onde se está e deixa saltar entre os três
 * sem voltar atrás.
 *
 * Os caminhos dos módulos são os do perfil (`/sistemas-jogo` no basquetebol,
 * `/modelos-jogo` no futebol) e resolvem-se para a mesma página: ver
 * `SportModule`. Um caminho que o perfil não conhece volta à entrada.
 */
export default function SportArea() {
  const { sportId = "", module } = useParams();
  // A modalidade vem do arranque; se ainda não chegou, isto volta a correr.
  useStore();
  const area = sportAreaById(sportId);

  if (!area) {
    return (
      <Panel>
        <Empty
          title="Esta modalidade não tem área técnica"
          detail="A área técnica existe para futebol, futsal e basquetebol. Nas Definições, escolhe a disciplina da modalidade — é ela que a liga aos exercícios, aos sistemas e às situações de jogo."
          icon={TriangleAlert}
        >
          <Link to="/definicoes" className="ctl-outline">
            Abrir as Definições
          </Link>
        </Empty>
      </Panel>
    );
  }

  const { sport, profile } = area;
  const value = {
    sport,
    profile,
    home: sportPath(sport.id),
    path: (m: ModuleKey, id?: string) => modulePath(sport.id, profile, m, id),
  };

  return (
    <SportAreaContext.Provider value={value}>
      {module && <SportBar />}
      <Outlet />
    </SportAreaContext.Provider>
  );
}

/**
 * A barra de um módulo: a modalidade à esquerda (volta à capa) e os três
 * módulos como pílulas, a acesa é a página actual. Fica acima do cabeçalho da
 * página, para a hierarquia se ler de cima para baixo — a modalidade, o
 * módulo, e só depois o título.
 */
function SportBar() {
  const { sport, profile, home, path } = useSportArea();
  const Icon = profile.icon;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <Link
        to={home}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-meta font-semibold text-ink transition-colors hover:border-line-strong"
      >
        <Icon className="size-3.5 text-ink-3" strokeWidth={1.75} />
        {sport.name}
      </Link>
      <span className="mx-1 h-5 w-px bg-line" />
      {MODULES.map((m) => (
        <NavLink
          key={m}
          to={path(m)}
          className={({ isActive }) =>
            cx(
              "inline-flex h-8 items-center rounded-full px-3 text-meta font-medium transition-colors",
              isActive ? "bg-ink text-surface" : "bg-sunken text-ink-2 hover:text-ink",
            )
          }
        >
          {profile[m].label}
        </NavLink>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A capa                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A entrada da modalidade.
 *
 * ## Duas tentativas antes desta
 *
 * A primeira era um emoji no título e três cartões iguais com um círculo verde
 * cada: podia ser a entrada de qualquer coisa, e nada ali dizia *futebol*.
 *
 * A segunda tentou resolver isso com **imagens** — o campo da modalidade em
 * grande no cabeçalho e o desenho mais recente em cada cartão. Falhou pior. Um
 * campo de futebol chapado a ocupar um terço do ecrã não é identidade, é um
 * cartaz; e um módulo ainda vazio mostrava um rectângulo de relva sem nada em
 * cima, três vezes seguidas. A página ficou alta, esparsa e ruidosa, com muito
 * pixel a dizer pouco.
 *
 * ## O que ela é agora
 *
 * O que a consola é em todo o lado: **texto bem posto e hairlines**. Cabeçalho
 * normal, três cartões baixos lado a lado, e dentro de cada um o que interessa
 * saber antes de entrar — quanto lá está, para que serve, e o que lá entrou por
 * último. A identidade da modalidade não precisa de um desenho: está no nome em
 * cima, nos rótulos dos módulos (uns dizem *Bolas paradas*, outros *Situações
 * especiais*) e no ícone de cada um.
 *
 * Os nomes recentes são o detalhe que faz a diferença entre uma página de
 * navegação e uma página viva: "Rondo 5v2 · Posse 6v4" diz que a biblioteca é
 * do clube e diz onde se ficou da última vez.
 */
export function SportHome() {
  const { sport, profile, path } = useSportArea();
  const { session } = useSession();
  const mayWrite = can(session, "training:write");
  const teams = listTeams(session).filter((t) => t.sportId === sport.id);

  const [summary, setSummary] = useState<TechnicalSummary | null>(null);

  useEffect(() => {
    setSummary(null);
    technicalSummary(sport.id)
      .then(setSummary)
      .catch(() => setSummary(EMPTY_SUMMARY));
  }, [sport.id]);

  const dados: Record<ModuleKey, ModuleSummary | null> = {
    exercises: summary?.exercises ?? null,
    playbook: summary?.gameModels ?? null,
    situations: summary?.setPieces ?? null,
  };
  const total = summary
    ? summary.exercises.count + summary.gameModels.count + summary.setPieces.count
    : null;

  return (
    <>
      <PageHeader eyebrow="Área técnica" title={sport.name} subtitle={profile.tagline}>
        {mayWrite && (
          <Link to={path("exercises", "novo")} className="ctl-primary">
            <Plus className="size-3.5" strokeWidth={1.75} />
            Novo exercício
          </Link>
        )}
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        {MODULES.map((m) => (
          <ModuleCard key={m} module={m} profile={profile} data={dados[m]} to={path(m)} />
        ))}
      </div>

      {/*
        As equipas, em rodapé e não em destaque: é contexto — *isto é o futebol
        do Sub-11 ao Sub-19* — e não trabalho a fazer. Em cima roubava a
        atenção aos módulos, que são o que se veio cá buscar.
      */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-meta text-ink-3">
        {teams.length === 0 ? (
          <>
            <span>Ainda não há equipas nesta modalidade.</span>
            <Link to="/equipas" className="font-medium text-signal-ink hover:underline">
              Criar equipa
            </Link>
          </>
        ) : (
          <>
            <span className="text-ink-4">
              {teams.length === 1 ? "1 equipa" : `${teams.length} equipas`}
            </span>
            <span className="text-ink-4">·</span>
            <span className="min-w-0 truncate">{teams.map((t) => t.name).join(", ")}</span>
          </>
        )}
        {total === 0 && mayWrite && (
          <>
            <span className="text-ink-4">·</span>
            <span>A área técnica está por começar — o primeiro exercício desenha-se em minutos.</span>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Um módulo: quanto lá está, para que serve, e o que lá entrou por último.
 *
 * O número manda no cartão — é a resposta a *há trabalho feito aqui?* — e por
 * isso ocupa a linha de cima sozinho, com o ícone do outro lado. A descrição
 * serve quem entra pela primeira vez; os nomes recentes servem quem já cá
 * andou, e é a única parte que muda de dia para dia.
 */
function ModuleCard({
  module,
  profile,
  data,
  to,
}: {
  module: ModuleKey;
  profile: SportProfile;
  data: ModuleSummary | null;
  to: string;
}) {
  const mod = profile[module];
  const Icon = mod.icon;
  const vazio = data?.count === 0;

  return (
    <Link
      to={to}
      className="panel group flex flex-col gap-3 p-5 transition-colors hover:border-line-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-[10px] bg-sunken text-ink-2 transition-colors group-hover:bg-signal-soft group-hover:text-signal-ink">
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
        {/* `leading-none` alinha o número pelo topo do ícone; sem isso o
            espaço interno da linha empurrava-o meio pixel para baixo. */}
        <span className={cx("text-metric leading-none tabular", vazio ? "text-ink-4" : "text-ink")}>
          {data ? data.count : "—"}
        </span>
      </div>

      <div className="min-w-0">
        <h2 className="text-body font-semibold text-ink group-hover:underline">{mod.label}</h2>
        <p className="mt-1 text-meta leading-relaxed text-ink-3">{mod.description}</p>
      </div>

      {/*
        `mt-auto` cola o rodapé ao fundo: os três cartões têm descrições de
        comprimentos diferentes, e sem isto as três linhas de recentes ficavam
        a alturas diferentes umas das outras.
      */}
      <div className="mt-auto flex items-center gap-2 border-t border-line pt-2.5">
        <span className="min-w-0 flex-1 truncate text-meta text-ink-4">
          {!data ? "" : data.recent.length > 0 ? data.recent.join(" · ") : `Sem ${mod.label.toLowerCase()} ainda`}
        </span>
        <ArrowRight
          className="size-4 shrink-0 text-ink-4 transition-transform duration-[160ms] group-hover:translate-x-0.5"
          strokeWidth={1.75}
        />
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Os módulos                                                                  */
/* -------------------------------------------------------------------------- */

/** `/modalidades/:sportId/:module` — a página de lista do módulo com esse caminho. */
export function SportModule() {
  const { profile, home } = useSportArea();
  const { module } = useParams();
  const key = moduleOf(profile, module);
  if (!key) return <Navigate to={home} replace />;
  if (key === "exercises") return <Exercises />;
  if (key === "playbook") return <GameModels />;
  return <SetPieces />;
}

/** `/modalidades/:sportId/:module/:id` — a ficha. `novo` é a criação, e pede escrita. */
export function SportModuleDetail() {
  const { profile, home, path } = useSportArea();
  const { module, id = "" } = useParams();
  const { session } = useSession();
  const key = moduleOf(profile, module);
  if (!key) return <Navigate to={home} replace />;
  if (key === "exercises") {
    if (id === "novo" && !can(session, "training:write")) return <Navigate to={path("exercises")} replace />;
    return <ExerciseDetail />;
  }
  if (key === "playbook") return <GameModelDetail />;
  return <SetPieceDetail />;
}

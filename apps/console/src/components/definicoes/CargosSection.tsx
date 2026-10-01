import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DeleteDepartmentDialog, DepartmentDialog } from "@/components/DepartmentDialog";
import { DeleteRoleDialog } from "@/components/DeleteRoleDialog";
import { RoleDialog } from "@/components/RoleDialog";
import { Dialog } from "@/components/Dialog";
import { Pill, cx } from "@/components/primitives";
import { Erro, Lista } from "@/components/definicoes/ui";
import { Pencil, Plus, Trash2, Users } from "@/lib/icons";
import { AREAS, CLINICAL_AREAS, SCOUTING_AREAS, levelOf, type Area } from "@/lib/access";
import { SCOPE_LABEL, loadDepartments, useDepartments, type Department } from "@/lib/departments";
import { can, type Permission } from "@/lib/permissions";
import { loadRoles, useRoles, type AcademyRole } from "@/lib/roles";
import { reloadAcademy } from "@/lib/store";
import { useMobile } from "@/lib/viewport";
import { useSession } from "@/session";

/**
 * Departamentos, cargos e o que cada cargo pode.
 *
 * ## A terceira forma disto, e porque mudou outra vez
 *
 * Já foi uma lista plana de cargos, depois uma árvore, depois uma pilha de
 * caixas (uma por departamento) com uma matriz de permissões ao fundo. A pilha
 * arrumava bem **o que existe**, e respondia mal à pergunta que traz alguém
 * aqui: *"o que é que o treinador pode fazer?"*. A resposta estava numa coluna
 * de uma tabela com noventa células, no fim da página, a seguir a todas as
 * caixas.
 *
 * Agora é o desenho de quem escolhe uma coisa para olhar para ela: **a
 * estrutura do clube à esquerda, o cargo escolhido à direita**. A estrutura é
 * curta e cabe inteira — departamentos, e os cargos de cada um por baixo. O
 * cargo escolhido diz, por palavras e em três colunas, o que edita, o que só vê
 * e ao que não chega. A matriz continua a existir, a um clique ("Comparar
 * cargos"), para a pergunta que ela responde bem e que é outra: *"quem é que vê
 * as mensalidades?"*.
 *
 * Um departamento também se escolhe: mostra o alcance da área e os cargos lá
 * dentro. A diferença entre departamento e cargo — que foi sempre a confusão
 * deste ecrã — passou a ser a posição: os departamentos são os títulos da
 * lista, os cargos são as linhas recolhidas por baixo.
 */

type Escolha = { tipo: "cargo" | "dep"; id: string };

const GRUPOS: { nome: string; areas: Area[] }[] = [
  { nome: "Clube", areas: AREAS },
  { nome: "Clínico", areas: CLINICAL_AREAS },
  { nome: "Scouting", areas: SCOUTING_AREAS },
];
const TODAS: Area[] = GRUPOS.flatMap((g) => g.areas);

export function CargosSection() {
  const { session } = useSession();
  const { roles, loaded, error } = useRoles();
  const { departments } = useDepartments();
  const mobile = useMobile();

  const [escolha, setEscolha] = useState<Escolha | null>(null);
  /*
   * A matriz abre numa janela por cima. É uma tabela com uma coluna por cargo:
   * dentro da coluna do detalhe ficava apertada e empurrava a página para o lado.
   */
  const [aComparar, setAComparar] = useState(false);
  const detalhe = useRef<HTMLDivElement>(null);

  /*
   * No telemóvel a estrutura e o detalhe ficam um por cima do outro, e o cargo
   * escolhido abria fora do ecrã: tocava-se numa linha e parecia que nada
   * acontecia. Escolher leva a página até ao que se escolheu.
   */
  function escolher(e: Escolha) {
    setEscolha(e);
    if (mobile) requestAnimationFrame(() => detalhe.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }
  const [editingRole, setEditingRole] = useState<AcademyRole | null>(null);
  const [creatingRole, setCreatingRole] = useState<string | null>(null);
  const [editingDep, setEditingDep] = useState<Department | null>(null);
  const [creatingDep, setCreatingDep] = useState(false);
  const [apagandoDep, setApagandoDep] = useState<Department | null>(null);
  const [apagandoRole, setApagandoRole] = useState<AcademyRole | null>(null);

  useEffect(() => {
    void loadRoles();
    void loadDepartments();
  }, []);

  const mayWrite = can(session, "role:write");

  /** Os cargos que não pertencem a departamento nenhum. A presidência, e pouco mais. */
  const semDepartamento = roles.filter((r) => r.departmentId === null);

  /*
   * O que está à vista. Sem escolha — ou com uma que deixou de existir, porque
   * se apagou o cargo que estava aberto — cai no primeiro cargo da estrutura:
   * um ecrã de detalhe vazio à espera de um clique é uma página a meio.
   */
  const primeiro = departments.flatMap((d) => d.roles)[0]?.id ?? roles[0]?.id;
  const actual: Escolha | null = useMemo(() => {
    if (escolha?.tipo === "cargo" && roles.some((r) => r.id === escolha.id)) return escolha;
    if (escolha?.tipo === "dep" && departments.some((d) => d.id === escolha.id)) return escolha;
    return primeiro ? { tipo: "cargo", id: primeiro } : null;
  }, [escolha, roles, departments, primeiro]);

  const cargo = actual?.tipo === "cargo" ? roles.find((r) => r.id === actual.id) : undefined;
  const dep = actual?.tipo === "dep" ? departments.find((d) => d.id === actual.id) : undefined;

  return (
    <div>
      {error && (
        <div className="mb-4">
          <Erro>{error}</Erro>
        </div>
      )}

      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[272px_minmax(0,1fr)]">
        {/* ------------------------------------------------------------ a estrutura */}
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-panel text-ink">Estrutura</h3>
            {mayWrite && (
              <button type="button" className="ctl-ghost h-7 text-ink-3 hover:text-ink" onClick={() => setCreatingDep(true)}>
                <Plus className="size-3.5" strokeWidth={2} />
                Departamento
              </button>
            )}
          </div>

          <Lista>
            {!loaded && <p className="px-4 py-4 text-meta text-ink-4">a carregar…</p>}

            {departments.map((d) => (
              <div key={d.id} className="border-b border-line last:border-b-0">
                <ItemDaEstrutura
                  titulo
                  nome={d.name}
                  pessoas={d.people}
                  on={actual?.tipo === "dep" && actual.id === d.id}
                  onClick={() => escolher({ tipo: "dep", id: d.id })}
                />
                {d.roles.map((dr) => (
                  <ItemDaEstrutura
                    key={dr.id}
                    nome={dr.name}
                    pessoas={dr.people}
                    on={actual?.tipo === "cargo" && actual.id === dr.id}
                    onClick={() => escolher({ tipo: "cargo", id: dr.id })}
                  />
                ))}
                {/*
                  "Novo cargo" é a última linha do departamento, no sítio onde o
                  cargo novo vai aparecer.
                */}
                {d.editable && (
                  <button
                    type="button"
                    onClick={() => setCreatingRole(d.id)}
                    className="flex w-full items-center gap-2 py-2 pr-3 pl-9 text-left text-meta text-ink-4 transition-colors duration-[120ms] hover:text-ink"
                  >
                    <Plus className="size-3" strokeWidth={2} />
                    Novo cargo
                  </button>
                )}
              </div>
            ))}

            {semDepartamento.length > 0 && (
              <div className="border-b border-line last:border-b-0">
                {/* A presidência responde por tudo e não pertence a uma área do clube. */}
                <p className="px-3 pt-2.5 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-4">
                  Sem departamento
                </p>
                {semDepartamento.map((r) => (
                  <ItemDaEstrutura
                    key={r.id}
                    nome={r.name}
                    pessoas={r.people}
                    on={actual?.tipo === "cargo" && actual.id === r.id}
                    onClick={() => escolher({ tipo: "cargo", id: r.id })}
                  />
                ))}
              </div>
            )}
          </Lista>

          {roles.length > 1 && (
            <button
              type="button"
              onClick={() => setAComparar(true)}
              className="mt-3 flex h-9 w-full items-center justify-center rounded-[10px] border border-line text-meta font-medium text-ink-2 transition-colors duration-[120ms] hover:border-line-strong hover:text-ink"
            >
              Comparar cargos
            </button>
          )}
        </div>

        {/* ------------------------------------------------------------ o detalhe */}
        <div ref={detalhe} className="min-w-0 scroll-mt-4">
          {cargo && (
            <DetalheDoCargo
              role={cargo}
              departamento={departments.find((d) => d.id === cargo.departmentId)}
              onEdit={() => setEditingRole(cargo)}
              onDelete={() => setApagandoRole(cargo)}
            />
          )}

          {dep && (
            <DetalheDoDepartamento
              dep={dep}
              onEdit={() => setEditingDep(dep)}
              onDelete={() => setApagandoDep(dep)}
              onNovoCargo={() => setCreatingRole(dep.id)}
              onAbrirCargo={(id) => escolher({ tipo: "cargo", id })}
            />
          )}

          {!actual && loaded && (
            <p className="text-meta text-ink-3">Ainda não há cargos. Começa por criar um departamento.</p>
          )}
        </div>
      </div>

      {aComparar && (
        <Dialog title="Quem vê o quê" subtitle="Todos os cargos, lado a lado" onClose={() => setAComparar(false)} width={1280}>
          <div className="p-5">
            <Comparar roles={roles} mobile={mobile} />
          </div>
        </Dialog>
      )}

      {(creatingDep || editingDep) && (
        <DepartmentDialog
          department={editingDep ?? undefined}
          session={session}
          onClose={() => {
            setCreatingDep(false);
            setEditingDep(null);
            /*
             * Apagar um departamento mexe nos **cargos**, e o store deles não sabe.
             *
             * Os cargos lá dentro ficam sem departamento (`onDelete: SetNull`) e
             * passam para o grupo "Sem departamento" desta estrutura — que é
             * montado a partir do store dos cargos, onde eles ainda têm o
             * `departmentId` antigo. Sem esta linha, desapareciam do ecrã até um F5.
             *
             * Vive aqui e não em `lib/departments.ts` para não fazer os dois
             * módulos importarem-se um ao outro: este ecrã já conhece os dois.
             */
            void loadRoles();
          }}
        />
      )}

      {apagandoRole && (
        <DeleteRoleDialog
          role={apagandoRole}
          onClose={() => setApagandoRole(null)}
          onDeleted={() => {
            setApagandoRole(null);
            /* Ficar sem cargo muda a ficha e a lista de staff: o store recarrega. */
            void reloadAcademy();
          }}
        />
      )}

      {apagandoDep && (
        <DeleteDepartmentDialog
          department={apagandoDep}
          onClose={() => setApagandoDep(null)}
          onDeleted={() => {
            setApagandoDep(null);
            /* Os cargos ficam sem departamento: o store deles tem de recarregar. */
            void loadRoles();
          }}
        />
      )}

      {(creatingRole !== null || editingRole) && (
        <RoleDialog
          role={editingRole ?? undefined}
          departmentId={creatingRole ?? undefined}
          session={session}
          onClose={() => {
            setCreatingRole(null);
            setEditingRole(null);
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Uma linha da estrutura: um departamento (título) ou um cargo (recolhido).
 *
 * A marca de escolhido é a das Definições: um traço da cor do clube à esquerda
 * e um fundo quase nenhum. `signal-ink` e não `signal`, para se ver num clube de
 * cor clara.
 */
function ItemDaEstrutura({
  nome,
  pessoas,
  on,
  titulo,
  onClick,
}: {
  nome: string;
  pessoas: number;
  on: boolean;
  titulo?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={on ? "true" : undefined}
      onClick={onClick}
      className={cx(
        "relative flex w-full items-center gap-2 pr-3 text-left transition-colors duration-[120ms]",
        titulo ? "py-2.5 pl-3" : "py-2 pl-9",
        on ? "bg-sunken/70" : "hover:bg-sunken/40",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-signal-ink transition-opacity duration-[120ms]",
          on ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        className={cx(
          "min-w-0 flex-1 truncate",
          titulo ? "text-body font-semibold text-ink" : on ? "text-body font-medium text-ink" : "text-body text-ink-2",
        )}
      >
        {nome}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-meta tabular text-ink-4" title={`${pessoas} ${pessoas === 1 ? "pessoa" : "pessoas"}`}>
        <Users className="size-3" strokeWidth={1.75} />
        {pessoas}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */

function DetalheDoCargo({
  role,
  departamento,
  onEdit,
  onDelete,
}: {
  role: AcademyRole;
  departamento?: Department;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const perms = new Set(role.permissions as Permission[]);
  const edita = TODAS.filter((a) => levelOf(a, perms) === "write");
  const ve = TODAS.filter((a) => levelOf(a, perms) === "read");
  const nada = TODAS.filter((a) => levelOf(a, perms) !== "write" && levelOf(a, perms) !== "read");

  return (
    <div>
      <Cabecalho
        sobre={departamento ? `Cargo · ${departamento.name}` : "Cargo · sem departamento"}
        nome={role.name}
        descricao={role.description}
        etiquetas={
          <>
            {role.isSystem && <Pill>de origem</Pill>}
            {role.navKeys.length > 0 && <Pill tone="signal">menu próprio</Pill>}
          </>
        }
        accoes={
          role.editable ? (
            <>
              <button type="button" className="ctl-outline" onClick={onEdit}>
                <Pencil className="size-3.5" strokeWidth={1.75} />
                Editar
              </button>
              {/*
                "Apagar" sempre, e não só com o cargo vazio.

                Estava preso a `role.people === 0`, e o servidor recusava por trás
                com "Ainda há 3 pessoas com este papel". Para apagar era preciso
                reatribuir as pessoas primeiro, uma a uma — e um clube a
                reorganizar-se faz o contrário: desfaz a estrutura velha e arruma
                as pessoas depois. Quem ficar sem cargo não fica sem acesso, e o
                diálogo diz isso antes de apagar.
              */}
              {!role.isSystem && (
                <button
                  type="button"
                  className="ctl-ghost size-8 justify-center px-0 text-ink-4 hover:text-risk"
                  aria-label={`Apagar ${role.name}`}
                  title="Apagar cargo"
                  onClick={onDelete}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                </button>
              )}
            </>
          ) : (
            /*
             * Sem botão, em vez de botão desactivado. Um botão que não faz nada
             * ensina que existe ali alguma coisa escondida — e a razão de não se
             * poder editar (é o teu próprio cargo, ou está acima de ti) não cabe
             * num tooltip.
             */
            <span className="text-meta text-ink-4">{role.key === "presidente" ? "não se altera" : null}</span>
          )
        }
      />

      {/* Os três números que resumem o cargo, antes do pormenor. */}
      <dl className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-[12px] border border-line bg-line">
        <Numero rotulo={role.people === 1 ? "pessoa" : "pessoas"} valor={role.people} />
        <Numero rotulo={edita.length === 1 ? "área que edita" : "áreas que edita"} valor={edita.length} />
        <Numero rotulo={ve.length === 1 ? "área que só vê" : "áreas que só vê"} valor={ve.length} />
      </dl>

      {/*
        O que o cargo pode, em três colunas.

        Era uma coluna de uma matriz. Aqui lê-se como uma frase: edita isto, vê
        aquilo, não chega àquilo. "Sem acesso" fica à vista e não escondido —
        "não vê as mensalidades" é tantas vezes a resposta que se procura como
        "vê os atletas".
      */}
      <div className="mt-5 grid items-start gap-3 sm:grid-cols-3">
        <ColunaDeAreas titulo="Edita" tom="edita" areas={edita} vazio="Não edita nada." />
        <ColunaDeAreas titulo="Só vê" tom="ve" areas={ve} vazio="Nada só de leitura." />
        <ColunaDeAreas titulo="Sem acesso" tom="nada" areas={nada} vazio="Chega a tudo." />
      </div>

      <p className="mt-5 max-w-[64ch] text-meta leading-relaxed text-ink-3">
        Um cargo vale para toda a gente que o tem. Para abrir ou fechar uma permissão a{" "}
        <strong className="font-medium text-ink-2">uma pessoa em concreto</strong>, abre a ficha dela em{" "}
        <Link to="/staff" className="font-medium text-ink hover:underline">
          Staff
        </Link>
        .
      </p>
    </div>
  );
}

function DetalheDoDepartamento({
  dep,
  onEdit,
  onDelete,
  onNovoCargo,
  onAbrirCargo,
}: {
  dep: Department;
  onEdit: () => void;
  onDelete: () => void;
  onNovoCargo: () => void;
  onAbrirCargo: (id: string) => void;
}) {
  return (
    <div>
      <Cabecalho
        sobre="Departamento"
        nome={dep.name}
        descricao={dep.description}
        etiquetas={
          <>
            {/* O alcance primeiro: é o que decide até onde os cargos de dentro veem. */}
            <Pill tone={dep.baseRole === "COACH" || dep.baseRole === "STAFF" ? "neutral" : "signal"}>
              {SCOPE_LABEL[dep.baseRole]}
            </Pill>
            {dep.navKeys.length > 0 && <Pill tone="signal">menu próprio</Pill>}
          </>
        }
        accoes={
          dep.editable ? (
            <>
              <button type="button" className="ctl-outline" onClick={onEdit}>
                <Pencil className="size-3.5" strokeWidth={1.75} />
                Editar
              </button>
              <button
                type="button"
                className="ctl-ghost size-8 justify-center px-0 text-ink-4 hover:text-risk"
                aria-label={`Apagar ${dep.name}`}
                title="Apagar departamento"
                onClick={onDelete}
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </button>
            </>
          ) : null
        }
      />

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-line bg-line">
        <Numero rotulo={dep.people === 1 ? "pessoa" : "pessoas"} valor={dep.people} />
        <Numero rotulo={dep.roles.length === 1 ? "cargo" : "cargos"} valor={dep.roles.length} />
      </dl>

      <div className="mt-5 mb-2 flex items-center justify-between gap-2">
        <h4 className="text-panel text-ink">Cargos deste departamento</h4>
        {dep.editable && (
          <button type="button" className="ctl-outline" onClick={onNovoCargo}>
            <Plus className="size-3.5" strokeWidth={2} />
            Novo cargo
          </button>
        )}
      </div>
      <Lista>
        {dep.roles.length === 0 ? (
          <p className="px-4 py-4 text-meta text-ink-3">
            Sem cargos. Ninguém pode ser convidado para este departamento até haver um.
          </p>
        ) : (
          <ul>
            {dep.roles.map((r) => (
              <li key={r.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => onAbrirCargo(r.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-[120ms] hover:bg-sunken/40"
                >
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{r.name}</span>
                  <span className="shrink-0 text-meta tabular text-ink-3">
                    {r.people} {r.people === 1 ? "pessoa" : "pessoas"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Lista>

      <p className="mt-5 max-w-[64ch] text-meta leading-relaxed text-ink-3">
        Os cargos de um departamento partem do que o departamento pode e ajustam-se a partir daí.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Cabecalho({
  sobre,
  nome,
  descricao,
  etiquetas,
  accoes,
}: {
  sobre: string;
  nome: string;
  descricao: string | null;
  etiquetas: React.ReactNode;
  accoes: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-4">{sobre}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h3 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-ink">{nome}</h3>
          {etiquetas}
        </div>
        {descricao && <p className="mt-1.5 max-w-[60ch] text-body text-ink-3">{descricao}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{accoes}</div>
    </header>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dd className="text-[22px] font-semibold leading-none tracking-[-0.01em] text-ink tabular">{valor}</dd>
      <dt className="mt-1.5 text-meta text-ink-3">{rotulo}</dt>
    </div>
  );
}

/**
 * Uma coluna de áreas: o que o cargo edita, o que só vê, ou ao que não chega.
 *
 * A cor do clube marca só o "edita" — é o nível que dá poder. O "só vê" é neutro
 * e o "sem acesso" é apagado: a página lê-se de forte para fraco, da esquerda
 * para a direita.
 */
function ColunaDeAreas({
  titulo,
  tom,
  areas,
  vazio,
}: {
  titulo: string;
  tom: "edita" | "ve" | "nada";
  areas: Area[];
  vazio: string;
}) {
  return (
    <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <span
          aria-hidden
          className={cx(
            "size-2.5 shrink-0 rounded-full",
            tom === "edita" ? "bg-signal-ink" : tom === "ve" ? "border-[1.5px] border-ink-3" : "border-[1.5px] border-dashed border-line-strong",
          )}
        />
        <h4 className={cx("text-meta font-semibold", tom === "nada" ? "text-ink-3" : "text-ink")}>{titulo}</h4>
        <span className="ml-auto text-meta tabular text-ink-4">{areas.length}</span>
      </header>
      {areas.length === 0 ? (
        <p className="px-3.5 py-3 text-meta text-ink-4">{vazio}</p>
      ) : (
        <ul className="px-3.5 py-2">
          {areas.map((a) => (
            <li key={a.label} className={cx("py-1 text-body", tom === "nada" ? "text-ink-4" : "text-ink-2")}>
              {a.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O nível de acesso, como sinal e não como palavra.
 *
 * Um ponto cheio, um ponto vazio e um traço leem-se em diagonal, que é como se
 * lê uma matriz; a legenda diz o que são, uma vez, por cima da tabela.
 */
function Nivel({ level }: { level: "write" | "read" | null }) {
  if (level === "write") return <span aria-label="edita" className="inline-block size-2.5 rounded-full bg-signal-ink" />;
  if (level === "read")
    return <span aria-label="só vê" className="inline-block size-2.5 rounded-full border-[1.5px] border-ink-3" />;
  return <span aria-label="sem acesso" className="inline-block h-px w-2.5 bg-line-strong align-middle" />;
}

/**
 * Todos os cargos lado a lado.
 *
 * Responde à pergunta que o detalhe de um cargo não responde: *"quem é que vê
 * as mensalidades?"* lê-se numa linha desta tabela.
 *
 * É o retrato dos **cargos**. As excepções são de cada pessoa e vivem na ficha
 * dela, porque é lá que a pergunta aparece.
 */
function Comparar({ roles, mobile }: { roles: AcademyRole[]; mobile: boolean }) {
  const nivel = (role: AcademyRole, area: Area) => {
    const l = levelOf(area, new Set(role.permissions as Permission[]));
    return l === "write" || l === "read" ? l : null;
  };

  return (
    <div>
      {/* O título é o da janela; aqui fica só a legenda. */}
      <header className="mb-3 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <div className="flex items-center gap-4 text-meta text-ink-3">
          <span className="flex items-center gap-1.5">
            <Nivel level="write" /> edita
          </span>
          <span className="flex items-center gap-1.5">
            <Nivel level="read" /> só vê
          </span>
          <span className="flex items-center gap-1.5">
            <Nivel level={null} /> sem acesso
          </span>
        </div>
      </header>

      <Lista>
        {mobile ? (
          /*
           * Telemóvel: um bloco por cargo, com as áreas em duas colunas. No
           * telemóvel a pergunta que se faz é "o que é que o treinador vê?", e a
           * resposta é um cargo de cada vez.
           */
          roles.map((role) => (
            <section key={role.id} className="border-b border-line last:border-0">
              <h4 className="bg-sunken/40 px-4 py-2 text-body font-medium text-ink">{role.name}</h4>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3">
                {TODAS.map((area) => (
                  <div key={area.label} className="flex min-w-0 items-center justify-between gap-2">
                    <dt className="truncate text-meta text-ink-2">{area.label}</dt>
                    <dd className="shrink-0">
                      <Nivel level={nivel(role, area)} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="border-b border-line bg-sunken/40">
                  <th className="sticky left-0 z-[1] bg-sunken px-4 py-2.5 text-left text-meta font-medium text-ink-3">Área</th>
                  {roles.map((r) => (
                    <th key={r.id} className="px-3 py-2.5 text-center text-meta font-medium whitespace-nowrap text-ink-3">
                      {r.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TODAS.map((area) => (
                  <tr key={area.label} className="border-b border-line last:border-0">
                    {/* Presa à esquerda: com muitos cargos a tabela rola, e a área tem de ficar à vista. */}
                    <td className="sticky left-0 z-[1] bg-surface px-4 py-2.5 whitespace-nowrap text-ink-2">{area.label}</td>
                    {roles.map((role) => (
                      <td key={role.id} className="px-3 py-2.5 text-center">
                        <Nivel level={nivel(role, area)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Lista>
    </div>
  );
}

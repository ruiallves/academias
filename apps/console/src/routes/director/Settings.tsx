import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DepartmentDialog } from "@/components/DepartmentDialog";
import { IdentityPanel } from "@/components/IdentityPanel";
import { SportsPanel } from "@/components/SportsPanel";
/*
 * A importação de jogos (zerozero) saiu daqui por agora.
 *
 * O componente fica no repositório — `components/ZeroZeroPanel.tsx` — porque o
 * trabalho está feito e volta a entrar quando a funcionalidade for para a frente.
 * Tirá-lo do ecrã é só não oferecer uma caixa que ainda não se quer que ninguém
 * use.
 */
import { cx, Panel, PanelHead, Pill } from "@/components/primitives";
import { CircleCheck, Wallet } from "@/lib/icons";
import { useStore } from "@/lib/store";
import { type CatalogKey } from "@/lib/catalogs";
import { can, type Permission } from "@/lib/permissions";
import { AREAS, CLINICAL_AREAS, SCOUTING_AREAS, levelOf, type Area } from "@/lib/access";
import { SCOPE_LABEL, loadDepartments, useDepartments, type Department } from "@/lib/departments";
import { archiveRole, loadRoles, useRoles, type AcademyRole } from "@/lib/roles";
import { RoleDialog } from "@/components/RoleDialog";
import { useSession } from "@/session";

/**
 * Definições.
 *
 * ## A ordem dos painéis é a ordem do trabalho
 *
 * Identidade, modalidades, cargos, catálogos. Antes as modalidades estavam
 * soltas no meio, os cargos no fim e os catálogos por baixo de tudo — e não se
 * percebia que uma coisa depende da outra. Depende: os escalões e os balneários
 * são de uma modalidade, e um clube sem modalidades não tem o que configurar.
 *
 * O white-label vive no primeiro painel e agora **grava mesmo** — ver
 * `IdentityPanel`, que explica porque é que antes não gravava.
 */

export default function Settings() {
  const { session } = useSession();
  const store = useStore();
  const [params] = useSearchParams();
  // Deep-link a partir de qualquer diálogo que ofereça "gerir X" — p. ex. o local
  // no Novo evento. Chega aqui já com o catálogo certo aberto.
  const deepLinked = params.get("catalogo") as CatalogKey | null;
  const painel = params.get("painel");

  const maySettings = can(session, "settings:write");

  return (
    <>
      <PageHeader
        eyebrow={store.academy.name}
        title="Definições"
        subtitle="Identidade, modalidades, cargos e pagamentos."
      />

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          <IdentityPanel mayWrite={maySettings} />

          {/*
            As modalidades trazem os catálogos consigo.
            O painel "Catálogos" que existia aqui desapareceu: eram quatro
            acordeões que não diziam de que modalidade eram, e ninguém procura
            "os escalões" — procura os escalões do futebol. Ver `SportsPanel`.
          */}
          <SportsPanel mayWrite={maySettings} deepLinked={deepLinked} />
          {/*
            Os cargos vêm a seguir às modalidades.
            É a ordem do trabalho: primeiro decide-se o que o clube pratica e
            como cada modalidade se organiza, depois quem lá trabalha.
          */}
          <RolesPanel open={painel === "cargos"} />

        </div>

        <div className="space-y-3">
          <PwaPreview />

          <Panel>
            <PanelHead title="Pagamentos" />
            <div className="space-y-3 p-5">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-full bg-ok-soft text-ok">
                  <CircleCheck className="size-4" strokeWidth={1.75} />
                </span>
                <div>
                  <div className="text-body font-medium text-ink">euPago ligado</div>
                  <div className="text-meta text-ink-3">MB Way, Multibanco e cartão</div>
                </div>
              </div>

              <div className="rounded-[var(--radius-control)] border border-line bg-sunken/50 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-meta font-medium text-ink">
                  <Wallet className="size-3.5" strokeWidth={1.75} />
                  Confirmação por webhook
                </div>
                <p className="text-meta text-ink-3">
                  O estado de um pagamento só muda quando a euPago confirma no servidor. O
                  navegador nunca decide se algo foi pago.
                </p>
              </div>

              <dl className="space-y-2 text-meta">
                <Row label="Dia de vencimento" value="8 de cada mês" />
                <Row label="Lembretes automáticos" value="3 dias antes e no dia" />
                <Row label="Débito directo SEPA" value="por activar" muted />
              </dl>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2 last:border-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className={cx("text-right font-medium", muted ? "text-ink-4" : "text-ink")}>{value}</dd>
    </div>
  );
}

/**
 * Papéis e permissões.
 *
 * Era uma matriz só de leitura, desenhada a partir do mapa em código: mostrava o
 * que estava decidido e não deixava decidir nada. Agora os papéis são linhas da
 * academia — cria-se, edita-se, escolhe-se o que cada um vê — e a matriz continua
 * lá porque a pergunta que ela responde ("porque é que o treinador não vê as
 * mensalidades?") não desapareceu; passou a ter resposta editável.
 */
/**
 * Departamentos, e os cargos dentro de cada um.
 *
 * ## Porque é que isto era duas listas e passou a ser uma
 *
 * Era: uma lista de cargos, plana, com o departamento escondido lá dentro num
 * campo. Quem chegava aqui via doze linhas em fila e não conseguia responder à
 * pergunta que trazia — *quem vê o quê?*. Nem sequer via que "Fisioterapeuta" e
 * "Médico" eram a mesma área do clube.
 *
 * A árvore responde: o departamento diz o que a área faz e até onde vê, e os
 * cargos por baixo dizem quem lá trabalha. É a forma que a academia já tem na
 * cabeça, e por isso não precisa de ser explicada.
 *
 * Os cargos sem departamento — a presidência — ficam num grupo à parte no fim,
 * porque são a excepção e não a regra.
 */
function RolesPanel({ open }: { open?: boolean }) {
  const { session } = useSession();
  const { roles, loaded, error } = useRoles();
  const { departments } = useDepartments();
  const [editingRole, setEditingRole] = useState<AcademyRole | null>(null);
  const [creatingRole, setCreatingRole] = useState<string | null>(null);
  const [editingDep, setEditingDep] = useState<Department | null>(null);
  const [creatingDep, setCreatingDep] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadRoles();
    void loadDepartments();
  }, []);

  // Chegar aqui de um "gerir cargos" só vale a pena se o painel certo ficar à
  // vista sem se ter de procurar entre os cinco.
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [open]);

  const mayWrite = can(session, "role:write");

  /** Os cargos que não pertencem a departamento nenhum. A presidência, e pouco mais. */
  const semDepartamento = roles.filter((r) => r.departmentId === null);

  return (
    <div ref={ref} className="space-y-3">
      <Panel>
        <PanelHead
          title="Departamentos e cargos"
          hint={loaded ? `${departments.length} departamentos · ${roles.length} cargos` : "a carregar…"}
        >
          {mayWrite && (
            <button type="button" className="ctl-primary" onClick={() => setCreatingDep(true)}>
              Novo departamento
            </button>
          )}
        </PanelHead>

        <p className="border-b border-line px-5 py-3 text-meta leading-relaxed text-ink-3">
          Um <strong className="font-medium text-ink-2">departamento</strong> é uma área do clube:
          decide o que ela faz e até onde vê. Um <strong className="font-medium text-ink-2">cargo</strong>{" "}
          é uma função lá dentro — parte do que o departamento pode e ajusta-se a partir daí.
        </p>

        {error && <p className="px-5 py-3 text-meta text-risk">{error}</p>}

        <ul>
          {departments.map((dep) => (
            <li key={dep.id} className="border-b border-line last:border-b-0">
              <div className="flex flex-wrap items-center gap-3 bg-sunken/40 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-body font-medium text-ink">{dep.name}</span>
                    <Pill tone={dep.baseRole === "COACH" || dep.baseRole === "STAFF" ? "neutral" : "signal"}>
                      {SCOPE_LABEL[dep.baseRole]}
                    </Pill>
                    {dep.navKeys.length > 0 && <Pill tone="signal">menu próprio</Pill>}
                  </div>
                  <div className="text-meta text-ink-3">
                    {dep.description}
                    <span className="text-ink-4">
                      {" · "}
                      {dep.people} {dep.people === 1 ? "pessoa" : "pessoas"}
                    </span>
                  </div>
                </div>

                {dep.editable && (
                  <div className="flex shrink-0 gap-1.5">
                    <button type="button" className="ctl-ghost" onClick={() => setCreatingRole(dep.id)}>
                      Novo cargo
                    </button>
                    <button type="button" className="ctl-ghost" onClick={() => setEditingDep(dep)}>
                      Editar
                    </button>
                  </div>
                )}
              </div>

              {dep.roles.length === 0 ? (
                <p className="py-2.5 pl-9 pr-5 text-meta text-ink-4">
                  Sem cargos. Ninguém pode ser convidado para este departamento até haver um.
                </p>
              ) : (
                <ul>
                  {dep.roles.map((dr) => {
                    const role = roles.find((r) => r.id === dr.id);
                    if (!role) return null;
                    return <RoleRow key={role.id} role={role} onEdit={() => setEditingRole(role)} />;
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>

        {semDepartamento.length > 0 && (
          <>
            <div className="border-t border-line bg-sunken/40 px-5 py-3">
              <div className="text-body font-medium text-ink">Sem departamento</div>
              <div className="text-meta text-ink-3">
                A presidência responde por tudo e não pertence a uma área do clube.
              </div>
            </div>
            <ul>
              {semDepartamento.map((role) => (
                <RoleRow key={role.id} role={role} onEdit={() => setEditingRole(role)} />
              ))}
            </ul>
          </>
        )}

        <p className="border-t border-line px-5 py-3 text-meta leading-relaxed text-ink-3">
          Um cargo vale para toda a gente que o tem. Para abrir ou fechar permissões a{" "}
          <strong className="font-medium text-ink-2">uma pessoa em concreto</strong> — dar mensalidades a um
          treinador, tirar-lhe o boletim clínico — abre a ficha dela em{" "}
          <Link to="/staff" className="font-medium text-ink hover:underline">
            Staff
          </Link>
          .
        </p>
      </Panel>

      {roles.length > 0 && (
        <Panel>
          <PanelHead title="Quem vê o quê" hint="uma coluna por cargo" />
          <PermissionMatrix roles={roles} />
        </Panel>
      )}

      {(creatingDep || editingDep) && (
        <DepartmentDialog
          department={editingDep ?? undefined}
          session={session}
          onClose={() => {
            setCreatingDep(false);
            setEditingDep(null);
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

/** Uma linha de cargo, indentada por baixo do departamento a que pertence. */
function RoleRow({ role, onEdit }: { role: AcademyRole; onEdit: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line py-2.5 pl-9 pr-5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-body text-ink">{role.name}</span>
          {role.isSystem && <Pill>de origem</Pill>}
          {role.navKeys.length > 0 && <Pill tone="signal">menu próprio</Pill>}
        </div>
        <div className="text-meta text-ink-3">
          {role.description}
          {role.description && <span className="text-ink-4">{" · "}</span>}
          <span className="text-ink-4">
            {role.people} {role.people === 1 ? "pessoa" : "pessoas"}
          </span>
        </div>
      </div>

      {role.editable ? (
        <div className="flex shrink-0 gap-1.5">
          <button type="button" className="ctl-ghost" onClick={onEdit}>
            Editar
          </button>
          {!role.isSystem && role.people === 0 && (
            <button type="button" className="ctl-ghost" onClick={() => void archiveRole(role.id)}>
              Arquivar
            </button>
          )}
        </div>
      ) : (
        /*
         * Sem botão, em vez de botão desactivado. Um botão que não faz nada
         * ensina que existe ali alguma coisa escondida — e a razão de não se
         * poder editar (é o teu próprio cargo, ou está acima de ti) não cabe
         * num tooltip.
         */
        <span className="shrink-0 text-meta text-ink-4">{role.key === "presidente" ? "imutável" : "—"}</span>
      )}
    </li>
  );
}

/**
 * A matriz existe para tornar visível o que costuma ficar escondido em código — e
 * agora em base de dados. Um diretor consegue ver, sem perguntar a ninguém, que o
 * treinador não tem acesso financeiro.
 *
 * É o retrato dos **papéis**. As excepções são de cada pessoa e vivem na ficha
 * dela, porque é lá que a pergunta aparece. Uma tabela que misturasse as duas
 * deixava de responder a qualquer uma.
 */
function PermissionMatrix({ roles }: { roles: AcademyRole[] }) {
  const areas: Area[] = [...AREAS, ...CLINICAL_AREAS, ...SCOUTING_AREAS];

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="border-b border-line bg-sunken/60">
            <th className="px-5 py-2 text-left text-meta font-medium text-ink-3">Área</th>
            {roles.map((r) => (
              <th key={r.id} className="px-3 py-2 text-center text-meta font-medium text-ink-3 whitespace-nowrap">
                {r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {areas.map((area) => (
            <tr key={area.label} className="border-b border-line last:border-0">
              <td className="px-5 py-2.5 text-ink-2">{area.label}</td>
              {roles.map((role) => {
                const level = levelOf(area, new Set(role.permissions as Permission[]));
                return (
                  <td key={role.id} className="px-3 py-2.5 text-center">
                    {level === "write" ? (
                      <Pill tone="signal">editar</Pill>
                    ) : level === "read" ? (
                      <Pill>ver</Pill>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Pré-visualização da PWA.
 *
 * Não é decoração: é a resposta à pergunta "como é que isto fica no telemóvel do
 * pai?", e muda ao vivo com a cor escolhida acima.
 */
function PwaPreview() {
  const { academy } = useStore();
  const mark = academy.shortName.slice(0, 2).toUpperCase();

  return (
    <Panel>
      <PanelHead title="App das famílias" hint="pré-visualização" />
      <div className="flex flex-col items-center gap-4 p-5">
        <div className="flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3">
          <span
            className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[12px] text-[15px] font-bold text-white"
            style={{ background: academy.logoUrl ? "var(--color-sunken)" : "var(--color-signal)" }}
          >
            {academy.logoUrl ? (
              <img src={academy.logoUrl} alt="" className="size-full object-contain" />
            ) : (
              mark
            )}
          </span>
          <div className="min-w-0">
            <div className="truncate text-body font-semibold text-ink">{academy.shortName}</div>
            <div className="truncate text-meta text-ink-3">ícone e nome no telemóvel</div>
          </div>
        </div>

        <p className="text-meta text-ink-3">
          O pai instala a app da <strong className="font-medium text-ink-2">{academy.name}</strong>. O nosso
          nome não aparece em lado nenhum — somos a tecnologia por trás.
        </p>
      </div>
    </Panel>
  );
}

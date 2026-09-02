import { useEffect, useMemo, useState } from "react";
import {
  AREAS,
  CLINICAL_AREAS,
  effectivePermissions,
  levelOf,
  overridesFor,
  resetAccess,
  seedOverrides,
  setPermission,
  useAccessOverrides,
  type Area,
  type Level,
} from "@/lib/access";
import { ROLE_PERMISSIONS, can, type Permission, type Session } from "@/lib/permissions";
import { assignRole, loadRoles, useRoles } from "@/lib/roles";
import { ROLE_LABEL } from "@/session";
import { Check } from "@/lib/icons";
import { Panel, PanelHead, Pill, cx } from "./primitives";
import { reloadAcademy } from "@/lib/store";
import type { StaffMember } from "@/data/types";

/**
 * Quem vê o quê, pessoa a pessoa.
 *
 * ## Porque é que isto é por pessoa e não só por papel
 *
 * O papel responde a 90% dos casos e é o que se lê na matriz das Definições. Os
 * outros 10% são reais e não cabem lá: o treinador que também trata de inscrições
 * e precisa de ver mensalidades, a academia que entende que o diagnóstico clínico
 * não deve sair do departamento clínico. Sem excepções por pessoa, cada uma
 * destas obrigava a inventar um papel novo — e é assim que oito papéis viram
 * quarenta, todos parecidos e nenhum explicável.
 *
 * ## Porque é que as excepções estão à vista
 *
 * Cada linha diz o que o papel dá, e marca-se quando o valor foi mudado à mão. Uma
 * permissão concedida há oito meses e esquecida é exactamente o tipo de coisa que
 * ninguém encontra quando precisa — e a pergunta "porque é que este treinador vê
 * as mensalidades?" tem de ter resposta nesta página, não no código.
 */
export function AccessPanel({ member, session }: { member: StaffMember; session: Session }) {
  // Redesenha quando alguma excepção mudar.
  useAccessOverrides();

  // Semeia a cópia local com o que o servidor já tem gravado desta pessoa.
  useEffect(() => {
    seedOverrides(member.id, member.grants, member.revokes);
  }, [member.id, member.grants, member.revokes]);

  const mayEdit = can(session, "access:write");
  const { roles } = useRoles();
  const { grants, revokes } = overridesFor(member.id);
  const changed = grants.length + revokes.length;

  /*
   * O que os cargos desta pessoa dão, somados.
   *
   * Todos: o principal e os que se lhe acrescentaram. É a mesma união que o
   * servidor faz para decidir o que ela pode — aqui serve para a matriz abaixo
   * mostrar a verdade, e para a etiqueta "alterado" comparar contra a coisa
   * certa. Sem cargos configurados fica nulo, e cai-se nos valores do papel-base.
   */
  const doCargo = useMemo(() => {
    const ids = [member.roleId, ...(member.extraRoles ?? []).map((r) => r.id)].filter(
      (id): id is string => Boolean(id),
    );
    if (ids.length === 0) return null;
    return [...new Set(ids.flatMap((id) => roles.find((r) => r.id === id)?.permissions ?? []))];
  }, [member.roleId, member.extraRoles, roles]);

  const permissions = effectivePermissions(member.role, member.id, doCargo);

  // O nome do cargo principal quando existe; o do papel-base quando não.
  const roleLabel = member.roleName ?? ROLE_LABEL[member.role];
  const tambem = member.extraRoles ?? [];

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHead
          title="Acesso"
          hint={`${roleLabel}${tambem.length > 0 ? ` · também ${tambem.map((r) => r.name).join(", ")}` : ""}${
            changed ? ` · ${changed} ${changed === 1 ? "excepção" : "excepções"}` : ""
          }`}
        >
          {mayEdit && changed > 0 && (
            <button type="button" onClick={() => resetAccess(member.id)} className="ctl-ghost">
              Repor o papel
            </button>
          )}
        </PanelHead>

        <p className="border-b border-line px-5 py-3 text-meta leading-relaxed text-ink-3">
          {mayEdit ? (
            <>
              O papel <strong className="font-medium text-ink-2">{roleLabel}</strong> define o
              que esta pessoa vê por omissão. Aqui muda-se para ela em concreto, sem mexer no papel nem em
              mais ninguém.
            </>
          ) : (
            <>
              É isto que <strong className="font-medium text-ink-2">{member.name.split(" ")[0]}</strong> vê no
              produto. Só quem gere permissões na academia pode mudar.
            </>
          )}
        </p>

        {mayEdit && <RolePicker member={member} session={session} />}

        <AreaTable areas={AREAS} member={member} permissions={permissions} base={doCargo} mayEdit={mayEdit} />
      </Panel>

      <Panel>
        <PanelHead title="Dados clínicos" hint="categoria especial no RGPD" />
        <p className="border-b border-line px-5 py-3 text-meta leading-relaxed text-ink-3">
          Saber que um atleta está parado e ler o diagnóstico dele são coisas diferentes, e por isso são
          permissões diferentes. <strong className="font-medium text-ink-2">Registar</strong> baixas e altas
          fica no departamento clínico, para a origem de um diagnóstico ser sempre rastreável a quem o pode
          fazer.
        </p>
        <AreaTable areas={CLINICAL_AREAS} member={member} permissions={permissions} base={doCargo} mayEdit={mayEdit} />
      </Panel>
    </div>
  );
}

/**
 * Que cargos esta pessoa veste.
 *
 * Está aqui, e não na ficha ao lado do telemóvel, pela mesma razão de
 * `access:write` existir à parte de `staff:write`: mudar o cargo de alguém é
 * secretaria, mudar o **acesso** é mudar o que essa pessoa pode fazer.
 *
 * ## Um principal, e os que se acrescentam
 *
 * Num clube pequeno a mesma pessoa é presidente e treina os Sub-13. Até aqui
 * tinha de escolher — ou via as contas, ou convocava — e quem tentava resolvê-lo
 * criava um cargo "Presidente e treinador" com as permissões somadas à mão. Ao
 * fim de uma época havia oito cargos que eram combinações de três.
 *
 * O **principal** é o que decide de onde vem o âmbito: o servidor põe o
 * papel-base a condizer com ele. É por isso que continua a ser um só, e escolhe-se
 * como sempre se escolheu — uma pastilha acesa entre as outras.
 *
 * Os **secundários** só somam permissões e menus. Um presidente que também treina
 * continua a ver a academia toda: se o segundo cargo trocasse o papel-base,
 * acrescentar "treinador" prendia-o às equipas dele e tirava-lhe acesso em vez de
 * lho dar — o contrário do que se quer.
 *
 * ## Porque é que são duas listas e não uma com dois cliques
 *
 * Porque são duas perguntas diferentes, e a segunda não faz sentido sem a
 * primeira. Uma lista só, com "clica uma vez para principal, duas para
 * secundário", é o género de coisa que ninguém descobre e toda a gente erra. Aqui
 * o principal está sempre visível em cima, e o resto é uma linha de caixas —
 * marcam-se as que quiser, e o que ela é lê-se de uma vez.
 */
function RolePicker({ member, session }: { member: StaffMember; session: Session }) {
  const { roles } = useRoles();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadRoles();
  }, []);

  // Ninguém muda os seus próprios cargos — o servidor recusa, e oferecê-lo era
  // prometer o que não se cumpre.
  const isSelf = session.staffId === member.id;
  if (roles.length === 0 || isSelf) return null;

  const extras = member.extraRoles ?? [];
  const extraIds = new Set(extras.map((r) => r.id));

  async function guardar(what: string, roleId: string | null, extraRoleIds?: string[]) {
    setBusy(what);
    setError(null);
    try {
      await assignRole(member.id, roleId, extraRoleIds);
      await reloadAcademy();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível mudar os cargos.");
    } finally {
      setBusy(null);
    }
  }

  /*
   * Promover um secundário a principal tira-o da lista dos secundários.
   *
   * Sem isto, o mesmo cargo ficava nas duas listas — o nome dele aparecia duas
   * vezes na ficha, e a soma das permissões contava-o duas vezes sem que isso
   * mudasse nada. O servidor também o filtra; fazê-lo aqui é o que evita o
   * segundo em que o ecrã mostra o erro antes de a resposta chegar.
   */
  function escolherPrincipal(roleId: string) {
    if (roleId === member.roleId) return;
    void guardar(roleId, roleId, extraIds.has(roleId) ? [...extraIds].filter((id) => id !== roleId) : undefined);
  }

  function alternarSecundario(roleId: string) {
    const proximos = extraIds.has(roleId)
      ? [...extraIds].filter((id) => id !== roleId)
      : [...extraIds, roleId];
    void guardar(roleId, member.roleId ?? null, proximos);
  }

  const disponiveis = roles.filter((r) => r.id !== member.roleId);

  return (
    <div className="border-b border-line px-5 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-group text-ink-3 uppercase">Cargo principal</span>
        {error && <span className="text-meta text-risk">{error}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {roles.map((role) => {
          const on = role.id === member.roleId;
          return (
            <button
              key={role.id}
              type="button"
              disabled={busy !== null}
              onClick={() => escolherPrincipal(role.id)}
              className={cx(
                "rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium transition-colors",
                on ? "border-transparent bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
                busy !== null && "opacity-60",
              )}
            >
              {role.name}
            </button>
          );
        })}
      </div>

      {/*
        O que decide o âmbito, dito onde se decide. Sem esta linha, "principal" e
        "também" pareciam a mesma coisa com nomes diferentes — e a pergunta que
        aparecia a seguir era sempre porque é que a ordem importa.
      */}
      <p className="mt-2 text-meta leading-relaxed text-ink-3">
        O principal decide o que esta pessoa <strong className="font-medium text-ink-2">vê</strong> — a academia toda,
        ou só as equipas dela.
      </p>

      {disponiveis.length > 0 && (
        <>
          <div className="mt-4 mb-2 flex items-baseline gap-2">
            <span className="text-group text-ink-3 uppercase">Também é</span>
            <span className="text-meta text-ink-4">
              {extras.length === 0
                ? "opcional"
                : `${extras.length} ${extras.length === 1 ? "cargo" : "cargos"} a mais`}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {disponiveis.map((role) => {
              const on = extraIds.has(role.id);
              return (
                <button
                  key={role.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => alternarSecundario(role.id)}
                  aria-pressed={on}
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium transition-colors",
                    on
                      ? "border-transparent bg-signal-soft text-signal-ink"
                      : "border-line text-ink-3 hover:border-line-strong hover:text-ink-2",
                    busy !== null && "opacity-60",
                  )}
                >
                  {on && <Check className="size-3" strokeWidth={2.5} />}
                  {role.name}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-meta leading-relaxed text-ink-3">
            Um cargo a mais só <strong className="font-medium text-ink-2">acrescenta</strong> — o que esta pessoa pode
            é a soma de todos. Nunca tira nada.
          </p>
        </>
      )}
    </div>
  );
}

function AreaTable({
  areas,
  member,
  permissions,
  base: doCargo,
  mayEdit,
}: {
  areas: Area[];
  member: StaffMember;
  permissions: Set<Permission>;
  /** O que os cargos desta pessoa dão, somados. Nulo = os valores do papel-base. */
  base: Permission[] | null;
  mayEdit: boolean;
}) {
  // A referência de "alterado" é o que os cargos dão — não o enum. Comparar com o
  // enum acendia a etiqueta em metade das linhas de quem tem um cargo à medida,
  // e "alterado" deixava de querer dizer alguma coisa.
  const base = doCargo ?? ROLE_PERMISSIONS[member.role];

  return (
    <ul>
      {areas.map((area) => {
        const level = levelOf(area, permissions);
        const baseLevel = levelOf(area, new Set(base));
        const isChanged = level !== baseLevel;

        return (
          <li key={area.label} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-body font-medium text-ink">{area.label}</span>
                {isChanged && <Pill tone="warn">alterado</Pill>}
              </div>
              <div className="text-meta text-ink-3">
                {area.hint}
                {isChanged && (
                  <span className="text-ink-4">
                    {" · "}
                    o papel dá {baseLevel === "none" ? "nada" : baseLevel === "read" ? "ver" : "editar"}
                  </span>
                )}
              </div>
            </div>

            {mayEdit ? (
              <LevelPicker area={area} member={member} level={level} base={doCargo} />
            ) : (
              <LevelTag level={level} hasWrite={Boolean(area.write)} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Três botões, não dois interruptores.
 *
 * "Ver" e "editar" não são independentes — não existe editar sem ver — e dois
 * interruptores deixavam exprimir esse estado impossível. Assim o estado inválido
 * não é evitado por validação: não cabe na interface.
 */
function LevelPicker({
  area,
  member,
  level,
  base: doCargo,
}: {
  area: Area;
  member: StaffMember;
  level: Level;
  /** A união dos cargos desta pessoa — a referência contra a qual a excepção se mede. */
  base: Permission[] | null;
}) {
  const options: { value: Level; label: string }[] = [
    { value: "none", label: "Não vê" },
    { value: "read", label: "Vê" },
    ...(area.write ? [{ value: "write" as const, label: "Editar" }] : []),
  ];

  function choose(next: Level) {
    if (next === level) return;
    setPermission(member.id, doCargo, member.role, area.read, next !== "none");
    if (area.write) setPermission(member.id, doCargo, member.role, area.write, next === "write");
  }

  return (
    <div className="flex shrink-0 rounded-[var(--radius-control)] border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => choose(o.value)}
          aria-pressed={level === o.value}
          className={cx(
            "rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
            level === o.value ? "bg-ink text-surface" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function LevelTag({ level, hasWrite }: { level: Level; hasWrite: boolean }) {
  if (level === "write") return <Pill tone="signal">editar</Pill>;
  if (level === "read") return <Pill>ver</Pill>;
  return <span className="text-meta text-ink-4">{hasWrite ? "sem acesso" : "não"}</span>;
}

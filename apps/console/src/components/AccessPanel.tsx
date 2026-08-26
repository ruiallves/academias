import { useEffect, useState } from "react";
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
  const permissions = effectivePermissions(member.role, member.id);
  const { grants, revokes } = overridesFor(member.id);
  const changed = grants.length + revokes.length;

  // O nome do papel da academia quando existe; o do papel-base quando não.
  const roleLabel = member.roleName ?? ROLE_LABEL[member.role];

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHead
          title="Acesso"
          hint={`papel: ${roleLabel}${changed ? ` · ${changed} ${changed === 1 ? "excepção" : "excepções"}` : ""}`}
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

        <AreaTable areas={AREAS} member={member} permissions={permissions} mayEdit={mayEdit} />
      </Panel>

      <Panel>
        <PanelHead title="Dados clínicos" hint="categoria especial no RGPD" />
        <p className="border-b border-line px-5 py-3 text-meta leading-relaxed text-ink-3">
          Saber que um atleta está parado e ler o diagnóstico dele são coisas diferentes, e por isso são
          permissões diferentes. <strong className="font-medium text-ink-2">Registar</strong> baixas e altas
          fica no departamento clínico, para a origem de um diagnóstico ser sempre rastreável a quem o pode
          fazer.
        </p>
        <AreaTable areas={CLINICAL_AREAS} member={member} permissions={permissions} mayEdit={mayEdit} />
      </Panel>
    </div>
  );
}

/**
 * Que papel esta pessoa veste.
 *
 * Está aqui, e não na ficha ao lado do telemóvel, pela mesma razão de
 * `access:write` existir à parte de `staff:write`: mudar o cargo de alguém é
 * secretaria, mudar o **papel** é mudar o que essa pessoa pode fazer na academia.
 *
 * O servidor põe o papel-base a condizer com o papel escolhido — é ele que decide
 * de onde vem o âmbito, e um papel de scouting com âmbito de treinador seria uma
 * pessoa presa a equipas que não tem.
 */
function RolePicker({ member, session }: { member: StaffMember; session: Session }) {
  const { roles } = useRoles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadRoles();
  }, []);

  // Ninguém muda o seu próprio papel — o servidor recusa, e oferecê-lo era
  // prometer o que não se cumpre.
  const isSelf = session.staffId === member.id;
  if (roles.length === 0 || isSelf) return null;

  async function choose(roleId: string) {
    if (roleId === member.roleId) return;
    setBusy(true);
    setError(null);
    try {
      await assignRole(member.id, roleId);
      await reloadAcademy();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível mudar o papel.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-line px-5 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-group text-ink-3 uppercase">Papel</span>
        {error && <span className="text-meta text-risk">{error}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {roles.map((role) => {
          const on = role.id === member.roleId;
          return (
            <button
              key={role.id}
              type="button"
              disabled={busy}
              onClick={() => void choose(role.id)}
              className={cx(
                "rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium transition-colors",
                on ? "border-transparent bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
                busy && "opacity-60",
              )}
            >
              {role.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AreaTable({
  areas,
  member,
  permissions,
  mayEdit,
}: {
  areas: Area[];
  member: StaffMember;
  permissions: Set<Permission>;
  mayEdit: boolean;
}) {
  const base = ROLE_PERMISSIONS[member.role];

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
              <LevelPicker area={area} member={member} level={level} />
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
function LevelPicker({ area, member, level }: { area: Area; member: StaffMember; level: Level }) {
  const options: { value: Level; label: string }[] = [
    { value: "none", label: "Não vê" },
    { value: "read", label: "Vê" },
    ...(area.write ? [{ value: "write" as const, label: "Editar" }] : []),
  ];

  function choose(next: Level) {
    if (next === level) return;
    setPermission(member.id, member.role, area.read, next !== "none");
    if (area.write) setPermission(member.id, member.role, area.write, next === "write");
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

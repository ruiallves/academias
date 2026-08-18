import { useEffect } from "react";
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
import { ROLE_LABEL } from "@/session";
import { Panel, PanelHead, Pill, cx } from "./primitives";
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

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHead
          title="Acesso"
          hint={`papel: ${ROLE_LABEL[member.role]}${changed ? ` · ${changed} ${changed === 1 ? "excepção" : "excepções"}` : ""}`}
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
              O papel <strong className="font-medium text-ink-2">{ROLE_LABEL[member.role]}</strong> define o
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
    { value: "none", label: "Nada" },
    { value: "read", label: "Ver" },
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

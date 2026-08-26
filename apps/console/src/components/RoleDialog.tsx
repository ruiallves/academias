import { useMemo, useState } from "react";
import { Check } from "@/lib/icons";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { Pill, SelectField, cx } from "./primitives";
import { DEPARTMENT_LABEL, type StaffDepartment } from "@/data/types";
import { ADMIN_AREAS, AREAS, CLINICAL_AREAS, SCOUTING_AREAS, levelOf, type Area, type Level } from "@/lib/access";
import { NAV_CATALOG, SETTINGS_ITEM } from "@/lib/nav";
import { ROLE_PERMISSIONS, permissionsOf, type Permission, type Role, type Session } from "@/lib/permissions";
import { BASE_ROLE_HINT, SELECTABLE_BASES, createRole, setRoleNav, updateRole, type AcademyRole } from "@/lib/roles";

/**
 * Criar e editar um papel.
 *
 * ## O problema que isto resolve
 *
 * Criar um papel e **depois** ir a outro sítio dizer o que ele vê era a queixa: a
 * pergunta "o que é que este papel faz?" e a pergunta "o que é que ele vê no
 * menu?" fazem-se ao mesmo tempo, e a segunda depende da primeira. Aqui estão no
 * mesmo painel, por ordem, e o bloco dos menus reage ao das permissões — marcar
 * "Mensalidades: nada" apaga o item *Mensalidades* da lista de menus à frente de
 * quem está a configurar, com a razão escrita ao lado.
 *
 * ## Porque é que os menus não são um segundo interruptor de segurança
 *
 * Porque não são segurança nenhuma, e o ecrã diz isso por palavras. Esconder um
 * menu não fecha o endpoint — quem souber o URL chega lá — e uma interface que
 * deixasse acreditar o contrário seria pior do que não ter a funcionalidade. O
 * que fecha é a permissão, no bloco de cima.
 */
export function RoleDialog({
  role,
  session,
  onClose,
}: {
  /** Ausente = criar. */
  role?: AcademyRole;
  session: Session;
  onClose: () => void;
}) {
  const editing = Boolean(role);

  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [baseRole, setBaseRole] = useState<Role>(role?.baseRole ?? "COACH");
  const [permissions, setPermissions] = useState<Set<Permission>>(
    () => new Set(role?.permissions ?? ROLE_PERMISSIONS["COACH"]),
  );
  const [navKeys, setNavKeys] = useState<string[]>(role?.navKeys ?? []);
  const [department, setDepartment] = useState<StaffDepartment | "">(role?.department ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** O tecto: ninguém dá o que não tem, e o servidor recusa na mesma. */
  const mine = useMemo(() => permissionsOf(session), [session]);

  const mayMenus = mine.has("role:menu");
  const valid = name.trim().length >= 2;

  /*
   * Trocar de papel-base repõe as permissões pelo ponto de partida desse base.
   * Só na criação: num papel que já existe, mudar o base é proibido no servidor
   * (mudaria o âmbito de toda a gente que o veste, em silêncio).
   */
  function changeBase(next: Role) {
    setBaseRole(next);
    setPermissions(new Set(ROLE_PERMISSIONS[next].filter((p) => mine.has(p))));
  }

  function setArea(area: Area, level: Level) {
    setPermissions((current) => {
      const next = new Set(current);
      if (level === "none") {
        next.delete(area.read);
        if (area.write) next.delete(area.write);
      } else {
        next.add(area.read);
        if (area.write) {
          if (level === "write") next.add(area.write);
          else next.delete(area.write);
        }
      }
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const chosen = [...permissions].filter((p) => mine.has(p));

      if (editing && role) {
        await updateRole(role.id, {
          name: name.trim(),
          description: description.trim(),
          department: department || null,
          permissions: chosen,
        });
        if (mayMenus) await setRoleNav(role.id, navKeys.filter((k) => visibleKeys.has(k)));
      } else {
        await createRole({
          name: name.trim(),
          description: description.trim(),
          baseRole,
          department: department || null,
          permissions: chosen,
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  /** Os menus que estas permissões tornam possíveis. Muda enquanto se configura. */
  const visibleKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const group of NAV_CATALOG) for (const item of group.items) if (permissions.has(item.requires)) keys.add(item.key);
    if (permissions.has(SETTINGS_ITEM.requires)) keys.add(SETTINGS_ITEM.key);
    return keys;
  }, [permissions]);

  return (
    <Dialog
      title={editing ? `Editar ${role!.name}` : "Novo papel"}
      subtitle={editing ? `${role!.people} ${role!.people === 1 ? "pessoa" : "pessoas"} com este papel` : "O que pode fazer e o que vê"}
      onClose={onClose}
      width={620}
      labelledBy="role-dialog"
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!valid || busy} onClick={() => void save()}>
            {busy ? "A gravar…" : editing ? "Gravar" : "Criar papel"}
          </button>
        </>
      }
    >
      {/* --- 1. Identidade -------------------------------------------------- */}
      <section className="space-y-3 border-b border-line px-5 py-4">
        <DialogField label="Nome">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Diretor desportivo"
            className={dialogInputClass}
          />
        </DialogField>

        <DialogField label="Descrição" hint="opcional">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="O que esta pessoa faz na academia"
            className={dialogInputClass}
          />
        </DialogField>

        {editing ? (
          <p className="text-meta text-ink-3">
            Âmbito: <span className="text-ink-2">{BASE_ROLE_HINT[role!.baseRole]}</span> Não se muda depois de
            criado — mudaria o que toda a gente com este papel consegue ver, sem ninguém tocar em pessoa
            nenhuma.
          </p>
        ) : (
          <DialogField label="Âmbito" hint="não se muda depois">
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {SELECTABLE_BASES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => changeBase(r)}
                    className={cx(
                      "rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium transition-colors",
                      baseRole === r
                        ? "border-transparent bg-ink text-surface"
                        : "border-line text-ink-2 hover:border-line-strong",
                    )}
                  >
                    {BASE_LABEL[r]}
                  </button>
                ))}
              </div>
              <p className="text-meta text-ink-3">{BASE_ROLE_HINT[baseRole]}</p>
            </div>
          </DialogField>
        )}

        {/*
          O departamento a que este cargo pertence.
          É o que faz o convite conseguir perguntar primeiro o departamento e só
          depois o cargo — sem isto, o cargo não aparece em menu nenhum e ninguém
          o consegue atribuir. Um departamento tem vários cargos; um cargo
          pertence a um só.
        */}
        <DialogField label="Departamento" hint="onde este cargo aparece ao convidar">
          <SelectField
            className="w-full"
            value={department}
            onChange={setDepartment}
            options={[
              { value: "" as const, label: "Sem departamento (presidência)" },
              ...(Object.keys(DEPARTMENT_LABEL) as StaffDepartment[]).map((d) => ({
                value: d,
                label: DEPARTMENT_LABEL[d],
              })),
            ]}
          />
        </DialogField>
      </section>

      {/* --- 2. O que pode --------------------------------------------------- */}
      <section className="border-b border-line">
        <SectionHead title="O que pode" hint="é isto que o servidor verifica" />
        <AreaList areas={AREAS} permissions={permissions} mine={mine} onChange={setArea} />
        <SectionHead title="Clínico" hint="categoria especial no RGPD" subtle />
        <AreaList areas={CLINICAL_AREAS} permissions={permissions} mine={mine} onChange={setArea} />
        <SectionHead title="Scouting" hint="o vídeo é separado de propósito" subtle />
        <AreaList areas={SCOUTING_AREAS} permissions={permissions} mine={mine} onChange={setArea} />
        <SectionHead title="Administração" hint="muda o produto para os outros" subtle />
        <AreaList areas={ADMIN_AREAS} permissions={permissions} mine={mine} onChange={setArea} />
      </section>

      {/* --- 3. O que vê ----------------------------------------------------- */}
      <section>
        <SectionHead title="O que vê no menu" hint={navKeys.length === 0 ? "tudo o que a permissão deixar" : `${navKeys.length} escolhidos`} />

        <div className="px-5 pb-4">
          <p className="mb-3 text-meta leading-relaxed text-ink-3">
            Isto é arrumação, não segurança: esconder um item não retira a permissão, e quem souber o
            endereço continua a chegar lá. Para fechar mesmo, tira a permissão em cima.
          </p>

          {!mayMenus && editing && (
            <p className="mb-3 text-meta text-warn">Não tens permissão para configurar menus.</p>
          )}

          {!editing ? (
            <p className="text-meta text-ink-3">
              Um papel novo começa a mostrar tudo o que as permissões deixam. Os menus configuram-se
              depois de o criar.
            </p>
          ) : (
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-2">
                <Toggle on={navKeys.length === 0} disabled={!mayMenus} onClick={() => setNavKeys([])} />
                <span className="text-body text-ink-2">Mostrar tudo o que as permissões deixarem</span>
              </label>

              {navKeys.length > 0 && (
                <ul className="rounded-[var(--radius-control)] border border-line">
                  {[...NAV_CATALOG, { label: undefined, items: [SETTINGS_ITEM] }].flatMap((g) => g.items).map((item) => {
                    const possible = visibleKeys.has(item.key);
                    const on = navKeys.includes(item.key);
                    return (
                      <li
                        key={item.key}
                        className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
                      >
                        <Toggle
                          on={on && possible}
                          disabled={!mayMenus || !possible}
                          onClick={() =>
                            setNavKeys((k) => (on ? k.filter((x) => x !== item.key) : [...k, item.key]))
                          }
                        />
                        <item.icon className={cx("size-4", possible ? "text-ink-3" : "text-ink-4")} strokeWidth={1.75} />
                        <span className={cx("flex-1 text-body", possible ? "text-ink" : "text-ink-4")}>
                          {item.label}
                        </span>
                        {!possible && <Pill>sem permissão</Pill>}
                      </li>
                    );
                  })}
                </ul>
              )}

              {navKeys.length === 0 && (
                <button
                  type="button"
                  disabled={!mayMenus}
                  onClick={() => setNavKeys([...visibleKeys])}
                  className="ctl-ghost"
                >
                  Escolher item a item
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

const BASE_LABEL: Record<string, string> = {
  DIRECTOR: "Academia",
  COORDINATOR: "Academia",
  COACH: "Por equipa",
  STAFF: "Por equipa",
  MEDICAL: "Academia (clínico)",
  SCOUT: "Academia (scouting)",
};

function SectionHead({ title, hint, subtle }: { title: string; hint?: string; subtle?: boolean }) {
  return (
    <div
      className={cx(
        "flex items-baseline justify-between gap-3 px-5 py-2.5",
        subtle ? "border-t border-line bg-sunken/40" : "bg-sunken/60",
      )}
    >
      <span className="text-group text-ink-3 uppercase">{title}</span>
      {hint && <span className="text-meta text-ink-4">{hint}</span>}
    </div>
  );
}

/**
 * Uma linha por área, três estados.
 *
 * "Ver" e "editar" não são independentes — não existe editar sem ver — e dois
 * interruptores deixavam exprimir esse estado impossível. Aqui o estado inválido
 * não é evitado por validação: não cabe na interface. É a mesma escolha do painel
 * de acesso por pessoa, e de propósito: quem já aprendeu um aprendeu o outro.
 */
function AreaList({
  areas,
  permissions,
  mine,
  onChange,
}: {
  areas: Area[];
  permissions: Set<Permission>;
  mine: Set<Permission>;
  onChange: (area: Area, level: Level) => void;
}) {
  return (
    <ul>
      {areas.map((area) => {
        const level = levelOf(area, permissions);
        // Só se dá o que se tem. Sem isto, a interface deixava escolher algo que o
        // servidor ia calar — e o papel gravava-se sem aquilo, sem explicação.
        const allowed = mine.has(area.read);

        const options: { value: Level; label: string }[] = [
          { value: "none", label: "Nada" },
          { value: "read", label: area.write ? "Ver" : "Sim" },
          ...(area.write && mine.has(area.write) ? [{ value: "write" as const, label: "Editar" }] : []),
        ];

        return (
          <li key={area.label} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="text-body font-medium text-ink">{area.label}</div>
              <div className="text-meta text-ink-3">{area.hint}</div>
            </div>

            {allowed ? (
              <div className="flex shrink-0 rounded-[var(--radius-control)] border border-line p-0.5">
                {options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => onChange(area, o.value)}
                    className={cx(
                      "rounded-[6px] px-2.5 py-1 text-meta font-medium transition-colors",
                      level === o.value ? "bg-ink text-surface" : "text-ink-3 hover:text-ink",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ) : (
              <Pill>não tens</Pill>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
        on ? "border-transparent bg-signal text-white" : "border-line-strong bg-surface",
        disabled && "opacity-40",
      )}
    >
      {on && <Check className="size-3" strokeWidth={3} />}
    </button>
  );
}

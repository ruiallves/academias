import { useMemo, useState } from "react";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { Pill, SelectField } from "./primitives";
import { AreaBlocks, NavPicker, SectionHead, applyLevel, possibleNavKeys } from "./PermissionPicker";
import type { Area, Level } from "@/lib/access";
import { SCOPE_HINT, useDepartments, type Department } from "@/lib/departments";
import { ROLE_PERMISSIONS, permissionsOf, type Permission, type Session } from "@/lib/permissions";
import { createRole, setRoleNav, updateRole, type AcademyRole } from "@/lib/roles";

/**
 * Criar e editar um cargo.
 *
 * ## A pergunta que este ecrã deixou de fazer
 *
 * Perguntava **Âmbito**: se a pessoa via o clube todo ou só as equipas dela. E
 * ninguém a percebia — com razão, porque não é uma pergunta sobre o cargo. "A
 * equipa técnica vê só as equipas dela" é uma decisão sobre a *área do clube*,
 * tomada uma vez, e não algo a repetir a cada fisioterapeuta que se contrata.
 *
 * A pergunta mudou de sítio, para `DepartmentDialog`. O que este ecrã pergunta
 * agora é a que departamento o cargo pertence — e daí vem tudo: o alcance, e o
 * ponto de partida das permissões.
 *
 * ## Herdar é um gesto, não uma ligação permanente
 *
 * Escolher o departamento **copia** as permissões dele para aqui, e a partir daí
 * este ecrã é o dono delas: tira-se e acrescenta-se à vontade, e as linhas que se
 * afastarem do que veio ficam marcadas com *alterado*. É o que responde ao caso
 * real — o fisioterapeuta-chefe é do departamento clínico e tem mais uma coisa
 * que os outros clínicos não têm.
 *
 * Se ficasse a apontar, editar o departamento mudava em silêncio o que dezenas de
 * pessoas podem fazer. Uma tabela de permissões não deve ter efeitos a essa
 * distância.
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
  /** Já escolhido: criar um cargo a partir de dentro de um departamento. */
  departmentId: inicial,
  onClose,
}: {
  /** Ausente = criar. */
  role?: AcademyRole;
  session: Session;
  departmentId?: string;
  onClose: () => void;
}) {
  const editing = Boolean(role);
  const { departments } = useDepartments();

  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [departmentId, setDepartmentId] = useState<string>(role?.departmentId ?? inicial ?? "");
  const [permissions, setPermissions] = useState<Set<Permission>>(
    () => new Set(role?.permissions ?? ROLE_PERMISSIONS["STAFF"]),
  );
  const [navKeys, setNavKeys] = useState<string[]>(role?.navKeys ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** O tecto: ninguém dá o que não tem, e o servidor recusa na mesma. */
  const mine = useMemo(() => permissionsOf(session), [session]);
  const mayMenus = mine.has("role:menu");
  const valid = name.trim().length >= 2;

  const dep: Department | undefined = departments.find((d) => d.id === departmentId);

  /** O que este cargo herdou, para as linhas alteradas se poderem marcar. */
  const inherited = useMemo(() => (dep ? new Set<Permission>(dep.permissions) : undefined), [dep]);

  /*
   * Escolher o departamento traz as permissões dele.
   *
   * Só ao escolher, e não continuamente: a partir daqui quem manda é este ecrã.
   * Ao editar um cargo que já existe, trocar de departamento também repõe — é a
   * leitura óbvia do gesto ("passou para o clínico"), e quem quiser guardar os
   * ajustes que tinha faz-nos outra vez à frente, a ver o que está a fazer.
   */
  function changeDepartment(next: string) {
    setDepartmentId(next);
    const d = departments.find((x) => x.id === next);
    if (d) setPermissions(new Set(d.permissions.filter((p) => mine.has(p))));
  }

  const setArea = (area: Area, level: Level) => setPermissions((current) => applyLevel(current, area, level));

  const visibleKeys = useMemo(() => possibleNavKeys(permissions), [permissions]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const chosen = [...permissions].filter((p) => mine.has(p));

      if (editing && role) {
        await updateRole(role.id, {
          name: name.trim(),
          description: description.trim(),
          departmentId: departmentId || null,
          permissions: chosen,
        });
        if (mayMenus) await setRoleNav(role.id, navKeys.filter((k) => visibleKeys.has(k)));
      } else {
        await createRole({
          name: name.trim(),
          description: description.trim(),
          departmentId: departmentId || null,
          /*
           * Só quando não há departamento.
           *
           * Com departamento, o servidor ignora o que aqui viesse e usa o alcance
           * do departamento — a decisão tem um dono só. Sem departamento não há
           * de onde herdar, e o cargo fica no mais fechado dos alcances.
           */
          baseRole: departmentId ? undefined : "STAFF",
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

  return (
    <Dialog
      title={editing ? `Editar ${role!.name}` : "Novo cargo"}
      subtitle={
        editing
          ? `${role!.people} ${role!.people === 1 ? "pessoa" : "pessoas"} com este cargo`
          : "Uma função dentro de um departamento"
      }
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
            {busy ? "A gravar…" : editing ? "Gravar" : "Criar cargo"}
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
            placeholder="Fisioterapeuta"
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

        {/*
          O departamento, que é de onde vem tudo.
          Substituiu a pergunta do "âmbito" — ver a nota no topo do ficheiro.
        */}
        <DialogField label="Departamento" hint="de onde herda o que pode">
          <SelectField
            className="w-full"
            value={departmentId}
            onChange={changeDepartment}
            options={[
              { value: "", label: "Sem departamento (presidência)" },
              ...departments.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        </DialogField>

        {dep ? (
          <p className="text-meta leading-relaxed text-ink-3">
            Herda de <span className="text-ink-2">{dep.name}</span>: {SCOPE_HINT[dep.baseRole]} Podes
            acrescentar ou tirar em baixo — as linhas que mudares ficam marcadas.
          </p>
        ) : (
          <p className="text-meta leading-relaxed text-ink-3">
            Sem departamento, este cargo não herda nada e vê apenas as equipas que lhe forem
            atribuídas. É o caso da presidência, que responde por tudo à parte.
          </p>
        )}
      </section>

      {/* --- 2. O que pode --------------------------------------------------- */}
      <section className="border-b border-line">
        <SectionHead title="O que pode" hint={dep ? `a partir de ${dep.name}` : "é isto que o servidor verifica"} />
        <AreaBlocks permissions={permissions} mine={mine} onChange={setArea} inherited={inherited} />
      </section>

      {/* --- 3. O que vê ----------------------------------------------------- */}
      <section>
        <SectionHead
          title="O que vê no menu"
          hint={navKeys.length === 0 ? "tudo o que a permissão deixar" : `${navKeys.length} escolhidos`}
        />

        <div className="px-5 pb-4 pt-3">
          {!mayMenus && editing && (
            <p className="mb-3 text-meta text-warn">Não tens permissão para configurar menus.</p>
          )}

          {!editing ? (
            <p className="text-meta leading-relaxed text-ink-3">
              Um cargo novo mostra tudo o que as permissões deixam. Os menus configuram-se depois de o
              criar.
            </p>
          ) : (
            <NavPicker navKeys={navKeys} setNavKeys={setNavKeys} possible={visibleKeys} disabled={!mayMenus} />
          )}
        </div>
      </section>

      {editing && role!.isSystem && (
        <div className="border-t border-line bg-sunken/50 px-5 py-3">
          <Pill>de origem</Pill>{" "}
          <span className="text-meta text-ink-3">
            Este cargo veio de origem. O nome e as permissões editam-se; apagar, não.
          </span>
        </div>
      )}
    </Dialog>
  );
}

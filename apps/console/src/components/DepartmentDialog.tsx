import { useMemo, useState } from "react";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx } from "./primitives";
import { AreaBlocks, NavPicker, SectionHead, applyLevel, possibleNavKeys } from "./PermissionPicker";
import type { Area, Level } from "@/lib/access";
import { ROLE_PERMISSIONS, permissionsOf, type Permission, type Role, type Session } from "@/lib/permissions";
import {
  SCOPE_CHOICES,
  SCOPE_HINT,
  createDepartment,
  removeDepartment,
  updateDepartment,
  type Department,
} from "@/lib/departments";

/**
 * Criar e editar um departamento.
 *
 * ## Este ecrã é o dono da pergunta que ninguém entendia
 *
 * O ecrã de criar um **cargo** perguntava "Âmbito" — se aquela pessoa via o clube
 * todo ou só as equipas dela — e a pergunta não fazia sentido onde estava. É uma
 * decisão sobre a área do clube, não sobre a pessoa: "a equipa técnica vê só as
 * equipas dela" decide-se uma vez, aqui, e todos os cargos lá dentro herdam-na.
 *
 * Por isso é que "Âmbito" saiu do outro ecrã e aparece neste — e só na criação,
 * porque mudá-lo depois mudava em silêncio o alcance de toda a gente do
 * departamento.
 *
 * ## Editar não muda ninguém sem se pedir
 *
 * Um cargo copia as permissões do departamento quando nasce; não fica a apontar.
 * Editar um departamento não deve, por isso, mexer calado no que dezenas de
 * pessoas já podem fazer. Quem edita vê quantos cargos herdaram deste e escolhe
 * se leva a mudança até eles — com o número à frente, antes de decidir.
 */
export function DepartmentDialog({
  department,
  session,
  onClose,
}: {
  /** Ausente = criar. */
  department?: Department;
  session: Session;
  onClose: () => void;
}) {
  const editing = Boolean(department);

  const [name, setName] = useState(department?.name ?? "");
  const [description, setDescription] = useState(department?.description ?? "");
  /*
   * `COACH` por omissão: o mais fechado dos dois alcances.
   *
   * Era `STAFF`, que deixou de ser uma das opções quando a escolha passou a ser
   * binária — e um ecrã que abre sem nenhum botão marcado faz parecer que a
   * pergunta ainda não foi respondida quando na verdade já tem valor. Entre os
   * dois, o que vê menos é o que se pode alargar depois sem surpresas.
   */
  const [baseRole, setBaseRole] = useState<Role>(department?.baseRole ?? "COACH");
  const [permissions, setPermissions] = useState<Set<Permission>>(
    () => new Set(department?.permissions ?? ROLE_PERMISSIONS["COACH"]),
  );
  const [navKeys, setNavKeys] = useState<string[]>(department?.navKeys ?? []);
  const [applyToRoles, setApplyToRoles] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** O tecto: ninguém dá o que não tem, e o servidor recusa na mesma. */
  const mine = useMemo(() => permissionsOf(session), [session]);
  const mayMenus = mine.has("role:menu");
  const valid = name.trim().length >= 2;

  /** Cargos que herdaram daqui e que uma gravação com `applyToRoles` iria mexer. */
  const herdeiros = department?.roles.length ?? 0;

  /*
   * Trocar de âmbito repõe as permissões pelo ponto de partida desse âmbito.
   * Só na criação: já criado, o âmbito é imutável.
   */
  function changeScope(next: Role) {
    setBaseRole(next);
    setPermissions(new Set(ROLE_PERMISSIONS[next].filter((p) => mine.has(p))));
  }

  const setArea = (area: Area, level: Level) =>
    setPermissions((current) => applyLevel(current, area, level));

  const visibleKeys = useMemo(() => possibleNavKeys(permissions), [permissions]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const chosen = [...permissions].filter((p) => mine.has(p));
      const menus = navKeys.filter((k) => visibleKeys.has(k));

      if (editing && department) {
        await updateDepartment(department.id, {
          name: name.trim(),
          description: description.trim(),
          permissions: chosen,
          navKeys: menus,
          applyToRoles,
        });
      } else {
        await createDepartment({
          name: name.trim(),
          description: description.trim(),
          baseRole,
          permissions: chosen,
          navKeys: menus,
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  async function apagar() {
    setBusy(true);
    setError(null);
    try {
      await removeDepartment(department!.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível apagar.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={editing ? `Editar ${department!.name}` : "Novo departamento"}
      subtitle={
        editing
          ? `${herdeiros} ${herdeiros === 1 ? "cargo" : "cargos"} · ${department!.people} ${department!.people === 1 ? "pessoa" : "pessoas"}`
          : "Uma área do clube: o que vê e o que faz"
      }
      onClose={onClose}
      width={620}
      labelledBy="department-dialog"
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          {editing && !error && (
            <button
              type="button"
              className="mr-auto text-meta text-ink-3 underline-offset-2 hover:text-risk hover:underline"
              onClick={() => setConfirmar(true)}
            >
              Apagar departamento
            </button>
          )}
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!valid || busy} onClick={() => void save()}>
            {busy ? "A gravar…" : editing ? "Gravar" : "Criar departamento"}
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
            placeholder="Departamento Clínico"
            className={dialogInputClass}
          />
        </DialogField>

        <DialogField label="Descrição" hint="opcional">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="O que esta área do clube faz"
            className={dialogInputClass}
          />
        </DialogField>

        {/*
          O âmbito, e só aqui.
          Saiu do ecrã dos cargos porque lá não se entendia — e não se entendia
          porque não era uma pergunta sobre o cargo. Uma vez, sobre a área.
        */}
        {editing ? (
          <p className="text-meta text-ink-3">
            Alcance: <span className="text-ink-2">{SCOPE_HINT[department!.baseRole]}</span> Não se muda
            depois de criado — mudaria o que toda a gente deste departamento consegue ver, sem ninguém
            tocar em pessoa nenhuma.
          </p>
        ) : (
          <DialogField label="Alcance" hint="não se muda depois">
            {/*
              Duas opções, cada uma com a sua frase — e não seis botões com
              quatro nomes repetidos, que era o que estava aqui. Ver a nota longa
              em `SCOPE_CHOICES`.

              A frase vive **dentro** de cada opção e não numa linha por baixo
              que muda com a selecção: para escolher, é preciso comparar as duas,
              e não se compara o que não está no ecrã ao mesmo tempo.
            */}
            <div className="grid gap-1.5">
              {SCOPE_CHOICES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => changeScope(o.value)}
                  aria-pressed={baseRole === o.value}
                  className={cx(
                    "rounded-[var(--radius-control)] border px-3 py-2 text-left transition-colors",
                    baseRole === o.value
                      ? "border-transparent bg-ink text-surface"
                      : "border-line hover:border-line-strong",
                  )}
                >
                  <span className="block text-body font-medium">{o.label}</span>
                  <span
                    className={cx(
                      "mt-0.5 block text-meta",
                      baseRole === o.value ? "text-surface/70" : "text-ink-3",
                    )}
                  >
                    {o.hint}
                  </span>
                </button>
              ))}
            </div>
          </DialogField>
        )}
      </section>

      {/* --- 2. O que pode --------------------------------------------------- */}
      <section className="border-b border-line">
        <SectionHead title="O que pode" hint="é isto que o servidor verifica" />
        <AreaBlocks permissions={permissions} mine={mine} onChange={setArea} />
      </section>

      {/* --- 3. O que vê ----------------------------------------------------- */}
      <section className={editing && herdeiros > 0 ? "border-b border-line" : undefined}>
        <SectionHead
          title="O que vê no menu"
          hint={navKeys.length === 0 ? "tudo o que a permissão deixar" : `${navKeys.length} escolhidos`}
        />
        <div className="px-5 pb-4 pt-3">
          {!mayMenus && <p className="mb-3 text-meta text-warn">Não tens permissão para configurar menus.</p>}
          <NavPicker navKeys={navKeys} setNavKeys={setNavKeys} possible={visibleKeys} disabled={!mayMenus} />
        </div>
      </section>

      {/* --- 4. Levar aos cargos --------------------------------------------- */}
      {editing && herdeiros > 0 && (
        <section className="px-5 py-4">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={applyToRoles}
              onChange={(e) => setApplyToRoles(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--signal)]"
            />
            <span className="text-body text-ink-2">
              Aplicar estas permissões aos {herdeiros} {herdeiros === 1 ? "cargo" : "cargos"} deste
              departamento
              <span className="mt-0.5 block text-meta text-ink-3">
                Sem isto, os cargos ficam como estão — cada um guarda as permissões com que foi
                configurado. Com isto, passam todos a ter exactamente estas.
              </span>
            </span>
          </label>
        </section>
      )}

      {/* --- Apagar ----------------------------------------------------------- */}
      {confirmar && (
        <section className="border-t border-line bg-sunken/50 px-5 py-4">
          <p className="text-body text-ink">Apagar {department!.name}?</p>
          <p className="mt-1 text-meta leading-relaxed text-ink-3">
            {herdeiros === 0
              ? "Não tem cargos. Some e mais nada."
              : `Os ${herdeiros} ${herdeiros === 1 ? "cargo fica" : "cargos ficam"} sem departamento, mas ${herdeiros === 1 ? "continua" : "continuam"} a existir e com as permissões que ${herdeiros === 1 ? "tem" : "têm"}. Ninguém perde acesso por apagares isto.`}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="ctl-ghost" onClick={() => setConfirmar(false)}>
              Não apagar
            </button>
            <button type="button" className="ctl-risk" disabled={busy} onClick={() => void apagar()}>
              {busy ? "A apagar…" : "Apagar"}
            </button>
          </div>
        </section>
      )}
    </Dialog>
  );
}

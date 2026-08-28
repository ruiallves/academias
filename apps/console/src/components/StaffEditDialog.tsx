import { useState, type FormEvent } from "react";
import { ASSIGNABLE_ROLES, DEPARTMENTS, updateStaff } from "@/lib/staff";
import { apiDelete, apiPatch } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { can, type Role, type Session } from "@/lib/permissions";
import { ROLE_LABEL } from "@/session";
import { DEPARTMENT_LABEL, type StaffDepartment, type StaffMember } from "@/data/types";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { SelectField } from "./primitives";
import { Trash2 } from "@/lib/icons";

/**
 * Editar a ficha de uma pessoa.
 *
 * ## Duas coisas separadas, outra vez
 *
 * O **cargo** ("Treinador adjunto") é texto livre e diz o que a pessoa faz. O
 * **acesso** é o papel, e decide o que ela pode fazer no produto. Aqui editam-se
 * os dois, mas o papel só aparece a quem tem `access:write` — corrigir um
 * telemóvel e promover alguém a diretor não podem ser a mesma autorização.
 *
 * ## O que já não se edita aqui
 *
 * As **equipas**. Estavam neste formulário, entre o telemóvel e o botão de
 * apagar — e não são um dado da pessoa, são a atribuição da época. Quem quer
 * pôr um treinador num escalão não abre "editar ficha"; agora tem um painel
 * próprio na ficha e o mesmo gesto do lado da equipa. Ver `TeamStaffDialog`.
 */
export function StaffEditDialog({
  member,
  session,
  onClose,
}: {
  member: StaffMember;
  session: Session;
  onClose: () => void;
}) {
  const mayChangeAccess = can(session, "access:write");

  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
  const [phone, setPhone] = useState(member.phone);
  const [title, setTitle] = useState(member.title);
  const [department, setDepartment] = useState<StaffDepartment>(member.department);
  const [role, setRole] = useState<Role>(member.role);
  const [isActive, setIsActive] = useState(member.isActive);
  const [erro, setErro] = useState<string | null>(null);
  const [aApagar, setAApagar] = useState(false);

  const usesTeams = role === "COACH" || role === "STAFF" || role === "COORDINATOR";
  const valid = name.trim().length >= 2 && title.trim().length >= 2;

  /**
   * Apagar a conta — o irmão do "já não trabalha na academia" logo abaixo.
   *
   * Existe para o convite aceite com o nome errado e para a conta criada duas
   * vezes: casos em que desactivar deixa na lista uma pessoa que nunca existiu.
   * Assim que houver trabalho em nome dela, o servidor recusa e diz o quê — ver
   * `removeMembership`. Não se tenta adivinhar isso aqui: a consola não sabe
   * quantos treinos alguém marcou, e um botão escondido por engano deixa quem lá
   * está sem perceber porquê.
   */
  async function apagar() {
    if (aApagar) return;
    if (!confirm(`Apagar a conta de ${member.name}? Se já tiver trabalho em nome dela, o servidor recusa e explica.`)) return;
    setAApagar(true);
    setErro(null);
    try {
      await apiDelete(`/api/memberships/${member.id}`);
      await reloadAcademy();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível apagar a conta.");
      setAApagar(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;

    /*
     * Desactivar tem de chegar ao servidor.
     *
     * Esta caixa vivia só em memória: tirava a pessoa das listas neste
     * separador e mais nada — ela continuava a entrar na consola, e recarregar
     * a página desfazia tudo. `isActive` na `Membership` é o que o
     * `AuthService` verifica, e é isso que fecha mesmo a porta.
     */
    if (isActive !== member.isActive) {
      try {
        await apiPatch(`/api/memberships/${member.id}/active`, { active: isActive });
      } catch (err) {
        setErro(err instanceof Error ? err.message : "Não foi possível mudar o estado da conta.");
        return;
      }
    }

    /*
     * Mudar de papel para um que não usa equipas larga as que a pessoa tinha.
     *
     * Este é o único caso em que este formulário ainda toca em equipas, e não é
     * uma edição de equipas: é a consequência de a pessoa deixar de ser
     * treinador. Deixá-las lá dava um director com âmbito de dados de dois
     * escalões e nada no ecrã a dizê-lo. A escolha de *quais* equipas mudou-se
     * para o painel próprio — ver `TeamStaffDialog`.
     */
    if (mayChangeAccess && !usesTeams && member.teamIds.length > 0) {
      try {
        await apiPatch(`/api/staff/${member.id}/teams`, { teamIds: [] });
        await reloadAcademy();
      } catch (err) {
        setErro(err instanceof Error ? err.message : "Não foi possível largar as equipas.");
        return;
      }
    }

    updateStaff(member.id, {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      title: title.trim(),
      department,
      isActive,
      // O papel só muda se quem está a editar o pode mudar. A interface já o
      // esconde; isto é o que impede que um estado antigo do formulário o altere
      // à mesma. As equipas só se largam — nunca se escolhem aqui.
      ...(mayChangeAccess ? { role, ...(usesTeams ? {} : { teamIds: [] }) } : {}),
    });
    onClose();
  }

  return (
    <Dialog
      labelledBy="editar-staff"
      title="Editar ficha"
      subtitle={member.name}
      onClose={onClose}
      width={520}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {/* À esquerda e afastado do "Guardar": é destrutivo, não é o gesto normal. */}
          {mayChangeAccess ? (
            <button type="button" onClick={() => void apagar()} disabled={aApagar} className="ctl-ghost text-risk">
              <Trash2 className="size-3.5" strokeWidth={1.75} />
              {aApagar ? "A apagar…" : "Apagar conta"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost">
              Cancelar
            </button>
            <button type="submit" form="form-staff" className="ctl-primary" disabled={!valid}>
              Guardar
            </button>
          </div>
        </div>
      }
    >
      <form id="form-staff" onSubmit={submit} className="space-y-4 p-5">
        <DialogField label="Nome">
          <input className={dialogInputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </DialogField>

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="E-mail">
            <input type="email" className={dialogInputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
          </DialogField>
          <DialogField label="Telemóvel">
            <input type="tel" className={dialogInputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </DialogField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Cargo" hint="o que faz">
            <input className={dialogInputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
          </DialogField>
          <DialogField label="Departamento">
            <SelectField
              className="w-full"
              value={department}
              onChange={setDepartment}
              options={DEPARTMENTS.map((d) => ({ value: d, label: DEPARTMENT_LABEL[d] }))}
            />
          </DialogField>
        </div>

        {mayChangeAccess ? (
          <>
            <DialogField label="Acesso" hint="o que pode fazer no produto">
              <SelectField
                className="w-full"
                value={role}
                onChange={(r) => setRole(r)}
                options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
              />
            </DialogField>

            {/*
              As equipas saíram daqui.

              Vivem agora num painel próprio na ficha da pessoa, e na página da
              equipa do outro lado — ver `TeamStaffDialog`. Isto é "editar
              ficha": serve para corrigir um nome, um email, um telemóvel. Que
              escalões alguém treina não é um dado da pessoa, é a atribuição do
              ano, e ninguém a procurava dentro de um formulário com este nome.
            */}
            {usesTeams && (
              <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-2">
                As equipas de {member.name.split(" ")[0]} mudam-se no painel <strong className="font-medium text-ink">Equipas</strong>{" "}
                da ficha, ou a partir da página da própria equipa.
              </p>
            )}
          </>
        ) : (
          <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-2">
            O acesso e as equipas são geridos por quem trata de permissões na academia.
          </p>
        )}

        {erro && (
          <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2.5 text-meta leading-relaxed text-risk">
            {erro}
          </p>
        )}

        <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-control)] border border-line px-3 py-2.5">
          <input
            type="checkbox"
            checked={!isActive}
            onChange={(e) => setIsActive(!e.target.checked)}
            className="mt-0.5 size-3.5 accent-[var(--color-signal)]"
          />
          <span className="min-w-0">
            <span className="block text-body text-ink">Já não trabalha na academia</span>
            {/*
              Desactivar e não apagar: o histórico de quem treinou o quê tem de
              continuar a fazer sentido depois de a pessoa sair. Apagar reescrevia
              o passado dos atletas que ela acompanhou.
            */}
            <span className="block text-meta leading-relaxed text-ink-3">
              Sai das listas e perde o acesso, mas continua no histórico das equipas que treinou.
            </span>
          </span>
        </label>
      </form>
    </Dialog>
  );
}

import { useState, type FormEvent } from "react";
import { listTeams } from "@/lib/api";
import { teamAgeLabel } from "@/lib/team-age";
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
 * As **equipas** seguem a mesma regra do convite: são âmbito de dados, não uma
 * etiqueta. Por isso só quem pode mexer em acessos as pode mudar.
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
  const teams = listTeams(session);
  const mayChangeAccess = can(session, "access:write");

  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
  const [phone, setPhone] = useState(member.phone);
  const [title, setTitle] = useState(member.title);
  const [department, setDepartment] = useState<StaffDepartment>(member.department);
  const [role, setRole] = useState<Role>(member.role);
  const [teamIds, setTeamIds] = useState<string[]>(member.teamIds);
  const [isActive, setIsActive] = useState(member.isActive);
  const [erro, setErro] = useState<string | null>(null);
  const [aApagar, setAApagar] = useState(false);

  const usesTeams = role === "COACH" || role === "STAFF" || role === "COORDINATOR";
  const valid = name.trim().length >= 2 && title.trim().length >= 2;

  function toggleTeam(id: string) {
    setTeamIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  }

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
     * As equipas também têm de chegar ao servidor — e pela mesma razão.
     *
     * Ficavam em memória: a ficha mostrava a equipa, o `TeamStaff` continuava
     * vazio, e nada mais no produto sabia da atribuição. O treino da equipa
     * continuava a dizer "sem treinador" no calendário e nas presenças, e o
     * próprio treinador entrava sem âmbito nenhum — `AuthService.scopeFor`
     * deriva-o daqui. Recarregar a consola desfazia tudo.
     */
    const finais = usesTeams ? teamIds : [];
    const mudou =
      finais.length !== member.teamIds.length || finais.some((id) => !member.teamIds.includes(id));
    if (mayChangeAccess && mudou) {
      try {
        await apiPatch(`/api/staff/${member.id}/teams`, { teamIds: finais });
        await reloadAcademy();
      } catch (err) {
        setErro(err instanceof Error ? err.message : "Não foi possível guardar as equipas.");
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
      // Papel e equipas só mudam se quem está a editar os pode mudar. A interface
      // já os esconde; isto é o que impede que um estado antigo do formulário os
      // altere à mesma.
      ...(mayChangeAccess ? { role, teamIds: usesTeams ? teamIds : [] } : {}),
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

            {usesTeams && (
              <div>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-meta font-medium text-ink">Equipas</span>
                  <span className="text-[11px] text-ink-4">
                    {teamIds.length === 0 ? "nenhuma" : `${teamIds.length} de ${teams.length}`}
                  </span>
                </div>
                <div className="max-h-44 overflow-y-auto rounded-[var(--radius-control)] border border-line">
                  {teams.map((t) => (
                    <label
                      key={t.id}
                      className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0 hover:bg-sunken"
                    >
                      <input
                        type="checkbox"
                        checked={teamIds.includes(t.id)}
                        onChange={() => toggleTeam(t.id)}
                        className="size-3.5 accent-[var(--color-signal)]"
                      />
                      <span className="min-w-0 flex-1 truncate text-body text-ink">{t.name}</span>
                      <span className="text-meta text-ink-4">{teamAgeLabel(t.maxAge)}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                  As equipas decidem que atletas esta pessoa vê — incluindo presenças, avaliações e
                  boletim clínico.
                </p>
              </div>
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

import { useMemo, useState, type FormEvent } from "react";
import { academy, listTeams } from "@/lib/api";
import { createInvite, type Invite } from "@/lib/invites";
import { Check, Copy, Users } from "@/lib/icons";
import type { Role, Session } from "@/lib/permissions";
import { ROLE_LABEL } from "@/session";
import { DEPARTMENT_LABEL, type StaffDepartment } from "@/data/types";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { SelectField } from "./primitives";

/**
 * Convidar alguém para a academia.
 *
 * ## Porque é que as equipas se escolhem aqui, e não do outro lado
 *
 * Podia parecer mais simpático deixar o treinador escolher as suas equipas ao
 * criar a conta — ele é que sabe o que treina. Mas neste produto as equipas de um
 * treinador **são** o acesso dele aos dados: quem está numa equipa vê os atletas,
 * as presenças, as avaliações e o boletim clínico deles. Se a escolha estivesse do
 * lado de quem resgata, quem apanhasse o link — e estes links viajam por WhatsApp
 * — escolhia o que podia ver, e podia marcar a academia toda.
 *
 * Por isso quem convida é que decide, e quem resgata só confirma. É também como se
 * pensa naturalmente: não se convida "um treinador", convida-se "o Rui, treinador
 * principal dos Sub-11".
 *
 * ## Porque é que não se envia o email daqui
 *
 * Devolve-se um link para copiar. A academia sabe melhor do que nós por onde
 * falar com cada pessoa — muitas tratam tudo por WhatsApp, e um email automático
 * numa caixa que ninguém abre é um convite que nunca chega.
 */

/** Os papéis que se convidam por aqui, do mais restrito ao mais amplo. */
const INVITABLE: Role[] = ["COACH", "MEDICAL", "STAFF", "COORDINATOR", "DIRECTOR"];

/** Gémeo de `RANK` em `apps/api/src/invites/invites.service.ts`. Não se convida acima do próprio nível. */
const RANK: Record<Role, number> = {
  OWNER: 100,
  DIRECTOR: 80,
  COORDINATOR: 60,
  MEDICAL: 40,
  COACH: 40,
  STAFF: 20,
  GUARDIAN: 0,
  ATHLETE: 0,
};

/** O departamento que costuma acompanhar cada papel — sugestão, não regra. */
const DEFAULT_DEPARTMENT: Partial<Record<Role, StaffDepartment>> = {
  COACH: "technical",
  MEDICAL: "clinical",
  STAFF: "operations",
  COORDINATOR: "technical",
  DIRECTOR: "direction",
};

/** Só quem trabalha com equipas tem âmbito por equipa. */
function usesTeams(role: Role): boolean {
  return role === "COACH" || role === "STAFF";
}

export function InviteDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const teams = listTeams(session);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("COACH");
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState<StaffDepartment>("technical");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [created, setCreated] = useState<Invite | null>(null);

  const allowed = useMemo(() => INVITABLE.filter((r) => RANK[r] <= RANK[session.role]), [session.role]);

  const valid = name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  function changeRole(next: Role) {
    setRole(next);
    const dept = DEFAULT_DEPARTMENT[next];
    if (dept) setDepartment(dept);
    // Um médico não tem equipas — vê a academia toda. Guardar a selecção anterior
    // ao mudar de papel seria emitir um convite com âmbito que não se aplica.
    if (!usesTeams(next)) setTeamIds([]);
  }

  function toggleTeam(id: string) {
    setTeamIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setCreated(
      createInvite({
        name,
        email,
        role,
        title,
        department,
        teamIds: usesTeams(role) ? teamIds : [],
        invitedBy: session.name,
      }),
    );
  }

  // Emitido: a partir daqui o assunto é só o link.
  if (created) return <InviteCreated invite={created} onClose={onClose} />;

  return (
    <Dialog
      labelledBy="convidar"
      title="Convidar para a academia"
      subtitle={academy.name}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-convite" className="ctl-primary" disabled={!valid}>
            Gerar convite
          </button>
        </>
      }
    >
      <form id="form-convite" onSubmit={submit} className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Nome">
            <input
              className={dialogInputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Rui Machado"
              autoFocus
            />
          </DialogField>
          <DialogField label="E-mail" hint="o convite fica preso a este endereço">
            <input
              type="email"
              className={dialogInputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="rui@exemplo.pt"
            />
          </DialogField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Acesso" hint="o que pode fazer">
            <SelectField
              className="w-full"
              value={role}
              onChange={changeRole}
              options={allowed.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            />
          </DialogField>
          <DialogField label="Departamento">
            <SelectField
              className="w-full"
              value={department}
              onChange={setDepartment}
              options={(Object.keys(DEPARTMENT_LABEL) as StaffDepartment[]).map((d) => ({
                value: d,
                label: DEPARTMENT_LABEL[d],
              }))}
            />
          </DialogField>
        </div>

        <DialogField label="Cargo" hint="opcional">
          <input
            className={dialogInputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Treinador principal"
          />
        </DialogField>

        {usesTeams(role) ? (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-meta font-medium text-ink">Equipas</span>
              <span className="text-[11px] text-ink-4">
                {teamIds.length === 0 ? "nenhuma" : `${teamIds.length} de ${teams.length}`}
              </span>
            </div>

            <div className="max-h-48 overflow-y-auto rounded-[var(--radius-control)] border border-line">
              {teams.map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0 hover:bg-sunken"
                >
                  <input
                    type="checkbox"
                    checked={teamIds.includes(t.id)}
                    onChange={() => toggleTeam(t.id)}
                    className="size-3.5 accent-[var(--signal)]"
                  />
                  <span className="min-w-0 flex-1 truncate text-body text-ink">{t.name}</span>
                  <span className="text-meta text-ink-4">{t.ageGroup}</span>
                </label>
              ))}
            </div>

            {/*
              A frase importa mais do que parece: é aqui que se explica que a
              escolha não é administrativa, é de acesso a dados.
            */}
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              {teamIds.length === 0
                ? "Sem equipas, entra e não vê atletas nenhuns. Podes atribuir depois."
                : "Vê os atletas, presenças, avaliações e boletim clínico destas equipas — e de mais nenhuma."}
            </p>
          </div>
        ) : (
          <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-2">
            {role === "MEDICAL"
              ? "O departamento clínico vê a academia toda — uma lesão não conhece escalões."
              : "Este acesso não é limitado por equipas."}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/**
 * O link, uma vez.
 *
 * Não há "mostrar outra vez": no servidor guarda-se só o hash do token, por isso
 * ninguém — nem nós — o consegue reconstruir. Quem perder o link revoga e emite
 * outro, e é dito aqui para não parecer uma falha da interface.
 */
function InviteCreated({ invite, onClose }: { invite: Invite; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sem permissão de área de transferência: o link está à vista para copiar à mão */
    }
  }

  return (
    <Dialog
      labelledBy="convite-criado"
      title="Convite criado"
      subtitle={`${invite.name} · ${ROLE_LABEL[invite.role]}`}
      onClose={onClose}
      width={520}
      footer={
        <button type="button" onClick={onClose} className="ctl-primary">
          Concluído
        </button>
      }
    >
      <div className="space-y-4 p-5">
        <p className="text-body leading-relaxed text-ink-2">
          Envia este link ao <strong className="font-medium text-ink">{invite.name}</strong>. Ao abri-lo,
          escolhe uma palavra-passe e a conta fica criada.
        </p>

        {/*
          Enquanto a consola correr com dados de demonstração, este link é o
          endereço que a academia terá em produção — mas o convite não chegou à
          base de dados, por isso não abre. Dizê-lo aqui é o mínimo: um link com
          ar de verdadeiro que dá 404 faz perder muito mais tempo do que este aviso.
        */}
        <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-2">
          <strong className="font-medium text-ink">Demonstração:</strong> este link mostra o endereço
          que a academia terá, mas ainda não abre — a consola corre com dados de exemplo. Para um
          convite que funcione mesmo, corre <code className="font-mono text-[11px]">npm run invite</code> em{" "}
          <code className="font-mono text-[11px]">apps/api</code>.
        </p>

        <div className="rounded-[var(--radius-control)] border border-line bg-sunken p-3">
          <code className="block break-all font-mono text-[12px] leading-relaxed text-ink">{invite.link}</code>
          <button type="button" onClick={copy} className="ctl-ghost mt-2.5 w-full justify-center">
            {copied ? (
              <>
                <Check className="size-3.5" strokeWidth={2} />
                Copiado
              </>
            ) : (
              <>
                <Copy className="size-3.5" strokeWidth={1.75} />
                Copiar link
              </>
            )}
          </button>
        </div>

        <ul className="space-y-1.5 text-meta leading-relaxed text-ink-3">
          <li>· Válido durante 7 dias, e só pode ser usado uma vez.</li>
          <li>· Só funciona para {invite.email} — quem o abrir não pode trocar o endereço.</li>
          <li>· Guarda-o agora: por segurança, o link não volta a ser mostrado.</li>
        </ul>
      </div>
    </Dialog>
  );
}

/** Ícone de equipas, para o vazio da lista de convites. */
export const InviteEmptyIcon = Users;

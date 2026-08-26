import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { academy, listTeams } from "@/lib/api";
import { createInvite, type Invite } from "@/lib/invites";
import { useDepartments, loadDepartments } from "@/lib/departments";
import { loadRoles, useRoles, type AcademyRole } from "@/lib/roles";
import { Check, Copy, Users } from "@/lib/icons";
import type { Role, Session } from "@/lib/permissions";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { SelectField } from "./primitives";

/**
 * Convidar alguém para a academia.
 *
 * ## Duas perguntas, e não três
 *
 * Isto pedia **acesso**, **departamento** e **cargo**. As duas primeiras eram a
 * mesma pergunta por palavras diferentes — "acesso: Direção" a par de
 * "departamento: Direção" — e a terceira era texto livre que não decidia nada.
 * Quem convidava tinha de perceber que a primeira dava permissões e a terceira
 * era decoração, e nada no ecrã o dizia.
 *
 * Agora pergunta-se o **departamento** e, dentro dele, o **cargo**. O cargo é um
 * `AcademyRole` — a coisa que já carregava as permissões — e é dele que o
 * servidor lê o papel-base, o departamento e o que a pessoa vai poder fazer. Um
 * departamento tem vários cargos; um cargo pertence a um departamento só.
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
 * ## Porque é que não se envia o email daqui
 *
 * Devolve-se um link para copiar. A academia sabe melhor do que nós por onde
 * falar com cada pessoa — muitas tratam tudo por WhatsApp, e um email automático
 * numa caixa que ninguém abre é um convite que nunca chega.
 */

/** Gémeo de `RANK` em `apps/api/src/invites/invites.service.ts`. */
const RANK: Record<Role, number> = {
  OWNER: 100,
  DIRECTOR: 80,
  COORDINATOR: 60,
  MEDICAL: 40,
  SCOUT: 40,
  COACH: 40,
  STAFF: 20,
  GUARDIAN: 0,
  ATHLETE: 0,
};

/**
 * Um grupo no menu de departamentos.
 *
 * O id de um departamento a sério, ou `"presidencia"` — que não é um
 * departamento: é onde vive o cargo que não pertence a nenhum. Ver `departamentos`.
 */
type Grupo = string;

/** O grupo dos cargos sem departamento. Um id nunca colide com isto. */
const PRESIDENCIA = "presidencia";

/** Só quem trabalha com equipas tem âmbito por equipa. */
function usesTeams(base: Role): boolean {
  return base === "COACH" || base === "STAFF";
}

export function InviteDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const teams = listTeams(session);
  const { roles, loaded } = useRoles();
  const { departments } = useDepartments();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState<Grupo>("");
  const [roleId, setRoleId] = useState("");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [created, setCreated] = useState<Invite | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadRoles();
    void loadDepartments();
  }, []);

  /*
   * Os cargos que **este** utilizador pode dar.
   *
   * ## O presidente, e porque é que às vezes aparece
   *
   * Um clube pode abrir com quem não é o presidente — o coordenador desportivo
   * que monta tudo enquanto o presidente ainda não entrou. Nesse caso o cargo de
   * Presidente existe e está **vazio**, e alguém tem de o poder convidar; sem
   * isto, o clube ficava para sempre sem presidente e sem forma de lá chegar.
   *
   * Assim que essa cadeira estiver ocupada (`people > 0`), o cargo desaparece
   * daqui: um clube tem um presidente, e convidar um segundo é o tipo de coisa
   * que se faz por engano e depois ninguém percebe.
   *
   * Os que estão acima do próprio nível saem sempre — a mesma regra que o
   * servidor volta a aplicar, aqui só para não oferecer o que vai ser recusado.
   */
  const convidaveis = useMemo(
    () =>
      roles.filter((r) => {
        if (r.key === "presidente" && r.people > 0) return false;
        return RANK[r.baseRole] <= RANK[session.role];
      }),
    [roles, session.role],
  );

  /**
   * Os departamentos que têm mesmo cargos — não vale a pena oferecer os vazios.
   *
   * `"presidencia"` é um grupo à parte e não um departamento a sério: o
   * presidente responde por tudo e não pertence a nenhuma área, por isso tem
   * `department: null` na base de dados. Sem este grupo, um cargo sem
   * departamento não tinha onde aparecer no menu.
   */
  const departamentos = useMemo(() => {
    const usados = new Set(convidaveis.map((r) => r.departmentId).filter(Boolean));
    const reais = departments.filter((d) => usados.has(d.id)).map((d) => d.id);
    const semDepartamento = convidaveis.some((r) => r.departmentId === null);
    return [...(semDepartamento ? [PRESIDENCIA] : []), ...reais];
  }, [convidaveis, departments]);

  /** O nome a mostrar para um grupo. Os ids não se mostram a ninguém. */
  const nomeDoGrupo = useCallback(
    (g: Grupo) => (g === PRESIDENCIA ? "Presidência" : (departments.find((d) => d.id === g)?.name ?? "Departamento")),
    [departments],
  );

  const cargosDoDepartamento = useMemo(
    () =>
      convidaveis.filter((r) =>
        department === PRESIDENCIA ? r.departmentId === null : r.departmentId === department,
      ),
    [convidaveis, department],
  );

  // O primeiro departamento que tenha cargos, e o primeiro cargo dele. Sem isto,
  // o formulário abria num departamento vazio e parecia não ter cargos nenhuns.
  useEffect(() => {
    if (departamentos.length > 0 && !departamentos.includes(department)) {
      setDepartment(departamentos[0]);
    }
  }, [departamentos, department]);

  useEffect(() => {
    if (!cargosDoDepartamento.some((r) => r.id === roleId)) {
      setRoleId(cargosDoDepartamento[0]?.id ?? "");
    }
  }, [cargosDoDepartamento, roleId]);

  const cargo: AcademyRole | undefined = convidaveis.find((r) => r.id === roleId);
  const comEquipas = cargo ? usesTeams(cargo.baseRole) : false;

  const valid = name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && Boolean(roleId);

  function toggleTeam(id: string) {
    setTeamIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setErro(null);
    try {
      setCreated(
        await createInvite({
          name: name.trim(),
          email: email.trim(),
          academyRoleId: roleId,
          teamIds: comEquipas ? teamIds : [],
        }),
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível criar o convite.");
    } finally {
      setBusy(false);
    }
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
          <button type="submit" form="form-convite" className="ctl-primary" disabled={!valid || busy}>
            {busy ? "A criar…" : "Gerar convite"}
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

        {loaded && convidaveis.length === 0 ? (
          /*
           * Um clube acabado de abrir só tem o cargo de presidente, e esse não se
           * convida. Dizer o que falta — e levar lá — é melhor do que dois menus
           * vazios que parecem avariados.
           */
          <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-2">
            Ainda não há cargos para convidar.{" "}
            <Link to="/definicoes?painel=cargos" className="font-medium text-ink hover:underline">
              Cria o primeiro nas definições
            </Link>{" "}
            — por exemplo "Treinador", no departamento da equipa técnica.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <DialogField label="Departamento">
                <SelectField
                  className="w-full"
                  value={department}
                  onChange={setDepartment}
                  options={departamentos.map((d) => ({ value: d, label: nomeDoGrupo(d) }))}
                />
              </DialogField>

              <div>
                {/*
                  O atalho vive por cima do campo, à direita: é onde se olha
                  quando o menu não tem o que se procura, e evita fechar o
                  diálogo às cegas para ir procurar as definições.
                */}
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-meta font-medium text-ink">Cargo</span>
                  <Link to="/definicoes?painel=cargos" className="text-[11px] text-ink-3 hover:text-ink hover:underline">
                    gerir cargos
                  </Link>
                </div>
                <SelectField
                  className="w-full"
                  value={roleId}
                  onChange={setRoleId}
                  options={cargosDoDepartamento.map((r) => ({ value: r.id, label: r.name }))}
                />
              </div>
            </div>

            {cargo?.description && <p className="text-[11px] leading-relaxed text-ink-3">{cargo.description}</p>}

            {comEquipas ? (
              <div>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-meta font-medium text-ink">Equipas</span>
                  <span className="flex items-center gap-2.5">
                    <span className="text-[11px] text-ink-4">
                      {teamIds.length === 0 ? "nenhuma" : `${teamIds.length} de ${teams.length}`}
                    </span>
                    <Link to="/equipas" className="text-[11px] text-ink-3 hover:text-ink hover:underline">
                      gerir equipas
                    </Link>
                  </span>
                </div>

                {teams.length === 0 ? (
                  <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-2">
                    Ainda não há equipas. Podes convidar na mesma — a pessoa entra sem ver atletas, e atribuis-lhe
                    equipas quando existirem.
                  </p>
                ) : (
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
                )}

                {/*
                  A frase importa mais do que parece: é aqui que se explica que a
                  escolha não é administrativa, é de acesso a dados.
                */}
                {teams.length > 0 && (
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                    {teamIds.length === 0
                      ? "Sem equipas, entra e não vê atletas nenhuns. Podes atribuir depois."
                      : "Vê os atletas, presenças, avaliações e boletim clínico destas equipas — e de mais nenhuma."}
                  </p>
                )}
              </div>
            ) : (
              cargo && (
                <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-2">
                  {cargo.baseRole === "MEDICAL"
                    ? "O departamento clínico vê a academia toda — uma lesão não conhece escalões."
                    : "Este cargo vê a academia toda, não é limitado por equipas."}
                </p>
              )
            )}
          </>
        )}

        {erro && (
          <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2.5 text-meta leading-relaxed text-risk">
            {erro}
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
      subtitle={`${invite.name} · ${invite.title ?? ""}`}
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

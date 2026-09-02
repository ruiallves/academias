import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { academy, listTeams } from "@/lib/api";
import { teamAgeLabel } from "@/lib/team-age";
import { createInvite, type Invite } from "@/lib/invites";
import { useDepartments, loadDepartments } from "@/lib/departments";
import { loadRoles, useRoles, type AcademyRole } from "@/lib/roles";
import { Check, Copy, TriangleAlert, Users } from "@/lib/icons";
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
 * ## O email sai, e o link fica na mesma
 *
 * O servidor manda o convite para o endereço indicado (ver `mail.client.ts`) e
 * diz aqui se saiu. Mas o link continua à vista para copiar, e isso não é
 * redundância: muitos clubes tratam tudo por WhatsApp, e um email numa caixa que
 * ninguém abre é um convite que nunca chega. Quem convida escolhe o caminho —
 * o que não pode é ficar sem saber se o automático funcionou.
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
 * O id de um departamento a sério, ou `SEM_DEPARTAMENTO` — que não é um
 * departamento: é onde vive o cargo que não pertence a nenhum. Ver `departamentos`.
 */
type Grupo = string;

/**
 * O grupo dos cargos sem departamento. Um id nunca colide com isto.
 *
 * Chamava-se "Presidência" aqui e "Sem departamento" nas Definições — o mesmo
 * grupo com dois nomes, em dois ecrãs que a mesma pessoa usa a seguir um ao
 * outro. E o nome daqui só estava certo por acaso: assim que um clube apaga um
 * departamento, os cargos dele caem neste grupo (`onDelete: SetNull`), e passava
 * a haver um "Dep. Scouting" arrumado debaixo de "Presidência". Um nome só, e o
 * das Definições, que é onde isto se gere.
 */
const SEM_DEPARTAMENTO = "sem-departamento";

/** Só quem trabalha com equipas tem âmbito por equipa. */
function usesTeams(base: Role): boolean {
  return base === "COACH" || base === "STAFF";
}

export function InviteDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const teams = listTeams(session);
  const { roles, loaded } = useRoles();
  const { departments, loaded: departamentosLidos } = useDepartments();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState<Grupo>("");
  const [roleId, setRoleId] = useState("");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [created, setCreated] = useState<Invite | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Os dois em paralelo, e não um a seguir ao outro.
   *
   * Chegaram a ser em série, para garantir que a lista de cargos vinha depois da
   * reparação que a leitura dos departamentos faz. Custava o dobro: 1,7 s → 3,3 s
   * de espera, medidos, num diálogo que já demorava. A garantia passou para o
   * servidor — as duas leituras reparam (ver `departments/first-role.ts`) — e a
   * ordem de chegada deixou de importar.
   *
   * Na página do Staff isto já foi carregado ao entrar, por isso quase sempre
   * não se espera por nada: o `store` responde do que tem enquanto relê.
   */
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
   * Os departamentos, tal como estão nas Definições.
   *
   * ## Porque é que são todos, e não só os que têm cargos
   *
   * Eram só os que tinham cargos convidáveis — "não vale a pena oferecer os
   * vazios". Parecia arrumado e era um buraco: quem criava um departamento novo
   * vinha a seguir convidar alguém para lá e **o departamento não estava na
   * lista**. Nada no ecrã dizia porquê, e a conclusão razoável era que a criação
   * não tinha funcionado.
   *
   * Um menu que esconde o que o utilizador acabou de criar não está a poupar-lhe
   * uma linha: está a mentir-lhe sobre o estado do clube. Agora aparecem todos,
   * e o que falta a cada um diz-se lá dentro — ver `faltaNoDepartamento`.
   *
   * (O servidor passou a dar um primeiro cargo a cada departamento que nasce, por
   * isso o caso vazio ficou raro. Raro não é impossível: os cargos podem estar
   * todos arquivados, ou todos acima do nível de quem convida.)
   *
   * `SEM_DEPARTAMENTO` é um grupo à parte e não um departamento a sério: é onde
   * caem os cargos com `departmentId: null` — o presidente, que não pertence a
   * área nenhuma, e os que sobraram de um departamento apagado. Sem este grupo,
   * um cargo sem departamento não tinha onde aparecer.
   */
  const departamentos = useMemo(() => {
    const semDepartamento = convidaveis.some((r) => r.departmentId === null);
    /* No fim, como nas Definições: é o grupo dos que sobram, não o primeiro. */
    return [...departments.map((d) => d.id), ...(semDepartamento ? [SEM_DEPARTAMENTO] : [])];
  }, [convidaveis, departments]);

  /** O nome a mostrar para um grupo. Os ids não se mostram a ninguém. */
  const nomeDoGrupo = useCallback(
    (g: Grupo) => (g === SEM_DEPARTAMENTO ? "Sem departamento" : (departments.find((d) => d.id === g)?.name ?? "Departamento")),
    [departments],
  );

  const cargosDoDepartamento = useMemo(
    () =>
      convidaveis.filter((r) =>
        department === SEM_DEPARTAMENTO ? r.departmentId === null : r.departmentId === department,
      ),
    [convidaveis, department],
  );

  /**
   * O que falta a este departamento para se poder convidar alguém para ele.
   *
   * Três estados, e são três frases diferentes porque são três problemas
   * diferentes: um resolve-se nas Definições, outro resolve-se com quem está
   * acima, e o terceiro não é problema nenhum.
   */
  const faltaNoDepartamento = useMemo(() => {
    if (department === SEM_DEPARTAMENTO || cargosDoDepartamento.length > 0) return null;
    const d = departments.find((x) => x.id === department);
    /* Tem cargos, mas nenhum que **eu** possa dar: é hierarquia, não configuração. */
    if (d && d.roles.length > 0) return "acima";
    return "sem-cargos";
  }, [department, cargosDoDepartamento, departments]);

  /*
   * Abrir num departamento que dê para usar.
   *
   * A lista passou a incluir os vazios, e abrir num vazio era pôr o problema à
   * frente de quem se calhar nem ia por ali. Escolhe-se o primeiro que tenha
   * cargos convidáveis; se não houver nenhum, o primeiro da lista — e aí a
   * mensagem lá dentro explica o que falta.
   */
  useEffect(() => {
    if (departamentos.length === 0 || departamentos.includes(department)) return;
    const comCargos = departamentos.find((g) =>
      convidaveis.some((r) => (g === SEM_DEPARTAMENTO ? r.departmentId === null : r.departmentId === g)),
    );
    setDepartment(comCargos ?? departamentos[0]);
  }, [departamentos, department, convidaveis]);

  useEffect(() => {
    if (!cargosDoDepartamento.some((r) => r.id === roleId)) {
      setRoleId(cargosDoDepartamento[0]?.id ?? "");
    }
  }, [cargosDoDepartamento, roleId]);

  /*
   * Só se desenha a escolha quando as **duas** listas chegaram.
   *
   * São dois pedidos independentes e o ecrã depende dos dois cruzados: os
   * departamentos dizem que grupos existem, os cargos dizem o que há dentro de
   * cada um. Com um só, tudo o que se mostrasse estaria errado durante o tempo
   * que o outro demorasse — e demora, porque cada leitura destas custa perto de
   * um segundo e meio.
   */
  const pronto = loaded && departamentosLidos;

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

        {!pronto ? (
          /*
           * Enquanto não estiverem os dois, um esqueleto — e não os campos a
           * meio.
           *
           * Meio segundo com uma das listas por chegar bastava para o ecrã
           * mentir: os menus apareciam vazios, o "Departamento" enchia-se
           * primeiro e o "Cargo" só a seguir, e a mensagem sobre o que falta ao
           * departamento chegava a passar pela frase errada — "os cargos estão
           * acima do teu nível", quando o que se passava era não terem ainda
           * chegado. Um esqueleto da altura certa não diz nada de falso e não
           * deixa a caixa saltar quando os dados entram.
           */
          <div className="grid grid-cols-2 gap-3" aria-hidden>
            {[0, 1].map((i) => (
              <div key={i}>
                <div className="mb-1.5 h-3 w-20 rounded bg-sunken" />
                <div className="h-9 w-full animate-pulse rounded-[var(--radius-control)] bg-sunken" />
              </div>
            ))}
          </div>
        ) : convidaveis.length === 0 ? (
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
                {faltaNoDepartamento ? (
                  /*
                   * No lugar do menu, e não por baixo dele: um `<select>` vazio
                   * a par de uma explicação é um controlo que convida a ser
                   * carregado e não faz nada.
                   */
                  <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2 text-[11px] leading-relaxed text-ink-2">
                    {faltaNoDepartamento === "acima" ? (
                      "Os cargos deste departamento estão acima do teu nível — só quem estiver acima os pode dar."
                    ) : (
                      <>
                        Ainda não tem cargos.{" "}
                        <Link to="/definicoes?painel=cargos" className="font-medium text-ink hover:underline">
                          Cria um nas definições
                        </Link>
                        .
                      </>
                    )}
                  </p>
                ) : (
                  <SelectField
                    className="w-full"
                    value={roleId}
                    onChange={setRoleId}
                    options={cargosDoDepartamento.map((r) => ({ value: r.id, label: r.name }))}
                  />
                )}
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
                          className="size-3.5 accent-[var(--color-signal)]"
                        />
                        <span className="min-w-0 flex-1 truncate text-body text-ink">{t.name}</span>
                        <span className="text-meta text-ink-4">{teamAgeLabel(t.maxAge)}</span>
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
        {/*
          O que aconteceu ao email, primeiro.
          É a pergunta que quem convida tem na cabeça neste momento — "já foi?" — e
          a resposta muda o que ela faz a seguir: fechar a janela, ou copiar o link
          e mandá-lo por outro caminho.
        */}
        {invite.emailed ? (
          <div className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-ok/25 bg-ok-soft p-3">
            <Check className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={2} />
            <p className="text-body leading-relaxed text-ink-2">
              Convite enviado para <strong className="font-medium text-ink">{invite.email}</strong>. O link
              abaixo é o mesmo, para o caso de preferires mandá-lo por outro caminho.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-warn/25 bg-warn-soft p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={1.9} />
            <div className="space-y-0.5">
              <p className="text-body leading-relaxed text-ink-2">
                O convite foi criado, mas o email não saiu. Manda-lhe o link tu.
              </p>
              {invite.emailError && <p className="text-meta text-ink-3">{invite.emailError}</p>}
            </div>
          </div>
        )}

        <p className="text-body leading-relaxed text-ink-2">
          Ao abrir o link, <strong className="font-medium text-ink">{invite.name}</strong> escolhe uma
          palavra-passe e a conta fica criada.
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

import { useMemo, useState } from "react";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx } from "./primitives";
import { TriangleAlert } from "@/lib/icons";
import { AreaBlocks, NavPicker, SectionHead, applyLevel, possibleNavKeys } from "./PermissionPicker";
import type { Area, Level } from "@/lib/access";
import { ROLE_PERMISSIONS, permissionsOf, type Permission, type Role, type Session } from "@/lib/permissions";
import {
  SCOPE_CHOICES,
  escolhaDoAlcance,
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
 * Por isso é que "Âmbito" saiu do outro ecrã e aparece neste.
 *
 * ## O alcance também se edita
 *
 * Esteve só na criação, com o argumento de que mudá-lo depois mudaria em
 * silêncio o alcance de toda a gente do departamento. Não muda: o alcance é
 * **copiado** em cadeia, não seguido. O cargo copia-o do departamento ao
 * nascer, e a pessoa copia-o do cargo ao recebê-lo — um pedido lê o que está na
 * membership, e não o que está aqui.
 *
 * O que a proibição fazia era prender um departamento criado com o alcance
 * errado, com a única saída a ser criar outro e mudar os cargos de sítio. Agora
 * edita-se, e o ecrã diz até onde a mudança chega.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** O tecto: ninguém dá o que não tem, e o servidor recusa na mesma. */
  const mine = useMemo(() => permissionsOf(session), [session]);
  const mayMenus = mine.has("role:menu");
  const valid = name.trim().length >= 2;

  /** Cargos que herdaram daqui e que uma gravação com `applyToRoles` iria mexer. */
  const herdeiros = department?.roles.length ?? 0;

  /** Mudou o alcance em relação ao que estava gravado? Decide o aviso e o envio. */
  const alcanceMudou = editing && baseRole !== department!.baseRole;

  /**
   * Qual dos dois botões está marcado.
   *
   * Pelo **comportamento** do papel guardado, e não pelo nome: o seletor tem
   * duas opções e o campo guarda seis papéis. O Departamento Clínico é
   * `MEDICAL`, a Direção é `DIRECTOR`, o Scouting é `SCOUT` — nenhum deles é
   * `COORDINATOR`, e comparar por igualdade deixava os três a abrir **sem nada
   * marcado**. Ver `escolhaDoAlcance`.
   */
  const marcado = escolhaDoAlcance(baseRole);

  /*
   * Trocar de alcance repõe as permissões pelo ponto de partida desse alcance.
   *
   * **Só na criação.** A editar, mexer no alcance não pode deitar fora as
   * permissões que alguém afinou à mão — seriam duas mudanças por um clique, e
   * a segunda invisível até se fechar o diálogo.
   */
  function changeScope(next: Role) {
    /*
     * Carregar no botão que já está marcado não muda nada.
     *
     * E "nada" quer mesmo dizer nada: um Departamento Clínico continua
     * `MEDICAL`, e não passa a `COORDINATOR` só porque os dois vêem o clube
     * todo. `MEDICAL` não é só um alcance — é o que abre o boletim clínico sem
     * o médico ter de estar atribuído a equipas (ver `clinical.service.ts`).
     * Trocá-lo por um sinónimo de âmbito calava essa parte.
     *
     * Pela mesma razão, voltar atrás devolve o papel original em vez do
     * genérico: quem trocou por engano e desfez fica com o que tinha.
     */
    const gravado = department?.baseRole;
    const alvo = gravado && escolhaDoAlcance(gravado) === next ? gravado : next;

    setBaseRole(alvo);
    if (!editing) setPermissions(new Set(ROLE_PERMISSIONS[alvo].filter((p) => mine.has(p))));
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
          /* Só quando mudou: quem não lhe toca não o manda. */
          ...(alcanceMudou ? { baseRole } : {}),
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
        <DialogField label="Alcance" hint={editing ? "muda o ponto de partida dos cargos" : "o que esta área do clube vê"}>
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
                aria-pressed={marcado === o.value}
                className={cx(
                  "rounded-[var(--radius-control)] border px-3 py-2 text-left transition-colors",
                  marcado === o.value
                    ? "border-transparent bg-ink text-surface"
                    : "border-line hover:border-line-strong",
                )}
              >
                <span className="block text-body font-medium">{o.label}</span>
                <span
                  className={cx(
                    "mt-0.5 block text-meta",
                    marcado === o.value ? "text-surface/70" : "text-ink-3",
                  )}
                >
                  {o.hint}
                </span>
              </button>
            ))}
          </div>

          {/*
            Até onde é que a mudança chega — dito no momento em que se muda, e
            não depois. O alcance é copiado em cadeia: quem já tem um cargo
            deste departamento continua a ver o que via, e é isso que costuma
            apanhar as pessoas de surpresa.
          */}
          {alcanceMudou && (
            <p className="mt-2 rounded-[var(--radius-control)] bg-sunken px-3 py-2 text-meta leading-relaxed text-ink-3">
              Os cargos <strong className="font-medium text-ink-2">novos</strong> deste departamento passam a
              partir daqui.
              {herdeiros > 0 && " Os que já existem só mudam se levares a mudança até eles, em baixo."}
              {department!.people > 0 &&
                ` E quem já tem um cargo deste departamento (${department!.people} ${department!.people === 1 ? "pessoa" : "pessoas"}) mantém o alcance que tem até lhe ser atribuído o cargo outra vez.`}
            </p>
          )}
        </DialogField>
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
              className="mt-0.5 size-4 accent-[var(--color-signal)]"
            />
            <span className="text-body text-ink-2">
              Aplicar {alcanceMudou ? "estas permissões e o alcance" : "estas permissões"} aos {herdeiros}{" "}
              {herdeiros === 1 ? "cargo" : "cargos"} deste departamento
              <span className="mt-0.5 block text-meta text-ink-3">
                Sem isto, os cargos ficam como estão — cada um guarda as permissões com que foi
                configurado. Com isto, passam todos a ter exactamente estas.
                {alcanceMudou &&
                  " O alcance novo vale para quem receber estes cargos a partir de agora; quem já os tem mantém o que tem."}
              </span>
            </span>
          </label>
        </section>
      )}
    </Dialog>
  );
}

/**
 * Apagar um departamento.
 *
 * ## Porque é que isto é um ecrã e não um botão dentro de "editar"
 *
 * Estava no rodapé do ecrã de editar, e a confirmação abria **no fundo do
 * corpo** — um sítio que, num diálogo com quatro secções, fica fora da vista.
 * Carregava-se em "Apagar departamento" e não acontecia nada de visível, o que
 * é indistinguível de um botão avariado.
 *
 * E não é o mesmo assunto: editar é mexer no que uma área do clube pode fazer;
 * apagar é fazê-la desaparecer. Vive na lista, ao lado do departamento, que é
 * onde se decide o que existe.
 */
export function DeleteDepartmentDialog({
  department,
  onClose,
  onDeleted,
}: {
  department: Department;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cargos = department.roles.length;

  async function apagar() {
    setBusy(true);
    setError(null);
    try {
      await removeDepartment(department.id);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível apagar.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={`Apagar ${department.name}?`}
      subtitle={`${cargos} ${cargos === 1 ? "cargo" : "cargos"} · ${department.people} ${department.people === 1 ? "pessoa" : "pessoas"}`}
      icon={<TriangleAlert className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={440}
      labelledBy="apagar-departamento"
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          <button type="button" className="ctl-ghost" onClick={onClose} disabled={busy}>
            Não apagar
          </button>
          <button type="button" className="ctl-risk" disabled={busy} onClick={() => void apagar()}>
            {busy ? "A apagar…" : "Apagar departamento"}
          </button>
        </>
      }
    >
      <div className="space-y-2 px-5 py-4">
        <p className="text-body leading-relaxed text-ink-2">
          {cargos === 0
            ? "Não tem cargos. Some e mais nada."
            : cargos === 1
              ? "O cargo lá dentro é apagado com ele."
              : `Os ${cargos} cargos lá dentro são apagados com ele.`}
        </p>
        {/*
          O que acontece às pessoas, em duas frases que se lêem por esta ordem:
          primeiro o que perdem, porque é o que assusta; depois o que não
          perdem, porque é o que decide se se carrega no botão.
        */}
        {department.people > 0 && (
          <p className="text-body leading-relaxed text-ink-2">
            {department.people === 1 ? "Uma pessoa fica" : `As ${department.people} pessoas ficam`}{" "}
            <strong className="font-medium text-ink">sem cargo</strong>.
          </p>
        )}
        {department.people > 0 && (
          <p className="text-meta leading-relaxed text-ink-3">
            Ninguém perde o acesso: sem cargo, cada pessoa fica com o que o papel-base lhe dá. Um presidente continua
            presidente. Podes dar-lhes outro cargo quando quiseres, na ficha de cada uma.
          </p>
        )}
      </div>
    </Dialog>
  );
}

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DialogField, dialogInputClass } from "@/components/Dialog";
import { Empty, Loading, Monogram, Panel, PanelHead, Pill, cx, type Tone } from "@/components/primitives";
import { ArrowLeft, Check, ChevronDown, CircleCheck, Mail, MapPin, Pencil, Phone, Trash2, Wallet } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { money } from "@/lib/format";
import {
  DOC_LABEL,
  PERIOD_LABEL,
  SEX_LABEL,
  STATUS_LABEL,
  ageOf,
  getMember,
  listTiers,
  removeMember,
  updateMember,
  type DocumentKind,
  type MemberDetail as Data,
  type MemberStatus,
  type MemberTier,
  type Sex,
  inviteMember,
  linkMemberAccount,
  unlinkMemberAccount,
  listMemberFees,
  reopenFee,
  settleFee,
  voidFee,
  type MemberFeeRow,
} from "@/lib/members";

/**
 * A ficha do sócio.
 *
 * ## Porquê uma página e não uma janela
 *
 * Porque um sócio tem tanto para ver como um atleta: dados pessoais, quota,
 * consentimentos, historial de decisões. Um diálogo obriga a escolher metade e a
 * deixar o resto de fora — e, sobretudo, não tem endereço: não se manda a ficha de
 * um sócio a um colega, não se abre em separador, não se volta atrás. As fichas de
 * atleta e de staff são páginas pela mesma razão.
 *
 * ## O que é sensível fica aqui e não na lista
 *
 * Documento, morada e contribuinte. Uma tabela com o cartão de cidadão de
 * trezentas pessoas é uma tabela que alguém fotografa por engano; aqui abre-se uma
 * pessoa de cada vez, e é isso que torna o acesso deliberado.
 */
export default function MemberDetail() {
  const { id = "" } = useParams();
  const { session } = useSession();

  const [m, setM] = useState<Data | null>(null);
  const [tiers, setTiers] = useState<MemberTier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const mayWrite = can(session, "member:write");

  const load = useCallback(() => {
    getMember(id)
      .then(setM)
      .catch((e: unknown) => {
        setNotFound(true);
        setError(e instanceof Error ? e.message : "Não foi possível carregar.");
      });
    void listTiers().then(setTiers).catch(() => {});
  }, [id]);

  useEffect(load, [load]);

  async function set(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await updateMember(id, body);
      load();
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <>
        <Back />
        <Panel>
          <div>
            <Empty title="Sócio não encontrado" detail={error ?? "Ou não pertence a este clube."} />
          </div>
        </Panel>
      </>
    );
  }

  if (!m) {
    return (
      <>
        <Back />
        <Panel>
          <Loading />
        </Panel>
      </>
    );
  }

  return (
    <>
      <Back />

      <header className="mb-5 flex flex-wrap items-center gap-4">
        <Monogram name={m.name} size="lg" />

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <StatusPill status={m.status} />
            {/* `break-words`: um nome de categoria escrito sem espaços não tem onde
                quebrar por omissão, e um só item de uma linha flexível não encolhe
                abaixo do seu conteúdo — fica a espreitar para fora da ficha. */}
            {m.tier && <span className="max-w-full break-words text-meta text-ink-3">{m.tier.name}</span>}
            {m.source === "site" && <span className="text-meta text-ink-4">· inscrição pelo site</span>}
          </div>
          <h1 className="break-words text-page text-ink">{m.name}</h1>
          <p className="mt-0.5 text-body text-ink-3">
            {m.number ? `Sócio n.º ${m.number}` : "Sem número atribuído"}
            {m.birthdate ? ` · ${ageOf(m.birthdate)} anos` : ""}
          </p>
        </div>

        {/* As acções de estado ao lado do nome: é a decisão que se vem cá tomar. */}
        {mayWrite && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {!editing && (
              <button type="button" className="ctl-ghost" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" strokeWidth={1.75} />
                Editar
              </button>
            )}
            {/*
              Uma inscrição por aprovar mantém o botão à vista.

              É a única decisão desta página que tem pressa — alguém está à espera
              do lado de lá — e escondê-la dentro de um menu de estados fazia dela
              mais uma opção entre três. Depois de aprovado deixa de aparecer, e o
              menu passa a ser o único sítio onde o estado se mexe.
            */}
            {m.status === "PENDING" && (
              <button type="button" className="ctl-primary" disabled={busy} onClick={() => void set({ status: "ACTIVE" })}>
                <Check className="size-3.5" strokeWidth={2.25} />
                Aprovar sócio
              </button>
            )}
            <MemberStatusMenu member={m} onChanged={load} />
          </div>
        )}
      </header>

      {m.status === "PENDING" && (
        <div className="mb-3 rounded-[var(--radius-panel)] border border-line bg-warn-soft px-5 py-3 text-meta leading-relaxed text-warn">
          Inscreveu-se pela página do clube a {new Date(m.createdAt).toLocaleDateString("pt-PT")} e espera
          aprovação. Ao aprovar, recebe o próximo número de sócio livre.
        </div>
      )}

      {editing ? (
        <EditPanel
          member={m}
          onDone={() => {
            setEditing(false);
            load();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-3">
            <Panel>
              <PanelHead title="Dados pessoais" />
              <dl className="grid gap-x-6 px-5 py-1.5 sm:grid-cols-2">
                <Fact label="Data de nascimento">
                  {m.birthdate ? (
                    `${new Date(m.birthdate).toLocaleDateString("pt-PT")} · ${ageOf(m.birthdate)} anos`
                  ) : (
                    <PorPreencher />
                  )}
                </Fact>
                <Fact label="Sexo">{SEX_LABEL[m.sex]}</Fact>
                <Fact label={DOC_LABEL[m.documentKind]}>{m.documentNumber ?? <PorPreencher />}</Fact>
                <Fact label="Contribuinte">
                  {m.taxId ? <span className="tabular">{m.taxId}</span> : <PorPreencher />}
                </Fact>
              </dl>
            </Panel>

            <Panel>
              <PanelHead title="Contactos" />
              <dl className="px-5 py-1.5">
                <Fact label="E-mail" icon={Mail} wide>
                  <a href={`mailto:${m.email}`} className="hover:underline">
                    {m.email}
                  </a>
                </Fact>
                <Fact label="Telemóvel" icon={Phone} wide>
                  <a href={`tel:${m.phoneCountry}${m.phone}`} className="tabular hover:underline">
                    {m.phoneCountry} {m.phone}
                  </a>
                </Fact>
                <Fact label="Morada" icon={MapPin} wide>
                  {m.address}
                  <span className="block text-ink-3">
                    {m.postalCode} {m.city} · {m.country}
                  </span>
                </Fact>
              </dl>
            </Panel>
          </div>

          <div className="space-y-3">
            <QuotaPanel member={m} tiers={tiers} mayWrite={mayWrite} busy={busy} onChange={set} />

            <QuotasLancadasPanel memberId={m.id} mayWrite={mayWrite} />

            <AppDoClubePanel member={m} mayWrite={mayWrite} onChanged={load} />

            <Panel>
              <PanelHead title="Consentimentos" hint="com data" />
              <ul className="px-5 py-2.5">
                <Consent label="Termos e condições" at={m.acceptedTermsAt} />
                <Consent label="Comunicações dos parceiros" at={m.partnerCommsAt} />
                <Consent label="Partilha de dados com parceiros" at={m.partnerDataAt} />
              </ul>
              <p className="border-t border-line px-5 py-2.5 text-meta leading-relaxed text-ink-3">
                Guardam-se com a data, e não como um sim: é a data que demonstra o consentimento se alguém
                perguntar com que base o clube comunica.
              </p>
            </Panel>

            <Panel>
              <PanelHead title="Histórico" />
              <ul className="px-5 py-2.5">
                <Event label="Inscreveu-se" at={m.createdAt} note={m.source === "site" ? "pela página do clube" : undefined} />
                {m.approvedAt && (
                  <Event label="Aprovado" at={m.approvedAt} note={m.approvedBy ? `por ${m.approvedBy}` : undefined} />
                )}
              </ul>
            </Panel>

            {mayWrite && m.status !== "CANCELLED" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void set({ status: "CANCELLED" })}
                className="w-full py-2 text-meta font-medium text-ink-3 hover:text-risk"
              >
                Cancelar inscrição de sócio
              </button>
            )}
          </div>
        </div>
      )}

      {m.notes && (
        <Panel className="mt-3">
          <PanelHead title="Notas" />
          <p className="px-5 py-4 text-body leading-relaxed whitespace-pre-line text-ink-2">{m.notes}</p>
        </Panel>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A quota.
 *
 * ## O que este painel diz, e o que não diz
 *
 * Diz o que o sócio **deve pagar** — o valor e a periodicidade da categoria — e
 * quando é a próxima renovação, calculada a partir da data de aprovação. Isso sai
 * de dados reais.
 *
 * O que **não** diz é se já pagou. A plataforma ainda não emite cobranças de
 * quota: as mensalidades que existem são as dos atletas, ligadas a `Charge`, e um
 * sócio não é um atleta. Escrever aqui "em dia" sem uma cobrança por trás seria
 * inventar — e é o tipo de número que um clube usa para decidir quem vota numa
 * assembleia.
 */
/**
 * As quotas lançadas — o livro, não a configuração.
 *
 * O painel de cima ("Quota") diz quanto a categoria custa; este diz o que foi
 * mesmo cobrado e o que falta. Liquidar aqui é o balcão — numerário ou
 * transferência; o pagamento online liquida sozinho pelo webhook, e o botão de
 * gerar vive na lista de sócios porque se gera para o clube inteiro.
 */
function QuotasLancadasPanel({ memberId, mayWrite }: { memberId: string; mayWrite: boolean }) {
  const [fees, setFees] = useState<MemberFeeRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    listMemberFees(memberId)
      .then(setFees)
      .catch((e: Error) => setErro(e.message));
  }, [memberId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function agir(id: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(id);
    setErro(null);
    try {
      await fn();
      carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível.");
    } finally {
      setBusy(null);
    }
  }

  const TONE: Record<MemberFeeRow["status"], Tone> = { OPEN: "warn", SETTLED: "ok", VOID: "neutral" };
  const LABEL: Record<MemberFeeRow["status"], string> = { OPEN: "Por pagar", SETTLED: "Paga", VOID: "Anulada" };

  return (
    <Panel>
      <PanelHead title="Quotas lançadas" hint={fees ? `${fees.length}` : undefined} />
      {erro && <p className="px-5 pt-2 text-meta text-risk">{erro}</p>}
      {fees === null ? (
        <p className="px-5 py-3 text-meta text-ink-3">A carregar…</p>
      ) : fees.length === 0 ? (
        <p className="px-5 py-3 text-meta leading-relaxed text-ink-3">
          Ainda nenhuma. Gera-se na lista de sócios — "Gerar quotas" lança a do período corrente a
          todos os activos com categoria.
        </p>
      ) : (
        <ul className="px-5 py-1.5">
          {fees.map((f) => (
            <li key={f.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">{f.label ?? f.period}</span>
                <span className="block text-meta text-ink-3">
                  {money(f.amountCents)}
                  {f.status === "SETTLED" && f.method === "CASH" && " · numerário"}
                  {f.status === "SETTLED" && f.method === "TRANSFER" && " · transferência"}
                  {f.status === "SETTLED" && f.method === "MBWAY" && " · MB Way"}
                  {f.status === "SETTLED" && f.method === "MULTIBANCO" && " · Multibanco"}
                </span>
              </span>
              <Pill tone={TONE[f.status]}>{LABEL[f.status]}</Pill>
              {mayWrite && f.status === "OPEN" && (
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy === f.id}
                    onClick={() => void agir(f.id, () => settleFee(f.id, "CASH"))}
                    className="ctl-ghost"
                    title="Recebido em numerário ao balcão"
                  >
                    Numerário
                  </button>
                  <button
                    type="button"
                    disabled={busy === f.id}
                    onClick={() => void agir(f.id, () => settleFee(f.id, "TRANSFER"))}
                    className="ctl-ghost"
                    title="Recebido por transferência"
                  >
                    Transf.
                  </button>
                  <button
                    type="button"
                    disabled={busy === f.id}
                    onClick={() => void agir(f.id, () => voidFee(f.id))}
                    className="ctl-ghost text-risk"
                    title="Anular — foi gerada por engano ou o sócio saiu"
                  >
                    Anular
                  </button>
                </span>
              )}
              {mayWrite && f.status !== "OPEN" && f.method !== "MBWAY" && f.method !== "MULTIBANCO" && (
                <button
                  type="button"
                  disabled={busy === f.id}
                  onClick={() => void agir(f.id, () => reopenFee(f.id))}
                  className="ctl-ghost shrink-0"
                  title="Reabrir — foi marcada por engano"
                >
                  Reabrir
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * A conta na app do clube.
 *
 * Três estados possíveis, e o painel diz sempre em qual se está: conta ligada
 * (a ficha foi reclamada), convite enviado à espera, ou nada ainda. O convite
 * sai sozinho na criação manual e na aprovação; este botão é para os sócios
 * que já existiam antes da app, e para reenviar quando o email se perdeu.
 */
function AppDoClubePanel({ member, mayWrite, onChanged }: { member: Data; mayWrite: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  /* Um invólucro só, para as três acções darem a resposta no mesmo sítio. */
  async function agir(fn: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setResultado(null);
    try {
      setResultado(await fn());
      onChanged();
    } catch (e) {
      setResultado(e instanceof Error ? e.message : "Não foi possível.");
    } finally {
      setBusy(false);
    }
  }

  const convidar = async () => `Convite enviado para ${(await inviteMember(member.id)).email}.`;

  const ligar = async () => {
    const r = await linkMemberAccount(member.id);
    return `Ligado à conta de ${r.name} (${r.email}). Já pode trocar para a área de sócio na app.`;
  };

  const unlink = async () => {
    await unlinkMemberAccount(member.id);
    return "Conta desligada — o sócio deixa de ver a área de sócio na app.";
  };

  return (
    <Panel>
      <PanelHead title="App do clube" />
      <div className="space-y-2 px-5 py-3">
        {member.userId ? (
          <>
            <p className="flex items-center gap-2 text-body text-ink-2">
              <CircleCheck className="size-4 shrink-0 text-ok" strokeWidth={1.75} />
              Conta ligada — este sócio já vê a área de sócio na app.
            </p>
            {mayWrite && (
              <button type="button" className="ctl-ghost" disabled={busy} onClick={() => void agir(unlink)}>
                Desligar a conta
              </button>
            )}
          </>
        ) : (
          <>
            <p className="text-meta leading-relaxed text-ink-3">
              {member.inviteSentAt
                ? "Convite enviado, à espera que crie a conta."
                : "Ainda sem conta na app do clube."}
            </p>
            {mayWrite && (
              <div className="flex flex-wrap items-center gap-2">
                {/*
                  Duas coisas diferentes, e por isso dois botões.
                  "Ligar" reconhece uma conta que já existe (o pai que também é
                  sócio, e que já tem a app instalada); "convite" **cria** a
                  conta de quem ainda não a tem, e por isso manda email.
                */}
                <button type="button" className="ctl-outline" disabled={busy} onClick={() => void agir(ligar)}>
                  Ligar a conta existente
                </button>
                <button type="button" className="ctl-ghost" disabled={busy} onClick={() => void agir(convidar)}>
                  <Mail className="size-3.5" strokeWidth={1.75} />
                  {member.inviteSentAt ? "Reenviar convite" : "Enviar convite"}
                </button>
              </div>
            )}
          </>
        )}
        {resultado && <p className="text-meta text-ink-2">{resultado}</p>}
      </div>
    </Panel>
  );
}

function QuotaPanel({
  member,
  tiers,
  mayWrite,
  busy,
  onChange,
}: {
  member: Data;
  tiers: MemberTier[];
  mayWrite: boolean;
  busy: boolean;
  onChange: (body: Record<string, unknown>) => void;
}) {
  const renewal = nextRenewal(member);

  return (
    <Panel>
      <PanelHead title="Quota" hint={member.tier ? PERIOD_LABEL[member.tier.period] : undefined} />

      <div className="px-5 py-4">
        <div className="flex items-baseline gap-2">
          <span className="text-metric text-ink tabular">
            {member.tier?.feeCents != null ? money(member.tier.feeCents) : "—"}
          </span>
          {member.tier && <span className="text-meta text-ink-3">{PERIOD_LABEL[member.tier.period]}</span>}
        </div>

        {member.tier?.feeCents == null && (
          <p className="mt-1 text-meta text-ink-3">
            {member.tier ? "A categoria ainda não tem valor definido." : "Sem categoria atribuída."}
          </p>
        )}

        {renewal && (
          <p className="mt-1 text-meta text-ink-3">
            Próxima renovação a <span className="text-ink-2">{renewal.toLocaleDateString("pt-PT")}</span>
          </p>
        )}
      </div>

      {mayWrite && tiers.length > 0 && (
        <div className="border-t border-line px-5 py-3">
          <label className="block">
            <span className="mb-1.5 block text-meta font-medium text-ink">Categoria</span>
            <select
              value={member.tier?.id ?? ""}
              disabled={busy}
              onChange={(e) => onChange({ tierId: e.target.value })}
              className={cx(dialogInputClass, "h-8")}
            >
              <option value="">Sem categoria</option>
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.feeCents != null ? ` — ${money(t.feeCents)} ${PERIOD_LABEL[t.period]}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/*
        Dito por palavras em vez de um "em dia" verde a fingir. Ver o comentário
        do componente.
      */}
      <p className="flex items-start gap-2 border-t border-line px-5 py-3 text-meta leading-relaxed text-ink-3">
        <Wallet className="mt-0.5 size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
        As cobranças de quota ainda não são emitidas pela plataforma — o valor acima é o que a categoria
        define, não o que está pago.
      </p>
    </Panel>
  );
}

/**
 * A data da próxima renovação.
 *
 * Conta a partir da aprovação, que é quando o vínculo começou — não da inscrição:
 * entre uma e outra podem passar semanas, e cobrar por um período em que ninguém
 * era ainda sócio é a forma mais rápida de perder um.
 */
function nextRenewal(m: Data): Date | null {
  if (!m.approvedAt || !m.tier || m.tier.period === "ONCE" || m.status !== "ACTIVE") return null;

  const months = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12, ONCE: 0 }[m.tier.period];
  const start = new Date(m.approvedAt);
  const next = new Date(start);

  // Avança em blocos até passar de hoje: um sócio de 2019 renova este ano, não em
  // 2020.
  while (next <= new Date()) next.setMonth(next.getMonth() + months);
  return next;
}

/* -------------------------------------------------------------------------- */

const STATUS_TONE: Record<MemberStatus, Tone> = {
  PENDING: "warn",
  ACTIVE: "ok",
  SUSPENDED: "risk",
  CANCELLED: "neutral",
};

function StatusPill({ status }: { status: MemberStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

/**
 * O que se faz a um sócio — o mesmo menu que a ficha do atleta já tinha.
 *
 * ## Porque é que substituiu os botões soltos
 *
 * Aqui havia dois botões que trocavam de lugar conforme o estado: "Suspender"
 * quando activo, "Reactivar" quando não. Três problemas de uma vez. Não havia
 * como **cancelar** um sócio — o estado existia na base e na etiqueta, mas não
 * havia caminho para lá chegar pela consola. Não havia como apagar uma inscrição
 * repetida vinda do site, e essas chegam sozinhas. E os botões mudavam de sítio
 * entre visitas, o que obriga a reler a barra em vez de a reconhecer.
 *
 * Um botão fixo que abre os estados todos resolve os três: o que muda é o que
 * está assinalado lá dentro, não o que aparece cá fora.
 *
 * ## Suspender e cancelar não são o mesmo
 *
 * **Suspenso** é temporário e costuma ser por quotas em atraso: o sócio continua
 * no livro e volta a activo quando regularizar. **Cancelado** é a saída — por
 * vontade dele ou por decisão da direção. Ambos guardam o número: quem foi sócio
 * não deixa de o ter sido.
 *
 * ## Apagar quase nunca é o que se quer
 *
 * Está aqui à mesma, separado por uma linha e em vermelho, porque a inscrição
 * pública produz lixo — a mesma pessoa duas vezes, um formulário preenchido a
 * brincar — e sem isto a única saída era deixá-lo no livro para sempre.
 *
 * O servidor recusa assim que houver número atribuído e diz porquê (ver
 * `MembersService.remove`). Não se esconde a opção antes de perguntar: um botão
 * que desaparece obriga a adivinhar, um botão que explica ensina a regra.
 */
function MemberStatusMenu({ member, onChanged }: { member: Data; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const navigate = useNavigate();

  const estados: { value: MemberStatus; label: string; hint: string }[] = [
    {
      value: "ACTIVE",
      label: "Activo",
      hint: member.number ? "no livro e nas listas" : "aprova e atribui o próximo número",
    },
    { value: "SUSPENDED", label: "Suspenso", hint: "sai das listas, mantém o número" },
    { value: "CANCELLED", label: "Cancelado", hint: "deixou de ser sócio" },
  ];

  async function mudar(status: MemberStatus) {
    setOpen(false);
    if (busy || status === member.status) return;
    setBusy(true);
    setErro(null);
    try {
      await updateMember(member.id, { status });
      onChanged();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível mudar o estado.");
    } finally {
      setBusy(false);
    }
  }

  async function apagar() {
    setOpen(false);
    if (busy) return;
    if (!confirm(`Apagar ${member.name} definitivamente? Se já tiver número de sócio, o servidor recusa e explica porquê.`)) return;
    setBusy(true);
    setErro(null);
    try {
      await removeMember(member.id);
      navigate("/socios");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar.");
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="ctl-ghost"
      >
        {busy ? "A guardar…" : "Estado do sócio"}
        <ChevronDown className="size-3.5" strokeWidth={2} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute top-full right-0 z-50 mt-1 w-[264px] rounded-[var(--radius-panel)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
          >
            {estados.map((e) => (
              <button
                key={e.value}
                type="button"
                role="menuitem"
                onClick={() => void mudar(e.value)}
                className="flex w-full items-start gap-2 rounded-[6px] px-2.5 py-1.5 text-left transition-colors duration-[120ms] hover:bg-sunken"
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-signal-ink">
                  {e.value === member.status && <CircleCheck className="size-3.5" strokeWidth={2.25} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-ink">{e.label}</span>
                  <span className="block text-meta text-ink-3">{e.hint}</span>
                </span>
              </button>
            ))}

            <div className="my-1 border-t border-line" />

            <button
              type="button"
              role="menuitem"
              onClick={() => void apagar()}
              className="flex w-full items-start gap-2 rounded-[6px] px-2.5 py-1.5 text-left transition-colors duration-[120ms] hover:bg-risk-soft"
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-risk">
                <Trash2 className="size-3.5" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body text-risk">Apagar sócio</span>
                <span className="block text-meta text-ink-3">só se nunca tiver tido número</span>
              </span>
            </button>
          </div>
        </>
      )}

      {erro && (
        <p className="pop-erro absolute top-full right-0 z-30 mt-1 w-[320px] rounded-[var(--radius-control)] border border-risk/25 bg-risk-soft px-3 py-2 text-meta leading-relaxed text-risk">
          {erro}
          <button type="button" onClick={() => setErro(null)} className="mt-1 block font-medium underline">
            Fechar
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * Um campo que a ficha ainda não tem.
 *
 * Escrito, e não deixado em branco: um espaço vazio lê-se como uma falha do
 * produto, "por preencher" lê-se como trabalho a fazer — e é isso que é, numa
 * ficha aberta ao balcão com o nome e o telemóvel.
 */
function PorPreencher() {
  return <span className="text-meta text-ink-4">Por preencher</span>;
}

function Fact({
  label,
  icon: Icon,
  children,
  wide,
}: {
  label: string;
  icon?: typeof Mail;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cx("flex items-start gap-2.5 border-b border-line py-2.5 last:border-0", wide && "sm:col-span-2")}>
      {Icon && (
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-3">
          <Icon className="size-3.5" strokeWidth={1.75} />
        </span>
      )}
      <div className="min-w-0">
        <dt className="text-meta text-ink-3">{label}</dt>
        <dd className="text-body text-ink">{children}</dd>
      </div>
    </div>
  );
}

function Consent({ label, at }: { label: string; at: string | null }) {
  return (
    <li className="flex items-center gap-2.5 border-b border-line py-2 last:border-0">
      <span
        className={cx(
          "flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
          at ? "bg-ok-soft text-ok" : "bg-sunken text-ink-4",
        )}
      >
        {at ? "✓" : "—"}
      </span>
      <span className="min-w-0 flex-1 text-body text-ink-2">{label}</span>
      <span className="shrink-0 text-meta text-ink-4">
        {at ? new Date(at).toLocaleDateString("pt-PT") : "não autorizou"}
      </span>
    </li>
  );
}

function Event({ label, at, note }: { label: string; at: string; note?: string }) {
  return (
    <li className="flex items-baseline gap-2.5 border-b border-line py-2 last:border-0">
      <span className="size-1.5 shrink-0 rounded-full bg-ink-4" />
      <span className="min-w-0 flex-1 text-body text-ink">
        {label}
        {note && <span className="text-ink-3"> {note}</span>}
      </span>
      <span className="shrink-0 text-meta text-ink-4">{new Date(at).toLocaleDateString("pt-PT")}</span>
    </li>
  );
}

function Back() {
  return (
    <Link to="/socios" className="mb-3 inline-flex items-center gap-1.5 text-meta font-medium text-ink-3 hover:text-ink">
      <ArrowLeft className="size-3.5" strokeWidth={1.75} />
      Sócios
    </Link>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Corrigir a ficha — toda ela.
 *
 * ## O que é obrigatório, e só isso
 *
 * **Nome, número de sócio e telemóvel.** Mais nada. Tudo o resto pode ficar em
 * branco, e o que estiver preenchido pode ser apagado — um campo vazio grava
 * vazio (ver `MemberUpdateDto`).
 *
 * Antes, o formulário não pedia morada nenhuma mas o servidor recusava a
 * gravação com uma queixa sobre ela: a interface mandava sempre os campos todos,
 * os vazios batiam num comprimento mínimo, e quem só queria corrigir um telefone
 * levava com "morada obrigatória" sem lhe ter tocado.
 *
 * ## A identidade também se edita
 *
 * Data de nascimento, documento e contribuinte estavam de fora, com um argumento
 * defensável: corrigem-se a olhar para o documento, e um formulário que os mude
 * em dois cliques é um formulário onde alguém troca o sócio errado. O argumento
 * não sobreviveu ao balcão — um sócio inscrito à pressa com o nome e o telemóvel
 * ficava **para sempre** sem NIF, e sem NIF não há recibo.
 *
 * ## O número não se apaga
 *
 * Um sócio com número é sócio de pleno direito, e o número é o que o clube usa
 * para o encontrar. Quem ainda não tem — uma inscrição por aprovar — pode
 * continuar sem: o número atribui-se na aprovação, e exigi-lo aqui era impedir
 * que se corrigisse um nome mal escrito numa candidatura.
 */
function EditPanel({
  member,
  onDone,
  onCancel,
}: {
  member: Data;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(member.name ?? "");
  const [email, setEmail] = useState(member.email ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [address, setAddress] = useState(member.address ?? "");
  const [postalCode, setPostalCode] = useState(member.postalCode ?? "");
  const [city, setCity] = useState(member.city ?? "");
  const [number, setNumber] = useState(member.number?.toString() ?? "");
  const [birthdate, setBirthdate] = useState(member.birthdate?.slice(0, 10) ?? "");
  const [sex, setSex] = useState<Sex>(member.sex ?? "UNSPECIFIED");
  const [documentKind, setDocumentKind] = useState<DocumentKind>(member.documentKind ?? "CC");
  const [documentNumber, setDocumentNumber] = useState(member.documentNumber ?? "");
  const [taxId, setTaxId] = useState(member.taxId ?? "");
  const [notes, setNotes] = useState(member.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Três exigências — e o que estiver preenchido tem de estar bem.
   *
   * "Opcional" quer dizer "pode não vir", nunca "pode vir errado": um NIF com
   * oito dígitos entra na base como se fosse bom e ninguém volta lá para o ver.
   *
   * O número só é exigido a quem já o tem: uma inscrição por aprovar ainda não
   * recebeu nenhum, e pedi-lo aqui era obrigar a admitir o sócio para lhe
   * corrigir uma letra do nome.
   */
  const cpOk = !postalCode.trim() || /^\d{4}-\d{3}$/.test(postalCode.trim());
  const emailOk = !email.trim() || email.includes("@");
  const nifOk = !taxId.trim() || /^\d{9}$/.test(taxId.trim());
  const numeroOk = member.number == null || number.trim() !== "";
  const valid =
    name.trim().length >= 3 && phone.trim().length >= 6 && numeroOk && cpOk && emailOk && nifOk;

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateMember(member.id, {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        postalCode: postalCode.trim(),
        city: city.trim(),
        birthdate: birthdate.trim(),
        sex,
        documentKind,
        documentNumber: documentNumber.trim(),
        taxId: taxId.trim(),
        notes: notes.trim(),
        ...(number.trim() ? { number: Number(number) } : {}),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-2.5">
        <span className="min-w-0 flex-1 text-body text-ink-2">
          A editar a ficha de <strong className="font-medium text-ink">{member.name}</strong>
        </span>
        {error && <span className="text-meta text-risk">{error}</span>}
        <button type="button" className="ctl-ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className="ctl-primary" disabled={!valid || busy} onClick={() => void save()}>
          {busy ? "A guardar…" : "Guardar"}
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Identidade" />
          <div className="space-y-3 px-5 py-4">
            <DialogField label="Nome completo">
              <input value={name} onChange={(e) => setName(e.target.value)} className={dialogInputClass} />
            </DialogField>
            <DialogField
              label="Número de sócio"
              hint={member.number == null ? "atribuído na aprovação" : "clubes antigos têm a sua própria numeração"}
            >
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 7))}
                inputMode="numeric"
                className={cx(dialogInputClass, !numeroOk && "border-risk")}
              />
            </DialogField>

            <div className="grid grid-cols-2 gap-3">
              <DialogField label="Data de nascimento" hint="opcional">
                <input
                  type="date"
                  value={birthdate}
                  onChange={(e) => setBirthdate(e.target.value)}
                  className={dialogInputClass}
                />
              </DialogField>
              <DialogField label="Sexo" hint="opcional">
                <select value={sex} onChange={(e) => setSex(e.target.value as Sex)} className={dialogInputClass}>
                  {(Object.keys(SEX_LABEL) as Sex[]).map((k) => (
                    <option key={k} value={k}>
                      {SEX_LABEL[k]}
                    </option>
                  ))}
                </select>
              </DialogField>
            </div>

            {/* O documento e o contribuinte editam-se — sem NIF o clube não passa
                um recibo, e um sócio inscrito ao balcão nasce sem ele. */}
            <div className="grid grid-cols-[130px_1fr] gap-3">
              <DialogField label="Documento">
                <select
                  value={documentKind}
                  onChange={(e) => setDocumentKind(e.target.value as DocumentKind)}
                  className={dialogInputClass}
                >
                  {(Object.keys(DOC_LABEL) as DocumentKind[]).map((k) => (
                    <option key={k} value={k}>
                      {DOC_LABEL[k]}
                    </option>
                  ))}
                </select>
              </DialogField>
              <DialogField label="N.º do documento" hint="opcional">
                <input
                  value={documentNumber}
                  onChange={(e) => setDocumentNumber(e.target.value)}
                  className={dialogInputClass}
                />
              </DialogField>
            </div>

            <DialogField label="Contribuinte" hint="nove dígitos, opcional">
              <input
                value={taxId}
                onChange={(e) => setTaxId(e.target.value.replace(/\D/g, "").slice(0, 9))}
                inputMode="numeric"
                className={cx(dialogInputClass, !nifOk && "border-risk")}
              />
            </DialogField>
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Contactos" />
          <div className="space-y-3 px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <DialogField label="E-mail">
                <input value={email} onChange={(e) => setEmail(e.target.value)} className={dialogInputClass} />
              </DialogField>
              <DialogField label="Telemóvel">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={cx(dialogInputClass, phone.trim().length < 6 && "border-risk")}
                />
              </DialogField>
            </div>

            <DialogField label="Morada" hint="opcional">
              <input value={address} onChange={(e) => setAddress(e.target.value)} className={dialogInputClass} />
            </DialogField>

            <div className="grid grid-cols-2 gap-3">
              <DialogField label="Código postal" hint="0000-000">
                <input
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  className={cx(dialogInputClass, !cpOk && postalCode !== "" && "border-risk")}
                />
              </DialogField>
              <DialogField label="Cidade" hint="opcional">
                <input value={city} onChange={(e) => setCity(e.target.value)} className={dialogInputClass} />
              </DialogField>
            </div>
          </div>
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelHead title="Notas" hint="internas — o sócio não as vê" />
          <div className="px-5 py-4">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={cx(dialogInputClass, "h-auto py-2 leading-relaxed")}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

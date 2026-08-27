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
  type MemberDetail as Data,
  type MemberStatus,
  type MemberTier,
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
            {m.number ? `Sócio n.º ${m.number}` : "Sem número atribuído"} · {ageOf(m.birthdate)} anos
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
                  {new Date(m.birthdate).toLocaleDateString("pt-PT")} · {ageOf(m.birthdate)} anos
                </Fact>
                <Fact label="Sexo">{SEX_LABEL[m.sex]}</Fact>
                <Fact label={DOC_LABEL[m.documentKind]}>{m.documentNumber}</Fact>
                <Fact label="Contribuinte">
                  <span className="tabular">{m.taxId}</span>
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
        <p className="absolute top-full right-0 z-30 mt-1 w-[320px] rounded-[var(--radius-control)] border border-risk/25 bg-risk-soft px-3 py-2 text-meta leading-relaxed text-risk">
          {erro}
          <button type="button" onClick={() => setErro(null)} className="mt-1 block font-medium underline">
            Fechar
          </button>
        </p>
      )}
    </div>
  );
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
 * Corrigir a ficha.
 *
 * A lista é fechada: nome, contactos e morada. O que **não** se edita aqui é o que
 * identifica a pessoa — data de nascimento, documento, contribuinte. Não porque
 * seja impossível estar errado, mas porque um engano nesses três campos corrige-se
 * a olhar para o documento, e um formulário que os deixe mudar em dois cliques é
 * um formulário onde alguém troca o sócio errado sem dar por isso.
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
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
  const [phone, setPhone] = useState(member.phone);
  const [address, setAddress] = useState(member.address);
  const [postalCode, setPostalCode] = useState(member.postalCode);
  const [city, setCity] = useState(member.city);
  const [number, setNumber] = useState(member.number?.toString() ?? "");
  const [notes, setNotes] = useState(member.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cpOk = /^\d{4}-\d{3}$/.test(postalCode.trim());
  const valid = name.trim().length >= 3 && email.includes("@") && cpOk;

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
        notes: notes.trim(),
        ...(number ? { number: Number(number) } : {}),
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
            <DialogField label="Número de sócio" hint="clubes antigos têm a sua própria numeração">
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 7))}
                inputMode="numeric"
                className={dialogInputClass}
              />
            </DialogField>
            <p className="text-meta leading-relaxed text-ink-3">
              Data de nascimento, documento e contribuinte não se editam aqui — corrigem-se a olhar para o
              documento, e um formulário que os mude em dois cliques é um formulário onde alguém troca o
              sócio errado.
            </p>
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
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={dialogInputClass} />
              </DialogField>
            </div>

            <DialogField label="Morada">
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
              <DialogField label="Cidade">
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

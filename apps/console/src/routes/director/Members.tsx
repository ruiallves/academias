import { useCallback, useEffect, useState } from "react";
import { CustoDoPagamento } from "@/components/finance/CustoDoPagamento";
import { PageHeader } from "@/components/Shell";
import { SearchInput } from "@/components/filters";
import { DataTable, Empty, Loading, Monogram, Panel, Pill, cx, type Column, type Tone } from "@/components/primitives";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Download, ExternalLink, Home, Plus, Settings, Trash2, Upload } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { BulkBar, BulkDeleteDialog } from "@/components/BulkDelete";
import { SociosAppDialog } from "@/components/SociosAppDialog";
import { academy } from "@/lib/api";
import { money } from "@/lib/format";
import { apiOrigin, apiPatch } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { downloadTemplate, readMemberSheet, OPTIONAL_COLUMNS, REQUIRED_COLUMNS, type ParsedSheet } from "@/lib/member-sheet";
import {
  DOC_LABEL,
  PERIOD_LABEL,
  PERIOD_SHORT,
  SEX_LABEL,
  STATUS_LABEL,
  createMember,
  ageOf,
  archiveTier,
  createTier,
  importMembers,
  listMembers,
  removeMember,
  listTiers,
  updateTier,
  type FeePeriod,
  type MemberRow,
  type MemberStatus,
  type MemberTier,
  type DocumentKind,
  type Sex,
  generateFees,
} from "@/lib/members";

/**
 * O livro de sócios.
 *
 * ## Porquê ao lado do staff, e não dos atletas
 *
 * Porque um sócio não é um atleta nem uma família — é um terceiro vínculo com o
 * clube, e o único que não passa por treinar ninguém. Quem trata de sócios trata
 * de quotas, cartões e assembleias; quem trata de atletas trata de escalões e
 * mensalidades. Misturá-los numa lista só daria uma tabela onde metade das
 * colunas está sempre vazia.
 *
 * ## Os que estão por aprovar vêm primeiro
 *
 * A ordenação é por estado e o filtro abre nos pendentes quando há algum. Uma
 * inscrição feita no site e esquecida durante três semanas é uma pessoa que quis
 * dar dinheiro ao clube e ficou à espera — é o único trabalho verdadeiramente
 * urgente neste ecrã.
 */
export default function Members() {
  const { session } = useSession();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<MemberStatus | null>(null);
  const [data, setData] = useState<{ members: MemberRow[]; counts: Partial<Record<MemberStatus, number>> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageOpen, setPageOpen] = useState(false);
  const [appOpen, setAppOpen] = useState(false);
  /*
   * "Gerar quotas" responde no próprio botão — quantas criou, ou que já estava
   * tudo. É idempotente no servidor, por isso carregar duas vezes não assusta.
   */
  const [quotas, setQuotas] = useState<string | null>(null);
  const [aGerar, setAGerar] = useState(false);

  async function gerarQuotas() {
    if (aGerar) return;
    setAGerar(true);
    setQuotas(null);
    try {
      const r = await generateFees();
      setQuotas(
        r.created === 0
          ? "As quotas do período já estavam todas lançadas."
          : `${r.created} ${r.created === 1 ? "quota lançada" : "quotas lançadas"} (${r.members} sócios activos com categoria).`,
      );
    } catch (e) {
      setQuotas(e instanceof Error ? e.message : "Não foi possível gerar as quotas.");
    } finally {
      setAGerar(false);
    }
  }
  const [importOpen, setImportOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const mayWrite = can(session, "member:write");
  const podeApagar = mayWrite;
  /*
   * A selecção múltipla.
   *
   * Vive na página e não na tabela: é a página que sabe o que fazer com as
   * linhas escolhidas. A tabela só sabe desenhar as caixas — ver `DataTable`.
   */
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [aApagar, setAApagar] = useState(false);


  const load = useCallback(() => {
    setError(null);
    listMembers({ ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) })
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível carregar."));
  }, [status, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const counts = data?.counts ?? {};
  const pending = counts.PENDING ?? 0;
  const active = counts.ACTIVE ?? 0;

  const columns: Column<MemberRow>[] = [
    {
      key: "member",
      header: "Sócio",
      render: (m) => (
        <div className="flex items-center gap-2.5">
          <Monogram name={m.name} />
          {/*
            `max-w` e não só `min-w-0`: dentro de uma célula de tabela não há
            flexbox nenhum a forçar a coluna a encolher — sem um limite explícito,
            a célula cresce para caber o nome inteiro, por mais comprido que seja,
            e empurra o resto da linha para fora do ecrã. O `truncate` só entra em
            acção quando o elemento já tem uma largura definida para exceder.
          */}
          <div className="min-w-0 max-w-[200px]">
            <div className="truncate text-body font-medium text-ink">{m.name}</div>
            <div className="truncate text-meta text-ink-3">
              {m.number ? `n.º ${m.number} · ` : ""}
              {m.birthdate ? `${ageOf(m.birthdate)} anos` : "Ficha por completar"}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "tier",
      header: "Categoria",
      hideBelow: "md",
      render: (m) =>
        m.tier ? (
          <div className="min-w-0 max-w-[170px]">
            <div className="truncate text-body text-ink-2">{m.tier.name}</div>
            {m.tier.feeCents !== null && (
              <div className="text-meta text-ink-3 tabular">
                {money(m.tier.feeCents)} {PERIOD_SHORT[m.tier.period]}
              </div>
            )}
          </div>
        ) : (
          <span className="text-meta text-ink-4">sem categoria</span>
        ),
    },
    {
      key: "contact",
      header: "Contacto",
      hideBelow: "lg",
      render: (m) => (
        <div className="min-w-0">
          <div className="truncate text-body text-ink-2">{m.email}</div>
          <div className="truncate text-meta text-ink-3 tabular">
            {m.phoneCountry} {m.phone} · {m.city}
          </div>
        </div>
      ),
    },
    { key: "status", header: "Estado", render: (m) => <StatusPill status={m.status} /> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Sócios"
        title="Livro de sócios"
        subtitle={data ? `${active} ${active === 1 ? "sócio activo" : "sócios activos"}` : undefined}
      >
        <SearchInput value={q} onChange={setQ} placeholder="Nome, email ou NIF" />
        {mayWrite && (
          <button type="button" className="ctl-outline" onClick={() => setImportOpen(true)}>
            <Upload className="size-3.5" strokeWidth={1.75} />
            Importar
          </button>
        )}
        <a
          href={`${apiOrigin()}/l/${academy.slug}/sersocio`}
          target="_blank"
          rel="noreferrer"
          className="ctl-outline"
          title="A página pública de inscrição"
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
          Ver a página
        </a>
        {mayWrite && (
          <button type="button" className="ctl-outline" onClick={() => setPageOpen(true)}>
            <Settings className="size-3.5" strokeWidth={1.75} />
            Gerir página de inscrição
          </button>
        )}
        <button type="button" className="ctl-outline" onClick={() => setAppOpen(true)}>
          App do clube
        </button>
        {mayWrite && (
          <button type="button" className="ctl-outline" onClick={() => void gerarQuotas()} disabled={aGerar}>
            {aGerar ? "A gerar…" : "Gerar quotas"}
          </button>
        )}
        {mayWrite && (
          <button type="button" className="ctl-primary" onClick={() => setNewOpen(true)}>
            <Plus className="size-3.5" strokeWidth={2} />
            Novo sócio
          </button>
        )}
      </PageHeader>

      {quotas && (
        <p className="mb-3 rounded-[var(--radius-control)] bg-sunken px-3 py-2 text-meta text-ink-2">{quotas}</p>
      )}

      {/*
        Os pendentes primeiro e com contador: uma inscrição feita no site e
        esquecida é uma pessoa que quis dar dinheiro ao clube e ficou à espera.
      */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Chip active={status === null} onClick={() => setStatus(null)}>
          Todos
        </Chip>
        {(Object.keys(STATUS_LABEL) as MemberStatus[]).map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(s)} count={counts[s]} urgent={s === "PENDING"}>
            {STATUS_LABEL[s]}
          </Chip>
        ))}
      </div>

      <Panel>
        {error ? (
          <div>
            <Empty title="Não foi possível carregar" detail={error} />
          </div>
        ) : !data ? (
          <Loading />
        ) : data.members.length === 0 ? (
          <div>
            <Empty
              icon={Home}
              title={q || status ? "Nenhum sócio com esse filtro" : "Ainda não há sócios"}
              detail={
                q || status
                  ? "Limpa a pesquisa ou muda de estado."
                  : "Partilha a página de inscrição — quem se inscrever aparece aqui por aprovar."
              }
            />
          </div>
        ) : (
          <DataTable
            rows={data.members}
            columns={columns}
            keyOf={(m) => m.id}
            to={(m) => `/socios/${m.id}`}
            selection={podeApagar ? { selected: escolhidos, onChange: setEscolhidos } : undefined}
          />
        )}
      </Panel>

      {pending > 0 && status === null && (
        <p className="mt-3 px-1 text-meta text-ink-3">
          {pending} {pending === 1 ? "inscrição está" : "inscrições estão"} à espera de aprovação.
        </p>
      )}

      <BulkBar
        count={escolhidos.size}
        noun={["sócio", "sócios"]}
        onClear={() => setEscolhidos(new Set())}
        onDelete={() => setAApagar(true)}
      />

      {aApagar && (
        <BulkDeleteDialog
          noun={["sócio", "sócios"]}
          targets={(data?.members ?? [])
            .filter((m) => escolhidos.has(m.id))
            .map((m) => ({ id: m.id, name: m.name }))}
          remove={(id) => removeMember(id)}
          onClose={() => setAApagar(false)}
          onDone={() => {
            setEscolhidos(new Set());
            load();
          }}
        />
      )}

      {appOpen && <SociosAppDialog mayWrite={mayWrite} onClose={() => setAppOpen(false)} />}
      {pageOpen && <PageDialog mayWrite={mayWrite} onClose={() => setPageOpen(false)} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onDone={load} />}
      {newOpen && <NewMemberDialog onClose={() => setNewOpen(false)} onCreated={load} />}
    </>
  );
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

function Chip({
  active,
  onClick,
  count,
  urgent,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  urgent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
        active ? "border-transparent bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={cx(
            "rounded-full px-1.5 text-[10px] font-semibold tabular",
            active ? "bg-white/20 text-surface" : urgent ? "bg-warn-soft text-warn" : "bg-sunken text-ink-3",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */

/**
 * A página de inscrição, inteira, num sítio só.
 *
 * ## Porquê aqui e não nas definições
 *
 * Porque quem escreve a frase de abertura é a mesma pessoa que cria as
 * categorias, e as duas decisões são a mesma decisão: o que é ser sócio deste
 * clube e quanto custa. Estavam em ecrãs diferentes — a apresentação nas
 * definições, as categorias aqui — e ninguém que quisesse mudar a página adivinhava
 * que tinha de ir a dois sítios.
 */
function PageDialog({ mayWrite, onClose }: { mayWrite: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"copy" | "tiers">("copy");

  return (
    <Dialog
      title="Gerir página de inscrição"
      subtitle="O que quem chega ao clube lê e escolhe"
      icon={<Settings className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={640}
      labelledBy="page"
      footer={
        <button type="button" className="ctl-ghost" onClick={onClose}>
          Fechar
        </button>
      }
    >
      <div className="flex gap-1.5 border-b border-line px-5 py-3">
        <Chip active={tab === "copy"} onClick={() => setTab("copy")}>
          Apresentação
        </Chip>
        <Chip active={tab === "tiers"} onClick={() => setTab("tiers")}>
          Categorias
        </Chip>
      </div>

      {tab === "copy" ? <CopyForm mayWrite={mayWrite} /> : <TiersList mayWrite={mayWrite} />}
    </Dialog>
  );
}

/*
 * A frase e os pontos.
 *
 * Vazio não apaga nada: o servidor repõe o texto por omissão, que é o que está em
 * cinzento nos campos. Uma página de clube muda seria pior do que uma página com
 * palavras que o clube ainda não escolheu.
 */

const FALLBACK_HEADLINE = "Faz parte do clube.";
const FALLBACK_INTRO =
  "Ser sócio não é uma subscrição. É estar do lado de dentro — e ficar com um lugar que é teu.";
const FALLBACK_POINTS = [
  "Cartão de sócio digital, sempre no telemóvel",
  "Participação na vida do clube",
  "Comunicações que só os sócios recebem",
];

function CopyForm({ mayWrite }: { mayWrite: boolean }) {
  const [headline, setHeadline] = useState(academy.membershipHeadline);
  const [intro, setIntro] = useState(academy.membershipIntro);
  const [points, setPoints] = useState(academy.membershipPoints.join("\n"));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // O que está publicado. A reatribuição do `academy` no store não volta a
  // desenhar este componente, por isso o marco fica aqui.
  const [live, setLive] = useState({
    headline: academy.membershipHeadline,
    intro: academy.membershipIntro,
    points: academy.membershipPoints.join("\n"),
  });

  const dirty = headline !== live.headline || intro !== live.intro || points !== live.points;

  async function save() {
    setState("saving");
    try {
      await apiPatch("/api/membership-page", {
        headline,
        intro,
        points: points.split("\n").map((l) => l.trim()).filter(Boolean),
      });
      await reloadAcademy();
      setLive({ headline, intro, points });
      setState("saved");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="space-y-3 px-5 py-4">
      <DialogField label="Frase de abertura" hint="uma linha, em letra grande">
        <input
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          maxLength={90}
          disabled={!mayWrite}
          placeholder={FALLBACK_HEADLINE}
          className={dialogInputClass}
        />
      </DialogField>

      <DialogField label="Explicação">
        <textarea
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          maxLength={240}
          rows={2}
          disabled={!mayWrite}
          placeholder={FALLBACK_INTRO}
          className={cx(dialogInputClass, "h-auto py-2 leading-relaxed")}
        />
      </DialogField>

      <DialogField label="Pontos" hint="um por linha, no máximo seis">
        <textarea
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          rows={4}
          disabled={!mayWrite}
          placeholder={FALLBACK_POINTS.join("\n")}
          className={cx(dialogInputClass, "h-auto py-2 leading-relaxed")}
        />
      </DialogField>

      {mayWrite && (
        <div className="flex items-center gap-3 pt-1">
          <button type="button" className="ctl-primary" disabled={!dirty || state === "saving"} onClick={() => void save()}>
            {state === "saving" ? "A guardar…" : "Publicar"}
          </button>
          {state === "saved" && !dirty && <span className="text-meta text-ok">Publicado</span>}
          {state === "error" && <span className="text-meta text-risk">Não foi possível guardar</span>}
        </div>
      )}
    </div>
  );
}

/**
 * As categorias de sócio.
 *
 * O que o clube escreve aqui é literalmente o que aparece no formulário público —
 * por isso a descrição e os benefícios valem tanto como o preço: é com eles que
 * alguém decide qual escolher.
 */
function TiersList({ mayWrite }: { mayWrite: boolean }) {
  const [tiers, setTiers] = useState<MemberTier[] | null>(null);
  const [editing, setEditing] = useState<MemberTier | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listTiers()
      .then(setTiers)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível carregar."));
  }, []);

  useEffect(load, [load]);

  return (
    <>
      {editing ? (
        <TierForm
          tier={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : !tiers ? (
        <Loading size="panel" />
      ) : tiers.length === 0 ? (
        <div className="px-5 py-14">
          <Empty
            title="Ainda não há categorias"
            detail="Sem categorias, o formulário público continua a funcionar — só não há nada para escolher."
          />
        </div>
      ) : (
        <ul>
          {tiers.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-body font-medium text-ink">{t.name}</span>
                  {!t.isPublic && <Pill>não listada</Pill>}
                </div>
                <div className="text-meta text-ink-3">
                  {t.feeCents !== null ? `${money(t.feeCents)} ${PERIOD_LABEL[t.period]}` : "preço por definir"}
                  {(t.minAge != null || t.maxAge != null) &&
                    ` · ${t.minAge != null && t.maxAge != null ? `${t.minAge}–${t.maxAge} anos` : t.minAge != null ? `${t.minAge}+ anos` : `até ${t.maxAge} anos`}`}
                  {` · ${t.members} ${t.members === 1 ? "sócio" : "sócios"}`}
                </div>
              </div>

              {mayWrite && (
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" className="ctl-ghost" onClick={() => setEditing(t)}>
                    Editar
                  </button>
                  {t.members === 0 && (
                    <button
                      type="button"
                      className="ctl-ghost"
                      aria-label="Arquivar"
                      onClick={() => void archiveTier(t.id).then(load)}
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="px-5 pb-3 text-meta text-risk">{error}</p>}

      {mayWrite && !editing && (
        <div className="border-t border-line px-5 py-3">
          <button type="button" className="ctl-primary" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" strokeWidth={2} />
            Nova categoria
          </button>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Um sócio inscrito ao balcão.
 *
 * ## Os mesmos campos da página pública
 *
 * Quem se inscreve na secretaria não fica com meia ficha. Um livro de sócios onde
 * metade das pessoas tem morada e a outra metade não é um livro que não serve
 * para passar recibos nem para convocar uma assembleia — e completá-lo mais tarde
 * é um telefonema por pessoa.
 *
 * ## Os termos são uma pergunta
 *
 * A caixa começa desligada. Quem preenche tem a pessoa à frente e sabe se ela
 * assinou; marcá-la por omissão era o produto a decidir sozinho que existe um
 * consentimento que talvez ninguém tenha dado.
 */
function NewMemberDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [tiers, setTiers] = useState<MemberTier[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [sex, setSex] = useState<Sex>("UNSPECIFIED");
  const [documentKind, setDocumentKind] = useState<DocumentKind>("CC");
  const [documentNumber, setDocumentNumber] = useState("");
  const [taxId, setTaxId] = useState("");
  const [phoneCountry, setPhoneCountry] = useState("+351");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [tierId, setTierId] = useState("");
  const [status, setStatus] = useState<MemberStatus>("ACTIVE");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  useEffect(() => {
    listTiers()
      .then(setTiers)
      .catch(() => setTiers([]));
  }, []);

  /*
   * Obrigatório: o nome, um contacto, e a categoria quando o clube tem alguma.
   *
   * A inscrição pública pede a ficha inteira, e faz sentido que peça — quem se
   * inscreve pelo site está sentado, com os documentos à mão. Ao balcão é outra
   * coisa: chega uma pessoa que dá o nome e o telemóvel, e exigir NIF, morada e
   * cartão de cidadão não produzia fichas completas, produzia **dados
   * inventados** para o formulário deixar gravar — e um NIF inventado é pior do
   * que um NIF em falta, porque ninguém sabe que está errado.
   *
   * O que é preenchido continua a ser validado na forma: opcional quer dizer
   * "pode não vir", nunca "pode vir errado".
   */
  const emailOk = !email.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const phoneOk = !phone.trim() || /^\d{6,15}$/.test(phone.replace(/\s/g, ""));
  const temContacto = Boolean(email.trim() || phone.trim());

  const valid =
    name.trim().length >= 3 &&
    temContacto &&
    emailOk &&
    phoneOk &&
    // A categoria só é exigida se existir alguma para escolher: um clube que
    // ainda não as criou não pode ficar sem conseguir inscrever ninguém.
    (tiers.length === 0 || Boolean(tierId)) &&
    (!birthdate || /^\d{4}-\d{2}-\d{2}$/.test(birthdate)) &&
    (!postalCode.trim() || /^\d{4}-\d{3}$/.test(postalCode)) &&
    (!taxId.trim() || /^\d{9}$/.test(taxId));

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      /*
       * O que está vazio não vai no corpo.
       *
       * O validador do servidor recusa um `taxId: ""` (não tem nove dígitos) e
       * um `email: ""` (não é email) — enviar campos vazios daria erro de
       * validação em vez de gravar a ficha curta que se quis fazer. Ausente é
       * ausente.
       */
      await createMember({
        name: name.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(birthdate ? { birthdate } : {}),
        sex,
        documentKind,
        ...(documentNumber.trim() ? { documentNumber: documentNumber.trim() } : {}),
        ...(taxId.trim() ? { taxId } : {}),
        phoneCountry,
        ...(phone.trim() ? { phone: phone.replace(/\s/g, "") } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
        ...(postalCode.trim() ? { postalCode } : {}),
        ...(city.trim() ? { city: city.trim() } : {}),
        ...(tierId ? { tierId } : {}),
        status,
        acceptedTerms,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível criar o sócio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Novo sócio"
      subtitle="Nome, um contacto e a categoria chegam — o resto completa-se depois"
      onClose={onClose}
      width={640}
      labelledBy="new-member"
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!valid || busy} onClick={() => void save()}>
            {busy ? "A criar…" : "Criar sócio"}
          </button>
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <DialogField label="Nome completo">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className={dialogInputClass}
          />
        </DialogField>

        <div className="grid gap-3 sm:grid-cols-2">
          <DialogField label="Email">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="nome@exemplo.pt"
              className={dialogInputClass}
            />
          </DialogField>
          <DialogField label="Data de nascimento">
            <input
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              type="date"
              className={dialogInputClass}
            />
          </DialogField>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <DialogField label="Indicativo">
            <input
              value={phoneCountry}
              onChange={(e) => setPhoneCountry(e.target.value.replace(/[^\d+]/g, "").slice(0, 5))}
              className={dialogInputClass}
            />
          </DialogField>
          <DialogField label="Telemóvel">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ""))}
              inputMode="tel"
              placeholder="912 345 678"
              className={dialogInputClass}
            />
          </DialogField>
        </div>

        <DialogField label="Morada">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Rua, número e andar"
            className={dialogInputClass}
          />
        </DialogField>

        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <DialogField label="Código postal">
            <input
              value={postalCode}
              onChange={(e) => setPostalCode(maskPostal(e.target.value))}
              inputMode="numeric"
              placeholder="0000-000"
              className={dialogInputClass}
            />
          </DialogField>
          <DialogField label="Localidade">
            <input value={city} onChange={(e) => setCity(e.target.value)} className={dialogInputClass} />
          </DialogField>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
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
          <DialogField label="N.º de documento">
            <input
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value.toUpperCase())}
              className={dialogInputClass}
            />
          </DialogField>
          <DialogField label="NIF">
            <input
              value={taxId}
              onChange={(e) => setTaxId(e.target.value.replace(/\D/g, "").slice(0, 9))}
              inputMode="numeric"
              className={dialogInputClass}
            />
          </DialogField>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <DialogField label="Sexo">
            <select value={sex} onChange={(e) => setSex(e.target.value as Sex)} className={dialogInputClass}>
              {(Object.keys(SEX_LABEL) as Sex[]).map((k) => (
                <option key={k} value={k}>
                  {SEX_LABEL[k]}
                </option>
              ))}
            </select>
          </DialogField>
          <DialogField label="Categoria" hint={tiers.length === 0 ? "ainda não há" : undefined}>
            <select value={tierId} onChange={(e) => setTierId(e.target.value)} className={dialogInputClass}>
              <option value="">Sem categoria</option>
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </DialogField>
          <DialogField label="Estado">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as MemberStatus)}
              className={dialogInputClass}
            >
              {(Object.keys(STATUS_LABEL) as MemberStatus[]).map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </DialogField>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 border-t border-line pt-3">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-signal)]"
          />
          <span className="text-body text-ink-2">
            O sócio aceitou os termos e condições
            <span className="block text-meta text-ink-4">
              Guarda a data de hoje. Deixa por marcar se a assinatura ficou em papel — o clube não fica a dizer
              que tem um consentimento que não deu.
            </span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}

/** 0000-000 enquanto se escreve. */
function maskPostal(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 7);
  return digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
}

/**
 * O livro que o clube já tinha, numa folha.
 *
 * ## Ver antes de importar
 *
 * A folha é lida no browser e o que aparece é o que vai ser criado, com os erros
 * por linha ao lado. Ninguém carrega centenas de pessoas para dentro do clube às
 * cegas — e um erro de coluna descoberto depois de importar custa uma limpeza à
 * mão que este ecrã evita com um passo.
 *
 * ## Tudo ou nada
 *
 * O servidor recusa a folha inteira se alguma linha estiver errada. Metade dos
 * sócios importados é o pior sítio onde parar: corrige-se a folha, importa-se
 * outra vez, e fica meio clube em duplicado.
 */
function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; duplicates: number } | null>(null);
  const [tierNames, setTierNames] = useState<string[]>([]);
  /**
   * As categorias que a folha traz e o clube não tem.
   *
   * O servidor pára e devolve-as em vez de as criar sozinho: uma categoria a
   * mais no livro do clube é uma categoria a mais nas quotas, nos benefícios e no
   * site. A comparação é sem caixa nem acentos, por isso o que chega aqui são
   * categorias mesmo novas — nunca "Sócio Ouro" contra "sócio ouro".
   */
  const [novas, setNovas] = useState<string[] | null>(null);

  useEffect(() => {
    listTiers()
      .then((ts) => setTierNames(ts.map((t) => t.name)))
      .catch(() => setTierNames([]));
  }, []);

  const bad = sheet?.rows.filter((r) => r.errors.length > 0) ?? [];
  const good = sheet?.rows.filter((r) => r.errors.length === 0) ?? [];

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    setFileName(file.name);
    try {
      setSheet(await readMemberSheet(file));
    } catch {
      setSheet(null);
      setError("Não foi possível ler o ficheiro. É um .xlsx ou .csv?");
    }
  }

  async function send(criarCategorias = false) {
    if (!sheet || bad.length > 0 || good.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importMembers(good.map((r) => r.row), criarCategorias);

      // Categorias novas: a importação não falhou, ficou à espera de resposta.
      if (!res.ok && res.unknownTiers.length > 0) {
        setNovas(res.unknownTiers);
        return;
      }
      if (!res.ok) {
        setError(res.problems.map((p) => `Linha ${p.line}: ${p.reason}`).join(" · "));
        return;
      }
      setNovas(null);
      setResult({ created: res.created, duplicates: res.duplicates.length });
      setSheet(null);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Importar sócios"
      subtitle="A folha do clube, tal como está"
      onClose={onClose}
      width={640}
      labelledBy="import"
      footer={
        <>
          <button type="button" className="ctl-ghost mr-auto" onClick={() => downloadTemplate(tierNames)}>
            <Download className="size-3.5" strokeWidth={1.75} />
            Descarregar modelo
          </button>
          <button type="button" className="ctl-ghost" onClick={onClose}>
            {result ? "Fechar" : "Cancelar"}
          </button>
          {!result && (
            <button
              type="button"
              className="ctl-primary"
              disabled={busy || !sheet || bad.length > 0 || good.length === 0}
              onClick={() => void send(novas !== null)}
            >
              {busy
                ? "A importar…"
                : novas !== null
                  ? `Criar ${novas.length === 1 ? "a categoria" : `as ${novas.length} categorias`} e importar`
                  : good.length > 0
                    ? `Importar ${good.length}`
                    : "Importar"}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        {result ? (
          <div className="rounded-[var(--radius-control)] border border-line bg-ok-soft/40 p-4">
            <p className="text-body font-medium text-ink">
              {result.created} {result.created === 1 ? "sócio importado" : "sócios importados"}.
            </p>
            {result.duplicates > 0 && (
              <p className="mt-1 text-meta text-ink-3">
                {result.duplicates} {result.duplicates === 1 ? "já existia" : "já existiam"} no livro e{" "}
                {result.duplicates === 1 ? "foi ignorado" : "foram ignorados"} — o NIF já cá estava.
              </p>
            )}
          </div>
        ) : (
          <>
            <label className="block cursor-pointer rounded-[var(--radius-control)] border border-dashed border-line-strong px-5 py-8 text-center hover:border-ink-4">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={(e) => void pick(e.target.files?.[0])}
              />
              <Upload className="mx-auto mb-2 size-5 text-ink-3" strokeWidth={1.75} />
              <span className="block text-body font-medium text-ink">
                {fileName || "Escolher a folha de sócios"}
              </span>
              <span className="mt-0.5 block text-meta text-ink-3">.xlsx, .xls ou .csv</span>
            </label>

            <p className="text-meta leading-relaxed text-ink-3">
              Colunas obrigatórias: {REQUIRED_COLUMNS.join(", ")}. Opcionais: {OPTIONAL_COLUMNS.join(", ")} — entram
              se lá estiverem, ficam por preencher se não.
            </p>
          </>
        )}

        {novas && (
          <div className="rounded-[var(--radius-control)] border border-warn/30 bg-warn-soft p-4">
            <p className="text-body font-medium text-ink">
              {novas.length === 1
                ? "A folha traz um tipo de sócio que o clube não tem."
                : `A folha traz ${novas.length} tipos de sócio que o clube não tem.`}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {novas.map((n) => (
                <span key={n} className="rounded-full bg-surface px-2.5 py-1 text-meta font-medium text-ink-2">
                  {n}
                </span>
              ))}
            </div>
            <p className="mt-2.5 text-meta leading-relaxed text-ink-3">
              {novas.length === 1 ? "Criá-lo" : "Criá-los"} agora, sem quota nem benefícios definidos, e continuar a
              importação? {novas.length === 1 ? "Fica" : "Ficam"} fora do site até alguém {novas.length === 1 ? "o" : "os"}{" "}
              publicar.
            </p>
          </div>
        )}

        {sheet && sheet.missing.length > 0 && (
          <p className="text-meta text-risk">Faltam colunas na folha: {sheet.missing.join(", ")}.</p>
        )}

        {sheet && sheet.rows.length > 0 && (
          <div className="rounded-[var(--radius-control)] border border-line">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-meta">
              <span className="font-medium text-ink">{sheet.rows.length} linhas</span>
              {bad.length > 0 ? (
                <span className="text-risk">{bad.length} por corrigir</span>
              ) : (
                <span className="text-ok">prontas a importar</span>
              )}
            </div>

            <ul className="max-h-[280px] overflow-y-auto">
              {(bad.length > 0 ? bad : sheet.rows).slice(0, 60).map((r) => (
                <li key={r.row.line} className="flex gap-3 border-b border-line px-3 py-2 last:border-0">
                  <span className="w-10 shrink-0 text-meta text-ink-4 tabular">{r.row.line}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink">{r.row.name || "—"}</span>
                    {r.errors.length > 0 && <span className="block text-meta text-risk">{r.errors.join(" · ")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-meta text-risk">{error}</p>}
      </div>
    </Dialog>
  );
}

function TierForm({
  tier,
  onCancel,
  onSaved,
}: {
  tier: MemberTier | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(tier?.name ?? "");
  const [description, setDescription] = useState(tier?.description ?? "");
  const [fee, setFee] = useState(tier?.feeCents != null ? (tier.feeCents / 100).toString() : "");
  const [period, setPeriod] = useState<FeePeriod>(tier?.period ?? "ANNUAL");
  const [minAge, setMinAge] = useState(tier?.minAge?.toString() ?? "");
  const [maxAge, setMaxAge] = useState(tier?.maxAge?.toString() ?? "");
  const [benefits, setBenefits] = useState((tier?.benefits ?? []).join("\n"));
  const [isPublic, setIsPublic] = useState(tier?.isPublic ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length >= 2;

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        description: description.trim(),
        benefits: benefits.split("\n").map((b) => b.trim()).filter(Boolean).slice(0, 12),
        ...(fee.trim() ? { feeCents: Math.round(Number(fee.replace(",", ".")) * 100) } : { feeCents: undefined }),
        period,
        ...(minAge ? { minAge: Number(minAge) } : {}),
        ...(maxAge ? { maxAge: Number(maxAge) } : {}),
        isPublic,
      };
      if (tier) await updateTier(tier.id, body);
      else await createTier(body);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 px-5 py-4">
      <DialogField label="Nome">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sócio efectivo"
          maxLength={60}
          className={dialogInputClass}
        />
      </DialogField>

      <DialogField label="Descrição" hint="aparece na página de inscrição">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Para maiores de 18 anos, com direito a voto em assembleia."
          className={dialogInputClass}
        />
      </DialogField>

      <div className="grid grid-cols-4 gap-3">
        <DialogField label="Quota" hint="€" className="col-span-2">
          <input
            value={fee}
            onChange={(e) => setFee(e.target.value.replace(/[^\d.,]/g, ""))}
            inputMode="decimal"
            placeholder="30"
            className={dialogInputClass}
          />
          <CustoDoPagamento amountCents={paraCentimosDaQuota(fee)} />
        </DialogField>
        <DialogField label="Período">
          <select value={period} onChange={(e) => setPeriod(e.target.value as FeePeriod)} className={dialogInputClass}>
            {(Object.keys(PERIOD_LABEL) as FeePeriod[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </select>
        </DialogField>
        <DialogField label="Idade mín." hint="opcional">
          <input
            value={minAge}
            onChange={(e) => setMinAge(e.target.value.replace(/\D/g, "").slice(0, 3))}
            inputMode="numeric"
            className={dialogInputClass}
          />
        </DialogField>
        <DialogField label="Idade máx." hint="opcional">
          <input
            value={maxAge}
            onChange={(e) => setMaxAge(e.target.value.replace(/\D/g, "").slice(0, 3))}
            inputMode="numeric"
            className={dialogInputClass}
          />
        </DialogField>
      </div>

      <DialogField label="Benefícios" hint="um por linha">
        <textarea
          value={benefits}
          onChange={(e) => setBenefits(e.target.value)}
          rows={4}
          placeholder={"Entrada nos jogos em casa\nDesconto na loja\nVoto em assembleia geral"}
          className={cx(dialogInputClass, "h-auto py-2 leading-relaxed")}
        />
      </DialogField>

      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
          className="size-4 accent-[var(--color-signal)]"
        />
        <span className="text-body text-ink-2">
          Mostrar na página de inscrição
          <span className="block text-meta text-ink-4">
            Desliga para categorias que a direção atribui, como “sócio honorário”.
          </span>
        </span>
      </label>

      {error && <p className="text-meta text-risk">{error}</p>}

      <div className="flex justify-end gap-1.5 pt-1">
        <button type="button" className="ctl-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="ctl-primary" disabled={!valid || busy} onClick={() => void save()}>
          {busy ? "A guardar…" : tier ? "Guardar" : "Criar categoria"}
        </button>
      </div>
    </div>
  );
}

/**
 * O valor escrito no campo, em cêntimos — só para a linha de custo.
 *
 * Não valida nada: quem valida é a gravação, contra o servidor. Aqui só se quer
 * saber se já há número suficiente para fazer a conta enquanto se escreve.
 */
function paraCentimosDaQuota(v: string): number | null {
  const n = Number(v.trim().replace(/\s/g, "").replace("€", "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

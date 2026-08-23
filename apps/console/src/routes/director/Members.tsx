import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { SearchInput } from "@/components/filters";
import { DataTable, Empty, Loading, Monogram, Panel, Pill, cx, type Column, type Tone } from "@/components/primitives";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { ExternalLink, Home, Plus, Trash2 } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { academy } from "@/lib/api";
import { money } from "@/lib/format";
import { apiOrigin } from "@/lib/http";
import {
  PERIOD_LABEL,
  PERIOD_SHORT,
  STATUS_LABEL,
  ageOf,
  archiveTier,
  createTier,
  listMembers,
  listTiers,
  updateTier,
  type FeePeriod,
  type MemberRow,
  type MemberStatus,
  type MemberTier,
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
  const [tiersOpen, setTiersOpen] = useState(false);

  const mayWrite = can(session, "member:write");

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
          <div className="min-w-0">
            <div className="truncate text-body font-medium text-ink">{m.name}</div>
            <div className="truncate text-meta text-ink-3">
              {m.number ? `n.º ${m.number} · ` : ""}
              {ageOf(m.birthdate)} anos
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
          <div className="min-w-0">
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
        <a
          href={`${apiOrigin()}/l/${academy.slug}/sersocio`}
          target="_blank"
          rel="noreferrer"
          className="ctl-outline"
          title="A página pública de inscrição"
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
          Página de inscrição
        </a>
        {mayWrite && (
          <button type="button" className="ctl-primary" onClick={() => setTiersOpen(true)}>
            Categorias
          </button>
        )}
      </PageHeader>

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
          <div className="px-5 py-16">
            <Empty title="Não foi possível carregar" detail={error} />
          </div>
        ) : !data ? (
          <Loading />
        ) : data.members.length === 0 ? (
          <div className="px-5 py-16">
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
          <DataTable rows={data.members} columns={columns} keyOf={(m) => m.id} to={(m) => `/socios/${m.id}`} />
        )}
      </Panel>

      {pending > 0 && status === null && (
        <p className="mt-3 px-1 text-meta text-ink-3">
          {pending} {pending === 1 ? "inscrição está" : "inscrições estão"} à espera de aprovação.
        </p>
      )}

      {tiersOpen && <TiersDialog mayWrite={mayWrite} onClose={() => setTiersOpen(false)} />}
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
 * As categorias de sócio.
 *
 * O que o clube escreve aqui é literalmente o que aparece no formulário público —
 * por isso a descrição e os benefícios valem tanto como o preço: é com eles que
 * alguém decide qual escolher.
 */
function TiersDialog({ mayWrite, onClose }: { mayWrite: boolean; onClose: () => void }) {
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
    <Dialog
      title="Categorias de sócio"
      subtitle="O que aparece na página de inscrição"
      onClose={onClose}
      width={620}
      labelledBy="tiers"
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          {mayWrite && !editing && (
            <button type="button" className="ctl-primary" onClick={() => setEditing("new")}>
              <Plus className="size-3.5" strokeWidth={2} />
              Nova categoria
            </button>
          )}
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Fechar
          </button>
        </>
      }
    >
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
        <DialogField label="Quota" hint="€">
          <input
            value={fee}
            onChange={(e) => setFee(e.target.value.replace(/[^\d.,]/g, ""))}
            inputMode="decimal"
            placeholder="30"
            className={dialogInputClass}
          />
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Metric, MetricRow, Monogram, Panel, Pill, type Column } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Toolbar } from "@/components/filters";
import { FamilyInviteDialog } from "@/components/FamilyInviteDialog";
import { Check, Copy, Home, Link2, Send, Trash2 } from "@/lib/icons";
import { athleteById, listGuardians, teamById } from "@/lib/api";
import { percent, shortName } from "@/lib/format";
import { apiDelete, apiGet, apiPatch } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { can } from "@/lib/permissions";
import { cx } from "@/components/primitives";
import type { Guardian } from "@/data/types";
import { useSession } from "@/session";

/**
 * Famílias.
 *
 * A coluna que interessa e que nenhum concorrente tem: **quem já instalou a app**.
 * Uma família sem app continua a viver no WhatsApp — é ali que o produto ainda não
 * chegou, e é essa a lista de trabalho da secretaria.
 */
export default function Families() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [convidar, setConvidar] = useState(false);

  const filter = params.get("filtro") ?? "todas";
  const setFilter = (v: string) => setParams(v === "todas" ? {} : { filtro: v });

  const guardians = listGuardians();
  const [busy, setBusy] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const mayWrite = can(session, "family:write");

  /*
   * O link de convite que estiver vivo. `null` quando não há nenhum.
   *
   * O servidor devolve só um — "um vivo de cada vez" é a regra que evita ninguém
   * saber quantas portas estão abertas. Ver `FamilyInvitesService.current`.
   */
  const [link, setLink] = useState<InviteLink | null>(null);

  const recarregarLink = useCallback(async () => {
    try {
      // Sem link vivo o servidor responde `null`, que chega cá como `undefined`.
      setLink((await apiGet<InviteLink | null>("/api/family-invite")) ?? null);
    } catch {
      // Silencioso: não conseguir ler o link não pode partir a página das famílias.
      setLink(null);
    }
  }, []);

  useEffect(() => {
    void recarregarLink();
  }, [recarregarLink]);
  const withApp = guardians.filter((g) => g.appInstalled).length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return guardians
      .filter((g) => (filter === "sem-app" ? !g.appInstalled : true))
      .filter((g) => (q ? g.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "pt"));
  }, [guardians, filter, query]);

  /*
   * Desactivar a conta de um encarregado.
   *
   * A ligação ao educando fica: quem foi encarregado continua no histórico do
   * atleta. O que sai é o **acesso** — a app deixa de abrir, e os avisos deixam
   * de lhe chegar. É a mesma `Membership.isActive` que fecha a porta ao staff.
   */
  async function toggleAcesso(g: Guardian) {
    setBusy(g.id);
    try {
      await apiPatch(`/api/memberships/${g.id}/active`, { active: !g.isActive });
      await reloadAcademy();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível mudar o acesso.");
    } finally {
      setBusy(null);
    }
  }

  /*
   * Apagar a conta de um encarregado.
   *
   * Ao lado de "Desactivar" e não em vez dele, porque respondem a coisas
   * diferentes: desactivar é para o pai que saiu do clube — a ligação ao educando
   * fica, e o histórico do atleta continua a fazer sentido. Apagar é para a conta
   * que não devia existir: um email trocado, um registo duplicado pelo link da
   * app. O servidor recusa assim que houver alguma coisa escrita em nome dela.
   */
  async function apagar(g: Guardian) {
    if (!confirm(`Apagar a conta de ${g.name}? Perde o acesso e deixa de estar ligada aos educandos.`)) return;
    setBusy(g.id);
    setErro(null);
    try {
      await apiDelete(`/api/memberships/${g.id}`);
      await reloadAcademy();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar a conta.");
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<Guardian>[] = [
    {
      key: "name",
      header: "Encarregado",
      render: (g) => (
        <div className="flex items-center gap-2.5">
          <Monogram name={g.name} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-ink">{g.name}</span>
              {!g.isActive && <Pill tone="neutral">sem acesso</Pill>}
            </div>
            <div className="text-meta text-ink-3">{g.relation}</div>
          </div>
        </div>
      ),
    },
    {
      key: "children",
      header: "Educandos",
      render: (g) => (
        <div className="flex flex-col gap-0.5">
          {g.athleteIds.map((id) => {
            const a = athleteById(id);
            return (
              <span key={id} className="truncate text-ink-2">
                {shortName(a?.name ?? "—")}
                <span className="text-ink-4"> · {teamById(a?.teamId ?? "")?.name}</span>
              </span>
            );
          })}
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contacto",
      hideBelow: "lg",
      render: (g) => (
        <div className="min-w-0">
          <div className="truncate text-ink-2 tabular">{g.phone}</div>
          <div className="truncate text-meta text-ink-4">{g.email}</div>
        </div>
      ),
    },
    {
      key: "app",
      header: "App",
      hideBelow: "sm",
      render: (g) =>
        g.appInstalled ? <Pill tone="ok">Instalada</Pill> : <Pill tone="warn">Por instalar</Pill>,
    },
    {
      key: "acesso",
      header: "",
      align: "right",
      render: (g) =>
        mayWrite ? (
          <div className="flex items-center justify-end gap-0.5">
            <button
              type="button"
              onClick={() => void toggleAcesso(g)}
              disabled={busy === g.id}
              className={cx("ctl-ghost", g.isActive ? "text-ink-3 hover:text-risk" : "text-ok")}
            >
              {busy === g.id ? "…" : g.isActive ? "Desactivar" : "Reactivar"}
            </button>
            <button
              type="button"
              onClick={() => void apagar(g)}
              disabled={busy === g.id}
              title="Apagar conta"
              aria-label={`Apagar a conta de ${g.name}`}
              className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-ink-4 transition-colors duration-[120ms] hover:bg-risk-soft hover:text-risk"
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      {erro && (
        <p className="mb-3 rounded-[var(--radius-control)] bg-risk-soft px-3.5 py-2.5 text-meta text-risk">{erro}</p>
      )}

      <PageHeader title="Famílias" subtitle={`${guardians.length} encarregados de educação`}>
        {/*
          Convidar exige `family:write`, e o botão passou a perguntar.

          Não perguntava, e ninguém dava por isso enquanto só a direcção via esta
          página. Quando o treinador passou a ver as famílias das equipas dele
          (`family:read`), passou a ver também um botão que o servidor recusa —
          um botão que só serve para dar um erro é pior do que botão nenhum.

          O servidor já exigia `family:write` em `family-invites.service.ts`; isto
          é só a interface a dizer a mesma coisa.
        */}
        {mayWrite && (
          <button type="button" onClick={() => setConvidar(true)} className="ctl-primary">
            <Send className="size-3.5" strokeWidth={1.75} />
            Convidar para a app
          </button>
        )}
      </PageHeader>

      {convidar && mayWrite && (
        <FamilyInviteDialog
          onClose={() => {
            setConvidar(false);
            // O diálogo pode ter gerado, trocado ou revogado o link. A barra por
            // baixo tem de o saber sem esperar por um F5.
            void recarregarLink();
          }}
        />
      )}

      {/*
        O link que já existe, à vista de quem entra.

        Havia um, com prazo e uma contagem de quantas famílias já entraram por
        ele — mas só se via abrindo o diálogo de convidar. Quem chegava aqui não
        tinha como saber se já andava um link a circular, e o resultado é o de
        sempre: geram-se dois, e o primeiro deixa de funcionar na mão de quem o
        recebeu (o servidor fecha o anterior ao criar um novo, de propósito).

        Aparece a quem tem `family:read`, incluindo o treinador: saber que há um
        convite a circular não é uma decisão, é contexto — e ele não o pode trocar
        nem revogar, porque isso pede `family:write`.
      */}
      {link && <InviteBanner link={link} mayWrite={mayWrite} onAbrir={() => setConvidar(true)} />}

      <div className="space-y-3">
        <MetricRow>
          <Metric label="Famílias" value={String(guardians.length)} icon={Home} note="com educandos activos" />
          <Metric label="Com a app instalada" value={percent(withApp / guardians.length)} note={`${withApp} de ${guardians.length}`} />
          <Metric label="Ainda no WhatsApp" value={String(guardians.length - withApp)} note="por convidar" />
          <Metric label="Pagamento automático" value="—" note="débito directo por activar" />
        </MetricRow>

        <Panel>
          <Toolbar>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: "todas", label: "Todas", count: guardians.length },
                { value: "sem-app", label: "Sem a app", count: guardians.length - withApp },
              ]}
            />
            <SearchInput value={query} onChange={setQuery} placeholder="Procurar família…" />
            <ResultCount n={rows.length} noun={["família", "famílias"]} />
          </Toolbar>

          <DataTable
            columns={columns}
            rows={rows}
            keyOf={(g) => g.id}
            empty={<Empty icon={Home} title="Nenhuma família corresponde" />}
          />
        </Panel>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

type InviteLink = {
  id: string;
  link: string;
  expiresAt: string | null;
  usedCount: number;
  createdAt: string;
  createdBy: string | null;
};

/**
 * O link de convite que anda a circular.
 *
 * Diz três coisas, por esta ordem: que existe, até quando, e quantas famílias já
 * entraram por ele. A terceira é a que faz alguém perceber se o link está a
 * funcionar ou se ninguém lhe pegou.
 *
 * Copiar está aqui e não só dentro do diálogo porque é a acção que se vem cá
 * fazer noventa por cento das vezes: mandar o link a mais uma família.
 */
function InviteBanner({
  link,
  mayWrite,
  onAbrir,
}: {
  link: InviteLink;
  mayWrite: boolean;
  onAbrir: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  const expira = link.expiresAt ? new Date(link.expiresAt) : null;
  const dias = expira ? Math.ceil((expira.getTime() - Date.now()) / 86_400_000) : null;
  // A três dias ou menos passa a âmbar: é quando vale a pena renová-lo antes de o
  // mandar a alguém que só o vai abrir no fim-de-semana.
  const aExpirar = dias !== null && dias <= 3;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link.link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sem permissão de área de transferência: o texto continua visível para copiar à mão */
    }
  }

  return (
    <div
      className={cx(
        "mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-panel)] border px-4 py-3",
        aExpirar ? "border-warn/25 bg-warn-soft" : "border-line bg-surface",
      )}
    >
      <Link2 className={cx("size-4 shrink-0", aExpirar ? "text-warn" : "text-ink-3")} strokeWidth={1.75} />

      <div className="min-w-0 flex-1">
        <div className={cx("text-body", aExpirar ? "font-medium text-warn" : "text-ink")}>
          Há um link de convite a circular
        </div>
        <div className="text-meta text-ink-3">
          {expira === null
            ? "Sem prazo"
            : dias !== null && dias <= 0
              ? "Expira hoje"
              : dias === 1
                ? "Expira amanhã"
                : `Expira em ${dias} dias`}
          {" · "}
          {link.usedCount === 0
            ? "ainda ninguém entrou por ele"
            : `${link.usedCount} ${link.usedCount === 1 ? "família entrou" : "famílias entraram"}`}
          {link.createdBy && ` · criado por ${link.createdBy}`}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={() => void copiar()} className="ctl-outline">
          {copiado ? (
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
        {/* Trocar ou revogar pede `family:write` — o servidor recusa a quem não tem. */}
        {mayWrite && (
          <button type="button" onClick={onAbrir} className="ctl-ghost">
            Gerir
          </button>
        )}
      </div>
    </div>
  );
}
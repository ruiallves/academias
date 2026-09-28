import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, Check, Mail, Phone, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, Pill, cx } from "@/components/primitives";
import { ContactDialog } from "@/components/ContactDialog";
import { CalendarDialog } from "@/components/CalendarDialog";
import { Failed, Skeleton } from "./Overview";
import { googleEventUrl } from "@/lib/google";
import { apiPatch } from "@/lib/http";
import { useApi } from "@/lib/query";
import {
  ASSOCIACOES_FUTEBOL,
  CONTACT_STATUS,
  CONTACT_STATUS_LABEL,
  MODALIDADES_COM_AF,
  type Contact,
  type ContactStatus,
  type Me,
} from "@/lib/types";

const TONE: Record<ContactStatus, "neutral" | "ok" | "warn" | "risk" | "signal"> = {
  NOVO: "neutral",
  CONTACTADO: "signal",
  SEM_RESPOSTA: "warn",
  REUNIAO: "ok",
  PROPOSTA: "signal",
  CLIENTE: "ok",
  PERDIDO: "neutral",
};

type Filter = "todos" | "seguimento" | ContactStatus;

/**
 * Contactos: que clubes já contactámos, e o que responderam.
 *
 * Cada linha é um **clube**. Não se assume que se sabe o nome de alguém: o que
 * interessa ver de relance é se já se mandou email, se já se ligou, e a resposta.
 * "Email" e "Chamada" marcam-se na própria linha, com um clique, porque é isso
 * que se faz vinte vezes seguidas numa tarde de contactos.
 *
 * Os clubes dividem-se pela associação: as AFs no futebol e no futsal (AF Porto
 * por omissão), e a associação que se escrever nas outras modalidades. O filtro
 * de associação junta as duas coisas numa lista só, agrupada por modalidade.
 */
export default function Contacts({ me }: { me: Me }) {
  const { data, loading, error, reload } = useApi<Contact[]>("/contactos");
  const [lista, setLista] = useState<Contact[] | null>(null);
  const [filter, setFilter] = useState<Filter>("todos");
  const [grupo, setGrupo] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Contact | "novo" | null>(null);
  const [calendar, setCalendar] = useState(false);

  useEffect(() => {
    if (data) setLista(data);
  }, [data]);

  const all = lista ?? [];
  const grupos = useMemo(() => gruposDe(all), [all]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((c) => (grupo ? noGrupo(c, grupo) : true))
      .filter((c) => {
        if (filter === "todos") return true;
        if (filter === "seguimento") return isDue(c.nextActionAt);
        return c.status === filter;
      })
      .filter((c) =>
        q
          ? [c.name, c.association, c.sport, c.personName, c.phone, c.email, c.replyNote].some((v) =>
              v?.toLowerCase().includes(q),
            )
          : true,
      );
  }, [all, filter, grupo, query]);

  if (loading && !lista) return <Skeleton />;
  if (error && !lista) return <Failed message={error} onRetry={reload} />;

  const doGrupo = grupo ? all.filter((c) => noGrupo(c, grupo)) : all;
  const atrasados = doGrupo.filter((c) => isDue(c.nextActionAt)).length;
  const counts = (s: ContactStatus) => doGrupo.filter((c) => c.status === s).length;
  const porContactar = doGrupo.filter((c) => !c.emailedAt && !c.calledAt).length;

  /** Trocar uma linha pela versão que o servidor devolveu, sem recarregar a lista. */
  const trocar = (c: Contact) => setLista((l) => (l ?? []).map((x) => (x.id === c.id ? c : x)));

  async function marcar(c: Contact, campo: "emailed" | "called") {
    const tem = campo === "emailed" ? Boolean(c.emailedAt) : Boolean(c.calledAt);
    try {
      trocar(await apiPatch<Contact>(`/contactos/${c.id}`, { [campo]: !tem }));
    } catch {
      /* O erro aparece no cartão global de avisos; a linha fica como estava. */
    }
  }

  return (
    <>
      <PageHeader
        title="Contactos"
        subtitle={[
          `${doGrupo.length} ${doGrupo.length === 1 ? "clube" : "clubes"}`,
          porContactar > 0 ? `${porContactar} por contactar` : null,
          atrasados > 0 ? `${atrasados} ${atrasados === 1 ? "seguimento" : "seguimentos"} para hoje` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <button type="button" onClick={() => setCalendar(true)} className="ctl-outline">
          <CalendarPlus className="size-3.5" strokeWidth={1.75} />
          Google Calendar
        </button>
        <button type="button" onClick={() => setOpen("novo")} className="ctl-primary">
          <Plus className="size-3.5" strokeWidth={2} />
          Novo clube
        </button>
      </PageHeader>

      {calendar && <CalendarDialog onClose={() => setCalendar(false)} />}

      {open && (
        <ContactDialog
          contact={open === "novo" ? null : open}
          todos={all}
          grupo={grupo}
          me={me}
          onClose={() => setOpen(null)}
          onSaved={() => reload()}
        />
      )}

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <select
            value={grupo}
            onChange={(e) => setGrupo(e.target.value)}
            aria-label="Associação"
            className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-meta text-ink focus:border-line-strong focus:outline-none"
          >
            <option value="">Todas as associações</option>
            {grupos.map((g) => (
              <optgroup key={g.sport} label={g.sport}>
                <option value={`s:${g.sport}`}>
                  {g.sport} · todas ({g.total})
                </option>
                {g.associacoes.map((a) => (
                  <option key={a.nome} value={`a:${g.sport}|${a.nome}`}>
                    {a.nome} ({a.total})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Clube, pessoa, resposta…"
              className="h-8 w-[220px] rounded-[var(--radius-control)] bg-sunken pl-8 text-meta text-ink placeholder:text-ink-4 focus:bg-surface focus:ring-1 focus:ring-line-strong focus:outline-none"
            />
          </div>

          <div className="flex w-full flex-wrap rounded-[var(--radius-control)] border border-line p-0.5">
            <Chip active={filter === "todos"} onClick={() => setFilter("todos")} label="Todos" />
            <Chip
              active={filter === "seguimento"}
              onClick={() => setFilter("seguimento")}
              label="Seguimento para hoje"
              count={atrasados}
              urgent
            />
            {CONTACT_STATUS.map((s) => (
              <Chip key={s} active={filter === s} onClick={() => setFilter(s)} label={CONTACT_STATUS_LABEL[s]} count={counts(s)} />
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <Empty
            title={all.length === 0 ? "Ainda não há clubes" : "Nada neste filtro"}
            detail={
              all.length === 0
                ? "Cada clube que contactarmos entra aqui: se mandámos email, se ligámos e o que responderam."
                : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="border-b border-line bg-sunken/60 text-meta font-medium text-ink-3">
                  <th className="px-5 py-2 text-left">Clube</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Associação</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Email</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Chamada</th>
                  <th className="px-3 py-2 text-left">Resposta</th>
                  <th className="px-5 py-2 text-left whitespace-nowrap">Seguimento</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setOpen(c)}
                    className="cursor-pointer border-b border-line last:border-b-0 hover:bg-sunken/40"
                  >
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-ink">{c.name}</div>
                      {(c.personName || c.academy) && (
                        <div className="truncate text-[11px] text-ink-4">
                          {c.academy ? `cliente · ${c.academy.slug}` : [c.personName, c.role].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-2.5 whitespace-nowrap text-ink-2">
                      {c.association ?? <span className="text-ink-4">sem associação</span>}
                      {c.sport !== "Futebol" && <div className="text-[11px] text-ink-4">{c.sport}</div>}
                    </td>

                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <Marca quando={c.emailedAt} icon="mail" onClick={() => void marcar(c, "emailed")} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <Marca quando={c.calledAt} icon="phone" onClick={() => void marcar(c, "called")} />
                    </td>

                    <td className="max-w-[280px] px-3 py-2.5">
                      <Pill tone={TONE[c.status]}>{CONTACT_STATUS_LABEL[c.status]}</Pill>
                      {c.replyNote && <div className="mt-0.5 truncate text-[11px] text-ink-3">{c.replyNote}</div>}
                    </td>

                    <td className="px-5 py-2.5 whitespace-nowrap">
                      <Follow contact={c} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

/**
 * Email enviado / Ligámos, na própria linha.
 *
 * Um clique marca (com a data de hoje) e outro desmarca. `stopPropagation`
 * porque a linha inteira abre a ficha, e marcar não é abrir.
 */
function Marca({ quando, icon, onClick }: { quando: string | null; icon: "mail" | "phone"; onClick: () => void }) {
  const Icon = icon === "mail" ? Mail : Phone;
  const rotulo = icon === "mail" ? "email enviado" : "ligámos";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={quando ? `Desmarcar ${rotulo}` : `Marcar ${rotulo}`}
      className={cx(
        "inline-flex items-center gap-1 rounded-[var(--radius-control)] border px-2 py-0.5 text-[11px] font-medium transition-colors duration-[120ms]",
        quando
          ? "border-transparent bg-[#e6f2ea] text-[#1f6b3a] hover:bg-[#d8ebdf]"
          : "border-dashed border-line text-ink-4 hover:border-line-strong hover:text-ink-2",
      )}
    >
      {quando ? <Check className="size-3" strokeWidth={2.25} /> : <Icon className="size-3" strokeWidth={1.75} />}
      {quando ? new Date(quando).toLocaleDateString("pt-PT", { day: "numeric", month: "short" }) : "marcar"}
    </button>
  );
}

/** O próximo passo, e o botão que o põe no Google. */
function Follow({ contact }: { contact: Contact }) {
  if (!contact.nextActionAt) {
    return <span className="text-meta text-ink-4">sem data</span>;
  }

  const when = new Date(contact.nextActionAt);
  const due = isDue(contact.nextActionAt);

  return (
    <div className="flex items-center gap-1.5">
      <span className={cx("text-meta tabular", due ? "font-medium text-[#a82a20]" : "text-ink-2")}>{dueLabel(when)}</span>
      <a
        href={googleEventUrl(contact, when)}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-ink-4 hover:text-ink-2"
        aria-label={`Agendar no Google Calendar: ${contact.name}`}
        title="Agendar no Google Calendar"
      >
        <CalendarPlus className="size-3.5" strokeWidth={1.75} />
      </a>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  count,
  urgent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  urgent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
        active ? "bg-ink text-surface" : urgent && count ? "text-[#a82a20] hover:text-ink" : "text-ink-3 hover:text-ink",
      )}
    >
      {label}
      {count !== undefined && count > 0 && <span className="ml-1.5 tabular opacity-60">{count}</span>}
    </button>
  );
}

/* -------------------------------------------------------------------------- */

type Grupo = { sport: string; total: number; associacoes: { nome: string; total: number }[] };

/**
 * As associações que há na lista, por modalidade.
 *
 * No futebol aparecem pela ordem das AFs (AF Porto primeiro); nas outras
 * modalidades por ordem alfabética. "Sem associação" no fim de cada modalidade,
 * para se ver o que falta classificar.
 */
function gruposDe(contactos: Contact[]): Grupo[] {
  const porSport = new Map<string, Map<string, number>>();
  for (const c of contactos) {
    const m = porSport.get(c.sport) ?? new Map<string, number>();
    const a = c.association ?? SEM;
    m.set(a, (m.get(a) ?? 0) + 1);
    porSport.set(c.sport, m);
  }
  const ordemSport = (s: string) => (s === "Futebol" ? 0 : s === "Futsal" ? 1 : 2);
  return [...porSport.entries()]
    .sort(([a], [b]) => ordemSport(a) - ordemSport(b) || a.localeCompare(b, "pt"))
    .map(([sport, m]) => {
      const ordem = (n: string) => {
        if (n === SEM) return 999;
        const i = MODALIDADES_COM_AF.includes(sport) ? ASSOCIACOES_FUTEBOL.indexOf(n) : -1;
        return i >= 0 ? i : 500;
      };
      const associacoes = [...m.entries()]
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => ordem(a.nome) - ordem(b.nome) || a.nome.localeCompare(b.nome, "pt"));
      return { sport, total: associacoes.reduce((s, a) => s + a.total, 0), associacoes };
    });
}

const SEM = "Sem associação";

/** `s:<modalidade>` ou `a:<modalidade>|<associação>`. */
function noGrupo(c: Contact, grupo: string): boolean {
  if (grupo.startsWith("s:")) return c.sport === grupo.slice(2);
  const [sport, assoc] = grupo.slice(2).split("|");
  return c.sport === sport && (c.association ?? SEM) === assoc;
}

/** Marcado para hoje ou para trás. O "hoje" conta como a pedir — é hoje que se faz. */
export function isDue(iso: string | null): boolean {
  if (!iso) return false;
  const end = new Date(iso);
  end.setHours(23, 59, 59, 999);
  return end.getTime() <= Date.now();
}

/** "hoje", "amanhã", "há 2 dias", "em 9 dias". A distância, que é o que se decide. */
function dueLabel(when: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(when);
  target.setHours(0, 0, 0, 0);

  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  if (days === -1) return "ontem";
  if (days < 0) return `há ${-days} dias`;
  if (days <= 14) return `em ${days} dias`;
  return when.toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
}

import { useMemo, useState } from "react";
import { CalendarPlus, MessageCircle, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, Pill, cx } from "@/components/primitives";
import { ContactDialog } from "@/components/ContactDialog";
import { CalendarDialog } from "@/components/CalendarDialog";
import { Failed, Skeleton } from "./Overview";
import { since } from "@/lib/format";
import { googleEventUrl, telHref, whatsappHref } from "@/lib/google";
import { useApi } from "@/lib/query";
import {
  CHANNEL_LABEL,
  CONTACT_STATUS,
  CONTACT_STATUS_LABEL,
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
 * Contactos — quem já falámos, e em que pé está.
 *
 * ## A pergunta que esta página responde
 *
 * "A quem ligo hoje." Não é "quantos contactos tenho" nem "qual é a taxa de
 * conversão" — isso é analítica, e mora noutro sítio. Por isso a ordem por omissão
 * não é alfabética nem por data de criação: é **seguimento atrasado primeiro**,
 * depois o que está marcado, e só depois o resto por ordem de esfriamento.
 *
 * ## Porque é que não há colunas a mais
 *
 * Nome, número, clube e estado. As quatro que se lêem de relance e as únicas que
 * decidem alguma coisa antes de se abrir a linha. Tudo o resto — o cargo, o email,
 * o histórico das conversas, as notas — está a um clique, na ficha, que é onde se
 * lê antes de ligar. Uma tabela com dezoito colunas obriga a procurar; uma com
 * quatro entrega.
 *
 * As duas colunas que se acrescentam a essas quatro ganham o lugar por serem
 * temporais: o **seguimento** é o que gera trabalho, e o **último contacto** é o
 * que diz se alguém está a esfriar.
 */
export default function Contacts({ me }: { me: Me }) {
  const { data, loading, error, reload } = useApi<Contact[]>("/contactos");
  const [filter, setFilter] = useState<Filter>("todos");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Contact | "novo" | null>(null);
  const [calendar, setCalendar] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? [])
      .filter((c) => {
        if (filter === "todos") return true;
        if (filter === "seguimento") return isDue(c.nextActionAt);
        return c.status === filter;
      })
      .filter((c) =>
        q
          ? [c.name, c.club, c.phone, c.email, c.role].some((v) => v?.toLowerCase().includes(q))
          : true,
      );
  }, [data, filter, query]);

  if (loading) return <Skeleton />;
  if (error) return <Failed message={error} onRetry={reload} />;

  const all = data ?? [];
  const atrasados = all.filter((c) => isDue(c.nextActionAt)).length;
  const counts = (s: ContactStatus) => all.filter((c) => c.status === s).length;

  return (
    <>
      <PageHeader
        title="Contactos"
        subtitle={
          atrasados > 0
            ? `${all.length} pessoas · ${atrasados} ${atrasados === 1 ? "seguimento a pedir" : "seguimentos a pedir"} atenção`
            : `${all.length} pessoas`
        }
      >
        <button type="button" onClick={() => setCalendar(true)} className="ctl-outline">
          <CalendarPlus className="size-3.5" strokeWidth={1.75} />
          Google Calendar
        </button>
        <button type="button" onClick={() => setOpen("novo")} className="ctl-primary">
          <Plus className="size-3.5" strokeWidth={2} />
          Novo contacto
        </button>
      </PageHeader>

      {calendar && <CalendarDialog onClose={() => setCalendar(false)} />}

      {open && (
        <ContactDialog
          contact={open === "novo" ? null : open}
          me={me}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            reload();
          }}
        />
      )}

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="flex flex-wrap rounded-[var(--radius-control)] border border-line p-0.5">
            <Chip active={filter === "todos"} onClick={() => setFilter("todos")} label="Todos" />
            {/*
              O filtro que não é um estado. Vive aqui e não numa página à parte
              porque é a mesma lista vista pela pergunta de hoje — e porque uma
              segunda página seria uma segunda lista para manter sincronizada.
            */}
            <Chip
              active={filter === "seguimento"}
              onClick={() => setFilter("seguimento")}
              label="A pedir seguimento"
              count={atrasados}
              urgent
            />
            {CONTACT_STATUS.map((s) => (
              <Chip
                key={s}
                active={filter === s}
                onClick={() => setFilter(s)}
                label={CONTACT_STATUS_LABEL[s]}
                count={counts(s)}
              />
            ))}
          </div>

          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nome, clube, número…"
              className="h-8 w-[220px] rounded-[var(--radius-control)] bg-sunken pl-8 text-meta text-ink placeholder:text-ink-4 focus:bg-surface focus:ring-1 focus:ring-line-strong focus:outline-none"
            />
          </div>
        </div>

        {rows.length === 0 ? (
          <Empty
            title={all.length === 0 ? "Ainda não há contactos" : "Nada neste filtro"}
            detail={
              all.length === 0
                ? "Cada pessoa com quem falares sobre o produto entra aqui, com o estado da conversa e a data do próximo passo."
                : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="border-b border-line bg-sunken/60 text-meta font-medium text-ink-3">
                  <th className="px-5 py-2 text-left">Nome</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Número</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Clube</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Estado</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Seguimento</th>
                  <th className="px-5 py-2 text-right whitespace-nowrap">Último contacto</th>
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
                      {(c.role || c.email) && (
                        <div className="truncate text-[11px] text-ink-4">{c.role ?? c.email}</div>
                      )}
                    </td>

                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {c.phone ? (
                        <div className="flex items-center gap-1.5">
                          {/*
                            `stopPropagation` em cada atalho: a linha inteira abre a
                            ficha, e ligar a alguém não é abrir a ficha dele.
                          */}
                          <a
                            href={telHref(c.phone)}
                            onClick={(e) => e.stopPropagation()}
                            className="tabular text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink"
                          >
                            {c.phone}
                          </a>
                          <a
                            href={whatsappHref(c.phone)}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-ink-4 hover:text-ink-2"
                            aria-label={`WhatsApp para ${c.name}`}
                            title="WhatsApp"
                          >
                            <MessageCircle className="size-3.5" strokeWidth={1.75} />
                          </a>
                        </div>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </td>

                    <td className="px-3 py-2.5 text-ink-2">
                      {c.club ?? <span className="text-ink-4">—</span>}
                      {c.academy && <div className="text-[11px] text-ink-4">cliente · {c.academy.slug}</div>}
                    </td>

                    <td className="px-3 py-2.5">
                      <Pill tone={TONE[c.status]}>{CONTACT_STATUS_LABEL[c.status]}</Pill>
                    </td>

                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <Follow contact={c} />
                    </td>

                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      <span className={cx("text-meta", cooling(c.lastContactAt, c.status))}>
                        {since(c.lastContactAt)}
                      </span>
                      {c.lastTouch && (
                        <div className="text-[11px] text-ink-4">
                          {CHANNEL_LABEL[c.lastTouch.channel]}
                          {c.touchCount > 1 && ` · ${c.touchCount} contactos`}
                        </div>
                      )}
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
 * O próximo passo, e o botão que o põe no Google.
 *
 * Sem data marcada aparece o convite a marcar uma — vazio é onde os seguimentos
 * morrem, e uma célula em branco não pede nada a ninguém.
 */
function Follow({ contact }: { contact: Contact }) {
  if (!contact.nextActionAt) {
    return <span className="text-meta text-ink-4">sem data</span>;
  }

  const when = new Date(contact.nextActionAt);
  const due = isDue(contact.nextActionAt);

  return (
    <div className="flex items-center gap-1.5">
      <span className={cx("text-meta tabular", due ? "font-medium text-[#a82a20]" : "text-ink-2")}>
        {dueLabel(when)}
      </span>
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

/**
 * Quem há muito não ouve nada esfria — mas só quem ainda está em jogo. Marcar de
 * vermelho um cliente fechado ou um contacto perdido seria pedir uma acção que não
 * existe.
 */
function cooling(iso: string | null, status: ContactStatus): string {
  if (status === "CLIENTE" || status === "PERDIDO") return "text-ink-4";
  if (!iso) return "text-ink-4";
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (days > 30) return "text-[#a82a20] font-medium";
  if (days > 14) return "text-[#8a5a12]";
  return "text-ink-3";
}


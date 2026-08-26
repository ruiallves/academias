import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRightLeft, Inbox, Mail, Phone, Search, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, Pill, cx } from "@/components/primitives";
import { Failed, Skeleton } from "./Overview";
import { since } from "@/lib/format";
import { telHref } from "@/lib/google";
import { useApi } from "@/lib/query";
import {
  TICKET_STATUS,
  TICKET_STATUS_LABEL,
  TICKET_TONE,
  addTicketNote,
  converterTicket,
  removeTicket,
  replyHref,
  updateTicket,
  type Ticket,
  type TicketDetail,
  type TicketList,
  type TicketStatus,
} from "@/lib/tickets";
import type { Me } from "@/lib/types";
import { Spinner } from "@/components/Busy";

type Filter = "ABERTOS" | "todos" | TicketStatus;

/**
 * Tickets — o que chegou pelo site.
 *
 * ## A pergunta que esta página responde
 *
 * "O que é que falta responder." Uma só, e por isso o filtro por omissão não é
 * "todos": é **por fechar**. Uma caixa de entrada que abre com tudo lá dentro,
 * incluindo o que foi tratado há três meses, deixa de responder à única coisa que
 * se lhe pergunta.
 *
 * ## Porque é que isto não é a página dos Contactos
 *
 * Porque as duas listas têm donos diferentes. *Contactos* é o funil: quem andamos
 * a trabalhar, com responsável, próximo passo e entrada no calendário. Isto são
 * mensagens de estranhos, por triar — a maior parte nunca vai ser cliente.
 *
 * Estavam na mesma tabela, e o formulário do site enfiava o assunto e o número de
 * atletas dentro de um campo de notas como texto corrido. Perdia-se o dado e
 * enchia-se a lista de trabalho de curiosos. O botão *Converter* é a ponte, e é
 * um gesto de propósito: alguém decide que aquele pedido é um negócio.
 *
 * ## Porque é que a linha abre em vez de navegar
 *
 * Porque um ticket lê-se inteiro em três linhas e responde-se ali. Uma página por
 * pedido obrigava a ir e voltar dezenas de vezes para triar uma manhã de correio.
 */
export default function Tickets({ me }: { me: Me }) {
  const [filter, setFilter] = useState<Filter>("ABERTOS");
  const [q, setQ] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  const query = new URLSearchParams();
  if (filter !== "todos") query.set("estado", filter);
  if (q.trim()) query.set("q", q.trim());
  const { data, loading, error, reload } = useApi<TicketList>(
    `/tickets${query.toString() ? `?${query}` : ""}`,
  );

  if (error) return <Failed message={error} onRetry={reload} />;

  const tickets = data?.tickets ?? [];
  const counts = data?.counts ?? {};
  const porVer = counts.NOVO ?? 0;

  const FILTERS: { id: Filter; label: string; n?: number }[] = [
    { id: "ABERTOS", label: "Por fechar", n: (counts.NOVO ?? 0) + (counts.ABERTO ?? 0) + (counts.RESPONDIDO ?? 0) },
    ...TICKET_STATUS.map((s) => ({ id: s as Filter, label: TICKET_STATUS_LABEL[s], n: counts[s] ?? 0 })),
    { id: "todos", label: "Todos" },
  ];

  return (
    <>
      <PageHeader
        title="Tickets"
        subtitle={porVer > 0 ? `${porVer} por ver — o que chegou pelo formulário do site.` : "O que chega pelo formulário do site."}
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cx(
                  "rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition-colors",
                  filter === f.id ? "bg-ink text-surface" : "text-ink-3 hover:bg-sunken hover:text-ink",
                )}
              >
                {f.label}
                {f.n !== undefined && f.n > 0 && <span className="ml-1.5 tabular opacity-60">{f.n}</span>}
              </button>
            ))}
          </div>

          <label className="ml-auto flex items-center gap-1.5 rounded-[7px] border border-line px-2">
            <Search className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nome, email, clube…"
              className="h-7 w-44 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-4"
            />
          </label>
        </div>

        {loading && tickets.length === 0 ? (
          <Skeleton />
        ) : tickets.length === 0 ? (
          <Empty
            title={filter === "ABERTOS" ? "Nada por responder" : "Nenhum pedido"}
            detail={
              filter === "ABERTOS"
                ? "Tudo o que chegou pelo site já foi tratado."
                : "Os pedidos do formulário de contacto do site aparecem aqui."
            }
          />
        ) : (
          <ul>
            {tickets.map((t) => (
              <TicketRow
                key={t.id}
                ticket={t}
                me={me}
                open={aberto === t.id}
                onToggle={() => setAberto((x) => (x === t.id ? null : t.id))}
                onChanged={reload}
              />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function TicketRow({
  ticket,
  me,
  open,
  onToggle,
  onChanged,
}: {
  ticket: Ticket;
  me: Me;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  return (
    <li className="border-b border-line last:border-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cx(
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sunken/60",
          open && "bg-sunken/40",
        )}
      >
        {/* O ponto é o que se lê primeiro numa caixa de entrada: já vi ou não. */}
        <span
          className={cx(
            "size-1.5 shrink-0 rounded-full",
            ticket.status === "NOVO" ? "bg-signal" : "bg-transparent",
          )}
          aria-hidden
        />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cx("truncate text-body", ticket.status === "NOVO" ? "font-semibold text-ink" : "text-ink-2")}>
              {ticket.name}
            </span>
            {ticket.club && <span className="truncate text-[12px] text-ink-3">{ticket.club}</span>}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
            <span className="shrink-0 font-medium text-ink-2">{ticket.subject}</span>
            {ticket.message && <span className="truncate">— {ticket.message}</span>}
          </span>
        </span>

        {ticket.contact && <Pill tone="ok">no funil</Pill>}
        {ticket.assignee && <Pill>{ticket.assignee.name.split(" ")[0]}</Pill>}
        <Pill tone={TICKET_TONE[ticket.status]}>{TICKET_STATUS_LABEL[ticket.status]}</Pill>
        <span className="w-20 shrink-0 text-right text-[12px] text-ink-3">{since(ticket.createdAt)}</span>
      </button>

      {open && <TicketBody id={ticket.id} me={me} onChanged={onChanged} />}
    </li>
  );
}

/**
 * O corpo, buscado só quando se abre.
 *
 * A lista já traz a mensagem, mas não as notas internas — e trazer o histórico
 * completo de duzentos pedidos para mostrar um seria pagar o custo de todos para
 * ver um.
 */
function TicketBody({ id, me, onChanged }: { id: string; me: Me; onChanged: () => void }) {
  const { data, loading, error, reload } = useApi<TicketDetail>(`/tickets/${id}`);
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  // Um bloco dentro de uma página já utilizável: disco pequeno, no sítio, e
  // não o desfoque da página inteira. Ver a nota em `Spinner`.
  if (loading && !data) return <Spinner className="py-6" />;
  if (error || !data) return <div className="px-4 py-4 text-[12px] text-risk">{error ?? "Não foi possível abrir."}</div>;

  const t = data;

  async function agir<T>(fn: () => Promise<T>) {
    setBusy(true);
    setErro(null);
    try {
      await fn();
      reload();
      onChanged();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-line bg-sunken/30 px-4 py-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        {/* --- A mensagem e as notas ---------------------------------------- */}
        <div className="min-w-0 space-y-3">
          <div className="rounded-[9px] border border-line bg-surface p-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-body font-medium text-ink">{t.subject}</span>
              {t.athletes && <span className="text-[12px] text-ink-3">{t.athletes} atletas</span>}
            </div>
            {t.message ? (
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{t.message}</p>
            ) : (
              <p className="mt-2 text-[12px] text-ink-4">Sem mensagem — só o pedido.</p>
            )}
          </div>

          {t.notes.length > 0 && (
            <ul className="space-y-2">
              {t.notes.map((n) => (
                <li key={n.id} className="rounded-[9px] border border-line bg-surface/60 px-3 py-2">
                  <div className="text-[11px] text-ink-3">
                    {n.admin?.name ?? "Alguém"} · {since(n.createdAt)}
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{n.body}</p>
                </li>
              ))}
            </ul>
          )}

          {/*
            Nota interna, e não "resposta".
            Este servidor não envia email nenhum. Um campo chamado "Responder" que
            gravasse texto dava a entender que a mensagem tinha saído — e não
            tinha. A resposta sai pelo botão de email, do cliente de quem responde.
          */}
          <div className="flex items-start gap-2">
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              placeholder="Nota interna — o que decidiste, para a equipa saber"
              className="min-w-0 flex-1 resize-y rounded-[7px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-4 focus:border-line-strong"
            />
            <button
              type="button"
              disabled={busy || nota.trim().length < 2}
              onClick={() =>
                void agir(async () => {
                  await addTicketNote(t.id, nota);
                  setNota("");
                })
              }
              className="ctl-outline shrink-0"
            >
              Guardar
            </button>
          </div>
        </div>

        {/* --- Quem é, e o que fazer --------------------------------------- */}
        <div className="space-y-3 text-[12px]">
          <div className="space-y-1.5 rounded-[9px] border border-line bg-surface p-3">
            <a href={replyHref(t)} className="flex items-center gap-2 text-ink hover:underline">
              <Mail className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
              <span className="truncate">{t.email}</span>
            </a>
            {t.phone && (
              <a href={telHref(t.phone)} className="flex items-center gap-2 text-ink hover:underline">
                <Phone className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
                {t.phone}
              </a>
            )}
            {t.club && <div className="text-ink-3">{t.club}</div>}
          </div>

          <a href={replyHref(t)} className="ctl-primary w-full justify-center">
            <Mail className="size-3.5" strokeWidth={2} />
            Responder por email
          </a>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-3">Estado</span>
            <select
              value={t.status}
              disabled={busy}
              onChange={(e) => void agir(() => updateTicket(t.id, { status: e.target.value as TicketStatus }))}
              className="h-8 w-full rounded-[7px] border border-line bg-surface px-2 text-[13px] text-ink outline-none focus:border-line-strong"
            >
              {TICKET_STATUS.map((s) => (
                <option key={s} value={s}>
                  {TICKET_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

          {/*
            A ponte para o funil.
            Um gesto, e não automático: criar um contacto por cada pedido que
            chega era o que fazia a lista de vendas encher-se de curiosos.
          */}
          {t.contact ? (
            <Link to="/contactos" className="ctl-outline w-full justify-center">
              <ArrowRightLeft className="size-3.5" strokeWidth={2} />
              Ver em Contactos
            </Link>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void agir(() => converterTicket(t.id))}
              className="ctl-outline w-full justify-center"
            >
              <ArrowRightLeft className="size-3.5" strokeWidth={2} />
              Converter em contacto
            </button>
          )}

          <div className="border-t border-line pt-2 text-[11px] leading-relaxed text-ink-4">
            Chegou {since(t.createdAt)}
            {t.ip && ` · ${t.ip}`}
          </div>

          {/*
            Apagar é só do dono, e o servidor recusa na mesma a quem não é.
            Esconder o botão poupa a quem não pode um erro que não ia entender.
          */}
          {me.role === "OWNER" &&
            (confirmar ? (
              <div className="flex gap-1.5">
                <button type="button" className="ctl-outline flex-1" onClick={() => setConfirmar(false)}>
                  Não
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="ctl-risk flex-1"
                  onClick={() => void agir(() => removeTicket(t.id))}
                >
                  Apagar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmar(true)}
                className="flex items-center gap-1.5 text-[11px] text-ink-4 hover:text-risk"
              >
                <Trash2 className="size-3" strokeWidth={1.75} />
                Apagar pedido
              </button>
            ))}

          {erro && <p className="text-[11px] text-risk">{erro}</p>}
        </div>
      </div>
    </div>
  );
}

export { Inbox };

import { apiDelete, apiPatch, apiPost } from "@/lib/http";

/**
 * Os pedidos que chegam pelo formulário do site.
 *
 * Isto é a **caixa de entrada**, e não o funil de vendas. Um ticket ou já foi
 * respondido ou ainda não; um `Contact` é um negócio a andar, com responsável e
 * próximo passo no calendário. Viviam na mesma tabela e era um erro — ver a nota
 * em `TicketsService`, do lado do servidor.
 *
 * O que liga os dois é `converterTicket`.
 */

export type TicketStatus = "NOVO" | "ABERTO" | "RESPONDIDO" | "FECHADO";

export const TICKET_STATUS: TicketStatus[] = ["NOVO", "ABERTO", "RESPONDIDO", "FECHADO"];

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  NOVO: "Por ver",
  ABERTO: "A tratar",
  RESPONDIDO: "Respondido",
  FECHADO: "Fechado",
};

export const TICKET_TONE: Record<TicketStatus, "neutral" | "ok" | "warn" | "signal"> = {
  NOVO: "warn",
  ABERTO: "signal",
  RESPONDIDO: "ok",
  FECHADO: "neutral",
};

export type TicketNote = {
  id: string;
  body: string;
  createdAt: string;
  admin: { id: string; name: string } | null;
};

export type Ticket = {
  id: string;
  subject: string;
  subjectId: string | null;
  name: string;
  email: string;
  phone: string | null;
  club: string | null;
  /** O cargo de quem escreveu — decide como a conversa começa. */
  role: string | null;
  athletes: string | null;
  message: string | null;
  status: TicketStatus;
  createdAt: string;
  assignee: { id: string; name: string } | null;
  /** O contacto que nasceu daqui, se alguém já o converteu. */
  contact: { id: string; name: string; status: string } | null;
  notes: number;
};

export type TicketDetail = Omit<Ticket, "notes"> & { ip: string | null; notes: TicketNote[] };

export type TicketList = { tickets: Ticket[]; counts: Partial<Record<TicketStatus, number>> };

export const updateTicket = (id: string, body: { status?: TicketStatus; assigneeId?: string | null }) =>
  apiPatch<TicketDetail>(`/tickets/${id}`, body);

export const addTicketNote = (id: string, body: string) =>
  apiPost<TicketDetail>(`/tickets/${id}/notas`, { body });

export const converterTicket = (id: string) =>
  apiPost<{ contactId: string; jaExistia: boolean }>(`/tickets/${id}/converter`, {});

export const removeTicket = (id: string) => apiDelete<{ ok: true }>(`/tickets/${id}`);

/**
 * "Já vi este." Passa um pedido de `NOVO` a `ABERTO` e apaga-o do emblema do
 * menu, que conta só o que ninguém abriu. Não faz nada aos outros estados.
 */
export const verTicket = (id: string) => apiPost<{ ok: true }>(`/tickets/${id}/visto`, {});

/**
 * O emblema do menu mudou.
 *
 * O `Shell` relê o contador de minuto a minuto, o que chega para um número que
 * sobe sozinho — mas não para um que **desce por causa de um clique nosso**:
 * abrir um pedido e ver o emblema aceso durante mais meio minuto lê-se como
 * avaria. Um evento na janela é o caminho mais curto entre duas partes da
 * aplicação que não partilham estado nenhum.
 */
export const TICKETS_MUDARAM = "tickets:mudaram";
export const avisarQueMudou = () => window.dispatchEvent(new Event(TICKETS_MUDARAM));

/**
 * O `mailto:` para responder, já preenchido.
 *
 * Responder é o que se faz a um ticket, e este servidor não envia email nenhum —
 * não há SMTP nem serviço de envio. Um botão que abrisse um formulário e gravasse
 * o texto dava a entender que a mensagem tinha saído, e não tinha. Isto é honesto:
 * abre o cliente de email de quem responde, com o destinatário, o assunto e a
 * mensagem original citada lá dentro.
 */
export function replyHref(t: Ticket | TicketDetail): string {
  const assunto = `Re: ${t.subject}${t.club ? ` — ${t.club}` : ""}`;
  const citado = (t.message ?? "").split("\n").map((l) => `> ${l}`).join("\n");
  const corpo = [
    `Olá ${t.name.split(" ")[0]},`,
    "",
    "",
    "",
    "---",
    `A ${new Date(t.createdAt).toLocaleDateString("pt-PT")}, ${t.name} escreveu:`,
    citado,
  ].join("\n");
  return `mailto:${t.email}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}

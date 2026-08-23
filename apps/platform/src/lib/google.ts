import type { Contact } from "@/lib/types";

/**
 * O Google Calendar, das duas maneiras que fazem falta.
 *
 * **O feed** (`.ics`, do servidor) é o pano de fundo: subscreve-se uma vez e todos
 * os seguimentos marcados aparecem no calendário, incluindo os que forem mudando.
 * O Google actualiza-o quando lhe apetece — de poucas em poucas horas.
 *
 * **Este link** é o primeiro plano: abre o Google com o evento já preenchido e a
 * pessoa carrega em guardar. Existe porque uma reunião marcada para amanhã de
 * manhã não pode esperar pela próxima sincronização do feed, e porque um evento
 * criado assim é um evento a sério — com convidados, notificações e alterações
 * que ficam do lado de lá.
 *
 * Não é uma API: é um URL documentado que o Google mantém há anos. Sem OAuth, sem
 * chaves, sem uma dependência de rede no caminho de uma lista que tem de abrir.
 */

/** Meia hora. Um seguimento é um telefonema — igual à duração no feed do servidor. */
const DURATION_MIN = 30;

export function googleEventUrl(contact: Contact, when: Date): string {
  const end = new Date(when.getTime() + DURATION_MIN * 60_000);

  const detalhe = [
    contact.nextActionNote,
    contact.phone ? `Telefone: ${contact.phone}` : null,
    contact.email ? `Email: ${contact.email}` : null,
    contact.notes ? `\nNotas: ${contact.notes}` : null,
  ].filter(Boolean).join("\n");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Seguimento: ${contact.name}${contact.club ? ` · ${contact.club}` : ""}`,
    dates: `${stamp(when)}/${stamp(end)}`,
    details: detalhe,
    ctz: "Europe/Lisbon",
  });

  // O telefone no campo do local é o que faz o evento ser accionável a partir do
  // telemóvel: no Android e no iOS, um número ali é um botão de ligar.
  if (contact.phone) params.set("location", contact.phone);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** `20260821T143000Z`, que é o formato que o Google espera com `ctz` a acompanhar. */
function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** `tel:` e `wa.me` — os dois atalhos que poupam a copiar um número para outro sítio. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function whatsappHref(phone: string): string {
  // O wa.me quer o número sem `+` e sem espaços. Um número escrito à portuguesa
  // sem indicativo fica com o 351 à frente — é o palpite certo em 99% dos casos,
  // e o link continua editável do lado do WhatsApp se for o outro 1%.
  const digits = phone.replace(/[^\d]/g, "");
  const full = digits.length === 9 ? `351${digits}` : digits;
  return `https://wa.me/${full}`;
}

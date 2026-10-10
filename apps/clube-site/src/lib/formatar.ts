/**
 * Datas e dinheiro em português de Portugal, sempre na hora de Lisboa.
 *
 * O servidor pode estar em UTC (o Vercel está); as horas de relógio que o
 * site mostra são as do campo, e o campo está em Portugal.
 */

const TZ = "Europe/Lisbon";

function fmt(opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("pt-PT", { timeZone: TZ, ...opts });
}

/** "sábado, 11 de outubro" */
export function dataLonga(iso: string): string {
  return fmt({ weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
}

/** "11 de outubro de 2026" */
export function dataCompleta(iso: string): string {
  return fmt({ day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

/** "11 out" */
export function dataCurta(iso: string): string {
  return fmt({ day: "numeric", month: "short" }).format(new Date(iso)).replace(".", "");
}

/** "16:30" */
export function hora(iso: string): string {
  return fmt({ hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** { dia: "11", mes: "OUT", semana: "sáb" } — para o bloco de data dos jogos. */
export function peçasDeData(iso: string): { dia: string; mes: string; semana: string } {
  const d = new Date(iso);
  return {
    dia: fmt({ day: "2-digit" }).format(d),
    mes: fmt({ month: "short" }).format(d).replace(".", "").toUpperCase(),
    semana: fmt({ weekday: "short" }).format(d).replace(".", ""),
  };
}

/** "Há 3 horas", "Há 2 dias", e a partir de uma semana a data. */
export function haQuanto(iso: string, agora = Date.now()): string {
  const min = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60000));
  if (min < 60) return min <= 1 ? "Agora mesmo" : `Há ${min} minutos`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? "Há 1 hora" : `Há ${h} horas`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? "Há 1 dia" : `Há ${d} dias`;
  return dataCompleta(iso);
}

/** "14,99 €" */
export function euro(value: number): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(value);
}

/** A data só, para `<time dateTime>`: "2026-10-11". */
export function isoDia(iso: string): string {
  return iso.slice(0, 10);
}

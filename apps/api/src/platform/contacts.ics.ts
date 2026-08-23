/**
 * O feed de calendário dos seguimentos.
 *
 * ## Porque é que é um `.ics` e não a API do Google
 *
 * Porque o que se quer é que os seguimentos **apareçam** no calendário de quem
 * anda a falar com clubes — e para isso um feed subscrito chega. A alternativa
 * seria OAuth com o Google: um projecto na Google Cloud, um ecrã de consentimento
 * a rever, tokens de refresh guardados, e um escopo de escrita no calendário de
 * uma pessoa. Muita superfície para o que se ganha, e uma dependência de terceiros
 * no caminho crítico de uma lista que tem de abrir.
 *
 * O feed vive do outro lado: o Google vai lá buscá-lo sozinho, de tempos a tempos,
 * e uma data que mude aqui muda lá sem ninguém fazer nada. Quem quiser um evento
 * *já*, com convidados e notificação, tem o botão "Agendar no Google" na lista —
 * que abre o Google com o evento preenchido e deixa a decisão do lado de lá.
 *
 * ## O que o Google faz e não faz
 *
 * Actualiza quando lhe apetece — costuma ser de poucas em poucas horas, e o
 * `REFRESH-INTERVAL` abaixo é uma sugestão que ele pode ignorar. É por isso que o
 * feed é o pano de fundo e não a única forma de marcar: quem marca uma reunião
 * para amanhã de manhã usa o botão.
 */

type Feed = {
  id: string;
  name: string;
  club: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  nextActionAt: Date;
  nextActionNote: string | null;
};

/** O nome legível de cada estado. Igual ao da app — o feed é lido por humanos. */
const ESTADO: Record<string, string> = {
  NOVO: "Por contactar",
  CONTACTADO: "Contactado",
  SEM_RESPOSTA: "Sem resposta",
  REUNIAO: "Reunião marcada",
  PROPOSTA: "Proposta enviada",
  CLIENTE: "Cliente",
  PERDIDO: "Perdido",
};

/** Meia hora. Um seguimento é um telefonema, não uma tarde. */
const DURATION_MIN = 30;

export function renderIcs(contacts: Feed[], calendarName: string): string {
  // `string | null`: as linhas opcionais (DESCRIPTION, LOCATION) entram como
  // `null` quando não há o quê escrever, e são filtradas no fim. Sem esta
  // anotação o TypeScript inferia `string[]` do primeiro elemento e recusava-as.
  const lines: (string | null)[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Academias//Seguimentos//PT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(calendarName)}`,
    "X-WR-TIMEZONE:Europe/Lisbon",
    // Sugestão de frequência. O Google decide na mesma, mas outros clientes obedecem.
    "REFRESH-INTERVAL;VALUE=DURATION:PT2H",
    "X-PUBLISHED-TTL:PT2H",
  ];

  for (const c of contacts) {
    const start = c.nextActionAt;
    const end = new Date(start.getTime() + DURATION_MIN * 60_000);
    const where = c.club ? ` · ${c.club}` : "";

    const detalhe = [
      c.nextActionNote,
      c.phone ? `Telefone: ${c.phone}` : null,
      c.email ? `Email: ${c.email}` : null,
      `Estado: ${ESTADO[c.status] ?? c.status}`,
      // Quebras de linha a sério. É o `escape` abaixo que as converte para a
      // sequência do formato — escrevê-las já escapadas aqui fá-las-ia passar
      // duas vezes pelo escape e sair como um `\n` literal no calendário.
    ].filter(Boolean).join("\n");

    lines.push(
      "BEGIN:VEVENT",
      // O UID é o id do contacto: quando a data muda, o Google **move** o evento
      // em vez de criar um segundo. Um UID novo a cada geração encheria o
      // calendário de fantasmas de datas antigas.
      `UID:contacto-${c.id}@academias.pt`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${escape(`Seguimento: ${c.name}${where}`)}`,
      detalhe ? `DESCRIPTION:${escape(detalhe)}` : null,
      c.phone ? `LOCATION:${escape(c.phone)}` : null,
      "BEGIN:VALARM",
      "TRIGGER:-PT30M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escape(`Ligar a ${c.name}`)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");

  // CRLF é o que a norma diz, e há clientes que se recusam a ler sem ele.
  return lines.filter((l): l is string => l !== null).map(fold).join("\r\n") + "\r\n";
}

/** `20260821T143000Z`. Sempre em UTC — o `Z` evita a conversa toda dos fusos. */
function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Vírgulas, pontos e vírgulas e barras têm significado no formato. */
function escape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * Dobra linhas com mais de 75 octetos, como manda o RFC 5545.
 *
 * Sem isto, uma nota comprida rebenta com o ficheiro em alguns clientes — e a nota
 * comprida é exactamente a que vale a pena ler antes de ligar.
 */
function fold(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;

  const out: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > 73) {
      out.push(current);
      current = " " + char;
    } else {
      current += char;
    }
  }
  out.push(current);
  return out.join("\r\n");
}

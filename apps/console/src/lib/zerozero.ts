import { useSyncExternalStore } from "react";
import { getEvent, upsertEvent, type CalendarEvent } from "@/lib/calendar";
import { teamById, today } from "@/lib/api";

/**
 * Importação de jogos a partir de um link do ZeroZero.
 *
 * ## O que investigámos antes de escrever isto
 *
 * O `robots.txt` do zerozero.pt só bloqueia um endpoint (`/zzmap_v3.php`) — não
 * impede tecnicamente aceder às páginas de equipa. Mas não há API pública, os
 * dados vêm em HTML simples (frágil a qualquer redesign do site) e o modelo de
 * negócio é publicidade — o que normalmente vem de mãos dadas com termos que
 * proíbem reutilização comercial, mesmo sem termos conseguido confirmar o texto
 * exacto. Montar um raspador contínuo contra o site deles, dentro de um produto
 * pago, é uma decisão de risco legal e não só técnica.
 *
 * ## O que este ficheiro é, e o que não é
 *
 * `fetchFixtures` é uma **simulação**, claramente marcada como tal na UI que a usa.
 * Devolve dados de demonstração, gerados de forma determinística a partir do URL
 * (o mesmo link dá sempre os mesmos jogos, para a reimportação se comportar como
 * uma fonte real se comportaria). Serve para validar o produto — colar o link, ver
 * os jogos a aparecer no calendário, o treinador só mexer na convocatória — antes
 * de se decidir a fonte de dados a sério: uma API oficial, um acordo de
 * licenciamento, ou scraping no servidor com as devidas cautelas.
 *
 * Trocar a simulação por uma fonte real é reescrever `fetchFixtures`. Nada no
 * calendário, no diretor ou no treinador sabe que os dados vieram daqui — falam
 * sempre com `CalendarEvent` e `MatchInfo`, como qualquer outro jogo.
 */

export type ImportedFixture = {
  opponent: string;
  home: boolean;
  date: Date;
  venue: string;
  result?: { ourScore: number; theirScore: number };
};

const URL_PATTERN = /^https?:\/\/(www\.)?zerozero\.pt\/equipa\/[a-z0-9-]+\/\d+/i;

export function isValidZeroZeroUrl(url: string): boolean {
  return URL_PATTERN.test(url.trim());
}

/* -------------------------------------------------------------------------- */
/* Ligações por escalão                                                        */
/* -------------------------------------------------------------------------- */

export type TeamLink = {
  teamId: string;
  url: string;
  linkedAt: Date;
  lastImportedAt?: Date;
  lastImportedCount?: number;
};

let links: Record<string, TeamLink> = {};
const listeners = new Set<() => void>();

function emit() {
  links = { ...links };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => links;

export function useZeroZeroLinks(): Record<string, TeamLink> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function linkTeam(teamId: string, url: string) {
  links = { ...links, [teamId]: { teamId, url: url.trim(), linkedAt: new Date() } };
  emit();
}

export function unlinkTeam(teamId: string) {
  const rest = { ...links };
  delete rest[teamId];
  links = rest;
  emit();
}

/* -------------------------------------------------------------------------- */
/* Importar                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Vai buscar os jogos e escreve-os no calendário.
 *
 * Idempotente: cada jogo recebe um id estável (equipa + data), por isso reimportar
 * actualiza em vez de duplicar. E nunca toca na convocatória de um jogo que já a
 * tinha — é essa a fronteira que o pedido original desenhou: os resultados e o
 * calendário vêm de fora, quem joga continua a ser o treinador a decidir.
 */
export async function importAndSync(teamId: string): Promise<{ imported: number }> {
  const link = links[teamId];
  if (!link) throw new Error("Esta equipa ainda não está ligada a um link do ZeroZero");

  const fixtures = await fetchFixtures(link.url, teamId);
  const team = teamById(teamId);

  for (const fx of fixtures) {
    const id = fixtureId(teamId, fx.date);
    const existing = getEvent(id);

    const event: CalendarEvent = {
      id,
      kind: "match",
      teamId,
      title: `Jogo · ${team?.name ?? ""}`,
      start: fx.date,
      end: new Date(fx.date.getTime() + 90 * 60_000),
      venue: fx.venue,
      coachId: existing?.coachId ?? team?.coachIds[0],
      cancelled: existing?.cancelled,
      match: {
        opponent: fx.opponent,
        home: fx.home,
        callUps: existing?.match?.callUps ?? [],
        result: fx.result ? { ...fx.result, scorers: existing?.match?.result?.scorers ?? [] } : undefined,
        source: { provider: "zerozero", url: link.url, importedAt: new Date() },
      },
    };

    upsertEvent(event);
  }

  links = { ...links, [teamId]: { ...link, lastImportedAt: new Date(), lastImportedCount: fixtures.length } };
  emit();

  return { imported: fixtures.length };
}

function fixtureId(teamId: string, date: Date): string {
  return `zz_${teamId}_${date.getFullYear()}${date.getMonth()}${date.getDate()}`;
}

/* -------------------------------------------------------------------------- */
/* SIMULAÇÃO — ver o comentário do topo do ficheiro                            */
/* -------------------------------------------------------------------------- */

const OPPONENTS = [
  "SC Vilarinho", "Clube Desportivo de Fão", "Basket Clube Amares", "GD Ronfe",
  "SC Bairro", "AD Oliveirense", "Vitória de Prado", "SC São Pedro",
  "CD Ferreiros", "GC Vermoim", "SC Cerveira", "AD Merelim",
];

async function fetchFixtures(url: string, teamId: string): Promise<ImportedFixture[]> {
  const rng = rngFromSeed(`${url}:${teamId}`);
  await delay(600 + rng() * 500); // simula a latência de um pedido de rede real

  const opponents = shuffle(OPPONENTS, rng);
  const fixtures: ImportedFixture[] = [];

  // Três jogos já disputados, três por disputar — semanalmente, ao sábado, como
  // é hábito nos escalões de formação.
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    const date = nextSaturdayOffset(i);
    const home = rng() > 0.5;
    const opponent = opponents[(i + 3) % opponents.length];

    fixtures.push({
      opponent,
      home,
      date,
      venue: home ? "Campo próprio" : `Campo do ${opponent}`,
      result: date < today ? { ourScore: Math.floor(rng() * 4), theirScore: Math.floor(rng() * 4) } : undefined,
    });
  }

  return fixtures.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function nextSaturdayOffset(weeks: number): Date {
  const base = new Date(today);
  const toSaturday = (6 - base.getDay() + 7) % 7;
  base.setDate(base.getDate() + toSaturday + weeks * 7);
  base.setHours(11, 0, 0, 0);
  return base;
}

function shuffle<T>(xs: T[], rng: () => number): T[] {
  const ys = [...xs];
  for (let i = ys.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ys[i], ys[j]] = [ys[j], ys[i]];
  }
  return ys;
}

function rngFromSeed(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  return mulberry32(h);
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

import type { ScopedClient } from "../prisma/prisma.service";
import { aberturaAnual, aberturaDoSocio, periodoDaQuota } from "../members/member-fees.service";
import { recintosValidos, tiposValidos, type Recinto } from "../site/site.tipos";
import { estadoDaVenda, lugaresLivres, quotaCobre, type EstadoDaVenda, type TipoParaVenda } from "./regras";

/**
 * As perguntas à base que a compra, o webhook e o leitor fazem todos: o jogo
 * com a venda, os lugares ocupados, os lugares anuais, e se a quota de um
 * sócio cobre o dia do jogo. Recebem o `db` de quem chama, para correrem
 * dentro da mesma transação que vai escrever (e, na compra e no webhook, com
 * o jogo bloqueado: ver `bloquearJogo`).
 */

export type ContextoDoJogo = {
  jogo: { id: string; startsAt: Date; endsAt: Date; status: string; isHome: boolean; opponent: string; teamName: string; seasonId: string | null };
  venda: {
    open: boolean;
    venueId: string | null;
    capacity: number | null;
    note: string;
    membersFrom: Date | null;
    publicFrom: Date | null;
    membersOnly: boolean;
    closesAt: Date | null;
  };
  recinto: Recinto | null;
  tipos: TipoParaVenda[];
  estado: EstadoDaVenda;
  /** Por bancada do recinto (e por bancada citada num tipo): os lugares que ainda se vendem. Nulo = sem limite próprio. */
  livres: Record<string, number | null>;
  /** O total que o jogo ainda leva. Nulo = sem limite. */
  livresNoJogo: number | null;
  /** Lugares anuais por bancada, e vendidos ou guardados por bancada. */
  anuais: Record<string, number>;
  ocupados: Record<string, number>;
};

/**
 * Bloqueia a venda deste jogo até ao fim da transação.
 *
 * Duas compras ao mesmo tempo liam "há 2 lugares" antes de a primeira gravar
 * e vendiam 4. Com a linha da venda bloqueada, a segunda espera pela
 * primeira e conta os lugares já com os dela. Um jogo bloqueia-se a si, e só
 * durante a reserva (milissegundos): o pedido à euPago acontece depois.
 */
export async function bloquearJogo(db: ScopedClient, matchId: string): Promise<void> {
  await db.$queryRaw`SELECT 1 FROM "SiteMatchTickets" WHERE "matchId" = ${matchId} FOR UPDATE`;
}

/** Os bilhetes que ocupam lugar: os de compras pagas, e os de compras guardadas que ainda não expiraram. */
export async function ocupadosPorBancada(db: ScopedClient, matchId: string, agora: Date, semCompra?: string): Promise<Record<string, number>> {
  const rows = await db.$queryRaw<{ bancadaId: string; n: number }[]>`
    SELECT t."bancadaId" AS "bancadaId", count(*)::int AS n
      FROM "MatchTicket" t
      JOIN "TicketOrder" o ON o.id = t."orderId"
     WHERE t."matchId" = ${matchId}
       AND t.status <> 'VOID'
       AND (o.status = 'PAID' OR (o.status = 'RESERVED' AND o."reservedUntil" > ${agora}))
       AND o.id <> ${semCompra ?? ""}
     GROUP BY t."bancadaId"
  `;
  return Object.fromEntries(rows.map((r) => [r.bancadaId, Number(r.n)]));
}

/** Os lugares anuais da época e do recinto do jogo, por bancada. */
export async function anuaisPorBancada(db: ScopedClient, seasonId: string | null, venueId: string | null): Promise<Record<string, number>> {
  if (!seasonId || !venueId) return {};
  const rows = await db.seasonSeat.groupBy({ by: ["bancadaId"], where: { seasonId, venueId }, _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.bancadaId, r._count._all]));
}

/**
 * O jogo, a venda e os lugares. Nulo quando o jogo não existe ou não tem
 * bilheteira configurada. Vale em casa e fora: num jogo fora, o clube vende
 * os bilhetes que tem para os seus adeptos, no recinto que desenhou para isso.
 */
export async function contextoDoJogo(db: ScopedClient, academyId: string, matchId: string, agora = new Date(), semCompra?: string): Promise<ContextoDoJogo | null> {
  const [m, venda, config] = await Promise.all([
    db.match.findFirst({
      where: { id: matchId },
      select: { id: true, startsAt: true, endsAt: true, status: true, isHome: true, opponent: true, team: { select: { name: true, seasonId: true } } },
    }),
    db.siteMatchTickets.findUnique({ where: { matchId } }),
    db.siteConfig.findUnique({ where: { academyId }, select: { venues: true } }),
  ]);
  if (!m || !venda) return null;

  const recinto = recintosValidos(config?.venues).find((r) => r.id === venda.venueId) ?? null;
  const tipos = tiposValidos(venda.types);
  const jogo = { id: m.id, startsAt: m.startsAt, endsAt: m.endsAt, status: m.status, isHome: m.isHome, opponent: m.opponent, teamName: m.team.name, seasonId: m.team.seasonId };
  const [ocupados, anuais] = await Promise.all([ocupadosPorBancada(db, matchId, agora, semCompra), anuaisPorBancada(db, jogo.seasonId, venda.venueId)]);

  const bancadas = new Set<string>([...(recinto?.bancadas.map((b) => b.id) ?? []), ...tipos.flatMap((t) => (t.bancadaId ? [t.bancadaId] : []))]);
  const livres: Record<string, number | null> = {};
  for (const id of bancadas) {
    const lotacao = recinto?.bancadas.find((b) => b.id === id)?.lotacao ?? null;
    livres[id] = lugaresLivres(lotacao, anuais[id] ?? 0, ocupados[id] ?? 0);
  }
  const soma = (o: Record<string, number>) => Object.values(o).reduce((n, v) => n + v, 0);
  const livresNoJogo = venda.capacity ? Math.max(0, venda.capacity - soma(anuais) - soma(ocupados)) : null;

  const v = {
    open: venda.open,
    venueId: venda.venueId,
    capacity: venda.capacity,
    note: venda.note,
    membersFrom: venda.membersFrom,
    publicFrom: venda.publicFrom,
    membersOnly: venda.membersOnly,
    closesAt: venda.closesAt,
  };
  return { jogo, venda: v, recinto, tipos, estado: estadoDaVenda(v, jogo, agora), livres, livresNoJogo, anuais, ocupados };
}

/**
 * A quota deste sócio cobre o dia `dia`? Ver `quotaCobre` para a regra. Um
 * sócio que não esteja ativo (pendente, suspenso, cancelado) nunca está em dia.
 */
export async function quotaDoSocioCobre(db: ScopedClient, academyId: string, memberId: string, dia: Date): Promise<boolean> {
  const socio = await db.member.findFirst({
    where: { id: memberId },
    select: { status: true, annualStartDay: true, annualStartMonth: true, tier: { select: { billing: true, feeCents: true, archivedAt: true } } },
  });
  if (!socio || socio.status !== "ACTIVE") return false;
  const tier = socio.tier && !socio.tier.archivedAt ? socio.tier : null;
  const billing = tier?.billing === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  const { mes, dia: diaDeAbertura } = aberturaDoSocio(socio, await aberturaAnual(db, academyId));
  const periodoDoJogo = periodoDaQuota(billing, dia, mes, diaDeAbertura);
  const [quotas, dispensas] = await Promise.all([
    db.memberFee.findMany({ where: { memberId }, select: { period: true, status: true, coversFrom: true, coversTo: true } }),
    db.memberFeeSkip.findMany({ where: { memberId }, select: { period: true } }),
  ]);
  return quotaCobre({
    quotas,
    dispensados: dispensas.map((d) => d.period),
    periodoDoJogo,
    dia,
    semQuota: tier?.feeCents === 0,
  });
}

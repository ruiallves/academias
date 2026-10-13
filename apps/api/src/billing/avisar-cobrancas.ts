import { NotificationType } from "@prisma/client";
import type { ScopedClient } from "../prisma/prisma.service";
import type { NotificationsService } from "../notifications/notifications.service";

/**
 * Avisar um encarregado acabado de ligar das cobranças em aberto do atleta.
 *
 * ## Porque é que existe
 *
 * Uma cobrança avisa os encarregados que o atleta tem **naquele momento**
 * (\`createExtraCharge\`). Um atleta sem encarregado, ou com um que só se liga
 * depois, ficava com a cobrança nos Pagamentos sem ninguém ter sido avisado.
 * O caso que o pediu: o equipamento entregue "por pagar, na app" a um atleta
 * cujo encarregado ainda não tinha a app (Rui, 13/10/2026). Quando ele entra,
 * tem de receber o pedido como se já lá estivesse.
 *
 * ## O que avisa
 *
 * As cobranças em aberto do atleta dos últimos 90 dias (até 10): o que ainda
 * se está a pedir. As mais antigas são dívida velha, e despejar avisos de há
 * meses numa conta acabada de criar é o contrário de uma boa entrada.
 *
 * Nunca o mesmo aviso duas vezes à mesma pessoa: quem já tem a notificação de
 * uma cobrança (pelo \`chargeId\` no payload) não a recebe outra vez. Por isso
 * pode chamar-se em qualquer ligação, nova ou repetida.
 *
 * Corre dentro da transação de quem liga: a notificação nasce com a ligação, e
 * o push sai depois do commit (\`enqueue\` com \`db\`).
 */
export async function avisarCobrancasEmAberto(
  db: ScopedClient,
  notifications: NotificationsService,
  academyId: string,
  membershipId: string,
  athleteId: string,
): Promise<number> {
  /*
   * Só encarregados activos. Uma família registada pelo link fica à espera do
   * clube, e um aviso agora chegava antes de poder entrar na app: é a
   * aprovação (`approve`) que volta a chamar isto.
   */
  const vinculo = await db.membership.findFirst({ where: { id: membershipId }, select: { userId: true, isActive: true } });
  if (!vinculo?.isActive) return 0;

  const desde = new Date(Date.now() - 90 * 86_400_000);
  const cobrancas = await db.charge.findMany({
    where: { athleteId, status: "OPEN", dueDate: { gte: desde } },
    orderBy: { dueDate: "desc" },
    take: 10,
    select: {
      id: true, kind: true, title: true, period: true, amountCents: true, dueDate: true,
      athlete: { select: { name: true } },
    },
  });
  if (cobrancas.length === 0) return 0;

  const jaAvisadas = new Set(
    (
      await db.notification.findMany({
        where: { userId: vinculo.userId, type: NotificationType.PAYMENT_DUE },
        select: { payload: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
    )
      .map((n) => (n.payload as { chargeId?: string } | null)?.chargeId)
      .filter(Boolean),
  );

  let n = 0;
  for (const c of cobrancas) {
    if (jaAvisadas.has(c.id)) continue;
    const titulo = c.kind === "EXTRA" && c.title ? c.title : `Mensalidade ${c.period}`;
    const ate = c.dueDate ? c.dueDate.toLocaleDateString("pt-PT", { day: "numeric", month: "long", timeZone: "UTC" }) : null;
    await notifications.enqueue(
      {
        academyId,
        userId: vinculo.userId,
        type: NotificationType.PAYMENT_DUE,
        title: titulo,
        body: `${c.athlete.name} · ${(c.amountCents / 100).toFixed(2)} €${ate ? ` até ${ate}` : ""}.`,
        payload: { route: "/pagamentos", chargeId: c.id },
      },
      db,
    );
    n++;
  }
  return n;
}

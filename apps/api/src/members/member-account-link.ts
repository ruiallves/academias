import type { ScopedClient } from "../prisma/prisma.service";

/**
 * A ficha de sócio e a conta na app: ligam-se **pelo email, sozinhas**.
 *
 * ## O problema que isto resolve
 *
 * Um treinador — ou o pai de um atleta — já tem conta na app do clube. Um dia
 * a direcção inscreve-o como sócio, com o mesmo email. O convite para "criar
 * conta" não lhe serve: a conta existe, e o email já está ocupado. Havia um
 * botão na consola para uma pessoa da direcção ligar as duas coisas à mão —
 * um gesto que ninguém sabia que tinha de fazer, e que o sócio não podia fazer
 * por si.
 *
 * Agora não há gesto: a ficha com o email de uma conta **deste clube** liga-se
 * a essa conta na primeira ocasião — quando a ficha nasce ou muda de email
 * (consola), ou quando a pessoa abre a app (`contexts`). O sócio abre a app e
 * a área de sócio está lá.
 *
 * ## "Deste clube", e não "uma conta qualquer"
 *
 * A conta tem de ter vínculo nesta academia — família ou staff. É o que a
 * política de `User` deixa ver de dentro do tenant (`same_academy_users`), e é
 * também a garantia que interessa: a ficha de um sócio não se cola a uma conta
 * de outro clube só porque o email coincide. Quem não tem vínculo aqui entra
 * pelo convite, que cria a conta (ou entra na que existe) com o email da ficha.
 *
 * ## A confiança é a do email na ficha
 *
 * Quem escreveu o email na ficha foi o clube; quem tem a conta com esse email
 * já provou pertencer ao clube (convite de família, cargo). É exactamente a
 * confiança que o botão manual já tinha — só que sem o botão. Uma ficha com o
 * email errado liga-se à pessoa errada, e a correcção é a mesma de sempre:
 * corrigir o email e desligar a conta na ficha.
 */

type Ficha = { id: string; email: string | null; userId: string | null };

/**
 * Ligar uma ficha à conta com o mesmo email, se ela existir e estiver livre.
 *
 * Devolve a conta ligada, ou `null` quando não há nada a fazer: ficha já
 * ligada, sem email, conta inexistente (neste clube), ou conta já com outra
 * ficha — uma conta tem **uma** ficha por clube (`Member(academyId, userId)`).
 * Nunca rebenta: chama-se de dentro de escritas que não podem falhar por causa
 * disto.
 */
export async function ligarFichaAConta(
  db: ScopedClient,
  ficha: Ficha,
): Promise<{ userId: string; name: string; email: string } | null> {
  if (ficha.userId || !ficha.email) return null;

  const user = await db.user.findFirst({
    where: { email: ficha.email.trim().toLowerCase() },
    select: { id: true, name: true, email: true },
  });
  if (!user) return null;

  const outra = await db.member.findFirst({ where: { userId: user.id }, select: { id: true } });
  if (outra) return null;

  await db.member.update({
    where: { id: ficha.id },
    /* O convite pendente perde o sentido — a ficha já tem dono. */
    data: { userId: user.id, inviteTokenHash: null },
  });
  return { userId: user.id, name: user.name, email: user.email };
}

/**
 * O lado da app: esta conta tem uma ficha por reclamar neste clube?
 *
 * Procura-se a ficha **sem dono** com o email da conta e liga-se. Quem chama
 * já verificou que a conta não tem ficha ligada — e que tem vínculo aqui, que
 * é o que faz a leitura de `User` funcionar de dentro do tenant.
 */
export async function reclamarFichaPelaConta(db: ScopedClient, userId: string): Promise<boolean> {
  const user = await db.user.findFirst({ where: { id: userId }, select: { email: true } });
  if (!user?.email) return false;

  const ficha = await db.member.findFirst({
    where: { userId: null, email: { equals: user.email.trim().toLowerCase(), mode: "insensitive" } },
    /* Se houver duas fichas sem dono com o mesmo email — pode acontecer numa
       importação repetida — fica com a mais antiga: é a que tem histórico. */
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, userId: true },
  });
  if (!ficha) return false;

  return (await ligarFichaAConta(db, ficha)) !== null;
}

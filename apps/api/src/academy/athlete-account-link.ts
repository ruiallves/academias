import type { ScopedClient } from "../prisma/prisma.service";

/**
 * A ficha de atleta e a conta que já existe: ligam-se **sozinhas**.
 *
 * ## O problema que isto resolve
 *
 * Uma pessoa é treinadora do clube, encarregada de um filho, e joga nos
 * seniores. Abre a app e vê duas áreas: Equipa técnica e Família. A de atleta
 * não está lá, porque a conta de atleta nascia **só** do convite — e o convite
 * que o clube lhe mandou pedia-lhe uma palavra-passe para um email que já tem
 * conta, ou seja, pedia-lhe a palavra-passe que ela já usa, num ecrã que diz
 * "escolhe". Funciona, e ninguém percebe que funciona.
 *
 * A regra passou a ser a dos sócios: **a conta é da pessoa, os perfis são
 * papéis**. Quem já entrou uma vez na app deste clube não recebe convites para
 * os perfis seguintes — eles aparecem.
 *
 * ## "Já existe" quer dizer: com vínculo neste clube
 *
 * E isso não é uma verificação escrita aqui, é a RLS. A política de `User` é
 * "vejo-te se partilharmos academia" (`same_academy_users`), por isso um
 * `findFirst` por email de dentro do tenant só encontra contas com
 * `Membership` aqui — família ou pessoal. Uma conta de outro clube com o mesmo
 * email não aparece, e é assim que a ficha de um atleta não se cola a um
 * estranho. (Uma conta só de sócio também não aparece, porque um sócio não tem
 * `Membership` — ver a nota em `club-app.service.ts`.)
 *
 * ## As duas guardas, e porque são estas
 *
 * Nos sócios o email chega. Aqui não chegava, e a razão está escrita no modelo:
 * `Athlete.email` é o email **do atleta**, e o formulário diz isso em voz alta
 * ("o dele, não o do encarregado"). Mas há clubes que escrevem lá o email do
 * pai, e ligar por email nu dava ao pai uma área "Atleta" com a ficha do filho
 * — com a ficha clínica e as avaliações dentro, que é o que o papel `ATHLETE`
 * deixa ler. Por isso:
 *
 * 1. **A conta não pode ser encarregada deste atleta.** Um `GuardianLink` entre
 *    as duas pontas diz, em dados e não por adivinhação, que aquele email é o do
 *    encarregado. É o caso comum do engano, e fica de fora. Quem é encarregado
 *    de *outro* atleta passa — é a pessoa do exemplo lá em cima.
 * 2. **A conta não pode já ter ficha de atleta neste clube.** Uma conta, um
 *    atleta (`Athlete.accountMembershipId` é único). Sem esta guarda, um pai com
 *    três filhos todos com o email dele fazia a segunda ligação rebentar, dentro
 *    de um gancho que não pode falhar.
 *
 * 3. **O clube não pode ter desligado esta conta.** "Desligar conta" existe para
 *    quando a ficha se ligou à pessoa errada, e desactiva a `Membership` de
 *    atleta em vez de a apagar. Sem esta guarda, o desligar durava até a pessoa
 *    voltar a abrir a app: uma membership de atleta inactiva nesta academia é o
 *    clube a dizer que esta conta não é atleta, e respeita-se. O caminho de volta
 *    é o convite, que é o que o próprio `desligarConta` já promete.
 *
 * O que sobra é o convite, que continua a ser o caminho de quem ainda não tem
 * conta, e continua a ser o gesto explícito para os casos que estas guardas
 * travam de propósito.
 */

type Ficha = { id: string; email: string | null; accountMembershipId: string | null };

/**
 * Os factos que decidem uma ligação. Todos booleanos, todos vindos da base.
 *
 * Existe para a decisão poder ser **provada sem base de dados nenhuma**: as
 * guardas são cinco, uma delas protege a ficha clínica de um menor, e uma
 * regra assim não pode viver só como cinco `if` no meio de cinco `await`, onde
 * a única forma de a testar é montar um clube inteiro. Ver
 * `scripts/test-ligacao-atleta.mjs`.
 */
export type FactosDaLigacao = {
  /** A ficha já tem conta ligada. */
  jaTemConta: boolean;
  /** A ficha tem email escrito. */
  temEmail: boolean;
  /**
   * Existe conta com esse email **visível de dentro deste clube**.
   *
   * Quem gera este facto não precisa de verificar o vínculo: a RLS de `User` já
   * o faz (`same_academy_users`). Uma conta de outro clube com o mesmo email
   * chega aqui como `false`.
   */
  contaExiste: boolean;
  /** Essa conta é encarregada **deste** atleta. */
  encarregadoDesteAtleta: boolean;
  /** Essa conta já é dona de outra ficha de atleta neste clube. */
  jaEDonoDeOutraFicha: boolean;
  /** O clube desligou esta conta da área de atleta (membership inactiva). */
  desligadaPeloClube: boolean;
};

/**
 * Porque é que esta ficha **não** se liga a esta conta — ou `null` se se liga.
 *
 * Devolve a razão e não um booleano porque cada uma delas é uma decisão
 * diferente com um caminho de volta diferente, e quem for a ler um log daqui a
 * um ano precisa de saber qual foi. A ordem é a da certeza: primeiro o que não
 * é sequer uma ligação possível, depois as guardas.
 */
export function razaoParaNaoLigar(f: FactosDaLigacao): string | null {
  if (f.jaTemConta) return "a ficha já tem conta ligada";
  if (!f.temEmail) return "a ficha não tem email";
  if (!f.contaExiste) return "não há conta com este email neste clube";
  if (f.encarregadoDesteAtleta) return "este email é do encarregado deste atleta";
  if (f.jaEDonoDeOutraFicha) return "esta conta já é de outro atleta";
  if (f.desligadaPeloClube) return "o clube desligou esta conta da área de atleta";
  return null;
}

/**
 * Qual das fichas sem dono com este email é desta pessoa.
 *
 * **Nenhuma, quando há mais do que uma.** Duas fichas sem dono com o mesmo
 * email é a assinatura do engano: são irmãos com o email do pai. Escolher uma
 * seria escolher um filho, e por isso não se escolhe — fica o convite, que
 * obriga alguem a dizer qual.
 */
export function fichaUnicaComEsteEmail<T>(fichas: readonly T[]): T | null {
  return fichas.length === 1 ? fichas[0] : null;
}

/**
 * As guardas que dependem da conta, lidas da base de uma vez.
 *
 * Separado de quem decide para os dois caminhos — a ficha que procura conta, e
 * a conta que procura ficha — partilharem as mesmas três consultas em vez de as
 * escreverem cada um à sua maneira.
 */
async function factosDaConta(
  db: ScopedClient,
  academyId: string,
  userId: string,
  athleteId: string,
): Promise<Pick<FactosDaLigacao, "encarregadoDesteAtleta" | "jaEDonoDeOutraFicha" | "desligadaPeloClube">> {
  const [encarregado, outra, desligada] = await Promise.all([
    db.guardianLink.findFirst({ where: { athleteId, membership: { userId } }, select: { id: true } }),
    db.athlete.findFirst({ where: { account: { userId } }, select: { id: true } }),
    db.membership.findFirst({
      where: { academyId, userId, role: "ATHLETE", isActive: false },
      select: { id: true },
    }),
  ]);
  return {
    encarregadoDesteAtleta: encarregado !== null,
    jaEDonoDeOutraFicha: outra !== null,
    desligadaPeloClube: desligada !== null,
  };
}

/** A escrita, igual nos dois caminhos: a membership de atleta e a ficha a apontá-la. */
async function escrever(db: ScopedClient, academyId: string, userId: string, athleteId: string): Promise<string> {
  const membership = await db.membership.upsert({
    where: { academyId_userId_role: { academyId, userId, role: "ATHLETE" } },
    /* O `update` só pega numa membership viva — a guarda das desligadas já as
       afastou. Fica por ser o que um upsert exige. */
    update: { isActive: true },
    create: { academyId, userId, role: "ATHLETE" },
    select: { id: true },
  });

  await db.athlete.update({
    where: { id: athleteId },
    /* O convite pendente perde o sentido — a ficha já tem dono. */
    data: { accountMembershipId: membership.id, inviteTokenHash: null },
  });
  return membership.id;
}

/**
 * Ligar uma ficha de atleta à conta com o mesmo email, se houver uma livre.
 *
 * O caminho da consola: nasce uma ficha (ou carrega-se em "Enviar convite") e
 * procura-se conta para ela. Aqui o vínculo ao clube não se verifica à mão — a
 * RLS de `User` é que o faz, e uma conta de outro clube simplesmente não
 * aparece.
 *
 * Devolve a conta ligada, ou `null` quando não há nada a fazer. Nunca rebenta:
 * chama-se de dentro de escritas que não podem falhar por causa disto.
 */
export async function ligarAtletaAConta(
  db: ScopedClient,
  academyId: string,
  ficha: Ficha,
): Promise<{ userId: string; membershipId: string; name: string; email: string } | null> {
  const email = ficha.email?.trim().toLowerCase() || null;

  /* Sem email, ou já com dono, não se vai à base procurar ninguém. */
  const user =
    ficha.accountMembershipId || !email
      ? null
      : await db.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
          select: { id: true, name: true, email: true },
        });

  const razao = razaoParaNaoLigar({
    jaTemConta: Boolean(ficha.accountMembershipId),
    temEmail: Boolean(email),
    contaExiste: user !== null,
    ...(user
      ? await factosDaConta(db, academyId, user.id, ficha.id)
      : { encarregadoDesteAtleta: false, jaEDonoDeOutraFicha: false, desligadaPeloClube: false }),
  });
  if (razao || !user) return null;

  const membershipId = await escrever(db, academyId, user.id, ficha.id);
  return { userId: user.id, membershipId, name: user.name, email: user.email };
}

/**
 * O lado da app: esta conta tem uma ficha de atleta por reclamar neste clube?
 *
 * É o gémeo de `reclamarFichaPelaConta` dos sócios, e é este que resolve o caso
 * que deu origem a tudo: a ficha já existe, o convite já saiu há dias, e ninguém
 * vai voltar a criar a ficha para o gancho da criação disparar. A pessoa abre a
 * app e a área está lá.
 *
 * O email vem de quem chama — do token, que é onde a Supabase o assina — e não
 * de uma leitura de `User`. É de propósito: a RLS de `User` exige `Membership`,
 * e um sócio do clube que jogue nos seniores não tem nenhuma até esta ligação
 * acontecer. A ler `User` daqui, era o único perfil que nunca se ligava.
 *
 * Os termos **não** se aceitam por aqui. O atleta entra pelo guard como a
 * família, e é lá que o gate legal aparece a quem ainda não aceitou os
 * documentos — ligar a ficha não é consentir nada.
 */
export async function reclamarAtletaPelaConta(
  db: ScopedClient,
  academyId: string,
  conta: { userId: string; email: string | null | undefined },
): Promise<boolean> {
  const email = conta.email?.trim().toLowerCase();
  if (!email) return false;

  const fichas = await db.athlete.findMany({
    where: { accountMembershipId: null, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });

  const ficha = fichaUnicaComEsteEmail(fichas);
  if (!ficha) return false;

  const razao = razaoParaNaoLigar({
    jaTemConta: false,
    temEmail: true,
    /* A conta está na mão de quem chama: autenticou-se e já tem vínculo aqui. */
    contaExiste: true,
    ...(await factosDaConta(db, academyId, conta.userId, ficha.id)),
  });
  if (razao) return false;

  await escrever(db, academyId, conta.userId, ficha.id);
  return true;
}

import { BadRequestException } from "@nestjs/common";
import type { ScopedClient } from "../prisma/prisma.service";
import { sobraQuemMexeEmCargos, type PessoaComCargos } from "../common/permissions";

/**
 * Apagar cargos sem trancar ninguém fora do clube.
 *
 * ## Quem fica sem cargo não fica sem acesso
 *
 * É a primeira coisa a dizer, porque é contra-intuitiva. Uma pessoa sem cargo
 * principal cai nos **valores por omissão do papel-base** — é o que
 * `exceptionsFor` faz quando devolve `rolePermissions: null`, e está lá
 * escrito: uma lista vazia trancaria a pessoa fora do produto sem ninguém
 * perceber porquê. Um presidente sem cargo continua a poder tudo, porque é
 * isso que `OWNER` quer dizer.
 *
 * Por isso apagar um cargo com gente lá dentro é seguro para essa gente.
 *
 * ## O caso em que não é
 *
 * `role:write` — criar e apagar cargos — só vem por omissão a quem é `OWNER`.
 * Num clube onde quem administra é um `DIRECTOR` a vestir um cargo à medida
 * que lhe dá `role:write`, apagar esse cargo tira a última pessoa capaz de
 * criar outro. Ninguém perde o clube, mas ninguém lá dentro volta a mexer em
 * cargos: a porta fecha-se por dentro, e a chave ficou do lado de fora.
 *
 * Não é hipotético — é exactamente o que acontece a quem carrega em "Apagar"
 * na lista toda de uma vez, que é o gesto que isto existe para permitir.
 *
 * Então a regra é uma só, e é a mais pequena que resolve: **tem de sobrar
 * alguém com `role:write`**. Tudo o resto apaga-se.
 */

/**
 * Recusa se, depois disto, ninguém no clube conseguir mexer em cargos.
 *
 * Conta **toda a gente activa**, incluindo quem está a apagar: a pergunta é se
 * o clube fica capaz, não se aquela pessoa fica satisfeita.
 */
export async function assertNaoTrancaOClube(db: ScopedClient, apagar: string[]): Promise<void> {
  if (apagar.length === 0) return;

  const pessoas = (await db.membership.findMany({
    where: { isActive: true, role: { notIn: ["GUARDIAN", "ATHLETE"] } },
    select: {
      role: true,
      grants: true,
      revokes: true,
      customRoleId: true,
      customRole: { select: { permissions: true, archivedAt: true } },
      extraRoles: { select: { roleId: true, role: { select: { permissions: true, archivedAt: true } } } },
    },
  })) as unknown as PessoaComCargos[];

  if (sobraQuemMexeEmCargos(pessoas, apagar)) return;

  throw new BadRequestException(
    "Não dá: depois disto não sobrava ninguém no clube a poder criar cargos, e não haveria como voltar atrás. " +
      "Dá o cargo de presidente a alguém, ou deixa ficar um cargo com acesso a cargos.",
  );
}

/**
 * Apaga os cargos e deixa sem cargo quem os vestia.
 *
 * ## Arquiva, e não apaga a linha
 *
 * Apagar a linha parecia mais limpo — `Membership.customRoleId` é `SetNull` e
 * `MembershipRole` é `Cascade`, a base fazia o trabalho toda sozinha. Mas
 * `semearCargosEmFalta` corre **a cada leitura** de cargos e departamentos, e
 * dá um primeiro cargo a todo o departamento que não tenha nenhum. Apagar a
 * linha do último cargo de um departamento era vê-lo voltar a nascer no F5
 * seguinte, com outro nome. A condição de lá é `roles: { none: {} }`,
 * arquivados incluídos, e é deliberada: um cargo arquivado é alguém a dizer
 * "este já não se usa", e ressuscitá-lo seria o produto a discutir com quem o
 * arrumou.
 *
 * Então arquiva-se — que é o que faz o cargo desaparecer de todas as listas — e
 * limpa-se à mão o que a cascata faria: quem o vestia fica sem ele.
 *
 * @returns quantas pessoas ficaram sem cargo principal.
 */
export async function apagarCargos(db: ScopedClient, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  /*
   * O nome do cargo também está copiado em `Membership.title`.
   *
   * O convite escreve-o lá (`title: cargo.name`, em `invites.service`), e
   * `cargoDe` lê o título quando não há cargo. Sem isto, apagar "Treinador
   * principal" deixava a lista de staff a dizer "Treinador principal" na mesma —
   * o clube carregava em Apagar e nada mudava no ecrã onde ia confirmar.
   *
   * Limpa-se **só a cópia**: um título escrito à mão que diga outra coisa é uma
   * decisão de alguém sobre aquela pessoa, e não tem nada a ver com o cargo que
   * está a ser apagado.
   */
  const cargos = await db.academyRole.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  for (const c of cargos) {
    await db.membership.updateMany({
      where: { customRoleId: c.id, title: { equals: c.name, mode: "insensitive" } },
      data: { title: null },
    });
  }

  const { count } = await db.membership.updateMany({
    where: { customRoleId: { in: ids } },
    data: { customRoleId: null },
  });
  // Os secundários saem por inteiro: não há "meio cargo" para lhes deixar.
  await db.membershipRole.deleteMany({ where: { roleId: { in: ids } } });
  await limparConvites(db, ids);
  await db.academyRole.updateMany({
    where: { id: { in: ids } },
    data: { archivedAt: new Date(), updatedAt: new Date() },
  });

  return count;
}

/**
 * Tira os cargos apagados dos convites que ainda não foram resgatados.
 *
 * `academyRoleId` limpa-se sozinho (`SetNull`), mas `extraRoleIds` é uma coluna
 * de texto e fica a apontar para cargos que já não existem. O resgate aguenta —
 * revalida tudo outra vez, é para isso que a validação é feita duas vezes — mas
 * quem convidou escolheu três cargos e via-os desaparecer sem explicação. Mais
 * vale o convite dizer a verdade desde já.
 */
export async function limparConvites(db: ScopedClient, apagar: string[]): Promise<void> {
  if (apagar.length === 0) return;
  const convites = await db.staffInvite.findMany({
    where: { acceptedAt: null, extraRoleIds: { hasSome: apagar } },
    select: { id: true, extraRoleIds: true },
  });
  const apagados = new Set(apagar);
  for (const c of convites) {
    await db.staffInvite.update({
      where: { id: c.id },
      data: { extraRoleIds: c.extraRoleIds.filter((r) => !apagados.has(r)) },
    });
  }
}

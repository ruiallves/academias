import type { Role } from "@prisma/client";
import type { ScopedClient } from "../prisma/prisma.service";

/**
 * O primeiro cargo de um departamento.
 *
 * ## Porque é que isto tem ficheiro próprio
 *
 * Porque tem **dois** chamadores, e a razão é uma corrida. A reparação vivia só
 * em `GET /api/departments`, e o diálogo de convite lê os dois — departamentos e
 * cargos. Em paralelo, a lista de cargos podia voltar de antes da reparação: o
 * departamento aparecia a dizer "ainda não tem cargos" e passava a tê-los um
 * segundo depois, sem nada no ecrã a mudar.
 *
 * A alternativa era o cliente ler um a seguir ao outro — e foi o que se fez
 * primeiro. Custou o dobro do tempo de espera (1,7 s → 3,3 s, medido), num
 * diálogo que já era lento. Correr a reparação nas duas leituras deixa a ordem
 * de chegada deixar de importar, e o cliente volta a ler em paralelo.
 */

/** Espelha o RANK dos papéis, dos departamentos e dos convites. */
const RANK: Record<Role, number> = {
  OWNER: 100,
  DIRECTOR: 80,
  COORDINATOR: 60,
  COACH: 40,
  MEDICAL: 40,
  SCOUT: 40,
  STAFF: 20,
  GUARDIAN: 0,
  ATHLETE: 0,
};

/** O nome do primeiro cargo de cada departamento de origem. */
const NOMES_DE_ORIGEM: Record<string, string> = {
  direcao: "Diretor",
  tecnica: "Treinador",
  clinico: "Médico",
  scouting: "Observador",
};

/**
 * Dá um primeiro cargo a cada departamento que nunca teve nenhum.
 *
 * ## Porque é que isto corre a cada leitura
 *
 * Pelo mesmo motivo que os departamentos de origem se semeiam à leitura e não
 * numa migração: uma migração apanha os clubes do dia em que corre, e os que
 * abrem depois voltam a nascer com o mesmo buraco. E o buraco era grande — 14
 * dos 17 clubes tinham departamentos sem um único cargo, os quatro de origem
 * incluídos, porque `SEED_DEPARTMENTS` semeava as áreas e `SYSTEM_ROLES` só
 * semeava o presidente. Convidar staff só oferecia "Sem departamento".
 *
 * Sem cargos não há nada para convidar: ninguém pertence a um departamento,
 * pertence a um **cargo**, e é o cargo que carrega as permissões.
 *
 * ## "Nunca teve nenhum", e não "não tem nenhum activo"
 *
 * A diferença decide se isto respeita ou desfaz uma decisão do clube. Um cargo
 * arquivado é alguém a dizer "este já não se usa"; ressuscitá-lo à leitura
 * seguinte era o produto a discutir com quem o arrumou. Por isso a condição é
 * `roles: { none: {} }` — sem cargos de todo, arquivados incluídos.
 *
 * Depois da primeira passagem não escreve mais nada: a consulta deixa de
 * encontrar departamentos e fica um `findMany` barato por leitura.
 */
export async function semearCargosEmFalta(db: ScopedClient, academyId: string): Promise<void> {
  const vazios = await db.department.findMany({
    where: { roles: { none: {} } },
    select: { id: true, key: true, name: true, baseRole: true, permissions: true, navKeys: true },
  });
  if (vazios.length === 0) return;

  /*
   * `createMany` com `skipDuplicates`, e chaves derivadas da do departamento.
   *
   * Isto corre numa **leitura**, e agora em duas — dois separadores, um F5 a
   * meio, ou simplesmente os dois pedidos do diálogo de convite — chegam aqui ao
   * mesmo tempo. Escolher uma chave livre e criar uma a uma dava uma corrida: as
   * duas viam a chave livre, as duas criavam, e a segunda rebentava a transacção
   * inteira. Com uma chave determinística e `skipDuplicates`, a segunda não faz
   * nada e a leitura devolve o mesmo que a primeira.
   *
   * Se a chave já estiver tomada por um cargo que o clube criou, esta salta: o
   * departamento fica sem cargo e o ecrã diz isso, com o caminho para o
   * resolver. É o degrau certo — melhor do que um 500 numa leitura.
   */
  await db.academyRole.createMany({
    data: vazios.map((d) => ({
      academyId,
      key: `cargo-${d.key}`.slice(0, 60),
      /* Um departamento de origem tem um nome de cargo pensado; os outros usam
         o nome que o clube lhes deu. */
      name: NOMES_DE_ORIGEM[d.key] ?? d.name,
      description: null,
      baseRole: d.baseRole,
      departmentId: d.id,
      permissions: d.permissions,
      navKeys: d.navKeys,
      /*
       * Nunca `isSystem`, nem no departamento de origem.
       *
       * `isSystem` num cargo quer dizer "não se mexe" — é o que protege o
       * presidente. Este é um ponto de partida para o clube renomear, ajustar ou
       * arquivar; trancá-lo era dar-lhe um departamento que não pode usar à sua
       * maneira, que é meio caminho para o problema de origem.
       */
      isSystem: false,
      rank: RANK[d.baseRole],
      updatedAt: new Date(),
    })),
    skipDuplicates: true,
  });
}

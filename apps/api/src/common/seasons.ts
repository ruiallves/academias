import type { ScopedClient } from "../prisma/prisma.service";

/**
 * A época em que o clube está a trabalhar.
 *
 * ## Porque é que `isCurrent` não chega
 *
 * `Season.isCurrent` é uma marca que **alguém tem de pôr**, e quase ninguém põe.
 * As épocas nascem sozinhas: a primeira equipa do ano cria a época do rótulo que
 * vier (`resolveSeason`, em `academy.service.ts`), e nasce por marcar de
 * propósito — uma equipa nova não decide qual é a época em curso do clube.
 *
 * O resultado em produção foi previsível: dezasseis clubes em dezassete com uma
 * época cada e nenhuma marcada. Quem lia `isCurrent` directamente não encontrava
 * nada, e o que fazia a seguir dependia de quem escreveu o código — o Orçamento
 * atirava "Época não encontrada" e a página não abria; as entregas de material
 * guardavam a entrega sem época, calada, e depois os relatórios por época vinham
 * vazios sem ninguém perceber porquê.
 *
 * ## A regra
 *
 * A marcada, se houver; senão a mais recente. É a mesma resposta que o `store`
 * já dava à consola, e pela mesma razão: um clube com uma época só tem uma época
 * corrente, tenha ou não alguém carregado no botão.
 *
 * Uma consulta só — `ORDER BY "isCurrent" DESC` põe a marcada à frente, e o
 * `startsOn` desempata (e resolve o caso, que não devia existir, de duas
 * marcadas ao mesmo tempo).
 *
 * Não substitui poder escolher a época: quem quer o orçamento de 2025/26 passa
 * o `seasonId`. Isto é só o que se mostra quando ninguém pediu nada em especial.
 *
 * ## Porque é que as épocas existentes não foram marcadas de uma vez
 *
 * Era tentador: cada clube tem uma época só, e uma migração punha-lhe a marca. Mas
 * hoje **nada** escreve `isCurrent` — não há ecrã nem endpoint que o faça. Marcar
 * 2026/27 agora significava que, no dia em que o clube criasse as equipas de
 * 2027/28, a época nova nascia por marcar e a velha continuava marcada: a regra
 * daqui passava a devolver a época errada, de propósito e para sempre. Sem marca
 * nenhuma, a mais recente é sempre a certa.
 *
 * A marca continua a ganhar quando existe — é uma pessoa a dizer em que época o
 * clube está, e isso vale mais do que uma data. Quem vier a construir esse ecrã
 * tem de limpar a marca das outras ao pôr numa.
 */
export function currentSeason(db: ScopedClient) {
  return db.season.findFirst({
    orderBy: [{ isCurrent: "desc" }, { startsOn: "desc" }],
    select: { id: true, label: true, startsOn: true, endsOn: true, isCurrent: true },
  });
}

/**
 * O nome de um jogo.
 *
 * ## Porque é que a equipa vem no nome
 *
 * Um jogo chamava-se "vs Benfica". No calendário, ao lado de treinos que se
 * chamam "Sub-11 Futebol", isso deixava metade da pergunta por responder:
 * *quem* é que joga contra o Benfica? Num clube com dez escalões, todos jogam
 * ao sábado, e a lista do dia era uma coluna de "vs" sem dono.
 *
 * O escalão vem à frente, como já vinha na convocatória ("Sub-11 Futebol vs
 * Benfica" é o que o ecrã de Convocatórias monta desde sempre): é a forma como
 * um clube fala dos seus jogos, e põe a informação que distingue no princípio
 * da linha, onde uma lista truncada ainda a mostra.
 *
 * O `@` continua a marcar o jogo fora — é curto, é convenção desportiva, e
 * "Sub-11 Futebol @ Benfica" lê-se sem ambiguidade.
 *
 * Gémeo de `matchTitle` em `apps/console/src/lib/calendar.ts`. Sem o nome da
 * equipa devolve o rótulo curto, que é o que ainda serve numa ficha onde a
 * equipa já está escrita ao lado.
 */
export function matchTitle(m: { isHome: boolean; opponent: string; teamName?: string | null }): string {
  const contra = `${m.isHome ? "vs" : "@"} ${m.opponent}`;
  return m.teamName ? `${m.teamName} ${contra}` : contra;
}

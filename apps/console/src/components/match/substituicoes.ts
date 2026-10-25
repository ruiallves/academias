/**
 * As regras das substituições do jogo ao vivo, sem ecrã.
 *
 * Vivem aqui, e não no `LiveMatch`, para se poderem provar sozinhas
 * (`npm run test:substituicoes`). O ecrã usa-as para três coisas: quem pode
 * sair, quem pode entrar, e se a lista de acontecimentos ainda bate certo
 * depois de se apagar um ou de se acertar um minuto.
 *
 * ## Volantes ou não
 *
 * É da equipa (`Team.unlimitedSubs`). Com substituições ilimitadas, quem saiu
 * pode voltar a entrar, as vezes que for preciso (o futsal, o basquetebol, e o
 * futebol de formação onde a associação o permite). Sem elas, quem sai não
 * volta, e quem já jogou não entra outra vez.
 *
 * ## O que vale sempre
 *
 * - Para um entrar, um sai, na mesma substituição. A única entrada sem saída é
 *   a que completa uma equipa com um expulso, no futsal, e só enquanto houver
 *   um expulso por completar.
 * - Só sai quem está em campo, e só entra quem não está.
 * - Ninguém sai e entra na mesma substituição.
 * - Um expulso não volta a entrar, nem com substituições ilimitadas.
 * - Só marca quem está em campo.
 */

export type Acontecimento = {
  id: string;
  tipo: string;
  /** Quem marcou, quem levou o cartão, ou quem saiu na substituição. */
  atleta?: string;
  /** Quem entrou, na substituição. Sem `atleta`: entrou no lugar de um expulso. */
  entra?: string;
};

export type RegrasDeSubstituicao = {
  /** Substituições ilimitadas: quem saiu pode voltar a entrar. */
  volantes: boolean;
  /** Uma equipa com um expulso completa-se com uma entrada sem saída (futsal). */
  completaExpulsos: boolean;
};

export type Situacao = {
  /** Quem está em campo depois do último acontecimento. */
  emCampo: Set<string>;
  /** Quem já esteve em campo: os titulares e quem entrou. */
  jogaram: Set<string>;
  expulsos: Set<string>;
  /** Expulsos ainda por completar com uma entrada sem saída. */
  vagasDeExpulsos: number;
  /** O que não bate certo, por acontecimento. */
  problemas: { id: string; mensagem: string }[];
};

/**
 * Corre os acontecimentos por ordem (a ordem é de quem chama: a do relógio) e
 * diz como fica o campo e o que não bate certo. Um acontecimento errado não
 * para a conta: aplica-se na mesma, para os seguintes se lerem como o ecrã os
 * mostra, e fica na lista dos problemas.
 */
export function percorrer(
  titulares: string[],
  acontecimentos: Acontecimento[],
  regras: RegrasDeSubstituicao,
  nome: (id: string) => string = (id) => id,
): Situacao {
  const emCampo = new Set(titulares);
  const jogaram = new Set(titulares);
  const expulsos = new Set<string>();
  let vagasDeExpulsos = 0;
  const problemas: Situacao["problemas"] = [];
  const falha = (id: string, mensagem: string) => problemas.push({ id, mensagem });

  for (const a of acontecimentos) {
    if (a.tipo === "sub") {
      const entra = a.entra;
      if (!entra) {
        falha(a.id, "Falta quem entrou.");
        continue;
      }
      if (a.atleta) {
        if (a.atleta === entra) falha(a.id, `${nome(entra)} não pode sair e entrar na mesma substituição.`);
        else if (!emCampo.has(a.atleta)) {
          falha(a.id, expulsos.has(a.atleta) ? `${nome(a.atleta)} já tinha sido expulso: não estava em campo para sair.` : `${nome(a.atleta)} não estava em campo para sair.`);
        }
      } else if (!regras.completaExpulsos) {
        falha(a.id, `Entrou ${nome(entra)} sem sair ninguém: para entrar um, tem de sair outro.`);
      } else if (vagasDeExpulsos <= 0) {
        falha(a.id, `Entrou ${nome(entra)} sem sair ninguém, e não há nenhum expulso por completar.`);
      }
      if (a.atleta !== entra) {
        const motivo = motivoParaNaoEntrar(entra, { emCampo, jogaram, expulsos }, regras, nome);
        if (motivo) falha(a.id, motivo);
      }
      if (a.atleta) emCampo.delete(a.atleta);
      else vagasDeExpulsos = Math.max(0, vagasDeExpulsos - 1);
      emCampo.add(entra);
      jogaram.add(entra);
      continue;
    }

    if (a.tipo === "golo" && a.atleta && !emCampo.has(a.atleta)) {
      falha(a.id, `${nome(a.atleta)} não estava em campo quando marcou.`);
    }

    if (a.tipo === "vermelho" && a.atleta) {
      if (expulsos.has(a.atleta)) falha(a.id, `${nome(a.atleta)} já tinha sido expulso.`);
      else {
        if (emCampo.has(a.atleta)) vagasDeExpulsos++;
        expulsos.add(a.atleta);
      }
      emCampo.delete(a.atleta);
    }
  }

  return { emCampo, jogaram, expulsos, vagasDeExpulsos, problemas };
}

/**
 * Porque é que este jogador não pode entrar agora, ou `null` se pode. É o que
 * decide a lista "Quem entra?" e o que se verifica em cada substituição.
 */
export function motivoParaNaoEntrar(
  id: string,
  s: Pick<Situacao, "emCampo" | "jogaram" | "expulsos">,
  regras: RegrasDeSubstituicao,
  nome: (id: string) => string = (x) => x,
): string | null {
  if (s.emCampo.has(id)) return `${nome(id)} já estava em campo.`;
  if (s.expulsos.has(id)) return `${nome(id)} foi expulso e não pode voltar a entrar.`;
  if (!regras.volantes && s.jogaram.has(id)) return `${nome(id)} já tinha jogado: nesta equipa quem sai não volta a entrar.`;
  return null;
}

/**
 * As substituições da equipa, com a regra antiga por recurso: um servidor de
 * antes de `unlimitedSubs` não o manda, e aí valem as da modalidade.
 */
export function substituicoesVolantes(unlimitedSubs: boolean | undefined | null, codigoDaModalidade: string | null | undefined): boolean {
  if (typeof unlimitedSubs === "boolean") return unlimitedSubs;
  return codigoDaModalidade === "futsal" || codigoDaModalidade === "basketball";
}

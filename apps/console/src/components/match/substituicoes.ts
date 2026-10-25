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
 * futebol de formação onde a associação o permite), e os minutos somam cada
 * vez em campo (`vezesEmCampo`). Sem elas, quem sai não volta, e quem já jogou
 * não entra outra vez.
 *
 * ## O que vale sempre
 *
 * - Para um entrar, um sai, na mesma substituição. A única entrada sem saída é
 *   a que completa uma equipa com um expulso, no futsal, e só enquanto houver
 *   um expulso por completar.
 * - Só sai quem está em campo, e só entra quem não está.
 * - Ninguém sai e entra na mesma substituição.
 * - Um expulso não volta a entrar, nem com substituições ilimitadas.
 * - O segundo amarelo é uma expulsão: sai de campo como com o vermelho.
 * - Só marca quem está em campo.
 * - Começam tantos quantos o formato manda (`titularesDoFormato`). Como cada
 *   entrada tem uma saída, ficam sempre esses em campo, menos os expulsos.
 */

/** Quantos começam em cada formato de jogo. */
export const TITULARES_DO_FORMATO: Record<string, number> = { f11: 11, f9: 9, f7: 7, f5: 5, futsal: 5, basket: 5 };

/**
 * O que está mal no número de titulares, ou `null` se está certo.
 *
 * A mais é um erro: não cabem em campo. A menos é só um aviso, porque há jogos
 * de formação que começam com menos por falta de jogadores.
 */
export function problemaNosTitulares(n: number, formato: string, nomeDoFormato: string): { erro: boolean; mensagem: string } | null {
  const esperados = TITULARES_DO_FORMATO[formato];
  if (n === 0) return { erro: true, mensagem: "Escolhe quem começa o jogo." };
  if (!esperados || n === esperados) return null;
  if (n > esperados) return { erro: true, mensagem: `No ${nomeDoFormato} começam ${esperados}, e estão escolhidos ${n}. Se o jogo é de outro formato, muda-o no Pré-jogo.` };
  return { erro: false, mensagem: `No ${nomeDoFormato} começam ${esperados}, e estão escolhidos ${n}.` };
}

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
  const amarelos = new Map<string, number>();
  const problemas: Situacao["problemas"] = [];
  const falha = (id: string, mensagem: string) => problemas.push({ id, mensagem });
  /** Expulso: sai de campo, e a equipa fica com um lugar por completar (futsal). */
  const expulsar = (id: string) => {
    if (emCampo.has(id)) vagasDeExpulsos++;
    expulsos.add(id);
    emCampo.delete(id);
  };

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

    /*
     * O segundo amarelo é uma expulsão: sai de campo como com o vermelho. Um
     * amarelo a quem já foi expulso, ou um terceiro, não existe.
     */
    if (a.tipo === "amarelo" && a.atleta) {
      if (expulsos.has(a.atleta)) {
        falha(a.id, `${nome(a.atleta)} já tinha sido expulso.`);
        continue;
      }
      const n = (amarelos.get(a.atleta) ?? 0) + 1;
      amarelos.set(a.atleta, n);
      if (n >= 2) expulsar(a.atleta);
    }

    if (a.tipo === "vermelho" && a.atleta) {
      if (expulsos.has(a.atleta)) falha(a.id, `${nome(a.atleta)} já tinha sido expulso.`);
      else expulsar(a.atleta);
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
 * As vezes que cada um esteve em campo, para a ficha contar os minutos com
 * substituições ilimitadas: entrou, saiu, entrou, saiu… (`MatchAppearance.stints`).
 *
 * Os titulares entram aos 0. Uma substituição fecha a vez de quem sai e abre a
 * de quem entra; o vermelho fecha a de quem o levou. Quem acaba o jogo em campo
 * fica com a última vez aberta (um número ímpar). Os acontecimentos vêm pela
 * ordem do relógio; um minuto que ande para trás conta como o anterior, para a
 * lista nunca sair fora de ordem.
 */
export function vezesEmCampo(titulares: string[], acontecimentos: (Acontecimento & { minuto: number })[]): Map<string, number[]> {
  const vezes = new Map<string, number[]>();
  const emCampo = new Set<string>();
  const marcar = (id: string, minuto: number) => {
    const lista = vezes.get(id) ?? [];
    lista.push(Math.max(minuto, lista[lista.length - 1] ?? 0));
    vezes.set(id, lista);
  };
  const entrar = (id: string, minuto: number) => {
    if (emCampo.has(id)) return;
    emCampo.add(id);
    marcar(id, minuto);
  };
  const sair = (id: string, minuto: number) => {
    if (!emCampo.has(id)) return;
    emCampo.delete(id);
    marcar(id, minuto);
  };
  const amarelos = new Map<string, number>();
  for (const id of titulares) entrar(id, 0);
  for (const a of acontecimentos) {
    if (a.tipo === "sub") {
      if (a.atleta) sair(a.atleta, a.minuto);
      if (a.entra) entrar(a.entra, a.minuto);
    } else if (a.tipo === "vermelho" && a.atleta) sair(a.atleta, a.minuto);
    else if (a.tipo === "amarelo" && a.atleta) {
      // O segundo amarelo é uma expulsão.
      const n = (amarelos.get(a.atleta) ?? 0) + 1;
      amarelos.set(a.atleta, n);
      if (n >= 2) sair(a.atleta, a.minuto);
    }
  }
  return vezes;
}

/**
 * As substituições da equipa, com a regra antiga por recurso: um servidor de
 * antes de `unlimitedSubs` não o manda, e aí valem as da modalidade.
 */
export function substituicoesVolantes(unlimitedSubs: boolean | undefined | null, codigoDaModalidade: string | null | undefined): boolean {
  if (typeof unlimitedSubs === "boolean") return unlimitedSubs;
  return codigoDaModalidade === "futsal" || codigoDaModalidade === "basketball";
}

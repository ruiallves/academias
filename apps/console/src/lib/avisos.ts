/**
 * Os avisos da consola — o canal por onde um erro chega a quem está a trabalhar.
 *
 * ## Porque é que isto não é um `useState` num componente
 *
 * Porque a maioria dos erros **não nasce num componente**. Nasce no cliente HTTP
 * (`lib/http.ts`), que é uma função sem React à volta, chamada de dentro de
 * diálogos, de painéis, de efeitos e de código que corre depois de a página
 * mudar. Um canal fora do React é o que permite que o sítio onde o erro acontece
 * não precise de saber nada sobre onde ele vai ser mostrado.
 *
 * O componente (`components/Avisos.tsx`) subscreve isto e desenha. É o mesmo
 * padrão do sinal legal (`legal-signal.ts`), pela mesma razão.
 *
 * ## Porque é que se repete não se empilha
 *
 * Quando a rede cai, a consola faz nove pedidos e falham os nove — com a mesma
 * frase. Nove cartões iguais empilhados não dizem nove vezes mais: dizem que o
 * produto está avariado. Um aviso com a mesma mensagem **reacende o que já está
 * no ecrã** em vez de criar outro, e conta as repetições.
 */

export type TipoDeAviso = "erro" | "ok";

export type Aviso = {
  id: number;
  tipo: TipoDeAviso;
  texto: string;
  /** Quanto tempo fica, em milissegundos. É o que a barra de baixo desenha. */
  duracao: number;
  /** Quantas vezes a mesma coisa aconteceu desde que o aviso apareceu. */
  repetido: number;
  /** Muda a cada reacendimento: é o que faz a barra recomeçar. Ver `Avisos.tsx`. */
  versao: number;
};

/**
 * Quanto tempo fica cada um.
 *
 * O erro fica mais tempo porque tem de ser **lido**, e as frases do servidor são
 * frases inteiras ("Já há um mesociclo (Pré-época) de 17 ago a 6 set nesta
 * equipa"). Quatro segundos chegam para um "gravado"; para uma frase destas,
 * não.
 */
const DURACAO: Record<TipoDeAviso, number> = { erro: 9000, ok: 4000 };

/** Quantos cabem no ecrã ao mesmo tempo. Acima disto, o mais velho sai. */
const MAXIMO = 4;

let avisos: Aviso[] = [];
let proximoId = 1;
const ouvintes = new Set<(a: Aviso[]) => void>();

function emitir() {
  for (const ouvinte of ouvintes) ouvinte(avisos);
}

/** Subscrever a lista. Devolve a função que cancela — é o que o `useSyncExternalStore` quer. */
export function ouvirAvisos(ouvinte: (a: Aviso[]) => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

export function avisosActuais(): Aviso[] {
  return avisos;
}

export function fecharAviso(id: number): void {
  avisos = avisos.filter((a) => a.id !== id);
  emitir();
}

/**
 * Mostrar um aviso.
 *
 * Uma mensagem vazia não abre cartão nenhum: erros sem texto existem (um
 * `catch` que apanha algo que não é `Error`), e um cartão em branco é pior do
 * que silêncio — não diz o que se passou e ainda tapa o ecrã.
 */
export function mostrarAviso(tipo: TipoDeAviso, texto: string): void {
  const limpo = texto.trim();
  if (!limpo) return;

  const igual = avisos.find((a) => a.tipo === tipo && a.texto === limpo);
  if (igual) {
    // Reacende em vez de empilhar. `versao` é o que faz a barra recomeçar do
    // princípio, e `repetido` é o que diz que não foi só uma vez.
    avisos = avisos.map((a) =>
      a.id === igual.id ? { ...a, repetido: a.repetido + 1, versao: a.versao + 1 } : a,
    );
    emitir();
    return;
  }

  const novo: Aviso = {
    id: proximoId++,
    tipo,
    texto: limpo,
    duracao: DURACAO[tipo],
    repetido: 0,
    versao: 0,
  };
  avisos = [...avisos, novo].slice(-MAXIMO);
  emitir();
}

export const mostrarErro = (texto: string) => mostrarAviso("erro", texto);
export const mostrarOk = (texto: string) => mostrarAviso("ok", texto);

/**
 * O que se diz quando o que foi apanhado não tem mensagem própria.
 *
 * Um `catch` apanha `unknown`, e nem tudo o que é lançado é um `Error`. Isto é o
 * mesmo `e instanceof Error ? e.message : "…"` que estava escrito em dezenas de
 * sítios, num sítio só.
 */
export function textoDoErro(e: unknown, omissao = "Não foi possível completar a operação."): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  if (typeof e === "string" && e.trim()) return e;
  return omissao;
}

/**
 * Um erro que se anuncia ao ser criado.
 *
 * Existe para o punhado de coisas que **não passam pelo cliente HTTP**: os
 * carregamentos de ficheiros, que vão directos ao armazenamento por um endereço
 * assinado e por isso não atravessam `lib/http.ts`. Sem isto, uma fotografia
 * recusada pelo armazenamento seria o único erro da consola a não aparecer no
 * canto — e "todos menos um" é a pior espécie de regra.
 *
 * Devolve o `Error` em vez de o lançar para o sítio onde se usa continuar a
 * dizer `throw`: quem lê o código vê que ali se sai, e não tem de saber que
 * esta função lança por dentro.
 */
export function erroAvisado(texto: string): Error {
  mostrarErro(texto);
  return new Error(texto);
}

/**
 * As promessas que ninguém apanhou.
 *
 * `void gravar()` sem `catch`, um efeito que rejeita, uma leitura que falha num
 * caminho esquecido. Hoje isso morre na consola do browser e o ecrã fica
 * parado, sem explicação — que é a pior forma de falhar, porque parece que o
 * clique não chegou a registar. Ligado uma vez, no arranque.
 */
export function vigiarPromessasPerdidas(): void {
  window.addEventListener("unhandledrejection", (evento) => {
    /*
     * Só o que tem uma frase para mostrar.
     *
     * Uma rejeição sem mensagem — um `AbortError` de um pedido cancelado ao
     * mudar de página, por exemplo — não é uma coisa que se diga a ninguém.
     */
    const erro = evento.reason;
    if (erro instanceof Error && erro.name === "AbortError") return;

    /*
     * Um erro da API **não** volta a passar por aqui.
     *
     * Quem decide se um erro de pedido aparece é o cliente HTTP, e já decidiu:
     * ou o mostrou, ou calou-o de propósito por ser um pedido de fundo. Sem
     * esta linha, um `void carregar()` cujo 403 foi silenciado à saída do
     * cliente voltava a entrar por aqui e aparecia na mesma — que foi
     * exactamente como o "Sem permissão" continuou a aparecer a treinadores e
     * scouts depois de eu julgar o assunto fechado.
     *
     * O que sobra é o que isto existe para apanhar: os erros do lado do
     * browser, que hoje morrem na consola com o ecrã parado.
     */
    if (erro instanceof Error && erro.name === "ApiError") return;

    const texto = textoDoErro(erro, "");
    if (texto) mostrarErro(texto);
  });
}

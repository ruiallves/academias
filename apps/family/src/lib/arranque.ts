import { academySlug } from "@/lib/invite";
import { sessionUserId } from "@/lib/session";

/**
 * O que a app guarda para abrir já com conteúdo.
 *
 * ## O problema
 *
 * Abrir a app eram três voltas ao servidor em fila — os contextos, os termos,
 * o bootstrap — e um splash a pulsar enquanto nenhuma delas chegava. Com rede
 * boa era um segundo; com a rede de um pavilhão eram cinco. E os dados que
 * chegavam eram, quase sempre, os mesmos da última abertura.
 *
 * ## O que se faz
 *
 * As respostas do arranque ficam guardadas no telemóvel. Na abertura seguinte a
 * app desenha-se logo com elas, e pede ao servidor as novas por trás; quando
 * chegam, substituem as velhas sem piscar. É o que uma rede social faz ao
 * abrir no último feed. Só as respostas cruas: a tradução para o que os ecrãs
 * leem corre como sempre, sobre dados guardados ou acabados de chegar.
 *
 * ## O que nunca acontece
 *
 * O guardado é **de uma conta, num clube, numa área**: a chave leva o `sub` do
 * token, o slug e o nome da coisa. Sair da sessão apaga tudo o que começa por
 * `academia.arranque.` (ver `signOut` em `lib/session.ts`); entrar com outra
 * conta não encontra nada do anterior. E ao fim de uma semana sem abrir a app,
 * o guardado deixa de valer — é melhor um segundo de splash do que uma agenda
 * de há um mês.
 */

const PREFIXO = "academia.arranque.";
const VALIDADE_MS = 7 * 86_400_000;
/** Muda-se quando a forma do que se guarda muda — o guardado antigo é ignorado. */
const VERSAO = 1;

type Guardado<T> = { v: number; quando: number; valor: T };

function chave(nome: string): string | null {
  const sub = sessionUserId();
  if (!sub) return null;
  return `${PREFIXO}${nome}:${academySlug()}:${sub}`;
}

/** O que ficou guardado da última vez, ou `null` se não há, é de outra conta ou já envelheceu. */
export function lerArranque<T>(nome: string): T | null {
  try {
    const k = chave(nome);
    if (!k) return null;
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const g = JSON.parse(raw) as Guardado<T>;
    if (g.v !== VERSAO || typeof g.quando !== "number") return null;
    if (Date.now() - g.quando > VALIDADE_MS) {
      localStorage.removeItem(k);
      return null;
    }
    return g.valor;
  } catch {
    return null;
  }
}

/** Guarda a resposta acabada de chegar. Em modo privado, ou sem espaço, não acontece nada — a app funciona na mesma. */
export function guardarArranque<T>(nome: string, valor: T): void {
  try {
    const k = chave(nome);
    if (!k) return;
    const g: Guardado<T> = { v: VERSAO, quando: Date.now(), valor };
    localStorage.setItem(k, JSON.stringify(g));
  } catch {
    /* sem espaço ou modo privado: a próxima abertura volta a esperar pela rede */
  }
}

/** Esquece o guardado de um nome — quando se sabe que já não serve (por exemplo, a área mudou). */
export function apagarArranque(nome: string): void {
  try {
    const k = chave(nome);
    if (k) localStorage.removeItem(k);
  } catch {
    /* idem */
  }
}

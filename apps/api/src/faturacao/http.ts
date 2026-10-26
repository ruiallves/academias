/**
 * O `fetch` dos conectores: com tecto de tempo, e com os erros já na língua
 * da fila.
 *
 * Um programa em baixo, um limite de pedidos ou uma rede a soluçar são erros
 * **de passagem** (`definitivo: false`): a fila volta mais tarde. Uma chave
 * recusada ou um pedido mal formado são erros **definitivos**: repetir não
 * muda nada, e a fila pára e avisa. A distinção faz-se aqui, uma vez, pelo
 * código de estado, para os conectores não a repetirem a cada chamada.
 */
import { ErroDeFaturacao } from "./tipos";

export type Resposta = { status: number; texto: string; json: unknown; headers: Headers };

const TEMPO_MAXIMO_MS = 25_000;

export async function pedir(url: string, init: RequestInit = {}, programa = "o programa de faturação"): Promise<Resposta> {
  const controlo = new AbortController();
  const relogio = setTimeout(() => controlo.abort(), TEMPO_MAXIMO_MS);
  try {
    const r = await fetch(url, { ...init, signal: controlo.signal });
    const texto = await r.text();
    let json: unknown = null;
    if (texto) {
      try {
        json = JSON.parse(texto);
      } catch {
        json = null;
      }
    }
    return { status: r.status, texto, json, headers: r.headers };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    throw new ErroDeFaturacao(`Não foi possível falar com ${programa}. Voltamos a tentar mais tarde.`, false, motivo);
  } finally {
    clearTimeout(relogio);
  }
}

/** O mesmo, para um ficheiro (o PDF). */
export async function descarregar(url: string, init: RequestInit = {}, programa = "o programa de faturação"): Promise<{ status: number; tipo: string; corpo: Buffer }> {
  const controlo = new AbortController();
  const relogio = setTimeout(() => controlo.abort(), TEMPO_MAXIMO_MS);
  try {
    const r = await fetch(url, { ...init, signal: controlo.signal, redirect: "follow" });
    const corpo = Buffer.from(await r.arrayBuffer());
    return { status: r.status, tipo: r.headers.get("content-type") ?? "", corpo };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    throw new ErroDeFaturacao(`Não foi possível descarregar o PDF de ${programa}. Voltamos a tentar mais tarde.`, false, motivo);
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Transforma um estado que não é sucesso no erro certo. Quem chama decide o
 * que é sucesso (200, 201, às vezes 202) e passa o resto por aqui.
 */
export function erroDaResposta(r: Resposta, programa: string, oQue: string): ErroDeFaturacao {
  const detalhe = r.texto.slice(0, 500);
  if (r.status === 401 || r.status === 403) {
    return new ErroDeFaturacao(`${programa} recusou as credenciais do clube. É preciso voltar a ligar a faturação nas Definições.`, true, detalhe);
  }
  if (r.status === 429) return new ErroDeFaturacao(`${programa} pediu para abrandar. Voltamos a tentar mais tarde.`, false, detalhe);
  if (r.status >= 500) return new ErroDeFaturacao(`${programa} está com problemas. Voltamos a tentar mais tarde.`, false, detalhe);
  return new ErroDeFaturacao(`${programa} recusou ${oQue}: ${mensagemDoPrograma(r) ?? `erro ${r.status}`}.`, true, detalhe);
}

/** O melhor que se consegue tirar de uma resposta de erro, nas várias formas em que os programas as mandam. */
export function mensagemDoPrograma(r: Resposta): string | null {
  const j = r.json as Record<string, unknown> | unknown[] | null;
  if (!j) return r.texto ? r.texto.slice(0, 160) : null;
  const frases: string[] = [];
  const recolher = (v: unknown, fundo = 0): void => {
    if (fundo > 4) return;
    if (typeof v === "string") frases.push(v);
    else if (Array.isArray(v)) v.forEach((x) => recolher(x, fundo + 1));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (["error", "errors", "message", "description", "error_description", "reason"].includes(k) || typeof x !== "string") recolher(x, fundo + 1);
        else frases.push(`${k} ${x}`);
      }
    }
  };
  recolher(j);
  const texto = frases.filter(Boolean).slice(0, 3).join("; ");
  return texto ? texto.slice(0, 200) : null;
}

/** Um objeto aninhado em `a[b][0][c]=…`, como o PHP gosta e a Sage e a Moloni pedem. */
export function formulario(dados: Record<string, unknown>, prefixo = ""): URLSearchParams {
  const params = new URLSearchParams();
  const andar = (v: unknown, chave: string) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => andar(x, `${chave}[${i}]`));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) andar(x, chave ? `${chave}[${k}]` : k);
    else params.append(chave, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  };
  andar(dados, prefixo);
  return params;
}

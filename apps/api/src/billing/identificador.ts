import { randomInt } from "node:crypto";

/**
 * O identificador de um pagamento, tal como aparece no backoffice da euPago.
 *
 * ## Porque é que existe
 *
 * O clube via o movimento na euPago e não sabia de quem era: o que seguia como
 * `identifier` era o id do Payment (`cmf3x…`). Agora segue isto, que se lê:
 *
 *     TIPO-MES-ATLETAS-PAGADOR-ID
 *     MENS-SET26-JOAO_SILVA-MARIA_SILVA-7K2F9Q
 *     QUOTA-SET26_A_DEZ26-RUI_COSTA-RUI_COSTA-H8M3PX
 *
 * - **TIPO**: `MENS` (mensalidade), `EXTRA` (equipamento, torneio, viagem…),
 *   `QUOTA` (quota de sócio). Um pagamento com coisas de tipos diferentes é
 *   `VARIOS`.
 * - **MES**: o mês ou os meses. Seguidos dizem-se como intervalo
 *   (`SET26_A_DEZ26`); soltos, até três, um a um (`SET26_E_NOV26`); mais do
 *   que isso, quantos são (`5MESES`).
 * - **ATLETAS**: de quem é, primeiro e último nome. Vários juntam-se com `_E_`.
 *   Numa quota é o sócio.
 * - **PAGADOR**: quem carregou em "pagar", primeiro e último nome.
 * - **ID**: seis caracteres ao acaso, para dois pagamentos iguais (a mesma
 *   mensalidade tentada duas vezes) não terem o mesmo identificador.
 *
 * ## Os limites
 *
 * A euPago não documenta o tamanho nem os caracteres que aceita. Fica-se pelo
 * que qualquer sistema aceita: maiúsculas sem acentos, algarismos, `-` e `_`,
 * e no máximo `MAXIMO` caracteres. Quando não cabe, encurta-se pela ordem que
 * menos custa ler: atletas só com o primeiro nome, depois só quantos são,
 * depois o pagador cortado. O ID nunca se corta: é o que o torna único.
 */

export type TipoDePagamento = "MENS" | "EXTRA" | "QUOTA";

export type ItemPago = {
  tipo: TipoDePagamento;
  /** `AAAA-MM`; também aceita `AAAA` (quota anual). */
  periodo: string;
  /** O atleta, ou o sócio numa quota. */
  nome: string;
};

export const MAXIMO = 64;

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

/** Sem 0/O, 1/I: lê-se ao telefone sem soletrar. */
const ALFABETO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Partículas que não identificam ninguém: "Maria da Silva" é MARIA_SILVA. */
const PARTICULAS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E", "D"]);

export function sufixoAleatorio(n = 6): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return s;
}

function palavras(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((p) => p && !PARTICULAS.has(p));
}

/** "Maria João da Silva" → MARIA_SILVA. */
export function nomeCurto(nome: string): string {
  const p = palavras(nome);
  if (p.length === 0) return "";
  return p.length === 1 ? p[0] : `${p[0]}_${p[p.length - 1]}`;
}

function primeiroNome(nome: string): string {
  return palavras(nome)[0] ?? "";
}

/** "2026-09" → SET26; "2026" → 2026. */
function mes(periodo: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (m) {
    const i = Number(m[2]) - 1;
    if (i >= 0 && i < 12) return `${MESES[i]}${m[1].slice(2)}`;
  }
  return palavras(periodo).join("_");
}

function indiceDoMes(periodo: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
}

function meses(periodos: string[]): string {
  const unicos = [...new Set(periodos)].sort();
  if (unicos.length === 0) return "";
  if (unicos.length === 1) return mes(unicos[0]);

  const indices = unicos.map(indiceDoMes);
  const seguidos = indices.every((v, i) => v !== null && (i === 0 || v === (indices[i - 1] as number) + 1));
  if (seguidos) return `${mes(unicos[0])}_A_${mes(unicos[unicos.length - 1])}`;
  if (unicos.length <= 3) return unicos.map(mes).join("_E_");
  return `${unicos.length}MESES`;
}

export function montarIdentificador(itens: ItemPago[], pagador: string | null | undefined, sufixo = sufixoAleatorio()): string {
  const tipos = [...new Set(itens.map((i) => i.tipo))];
  const tipo = tipos.length === 1 ? tipos[0] : "VARIOS";
  const quando = meses(itens.map((i) => i.periodo)) || "SEMMES";
  const nomes = [...new Set(itens.map((i) => i.nome.trim()).filter(Boolean))];

  const quem = nomeCurto(pagador ?? "") || "SEM_NOME";
  const montar = (atletas: string, pagou: string) => [tipo, quando, atletas || "SEM_NOME", pagou, sufixo].join("-");

  const completos = nomes.map(nomeCurto).filter(Boolean).join("_E_");
  let id = montar(completos, quem);
  if (id.length <= MAXIMO) return id;

  const primeiros = nomes.map(primeiroNome).filter(Boolean).join("_E_");
  id = montar(primeiros, quem);
  if (id.length <= MAXIMO) return id;

  const atletas = nomes.length > 1 ? `${nomes.length}_ATLETAS` : primeiros;
  id = montar(atletas, quem);
  if (id.length <= MAXIMO) return id;

  // O pagador é o que se corta por fim, e nunca o ID.
  const sobra = MAXIMO - montar(atletas, "").length;
  return montar(atletas, quem.slice(0, Math.max(sobra, 1)).replace(/_+$/, ""));
}

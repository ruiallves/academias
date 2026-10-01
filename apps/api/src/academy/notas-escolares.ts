/**
 * As regras das notas da escola de um atleta.
 *
 * Sem dependências, de propósito: é o ficheiro que o teste importa.
 *
 * ## O que é uma nota aqui
 *
 * O que a família submete na app: **o período, a disciplina e a nota**. O clube
 * lê na ficha do atleta — um clube de formação quer saber como vai a escola dos
 * miúdos que treina, e até aqui pedia a ficha de avaliação em papel.
 *
 * Uma nota é de um ano lectivo, de um período e de uma disciplina. Submeter
 * outra vez a mesma disciplina no mesmo período **corrige** a que lá estava, em
 * vez de criar outra: uma pauta tem uma nota por disciplina.
 */

/** Períodos (ensino por três períodos) e semestres (escolas semestrais). */
export const PERIODOS = ["1P", "2P", "3P", "1S", "2S"] as const;
export type Periodo = (typeof PERIODOS)[number];

/** As duas escalas das escolas portuguesas: 1 a 5 (básico) e 0 a 20 (secundário). */
export const ESCALAS = [5, 20] as const;

export const MAX_DISCIPLINA = 60;

export type NotaEscolar = {
  schoolYear: string;
  period: Periodo;
  subject: string;
  subjectKey: string;
  grade: number;
  scale: number;
};

/**
 * O ano lectivo de um dia: `2026/27`. Vira a 1 de Agosto, que é quando a
 * época e a escola já estão a olhar para o ano seguinte.
 */
export function anoLectivoDe(data: Date): string {
  const ano = data.getMonth() >= 7 ? data.getFullYear() : data.getFullYear() - 1;
  return `${ano}/${String((ano + 1) % 100).padStart(2, "0")}`;
}

/**
 * A disciplina, reduzida ao que a identifica: sem acentos, sem maiúsculas, sem
 * espaços a mais. "Matemática", "matematica " e "MATEMÁTICA" são a mesma, e uma
 * pauta não pode ficar com as três.
 */
export function chaveDaDisciplina(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** O que se grava, a partir do que a família escreveu. Lança `Error` com a razão. */
export function limparNota(dto: Record<string, unknown>): NotaEscolar {
  const schoolYear = typeof dto.schoolYear === "string" ? dto.schoolYear.trim() : "";
  const m = /^(20\d{2})\/(\d{2})$/.exec(schoolYear);
  // `2026/27` e não `2026/31`: o segundo ano é sempre o seguinte.
  if (!m || Number(m[2]) !== (Number(m[1]) + 1) % 100) throw new Error("Ano lectivo inválido");

  const period = dto.period;
  if (typeof period !== "string" || !(PERIODOS as readonly string[]).includes(period)) {
    throw new Error("Escolhe o período");
  }

  const subject = typeof dto.subject === "string" ? dto.subject.trim().replace(/\s+/g, " ") : "";
  if (!subject) throw new Error("Escreve a disciplina");
  if (subject.length > MAX_DISCIPLINA) throw new Error(`A disciplina tem de ter no máximo ${MAX_DISCIPLINA} caracteres`);
  const subjectKey = chaveDaDisciplina(subject);
  if (!subjectKey) throw new Error("Escreve a disciplina");

  const scale = dto.scale;
  if (scale !== 5 && scale !== 20) throw new Error("Escolhe a escala da nota");

  const grade = dto.grade;
  if (typeof grade !== "number" || !Number.isInteger(grade)) throw new Error("A nota tem de ser um número inteiro");
  // No básico não há zero: a escala é de 1 a 5. No secundário vai de 0 a 20.
  const minimo = scale === 5 ? 1 : 0;
  if (grade < minimo || grade > scale) throw new Error(`A nota tem de estar entre ${minimo} e ${scale}`);

  return { schoolYear, period: period as Periodo, subject, subjectKey, grade, scale };
}

/** É negativa? Abaixo de 3 em 5, abaixo de 10 em 20. Para a consola a assinalar. */
export const negativa = (grade: number, scale: number): boolean => (scale === 5 ? grade < 3 : grade < 10);

/**
 * As regras da informação médica e dos documentos de um atleta.
 *
 * Sem dependências, de propósito: é o ficheiro que o teste importa. O serviço
 * (`athlete-ficha.service.ts`) trata da base e do armazenamento; aqui decide-se
 * o que é válido e de quem é cada ficheiro.
 */

/* -------------------------------------------------------------------------- */
/* Informação médica                                                           */
/* -------------------------------------------------------------------------- */

export const GRUPOS_SANGUINEOS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

/** Texto livre, mas não um romance: uma ficha lê-se à pressa. */
export const MAX_TEXTO_MEDICO = 2000;

export type InfoMedica = {
  bloodType: string | null;
  allergies: string | null;
  medication: string | null;
  notes: string | null;
};

const texto = (v: unknown, campo: string): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new Error(`${campo} tem de ser texto`);
  const limpo = v.trim();
  if (limpo.length > MAX_TEXTO_MEDICO) throw new Error(`${campo} tem de ter no máximo ${MAX_TEXTO_MEDICO} caracteres`);
  return limpo || null;
};

/**
 * O que se grava, a partir do que chegou.
 *
 * Um campo vazio grava-se como nulo: "sem alergias conhecidas" escreve-se, e
 * um campo em branco quer dizer que ninguém preencheu — são coisas diferentes
 * para quem lê a ficha numa urgência.
 */
export function limparInfoMedica(dto: Partial<Record<keyof InfoMedica, unknown>>): InfoMedica {
  const grupo = texto(dto.bloodType, "O grupo sanguíneo")?.toUpperCase().replace(/\s+/g, "") ?? null;
  if (grupo && !(GRUPOS_SANGUINEOS as readonly string[]).includes(grupo)) {
    throw new Error("Grupo sanguíneo desconhecido");
  }
  return {
    bloodType: grupo,
    allergies: texto(dto.allergies, "As alergias"),
    medication: texto(dto.medication, "A medicação"),
    notes: texto(dto.notes, "As observações"),
  };
}

/* -------------------------------------------------------------------------- */
/* Documentos                                                                  */
/* -------------------------------------------------------------------------- */

export const DOCUMENT_BUCKET = "documentos";
export const DOC_MAX_BYTES = 20 * 1024 * 1024;
export const DOC_MAX_FICHEIROS = 10;
export const DOC_MAX_NOME = 120;

/**
 * O que se pode carregar: fotografias e documentos, e mais nada.
 *
 * A lista é curta de propósito. Um ficheiro destes abre-se no browser de quem
 * tem a ficha à frente: HTML e SVG correm código, e um `.exe` não é um
 * documento de atleta.
 */
export const DOC_TIPOS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

export type FicheiroDoDocumento = { key: string; name: string; type: string };

/** A pasta de um atleta no bucket: o clube à frente, o atleta a seguir. */
export const pastaDoAtleta = (academyId: string, athleteId: string) => `${academyId}/${athleteId}`;

/**
 * Esta chave é deste atleta, deste clube?
 *
 * É a pergunta que impede uma autorização de apontar a ficha de um atleta para
 * o ficheiro de outro — ou de outro clube. Exige o prefixo exacto e um nome de
 * ficheiro simples a seguir: nada de `..`, nada de mais pastas.
 */
export function chaveDoAtleta(key: unknown, academyId: string, athleteId: string): key is string {
  if (typeof key !== "string") return false;
  const prefixo = `${pastaDoAtleta(academyId, athleteId)}/`;
  if (!key.startsWith(prefixo)) return false;
  return /^[a-f0-9]{16}\.(jpg|png|webp|pdf|doc|docx)$/.test(key.slice(prefixo.length));
}

/** O tipo de um ficheiro, lido da extensão da chave — que fomos nós a escolher. */
export function tipoDaChave(key: string): string {
  const ext = key.slice(key.lastIndexOf("."));
  return Object.entries(DOC_TIPOS).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
}

/** O nome do documento, como o clube o escreveu — aparado e com tamanho. */
export function nomeDoDocumento(v: unknown): string {
  const nome = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!nome) throw new Error("Dá um nome ao documento");
  if (nome.length > DOC_MAX_NOME) throw new Error(`O nome tem de ter no máximo ${DOC_MAX_NOME} caracteres`);
  return nome;
}

/**
 * O nome de um ficheiro, para mostrar. Vem do computador de quem carregou, por
 * isso só fica o que é nome: sem caminho, sem caracteres de controlo.
 */
export function nomeDoFicheiro(v: unknown, key: string): string {
  const cru = typeof v === "string" ? v : "";
  const limpo = cru
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 160);
  return limpo || `ficheiro${key.slice(key.lastIndexOf("."))}`;
}

/** Os ficheiros guardados numa linha, lidos com desconfiança: é uma coluna JSON. */
export function ficheirosDe(json: unknown): FicheiroDoDocumento[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (f): f is FicheiroDoDocumento =>
      !!f && typeof f === "object" && typeof (f as FicheiroDoDocumento).key === "string" &&
      typeof (f as FicheiroDoDocumento).name === "string" && typeof (f as FicheiroDoDocumento).type === "string",
  );
}

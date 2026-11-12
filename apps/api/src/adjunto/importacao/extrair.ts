import { BadRequestException } from "@nestjs/common";
import * as XLSX from "xlsx";

/**
 * Ler o que o clube mandou: Excel, CSV, ou uma exportação de outro programa.
 *
 * ## O que sai daqui
 *
 * Folhas com cabeçalhos e linhas em bruto, e mais nada. Ninguém aqui sabe o
 * que é um atleta: isso é do mapeamento (`mapear.ts`), que decide o que cada
 * coluna é, e da transformação (`transformar.ts`), que aplica a decisão a
 * todas as linhas.
 *
 * ## O cabeçalho não é sempre a primeira linha
 *
 * Os clubes põem o nome do clube, a época e uma linha em branco em cima da
 * tabela. O cabeçalho é a primeira linha com duas ou mais células cheias em
 * que a maioria é texto; o que vem antes salta-se.
 *
 * ## Datas
 *
 * O Excel guarda datas como números. Com `cellDates` o SheetJS devolve-as como
 * `Date`, e aqui ficam `AAAA-MM-DD`: é a forma que a transformação reconhece
 * sem adivinhar se 03/04 é março ou abril. Datas escritas como texto ficam
 * como estão, e é o mapeamento que diz o formato.
 */

export type Celula = string | number | null;

export type Folha = {
  name: string;
  headers: string[];
  rows: Celula[][];
  /** A linha de cada `rows[i]` no ficheiro, como o Excel a numera: é o que a pessoa vê quando se diz "linha 8". */
  rowNumbers: number[];
  /** Quantas linhas ficaram de fora por o ficheiro passar do tecto. */
  cortadas: number;
};

export const MAX_LINHAS_POR_FOLHA = 3000;
export const MAX_COLUNAS = 60;
export const MAX_FOLHAS = 12;

const EXTENSOES_DE_FOLHA = new Set(["xlsx", "xlsm", "xls", "csv", "tsv", "ods", "txt"]);

export function tipoDoFicheiro(fileName: string, mime: string): "folha" | "imagem" | "pdf" | "desconhecido" {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (EXTENSOES_DE_FOLHA.has(ext) || mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") return "folha";
  if (mime.startsWith("image/")) return "imagem";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  return "desconhecido";
}

export function extrairFolhas(bytes: Buffer, fileName: string, mime: string): Folha[] {
  const tipo = tipoDoFicheiro(fileName, mime);
  if (tipo === "imagem" || tipo === "pdf") {
    throw new BadRequestException("Por agora o Assistente IA lê Excel e CSV. Fotografias de fichas e PDF vêm a seguir.");
  }
  if (tipo === "desconhecido") {
    throw new BadRequestException("Não reconheço este ficheiro. Manda um Excel (.xlsx) ou um CSV.");
  }

  let livro: XLSX.WorkBook;
  try {
    livro = XLSX.read(bytes, { type: "buffer", cellDates: true, raw: false, dense: false });
  } catch {
    throw new BadRequestException("Não consegui abrir o ficheiro. Está protegido por palavra-passe, ou não é um Excel válido?");
  }

  const folhas: Folha[] = [];
  for (const nome of livro.SheetNames.slice(0, MAX_FOLHAS)) {
    const ws = livro.Sheets[nome];
    if (!ws) continue;
    // `blankrows: true` para a numeração bater com a do Excel: as vazias saem depois, já contadas.
    const matriz = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true, blankrows: true });
    const folha = lerMatriz(nome, matriz);
    if (folha) folhas.push(folha);
  }
  if (folhas.length === 0) throw new BadRequestException("O ficheiro não tem nenhuma folha com dados.");
  return folhas;
}

function lerMatriz(nome: string, matriz: unknown[][]): Folha | null {
  const linhas = matriz.map((l) => (Array.isArray(l) ? l.slice(0, MAX_COLUNAS).map(normalizarCelula) : []));
  const indiceDoCabecalho = linhas.findIndex(pareceCabecalho);
  if (indiceDoCabecalho < 0) return null;

  const brutos = linhas[indiceDoCabecalho];
  const largura = Math.max(brutos.length, ...linhas.slice(indiceDoCabecalho + 1, indiceDoCabecalho + 50).map((l) => l.length));
  const headers = nomesDasColunas(brutos, largura);

  const corpo = linhas
    .slice(indiceDoCabecalho + 1)
    .map((l, i) => ({ n: indiceDoCabecalho + 1 + i + 1, c: Array.from({ length: largura }, (_, k) => l[k] ?? null) }))
    .filter((l) => l.c.some((c) => c !== null && c !== ""));
  if (corpo.length === 0) return null;

  const dentro = corpo.slice(0, MAX_LINHAS_POR_FOLHA);
  return {
    name: nome,
    headers,
    rows: dentro.map((l) => l.c),
    rowNumbers: dentro.map((l) => l.n),
    cortadas: Math.max(0, corpo.length - MAX_LINHAS_POR_FOLHA),
  };
}

function normalizarCelula(v: unknown): Celula {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // O Excel guarda o dia sem fuso; o SheetJS devolve-o à meia-noite local. O dia é o que interessa.
    const ano = v.getFullYear();
    const mes = String(v.getMonth() + 1).padStart(2, "0");
    const dia = String(v.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/** Duas ou mais células cheias, a maioria texto curto: é um cabeçalho. */
function pareceCabecalho(linha: Celula[]): boolean {
  const cheias = linha.filter((c) => c !== null && c !== "");
  if (cheias.length < 2) return false;
  const texto = cheias.filter((c) => typeof c === "string" && c.length <= 60 && !/^\d{4}-\d{2}-\d{2}$/.test(c));
  return texto.length >= Math.ceil(cheias.length * 0.6);
}

/** Cabeçalhos únicos e nunca vazios: a coluna sem nome fica "Coluna 7". */
function nomesDasColunas(brutos: Celula[], largura: number): string[] {
  const vistos = new Map<string, number>();
  return Array.from({ length: largura }, (_, i) => {
    const base = (brutos[i] === null || brutos[i] === "" ? `Coluna ${i + 1}` : String(brutos[i])).slice(0, 80);
    const n = vistos.get(base) ?? 0;
    vistos.set(base, n + 1);
    return n === 0 ? base : `${base} (${n + 1})`;
  });
}

/* -------------------------------------------------------------------------- */
/* Amostras mascaradas, para o modelo                                          */
/* -------------------------------------------------------------------------- */

/**
 * Cinco linhas por folha, com os valores mascarados **na forma**: o modelo só
 * precisa de ver que uma coluna tem nove algarismos para a reconhecer como
 * NIF, não precisa dos algarismos. Nomes ficam só com a primeira palavra e a
 * inicial da segunda ("Martim B."), datas e texto curto ficam como estão.
 */
export function amostraMascarada(folha: Folha, n = 5): Celula[][] {
  return folha.rows.slice(0, n).map((linha) => linha.map(mascarar));
}

export function mascarar(c: Celula): Celula {
  if (c === null) return null;
  if (typeof c === "number") {
    const s = String(c);
    return s.length >= 7 ? "#".repeat(s.length) : c;
  }
  const s = c.trim();
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(s)) return "x@x.pt";
  if (/^\+?[\d\s().-]{9,}$/.test(s) && s.replace(/\D/g, "").length >= 9) return s.replace(/\d/g, "#");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(s)) return s;
  if (/^\d+$/.test(s)) return s.length >= 7 ? "#".repeat(s.length) : s;
  // Um nome de pessoa: duas ou mais palavras com maiúscula inicial.
  const palavras = s.split(" ");
  if (palavras.length >= 2 && palavras.every((p) => /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(p) || /^(de|da|do|das|dos|e)$/i.test(p))) {
    return `${palavras[0]} ${palavras[palavras.length - 1][0]}.`;
  }
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
}

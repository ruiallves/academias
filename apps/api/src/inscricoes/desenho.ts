import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PDFFont, PDFPage } from "pdf-lib";

/**
 * As peças comuns aos boletins: escrever numa caixa, uma letra por casa,
 * marcar um quadrado, e ler o PDF da federação.
 */

export type Caixa = { x1: number; y1: number; x2: number; y2: number; casas?: number };

const modelos = new Map<string, Uint8Array>();

/**
 * O PDF de uma federação, lido uma vez.
 *
 * Vive em `apps/api/assets/`. A API compilada corre de `dist/inscricoes/` e os
 * testes de `scripts/`: procura-se nos dois sítios.
 */
export function bytesDoModelo(...partes: string[]): Uint8Array {
  const chave = partes.join("/");
  const lido = modelos.get(chave);
  if (lido) return lido;
  // `__dirname` não existe quando os testes correm isto como módulo ES.
  const aqui = typeof __dirname === "string" ? __dirname : null;
  const candidatos = [
    ...(aqui ? [resolve(aqui, "..", "..", "assets", ...partes)] : []),
    resolve(process.cwd(), "assets", ...partes),
    resolve(process.cwd(), "apps", "api", "assets", ...partes),
  ];
  const caminho = candidatos.find((c) => existsSync(c));
  if (!caminho) throw new Error(`O modelo ${chave} não está no servidor (assets)`);
  const bytes = new Uint8Array(readFileSync(caminho));
  modelos.set(chave, bytes);
  return bytes;
}

/* -------------------------------------------------------------------------- */
/* Desenho                                                                     */
/* -------------------------------------------------------------------------- */

/** Texto numa caixa, encolhido até caber, centrado na vertical. */
export function escrever(page: PDFPage, font: PDFFont, c: Caixa, v: string, max: number) {
  const s = codificavel(font, v);
  const largura = c.x2 - c.x1 - 3;
  let size = max;
  while (size > 5 && font.widthOfTextAtSize(s, size) > largura) size -= 0.5;
  const h = c.y2 - c.y1;
  page.drawText(s, { x: c.x1 + 1.5, y: c.y1 + (h - size * 0.72) / 2, size, font });
}

/**
 * Texto que tem de caber, seja qual for o comprimento: o nome de uma pessoa.
 *
 * `escrever` encolhe até 5 pontos e daí não passa, e um nome de seis apelidos
 * saía da linha por cima do texto impresso ao lado. Aqui, por esta ordem:
 *
 *  1. uma linha, de `max` até 6 pontos;
 *  2. duas linhas, partidas entre palavras pelo meio, até 3,5 pontos (duas
 *     linhas cabem na altura da caixa);
 *  3. uma linha do tamanho que couber, por pequeno que seja.
 *
 * Devolve o tamanho usado, para os testes.
 */
export function escreverQueCaiba(page: PDFPage, font: PDFFont, c: Caixa, v: string, max = 9): number {
  const s = codificavel(font, v);
  const largura = c.x2 - c.x1 - 3;
  const h = c.y2 - c.y1;
  const cabe = (t: string, size: number) => font.widthOfTextAtSize(t, size) <= largura;

  for (let size = max; size >= 6; size -= 0.5) {
    if (cabe(s, size)) {
      page.drawText(s, { x: c.x1 + 1.5, y: c.y1 + (h - size * 0.72) / 2, size, font });
      return size;
    }
  }

  const palavras = s.split(" ");
  if (palavras.length > 1) {
    // O corte que deixa as duas linhas mais parecidas em largura.
    let melhor: [string, string] = [s, ""];
    let diferenca = Infinity;
    for (let i = 1; i < palavras.length; i++) {
      const a = palavras.slice(0, i).join(" ");
      const b = palavras.slice(i).join(" ");
      const d = Math.abs(font.widthOfTextAtSize(a, 6) - font.widthOfTextAtSize(b, 6));
      if (d < diferenca) {
        diferenca = d;
        melhor = [a, b];
      }
    }
    for (let size = 6; size >= 3.5; size -= 0.25) {
      // A linha de baixo assenta acima do traço impresso; a de cima pode subir um pouco além da caixa.
      const entre = size * 1.05;
      const base = c.y1 + 3.2;
      if (cabe(melhor[0], size) && cabe(melhor[1], size) && 3.2 + entre + size * 0.72 <= h + 3) {
        page.drawText(melhor[0], { x: c.x1 + 1.5, y: base + entre, size, font });
        page.drawText(melhor[1], { x: c.x1 + 1.5, y: base, size, font });
        return size;
      }
    }
  }

  const size = Math.max(1, (largura / font.widthOfTextAtSize(s, 1)) * 0.98);
  page.drawText(s, { x: c.x1 + 1.5, y: c.y1 + (h - size * 0.72) / 2, size, font });
  return size;
}

/** Uma letra por casa, centrada em cada uma — os campos às casinhas do boletim. */
export function escreverEmCasas(page: PDFPage, font: PDFFont, c: Caixa, v: string) {
  const n = c.casas ?? v.length;
  const s = codificavel(font, v).slice(0, n);
  const casa = (c.x2 - c.x1) / n;
  const h = c.y2 - c.y1;
  const size = Math.min(9, h * 0.75);
  [...s].forEach((ch, i) => {
    const w = font.widthOfTextAtSize(ch, size);
    page.drawText(ch, { x: c.x1 + i * casa + (casa - w) / 2, y: c.y1 + (h - size * 0.72) / 2, size, font });
  });
}

export function marcar(page: PDFPage, font: PDFFont, c: Caixa) {
  const h = c.y2 - c.y1;
  const size = Math.min(10, h * 0.85);
  const w = font.widthOfTextAtSize("X", size);
  page.drawText("X", { x: c.x1 + (c.x2 - c.x1 - w) / 2, y: c.y1 + (h - size * 0.72) / 2, size, font });
}

/**
 * Só os caracteres que a letra do PDF tem.
 *
 * A Helvetica do PDF fala WinAnsi: tem os acentos portugueses, mas não um "ł"
 * ou um "ă". Esses perdem o acento em vez de rebentarem a folha inteira.
 */
export function codificavel(font: PDFFont, v: string): string {
  let out = "";
  for (const ch of v) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      const base = SEM_TRACO[ch] ?? ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      try {
        font.encodeText(base);
        out += base;
      } catch {
        out += "?";
      }
    }
  }
  return out;
}

/** As letras com traço, que a decomposição não separa. */
const SEM_TRACO: Record<string, string> = { "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ħ": "h", "Ħ": "H" };

export const maiusculas = (s: string) => s.toLocaleUpperCase("pt-PT");

/**
 * O nome em duas linhas de casas.
 *
 * Parte-se entre palavras: "MARIA DA CONCEIÇÃO" não fica "MARIA DA CONCE" numa
 * linha e "IÇÃO" na outra. Uma palavra maior do que a linha parte-se onde for.
 */
export function partirNome(nome: string, casas = 38): [string, string] {
  if (nome.length <= casas) return [nome, ""];
  const palavras = nome.split(" ");
  let l1 = "";
  let i = 0;
  while (i < palavras.length && (l1 ? l1.length + 1 : 0) + palavras[i].length <= casas) {
    l1 = l1 ? `${l1} ${palavras[i]}` : palavras[i];
    i++;
  }
  if (!l1) return [nome.slice(0, casas), nome.slice(casas, casas * 2)];
  return [l1, palavras.slice(i).join(" ").slice(0, casas)];
}

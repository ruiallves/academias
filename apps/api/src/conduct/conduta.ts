import type { ConductReportCategory, ConductReportStatus } from "@prisma/client";
import { DOC_TIPOS } from "../academy/ficha-do-atleta";

/**
 * As regras do canal de denúncia e dos documentos de conduta, sem base de
 * dados: o que é um pedido válido, os textos de cada categoria e estado, e as
 * chaves dos ficheiros. Quem lê e grava é `ConductService`.
 */

/** As categorias, com o nome que a app e a consola mostram. */
export const CATEGORIAS: Record<ConductReportCategory, string> = {
  BULLYING: "Bullying",
  ETHICS: "Falta de ética ou de conduta",
  DISCRIMINATION: "Discriminação",
  SAFETY: "Segurança",
  OTHER: "Outra situação",
};

export const ESTADOS: Record<ConductReportStatus, string> = {
  NEW: "Nova",
  IN_REVIEW: "Em análise",
  RESOLVED: "Resolvida",
  ARCHIVED: "Arquivada",
};

export const DESCRICAO_MIN = 20;
export const DESCRICAO_MAX = 5000;
export const MENSAGEM_MAX = 3000;
export const TEXTO_CURTO_MAX = 200;

export type DenunciaLimpa = {
  category: ConductReportCategory;
  anonymous: boolean;
  athleteId: string | null;
  happenedOn: Date | null;
  place: string | null;
  involved: string | null;
  description: string;
};

const texto = (v: unknown, campo: string, max: number): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new Error(`${campo} tem de ser texto`);
  const limpo = v.replace(/\r\n/g, "\n").trim();
  if (limpo.length > max) throw new Error(`${campo} tem de ter no máximo ${max} caracteres`);
  return limpo || null;
};

/** `AAAA-MM-DD`, até hoje: um incidente não acontece no futuro. */
function diaPassado(v: unknown, hoje: Date): Date | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("A data tem de ser um dia (AAAA-MM-DD)");
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error("A data não existe");
  const limite = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
  if (d.getTime() > limite.getTime()) throw new Error("A data não pode ser no futuro");
  return d;
}

export function limparDenuncia(dto: Record<string, unknown>, hoje = new Date()): DenunciaLimpa {
  const category = dto.category;
  if (typeof category !== "string" || !(category in CATEGORIAS)) throw new Error("Escolhe o tipo de situação");

  const description = texto(dto.description, "A descrição", DESCRICAO_MAX);
  if (!description) throw new Error("Conta o que aconteceu");
  if (description.length < DESCRICAO_MIN) {
    throw new Error(`Conta um pouco mais: pelo menos ${DESCRICAO_MIN} caracteres`);
  }

  const athleteId = dto.athleteId === undefined || dto.athleteId === null || dto.athleteId === "" ? null : dto.athleteId;
  if (athleteId !== null && typeof athleteId !== "string") throw new Error("Educando inválido");

  return {
    category: category as ConductReportCategory,
    anonymous: dto.anonymous === true,
    athleteId,
    happenedOn: diaPassado(dto.happenedOn, hoje),
    place: texto(dto.place, "O local", TEXTO_CURTO_MAX),
    involved: texto(dto.involved, "Quem esteve envolvido", TEXTO_CURTO_MAX),
    description,
  };
}

export function limparMensagem(v: unknown): string {
  const body = texto(v, "A mensagem", MENSAGEM_MAX);
  if (!body) throw new Error("Escreve a mensagem");
  return body;
}

export function limparTituloDoDocumento(v: unknown): string {
  const t = texto(v, "O título", 120)?.replace(/\s+/g, " ") ?? null;
  if (!t) throw new Error("Dá um título ao documento");
  return t;
}

export const limparDescricaoDoDocumento = (v: unknown) => texto(v, "A descrição", 400);

/* -------------------------------------------------------------------------- */
/* Os ficheiros dos documentos de conduta                                      */
/* -------------------------------------------------------------------------- */

/** Dentro da pasta do clube, para o espaço usado contar (`app.storage_by_academy`). */
export const pastaDeConduta = (academyId: string) => `${academyId}/conduta`;

export function chaveDeConduta(key: unknown, academyId: string): key is string {
  if (typeof key !== "string") return false;
  const prefixo = `${pastaDeConduta(academyId)}/`;
  if (!key.startsWith(prefixo)) return false;
  const exts = Object.values(DOC_TIPOS).map((e) => e.slice(1)).join("|");
  return new RegExp(`^[a-f0-9]{16}\\.(${exts})$`).test(key.slice(prefixo.length));
}

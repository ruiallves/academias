/**
 * Os anexos de um aviso do clube.
 *
 * Os mesmos ficheiros e as mesmas regras dos documentos do atleta (`DOC_TIPOS`,
 * 20 MB, 10 por aviso), noutra pasta do clube. Dentro de `{academyId}/` para o
 * espaço usado contar (`app.storage_by_academy`).
 */
import { DOC_TIPOS, DOCUMENT_BUCKET, ficheirosDe, type FicheiroDoDocumento } from "./ficha-do-atleta";
import type { ScopedClient } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";

export const AVISO_MAX_ANEXOS = 10;

/**
 * 50 MB por anexo, mais do que os 20 MB dos documentos do atleta: um aviso leva
 * o regulamento do torneio inteiro ou um cartaz em alta resolução. O bucket sobe
 * para este limite sozinho (`StorageService.ensureBucket`).
 */
export const AVISO_MAX_BYTES = 50 * 1024 * 1024;

/** Os links valem uma hora: um aviso lê-se com calma, e a lista volta a pedi-los. */
export const AVISO_ANEXO_TTL = 3600;

export const pastaDosAvisos = (academyId: string) => `${academyId}/comunicacoes`;

/** Esta chave é um anexo de aviso deste clube? Prefixo exacto e nome simples, sem `..`. */
export function chaveDeAviso(key: unknown, academyId: string): key is string {
  if (typeof key !== "string") return false;
  const prefixo = `${pastaDosAvisos(academyId)}/`;
  if (!key.startsWith(prefixo)) return false;
  const exts = Object.values(DOC_TIPOS).map((e) => e.slice(1)).join("|");
  return new RegExp(`^[a-f0-9]{16}\\.(${exts})$`).test(key.slice(prefixo.length));
}

export type AnexoComLink = FicheiroDoDocumento & { url: string | null };

/** Junta a cada anexo um link de leitura, que nunca se grava. */
export function assinarAnexos(storage: StorageService, json: unknown): Promise<AnexoComLink[]> {
  return Promise.all(
    ficheirosDe(json).map(async (f) => ({ ...f, url: await storage.signDownload(DOCUMENT_BUCKET, f.key, AVISO_ANEXO_TTL) })),
  );
}

/**
 * Os anexos dos avisos a que estas notificações apontam, por id do aviso.
 *
 * A notificação guarda só `announcementId`; os ficheiros lêem-se do aviso. Assim
 * um anexo acrescentado ou tirado depois de publicar aparece (ou some) na app de
 * quem já recebeu, como o texto corrigido.
 *
 * Só lê a base: corre dentro do `runAs`. Os links assinam-se depois, fora da
 * transação, com `assinarAnexosDosAvisos` (HTTP nunca entra num `runAs`).
 */
export async function anexosDasNotificacoes(
  db: ScopedClient,
  rows: { payload: unknown }[],
): Promise<Map<string, FicheiroDoDocumento[]>> {
  const ids = [...new Set(rows.map((n) => avisoDaNotificacao(n.payload)).filter((v): v is string => v !== null))];
  if (ids.length === 0) return new Map();
  const avisos = await db.announcement.findMany({ where: { id: { in: ids } }, select: { id: true, files: true } });
  const out = new Map<string, FicheiroDoDocumento[]>();
  for (const a of avisos) {
    const files = ficheirosDe(a.files);
    if (files.length > 0) out.set(a.id, files);
  }
  return out;
}

export async function assinarAnexosDosAvisos(
  storage: StorageService,
  porAviso: Map<string, FicheiroDoDocumento[]>,
): Promise<Map<string, AnexoComLink[]>> {
  const out = new Map<string, AnexoComLink[]>();
  for (const [id, files] of porAviso) out.set(id, await assinarAnexos(storage, files));
  return out;
}

/** O id do aviso de uma notificação, se for de um aviso. */
export const avisoDaNotificacao = (payload: unknown): string | null => {
  const v = (payload as { announcementId?: unknown } | null)?.announcementId;
  return typeof v === "string" ? v : null;
};

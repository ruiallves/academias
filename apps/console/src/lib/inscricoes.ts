import { apiGet, apiPatch, apiPost } from "@/lib/http";
import { erroAvisado } from "@/lib/avisos";

/**
 * Inscrições federativas (Modelo 2 da FPF, Modelo 1 da FPB): os tipos, os
 * pedidos e o vocabulário.
 *
 * O servidor decide tudo o que vai na folha (`inscricoes/regras.ts` na API);
 * aqui só se mostra e se pede.
 */

export type Estado = "GENERATED" | "SIGNED" | "SUBMITTED" | "DONE";
export type Passo = "PENDING" | Estado;
export type Tipo = "FIRST" | "RENEWAL" | "TRANSFER_NATIONAL" | "TRANSFER_INTERNATIONAL";
export type Federacao = "FPF" | "FPB";

/** O boletim da FPB só tem primeira inscrição e revalidação. Gémeo de `tiposDa` na API. */
export const tiposDa = (f: Federacao): Tipo[] =>
  f === "FPB" ? ["FIRST", "RENEWAL"] : ["FIRST", "RENEWAL", "TRANSFER_NATIONAL", "TRANSFER_INTERNATIONAL"];

export type Inscricao = {
  id: string;
  status: Estado;
  kind: Tipo;
  category: string;
  generatedAt: string;
  generatedByName: string | null;
  signedAt: string | null;
  submittedAt: string | null;
  doneAt: string | null;
  documentId: string | null;
};

export type Linha = {
  athleteId: string;
  name: string;
  birthdate: string;
  sportId: string;
  /** FPF (futebol e futsal) ou FPB (basquetebol): decide o boletim, os escalões e os tipos. */
  federation: Federacao;
  teams: { id: string; name: string }[];
  category: string;
  categoryLabel: string;
  kind: Tipo;
  license: string | null;
  missing: string[];
  registration: Inscricao | null;
};

export type Lista = {
  available: boolean;
  reason?: string;
  canWrite: boolean;
  seasons: { id: string; label: string }[];
  season: { id: string; label: string } | null;
  /** O que falta ao clube em todas as modalidades: a associação, em Definições → Geral. */
  club: { association: string | null; missing: string[] };
  /** Cada modalidade com boletim, a sua federação e o que falta ao clube nela (código, seguro). */
  sports: { id: string; name: string; discipline: "football" | "futsal" | "basketball"; federation: Federacao; missing: string[] }[];
  rows: Linha[];
};

export const PASSOS: { key: Passo; label: string; curto: string }[] = [
  { key: "PENDING", label: "Por gerar", curto: "Por gerar" },
  { key: "GENERATED", label: "Folha gerada", curto: "Gerada" },
  { key: "SIGNED", label: "Assinada pelos pais", curto: "Assinada" },
  { key: "SUBMITTED", label: "Entregue na associação", curto: "Entregue" },
  { key: "DONE", label: "Validada", curto: "Validada" },
];

export const passoDe = (l: Linha): Passo => l.registration?.status ?? "PENDING";
export const indiceDoPasso = (p: Passo) => PASSOS.findIndex((x) => x.key === p);

export const TIPOS: { key: Tipo; label: string }[] = [
  { key: "FIRST", label: "Primeira inscrição" },
  { key: "RENEWAL", label: "Revalidação" },
  { key: "TRANSFER_NATIONAL", label: "Transferência nacional" },
  { key: "TRANSFER_INTERNATIONAL", label: "Transferência internacional" },
];
export const nomeDoTipo = (t: Tipo) => TIPOS.find((x) => x.key === t)?.label ?? t;


/** A data em que a inscrição chegou a este passo. */
export function dataDoPasso(r: Inscricao | null, p: Passo): string | null {
  if (!r) return null;
  return { PENDING: null, GENERATED: r.generatedAt, SIGNED: r.signedAt, SUBMITTED: r.submittedAt, DONE: r.doneAt }[p];
}

/* -------------------------------------------------------------------------- */

export const getInscricoes = (seasonId?: string) => apiGet<Lista>("/api/inscricoes", { seasonId });

export type ItemParaGerar = { athleteId: string; sportId: string; kind?: Tipo; category?: string };

export async function gerarFolhas(p: { seasonId: string; items: ItemParaGerar[]; attach: boolean; register: boolean }) {
  const r = await apiPost<{ filename: string; pdf: string; count: number }>("/api/inscricoes/gerar", p);
  return r;
}

/**
 * Põe as inscrições destes jogadores num passo qualquer. `PENDING` retira-as
 * (volta a "por gerar"); um jogador por gerar que vá para um passo à frente
 * ganha a inscrição já nesse passo.
 */
export const mudarEstado = (seasonId: string, linhas: Pick<Linha, "athleteId" | "sportId">[], status: Passo, license?: string) =>
  apiPatch<{ ok: true; count: number }>("/api/inscricoes/estado", {
    seasonId,
    items: linhas.map((l) => ({ athleteId: l.athleteId, sportId: l.sportId })),
    status,
    ...(license ? { license } : {}),
  });

/** A folha assinada: autorizar, carregar direto para o armazenamento, confirmar. */
export async function carregarAssinada(id: string, file: File): Promise<void> {
  const { url, token, key, maxBytes } = await apiPost<{ url: string; token: string; key: string; maxBytes: number }>(
    `/api/inscricoes/${id}/assinada/upload`,
    { contentType: file.type },
  );
  if (file.size > maxBytes) throw erroAvisado("O ficheiro passa dos 20 MB.");
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type, Authorization: `Bearer ${token}` },
    body: file,
  });
  // Directo ao armazenamento, fora do cliente HTTP: avisa-se aqui.
  if (!res.ok) throw erroAvisado("O carregamento falhou. Tenta outra vez.");
  await apiPost(`/api/inscricoes/${id}/assinada`, { key, name: file.name });
}

/**
 * O PDF que veio em base64: descarrega-o, ou mostra-o num separador.
 *
 * O separador abre-se **antes** do pedido, no clique (`separador`): aberto
 * depois de esperar pelo servidor, o browser trata-o como janela não pedida e
 * bloqueia-o.
 */
export function entregarPdf(base64: string, filename: string, separador?: Window | null): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  if (separador) {
    separador.location.href = url;
    // O separador novo precisa do endereço enquanto carrega.
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

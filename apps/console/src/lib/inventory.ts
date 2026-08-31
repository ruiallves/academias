import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/http";

/**
 * O armazém do clube, do lado do cliente.
 *
 * Tipos e chamadas, sem estado: o inventário muda a cada entrega, e uma cópia
 * local seria uma cópia desactualizada — as páginas lêem quando abrem e voltam
 * a ler depois de escrever. Ao contrário do plantel ou do calendário, que a
 * `store` guarda porque toda a aplicação os usa, isto vive em quatro páginas.
 *
 * O **disponível vem calculado do servidor** (`total − atribuído`). Não se
 * recalcula aqui: dois sítios a fazer a mesma conta é um sítio a mais para ela
 * ficar diferente.
 */

export type StockStatus = "ok" | "low" | "out";

export const STATUS_LABEL: Record<StockStatus, string> = {
  ok: "Disponível",
  low: "Stock baixo",
  out: "Esgotado",
};

/** As mesmas tintas do resto da consola: risco a vermelho, aviso a âmbar. */
export const STATUS_TONE: Record<StockStatus, "ok" | "warn" | "risk"> = {
  ok: "ok",
  low: "warn",
  out: "risk",
};

export type MovementType = "ENTRY" | "EXIT" | "ADJUSTMENT" | "ASSIGNMENT" | "RETURN" | "DAMAGE" | "LOSS";

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  ENTRY: "Entrada",
  EXIT: "Saída",
  ADJUSTMENT: "Ajuste",
  ASSIGNMENT: "Entrega",
  RETURN: "Devolução",
  DAMAGE: "Danificado",
  LOSS: "Perdido",
};

/**
 * O sinal com que cada movimento se lê no histórico.
 *
 * Uma entrada e uma devolução somam à prateleira; uma entrega e uma saída
 * tiram. O ajuste não tem sinal — é uma correcção, e dizer "+2" a uma contagem
 * seria inventar uma direcção que quem contou não deu.
 */
export const MOVEMENT_SIGN: Record<MovementType, "+" | "−" | ""> = {
  ENTRY: "+",
  RETURN: "+",
  EXIT: "−",
  ASSIGNMENT: "−",
  DAMAGE: "−",
  LOSS: "−",
  ADJUSTMENT: "",
};

export type AssignmentStatus = "ACTIVE" | "RETURNED" | "DAMAGED" | "LOST";

export const ASSIGNMENT_LABEL: Record<AssignmentStatus, string> = {
  ACTIVE: "Entregue",
  RETURNED: "Devolvido",
  DAMAGED: "Danificado",
  LOST: "Perdido",
};

export type Variant = {
  id: string;
  label: string;
  sku: string | null;
  order: number;
  /** O mínimo efectivo — o da variante, ou o do artigo quando ela não tem. */
  minimumStock: number;
  /** O próprio, quando definido. Nulo = herda do artigo. */
  ownMinimum: number | null;
  total: number;
  assigned: number;
  available: number;
  damaged: number;
  lost: number;
  status: StockStatus;
};

export type Item = {
  id: string;
  name: string;
  sku: string | null;
  brand: string | null;
  description: string | null;
  minimumStock: number;
  category: { id: string; label: string } | null;
  variants: Variant[];
  /** A primeira fotografia, assinada — a miniatura da lista. */
  thumbnail?: string | null;
  total: number;
  assigned: number;
  available: number;
  status: StockStatus;
};

export type Movement = {
  id: string;
  type: MovementType;
  quantity: number;
  reason: string | null;
  at: string;
  variantId?: string;
  variantLabel: string;
  itemId?: string;
  itemName?: string;
  athleteId: string | null;
  athleteName: string | null;
  by: string | null;
};

export type ItemDetail = Item & {
  notes: string | null;
  movements: Movement[];
  /** Links assinados, gerados na leitura. Ver `INVENTORY_BUCKET` no servidor. */
  images: { key: string; url: string }[];
};

/** Uma linha da folha de material, já traduzida para o que a API conhece. */
export type ImportRow = {
  line: number;
  name: string;
  size?: string;
  quantity?: number;
  category?: string;
  brand?: string;
  sku?: string;
  minimumStock?: number;
};

export type ImportResult = {
  ok: boolean;
  created: number;
  updated: number;
  problems: { line: number; reason: string }[];
};

export type Assignment = {
  id: string;
  quantity: number;
  status: AssignmentStatus;
  assignedAt: string;
  returnedAt: string | null;
  notes: string | null;
  athleteId: string;
  athleteName: string;
  teamId: string | null;
  teamName: string | null;
  variantId: string;
  variantLabel: string;
  itemId: string;
  itemName: string;
  assignedBy: string | null;
  returnedBy: string | null;
};

export type Overview = {
  artigos: number;
  unidades: number;
  atribuidas: number;
  disponiveis: number;
  stockBaixo: number;
  danificadas: number;
  perdidas: number;
};

/* -------------------------------------------------------------------------- */

export const getOverview = () => apiGet<Overview>("/api/inventory/overview");

export const listItems = (params: { q?: string; categoryId?: string; status?: string } = {}) =>
  apiGet<Item[]>("/api/inventory/items", params);

export const getItem = (id: string) => apiGet<ItemDetail>(`/api/inventory/items/${id}`);

/**
 * O que o servidor responde ao registar um artigo.
 *
 * `ok: false` com `conflict` não é um erro: é a pergunta "já existe um artigo
 * com este nome — juntar ou criar outro?". Nada foi escrito, e a resposta volta
 * em `onConflict`. Ver `createItem` no servidor.
 */
export type CreateItemResult =
  | { ok: true; id: string; sku?: string; merged: boolean }
  | { ok: false; conflict: { id: string; name: string; sku: string | null } };

export const createItem = (body: Record<string, unknown>) =>
  apiPost<CreateItemResult>("/api/inventory/items", body);

export const updateItem = (id: string, body: Record<string, unknown>) =>
  apiPatch<{ ok: true }>(`/api/inventory/items/${id}`, body);

/** Sai das listas, o histórico fica. O caminho normal. */
export const archiveItem = (id: string) => apiDelete<{ ok: true }>(`/api/inventory/items/${id}`);

/**
 * Apagar a sério — o artigo, os tamanhos e o histórico.
 *
 * Rota própria e não uma variante do arquivar: são decisões diferentes, e um
 * corpo que decide entre as duas é um corpo que um dia chega mal preenchido e
 * apaga o que era para guardar. Exige o nome escrito à mão.
 */
export const deleteItem = (id: string, confirmName: string) =>
  apiDelete<{ ok: true; name: string; tamanhos: number; movimentos: number; entregas: number }>(
    `/api/inventory/items/${id}/definitivo`,
    { confirmName },
  );

export const addVariant = (itemId: string, body: Record<string, unknown>) =>
  apiPost<{ id: string }>(`/api/inventory/items/${itemId}/variants`, body);

export const updateVariant = (id: string, body: Record<string, unknown>) =>
  apiPatch<{ ok: true }>(`/api/inventory/variants/${id}`, body);

/** Entrada, saída ou correcção de contagem. Ver `moveStock` no servidor. */
export const moveStock = (variantId: string, body: { type: string; quantity: number; reason?: string }) =>
  apiPost<{ ok: true; total: number; available: number }>(`/api/inventory/variants/${variantId}/stock`, body);

export const listAssignments = (params: { teamId?: string; athleteId?: string; itemId?: string; status?: string } = {}) =>
  apiGet<Assignment[]>("/api/inventory/assignments", params);

export const assign = (body: { athleteId: string; variantId: string; quantity: number; notes?: string }) =>
  apiPost<{ id: string; athleteName: string; itemName: string; variantLabel: string }>("/api/inventory/assignments", body);

export const returnAssignment = (id: string, body: { condition: string; quantity?: number; notes?: string }) =>
  apiPost<{ ok: true; status: AssignmentStatus }>(`/api/inventory/assignments/${id}/return`, body);

export const listMovements = (params: { itemId?: string } = {}) =>
  apiGet<Movement[]>("/api/inventory/movements", params);

export const importItems = (rows: ImportRow[]) => apiPost<ImportResult>("/api/inventory/import", { rows });

/* ---------------------------------------------------------------- fotos --- */

/**
 * Carregar uma fotografia, em três passos.
 *
 * O ficheiro vai **direto do browser** para o armazenamento — nunca passa pela
 * nossa API. É o mesmo caminho das fotografias de atleta: oito megabytes a
 * atravessar o servidor são oito megabytes que ele não tem para mais ninguém.
 */
export async function uploadItemImage(itemId: string, file: File): Promise<{ key: string; url: string }> {
  const autorizacao = await apiPost<{ url: string; headers?: Record<string, string>; key: string; maxBytes: number }>(
    `/api/inventory/items/${itemId}/imagens/url`,
    { contentType: file.type },
  );

  if (file.size > autorizacao.maxBytes) {
    throw new Error(`A imagem tem mais de ${Math.round(autorizacao.maxBytes / 1024 / 1024)} MB`);
  }

  const r = await fetch(autorizacao.url, {
    method: "PUT",
    headers: { "Content-Type": file.type, ...(autorizacao.headers ?? {}) },
    body: file,
  });
  if (!r.ok) throw new Error("Não foi possível carregar a imagem");

  return apiPost<{ key: string; url: string }>(`/api/inventory/items/${itemId}/imagens`, { key: autorizacao.key });
}

export const removeItemImage = (itemId: string, key: string) =>
  apiDelete<{ ok: true }>(`/api/inventory/items/${itemId}/imagens`, { key });

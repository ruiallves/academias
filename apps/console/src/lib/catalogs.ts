import { useSyncExternalStore } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/http";

/**
 * Catálogos da academia.
 *
 * Tudo o que aparece num menu suspenso e varia de academia para academia vive aqui,
 * num sítio só. A alternativa — listas espalhadas por diálogos — é a razão pela qual
 * software deste tipo acaba com "Pavilhão", "pavilhao" e "Pav. Municipal" a
 * coexistirem na mesma base de dados.
 *
 * Duas regras que valem para todos:
 *
 *  1. **A ordem é dados.** "Sub-9, Sub-11, Sub-13" não sai de uma ordenação
 *     alfabética nem numérica — sai da ordem que o diretor definiu.
 *  2. **Um item em uso arquiva-se, não se apaga.** Apagar "Campo 2" reescreveria o
 *     local de todos os treinos que lá aconteceram. Arquivar tira-o dos menus e
 *     deixa a história intacta.
 *
 * ## Isto já não vive no browser
 *
 * Vivia, e não funcionava: um diretor acrescentava "Campo 3", marcava um treino
 * lá, recarregava a página e o campo tinha desaparecido — e nenhum outro
 * utilizador da academia chegou sequer a vê-lo. Configuração que não sai do
 * separador não é configuração.
 *
 * Agora vem de `GET /api/catalogs` e cada alteração escreve no servidor. O estado
 * local continua a existir porque é ele que faz os menus redesenharem-se no
 * instante em que algo muda — mas é uma **cópia**, não a verdade: cada escrita
 * relê, e se o servidor recusar (um duplicado, uma permissão em falta) é a versão
 * de lá que fica.
 */

export type CatalogKey = "venues" | "dressingRooms" | "ageGroups" | "staffTitles" | "eventTypes";

export const CATALOG_KEYS: CatalogKey[] = ["venues", "dressingRooms", "ageGroups", "staffTitles", "eventTypes"];

export type CatalogItem = {
  id: string;
  label: string;
  /** Morada, notas, o que a academia precise. Opcional de propósito. */
  note?: string;
  archived?: boolean;
  /** Itens do sistema não se apagam nem renomeiam: o domínio depende deles. */
  system?: boolean;
};

export const CATALOG_META: Record<CatalogKey, { title: string; hint: string; placeholder: string; noteLabel?: string }> = {
  venues: {
    title: "Locais",
    hint: "onde a academia treina e joga",
    placeholder: "Campo 3, Piscina do Sameiro…",
    noteLabel: "Morada ou nota",
  },
  dressingRooms: {
    title: "Balneários",
    hint: "onde as equipas se equipam",
    placeholder: "Balneário 3, Balneário visitantes…",
    noteLabel: "Onde fica",
  },
  ageGroups: {
    title: "Escalões",
    hint: "pela ordem em que devem aparecer",
    placeholder: "Sub-17, Seniores…",
    noteLabel: "Anos de nascimento",
  },
  staffTitles: {
    title: "Cargos da equipa técnica",
    hint: "usados nas equipas",
    placeholder: "Treinador de guarda-redes…",
  },
  eventTypes: {
    title: "Tipos de evento",
    hint: "no calendário",
    placeholder: "Estágio, Prova, Reunião de pais…",
  },
};

/* -------------------------------------------------------------------------- */
/* Estado — cópia local do que o servidor tem                                  */
/* -------------------------------------------------------------------------- */

type ApiItem = {
  id: string;
  kind: CatalogKey;
  label: string;
  note: string | null;
  order: number;
  isSystem: boolean;
  archivedAt: string | null;
};

const EMPTY: Record<CatalogKey, CatalogItem[]> = {
  venues: [],
  dressingRooms: [],
  ageGroups: [],
  staffTitles: [],
  eventTypes: [],
};

let state: Record<CatalogKey, CatalogItem[]> = { ...EMPTY };
let loaded = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => state;

/**
 * Traz os catálogos do servidor.
 *
 * Chamado uma vez no arranque, com o resto da academia. Partilha o pedido em
 * curso: dois ecrãs a montar ao mesmo tempo não pedem duas vezes.
 */
let pending: Promise<void> | null = null;

export function loadCatalogs(force = false): Promise<void> {
  if (loaded && !force) return Promise.resolve();
  pending ??= apiGet<ApiItem[]>("/api/catalogs")
    .then((rows) => {
      const next = { ...EMPTY };
      for (const key of CATALOG_KEYS) next[key] = [];
      for (const r of rows) {
        if (!next[r.kind]) continue;
        next[r.kind].push({
          id: r.id,
          label: r.label,
          note: r.note ?? undefined,
          archived: r.archivedAt !== null,
          system: r.isSystem,
        });
      }
      state = next;
      loaded = true;
      emit();
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function catalogsReady(): boolean {
  return loaded;
}

/* -------------------------------------------------------------------------- */
/* Operações                                                                   */
/* -------------------------------------------------------------------------- */
//
// Todas escrevem no servidor e relêem. Não há actualização optimista: um catálogo
// que aparecesse na lista e desaparecesse meio segundo depois — porque o servidor
// recusou um duplicado — é pior do que meio segundo de espera. E são acções raras:
// ninguém cria vinte locais seguidos.

export async function addItem(key: CatalogKey, label: string, note?: string): Promise<void> {
  const clean = label.trim();
  if (!clean) return;
  await apiPost("/api/catalogs", { kind: key, label: clean, ...(note?.trim() ? { note: note.trim() } : {}) });
  await loadCatalogs(true);
}

export async function renameItem(_key: CatalogKey, id: string, label: string, note?: string): Promise<void> {
  await apiPatch(`/api/catalogs/${id}`, { label: label.trim(), note: note?.trim() ?? "" });
  await loadCatalogs(true);
}

/** Arquivar tira dos menus; restaurar devolve. Nunca se perde história. */
export async function toggleArchived(key: CatalogKey, id: string): Promise<void> {
  const item = state[key].find((i) => i.id === id);
  await apiPatch(`/api/catalogs/${id}`, { archived: !item?.archived });
  await loadCatalogs(true);
}

export async function deleteItem(_key: CatalogKey, id: string): Promise<void> {
  await apiDelete(`/api/catalogs/${id}`);
  await loadCatalogs(true);
}

/**
 * Subir e descer.
 *
 * A ordem é dados e é do servidor: trocam-se as duas posições e gravam-se as duas.
 * Guardar só a que se moveu deixaria duas linhas com o mesmo número e uma lista que
 * muda de ordem sozinha ao recarregar.
 */
export async function moveItem(key: CatalogKey, id: string, direction: -1 | 1): Promise<void> {
  const items = state[key];
  const from = items.findIndex((i) => i.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= items.length) return;

  await Promise.all([
    apiPatch(`/api/catalogs/${items[from].id}`, { order: to }),
    apiPatch(`/api/catalogs/${items[to].id}`, { order: from }),
  ]);
  await loadCatalogs(true);
}

/* -------------------------------------------------------------------------- */
/* Leitura                                                                     */
/* -------------------------------------------------------------------------- */

/** Todos os itens, incluindo arquivados — para o ecrã de definições. */
export function useCatalog(key: CatalogKey): CatalogItem[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)[key];
}

/** Só os activos — para os menus suspensos de quem está a trabalhar. */
export function useActiveCatalog(key: CatalogKey): CatalogItem[] {
  return useCatalog(key).filter((i) => !i.archived);
}

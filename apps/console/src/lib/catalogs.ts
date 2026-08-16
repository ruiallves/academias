import { useSyncExternalStore } from "react";

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
 */

export type CatalogKey = "venues" | "ageGroups" | "staffTitles" | "eventTypes";

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
/* Estado                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Os quatro tipos de evento base são `system`: o domínio distingue-os. Um treino
 * abre folha de presenças, um jogo tem adversário e resultado. Uma academia pode
 * acrescentar quantos quiser, mas não pode apagar aqueles de que o produto depende.
 */
const SEED: Record<CatalogKey, CatalogItem[]> = {
  venues: [
    { id: "v1", label: "Campo 1", note: "Relvado sintético · Rua do Carvalhal" },
    { id: "v2", label: "Campo 2", note: "Relvado sintético · Rua do Carvalhal" },
    { id: "v3", label: "Pavilhão", note: "Piso interior · Complexo da Rodovia" },
    { id: "v4", label: "Piscina municipal", note: "25 m · Parque da Ponte" },
    { id: "v5", label: "Sede", note: "Reuniões e formação" },
  ],
  ageGroups: [
    { id: "g1", label: "Sub-9", note: "2017–2018" },
    { id: "g2", label: "Sub-11", note: "2015–2016" },
    { id: "g3", label: "Sub-12", note: "2014–2015" },
    { id: "g4", label: "Sub-13", note: "2013–2014" },
    { id: "g5", label: "Sub-14", note: "2012–2013" },
    { id: "g6", label: "Sub-15", note: "2011–2012" },
    { id: "g7", label: "6–9 anos" },
    { id: "g8", label: "10–14 anos" },
  ],
  staffTitles: [
    { id: "s1", label: "Treinador principal" },
    { id: "s2", label: "Treinador adjunto" },
    { id: "s3", label: "Coordenador" },
  ],
  eventTypes: [
    { id: "training", label: "Treino", system: true },
    { id: "match", label: "Jogo", system: true },
    { id: "tournament", label: "Torneio", system: true },
    { id: "other", label: "Evento", system: true },
  ],
};

let state: Record<CatalogKey, CatalogItem[]> = structuredClone(SEED);
const listeners = new Set<() => void>();

function commit(key: CatalogKey, items: CatalogItem[]) {
  state = { ...state, [key]: items };
  listeners.forEach((l) => l());
}

/* -------------------------------------------------------------------------- */
/* Operações                                                                   */
/* -------------------------------------------------------------------------- */

export function addItem(key: CatalogKey, label: string, note?: string) {
  const clean = label.trim();
  if (!clean) return;
  // Duplicados são o problema que este catálogo existe para resolver.
  if (state[key].some((i) => i.label.toLowerCase() === clean.toLowerCase())) return;
  commit(key, [...state[key], { id: `${key}_${Date.now().toString(36)}`, label: clean, note: note?.trim() || undefined }]);
}

export function renameItem(key: CatalogKey, id: string, label: string, note?: string) {
  commit(
    key,
    state[key].map((i) =>
      i.id === id && !i.system ? { ...i, label: label.trim() || i.label, note: note?.trim() || undefined } : i,
    ),
  );
}

/** Arquivar tira dos menus; restaurar devolve. Nunca se perde história. */
export function toggleArchived(key: CatalogKey, id: string) {
  commit(key, state[key].map((i) => (i.id === id ? { ...i, archived: !i.archived } : i)));
}

/**
 * Só faz sentido em itens nunca usados. A UI da consola não oferece este botão —
 * "nunca usado" só se sabe com a certeza a sério quando há uma base de dados a
 * perguntar; aqui fica pronto para o dia em que `apps/api` responder a essa
 * pergunta. Até lá, arquivar é o único caminho visível.
 */
export function deleteItem(key: CatalogKey, id: string) {
  commit(key, state[key].filter((i) => i.id !== id));
}

export function moveItem(key: CatalogKey, id: string, direction: -1 | 1) {
  const items = [...state[key]];
  const from = items.findIndex((i) => i.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= items.length) return;
  [items[from], items[to]] = [items[to], items[from]];
  commit(key, items);
}

/* -------------------------------------------------------------------------- */
/* Leitura                                                                     */
/* -------------------------------------------------------------------------- */

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => state;

/** Todos os itens, incluindo arquivados — para o ecrã de definições. */
export function useCatalog(key: CatalogKey): CatalogItem[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)[key];
}

/** Só os activos — para os menus suspensos de quem está a trabalhar. */
export function useActiveCatalog(key: CatalogKey): CatalogItem[] {
  return useCatalog(key).filter((i) => !i.archived);
}

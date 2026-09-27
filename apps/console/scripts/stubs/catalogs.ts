/** Os catálogos do clube de teste. Ver `test-calendario.ts`. */
const CATALOGOS: Record<string, { id: string; label: string; archived?: boolean }[]> = {
  venues: [
    { id: "v1", label: "Campo 1" },
    { id: "v2", label: "Pavilhão" },
    { id: "v3", label: "Campo Velho", archived: true },
  ],
  dressingRooms: [
    { id: "b1", label: "Balneário 1" },
    { id: "b2", label: "Balneário 2" },
  ],
  competitions: [
    { id: "c_amigavel", label: "Amigável" },
    { id: "c_dist", label: "Campeonato Distrital" },
  ],
  eventTypes: [
    { id: "e1", label: "Treino" },
    { id: "e2", label: "Jogo" },
    { id: "e3", label: "Torneio" },
    { id: "e4", label: "Evento" },
  ],
};

export function getCatalog(key: string) {
  return CATALOGOS[key] ?? [];
}

export function addItem(): Promise<void> {
  return Promise.resolve();
}

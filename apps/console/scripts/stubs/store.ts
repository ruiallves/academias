/** O store da consola, reduzido ao que o leitor do calendário lê. Ver `test-calendario.ts`. */
export const academy = { slug: "clube-teste", name: "Clube de Teste" };

export const teams = [
  {
    id: "t13",
    name: "Sub-13 Futebol",
    competitions: [{ id: "c_amigavel", label: "Amigável" }],
  },
  {
    id: "t15",
    name: "Sub-15 Futebol",
    competitions: [
      { id: "c_amigavel", label: "Amigável" },
      { id: "c_dist", label: "Campeonato Distrital" },
    ],
  },
];

export function reloadAcademy(): Promise<void> {
  return Promise.resolve();
}

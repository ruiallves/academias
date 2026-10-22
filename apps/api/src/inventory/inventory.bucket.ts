/**
 * O bucket privado das fotografias do inventário.
 *
 * Num ficheiro só seu para o site do clube o poder ler (copia a primeira foto
 * de um artigo à venda para o bucket público) sem importar `inventory.service`,
 * que por sua vez injeta o serviço do site — a importação circular rebentava
 * na injeção de dependências.
 */
export const INVENTORY_BUCKET = "inventario";

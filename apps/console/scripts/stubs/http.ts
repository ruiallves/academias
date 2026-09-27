/**
 * O cliente HTTP, desligado.
 *
 * Este teste exercita o **leitor** do ficheiro, que não fala com o servidor. O
 * stub existe para cortar a cadeia de imports (http → session → api → store),
 * e não para fingir respostas: qualquer chamada aqui é um engano do teste.
 */
const naoDevia = (): never => {
  throw new Error("O teste do leitor não chama a API");
};

export const apiGet = naoDevia;
export const apiGetSilencioso = naoDevia;
export const apiPost = naoDevia;
export const apiPostSilencioso = naoDevia;
export const apiPatch = naoDevia;
export const apiPut = naoDevia;
export const apiDelete = naoDevia;

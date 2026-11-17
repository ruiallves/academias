import { apiGet, apiPost } from "./http";
import { mostrarErro } from "./avisos";

/**
 * O diretório dos clubes federados de Portugal, com os emblemas.
 *
 * A lista é da plataforma (FPF e FPB, ver `docs/13-diretorio-de-clubes.md`):
 * o campo do adversário procura aqui e, ao escolher, o jogo fica ligado ao
 * clube (`opponentClubId`) e com o emblema. Um adversário sem emblema pode
 * levar um que o clube carregue: fica logo a valer para este clube, e a
 * plataforma revê-o por fora.
 */

export type Emblema = { pequeno: string; grande: string };

export type ClubeConhecido = {
  id: string;
  nome: string;
  nomeCurto: string | null;
  associacao: string | null;
  regiao: string | null;
  localidade: string | null;
  modalidades: string[];
  federacoes: ("FPF" | "FPB")[];
  emblema: Emblema | null;
  /** O emblema é o que este clube carregou, não o do diretório. */
  emblemaProposto: boolean;
};

export function procurarClubes(q: string, modalidade?: string): Promise<ClubeConhecido[]> {
  const params = new URLSearchParams({ q });
  if (modalidade) params.set("modalidade", modalidade);
  return apiGet<ClubeConhecido[]>(`/api/clubes-conhecidos?${params}`);
}

/** Um clube do diretório pelo id: a ficha de um jogo que já o tem escolhido mostra o nome e a associação. */
export function clubeConhecido(id: string): Promise<ClubeConhecido> {
  return apiGet<ClubeConhecido>(`/api/clubes-conhecidos/clube/${encodeURIComponent(id)}`);
}

/** O emblema que este clube já carregou para um adversário escrito à mão. */
export async function emblemaDoNome(nome: string): Promise<Emblema | null> {
  if (nome.trim().length < 2) return null;
  const r = await apiGet<{ emblema: Emblema | null }>(`/api/clubes-conhecidos/emblema-do-nome?nome=${encodeURIComponent(nome.trim())}`);
  return r.emblema;
}

const TIPOS = ["image/png", "image/webp", "image/jpeg"];
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Carregar um emblema para um adversário, em dois passos como as fotografias:
 * autorização, carregamento direto para o Supabase, confirmação (que trata a
 * imagem nos dois tamanhos). Devolve os endereços já a valer.
 */
export async function carregarEmblema(file: File, alvo: { clubName: string; knownClubId?: string | null }): Promise<Emblema> {
  if (!TIPOS.includes(file.type)) throw erro("O emblema tem de ser PNG, WebP ou JPEG.");
  if (file.size > MAX_BYTES) throw erro("O emblema tem de ter menos de 2 MB.");

  const { id, url, token, key } = await apiPost<{ id: string; url: string; token: string; key: string }>("/api/clubes-conhecidos/emblemas", {
    contentType: file.type,
    clubName: alvo.clubName.trim(),
    ...(alvo.knownClubId ? { knownClubId: alvo.knownClubId } : {}),
  });
  const res = await fetch(url, { method: "PUT", headers: { "Content-Type": file.type, Authorization: `Bearer ${token}` }, body: file });
  if (!res.ok) throw erro("O carregamento falhou. Tenta outra vez.");
  const r = await apiPost<{ emblema: Emblema }>(`/api/clubes-conhecidos/emblemas/${id}/confirmar`, { key });
  return r.emblema;
}

function erro(mensagem: string): Error {
  mostrarErro(mensagem);
  return new Error(mensagem);
}

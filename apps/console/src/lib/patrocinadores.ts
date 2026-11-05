import { useEffect, useSyncExternalStore } from "react";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/http";
import { enviarImagem, patrocinadoresMudaram, type Patrocinador } from "@/lib/website";

/**
 * Os patrocinadores e parceiros do clube (Gestão → Patrocinadores).
 *
 * Uma lista só, em `/api/patrocinadores`: a mesma que o site do clube mostra
 * (Connect Pro) e a que os sócios veem no separador Parcerias da app, com a
 * vantagem de cada um. O menu Website mostra este mesmo editor.
 *
 * Cada escrita vai logo ao servidor e o ecrã mostra o que ele devolveu. Se
 * recusar, o erro aparece no cartão de erros (`lib/http`) e a lista volta a
 * ser lida, para o ecrã não mostrar o que não ficou gravado.
 */

export type { Patrocinador };
export type PatrocinadorDoClube = Patrocinador & { vantagem: string };

type Estado = { lista: PatrocinadorDoClube[]; noSite: boolean; carregado: boolean; erro: string | null };

let estado: Estado = { lista: [], noSite: false, carregado: false, erro: null };
let aCarregar: Promise<void> | null = null;
const ouvintes = new Set<() => void>();

function emitir(novo: Partial<Estado>) {
  estado = { ...estado, ...novo };
  if (novo.lista) patrocinadoresMudaram(estado.lista);
  ouvintes.forEach((o) => o());
}

const subscrever = (o: () => void) => {
  ouvintes.add(o);
  return () => ouvintes.delete(o);
};

const normalizar = (p: Partial<PatrocinadorDoClube>): PatrocinadorDoClube => ({
  id: String(p.id ?? ""),
  nome: String(p.nome ?? ""),
  url: String(p.url ?? ""),
  logo: String(p.logo ?? ""),
  vantagem: String(p.vantagem ?? ""),
});

export function carregarPatrocinadores(forcar = false): Promise<void> {
  if (!forcar && (estado.carregado || aCarregar)) return aCarregar ?? Promise.resolve();
  aCarregar = apiGet<{ patrocinadores: Partial<PatrocinadorDoClube>[]; noSite: boolean }>("/api/patrocinadores")
    .then((r) => emitir({ lista: (r.patrocinadores ?? []).map(normalizar), noSite: r.noSite === true, carregado: true, erro: null }))
    .catch((e: unknown) => emitir({ erro: e instanceof Error ? e.message : "Não foi possível abrir os patrocinadores." }))
    .finally(() => {
      aCarregar = null;
    });
  return aCarregar;
}

/** Trocar de clube na consola: a lista é de outro clube. */
export function esquecerPatrocinadores() {
  estado = { lista: [], noSite: false, carregado: false, erro: null };
  ouvintes.forEach((o) => o());
}

export function usePatrocinadores(chave: string) {
  useEffect(() => {
    esquecerPatrocinadores();
    void carregarPatrocinadores(true);
  }, [chave]);
  return useSyncExternalStore(subscrever, () => estado);
}

const repor = () => void carregarPatrocinadores(true);

export async function guardarPatrocinador(p: PatrocinadorDoClube): Promise<PatrocinadorDoClube> {
  const corpo = { nome: p.nome.trim(), url: p.url.trim(), logo: p.logo, vantagem: p.vantagem.trim() };
  try {
    const gravado = normalizar(
      p.id ? await apiPatch<PatrocinadorDoClube>(`/api/patrocinadores/${p.id}`, corpo) : await apiPost<PatrocinadorDoClube>("/api/patrocinadores", corpo),
    );
    emitir({
      lista: estado.lista.some((x) => x.id === gravado.id) ? estado.lista.map((x) => (x.id === gravado.id ? gravado : x)) : [...estado.lista, gravado],
    });
    return gravado;
  } catch (e) {
    repor();
    throw e;
  }
}

export async function apagarPatrocinador(id: string) {
  await apiDelete(`/api/patrocinadores/${id}`);
  emitir({ lista: estado.lista.filter((x) => x.id !== id) });
}

/** Subir ou descer um lugar. A ordem é a do site e a da app. */
export async function moverPatrocinador(id: string, passo: -1 | 1) {
  const i = estado.lista.findIndex((x) => x.id === id);
  const j = i + passo;
  if (i < 0 || j < 0 || j >= estado.lista.length) return;
  const nova = [...estado.lista];
  [nova[i], nova[j]] = [nova[j], nova[i]];
  emitir({ lista: nova });
  await apiPut("/api/patrocinadores/ordem", { ids: nova.map((x) => x.id) }).catch(() => repor());
}

/** O logótipo, reduzido a 320 px, no bucket do site. Devolve o endereço público. */
export function enviarLogotipo(ficheiro: File): Promise<string> {
  return enviarImagem(ficheiro, 320, "/api/patrocinadores/logotipo");
}

/** "https://www.farmacia.pt/loja" → "farmacia.pt": o que se lê numa lista. */
export function dominioDe(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

import { useSyncExternalStore } from "react";
import { recintoValido, type Recinto } from "@academia/ui/estadio";

export type { Recinto, Bancada, Lado } from "@academia/ui/estadio";

/**
 * O site do clube, tal como a consola o edita. **Só em DEV.**
 *
 * ## Guardado no browser, e di-lo
 *
 * Ainda não há modelos nem endpoints na API para o site (notícias, produtos,
 * bilhetes): criá-los é uma migração, e essa decide-se à parte. Até lá o menu
 * Website guarda aqui, no `localStorage` deste browser, por clube.
 *
 * É o padrão que já mordeu uma vez ("guardo e ao atualizar desaparece", ver
 * `academia-escritas-locais`), e por isso a página diz no topo, sempre, onde
 * fica o que se grava. Quando a API existir, este ficheiro passa a falar com
 * ela e mais nada na página muda: as secções só conhecem `useSite` e
 * `gravarSite`.
 *
 * Os nomes dos campos seguem os do site (`apps/clube-site/src/dados/tipos.ts`)
 * onde é a mesma coisa, para a troca ser passar o JSON.
 */

export type Layout = "classico" | "porto";

export type Redes = Partial<Record<"facebook" | "instagram" | "youtube" | "x" | "tiktok", string>>;

export type NoticiaDoSite = {
  id: string;
  titulo: string;
  resumo: string;
  /** Parágrafos separados por uma linha em branco. */
  corpo: string;
  categoria: string;
  imagem: string;
  destaque: boolean;
  estado: "rascunho" | "publicada";
  /** ISO. Posta ao publicar pela primeira vez. */
  publicadaEm: string | null;
};

export type ProdutoDoSite = {
  id: string;
  nome: string;
  categoria: string;
  /** Em euros. */
  preco: number;
  imagem: string;
  descricao: string;
  /** "S, M, L, XL" — vazio num cachecol. */
  tamanhos: string;
  esgotado: boolean;
  visivel: boolean;
};

/**
 * Um tipo de bilhete. `bancadaId` liga-o a uma bancada do recinto do jogo:
 * é o que deixa quem compra ver no mapa onde vai ficar. Nulo = qualquer lugar.
 */
export type TipoDeBilhete = { id: string; nome: string; preco: number; bancadaId: string | null };

export type BilheteiraDoJogo = {
  aberta: boolean;
  /** Em que recinto se joga. Nulo = sem mapa, só a lista de bilhetes. */
  recintoId: string | null;
  lotacao: number | null;
  nota: string;
  tipos: TipoDeBilhete[];
};

export type Patrocinador = { id: string; nome: string; url: string; logo: string };

export type SiteDoClube = {
  layout: Layout;
  dominio: string;
  identidade: {
    lema: string;
    sobre: string;
    historia: string;
    fundacao: string;
    morada: string;
    telefone: string;
    email: string;
    redes: Redes;
  };
  noticias: NoticiaDoSite[];
  produtos: ProdutoDoSite[];
  /** Os recintos do clube vistos de cima: o estádio, o pavilhão. */
  recintos: Recinto[];
  /** Por id de jogo. Um jogo sem entrada não tem bilheteira. */
  bilheteira: Record<string, BilheteiraDoJogo>;
  /** Por id de equipa. Sem entrada = aparece, sem plantel. */
  equipas: Record<string, { visivel: boolean; plantel: boolean }>;
  patrocinadores: Patrocinador[];
};

export function siteVazio(): SiteDoClube {
  return {
    layout: "classico",
    dominio: "",
    identidade: { lema: "", sobre: "", historia: "", fundacao: "", morada: "", telefone: "", email: "", redes: {} },
    noticias: [],
    produtos: [],
    recintos: [],
    bilheteira: {},
    equipas: {},
    patrocinadores: [],
  };
}

/* -------------------------------------------------------------------------- */
/* O armazém                                                                    */
/* -------------------------------------------------------------------------- */

const chave = (slug: string) => `academia.website.${slug}`;
const cache = new Map<string, SiteDoClube>();
const ouvintes = new Set<() => void>();

/**
 * O site deste clube. A mesma referência enquanto nada mudar — é o que o
 * `useSyncExternalStore` exige para não desenhar em ciclo.
 */
export function lerSite(slug: string): SiteDoClube {
  const visto = cache.get(slug);
  if (visto) return visto;
  let site = siteVazio();
  try {
    const bruto = localStorage.getItem(chave(slug));
    // Juntar ao vazio: um campo novo neste ficheiro não parte um site gravado antes dele.
    if (bruto) site = { ...site, ...(JSON.parse(bruto) as Partial<SiteDoClube>) };
  } catch {
    // Browser sem armazenamento (janela privada, bloqueado): fica o vazio.
  }
  // Os recintos desenham-se, e um recinto partido leva a página com ele: ver `recintoValido`.
  site = { ...site, recintos: Array.isArray(site.recintos) ? site.recintos.map((r, i) => recintoValido(r, i)) : [] };
  cache.set(slug, site);
  return site;
}

export function gravarSite(slug: string, mudar: (s: SiteDoClube) => SiteDoClube): void {
  const novo = mudar(lerSite(slug));
  cache.set(slug, novo);
  try {
    localStorage.setItem(chave(slug), JSON.stringify(novo));
  } catch {
    // Sem armazenamento a alteração vive até se fechar o separador.
  }
  ouvintes.forEach((o) => o());
}

export function useSite(slug: string): SiteDoClube {
  return useSyncExternalStore(
    (o) => {
      ouvintes.add(o);
      return () => ouvintes.delete(o);
    },
    () => lerSite(slug),
  );
}

export const novoId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

/**
 * Uma imagem escolhida no computador, reduzida a `max` píxeis no lado maior e
 * devolvida como `data:` URL.
 *
 * Reduzir não é enfeite: sem API a imagem vive no `localStorage`, que tem uns
 * 5 MB por site, e a fotografia de um logótipo tirada no telemóvel passa
 * disso sozinha. Um logótipo a 320 px em WebP fica nos 10–30 KB. SVG passa
 * tal como vem, que já é pequeno e não perde nada.
 */
export async function imagemReduzida(ficheiro: File, max = 320): Promise<string> {
  if (!ficheiro.type.startsWith("image/")) throw new Error("O ficheiro não é uma imagem.");
  if (ficheiro.size > 10 * 1024 * 1024) throw new Error("A imagem passa de 10 MB. Escolhe uma mais pequena.");
  const lerComoUrl = () =>
    new Promise<string>((ok, falha) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => falha(new Error("Não foi possível ler a imagem."));
      r.readAsDataURL(ficheiro);
    });
  if (ficheiro.type === "image/svg+xml") return lerComoUrl();

  const bitmap = await createImageBitmap(ficheiro).catch(() => {
    throw new Error("Não foi possível abrir a imagem.");
  });
  const escala = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // WebP mantém a transparência dos logótipos; o PNG fica para quem não o tem.
  const webp = canvas.toDataURL("image/webp", 0.9);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}

/** Onde se vê o site: o domínio do clube, ou a pré-visualização. */
export function enderecoDoSite(slug: string, dominio: string): string {
  if (import.meta.env.DEV) return "http://localhost:5190";
  return dominio ? `https://${dominio}` : `https://${slug}.sites.academias.pt`;
}

/* -------------------------------------------------------------------------- */
/* Exemplos                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Conteúdo de exemplo, para ver o menu cheio sem escrever tudo à mão. Só
 * acrescenta: o que o clube já escreveu fica.
 */
export function comExemplos(s: SiteDoClube, nomeCurto: string): SiteDoClube {
  const agora = Date.now();
  const dias = (n: number) => new Date(agora - n * 86400000).toISOString();
  const foto = (seed: string, w = 1600, h = 1000) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
  return {
    ...s,
    identidade: {
      ...s.identidade,
      lema: s.identidade.lema || "A formação primeiro",
      sobre:
        s.identidade.sobre ||
        `O ${nomeCurto} é um clube de formação com futebol e futsal, dos 5 aos 19 anos, e uma comunidade de sócios que acompanha cada jogo em casa.`,
    },
    noticias: [
      ...s.noticias,
      {
        id: novoId(),
        titulo: "Vitória por 3-0 deixa a equipa no segundo lugar",
        resumo: "Dois golos na primeira parte e um no fim, numa tarde com a bancada cheia.",
        corpo: "A equipa entrou forte e marcou cedo.\n\nNa segunda parte geriu o resultado e fechou a contagem perto do fim.",
        categoria: "Seniores",
        imagem: foto("site-n1"),
        destaque: true,
        estado: "publicada",
        publicadaEm: dias(2),
      },
      {
        id: novoId(),
        titulo: "Escola de futebol abre inscrições para a nova época",
        resumo: "Dos 5 aos 9 anos, treinos à terça e à quinta. As famílias recebem tudo na app do clube.",
        corpo: "As inscrições fazem-se online.\n\nDepois de aceite, a família instala a app do clube.",
        categoria: "Formação",
        imagem: foto("site-n2"),
        destaque: true,
        estado: "publicada",
        publicadaEm: dias(5),
      },
      {
        id: novoId(),
        titulo: "Assembleia Geral de sócios",
        resumo: "Na sede, às 21h00. Contas da época e orçamento para a próxima.",
        corpo: "Podem votar os sócios com as quotas em dia.",
        categoria: "Clube",
        imagem: foto("site-n3"),
        destaque: false,
        estado: "rascunho",
        publicadaEm: null,
      },
    ],
    produtos: [
      ...s.produtos,
      {
        id: novoId(),
        nome: "Camisola principal",
        categoria: "Equipamento",
        preco: 39.9,
        imagem: foto("site-p1", 900, 1100),
        descricao: "A camisola de jogo desta época.",
        tamanhos: "XS, S, M, L, XL",
        esgotado: false,
        visivel: true,
      },
      {
        id: novoId(),
        nome: "Cachecol",
        categoria: "Adeptos",
        preco: 12,
        imagem: foto("site-p2", 900, 1100),
        descricao: "Cachecol de lã com o emblema bordado.",
        tamanhos: "",
        esgotado: false,
        visivel: true,
      },
    ],
    patrocinadores: s.patrocinadores.length
      ? s.patrocinadores
      : [
          { id: novoId(), nome: "Café Central", url: "", logo: "" },
          { id: novoId(), nome: "Farmácia do Largo", url: "", logo: "" },
        ],
  };
}

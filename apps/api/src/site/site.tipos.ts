/**
 * As formas do site do clube, e a limpeza do que chega de fora.
 *
 * Dois lados:
 *
 *   - **A consola** fala em português e em euros (`SiteDoClube`), a mesma
 *     forma que `apps/console/src/lib/website.ts` sempre usou: a troca do
 *     armazenamento do browser para a API não lhe mudou os tipos.
 *   - **O site público** lê a forma de `apps/clube-site/src/dados/tipos.ts`
 *     (`Clube`, `Noticia`, `Jogo`…), em inglês e com os nomes do esquema.
 *
 * O que vive em JSON na base (`SiteConfig.identity`, `teams`, `venues`,
 * `SiteMatchTickets.types`) passa sempre por aqui antes de ser gravado **e**
 * antes de ser lido: um JSON partido não pode chegar a um ecrã, e o recinto
 * do estádio é desenhado, por isso um recinto partido leva a página com ele
 * (ver `recintoValido` em `packages/ui/src/estadio.tsx`, de que isto é o par
 * do lado do servidor).
 */

export const LAYOUTS = ["classico", "porto"] as const;
export type Layout = (typeof LAYOUTS)[number];

export const REDES = ["facebook", "instagram", "youtube", "x", "tiktok"] as const;

export type Identidade = {
  lema: string;
  sobre: string;
  historia: string;
  fundacao: string;
  morada: string;
  telefone: string;
  email: string;
  redes: Partial<Record<(typeof REDES)[number], string>>;
  /**
   * A fotografia do clube: o bloco de sócios e a "Área do sócio". Vazio, o
   * site usa a de omissão (uma bancada). Só imagens do próprio clube, no
   * bucket do site: quem grava confere (`SiteService.atualizar`).
   */
  foto: string;
};

/** O que cada equipa leva no site. `foto` vazia: a de omissão da modalidade. */
export type EquipaNoSite = { visivel: boolean; plantel: boolean; foto: string };

export const LADOS = ["norte", "sul", "nascente", "poente", "noroeste", "nordeste", "sudoeste", "sudeste"] as const;
export type Lado = (typeof LADOS)[number];

export type Bancada = { id: string; nome: string; lado: Lado; ordem: number; peso: number; lotacao: number | null; coberta: boolean };
export type Recinto = { id: string; nome: string; tipo: "campo" | "pavilhao"; bancadas: Bancada[] };

export type TipoDeBilhete = { id: string; nome: string; preco: number; bancadaId: string | null };

/* -------------------------------------------------------------------------- */
/* Limpeza                                                                      */
/* -------------------------------------------------------------------------- */

const texto = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Só endereços web; o resto (javascript:, data:) não entra num `href`. */
export function urlSegura(v: unknown, max = 500): string {
  const s = texto(v, max);
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : "";
}

export function identidadeValida(v: unknown): Identidade {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const redesIn = (o.redes && typeof o.redes === "object" ? o.redes : {}) as Record<string, unknown>;
  const redes: Identidade["redes"] = {};
  for (const r of REDES) {
    const u = urlSegura(redesIn[r]);
    if (u) redes[r] = u;
  }
  return {
    lema: texto(o.lema, 120),
    sobre: texto(o.sobre, 1200),
    historia: texto(o.historia, 12000),
    fundacao: texto(o.fundacao, 4).replace(/\D/g, ""),
    morada: texto(o.morada, 300),
    telefone: texto(o.telefone, 40),
    email: texto(o.email, 160),
    redes,
    foto: urlSegura(o.foto),
  };
}

/**
 * O que cada equipa mostra no site: uma opção só.
 *
 * Ligada, a equipa aparece com tudo (equipa técnica, plantel, jogos e
 * resultados). Desligada, não aparece nada dela. **Desligada por omissão**:
 * uma equipa nova não vai para um site público sem alguém a ligar, porque o
 * plantel publica nomes, e nos escalões de formação são menores.
 *
 * `plantel` fica na forma por compatibilidade com o que já está gravado, e
 * acompanha sempre `visivel`. `foto` é a fotografia da equipa no site.
 */
export function equipasValidas(v: unknown): Record<string, EquipaNoSite> {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: Record<string, EquipaNoSite> = {};
  for (const [id, e] of Object.entries(o).slice(0, 500)) {
    if (!id || id.length > 60 || !e || typeof e !== "object") continue;
    const x = e as Record<string, unknown>;
    const visivel = x.visivel === true;
    out[id] = { visivel, plantel: visivel, foto: urlSegura(x.foto) };
  }
  return out;
}

export function recintosValidos(v: unknown): Recinto[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 10).map((r, i) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const bancadas = Array.isArray(o.bancadas) ? o.bancadas : [];
    return {
      id: texto(o.id, 60) || `recinto-${i}`,
      nome: texto(o.nome, 80) || "Recinto",
      tipo: o.tipo === "pavilhao" ? "pavilhao" : "campo",
      bancadas: bancadas.slice(0, 40).map((b, k) => {
        const x = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
        const lado = (LADOS as readonly string[]).includes(x.lado as string) ? (x.lado as Lado) : "norte";
        const peso = numero(x.peso);
        const lotacao = numero(x.lotacao);
        return {
          id: texto(x.id, 60) || `bancada-${i}-${k}`,
          nome: texto(x.nome, 60) || "Bancada",
          lado,
          ordem: numero(x.ordem) ?? k,
          peso: peso && peso > 0 && peso < 1000 ? peso : 1,
          lotacao: lotacao && lotacao > 0 && lotacao < 200_000 ? Math.round(lotacao) : null,
          coberta: x.coberta === true,
        };
      }),
    };
  });
}

/** Os tipos de bilhete, guardados em cêntimos. */
export function tiposValidos(v: unknown): { id: string; nome: string; precoCents: number; bancadaId: string | null }[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 30).flatMap((t, i) => {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const nome = texto(o.nome, 60);
    const preco = numero(o.preco) ?? (numero(o.precoCents) !== null ? numero(o.precoCents)! / 100 : null);
    if (!nome || preco === null || preco < 0 || preco > 10_000) return [];
    return [{ id: texto(o.id, 60) || `tipo-${i}`, nome, precoCents: Math.round(preco * 100), bancadaId: texto(o.bancadaId, 60) || null }];
  });
}

export function tiposParaConsola(v: unknown): TipoDeBilhete[] {
  return tiposValidos(v).map((t) => ({ id: t.id, nome: t.nome, preco: t.precoCents / 100, bancadaId: t.bancadaId }));
}

/** "Parágrafo um\n\nParágrafo dois" → ["Parágrafo um", "Parágrafo dois"]. */
export function paragrafos(s: string): string[] {
  return s
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/** O domínio como se guarda: minúsculas, sem esquema, sem `www.`, sem caminho. */
export function dominioLimpo(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

export function dominioValido(d: string): boolean {
  return d.length <= 200 && /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d);
}

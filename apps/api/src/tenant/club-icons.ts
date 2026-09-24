/**
 * Os ícones da app instalada, feitos a partir do símbolo do clube.
 *
 * ## Porque é que o símbolo não pode ir tal e qual para o manifest
 *
 * Ia, com `sizes: "any"`, e o efeito era a app instalada ficar para sempre com o
 * primeiro ícone que teve. O Chrome no Android só aceita como ícone da app um
 * PNG **quadrado** com pelo menos 144 px; o símbolo é o que o clube carregou, na
 * medida e na proporção que calhou. Um símbolo largo, ou pequeno, tornava o
 * manifest "sem ícone aceitável" — e com o manifest inválido o Chrome não
 * actualiza a app que já está no telemóvel. Em silêncio: o clube trocava de
 * símbolo, via-o na consola, e o ecrã inicial dos pais não mexia.
 *
 * Aqui o símbolo é encaixado (sem cortar, sem esticar) num quadrado com a medida
 * exacta que o manifest declara. Deixa de haver ícone que o browser recuse.
 *
 * ## Porque é que a versão vai no caminho
 *
 * O Chrome decide que a app mudou comparando o endereço e o conteúdo do ícone.
 * Com a versão no caminho, símbolo novo é endereço novo — e nenhuma cache pelo
 * meio (a do browser, a do service worker, a de um proxy) pode continuar a
 * servir o antigo com o nome do novo.
 *
 * O slug também vai no caminho, e não só no `Host`, para funcionar igual em
 * desenvolvimento, onde a origem é `localhost` e não diz de que clube se trata.
 */

export type NomeDoIcone = "192" | "512" | "maskable-512" | "apple-180";

type Desenho = {
  size: number;
  /** Margem de cada lado, em fracção do lado. */
  margem: number;
  /** Nulo é transparente. */
  fundo: string | null;
};

const DESENHOS: Record<NomeDoIcone, Desenho> = {
  "192": { size: 192, margem: 0.06, fundo: null },
  "512": { size: 512, margem: 0.06, fundo: null },
  /*
   * O maskable é o que o Android usa no ecrã inicial, recortado na forma do
   * fabricante — no pior caso um círculo com 80% do lado. Um quadrado só cabe
   * inteiro nesse círculo se o lado for até 0,8/√2 ≈ 57%: daí 22% de margem.
   * Com menos, um emblema perdia o que tem nas bordas, que costuma ser o nome.
   * Fundo branco porque o recorte mostra o fundo e um emblema assenta nele.
   */
  "maskable-512": { size: 512, margem: 0.22, fundo: "#ffffff" },
  /*
   * O do iPhone. O iOS assenta a transparência sobre preto e não redimensiona
   * com proporção — daí o quadrado opaco.
   */
  "apple-180": { size: 180, margem: 0.1, fundo: "#ffffff" },
};

export function isNomeDoIcone(nome: string): nome is NomeDoIcone {
  return Object.prototype.hasOwnProperty.call(DESENHOS, nome);
}

/**
 * A versão do símbolo: o nome do ficheiro, sem extensão.
 *
 * Cada carregamento tem um sufixo aleatório (`simbolo-<hex>`, ver
 * `club-logo.service.ts`), por isso o nome já muda sempre que o símbolo muda.
 * A app da família deriva a mesma coisa em `lib/brand.ts` — mudar uma obriga a
 * mudar a outra.
 */
export function versaoDoSimbolo(logoUrl: string): string {
  const ficheiro = logoUrl.split("?")[0].split("/").pop() ?? "";
  return ficheiro.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "").slice(-40) || "0";
}

/** O endereço (relativo à origem) de um ícone gerado. */
export function caminhoDoIcone(slug: string, logoUrl: string, nome: NomeDoIcone): string {
  return `/icone/${encodeURIComponent(slug)}/${versaoDoSimbolo(logoUrl)}/${nome}.png`;
}

/**
 * Guardados em memória, pela combinação símbolo + ícone.
 *
 * Um ícone só se desenha uma vez por símbolo e por processo: o manifest é
 * pedido por cada telemóvel a cada arranque, e ir buscar o símbolo ao Supabase
 * e redimensioná-lo a cada pedido era trabalho repetido para o mesmo resultado.
 * O limite é só para uma plataforma com muitos clubes não crescer sem fim.
 */
const cache = new Map<string, Promise<Buffer>>();
const MAX_CACHE = 400;

export function desenharIcone(logoUrl: string, nome: NomeDoIcone): Promise<Buffer> {
  const chave = `${logoUrl}|${nome}`;
  const existente = cache.get(chave);
  if (existente) return existente;

  if (cache.size >= MAX_CACHE) cache.clear();
  const pronto = desenhar(logoUrl, DESENHOS[nome]);
  cache.set(chave, pronto);
  // Uma falha (rede, ficheiro estragado) não fica guardada: o próximo pedido tenta outra vez.
  pronto.catch(() => cache.delete(chave));
  return pronto;
}

async function desenhar(logoUrl: string, d: Desenho): Promise<Buffer> {
  // Carregado só aqui: `caminhoDoIcone` é usado pela landing, que é uma função
  // pura e não tem nada que arrastar uma biblioteca de imagem nativa.
  const { default: sharp } = await import("sharp");

  const res = await fetch(logoUrl, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Símbolo indisponível (${res.status})`);
  const original = Buffer.from(await res.arrayBuffer());

  const lado = Math.max(1, Math.round(d.size * (1 - 2 * d.margem)));
  const transparente = { r: 0, g: 0, b: 0, alpha: 0 };

  const simbolo = await sharp(original)
    .rotate() // respeita a orientação EXIF de uma fotografia
    .resize(lado, lado, { fit: "contain", background: transparente })
    .png()
    .toBuffer();

  return sharp({
    create: { width: d.size, height: d.size, channels: 4, background: d.fundo ?? transparente },
  })
    .composite([{ input: simbolo, gravity: "center" }])
    .png()
    .toBuffer();
}

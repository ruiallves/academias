import { CONTACT_EMAIL, FAQ, INSTAGRAM_URL, PLANS, euro } from "./content";
import { SOLUCOES, solucaoDe } from "./solucoes";

/**
 * O que o Google lê de cada página.
 *
 * O título e a descrição são o que aparece no resultado da pesquisa, por isso
 * levam as palavras que as pessoas escrevem ("gestão de clubes", "software para
 * clubes"), e não o slogan. O slogan fica no H1 da página.
 *
 * Este ficheiro serve dois lados: o build (`scripts/prerender.mjs`), que escreve
 * estas etiquetas no HTML de cada página, e a navegação no navegador, que as
 * troca ao mudar de página (`App.tsx`).
 */

/** O endereço oficial. `academias.pt` redireciona para aqui. */
export const SITE_URL = "https://www.academias.pt";

export type Pagina = {
  path: string;
  title: string;
  description: string;
  /** Fora do sitemap e com `noindex`. */
  privada?: boolean;
  /** Prioridade no sitemap. */
  prioridade?: number;
};

const desde = euro(Math.min(...PLANS.map((p) => p.monthly)));

export const PAGINAS: Pagina[] = [
  {
    path: "/",
    title: "Software de gestão de clubes desportivos | Academias",
    description:
      "Software de gestão para clubes desportivos: atletas, treinos, jogos, mensalidades por MB WAY e sócios. Consola para o clube e app para as famílias. 30 dias grátis.",
    prioridade: 1,
  },
  {
    path: "/produto",
    title: "Gestão de atletas, treinos, jogos e sócios | Academias",
    description:
      "Tudo o que a Academias faz pelo clube: atletas e equipas, treinos e convocatórias, editor tático, jogos, clínico, scouting, mensalidades, quotas de sócio e app para as famílias.",
    prioridade: 0.9,
  },
  {
    path: "/planos",
    title: "Preços do software de gestão de clubes | Academias",
    description: `Planos desde ${desde} por mês para gerir o clube: Consola, Connect com app e pagamentos, e Connect Pro com o site do clube. 30 dias de experiência, sem cartão.`,
    prioridade: 0.9,
  },
  {
    path: "/contactos",
    title: "Experimentar 30 dias ou marcar uma reunião | Academias",
    description:
      "Fala connosco para experimentar a Academias no teu clube durante 30 dias ou marcar uma demonstração. Respondemos em dias úteis.",
    prioridade: 0.7,
  },
  ...SOLUCOES.map((s) => ({ path: s.path, title: s.title, description: s.description, prioridade: 0.8 })),
  {
    path: "/legal",
    title: "Documentos legais | Academias",
    description: "Termos de serviço, política de privacidade, cookies e acordo de tratamento de dados da Academias.",
    privada: true,
  },
];

export const PAGINA_404: Pagina = {
  path: "/404",
  title: "Página não encontrada | Academias",
  description: "Esta página não existe.",
  privada: true,
};

/** A página de um caminho, ou a 404. Os documentos legais partilham a mesma. */
export function paginaDe(pathname: string): Pagina {
  const limpo = pathname.replace(/\/+$/, "") || "/";
  if (limpo === "/legal" || limpo.startsWith("/legal/")) return PAGINAS.find((p) => p.path === "/legal")!;
  return PAGINAS.find((p) => p.path === limpo) ?? PAGINA_404;
}

/* -------------------------------------------------------------------------- */
/* Dados estruturados (schema.org)                                             */
/* -------------------------------------------------------------------------- */

const organizacao = {
  "@type": "Organization",
  "@id": `${SITE_URL}/#organizacao`,
  name: "Academias",
  url: SITE_URL,
  logo: `${SITE_URL}/academias-logo.png`,
  email: CONTACT_EMAIL,
  sameAs: [INSTAGRAM_URL],
  areaServed: { "@type": "Country", name: "Portugal" },
};

const software = {
  "@type": "SoftwareApplication",
  "@id": `${SITE_URL}/#software`,
  name: "Academias",
  url: SITE_URL,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Software de gestão de clubes desportivos",
  operatingSystem: "Web, Android, iOS",
  inLanguage: "pt-PT",
  description:
    "Software de gestão de clubes e academias desportivas: atletas, equipas, treinos, convocatórias, jogos, mensalidades, sócios e quotas, com app para as famílias, os atletas e os sócios.",
  publisher: { "@id": `${SITE_URL}/#organizacao` },
  offers: {
    "@type": "AggregateOffer",
    priceCurrency: "EUR",
    lowPrice: Math.min(...PLANS.map((p) => p.monthly)).toFixed(2),
    highPrice: Math.max(...PLANS.map((p) => p.monthly)).toFixed(2),
    offerCount: PLANS.length,
  },
};

/** O JSON-LD de cada página, ou nada. */
export function dadosEstruturados(path: string): object | null {
  if (path === "/") {
    return {
      "@context": "https://schema.org",
      "@graph": [
        organizacao,
        { "@type": "WebSite", "@id": `${SITE_URL}/#site`, url: SITE_URL, name: "Academias", inLanguage: "pt-PT", publisher: { "@id": `${SITE_URL}/#organizacao` } },
        software,
      ],
    };
  }
  const s = solucaoDe(path);
  if (s) {
    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebPage",
          "@id": `${SITE_URL}${s.path}#pagina`,
          url: SITE_URL + s.path,
          name: s.title,
          description: s.description,
          inLanguage: "pt-PT",
          about: { "@id": `${SITE_URL}/#software` },
          isPartOf: { "@id": `${SITE_URL}/#site` },
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Academias", item: `${SITE_URL}/` },
            { "@type": "ListItem", position: 2, name: s.nome, item: SITE_URL + s.path },
          ],
        },
        {
          "@type": "FAQPage",
          mainEntity: s.perguntas.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
        },
        software,
        organizacao,
      ],
    };
  }
  if (path === "/planos") {
    return {
      "@context": "https://schema.org",
      "@graph": [
        software,
        {
          "@type": "FAQPage",
          mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
        },
      ],
    };
  }
  return null;
}

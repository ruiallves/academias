import type { LegalAcceptanceKind, LegalAudience, LegalDocumentType, LegalScope } from "@prisma/client";

/**
 * O catálogo dos tipos de documento legal.
 *
 * O que está aqui é o que **o código precisa de saber** sobre cada tipo: o slug
 * do URL, o nome quando ainda não há versão nenhuma, a ordem no rodapé, e os
 * valores por omissão com que uma versão nova nasce na plataforma. O resto —
 * texto, versão, audiências de cada versão — é dado, vive na linha do
 * `LegalDocument`, e edita-se sem deploy.
 *
 * ## Audiências por omissão
 *
 * Uma pessoa está **numa** audiência por clube (ver `audiencesOf` no serviço):
 * `CLUB_OWNER` se tem `legal:club`, senão `STAFF` se tem vínculo de pessoal,
 * `FAMILY` se é encarregado ou atleta, `MEMBER` se tem ficha de sócio. Uma
 * pessoa pode ter mais do que uma quando é, por exemplo, treinador e pai.
 *
 * Quem representa o clube aceita os Termos de Serviço e o DPA **pelo clube**
 * (âmbito `CLUB`, uma aceitação por clube chega); os Termos de Utilização são de
 * todos os outros. Um presidente não aceita as duas coisas: os Termos de
 * Serviço cobrem a utilização que ele próprio faz. É uma decisão jurídica a
 * confirmar — está aqui como dado, muda-se aqui ou na plataforma.
 */
export type LegalTypeInfo = {
  slug: string;
  label: string;
  order: number;
  /** Os valores com que uma versão nova nasce. */
  defaults: {
    scope: LegalScope;
    audiences: LegalAudience[];
    acceptanceKind: LegalAcceptanceKind;
  };
  /** Explicação de uma linha para o painel da plataforma. */
  hint: string;
};

export const LEGAL_TYPES: Record<LegalDocumentType, LegalTypeInfo> = {
  TERMS_OF_SERVICE: {
    slug: "termos-de-servico",
    label: "Termos de Serviço",
    order: 1,
    defaults: { scope: "CLUB", audiences: ["CLUB_OWNER"], acceptanceKind: "ACCEPT" },
    hint: "O contrato com o clube: subscrição, pagamento, suspensão, cancelamento.",
  },
  TERMS_OF_USE: {
    slug: "termos-de-utilizacao",
    label: "Termos de Utilização",
    order: 2,
    defaults: { scope: "USER", audiences: ["STAFF", "FAMILY", "MEMBER"], acceptanceKind: "ACCEPT" },
    hint: "O que cada pessoa aceita para usar a consola ou a app do clube.",
  },
  PRIVACY_POLICY: {
    slug: "privacidade",
    label: "Política de Privacidade",
    order: 3,
    defaults: { scope: "USER", audiences: ["CLUB_OWNER", "STAFF", "FAMILY", "MEMBER"], acceptanceKind: "ACKNOWLEDGE" },
    hint: "Lê-se, não se aceita: informa sobre os dados que tratamos por conta própria.",
  },
  COOKIE_POLICY: {
    slug: "cookies",
    label: "Política de Cookies",
    order: 4,
    defaults: { scope: "USER", audiences: [], acceptanceKind: "NONE" },
    hint: "Só se publica. Se algum dia houver cookies que exijam consentimento, o mecanismo é outro.",
  },
  DPA: {
    slug: "dpa",
    label: "Acordo de Tratamento de Dados",
    order: 5,
    defaults: { scope: "CLUB", audiences: ["CLUB_OWNER"], acceptanceKind: "ACCEPT" },
    hint: "O clube é responsável pelo tratamento, a Academias é subcontratante.",
  },
  ACCEPTABLE_USE: {
    slug: "utilizacao-aceitavel",
    label: "Política de Utilização Aceitável",
    order: 6,
    defaults: { scope: "USER", audiences: ["CLUB_OWNER", "STAFF", "FAMILY", "MEMBER"], acceptanceKind: "ACCEPT" },
    hint: "O que não se faz na plataforma.",
  },
  ACADEMIAS_AI_TERMS: {
    slug: "academias-ai",
    label: "Termos da Academias AI",
    order: 7,
    defaults: { scope: "CLUB", audiences: ["CLUB_OWNER"], acceptanceKind: "ACCEPT" },
    hint: "Vídeo, imagem, identificação de jogadores, fornecedores de GPU, retenção. Publica-se quando o produto jurídico existir.",
  },
  DATA_RETENTION_POLICY: {
    slug: "retencao-de-dados",
    label: "Política de Retenção de Dados",
    order: 8,
    defaults: { scope: "USER", audiences: [], acceptanceKind: "NONE" },
    hint: "Quanto tempo guardamos cada coisa. Informativa.",
  },
};

export const LEGAL_TYPE_LIST = (Object.keys(LEGAL_TYPES) as LegalDocumentType[]).sort(
  (a, b) => LEGAL_TYPES[a].order - LEGAL_TYPES[b].order,
);

/**
 * Do slug do URL para o tipo. Aceita também o nome do enum e os caminhos
 * antigos do site (`/termos`, `/privacidade`, `/cookies`, `/dpa`), para nenhum
 * link já enviado a um clube deixar de abrir.
 */
export function typeFromSlug(slug: string): LegalDocumentType | null {
  const s = slug.trim().toLowerCase();
  for (const type of LEGAL_TYPE_LIST) {
    if (LEGAL_TYPES[type].slug === s || type.toLowerCase() === s) return type;
  }
  if (s === "termos") return "TERMS_OF_SERVICE";
  return null;
}

/** As audiências que o servidor conhece — para validar o que a plataforma grava. */
export const LEGAL_AUDIENCES: LegalAudience[] = ["CLUB_OWNER", "STAFF", "FAMILY", "MEMBER"];

/** Versões: "1.0", "2.3". Curto de propósito — não é semver, é o que se lê num rodapé. */
export const VERSION_RE = /^\d{1,3}(\.\d{1,3}){0,2}$/;

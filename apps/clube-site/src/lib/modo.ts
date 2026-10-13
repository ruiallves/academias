import type { Clube } from "@/dados/tipos";

/**
 * Em demonstração (`SITE_FONTE=demo`) o site mostra o clube inventado, o
 * interruptor de layout e fotografias de exemplo. Com dados reais, nada
 * disso: só o que o clube escreveu.
 */
export const emDemonstracao = () => (process.env.SITE_FONTE ?? "demo") === "demo";

/** O endereço oficial do site: o domínio do clube, ou a pré-visualização. */
export function enderecoOficial(clube: Clube): string {
  if (clube.dominio) return `https://${clube.dominio}`;
  const preview = process.env.SITE_PREVIEW_DOMAIN ?? "website.academias.pt";
  return `https://${clube.slug}.${preview}`;
}

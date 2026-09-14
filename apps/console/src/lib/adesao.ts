import { academy } from "@/lib/api";
import { apiOrigin } from "@/lib/http";
import { descarregarCartaz, descarregarQrPng, qrPng } from "@/lib/qr-cartaz";

/**
 * O QR da página de adesão a sócio — para o telemóvel de quem passa pelo clube.
 *
 * ## Porque é que um link não chegava
 *
 * O link serve o WhatsApp e o Instagram, onde há onde carregar. Não serve o
 * sítio onde as pessoas de facto decidem fazer-se sócias: a bancada, o bar, a
 * secretaria, o balcão de um patrocinador. Aí não há link nenhum — há uma
 * parede. E ninguém escreve `clube.academias.pt/l/.../sersocio` à mão a partir
 * de um cartaz.
 *
 * O que este ficheiro tem de próprio é **o endereço e as palavras**; o código e
 * o cartaz A4 são de `lib/qr-cartaz.ts`, partilhados com o convite das famílias.
 * O que o clube escreveu (a frase de abertura, a explicação) fica onde serve —
 * na página que abre a seguir, ver `CopyForm`.
 */

/**
 * O endereço público da página de inscrição deste clube — **absoluto, sempre**.
 *
 * Não devolve o `apiOrigin()` cru de propósito. Em produção a consola é servida
 * pela própria API e `apiOrigin()` é **vazio**: a mesma origem, que num
 * `<a href>` resolve sozinha (é o que o botão "Ver a página" faz). Num código
 * QR não resolve nada — a câmara de um telemóvel não tem origem onde pendurar
 * um caminho — e `/l/clube/sersocio` impresso num cartaz não é um endereço que
 * alguém consiga escrever. O erro só apareceria com o cartaz já na parede.
 */
export function linkDeAdesao(): string {
  return `${apiOrigin() || window.location.origin}/l/${academy.slug}/sersocio`;
}

export const qrDeAdesao = (tamanho = 1024) => qrPng(linkDeAdesao(), tamanho);

/** O nome do ficheiro. */
const ficheiro = (sufixo: string) => `Sócios — ${academy.shortName} (${sufixo})`;

export const descarregarQrDeAdesao = () => descarregarQrPng(linkDeAdesao(), ficheiro("QR"));

export const descarregarCartazDeAdesao = () =>
  descarregarCartaz({
    link: linkDeAdesao(),
    assunto: "ADESÃO A SÓCIO",
    chamada: "Aponta a câmara do telemóvel e inscreve-te",
    ficheiro: ficheiro("cartaz"),
  });

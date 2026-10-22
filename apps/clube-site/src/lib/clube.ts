import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { fonte } from "@/dados/fonte";
import { COOKIE_LAYOUT, layoutNormalizado, layoutValido, type Clube, type Layout } from "@/dados/tipos";
import { emDemonstracao } from "@/lib/modo";

/** O clube deste pedido, ou 404. Todas as páginas começam aqui. */
export async function clubeOu404(params: Promise<{ clube: string }>): Promise<Clube> {
  const { clube: slug } = await params;
  const clube = await fonte.clube(slug);
  if (!clube) notFound();
  return clube;
}

/**
 * O layout com que a página se desenha: o que o clube escolheu no menu
 * Website. Em demonstração, o cookie do interruptor sobrepõe-se.
 *
 * Decide-se aqui, na página, e não no proxy. O proxy guardava o layout em
 * memória durante cinco minutos, e no Vercel cada instância tem a sua
 * memória: depois de o clube trocar de layout, a página inicial vinha de
 * uma instância já atualizada e as notícias de outra ainda com o antigo
 * (AD Fafe, 14/10). Os dados do clube vêm da cache partilhada por todas as
 * instâncias (`fonte.clube`, etiqueta `clube:<slug>`), que a consola
 * invalida ao gravar: todas as páginas mudam ao mesmo tempo.
 */
export async function layoutAtual(clube: Clube): Promise<Layout> {
  if (emDemonstracao()) {
    const cookie = (await cookies()).get(COOKIE_LAYOUT)?.value;
    if (layoutValido(cookie)) return cookie;
  }
  // Com os nomes de hoje, venha a API com os antigos ou não.
  return layoutNormalizado(clube.layout);
}

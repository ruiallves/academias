import type { Metadata } from "next";
import { jogosComBilhetes } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { emDemonstracao } from "@/lib/modo";
import { pedidoDeExemplo, type Pedido } from "@/lib/bilheteira";
import { PaginaDoBilhete } from "./PaginaDoBilhete";

/**
 * A página de uma compra de bilhetes: o pagamento por fazer e, pago, os
 * códigos QR. O endereço leva o token da compra, que é o que dá acesso: vem
 * da compra e do email, e não entra no sitemap nem no Google (`noindex`
 * aqui, `X-Robots-Tag` no proxy).
 *
 * O servidor só desenha a casca; o estado pede-o o browser à API, sem cache,
 * e volta a perguntar enquanto o pagamento não chega.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Os teus bilhetes",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ clube: string; token: string }> };

export default async function Bilhete({ params }: Props) {
  const clube = await clubeOu404(params);
  const { token } = await params;
  const demonstracao = emDemonstracao();

  // Em demonstração, uma compra de exemplo para quando a compra fingida não está neste separador.
  let exemplo: Pedido | null = null;
  if (demonstracao) {
    const [jogo] = await jogosComBilhetes(clube.slug);
    exemplo = pedidoDeExemplo(jogo, clube.recintos.find((r) => r.id === jogo?.tickets?.recintoId) ?? null);
  }

  return (
    <PaginaDoBilhete
      slug={clube.slug}
      token={token}
      api={process.env.SITE_API_URL ?? ""}
      demonstracao={demonstracao}
      exemplo={exemplo}
      clube={clube.shortName}
    />
  );
}
